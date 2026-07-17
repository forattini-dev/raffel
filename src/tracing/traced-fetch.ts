/**
 * `tracedFetch` — Outbound HTTP client with automatic W3C trace context
 * propagation. Drop-in replacement for the global `fetch` that:
 *
 *   1. Reads the active span from the supplied tracer
 *   2. Injects `traceparent` (+ optional `tracestate`) into the outbound
 *      request headers using W3C Trace Context
 *   3. Forwards the response unchanged
 *
 * When two Raffel apps talk to each other through `tracedFetch`, the
 * downstream app extracts the `traceparent` from `envelope.metadata`, so the
 * `createTracingInterceptor` reuses the same trace and the same parent
 * span. In Datadog, this means both apps show up as spans under a single
 * `dd.trace_id` — the foundation of distributed tracing across the sidecar.
 *
 * No-op when no tracer is supplied or when there's no active span on the
 * tracer (e.g. outside an `enableTracing(...)` request): we just call the
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

export type FetchInput = Parameters<typeof fetch>[0]
export type FetchInit = Parameters<typeof fetch>[1]

/**
 * Fetch variant that always carries the active span's `traceparent` header.
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

  // No tracer or no active span → fall back to plain fetch. We deliberately
  // do NOT throw here: keep the path cheap when tracing is off.
  const active = tracer?.getActiveSpan?.()
  if (!tracer || !active) {
    return f(input, init)
  }

  const traceHeaders = tracer.injectContext(active.context)
  if (!traceHeaders.traceparent) {
    return f(input, init)
  }

  // Merge the trace headers into whatever the caller already supplied.
  // `traceparent`/`tracestate` set by the caller win — useful for explicit
  // cross-trace overrides (testing, baggage overrides).
  const callerHeaders = extractHeaders(input, init)
  const merged: Record<string, string> = {
    ...callerHeaders,
    ...(traceHeaders.traceparent ? { traceparent: traceHeaders.traceparent } : {}),
    ...(traceHeaders.tracestate ? { tracestate: traceHeaders.tracestate } : {}),
  }

  // Rebuild the call: if `input` is a Request, clone it with new headers so
  // we don't mutate the caller's object. If it's a string/URL, the second
  // arg carries headers directly.
  if (typeof input === 'string' || input instanceof URL) {
    return f(input, { ...(init ?? {}), headers: merged })
  }
  // input is a Request — clone with merged headers
  const cloned = new Request(input, { headers: merged })
  return f(cloned, init)
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
