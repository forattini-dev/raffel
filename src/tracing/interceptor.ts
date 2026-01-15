/**
 * Tracing Interceptor
 *
 * Automatically creates spans for incoming requests.
 */

import type { Interceptor, Envelope, Context } from '../types/index.js'
import type { Tracer, SpanContext, TraceHeaders } from './types.js'

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

    // Start span with parent context
    const span = tracer.startSpan(`${procedure}`, {
      kind: 'server',
      parent: parentContext,
      attributes: {
        'rpc.method': procedure,
        'rpc.system': 'raffel',
      },
    })

    // Set as active span
    const previousSpan = tracer.getActiveSpan()
    tracer.setActiveSpan(span)

    ctx.tracing = {
      traceId: span.context.traceId,
      spanId: span.context.spanId,
      parentSpanId: parentContext?.spanId,
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
