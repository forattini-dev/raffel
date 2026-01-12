/**
 * Metric Exporters
 *
 * Export metrics to Prometheus text format or JSON.
 */

import type { MetricDefinition, Labels } from './types.js'

/**
 * Format labels for Prometheus output: {key="value",key2="value2"}
 * Labels are sorted alphabetically for consistent output.
 */
function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels)
  if (entries.length === 0) return ''

  // Sort by key for consistent output
  entries.sort(([a], [b]) => a.localeCompare(b))

  const formatted = entries
    .map(([k, v]) => `${k}="${escapePrometheusValue(v)}"`)
    .join(',')

  return `{${formatted}}`
}

/**
 * Escape special characters in Prometheus label values
 */
function escapePrometheusValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
}

/**
 * Export metrics to Prometheus text format
 *
 * Format:
 * # HELP metric_name Description
 * # TYPE metric_name type
 * metric_name{label="value"} 123
 */
export function exportPrometheus(
  metrics: Map<string, MetricDefinition>,
  _defaultLabels: Labels
): string {
  const lines: string[] = []

  for (const metric of metrics.values()) {
    // HELP line
    if (metric.description) {
      lines.push(`# HELP ${metric.name} ${metric.description}`)
    }

    // TYPE line
    lines.push(`# TYPE ${metric.name} ${metric.type}`)

    if (metric.type === 'histogram') {
      // Histogram format with buckets
      for (const histValue of metric.histogramValues!.values()) {
        const baseLabels = formatLabels(histValue.labels)
        const baseName = metric.name

        // Bucket values (cumulative)
        for (const bucket of histValue.buckets) {
          const leLabel =
            bucket.le === Infinity ? '+Inf' : bucket.le.toString()
          const bucketLabels = histValue.labels
          const labelStr = formatLabels({ ...bucketLabels, le: leLabel })
          lines.push(`${baseName}_bucket${labelStr} ${bucket.count}`)
        }

        // +Inf bucket (always equal to count)
        const infLabels = formatLabels({ ...histValue.labels, le: '+Inf' })
        lines.push(`${baseName}_bucket${infLabels} ${histValue.count}`)

        // Sum and count
        lines.push(`${baseName}_sum${baseLabels} ${histValue.sum}`)
        lines.push(`${baseName}_count${baseLabels} ${histValue.count}`)
      }
    } else {
      // Counter and gauge format
      for (const value of metric.values.values()) {
        const labelStr = formatLabels(value.labels)
        lines.push(`${metric.name}${labelStr} ${value.value}`)
      }
    }

    // Empty line between metrics
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Export metrics to JSON format
 */
export function exportJson(
  metrics: Map<string, MetricDefinition>,
  defaultLabels: Labels
): string {
  const output: Record<string, unknown> = {
    defaultLabels,
    metrics: {},
  }

  const metricsObj = output.metrics as Record<string, unknown>

  for (const metric of metrics.values()) {
    if (metric.type === 'histogram') {
      const histograms: unknown[] = []
      for (const histValue of metric.histogramValues!.values()) {
        histograms.push({
          labels: histValue.labels,
          buckets: histValue.buckets,
          sum: histValue.sum,
          count: histValue.count,
        })
      }
      metricsObj[metric.name] = {
        type: metric.type,
        description: metric.description,
        values: histograms,
      }
    } else {
      const values: unknown[] = []
      for (const value of metric.values.values()) {
        values.push({
          labels: value.labels,
          value: value.value,
        })
      }
      metricsObj[metric.name] = {
        type: metric.type,
        description: metric.description,
        values,
      }
    }
  }

  return JSON.stringify(output, null, 2)
}
