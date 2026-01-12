/**
 * Distributed Tracing Types
 *
 * OpenTelemetry-compatible tracing with spans, sampling, and exporters.
 */

/**
 * Span kind indicates the role of the span in the trace
 */
export type SpanKind = 'client' | 'server' | 'producer' | 'consumer' | 'internal'

/**
 * Span status code
 */
export type SpanStatusCode = 'unset' | 'ok' | 'error'

/**
 * Span attributes (tags)
 */
export type SpanAttributes = Record<string, string | number | boolean>

/**
 * Span log entry
 */
export interface SpanLogEntry {
  timestamp: number
  message: string
  fields?: Record<string, unknown>
}

/**
 * Span status
 */
export interface SpanStatus {
  code: SpanStatusCode
  message?: string
}

/**
 * Span context for propagation
 */
export interface SpanContext {
  traceId: string
  spanId: string
  traceFlags: number // 1 = sampled
  traceState?: string
}

/**
 * W3C Trace Context headers
 */
export interface TraceHeaders {
  traceparent?: string
  tracestate?: string
}

/**
 * Completed span data for export
 */
export interface SpanData {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: SpanKind
  startTime: number // microseconds since epoch
  endTime: number
  duration: number // microseconds
  status: SpanStatus
  attributes: SpanAttributes
  logs: SpanLogEntry[]
  context: SpanContext
}

/**
 * Span interface for in-flight spans
 */
export interface Span {
  /** Span context for propagation */
  readonly context: SpanContext

  /** Span name */
  readonly name: string

  /** Whether this span is recording (sampled) */
  readonly isRecording: boolean

  /** Set a single attribute */
  setAttribute(key: string, value: string | number | boolean): this

  /** Set multiple attributes */
  setAttributes(attributes: SpanAttributes): this

  /** Add a log entry */
  log(message: string, fields?: Record<string, unknown>): this

  /** Set span status */
  setStatus(code: SpanStatusCode, message?: string): this

  /** Record an error */
  recordError(error: Error): this

  /** Update span name */
  updateName(name: string): this

  /** Finish the span */
  finish(): void

  /** Get span data (for export) */
  toSpanData(): SpanData
}

/**
 * Span exporter interface
 */
export interface SpanExporter {
  /** Export a batch of spans */
  export(spans: SpanData[]): Promise<void>

  /** Shutdown the exporter */
  shutdown(): Promise<void>
}

/**
 * Sampler decision
 */
export interface SamplingResult {
  decision: 'record_and_sample' | 'record_only' | 'drop'
  traceState?: string
}

/**
 * Sampler interface
 */
export interface Sampler {
  shouldSample(
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    parentContext?: SpanContext
  ): SamplingResult
}

/**
 * Options for starting a span
 */
export interface StartSpanOptions {
  kind?: SpanKind
  attributes?: SpanAttributes
  parent?: SpanContext
}

/**
 * Tracer interface
 */
export interface Tracer {
  /** Start a new span */
  startSpan(name: string, options?: StartSpanOptions): Span

  /** Get active span (if any) */
  getActiveSpan(): Span | undefined

  /** Set active span */
  setActiveSpan(span: Span | undefined): void

  /** Create a child span from parent context */
  startSpanFromContext(
    name: string,
    parentContext: SpanContext,
    options?: Omit<StartSpanOptions, 'parent'>
  ): Span

  /** Parse trace headers for propagation */
  extractContext(headers: TraceHeaders): SpanContext | undefined

  /** Create trace headers from span context */
  injectContext(context: SpanContext): TraceHeaders

  /** Flush pending spans */
  flush(): Promise<void>

  /** Shutdown tracer */
  shutdown(): Promise<void>
}

/**
 * Tracing configuration
 */
export interface TracingConfig {
  /** Enable tracing (default: false) */
  enabled?: boolean

  /** Service name for spans */
  serviceName?: string

  /** Sampling rate 0.0 to 1.0 (default: 1.0 = sample all) */
  sampleRate?: number

  /** Rate limit in spans per second (0 = no limit) */
  rateLimit?: number

  /** Exporters to use */
  exporters?: SpanExporter[]

  /** Batch size for export (default: 100) */
  batchSize?: number

  /** Batch timeout in ms (default: 5000) */
  batchTimeout?: number

  /** Default attributes for all spans */
  defaultAttributes?: SpanAttributes
}

/**
 * Pre-configured sampling strategies
 */
export const SAMPLING_STRATEGIES = {
  ALWAYS_ON: 1.0,
  ALWAYS_OFF: 0.0,
  HALF: 0.5,
  TEN_PERCENT: 0.1,
  ONE_PERCENT: 0.01,
} as const
