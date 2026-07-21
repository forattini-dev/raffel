import {
  SpanStatusCode as OtelSpanStatusCode,
  type Attributes as OtelAttributes,
  type Span as OtelSpan,
} from '@opentelemetry/api'
import { createSpan } from './span.js'
import type {
  Span,
  SpanAttributes,
  SpanContext,
  SpanKind,
  SpanStatusCode,
} from './types.js'

const OTEL_STATUS: Record<SpanStatusCode, OtelSpanStatusCode> = {
  unset: OtelSpanStatusCode.UNSET,
  ok: OtelSpanStatusCode.OK,
  error: OtelSpanStatusCode.ERROR,
}

function asOtelAttributes(attributes: Record<string, unknown>): OtelAttributes {
  const result: OtelAttributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    }
  }
  return result
}

export interface OpenTelemetrySpanAdapterOptions {
  name: string
  kind: SpanKind
  parentSpanId?: string
  attributes?: SpanAttributes
}

/** Adapt a native OTel span while reusing Raffel's span state bookkeeping. */
export function createOpenTelemetrySpanAdapter(
  nativeSpan: OtelSpan,
  options: OpenTelemetrySpanAdapterOptions
): Span {
  const nativeContext = (): SpanContext => {
    const context = nativeSpan.spanContext()
    return {
      traceId: context.traceId,
      spanId: context.spanId,
      traceFlags: context.traceFlags,
      traceState: context.traceState?.serialize(),
      isRemote: context.isRemote,
    }
  }
  const context = nativeContext()
  const state = createSpan({
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: options.parentSpanId,
    name: options.name,
    kind: options.kind,
    isRecording: nativeSpan.isRecording(),
    attributes: options.attributes,
  })
  let finished = false

  const span: Span = {
    get context() {
      return nativeContext()
    },

    get name() {
      return state.name
    },

    get isRecording() {
      return !finished && nativeSpan.isRecording()
    },

    setAttribute(key, value) {
      state.setAttribute(key, value)
      nativeSpan.setAttribute(key, value)
      return this
    },

    setAttributes(attributes) {
      state.setAttributes(attributes)
      nativeSpan.setAttributes(attributes)
      return this
    },

    log(message, fields) {
      state.log(message, fields)
      nativeSpan.addEvent(message, asOtelAttributes(fields ?? {}))
      return this
    },

    setStatus(code, message) {
      state.setStatus(code, message)
      nativeSpan.setStatus({ code: OTEL_STATUS[code], message })
      return this
    },

    recordError(error) {
      state.recordError(error)
      nativeSpan.recordException(error)
      nativeSpan.setStatus({ code: OtelSpanStatusCode.ERROR, message: error.message })
      return this
    },

    updateName(name) {
      state.updateName(name)
      nativeSpan.updateName(name)
      return this
    },

    finish() {
      if (finished) return
      finished = true
      state.finish()
      nativeSpan.end()
    },

    toSpanData() {
      const data = state.toSpanData()
      const currentContext = nativeContext()
      return {
        ...data,
        traceId: currentContext.traceId,
        spanId: currentContext.spanId,
        context: currentContext,
      }
    },
  }

  return span
}
