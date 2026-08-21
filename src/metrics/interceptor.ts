/**
 * Metrics Interceptor
 *
 * Automatically collects request metrics (duration, count, errors).
 */

import type { Context, Interceptor, Envelope } from '../types/index.js'
import type { MetricRegistry } from './types.js'
import { AUTO_METRICS, DEFAULT_HISTOGRAM_BUCKETS, OTEL_METRICS } from './types.js'

const processCpuState = new WeakMap<MetricRegistry, number>()

/**
 * Create an interceptor that collects request metrics
 */
export function createMetricsInterceptor(
  registry: MetricRegistry
): Interceptor {
  // Register auto-metrics if not already registered
  ensureAutoMetricsRegistered(registry)

  return async (envelope: Envelope, ctx, next) => {
    const procedure = envelope.procedure ?? 'unknown'
    const end = registry.timer(AUTO_METRICS.REQUEST_DURATION, { procedure })
    const startedAt = performance.now()

    try {
      const result = await next()
      const errorCode = getEnvelopeErrorCode(result)

      registry.increment(AUTO_METRICS.REQUESTS_TOTAL, {
        procedure,
        status: errorCode ? 'error' : 'success',
      })
      if (errorCode) {
        registry.increment(AUTO_METRICS.REQUEST_ERRORS, { procedure, code: errorCode })
      }

      end()
      recordOpenTelemetryDuration(registry, ctx, result, startedAt, errorCode)
      return result
    } catch (error) {
      // Record error
      const errorCode =
        error instanceof Error && 'code' in error
          ? String((error as { code: string }).code)
          : 'INTERNAL_ERROR'

      registry.increment(AUTO_METRICS.REQUESTS_TOTAL, {
        procedure,
        status: 'error',
      })

      registry.increment(AUTO_METRICS.REQUEST_ERRORS, {
        procedure,
        code: errorCode,
      })

      end()
      recordOpenTelemetryDuration(registry, ctx, undefined, startedAt, errorCode)
      throw error
    }
  }
}

function getEnvelopeErrorCode(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !('type' in result)) return undefined
  const resultEnvelope = result as Envelope
  if (resultEnvelope.type !== 'error') return undefined
  const payload = resultEnvelope.payload
  if (!payload || typeof payload !== 'object' || !('code' in payload)) return 'INTERNAL_ERROR'
  return String((payload as { code: unknown }).code)
}

function getHttpStatus(result: unknown, errorCode?: string): string {
  if (result instanceof Response) return String(result.status)
  if (result && typeof result === 'object' && 'payload' in result) {
    const payload = (result as Envelope).payload
    if (payload instanceof Response) return String(payload.status)
    if (payload && typeof payload === 'object' && 'status' in payload) {
      return String((payload as { status: unknown }).status)
    }
  }
  return errorCode ? '500' : '200'
}

const GRPC_STATUS_BY_ERROR: Record<string, string> = {
  CANCELLED: '1',
  INVALID_ARGUMENT: '3',
  DEADLINE_EXCEEDED: '4',
  NOT_FOUND: '5',
  ALREADY_EXISTS: '6',
  PERMISSION_DENIED: '7',
  RESOURCE_EXHAUSTED: '8',
  FAILED_PRECONDITION: '9',
  UNIMPLEMENTED: '12',
  INTERNAL_ERROR: '13',
  UNAVAILABLE: '14',
  DATA_LOSS: '15',
  UNAUTHENTICATED: '16',
}

function recordOpenTelemetryDuration(
  registry: MetricRegistry,
  ctx: Context,
  result: unknown,
  startedAt: number,
  errorCode?: string
): void {
  const durationSeconds = (performance.now() - startedAt) / 1000
  if (ctx.protocol === 'http' && ctx.http) {
    const status = getHttpStatus(result, errorCode)
    const labels: Record<string, string> = {
      'http.request.method': ctx.http.method,
      'url.scheme': new URL(ctx.http.url).protocol.replace(':', ''),
      'http.route': ctx.http.route ?? ctx.http.path,
      'http.response.status_code': status,
    }
    if (Number(status) >= 500 || errorCode) labels['error.type'] = errorCode ?? status
    registry.observe(OTEL_METRICS.HTTP_SERVER_REQUEST_DURATION, durationSeconds, labels)
    return
  }

  if (ctx.protocol === 'grpc' && ctx.grpc) {
    const labels: Record<string, string> = {
      'rpc.system': 'grpc',
      'rpc.service': ctx.grpc.service ?? 'unknown',
      'rpc.method': ctx.grpc.method ?? 'unknown',
      'rpc.grpc.status_code': errorCode ? (GRPC_STATUS_BY_ERROR[errorCode] ?? '13') : '0',
    }
    if (errorCode) labels['error.type'] = errorCode
    registry.observe(OTEL_METRICS.RPC_SERVER_CALL_DURATION, durationSeconds, labels)
  }
}

/**
 * Ensure all auto-collected metrics are registered
 */
