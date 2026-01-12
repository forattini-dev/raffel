/**
 * Health Check System
 *
 * Provides built-in health check procedures for Kubernetes probes:
 * - /health       - Overall health (all probes)
 * - /health/live  - Liveness (is process running?)
 * - /health/ready - Readiness (can accept traffic?)
 */

import type { ProcedureHandler } from '../../types/index.js'
import type {
  HealthCheckConfig,
  HealthCheckState,
  HealthProbe,
  HealthResponse,
  ProbeResult,
} from './types.js'

export * from './types.js'

/**
 * Default configuration values.
 */
const DEFAULTS = {
  basePath: '/health',
  timeout: 5000,
  includeProbeDetails: true,
  liveness: true,
  readiness: true,
} as const

/**
 * Run a single probe with timeout.
 */
async function runProbe(
  name: string,
  probe: HealthProbe,
  timeout: number
): Promise<ProbeResult> {
  const start = Date.now()

  try {
    const result = await Promise.race([
      Promise.resolve(probe()),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Probe '${name}' timed out after ${timeout}ms`)), timeout)
      ),
    ])

    // Add latency if not provided
    if (result.latency === undefined) {
      result.latency = Date.now() - start
    }

    return result
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      latency: Date.now() - start,
    }
  }
}

/**
 * Run all probes in parallel and aggregate results.
 */
async function runProbes(
  probes: Record<string, HealthProbe>,
  timeout: number
): Promise<{ results: Record<string, ProbeResult>; overallStatus: 'ok' | 'unhealthy' | 'degraded' }> {
  const entries = Object.entries(probes)

  if (entries.length === 0) {
    return { results: {}, overallStatus: 'ok' }
  }

  const probePromises = entries.map(async ([name, probe]) => {
    const result = await runProbe(name, probe, timeout)
    return [name, result] as const
  })

  const probeResults = await Promise.all(probePromises)
  const results = Object.fromEntries(probeResults)

  // Determine overall status
  let overallStatus: 'ok' | 'unhealthy' | 'degraded' = 'ok'

  for (const result of Object.values(results)) {
    if (result.status === 'error') {
      overallStatus = 'unhealthy'
      break
    }
    if (result.status === 'degraded') {
      overallStatus = 'degraded'
    }
  }

  return { results, overallStatus }
}

/**
 * Build health response object.
 */
function buildResponse(
  state: HealthCheckState,
  overallStatus: 'ok' | 'unhealthy' | 'degraded',
  probeResults?: Record<string, ProbeResult>
): HealthResponse {
  const uptimeSeconds = Math.floor((Date.now() - state.startTime) / 1000)

  const response: HealthResponse = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: uptimeSeconds,
  }

  if (state.config.includeProbeDetails && probeResults && Object.keys(probeResults).length > 0) {
    response.probes = probeResults
  }

  return response
}

/**
 * Get probes for a specific endpoint type.
 */
function getProbesForEndpoint(
  state: HealthCheckState,
  endpointType: 'general' | 'liveness' | 'readiness'
): Record<string, HealthProbe> {
  if (endpointType === 'general') {
    return state.config.probes
  }

  const config = endpointType === 'liveness' ? state.config.liveness : state.config.readiness

  if (config === true) {
    // Basic check - no custom probes
    // For liveness: just respond (if we can respond, we're alive)
    // For readiness: use general probes
    return endpointType === 'liveness' ? {} : state.config.probes
  }

  if (typeof config === 'object' && config.probes) {
    return config.probes
  }

  return {}
}

/**
 * Get timeout for a specific endpoint type.
 */
function getTimeoutForEndpoint(
  state: HealthCheckState,
  endpointType: 'general' | 'liveness' | 'readiness'
): number {
  if (endpointType === 'general') {
    return state.config.timeout
  }

  const config = endpointType === 'liveness' ? state.config.liveness : state.config.readiness

  if (typeof config === 'object' && config.timeout) {
    return config.timeout
  }

  return state.config.timeout
}

/**
 * Create health check procedure handler.
 */
function createHealthHandler(
  state: HealthCheckState,
  endpointType: 'general' | 'liveness' | 'readiness'
): ProcedureHandler<void, HealthResponse> {
  return async () => {
    const probes = getProbesForEndpoint(state, endpointType)
    const timeout = getTimeoutForEndpoint(state, endpointType)

    const { results, overallStatus } = await runProbes(probes, timeout)
    const response = buildResponse(state, overallStatus, results)

    // For liveness, always return ok if we can respond
    if (endpointType === 'liveness' && Object.keys(probes).length === 0) {
      response.status = 'ok'
    }

    return response
  }
}

/**
 * Health check procedure definition.
 */
export interface HealthCheckProcedure {
  /** The procedure handler function */
  handler: ProcedureHandler<void, HealthResponse>
  /** Metadata for registration */
  meta: {
    name: string
    description: string
    httpPath: string
    httpMethod: 'GET'
  }
}

/**
 * Procedure definitions for health check endpoints.
 */
export interface HealthCheckProcedures {
  /** General health check */
  health: HealthCheckProcedure
  /** Liveness check (optional) */
  live?: HealthCheckProcedure
  /** Readiness check (optional) */
  ready?: HealthCheckProcedure
}

/**
 * Create health check procedures.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const healthProcedures = createHealthCheckProcedures()
 *
 * // With custom probes
 * const healthProcedures = createHealthCheckProcedures({
 *   probes: {
 *     database: async () => {
 *       await db.ping()
 *       return { status: 'ok' }
 *     },
 *     redis: async () => {
 *       await redis.ping()
 *       return { status: 'ok' }
 *     }
 *   }
 * })
 *
 * // Register with server
 * server.procedure('health', healthProcedures.health.procedure, healthProcedures.health.meta)
 * ```
 */
export function createHealthCheckProcedures(config: HealthCheckConfig = {}): HealthCheckProcedures {
  const state: HealthCheckState = {
    config: {
      basePath: config.basePath ?? DEFAULTS.basePath,
      timeout: config.timeout ?? DEFAULTS.timeout,
      includeProbeDetails: config.includeProbeDetails ?? DEFAULTS.includeProbeDetails,
      probes: config.probes ?? {},
      liveness: config.liveness ?? DEFAULTS.liveness,
      readiness: config.readiness ?? DEFAULTS.readiness,
    },
    startTime: config.startTime ?? Date.now(),
  }

  const procedures: HealthCheckProcedures = {
    health: {
      handler: createHealthHandler(state, 'general') as ProcedureHandler<void, HealthResponse>,
      meta: {
        name: 'health',
        description: 'Overall health check with all probes',
        httpPath: state.config.basePath,
        httpMethod: 'GET',
      },
    },
  }

  // Add liveness endpoint if enabled
  if (state.config.liveness !== false) {
    procedures.live = {
      handler: createHealthHandler(state, 'liveness') as ProcedureHandler<void, HealthResponse>,
      meta: {
        name: 'health.live',
        description: 'Liveness probe - is the process running?',
        httpPath: `${state.config.basePath}/live`,
        httpMethod: 'GET',
      },
    }
  }

  // Add readiness endpoint if enabled
  if (state.config.readiness !== false) {
    procedures.ready = {
      handler: createHealthHandler(state, 'readiness') as ProcedureHandler<void, HealthResponse>,
      meta: {
        name: 'health.ready',
        description: 'Readiness probe - can the service accept traffic?',
        httpPath: `${state.config.basePath}/ready`,
        httpMethod: 'GET',
      },
    }
  }

  return procedures
}

/**
 * Helper to create common probes.
 */
export const CommonProbes = {
  /**
   * Create a ping probe for a service.
   */
  ping: (pingFn: () => Promise<void>, name = 'ping'): Record<string, HealthProbe> => ({
    [name]: async () => {
      const start = Date.now()
      await pingFn()
      return { status: 'ok', latency: Date.now() - start }
    },
  }),

  /**
   * Create a HTTP health check probe.
   */
  http: (url: string, name = 'http'): Record<string, HealthProbe> => ({
    [name]: async () => {
      const start = Date.now()
      const response = await fetch(url, { method: 'GET' })
      const latency = Date.now() - start

      if (response.ok) {
        return { status: 'ok', latency, statusCode: response.status }
      }

      return {
        status: response.status >= 500 ? 'error' : 'degraded',
        latency,
        statusCode: response.status,
        error: `HTTP ${response.status}`,
      }
    },
  }),

  /**
   * Create a memory usage probe.
   * Returns degraded if usage exceeds threshold.
   */
  memory: (thresholdMB = 1024): Record<string, HealthProbe> => ({
    memory: () => {
      const used = process.memoryUsage()
      const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024)
      const rssMB = Math.round(used.rss / 1024 / 1024)

      return {
        status: heapUsedMB > thresholdMB ? 'degraded' : 'ok',
        heapUsedMB,
        rssMB,
        threshold: thresholdMB,
      }
    },
  }),
}
