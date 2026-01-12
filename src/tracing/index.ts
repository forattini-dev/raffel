/**
 * Distributed Tracing Module
 *
 * OpenTelemetry-compatible tracing with spans, sampling, and exporters.
 *
 * @example
 * ```typescript
 * import {
 *   createTracer,
 *   createConsoleExporter,
 *   createJaegerExporter,
 * } from 'raffel'
 *
 * const tracer = createTracer({
 *   serviceName: 'my-service',
 *   sampleRate: 1.0,
 *   exporters: [createConsoleExporter()],
 * })
 *
 * // Manual span creation
 * const span = tracer.startSpan('operation')
 * span.setAttribute('key', 'value')
 * // ... do work ...
 * span.finish()
 *
 * // Server integration
 * const server = createServer({ port: 3000 })
 *   .enableTracing({
 *     serviceName: 'my-service',
 *     sampleRate: 0.1,
 *     exporters: [createJaegerExporter({ serviceName: 'my-service' })],
 *   })
 * ```
 */

// Types
export type {
  SpanKind,
  SpanStatusCode,
  SpanAttributes,
  SpanLogEntry,
  SpanStatus,
  SpanContext,
  TraceHeaders,
  SpanData,
  Span,
  SpanExporter,
  SamplingResult,
  Sampler,
  StartSpanOptions,
  Tracer,
  TracingConfig,
} from './types.js'

export { SAMPLING_STRATEGIES } from './types.js'

// Span
export { createSpan, generateTraceId, generateSpanId } from './span.js'

// Samplers
export {
  createAlwaysOnSampler,
  createAlwaysOffSampler,
  createProbabilitySampler,
  createRateLimitedSampler,
  createParentBasedSampler,
  createCompositeSampler,
} from './sampler.js'

// Tracer
export { createTracer } from './tracer.js'

// Exporters
export {
  createConsoleExporter,
  createJaegerExporter,
  createZipkinExporter,
  createNoopExporter,
} from './exporters.js'
export type { JaegerExporterOptions, ZipkinExporterOptions } from './exporters.js'

// Interceptor
export {
  createTracingInterceptor,
  extractTraceHeaders,
  injectTraceHeaders,
} from './interceptor.js'
