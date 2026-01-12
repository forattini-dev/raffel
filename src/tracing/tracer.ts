/**
 * Tracer Implementation
 *
 * Central tracing coordinator with span creation, sampling, and export.
 */

import type {
  Tracer,
  TracingConfig,
  Span,
  SpanContext,
  SpanData,
  StartSpanOptions,
  TraceHeaders,
  Sampler,
} from './types.js'
import { createSpan, generateTraceId, generateSpanId } from './span.js'
import { createCompositeSampler, createParentBasedSampler } from './sampler.js'

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
  let activeSpan: Span | undefined

  /**
   * Schedule batch export
   */
  function scheduleBatchExport(): void {
    if (batchTimer || exporters.length === 0) return

    batchTimer = setTimeout(async () => {
      batchTimer = null
      await flushInternal()
    }, batchTimeout)
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
      return activeSpan
    },

    setActiveSpan(span) {
      activeSpan = span
    },

    extractContext(headers: TraceHeaders): SpanContext | undefined {
      const traceparent = headers.traceparent
      if (!traceparent) return undefined

      // W3C Trace Context format: 00-traceId-spanId-flags
      // Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
      const parts = traceparent.split('-')
      if (parts.length !== 4) return undefined

      const [version, traceId, spanId, flags] = parts

      if (version !== '00') return undefined
      if (traceId.length !== 32) return undefined
      if (spanId.length !== 16) return undefined

      return {
        traceId,
        spanId,
        traceFlags: parseInt(flags, 16),
        traceState: headers.tracestate,
      }
    },

    injectContext(context: SpanContext): TraceHeaders {
      const flags = context.traceFlags.toString(16).padStart(2, '0')
      return {
        traceparent: `00-${context.traceId}-${context.spanId}-${flags}`,
        tracestate: context.traceState,
      }
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