function ensureAutoMetricsRegistered(registry: MetricRegistry): void {
  if (!registry.getMetric(OTEL_METRICS.HTTP_SERVER_REQUEST_DURATION)) {
    registry.histogram(OTEL_METRICS.HTTP_SERVER_REQUEST_DURATION, {
      description: 'Duration of HTTP server requests',
      unit: 's',
      labels: [
        'http.request.method',
        'url.scheme',
        'http.route',
        'http.response.status_code',
        'error.type',
      ],
      buckets: [...DEFAULT_HISTOGRAM_BUCKETS],
    })
  }

  if (!registry.getMetric(OTEL_METRICS.RPC_SERVER_CALL_DURATION)) {
    registry.histogram(OTEL_METRICS.RPC_SERVER_CALL_DURATION, {
      description: 'Duration of RPC server calls',
      unit: 's',
      labels: [
        'rpc.system',
        'rpc.service',
        'rpc.method',
        'rpc.grpc.status_code',
        'error.type',
      ],
      buckets: [...DEFAULT_HISTOGRAM_BUCKETS],
    })
  }

  // Legacy Raffel metrics remain for one compatibility release.
  // Requests total counter
  if (!registry.getMetric(AUTO_METRICS.REQUESTS_TOTAL)) {
    registry.counter(AUTO_METRICS.REQUESTS_TOTAL, {
      description: 'Total number of requests',
      labels: ['procedure', 'status'],
    })
  }

  // Request duration histogram
  if (!registry.getMetric(AUTO_METRICS.REQUEST_DURATION)) {
    registry.histogram(AUTO_METRICS.REQUEST_DURATION, {
      description: 'Request duration in seconds',
      labels: ['procedure'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    })
  }

  // Request errors counter
  if (!registry.getMetric(AUTO_METRICS.REQUEST_ERRORS)) {
    registry.counter(AUTO_METRICS.REQUEST_ERRORS, {
      description: 'Total number of request errors',
      labels: ['procedure', 'code'],
    })
  }
}

/**
 * Register WebSocket connection metrics
 */
export function registerWsMetrics(registry: MetricRegistry): void {
  if (!registry.getMetric(AUTO_METRICS.WS_CONNECTIONS)) {
    registry.gauge(AUTO_METRICS.WS_CONNECTIONS, {
      description: 'Number of active WebSocket connections',
    })
  }

  if (!registry.getMetric(AUTO_METRICS.WS_MESSAGES)) {
    registry.counter(AUTO_METRICS.WS_MESSAGES, {
      description: 'Total WebSocket messages',
      labels: ['direction'],
    })
  }
}

/**
 * Register process metrics (CPU, memory, event loop)
 */
export function registerProcessMetrics(registry: MetricRegistry): void {
  if (!registry.getMetric(AUTO_METRICS.PROCESS_CPU)) {
    registry.counter(AUTO_METRICS.PROCESS_CPU, {
      description: 'Total user and system CPU time spent in seconds',
    })
  }

  if (!registry.getMetric(AUTO_METRICS.PROCESS_MEMORY)) {
    registry.gauge(AUTO_METRICS.PROCESS_MEMORY, {
      description: 'Resident memory size in bytes',
    })
  }

  if (!registry.getMetric(AUTO_METRICS.EVENTLOOP_LAG)) {
    registry.gauge(AUTO_METRICS.EVENTLOOP_LAG, {
      description: 'Event loop lag in seconds',
    })
  }
}

/**
 * Collect process metrics (call periodically)
 */
export function collectProcessMetrics(registry: MetricRegistry): void {
  // CPU usage
  const cpuUsage = process.cpuUsage()
  const totalCpuSeconds = (cpuUsage.user + cpuUsage.system) / 1_000_000
  const previousCpuSeconds = processCpuState.get(registry)

  if (typeof previousCpuSeconds === 'number') {
    const delta = Math.max(0, totalCpuSeconds - previousCpuSeconds)
    if (delta > 0) {
      registry.increment(AUTO_METRICS.PROCESS_CPU, {}, delta)
    }
  }

  processCpuState.set(registry, totalCpuSeconds)

  // Memory usage
  const memUsage = process.memoryUsage()
  registry.set(AUTO_METRICS.PROCESS_MEMORY, memUsage.rss)

  // Event loop lag is measured separately via setTimeout trick
}

/**
 * Start collecting process metrics at regular intervals
 * Returns a cleanup function to stop collection
 */
export function startProcessMetricsCollection(
  registry: MetricRegistry,
  intervalMs = 15000
): () => void {
  registerProcessMetrics(registry)

  // Initial collection
  collectProcessMetrics(registry)

  // Periodic collection
  const interval = setInterval(() => {
    collectProcessMetrics(registry)
  }, intervalMs)

  // Event loop lag measurement
  let lastCheck = Date.now()
  const lagCheck = setInterval(() => {
    const now = Date.now()
    const expected = 100 // We schedule every 100ms
    const lag = (now - lastCheck - expected) / 1000 // Convert to seconds
    lastCheck = now
    registry.set(AUTO_METRICS.EVENTLOOP_LAG, Math.max(0, lag))
  }, 100)

  return () => {
    clearInterval(interval)
    clearInterval(lagCheck)
  }
}
