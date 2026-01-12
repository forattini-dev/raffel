/**
 * Metrics System
 *
 * Prometheus-style metrics with counters, gauges, and histograms.
 */

export { createMetricRegistry } from './registry.js'
export {
  createMetricsInterceptor,
  registerWsMetrics,
  registerProcessMetrics,
  collectProcessMetrics,
  startProcessMetricsCollection,
} from './interceptor.js'
export { exportPrometheus, exportJson } from './exporters.js'

export type {
  MetricType,
  Labels,
  MetricOptions,
  MetricsConfig,
  MetricValue,
  HistogramBucket,
  HistogramValue,
  MetricDefinition,
  MetricRegistry,
  ExportFormat,
} from './types.js'

export { DEFAULT_HISTOGRAM_BUCKETS, AUTO_METRICS } from './types.js'
