/**
 * Metrics Interceptor
 *
 * Automatically collects request metrics (duration, count, errors).
 */

import type { Interceptor, Envelope } from '../types/index.js'
import type { MetricRegistry } from './types.js'
import { AUTO_METRICS } from './types.js'

/**
 * Create an interceptor that collects request metrics
 */
export function createMetricsInterceptor(
  registry: MetricRegistry
): Interceptor {
  // Register auto-metrics if not already registered
  ensureAutoMetricsRegistered(registry)

  return async (envelope: Envelope, _ctx, next) => {
    const procedure = envelope.procedure ?? 'unknown'
    const end = registry.timer(AUTO_METRICS.REQUEST_DURATION, { procedure })

    try {
      const result = await next()

      // Record success
      registry.increment(AUTO_METRICS.REQUESTS_TOTAL, {
        procedure,
        status: 'success',
      })

      end()
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
      throw error
    }
  }
}

/**
 * Ensure all auto-collected metrics are registered
 */
function ensureAutoMetricsRegistered(registry: MetricRegistry): void {
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
  const cpuSeconds = (cpuUsage.user + cpuUsage.system) / 1_000_000
  registry.set(AUTO_METRICS.PROCESS_CPU, cpuSeconds)

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
