/**
 * Size Limit Interceptor
 *
 * Protects against memory exhaustion from oversized payloads or responses.
 * Works at the protocol-agnostic level to limit both request and response sizes.
 *
 * Features:
 * - Request payload size limits
 * - Response size limits (via Content-Length or streaming check)
 * - Per-procedure size configuration
 * - Graceful error handling
 */

import type { Interceptor, Envelope, Context } from '../../types/index.js'
import { RaffelError } from '../../core/router.js'

/**
 * Size limit configuration
 */
export interface SizeLimitConfig {
  /**
   * Maximum request payload size in bytes (default: 1MB)
   * Set to 0 to disable
   */
  maxRequestSize?: number

  /**
   * Maximum response size in bytes (default: 10MB)
   * Set to 0 to disable
   */
  maxResponseSize?: number

  /**
   * Per-procedure size limits
   * Overrides global limits for specific procedures
   */
  procedures?: Record<string, {
    maxRequestSize?: number
    maxResponseSize?: number
  }>

  /**
   * Pattern-based size limits
   * Matches glob patterns like 'files.*' or 'upload.**'
   */
  patterns?: Record<string, {
    maxRequestSize?: number
    maxResponseSize?: number
  }>

  /**
   * Callback when size limit is exceeded
   * Useful for metrics and monitoring
   */
  onSizeExceeded?: (info: {
    type: 'request' | 'response'
    procedure: string
    size: number
    limit: number
    requestId?: string
  }) => void
}

/**
 * Default size limits
 */
const DEFAULT_MAX_REQUEST_SIZE = 1024 * 1024 // 1MB
const DEFAULT_MAX_RESPONSE_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * Match a procedure name against glob patterns
 */
function matchPattern(pattern: string, procedure: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLE_STAR}}')
    .replace(/\*/g, '[^.]*')
    .replace(/{{DOUBLE_STAR}}/g, '.*')

  return new RegExp(`^${regex}$`).test(procedure)
}

/**
 * Estimate size of a value in bytes
 */
function estimateSize(value: unknown): number {
  if (value === null || value === undefined) {
    return 0
  }

  if (typeof value === 'string') {
    // UTF-8 can use up to 4 bytes per character, but typically 1-2
    return value.length * 2
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return 8
  }

  if (value instanceof ArrayBuffer) {
    return value.byteLength
  }

  if (ArrayBuffer.isView(value)) {
    return value.byteLength
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value).length * 2
    } catch {
      return 0
    }
  }

  return 0
}

/**
 * Find limits for a procedure
 */
function findLimits(
  procedure: string,
  config: SizeLimitConfig
): { maxRequestSize: number; maxResponseSize: number } {
  const {
    maxRequestSize = DEFAULT_MAX_REQUEST_SIZE,
    maxResponseSize = DEFAULT_MAX_RESPONSE_SIZE,
    procedures,
    patterns,
  } = config

  // Check exact match first
  if (procedures?.[procedure]) {
    return {
      maxRequestSize: procedures[procedure].maxRequestSize ?? maxRequestSize,
      maxResponseSize: procedures[procedure].maxResponseSize ?? maxResponseSize,
    }
  }

  // Check patterns
  if (patterns) {
    for (const [pattern, limits] of Object.entries(patterns)) {
      if (matchPattern(pattern, procedure)) {
        return {
          maxRequestSize: limits.maxRequestSize ?? maxRequestSize,
          maxResponseSize: limits.maxResponseSize ?? maxResponseSize,
        }
      }
    }
  }

  return { maxRequestSize, maxResponseSize }
}

/**
 * Create a size limit interceptor
 *
 * Limits both request payload and response sizes to prevent
 * memory exhaustion attacks and runaway responses.
 *
 * @example
 * ```typescript
 * // Basic usage with defaults (1MB request, 10MB response)
 * const sizeLimit = createSizeLimitInterceptor()
 *
 * // Custom limits
 * const sizeLimit = createSizeLimitInterceptor({
 *   maxRequestSize: 512 * 1024,  // 512KB
 *   maxResponseSize: 5 * 1024 * 1024,  // 5MB
 * })
 *
 * // Per-procedure limits
 * const sizeLimit = createSizeLimitInterceptor({
 *   maxRequestSize: 1024 * 1024,
 *   procedures: {
 *     'files.upload': { maxRequestSize: 50 * 1024 * 1024 },  // 50MB for uploads
 *     'reports.generate': { maxResponseSize: 100 * 1024 * 1024 },  // 100MB for reports
 *   }
 * })
 *
 * // Pattern-based limits
 * const sizeLimit = createSizeLimitInterceptor({
 *   patterns: {
 *     'upload.**': { maxRequestSize: 100 * 1024 * 1024 },
 *     'export.**': { maxResponseSize: 50 * 1024 * 1024 },
 *   }
 * })
 *
 * // With monitoring
 * const sizeLimit = createSizeLimitInterceptor({
 *   onSizeExceeded: ({ type, procedure, size, limit }) => {
 *     metrics.increment('size_limit.exceeded', { type, procedure })
 *   }
 * })
 *
 * server.use(sizeLimit)
 * ```
 */
