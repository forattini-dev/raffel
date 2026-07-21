/**
 * Tracing Interceptor
 *
 * Automatically creates spans for incoming requests.
 *
 * Span naming + attributes follow the OpenTelemetry HTTP semantic
 * conventions where applicable:
 *   - server span name: `${http.request.method} ${http.route}`
 *     (so Datadog APM auto-groups by resource name)
 *   - attrs: `http.request.method`, `http.route`, `url.path`,
 *     `rpc.method`, `rpc.system`
 *
 * Falls back to `${procedure}` for non-HTTP transports (gRPC, JSON-RPC,
 * WS, TCP/UDP) where there is no HTTP route to model.
 *
 * On every span the interceptor also stashes `ddTraceId` / `ddSpanId` on
 * `ctx.tracing` — the **decimal** form of the hex IDs that the Datadog
 * Agent looks for in JSON logs (`dd.trace_id` / `dd.span_id`).
 */

import type { Interceptor, Envelope, Context } from '../types/index.js'
import type {
  Tracer,
  Span,
  SpanContext,
  TraceHeaders,
  SpanAttributes,
  Baggage,
} from './types.js'
import { applyHttpRouteToSpan } from './http.js'
import { hexTraceIdToDecimal, hexSpanIdToDecimal } from './decimal-id.js'
import { parseBaggageHeader } from './baggage.js'
import { filterSensitiveSpanAttributes } from './safe-attributes.js'
import { isAsyncIterable } from '../utils/type-guards.js'

export interface TracingInterceptorOptions {
  spanName?: string
  spanKind?: 'server' | 'internal'
  preferActiveParent?: boolean
}

function recordSpanFailure(span: Span, error: unknown): void {
  if (error instanceof Error) {
    span.recordError(error)
  } else {
    span.setStatus('error', String(error))
  }
}

async function* traceAsyncIterable(
  tracer: Tracer,
  span: Span,
  baggage: Baggage | undefined,
  iterable: AsyncIterable<unknown>
): AsyncIterable<unknown> {
  const iterator = iterable[Symbol.asyncIterator]()
  let iteratorDone = false
  let failed = false

  try {
    while (true) {
      const result = await tracer.runInSpanContext(span, baggage, () => iterator.next())
      if (result.done) {
        iteratorDone = true
        return
      }
      yield result.value
    }
  } catch (error) {
    failed = true
    recordSpanFailure(span, error)
    throw error
  } finally {
    try {
      if (!iteratorDone && iterator.return) {
        await tracer.runInSpanContext(span, baggage, () => iterator.return!())
      }
    } catch (error) {
      if (!failed) {
        failed = true
        recordSpanFailure(span, error)
        throw error
      }
    } finally {
      if (!failed) span.setStatus('ok')
      span.finish()
    }
  }
}

