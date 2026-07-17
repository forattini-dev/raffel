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
import type { Tracer, SpanContext, TraceHeaders, SpanAttributes } from './types.js'
import { applyHttpRouteToSpan } from './http.js'
import { hexTraceIdToDecimal, hexSpanIdToDecimal } from './decimal-id.js'

/**
 * Create an interceptor that automatically traces requests
 */
export function createTracingInterceptor(tracer: Tracer): Interceptor {
  return async (envelope: Envelope, ctx: Context, next) => {
    const procedure = envelope.procedure ?? 'unknown'

    // Extract parent context from envelope metadata (if propagated)
    let parentContext: SpanContext | undefined
    const metadata = envelope.metadata as Record<string, unknown> | undefined

    if (metadata?.traceparent) {
      parentContext = tracer.extractContext({
        traceparent: metadata.traceparent as string,
        tracestate: metadata.tracestate as string | undefined,
      })
    }

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
    }
    if (isHttp && httpMethod) {
      attributes['http.request.method'] = httpMethod
      if (httpRoute) {
        attributes['http.route'] = httpRoute
      }
      if (httpPath) {
        attributes['url.path'] = httpPath
      }
    }

    // Start span with parent context
    const span = tracer.startSpan(spanName, {
      kind: 'server',
      parent: parentContext,
      attributes,
    })

    // Set as active span
    const previousSpan = tracer.getActiveSpan()
    tracer.setActiveSpan(span)

    // Stash tracing context on `ctx` so downstream interceptors (logging,
    // metrics) and handlers can correlate. `ddTraceId` / `ddSpanId` are the
    // decimal 64-bit form expected by the Datadog Agent's log correlator.
    ctx.tracing = {
      traceId: span.context.traceId,
      spanId: span.context.spanId,
      parentSpanId: parentContext?.spanId,
      ddTraceId: hexTraceIdToDecimal(span.context.traceId),
      ddSpanId: hexSpanIdToDecimal(span.context.spanId),
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
      span.setAttributes({
        'http.request.method': method,
        'url.path': ctx.http.path,
        'http.route': route,
      })
      applyHttpRouteToSpan(span, method, {
        route,
        procedure,
      })
    }

    try {
      const result = await next()

      span.setStatus('ok')
      span.finish()

      return result
    } catch (error) {
      if (error instanceof Error) {
        span.recordError(error)
      } else {
        span.setStatus('error', String(error))
      }
      span.finish()
      throw error
    } finally {
      // Restore previous active span
      tracer.setActiveSpan(previousSpan)
    }
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
