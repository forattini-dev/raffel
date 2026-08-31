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
  isRemote?: boolean
}

/**
 * W3C Trace Context headers
 */
export interface TraceHeaders {
  traceparent?: string
  tracestate?: string
}

/**
 * W3C Baggage — arbitrary cross-cutting key/value context (tenant id, user
 * id, feature flags, ...) propagated alongside the trace. See
 * `./baggage.ts` for the header parsing/serialization.
 */
export type Baggage = Record<string, string>

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

  /** Get the active baggage for the current async context (if any) */
  getBaggage(): Baggage | undefined

  /** Set the active baggage for the current async context */
  setBaggage(baggage: Baggage | undefined): void

  /**
   * Run `fn` with `span` and `baggage` as the active span/baggage for the
   * duration of `fn` — including everything `fn` awaits — automatically
   * restoring whatever was active before once `fn` settles.
   *
   * Prefer this over pairing `setActiveSpan`/`setBaggage` with a manual
   * restore in a `finally` block: `AsyncLocalStorage.enterWith()` mutates a
   * shared ambient context rather than one scoped to the call, so a manual
   * restore after `await someAsyncWork()` does not reliably unwind —
   * concurrent/nested async work in between can leave the wrong span or
   * baggage active. `run()` scopes correctly across any number of awaits.
   */
  runInSpanContext<T>(
    span: Span | undefined,
    baggage: Baggage | undefined,
    fn: () => T | Promise<T>
  ): T | Promise<T>

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

  /**
   * Use the OpenTelemetry provider already registered by the host platform.
   * Raffel will create internal child spans and will not install, flush, or
   * shut down that provider.
   */
  useGlobalOpenTelemetry?: boolean

  /**
   * Rename the platform-owned (borrowed) HTTP server span to the
   * low-cardinality route form ("GET /items/:id") once the route resolves.
   * Only meaningful with useGlobalOpenTelemetry — spans Raffel creates are
   * always named by route. Enable when the platform instrumentation
   * (Datadog SSI, OTel http auto-instrumentation) names its server span
   * generically and expects the framework to apply the route. Default: false
   * (the borrowed span keeps its name; route lands in http.route).
   */
  renameBorrowedSpans?: boolean
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
