/**
 * Tracer Implementation
 *
 * Central tracing coordinator with span creation, sampling, and export.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type {
  Tracer,
  TracingConfig,
  Span,
  SpanContext,
  SpanData,
  StartSpanOptions,
  TraceHeaders,
  Baggage,
  Sampler,
} from './types.js'
import { createSpan, generateTraceId, generateSpanId } from './span.js'
import { createCompositeSampler, createParentBasedSampler } from './sampler.js'
import { formatW3CTraceContext, parseW3CTraceContext } from './trace-context.js'

/**
 * Create a new Tracer instance
 */
export function createTracer(config: TracingConfig = {}): Tracer {
  const {
    serviceName = 'unknown',
    sampleRate = 1.0,
    rateLimit = 0,
    exporters = [],
    batchSize = 100,
    batchTimeout = 5000,
    defaultAttributes = {},
  } = config

  // Create sampler based on config
  const baseSampler = createCompositeSampler(sampleRate, rateLimit)
  const sampler: Sampler = createParentBasedSampler(baseSampler)

  // Pending spans for batch export
  const pendingSpans: SpanData[] = []
  let batchTimer: ReturnType<typeof setTimeout> | null = null

  // Async-context-safe active span storage. Stores `Span | undefined` so
  // "no active span" can be represented within the current async context via
  // `enterWith(undefined)`. Deliberately not `disable()`: per Node's docs
  // that call is meant to retire the storage instance for good ("use this
  // method when the asyncLocalStorage is not in use anymore in the current
  // process"), not to clear one request's span between requests — relying on
  // it for routine per-request cleanup depends on unspecified behavior.
  const asyncSpanStorage = new AsyncLocalStorage<Span | undefined>()

  // Separate storage for baggage. Kept independent from the span storage
  // rather than bundled into one context object because span and baggage
  // have different lifetimes in practice (e.g. a span can be replaced by a
  // child span mid-request while baggage usually stays constant) — as long
  // as every call site that enters a new span context also enters baggage
  // (see createTracingInterceptor / createHttpTracingMiddleware), the two
  // stay in sync per request.
  const asyncBaggageStorage = new AsyncLocalStorage<Baggage | undefined>()

  /**
   * Schedule batch export
   */
  function scheduleBatchExport(): void {
    if (batchTimer || exporters.length === 0) return

    batchTimer = setTimeout(async () => {
      batchTimer = null
      await flushInternal()
    }, batchTimeout)
    batchTimer.unref()
  }

  /**
   * Internal flush implementation
   */
  async function flushInternal(): Promise<void> {
    if (pendingSpans.length === 0 || exporters.length === 0) return

    const spansToExport = pendingSpans.splice(0, pendingSpans.length)

    await Promise.all(
      exporters.map(async (exporter) => {
        try {
          await exporter.export(spansToExport)
        } catch {
          // Silently fail - tracing should not break the app
        }
      })
    )
  }

  /**
   * Record a finished span
   */
  function recordSpan(span: Span): void {
    const data = span.toSpanData()

    // Only export spans that were sampled (traceFlags bit 0 = sampled)
    const wasSampled = (data.context.traceFlags & 1) === 1

    if (wasSampled && data.endTime > 0) {
      pendingSpans.push(data)

      if (pendingSpans.length >= batchSize) {
        void flushInternal()
      } else {
        scheduleBatchExport()
      }
    }
  }

  const tracer: Tracer = {
    startSpan(name, options: StartSpanOptions = {}) {
      const parentContext = options.parent
      const traceId = parentContext?.traceId ?? generateTraceId()
      const spanId = generateSpanId()
      const parentSpanId = parentContext?.spanId

      // Check sampling
      const samplingResult = sampler.shouldSample(
        traceId,
        name,
        options.kind ?? 'internal',
        parentContext
      )
      const isRecording = samplingResult.decision === 'record_and_sample'

      // Merge default attributes with span-specific attributes
      const attributes = {
        'service.name': serviceName,
        ...defaultAttributes,
        ...options.attributes,
      }

      const span = createSpan({
        traceId,
        spanId,
        parentSpanId,
        name,
        kind: options.kind ?? 'internal',
        isRecording,
        attributes,
      })

      // Wrap finish to record span
      const originalFinish = span.finish.bind(span)
      span.finish = () => {
        originalFinish()
        recordSpan(span)
      }

      return span
    },

    startSpanFromContext(name, parentContext, options = {}) {
      return this.startSpan(name, { ...options, parent: parentContext })
    },

    getActiveSpan() {
      return asyncSpanStorage.getStore()
    },

    setActiveSpan(span) {
      // `enterWith` only transitions the *current* async execution context —
      // unlike `disable()`, it never touches other concurrent contexts
      // sharing this tracer, so this is safe to call from every in-flight
      // request without cross-request interference.
      asyncSpanStorage.enterWith(span)
    },

    getBaggage() {
      return asyncBaggageStorage.getStore()
    },

    setBaggage(baggage) {
      asyncBaggageStorage.enterWith(baggage)
    },

    runInSpanContext(span, baggage, fn) {
      // Nesting two `.run()` calls (rather than a single ALS holding a
      // `{span, baggage}` tuple) keeps `getActiveSpan()`/`getBaggage()`
      // reads independent and matches how the rest of this module already
      // treats them as separate concerns.
      return asyncSpanStorage.run(span, () => asyncBaggageStorage.run(baggage, fn))
    },

    extractContext(headers: TraceHeaders): SpanContext | undefined {
      return parseW3CTraceContext(headers)
    },

    injectContext(context: SpanContext): TraceHeaders {
      return formatW3CTraceContext(context)
    },

    async flush() {
      if (batchTimer) {
        clearTimeout(batchTimer)
        batchTimer = null
      }
      await flushInternal()
    },

    async shutdown() {
      await this.flush()
      await Promise.all(exporters.map((e) => e.shutdown()))
    },
  }

  return tracer
}
