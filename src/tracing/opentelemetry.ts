/**
 * Adapter from Raffel's tracing surface to the process-wide OpenTelemetry API.
 *
 * The application/platform owns the global provider, context manager,
 * processors, exporters, flushing, and shutdown. Raffel only creates child
 * spans through the API so it composes with auto-instrumentation such as
 * Datadog Single-Step Instrumentation.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import {
  context as otelContext,
  createTraceState,
  SpanKind as OtelSpanKind,
  trace as otelTrace,
  type Context as OtelContext,
  type Span as OtelSpan,
} from '@opentelemetry/api'
import type {
  Baggage,
  Span,
  SpanAttributes,
  SpanContext,
  SpanKind,
  StartSpanOptions,
  Tracer,
} from './types.js'
import { createOpenTelemetrySpanAdapter } from './opentelemetry-span.js'
import { formatW3CTraceContext, parseW3CTraceContext } from './trace-context.js'

const OTEL_SPAN_KIND: Record<SpanKind, OtelSpanKind> = {
  internal: OtelSpanKind.INTERNAL,
  server: OtelSpanKind.SERVER,
  client: OtelSpanKind.CLIENT,
  producer: OtelSpanKind.PRODUCER,
  consumer: OtelSpanKind.CONSUMER,
}

export interface GlobalOpenTelemetryTracerOptions {
  /** OpenTelemetry instrumentation scope name (default: `raffel`). */
  instrumentationName?: string
  /** Optional instrumentation scope version. */
  instrumentationVersion?: string
}

/**
 * Use the OpenTelemetry tracer provider already registered by the host.
 * This function never installs a provider or exporter and never shuts the
 * host provider down.
 */
export function createGlobalOpenTelemetryTracer(
  options: GlobalOpenTelemetryTracerOptions = {}
): Tracer {
  const otelTracer = otelTrace.getTracer(
    options.instrumentationName ?? 'raffel',
    options.instrumentationVersion
  )
  const nativeBySpan = new WeakMap<Span, OtelSpan>()
  const spanByNative = new WeakMap<OtelSpan, Span>()
  const activeSpanStorage = new AsyncLocalStorage<Span | undefined>()
  const baggageStorage = new AsyncLocalStorage<Baggage | undefined>()

  function wrapSpan(
    nativeSpan: OtelSpan,
    name: string,
    kind: SpanKind,
    parentSpanId?: string,
    initialAttributes: SpanAttributes = {}
  ): Span {
    const existing = spanByNative.get(nativeSpan)
    if (existing) return existing

    const span = createOpenTelemetrySpanAdapter(nativeSpan, {
      name,
      kind,
      parentSpanId,
      attributes: initialAttributes,
    })

    nativeBySpan.set(span, nativeSpan)
    spanByNative.set(nativeSpan, span)
    return span
  }

  function parentOtelContext(parent?: SpanContext): OtelContext {
    if (parent) {
      return otelTrace.setSpanContext(otelContext.active(), {
        traceId: parent.traceId,
        spanId: parent.spanId,
        traceFlags: parent.traceFlags,
        traceState: parent.traceState ? createTraceState(parent.traceState) : undefined,
        isRemote: parent.isRemote ?? false,
      })
    }

    const manuallyActive = activeSpanStorage.getStore()
    const nativeActive = manuallyActive && nativeBySpan.get(manuallyActive)
    return nativeActive
      ? otelTrace.setSpan(otelContext.active(), nativeActive)
      : otelContext.active()
  }

  const tracer: Tracer = {
    startSpan(name, options: StartSpanOptions = {}) {
      const kind = options.kind ?? 'internal'
      const nativeSpan = otelTracer.startSpan(
        name,
        {
          kind: OTEL_SPAN_KIND[kind],
          attributes: options.attributes,
        },
        parentOtelContext(options.parent)
      )
      return wrapSpan(
        nativeSpan,
        name,
        kind,
        options.parent?.spanId,
        options.attributes
      )
    },

    getActiveSpan() {
      const nativeSpan = otelTrace.getSpan(otelContext.active())
      if (nativeSpan) {
        return wrapSpan(nativeSpan, 'external.active', 'internal')
      }
      return activeSpanStorage.getStore()
    },

    setActiveSpan(span) {
      activeSpanStorage.enterWith(span)
    },

    getBaggage() {
      return baggageStorage.getStore()
    },

    setBaggage(baggage) {
      baggageStorage.enterWith(baggage)
    },

    runInSpanContext(span, baggage, fn) {
      const nativeSpan = span && nativeBySpan.get(span)
      const context = nativeSpan
        ? otelTrace.setSpan(otelContext.active(), nativeSpan)
        : otelContext.active()

      return otelContext.with(context, () =>
        activeSpanStorage.run(span, () => baggageStorage.run(baggage, fn))
      )
    },

    startSpanFromContext(name, parentContext, options = {}) {
      return this.startSpan(name, { ...options, parent: parentContext })
    },

    extractContext(headers) {
      return parseW3CTraceContext(headers)
    },

    injectContext(context) {
      return formatW3CTraceContext(context)
    },

    async flush() {
      // The host provider owns processors/exporters and their flush lifecycle.
    },

    async shutdown() {
      // The host provider is process-global and must not be shut down by Raffel.
    },
  }

  return tracer
}
