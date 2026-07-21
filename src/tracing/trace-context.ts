import type { SpanContext, TraceHeaders } from './types.js'

/** Parse the W3C traceparent/tracestate headers used by Raffel tracers. */
export function parseW3CTraceContext(headers: TraceHeaders): SpanContext | undefined {
  const parts = headers.traceparent?.split('-')
  if (!parts || parts.length !== 4) return undefined

  const [version, traceId, spanId, flags] = parts
  if (version !== '00' || traceId.length !== 32 || spanId.length !== 16) {
    return undefined
  }

  return {
    traceId,
    spanId,
    traceFlags: Number.parseInt(flags, 16),
    traceState: headers.tracestate,
    isRemote: true,
  }
}

/** Format a Raffel span context as W3C traceparent/tracestate headers. */
export function formatW3CTraceContext(context: SpanContext): TraceHeaders {
  const flags = context.traceFlags.toString(16).padStart(2, '0')
  return {
    traceparent: `00-${context.traceId}-${context.spanId}-${flags}`,
    tracestate: context.traceState,
  }
}