function preserveAsyncIterableCapabilities<T extends AsyncIterable<unknown>>(
  tracer: Tracer,
  span: Span,
  baggage: Baggage | undefined,
  iterable: T
): T {
  const tracedIterator = traceAsyncIterable(
    tracer,
    span,
    baggage,
    iterable
  )[Symbol.asyncIterator]()

  return new Proxy(iterable, {
    get(target, property) {
      if (property === Symbol.asyncIterator) {
        return () => tracedIterator
      }

      if (property === 'next' && typeof Reflect.get(target, property) === 'function') {
        return tracedIterator.next.bind(tracedIterator)
      }
      if (property === 'return' && typeof Reflect.get(target, property) === 'function') {
        return tracedIterator.return?.bind(tracedIterator)
      }
      if (property === 'throw' && typeof Reflect.get(target, property) === 'function') {
        return tracedIterator.throw?.bind(tracedIterator)
      }

      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

async function runWithSpan<T>(
  tracer: Tracer,
  span: Span,
  baggage: Baggage | undefined,
  operation: () => Promise<T> | T
): Promise<T> {
  try {
    const result = await tracer.runInSpanContext(span, baggage, operation)
    if (isAsyncIterable(result)) {
      return preserveAsyncIterableCapabilities(tracer, span, baggage, result) as T
    }

    span.setStatus('ok')
    span.finish()
    return result
  } catch (error) {
    recordSpanFailure(span, error)
    span.finish()
    throw error
  }
}

function createTraceOperation(tracer: Tracer) {
  return async <T>(
    name: string,
    attributes: SpanAttributes,
    operation: () => Promise<T> | T
  ): Promise<T> => {
    const parent = tracer.getActiveSpan()
    const span = tracer.startSpan(name, {
      kind: 'internal',
      parent: parent?.context,
      attributes: filterSensitiveSpanAttributes(attributes),
    })

    return runWithSpan(tracer, span, tracer.getBaggage(), operation)
  }
}

function createTraceEvent(tracer: Tracer) {
  return (name: string, attributes: SpanAttributes = {}): void => {
    tracer.getActiveSpan()?.log(name, filterSensitiveSpanAttributes(attributes))
  }
}

/**
 * Create an interceptor that automatically traces requests
 */
export function createTracingInterceptor(
  tracer: Tracer,
  options: TracingInterceptorOptions = {}
): Interceptor {
  return async (envelope: Envelope, ctx: Context, next) => {
    const procedure = envelope.procedure ?? 'unknown'

    // Extract parent context from envelope metadata (if propagated)
    let parentContext: SpanContext | undefined
    const metadata = envelope.metadata as Record<string, unknown> | undefined

    const extractedParent = metadata?.traceparent
      ? tracer.extractContext({
        traceparent: metadata.traceparent as string,
        tracestate: metadata.tracestate as string | undefined,
      })
      : undefined
    const activeParent = tracer.getActiveSpan()?.context
    parentContext = options.preferActiveParent
      ? activeParent ?? extractedParent
      : extractedParent ?? activeParent

    // Incoming baggage (business context, not trace identity) travels the
    // same path as traceparent/tracestate — see extractMetadataFromHeaders.
    // Always a (possibly empty) object, never undefined, so a handler can
    // add a member (`ctx.tracing.baggage.tenantId = ...`) without a null
    // check first.
    const incomingBaggage: Baggage = metadata?.baggage
      ? parseBaggageHeader(metadata.baggage as string)
      : {}

    // Resolve HTTP-style span name + attributes when the transport set
    // `ctx.http`. We read defensively because the core `Context` interface
    // uses `http?: HttpContextCapability` and the value may be missing or
    // partially populated for non-HTTP protocols.
    const http = ctx.http
    const httpMethod = http?.method
    const httpRoute = http?.route
    const httpPath = http?.path

    const isHttp = Boolean(httpMethod && (httpRoute || httpPath))
    const spanName = isHttp
      ? `${httpMethod} ${httpRoute ?? httpPath}`
      : procedure

    // Build attributes — keep the legacy `rpc.method` / `rpc.system`
    // alongside the OTel HTTP ones so existing dashboards / alerts that
    // query the old keys keep working.
    const attributes: SpanAttributes = {
      'rpc.method': procedure,
      'rpc.system': 'raffel',
      'raffel.procedure': procedure,
    }
    if (isHttp && httpMethod) {
      attributes['http.request.method'] = httpMethod
      if (httpRoute) {
        attributes['http.route'] = httpRoute
      }
      if (httpPath && !options.spanName) {
        attributes['url.path'] = httpPath
      }
    }

    // Start span with parent context
    const span = tracer.startSpan(options.spanName ?? spanName, {
      kind: options.spanKind ?? 'server',
      parent: parentContext,
      attributes: filterSensitiveSpanAttributes(attributes),
    })

    // Stash tracing context on `ctx` so downstream interceptors (logging,
    // metrics) and handlers can correlate. `ddTraceId` / `ddSpanId` are the
    // decimal 64-bit form expected by the Datadog Agent's log correlator.
    // `baggage` is exposed read/write so a handler can add a member (e.g.
    // `ctx.tracing.baggage.tenantId = ...`) before calling a downstream
    // service — tracedFetch picks up whatever is active on the tracer at
    // call time, not a frozen copy.
    ctx.tracing = {
      traceId: span.context.traceId,
      spanId: span.context.spanId,
      parentSpanId: parentContext?.spanId,
      ddTraceId: hexTraceIdToDecimal(span.context.traceId),
      ddSpanId: hexSpanIdToDecimal(span.context.spanId),
      baggage: incomingBaggage,
      trace: createTraceOperation(tracer),
      event: createTraceEvent(tracer),
    }
    if (ctx.logger?.child) {
      ctx.logger = ctx.logger.child({
        trace_id: span.context.traceId,
        span_id: span.context.spanId,
      })
    }

    if (ctx.http) {
      const method = ctx.http.method.toUpperCase()
      const route = ctx.http.route ?? ctx.http.path
      const httpAttributes: SpanAttributes = {
        'http.request.method': method,
        'http.route': route,
      }
      if (!options.spanName) {
        httpAttributes['url.path'] = ctx.http.path
      }
      span.setAttributes(filterSensitiveSpanAttributes(httpAttributes))
      if (!options.spanName) {
        applyHttpRouteToSpan(span, method, {
          route,
          procedure,
        })
      }
    }

    // Run `next()` — and everything it awaits — with this span/baggage as
    // active, correctly restoring the caller's previous span/baggage
    // afterward regardless of how many awaits happen in between (see
    // `runInSpanContext`'s docs for why a manual enterWith+restore pair
    // doesn't do this reliably).
    return runWithSpan(tracer, span, incomingBaggage, next)
  }
}

/**
 * Extract trace headers from incoming request
 */
export function extractTraceHeaders(
  headers: Record<string, string | string[] | undefined>
): TraceHeaders {
  const traceparent = Array.isArray(headers.traceparent)
    ? headers.traceparent[0]
    : headers.traceparent
  const tracestate = Array.isArray(headers.tracestate)
    ? headers.tracestate[0]
    : headers.tracestate

  return {
    traceparent,
    tracestate,
  }
}

/**
 * Inject trace headers for outgoing requests
 */
export function injectTraceHeaders(
  tracer: Tracer,
  headers: Record<string, string>
): Record<string, string> {
  const activeSpan = tracer.getActiveSpan()
  if (!activeSpan) return headers

  const traceHeaders = tracer.injectContext(activeSpan.context)

  return {
    ...headers,
    ...(traceHeaders.traceparent && { traceparent: traceHeaders.traceparent }),
    ...(traceHeaders.tracestate && { tracestate: traceHeaders.tracestate }),
  }
}
