/**
 * Metrics System Types
 *
 * Prometheus-style metrics with counters, gauges, and histograms.
 */

/** Metric types supported */
export type MetricType = 'counter' | 'gauge' | 'histogram'

/** Label key-value pairs */
export type Labels = Record<string, string>

/** Options for registering a metric */
export interface MetricOptions {
  /** Human-readable description (used in HELP line) */
  description?: string
  /** Label keys this metric supports */
  labels?: string[]
  /** Bucket boundaries for histograms (default: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) */
  buckets?: number[]
}

/** Configuration for enabling metrics on server */
export interface MetricsConfig {
  /** Enable/disable metrics (default: true when enableMetrics is called) */
  enabled?: boolean
  /** HTTP endpoint path for Prometheus scraping (default: '/metrics') */
  endpoint?: string
  /** Default labels added to all metrics */
  defaultLabels?: Labels
  /** Auto-collect request metrics (default: true) */
  collectRequestMetrics?: boolean
  /** Auto-collect process metrics - CPU, memory, event loop (default: false) */
  collectProcessMetrics?: boolean
}

/** Internal metric value storage */
export interface MetricValue {
  value: number
  labels: Labels
  timestamp?: number
}

/** Histogram bucket with cumulative count */
export interface HistogramBucket {
  le: number // upper bound
  count: number
}

/** Histogram value with buckets, sum, and count */
export interface HistogramValue {
  labels: Labels
  buckets: HistogramBucket[]
  sum: number
  count: number
}

/** Registered metric definition */
export interface MetricDefinition {
  name: string
  type: MetricType
  description: string
  labelKeys: string[]
  /** For histogram: bucket boundaries */
  buckets?: number[]
  /** Counter/gauge values by label key string */
  values: Map<string, MetricValue>
  /** Histogram values by label key string */
  histogramValues?: Map<string, HistogramValue>
}

/** Metric Registry API */
export interface MetricRegistry {
  // Registration
  /** Register a counter metric */
  counter(name: string, opts?: MetricOptions): void
  /** Register a gauge metric */
  gauge(name: string, opts?: MetricOptions): void
  /** Register a histogram metric */
  histogram(name: string, opts?: MetricOptions): void

  // Operations
  /** Increment a counter (default delta: 1) */
  increment(name: string, labels?: Labels, delta?: number): void
  /** Set a gauge value */
  set(name: string, value: number, labels?: Labels): void
  /** Record an observation in a histogram */
  observe(name: string, value: number, labels?: Labels): void
  /** Start a timer, returns function to stop and record duration */
  timer(name: string, labels?: Labels): () => number

  // Export
  /** Export all metrics in the specified format */
  export(format: 'prometheus' | 'json'): string

  // Utility
  /** Get a metric definition by name */
  getMetric(name: string): MetricDefinition | undefined
  /** List all registered metric names */
  getMetricNames(): string[]
  /** Reset all metric values (for testing) */
  reset(): void
  /** Get default labels */
  getDefaultLabels(): Labels
  /** Set default labels */
  setDefaultLabels(labels: Labels): void
}

/** Export format options */
export type ExportFormat = 'prometheus' | 'json'

/** Default histogram buckets (Prometheus defaults for seconds) */
export const DEFAULT_HISTOGRAM_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
]

/** Auto-collected metric names */
export const AUTO_METRICS = {
  REQUESTS_TOTAL: 'raffel_requests_total',
  REQUEST_DURATION: 'raffel_request_duration_seconds',
  REQUEST_ERRORS: 'raffel_request_errors_total',
  WS_CONNECTIONS: 'raffel_ws_connections_active',
  WS_MESSAGES: 'raffel_ws_messages_total',
  PROCESS_CPU: 'process_cpu_seconds_total',
  PROCESS_MEMORY: 'process_resident_memory_bytes',
  EVENTLOOP_LAG: 'nodejs_eventloop_lag_seconds',
} as const
