/**
 * Health Check Endpoints
 *
 * Production-ready health check handlers for Kubernetes probes and load balancers.
 * Follows the standard Kubernetes health check patterns:
 *
 * - `/health` - Basic health check with status and uptime
 * - `/health/live` - Liveness probe (is the process running?)
 * - `/health/ready` - Readiness probe (is the service ready to accept traffic?)
 *
 * @example
 * import { healthCheck, livenessCheck, readinessCheck, createHealthMiddleware } from 'raffel/http'
 *
 * // Simple usage - add individual routes
 * app.get('/health', healthCheck())
 * app.get('/health/live', livenessCheck())
 * app.get('/health/ready', readinessCheck())
 *
 * // Or use the combined middleware that adds all three routes
 * app.use('*', createHealthMiddleware({
 *   basePath: '/health',
 *   checks: {
 *     database: async () => {
 *       await db.ping()
 *       return { status: 'ok', latency: 5 }
 *     },
 *     redis: async () => {
 *       await redis.ping()
 *       return { status: 'ok' }
 *     }
 *   }
 * }))
 */

import type { HttpHandler, HttpMiddleware } from './app.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Health check status
 */
export type HealthStatus = 'ok' | 'degraded' | 'unhealthy'

/**
 * Individual check result
 */
export interface CheckResult {
  status: HealthStatus
  latency?: number
  message?: string
  details?: unknown
}

/**
 * Health check function
 */
export type HealthCheckFn = () => Promise<CheckResult> | CheckResult

/**
 * Health check configuration
 */
export interface HealthCheckOptions {
  /**
   * Service name for identification
   */
  serviceName?: string

  /**
   * Service version
   */
  version?: string

  /**
   * Custom health checks to run
   * Each check is named and returns a CheckResult
   */
  checks?: Record<string, HealthCheckFn>

  /**
   * Timeout for each individual check in ms
   * @default 5000
   */
  checkTimeout?: number

  /**
   * Custom data to include in health response
   */
  metadata?: Record<string, unknown>
}

/**
 * Health response payload
 */
export interface HealthResponse {
  status: HealthStatus
  timestamp: string
  uptime: number
  service?: string
  version?: string
  checks?: Record<string, CheckResult>
  metadata?: Record<string, unknown>
}

/**
 * Liveness response payload
 */
export interface LivenessResponse {
  status: 'ok'
  timestamp: string
}

/**
 * Readiness response payload
 */
export interface ReadinessResponse {
  status: HealthStatus
  timestamp: string
  checks?: Record<string, CheckResult>
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

/** Process start time for uptime calculation */
const startTime = Date.now()

// ─────────────────────────────────────────────────────────────────────────────
// Health Check Handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a basic health check handler
 *
 * Returns service status, uptime, and optional dependency checks.
 *
 * @param options - Health check configuration
 * @returns Handler function
 *
 * @example
 * app.get('/health', healthCheck({
 *   serviceName: 'api-server',
 *   version: '1.0.0',
 *   checks: {
 *     database: async () => ({ status: 'ok', latency: 5 }),
 *   }
 * }))
 */
export function healthCheck<E extends Record<string, unknown> = Record<string, unknown>>(
  options: HealthCheckOptions = {}
): HttpHandler<E> {
  const { serviceName, version, checks, checkTimeout = 5000, metadata } = options

  return async (_c) => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000)
    const checkResults = checks ? await runChecks(checks, checkTimeout) : undefined
    const overallStatus = determineOverallStatus(checkResults)

    const response: HealthResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: uptimeSeconds,
      ...(serviceName && { service: serviceName }),
      ...(version && { version }),
      ...(checkResults && { checks: checkResults }),
      ...(metadata && { metadata }),
    }

    const statusCode = overallStatus === 'ok' ? 200 : overallStatus === 'degraded' ? 200 : 503

    return new Response(JSON.stringify(response), {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  }
}

/**
 * Create a liveness check handler
 *
 * Simple check that returns 200 if the process is running.
 * Used by Kubernetes liveness probes.
 *
 * @returns Handler function
 *
 * @example
 * app.get('/health/live', livenessCheck())
 */
export function livenessCheck<E extends Record<string, unknown> = Record<string, unknown>>(): HttpHandler<E> {
  return async (_c) => {
    const response: LivenessResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
    }

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  }
}

