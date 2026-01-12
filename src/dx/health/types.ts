/**
 * Health Check Types
 *
 * Types for the health check system supporting Kubernetes probes.
 */

/**
 * Result of a health probe check.
 */
export interface ProbeResult {
  /** Status of the probe */
  status: 'ok' | 'error' | 'degraded'
  /** Latency in milliseconds (optional) */
  latency?: number
  /** Error message if status is error */
  error?: string
  /** Additional metadata */
  [key: string]: unknown
}

/**
 * Health probe function.
 * Can be sync or async.
 */
export type HealthProbe = () => ProbeResult | Promise<ProbeResult>

/**
 * Configuration for a probe group (liveness or readiness).
 */
export interface HealthProbeGroupConfig {
  /** Probes to run for this group */
  probes?: Record<string, HealthProbe>
  /** Timeout for this probe group in ms (overrides default) */
  timeout?: number
}

/**
 * Main health check configuration.
 */
export interface HealthCheckConfig {
  /**
   * Base path for health endpoints.
   * @default '/health'
   */
  basePath?: string

  /**
   * Liveness probe configuration.
   * - true: Enable basic liveness (always returns ok if process is running)
   * - false/undefined: Disable liveness endpoint
   * - HealthProbeGroupConfig: Custom liveness probes
   * @default true
   */
  liveness?: boolean | HealthProbeGroupConfig

  /**
   * Readiness probe configuration.
   * - true: Enable basic readiness (same as general health)
   * - false/undefined: Disable readiness endpoint
   * - HealthProbeGroupConfig: Custom readiness probes
   * @default true
   */
  readiness?: boolean | HealthProbeGroupConfig

  /**
   * Custom probes added to the general health check.
   * These probes are NOT included in liveness by default (liveness should be lightweight).
   */
  probes?: Record<string, HealthProbe>

  /**
   * Default timeout for probes in milliseconds.
   * @default 5000
   */
  timeout?: number

  /**
   * Include detailed probe results in response.
   * When false, only returns overall status.
   * @default true
   */
  includeProbeDetails?: boolean

  /**
   * Process start time for uptime calculation.
   * @default Date.now() at initialization
   */
  startTime?: number
}

/**
 * Health check response format.
 */
export interface HealthResponse {
  /** Overall status */
  status: 'ok' | 'unhealthy' | 'degraded'
  /** ISO timestamp */
  timestamp: string
  /** Uptime in seconds */
  uptime: number
  /** Individual probe results (if includeProbeDetails is true) */
  probes?: Record<string, ProbeResult>
}

/**
 * Internal state for health check manager.
 */
export interface HealthCheckState {
  config: Required<Omit<HealthCheckConfig, 'probes' | 'liveness' | 'readiness' | 'startTime'>> & {
    probes: Record<string, HealthProbe>
    liveness: boolean | HealthProbeGroupConfig
    readiness: boolean | HealthProbeGroupConfig
  }
  startTime: number
}
