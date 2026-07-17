/**
 * `tracedFetch` — Outbound HTTP client with automatic W3C trace context
 * propagation and its own client span. Drop-in replacement for the global
 * `fetch` that:
 *
 *   1. Starts a `kind: 'client'` span — a child of the tracer's active span
 *      when one exists, or a new root span otherwise (so background jobs
 *      and startup calls are traced too, not just in-request calls).
 *   2. Injects `traceparent` (+ optional `tracestate`) from *that* client
 *      span's own context into the outbound request headers using W3C Trace
 *      Context, so the downstream service becomes a child of the client
 *      span rather than a sibling of it.
 *   3. Records the response status (or the thrown error) on the span and
 *      finishes it, then forwards the response/error to the caller
 *      unchanged.
 *
 * When two Raffel apps talk to each other through `tracedFetch`, the
 * downstream app extracts the `traceparent` from `envelope.metadata`, so the
 * `createTracingInterceptor` reuses the same trace as a child of this client
 * span. Across A → B → C, that gives one connected trace where each hop
 * is visible as its own span — including the network leg itself: a slow or
 * failed call between A and B (timeout, DNS failure, connection refused)
 * shows up as an errored/long client span even if the request never reaches
 * B, which a bare header-injection approach can't represent.
 *
 * No-op propagation-wise when no tracer is supplied: we just call the
 * underlying `fetch` with the original headers. That keeps it safe to wire
 * in unconditionally and remove the tracer later without touching callers.
 *
 * @example
 * ```ts
 * import { createServer, createTracer, tracedFetch, createConsoleExporter } from 'raffel'
 *
 * const tracer = createTracer({ serviceName: 'svc-a', exporters: [createConsoleExporter()] })
 *
 * const server = createServer({ port: 3000, tracer })
 *   .procedure('orders.create')
 *   .handler(async (input, ctx) => {
 *     // Trace headers are injected automatically — the downstream service
 *     // will see this request as a child of the current span.
 *     const res = await tracedFetch(tracer, 'http://svc-b.internal/payments.charge', {
 *       method: 'POST',
 *       headers: { 'content-type': 'application/json' },
 *       body: JSON.stringify({ orderId: input.orderId }),
 *     })
 *     return res.json()
 *   })
 *
 * await server.start()
 * ```
 */

import type { Tracer } from './types.js'
import { serializeBaggageHeader } from './baggage.js'

export type FetchInput = Parameters<typeof fetch>[0]
export type FetchInit = Parameters<typeof fetch>[1]

/**
 * Fetch variant that always carries the active span's `traceparent` header
 * and records the call itself as a `kind: 'client'` span.
 *
 * Signature mirrors `globalThis.fetch` so it can be swapped without callers
 * noticing (the spread `init` lets `Request` objects be used as input).
 */
export async function tracedFetch(
  tracer: Tracer | undefined | null,
  input: FetchInput,
  init?: FetchInit
): Promise<Response> {
  const f = globalThis.fetch

  // No tracer at all → tracing is off; plain fetch, no span, no headers.
  // We deliberately do NOT throw here: keep the path cheap when tracing is
  // disabled.
  if (!tracer) {
    return f(input, init)
  }

  const method = resolveMethod(input, init)
  const url = resolveUrl(input)

  const active = tracer.getActiveSpan()
  const span = tracer.startSpan(method, {
    kind: 'client',
    parent: active?.context,
    attributes: {
      'http.request.method': method,
      ...(url ? clientUrlAttributes(url) : {}),
    },
  })

  const traceHeaders = tracer.injectContext(span.context)
  const baggageHeader = serializeBaggageHeader(tracer.getBaggage())
  const callerHeaders = extractHeaders(input, init)
  // Caller-supplied traceparent/tracestate/baggage win — useful for
  // explicit cross-trace overrides (testing, baggage overrides). Otherwise
  // fall back to what's active on the tracer for this call.
  const merged: Record<string, string> = { ...callerHeaders }
  if (!merged.traceparent && traceHeaders.traceparent) merged.traceparent = traceHeaders.traceparent
  if (!merged.tracestate && traceHeaders.tracestate) merged.tracestate = traceHeaders.tracestate
  if (!merged.baggage && baggageHeader) merged.baggage = baggageHeader

  const requestWithHeaders = buildRequest(input, init, merged)

  try {
    const response = await f(requestWithHeaders.input, requestWithHeaders.init)

    span.setAttribute('http.response.status_code', response.status)
    span.setStatus(response.status >= 500 ? 'error' : 'ok')
    span.finish()

    return response
  } catch (error) {
    // Network failure before a response was ever received (DNS failure,
    // connection refused, timeout, TLS error, ...). Without this span the
    // call would be entirely invisible in the trace — the downstream
    // service never even saw the request.
    if (error instanceof Error) {
      span.recordError(error)
    } else {
      span.setStatus('error', String(error))
    }
    span.finish()
    throw error
  }
}