export function createSizeLimitInterceptor(config: SizeLimitConfig = {}): Interceptor {
  const { onSizeExceeded } = config

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const { maxRequestSize, maxResponseSize } = findLimits(envelope.procedure, config)

    // Check request payload size
    if (maxRequestSize > 0) {
      const requestSize = estimateSize(envelope.payload)

      if (requestSize > maxRequestSize) {
        if (onSizeExceeded) {
          onSizeExceeded({
            type: 'request',
            procedure: envelope.procedure,
            size: requestSize,
            limit: maxRequestSize,
            requestId: ctx.requestId,
          })
        }

        throw new RaffelError(
          'RESOURCE_EXHAUSTED',
          `Request payload too large: ${formatBytes(requestSize)} exceeds limit of ${formatBytes(maxRequestSize)}`,
          {
            procedure: envelope.procedure,
            size: requestSize,
            limit: maxRequestSize,
          }
        )
      }
    }

    // Execute handler
    const result = await next()

    // Check response size
    if (maxResponseSize > 0 && result !== undefined) {
      const responseSize = estimateSize(result)

      if (responseSize > maxResponseSize) {
        if (onSizeExceeded) {
          onSizeExceeded({
            type: 'response',
            procedure: envelope.procedure,
            size: responseSize,
            limit: maxResponseSize,
            requestId: ctx.requestId,
          })
        }

        throw new RaffelError(
          'RESOURCE_EXHAUSTED',
          `Response too large: ${formatBytes(responseSize)} exceeds limit of ${formatBytes(maxResponseSize)}`,
          {
            procedure: envelope.procedure,
            size: responseSize,
            limit: maxResponseSize,
          }
        )
      }
    }

    return result
  }
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`
}

/**
 * Create a request-only size limit interceptor
 *
 * Only limits incoming request payload sizes.
 * Useful when response sizes are controlled by the handler logic.
 */
export function createRequestSizeLimitInterceptor(
  maxSize: number,
  options: Pick<SizeLimitConfig, 'procedures' | 'patterns' | 'onSizeExceeded'> = {}
): Interceptor {
  return createSizeLimitInterceptor({
    maxRequestSize: maxSize,
    maxResponseSize: 0, // Disable response check
    ...options,
  })
}

/**
 * Create a response-only size limit interceptor
 *
 * Only limits outgoing response sizes.
 * Useful for preventing accidental large responses.
 */
export function createResponseSizeLimitInterceptor(
  maxSize: number,
  options: Pick<SizeLimitConfig, 'procedures' | 'patterns' | 'onSizeExceeded'> = {}
): Interceptor {
  return createSizeLimitInterceptor({
    maxRequestSize: 0, // Disable request check
    maxResponseSize: maxSize,
    ...options,
  })
}

/**
 * Common size limit presets
 */
export const SizeLimitPresets = {
  /** Strict: 100KB request, 1MB response */
  strict: { maxRequestSize: 100 * 1024, maxResponseSize: 1024 * 1024 },

  /** Standard: 1MB request, 10MB response */
  standard: { maxRequestSize: 1024 * 1024, maxResponseSize: 10 * 1024 * 1024 },

  /** Relaxed: 10MB request, 100MB response */
  relaxed: { maxRequestSize: 10 * 1024 * 1024, maxResponseSize: 100 * 1024 * 1024 },

  /** API: 1MB request, 5MB response (typical REST API) */
  api: { maxRequestSize: 1024 * 1024, maxResponseSize: 5 * 1024 * 1024 },

  /** Upload: 100MB request, 1MB response (file uploads) */
  upload: { maxRequestSize: 100 * 1024 * 1024, maxResponseSize: 1024 * 1024 },
} as const