/**
 * Create a readiness check handler
 *
 * Check that returns 200 if the service is ready to accept traffic.
 * Used by Kubernetes readiness probes and load balancer health checks.
 *
 * @param options - Health check configuration (only checks are used)
 * @returns Handler function
 *
 * @example
 * app.get('/health/ready', readinessCheck({
 *   checks: {
 *     database: async () => ({ status: 'ok' }),
 *     cache: async () => ({ status: 'ok' }),
 *   }
 * }))
 */
export function readinessCheck<E extends Record<string, unknown> = Record<string, unknown>>(
  options: Pick<HealthCheckOptions, 'checks' | 'checkTimeout'> = {}
): HttpHandler<E> {
  const { checks, checkTimeout = 5000 } = options

  return async (_c) => {
    const checkResults = checks ? await runChecks(checks, checkTimeout) : undefined
    const overallStatus = determineOverallStatus(checkResults)

    const response: ReadinessResponse = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      ...(checkResults && { checks: checkResults }),
    }

    const statusCode = overallStatus === 'unhealthy' ? 503 : 200

    return new Response(JSON.stringify(response), {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Health Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Health middleware configuration
 */
export interface HealthMiddlewareOptions extends HealthCheckOptions {
  /**
   * Base path for health endpoints
   * @default '/health'
   */
  basePath?: string
}

/**
 * Create a middleware that adds all health check routes
 *
 * Adds the following routes:
 * - GET {basePath} - Full health check with all dependencies
 * - GET {basePath}/live - Liveness probe
 * - GET {basePath}/ready - Readiness probe
 *
 * @param options - Health middleware configuration
 * @returns Middleware function
 *
 * @example
 * app.use('*', createHealthMiddleware({
 *   basePath: '/health',
 *   serviceName: 'api-server',
 *   version: '1.0.0',
 *   checks: {
 *     database: async () => {
 *       const start = Date.now()
 *       await db.query('SELECT 1')
 *       return { status: 'ok', latency: Date.now() - start }
 *     }
 *   }
 * }))
 */
export function createHealthMiddleware<E extends Record<string, unknown> = Record<string, unknown>>(
  options: HealthMiddlewareOptions = {}
): HttpMiddleware<E> {
  const { basePath = '/health', ...healthOptions } = options

  const healthHandler = healthCheck<E>(healthOptions)
  const liveHandler = livenessCheck<E>()
  const readyHandler = readinessCheck<E>({ checks: healthOptions.checks, checkTimeout: healthOptions.checkTimeout })

  return async (c, next) => {
    const path = c.req.path
    const method = c.req.method

    if (method !== 'GET') {
      await next()
      return
    }

    // Match health routes
    if (path === basePath) {
      c.res = await healthHandler(c)
      return
    }

    if (path === `${basePath}/live`) {
      c.res = await liveHandler(c)
      return
    }

    if (path === `${basePath}/ready`) {
      c.res = await readyHandler(c)
      return
    }

    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run all health checks with timeout
 */
async function runChecks(
  checks: Record<string, HealthCheckFn>,
  timeout: number
): Promise<Record<string, CheckResult>> {
  const results: Record<string, CheckResult> = {}

  await Promise.all(
    Object.entries(checks).map(async ([name, checkFn]) => {
      const startTime = Date.now()

      try {
        const result = await Promise.race([
          Promise.resolve(checkFn()),
          new Promise<CheckResult>((_, reject) =>
            setTimeout(() => reject(new Error('Check timeout')), timeout)
          ),
        ])

        results[name] = {
          ...result,
          latency: result.latency ?? Date.now() - startTime,
        }
      } catch (err) {
        results[name] = {
          status: 'unhealthy',
          latency: Date.now() - startTime,
          message: err instanceof Error ? err.message : 'Check failed',
        }
      }
    })
  )

  return results
}

/**
 * Determine overall health status from check results
 */
function determineOverallStatus(
  checkResults: Record<string, CheckResult> | undefined
): HealthStatus {
  if (!checkResults) {
    return 'ok'
  }

  const statuses = Object.values(checkResults).map((r) => r.status)

  if (statuses.some((s) => s === 'unhealthy')) {
    return 'unhealthy'
  }

  if (statuses.some((s) => s === 'degraded')) {
    return 'degraded'
  }

  return 'ok'
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  healthCheck,
  livenessCheck,
  readinessCheck,
  createHealthMiddleware,
}
