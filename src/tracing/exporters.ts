/**
 * Span Exporters
 *
 * Export spans to various backends: Console, Jaeger, Zipkin.
 */

import type { SpanExporter, SpanData } from './types.js'

/**
 * Console exporter - prints spans to console (useful for development)
 */
export function createConsoleExporter(): SpanExporter {
  return {
    async export(spans: SpanData[]) {
      for (const span of spans) {
        const duration = (span.duration / 1000).toFixed(2) // Convert to ms
        const status = span.status.code === 'error' ? '❌' : '✓'

        console.log(
          `[Trace] ${status} ${span.name} (${duration}ms) trace=${span.traceId.slice(0, 8)}... span=${span.spanId.slice(0, 8)}...`
        )

        if (Object.keys(span.attributes).length > 0) {
          console.log('  Attributes:', span.attributes)
        }

        if (span.status.code === 'error' && span.status.message) {
          console.log('  Error:', span.status.message)
        }

        for (const log of span.logs) {
          console.log(`  Log: ${log.message}`, log.fields ?? '')
        }
      }
    },

    async shutdown() {
      // No cleanup needed
    },
  }
}

/**
 * Jaeger Thrift over HTTP exporter options
 */
export interface JaegerExporterOptions {
  /** Jaeger collector endpoint (default: http://localhost:14268/api/traces) */
  endpoint?: string

  /** Service name */
  serviceName: string

  /** Request timeout in ms (default: 5000) */
  timeout?: number
}

/**
 * Jaeger exporter - sends spans to Jaeger collector
 *
 * Uses Jaeger's Thrift HTTP format
 */
export function createJaegerExporter(options: JaegerExporterOptions): SpanExporter {
  const { endpoint = 'http://localhost:14268/api/traces', serviceName, timeout = 5000 } = options

  return {
    async export(spans: SpanData[]) {
      if (spans.length === 0) return

      // Convert to Jaeger format
      const jaegerSpans = spans.map((span) => ({
        traceIdHigh: span.traceId.slice(0, 16),
        traceIdLow: span.traceId.slice(16),
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        operationName: span.name,
        references: span.parentSpanId
          ? [
              {
                refType: 'CHILD_OF',
                traceIdHigh: span.traceId.slice(0, 16),
                traceIdLow: span.traceId.slice(16),
                spanId: span.parentSpanId,
              },
            ]
          : [],
        flags: span.context.traceFlags,
        startTime: Math.floor(span.startTime),
        duration: Math.floor(span.duration),
        tags: Object.entries(span.attributes).map(([key, value]) => ({
          key,
          vType: typeof value === 'string' ? 'STRING' : typeof value === 'boolean' ? 'BOOL' : 'LONG',
          vStr: typeof value === 'string' ? value : undefined,
          vBool: typeof value === 'boolean' ? value : undefined,
          vLong: typeof value === 'number' ? value : undefined,
        })),
        logs: span.logs.map((log) => ({
          timestamp: Math.floor(log.timestamp),
          fields: [
            { key: 'message', vType: 'STRING', vStr: log.message },
            ...Object.entries(log.fields ?? {}).map(([key, value]) => ({
              key,
              vType: 'STRING',
              vStr: String(value),
            })),
          ],
        })),
      }))

      const batch = {
        process: {
          serviceName,
          tags: [],
        },
        spans: jaegerSpans,
      }

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)

        await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(batch),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)
      } catch {
        // Silently fail - tracing should not break the app
      }
    },

    async shutdown() {
      // No cleanup needed
    },
  }
}

/**
 * Zipkin exporter options
 */
export interface ZipkinExporterOptions {
  /** Zipkin collector endpoint (default: http://localhost:9411/api/v2/spans) */
  endpoint?: string

  /** Service name */
  serviceName: string

  /** Request timeout in ms (default: 5000) */
  timeout?: number
}

/**
 * Zipkin exporter - sends spans to Zipkin collector
 */
export function createZipkinExporter(options: ZipkinExporterOptions): SpanExporter {
  const { endpoint = 'http://localhost:9411/api/v2/spans', serviceName, timeout = 5000 } = options

  return {
    async export(spans: SpanData[]) {
      if (spans.length === 0) return

      // Convert to Zipkin format
      const zipkinSpans = spans.map((span) => ({
        traceId: span.traceId,
        id: span.spanId,
        parentId: span.parentSpanId,
        name: span.name,
        kind: span.kind.toUpperCase(),
        timestamp: Math.floor(span.startTime),
        duration: Math.floor(span.duration),
        localEndpoint: {
          serviceName,
        },
        tags: Object.fromEntries(
          Object.entries(span.attributes).map(([k, v]) => [k, String(v)])
        ),
        annotations: span.logs.map((log) => ({
          timestamp: Math.floor(log.timestamp),
          value: log.message,
        })),
      }))

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)

        await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(zipkinSpans),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)
      } catch {
        // Silently fail - tracing should not break the app
      }
    },

    async shutdown() {
      // No cleanup needed
    },
  }
}

/**
 * No-op exporter - discards all spans (for testing/disabled tracing)
 */
export function createNoopExporter(): SpanExporter {
  return {
    async export() {
      // Discard
    },
    async shutdown() {
      // Nothing to clean up
    },
  }
}
