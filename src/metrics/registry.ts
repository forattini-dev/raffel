/**
 * Metric Registry
 *
 * Central registry for all metrics with counter, gauge, and histogram support.
 */

import type {
  MetricRegistry,
  MetricOptions,
  MetricDefinition,
  HistogramValue,
  Labels,
  MetricType,
} from './types.js'
import { DEFAULT_HISTOGRAM_BUCKETS } from './types.js'
import { exportPrometheus, exportJson } from './exporters.js'

/**
 * Create a string key from labels for Map storage
 */
function labelsToKey(labels: Labels): string {
  const sortedKeys = Object.keys(labels).sort()
  if (sortedKeys.length === 0) return ''
  return sortedKeys.map((k) => `${k}="${labels[k]}"`).join(',')
}

/**
 * Merge default labels with provided labels
 */
function mergeLabels(defaults: Labels, provided: Labels = {}): Labels {
  return { ...defaults, ...provided }
}

/**
 * Validate that provided labels match the registered label keys.
 * Default labels are exempt from validation.
 */
function validateLabels(
  metricName: string,
  labelKeys: string[],
  provided: Labels,
  defaultLabels: Labels
): void {
  const providedKeys = Object.keys(provided)
  const defaultKeys = Object.keys(defaultLabels)

  // Check for extra labels not in definition (excluding default labels)
  for (const key of providedKeys) {
    // Default labels are always allowed
    if (defaultKeys.includes(key)) continue

    if (!labelKeys.includes(key)) {
      throw new Error(
        `Metric '${metricName}' does not have label '${key}'. ` +
          `Registered labels: [${labelKeys.join(', ')}]`
      )
    }
  }
}

/**
 * Create an empty histogram value
 */
function createHistogramValue(
  buckets: number[],
  labels: Labels
): HistogramValue {
  return {
    labels,
    buckets: buckets.map((le) => ({ le, count: 0 })),
    sum: 0,
    count: 0,
  }
}

/**
 * Create a new MetricRegistry instance
 */
export function createMetricRegistry(): MetricRegistry {
  const metrics = new Map<string, MetricDefinition>()
  let defaultLabels: Labels = {}

  function registerMetric(
    name: string,
    type: MetricType,
    opts: MetricOptions = {}
  ): void {
    if (metrics.has(name)) {
      throw new Error(`Metric '${name}' is already registered`)
    }

    const definition: MetricDefinition = {
      name,
      type,
      description: opts.description ?? '',
      labelKeys: opts.labels ?? [],
      values: new Map(),
    }

    if (type === 'histogram') {
      definition.buckets = opts.buckets ?? [...DEFAULT_HISTOGRAM_BUCKETS]
      definition.histogramValues = new Map()
    }

    metrics.set(name, definition)
  }

  function getMetricOrThrow(name: string, expectedType?: MetricType): MetricDefinition {
    const metric = metrics.get(name)
    if (!metric) {
      throw new Error(`Metric '${name}' is not registered`)
    }
    if (expectedType && metric.type !== expectedType) {
      throw new Error(
        `Metric '${name}' is a ${metric.type}, not a ${expectedType}`
      )
    }
    return metric
  }

  const registry: MetricRegistry = {
    counter(name, opts) {
      registerMetric(name, 'counter', opts)
    },

    gauge(name, opts) {
      registerMetric(name, 'gauge', opts)
    },

    histogram(name, opts) {
      registerMetric(name, 'histogram', opts)
    },

    increment(name, labels = {}, delta = 1) {
      const metric = getMetricOrThrow(name, 'counter')
      const mergedLabels = mergeLabels(defaultLabels, labels)
      validateLabels(name, metric.labelKeys, mergedLabels, defaultLabels)

      const key = labelsToKey(mergedLabels)
      const existing = metric.values.get(key)

      if (existing) {
        existing.value += delta
      } else {
        metric.values.set(key, {
          value: delta,
          labels: mergedLabels,
        })
      }
    },

    set(name, value, labels = {}) {
      const metric = getMetricOrThrow(name, 'gauge')
      const mergedLabels = mergeLabels(defaultLabels, labels)
      validateLabels(name, metric.labelKeys, mergedLabels, defaultLabels)

      const key = labelsToKey(mergedLabels)
      metric.values.set(key, {
        value,
        labels: mergedLabels,
      })
    },

    observe(name, value, labels = {}) {
      const metric = getMetricOrThrow(name, 'histogram')
      const mergedLabels = mergeLabels(defaultLabels, labels)
      validateLabels(name, metric.labelKeys, mergedLabels, defaultLabels)

      const key = labelsToKey(mergedLabels)
      let histValue = metric.histogramValues!.get(key)

      if (!histValue) {
        histValue = createHistogramValue(metric.buckets!, mergedLabels)
        metric.histogramValues!.set(key, histValue)
      }

      // Update sum and count
      histValue.sum += value
      histValue.count += 1

      // Update buckets (cumulative)
      for (const bucket of histValue.buckets) {
        if (value <= bucket.le) {
          bucket.count += 1
        }
      }
    },

    timer(name, labels = {}) {
      const start = performance.now()
      return () => {
        const duration = (performance.now() - start) / 1000 // Convert to seconds
        registry.observe(name, duration, labels)
        return duration
      }
    },

    export(format) {
      if (format === 'prometheus') {
        return exportPrometheus(metrics, defaultLabels)
      }
      return exportJson(metrics, defaultLabels)
    },

    getMetric(name) {
      return metrics.get(name)
    },

    getMetricNames() {
      return Array.from(metrics.keys())
    },

    reset() {
      for (const metric of metrics.values()) {
        metric.values.clear()
        if (metric.histogramValues) {
          metric.histogramValues.clear()
        }
      }
    },

    getDefaultLabels() {
      return { ...defaultLabels }
    },

    setDefaultLabels(labels) {
      defaultLabels = { ...labels }
    },
  }

  return registry
}