/**
 * Resolve the HTTP method for span naming — following OTel HTTP semantic
 * conventions, the client span name is just the method (e.g. `GET`) to
 * avoid the cardinality explosion of embedding the full/raw URL in the name.
 */
function resolveMethod(input: FetchInput, init?: FetchInit): string {
  if (init?.method) return init.method.toUpperCase()
  if (input instanceof Request) return input.method.toUpperCase()
  return 'GET'
}

/**
 * Best-effort URL resolution across the three shapes `fetch`'s first
 * argument can take.
 */
function resolveUrl(input: FetchInput): URL | undefined {
  try {
    if (input instanceof Request) return new URL(input.url)
    if (input instanceof URL) return input
    if (typeof input === 'string') return new URL(input)
  } catch {
    // Relative or malformed URL — attributes are best-effort, not required.
  }
  return undefined
}

function clientUrlAttributes(url: URL): Record<string, string | number> {
  const attrs: Record<string, string | number> = {
    'url.full': url.href,
    'server.address': url.hostname,
  }
  if (url.port) {
    attrs['server.port'] = Number.parseInt(url.port, 10)
  }
  return attrs
}

/**
 * Normalize whatever headers the caller passed in into a flat string map.
 * Returns `{}` when the caller didn't supply any (so we never pass
 * `undefined` into `new Request`).
 */
function extractHeaders(input: FetchInput, init?: FetchInit): Record<string, string> {
  if (input instanceof Request) {
    const out: Record<string, string> = {}
    input.headers.forEach((value, key) => {
      out[key] = value
    })
    if (init?.headers) {
      Object.assign(out, normalizeHeaderSource(init.headers))
    }
    return out
  }
  if (init?.headers) {
    return normalizeHeaderSource(init.headers)
  }
  return {}
}

/**
 * Rebuild the call with merged headers: if `input` is a Request, clone it
 * so we don't mutate the caller's object. If it's a string/URL, the second
 * arg carries headers directly.
 */
function buildRequest(
  input: FetchInput,
  init: FetchInit | undefined,
  headers: Record<string, string>
): { input: FetchInput; init?: FetchInit } {
  if (typeof input === 'string' || input instanceof URL) {
    return { input, init: { ...(init ?? {}), headers } }
  }
  return { input: new Request(input, { headers }), init }
}

function normalizeHeaderSource(h: unknown): Record<string, string> {
  // Runtime narrowing across the three shapes `HeadersInit` covers:
  // Headers, [name, value][], or a plain record. We accept `unknown` because
  // `HeadersInit` isn't always exported from `@types/node` in the project's
  // current `lib` config — the runtime shapes are what matter.
  if (h instanceof Headers) {
    const out: Record<string, string> = {}
    h.forEach((value, key) => {
      out[key] = value
    })
    return out
  }
  if (Array.isArray(h)) {
    const out: Record<string, string> = {}
    for (const pair of h) {
      if (Array.isArray(pair) && pair.length >= 2) {
        out[String(pair[0])] = String(pair[1])
      }
    }
    return out
  }
  if (h && typeof h === 'object') {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
      if (v !== undefined && v !== null) {
        out[k] = String(v)
      }
    }
    return out
  }
  return {}
}
