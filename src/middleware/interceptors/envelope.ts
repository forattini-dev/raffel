/**
 * Response Envelope Interceptor
 *
 * Wraps all responses in a standardized envelope format for consistent API responses.
 *
 * Features:
 * - Consistent success/error response structure
 * - Configurable metadata (timestamp, requestId, duration)
 * - Custom error code mapping
 * - Presets for common use cases
 *
 * @example
 * ```typescript
 * // Basic usage - standard envelope
 * server.use(createEnvelopeInterceptor())
 *
 * // With custom configuration
 * server.use(createEnvelopeInterceptor({
 *   includeDuration: true,
 *   includeRequestId: true,
 *   includeTimestamp: true,
 *   errorCodeMapper: (error) => error.code ?? 'INTERNAL_ERROR',
 * }))
 *
 * // Using presets
 * server.use(createEnvelopeInterceptor(EnvelopePresets.minimal))
 * server.use(createEnvelopeInterceptor(EnvelopePresets.standard))
 * server.use(createEnvelopeInterceptor(EnvelopePresets.detailed))
 * ```
 *
 * Response format:
 * ```json
 * // Success
 * {
 *   "success": true,
 *   "data": { ... },
 *   "meta": {
 *     "timestamp": "2024-01-15T10:30:00.000Z",
 *     "requestId": "abc123",
 *     "duration": 42
 *   }
 * }
 *
 * // Error
 * {
 *   "success": false,
 *   "error": {
 *     "message": "Validation failed",
 *     "code": "VALIDATION_ERROR",
 *     "details": { ... }
 *   },
 *   "meta": { ... }
 * }
 * ```
 */

import type { Interceptor, Envelope, Context } from '../../types/index.js'
import type { EnvelopeConfig } from '../types.js'

/**
 * WeakMap for memory-efficient timer tracking.
 * Automatically cleans up when envelope is garbage collected.
 */
const timers = new WeakMap<Envelope, bigint>()

/**
 * Standard envelope response format - success case
 */
export interface EnvelopeSuccess<T = unknown> {
  success: true
  data: T
  meta: EnvelopeMeta
}

/**
 * Standard envelope response format - error case
 */
export interface EnvelopeError {
  success: false
  error: {
    message: string
    code: string
    details?: unknown
  }
  meta: EnvelopeMeta
}

/**
 * Response metadata
 */
export interface EnvelopeMeta {
  timestamp?: string
  requestId?: string
  duration?: number
}

/**
 * Combined envelope response type
 */
export type EnvelopeResponse<T = unknown> = EnvelopeSuccess<T> | EnvelopeError

/**
 * Default error code mapper
 * Extracts code from error or returns a default
 */
function defaultErrorCodeMapper(error: Error): string {
  // Check for various error code properties
  const anyError = error as unknown as Record<string, unknown>

  if (typeof anyError.code === 'string') {
    return anyError.code
  }

  // Check for HTTP status codes
  if (typeof anyError.status === 'number') {
    return httpStatusToCode(anyError.status)
  }

  if (typeof anyError.statusCode === 'number') {
    return httpStatusToCode(anyError.statusCode)
  }

  // Default based on error name
  if (error.name === 'ValidationError') return 'VALIDATION_ERROR'
  if (error.name === 'UnauthorizedError') return 'UNAUTHORIZED'
  if (error.name === 'ForbiddenError') return 'FORBIDDEN'
  if (error.name === 'NotFoundError') return 'NOT_FOUND'

  return 'INTERNAL_ERROR'
}

/**
 * Map HTTP status codes to string error codes
 */
function httpStatusToCode(status: number): string {
  switch (status) {
    case 400: return 'BAD_REQUEST'
    case 401: return 'UNAUTHORIZED'
    case 403: return 'FORBIDDEN'
    case 404: return 'NOT_FOUND'
    case 405: return 'METHOD_NOT_ALLOWED'
    case 409: return 'CONFLICT'
    case 410: return 'GONE'
    case 422: return 'UNPROCESSABLE_ENTITY'
    case 429: return 'RATE_LIMIT_EXCEEDED'
    case 500: return 'INTERNAL_ERROR'
    case 502: return 'BAD_GATEWAY'
    case 503: return 'SERVICE_UNAVAILABLE'
    case 504: return 'GATEWAY_TIMEOUT'
    default: return status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'
  }
}

/**
 * Create a response envelope interceptor
 *
 * Wraps all handler responses in a standardized format with success/error
 * status and optional metadata like timestamp, requestId, and duration.
 *
 * @example
 * ```typescript
 * // Basic usage
 * const envelope = createEnvelopeInterceptor()
 *
 * // With all options
 * const envelope = createEnvelopeInterceptor({
 *   includeRequestId: true,
 *   includeDuration: true,
 *   includeTimestamp: true,
 *   includeErrorStack: process.env.NODE_ENV === 'development',
 *   errorCodeMapper: (error) => error.code ?? 'UNKNOWN_ERROR',
 * })
 *
 * server.use(envelope)
 * ```
 */
export function createEnvelopeInterceptor(config: EnvelopeConfig = {}): Interceptor {
  const {
    includeRequestId = true,
    includeDuration = true,
    includeTimestamp = true,
    includeErrorDetails = true,
    includeErrorStack = process.env.NODE_ENV === 'development',
    errorCodeMapper = defaultErrorCodeMapper,
  } = config

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    // Start timer for duration tracking
    if (includeDuration) {
      timers.set(envelope, process.hrtime.bigint())
    }

    // Build metadata
    const meta: EnvelopeMeta = {}

    if (includeTimestamp) {
      meta.timestamp = new Date().toISOString()
    }

    if (includeRequestId && ctx.requestId) {
      meta.requestId = ctx.requestId
    }

    try {
      const result = await next()

      // Calculate duration
      if (includeDuration) {
        const startTime = timers.get(envelope)
        if (startTime) {
          const endTime = process.hrtime.bigint()
          meta.duration = Math.round(Number(endTime - startTime) / 1_000_000)
          timers.delete(envelope)
        }
      }

      // Success response
      const response: EnvelopeSuccess = {
        success: true,
        data: result,
        meta,
      }

      return response
    } catch (error) {
      const err = error as Error

      // Calculate duration for error responses too
      if (includeDuration) {
        const startTime = timers.get(envelope)
        if (startTime) {
          const endTime = process.hrtime.bigint()
          meta.duration = Math.round(Number(endTime - startTime) / 1_000_000)
          timers.delete(envelope)
        }
      }

      // Build error response
      const errorPayload: EnvelopeError['error'] = {
        message: err.message,
        code: errorCodeMapper(err),
      }

      // Include error details if available
      if (includeErrorDetails) {
        const anyError = err as unknown as Record<string, unknown>
        if (anyError.details !== undefined) {
          errorPayload.details = anyError.details
        } else if (anyError.errors !== undefined) {
          // Common pattern for validation errors
          errorPayload.details = { errors: anyError.errors }
        } else if (anyError.data !== undefined) {
          errorPayload.details = anyError.data
        }
      }

      // Include stack trace in development
      if (includeErrorStack && err.stack) {
        errorPayload.details = {
          ...((errorPayload.details as object) ?? {}),
          stack: err.stack,
        }
      }

      const response: EnvelopeError = {
        success: false,
        error: errorPayload,
        meta,
      }

      // Return error response instead of throwing
      // This prevents the error from propagating up the chain
      return response
    }
  }
}

/**
 * Preset configurations for common use cases
 */
export const EnvelopePresets = {
  /**
   * Minimal envelope - just success/data/error, no metadata
   */
  minimal: {
    includeRequestId: false,
    includeDuration: false,
    includeTimestamp: false,
    includeErrorDetails: false,
    includeErrorStack: false,
  } satisfies EnvelopeConfig,

  /**
   * Standard envelope - includes all metadata, no stack traces
   */
  standard: {
    includeRequestId: true,
    includeDuration: true,
    includeTimestamp: true,
    includeErrorDetails: true,
    includeErrorStack: false,
  } satisfies EnvelopeConfig,

  /**
   * Detailed envelope for development - includes everything
   */
  detailed: {
    includeRequestId: true,
    includeDuration: true,
    includeTimestamp: true,
    includeErrorDetails: true,
    includeErrorStack: true,
  } satisfies EnvelopeConfig,
} as const

/**
 * Create a minimal envelope interceptor
 * Just success/data/error structure without metadata.
 */
export function createMinimalEnvelopeInterceptor(): Interceptor {
  return createEnvelopeInterceptor(EnvelopePresets.minimal)
}

/**
 * Create a production-ready envelope interceptor
 * Includes all metadata but no stack traces.
 */
export function createStandardEnvelopeInterceptor(): Interceptor {
  return createEnvelopeInterceptor(EnvelopePresets.standard)
}

/**
 * Create a development envelope interceptor
 * Includes everything including stack traces.
 */
export function createDetailedEnvelopeInterceptor(): Interceptor {
  return createEnvelopeInterceptor(EnvelopePresets.detailed)
}

/**
 * Type guard to check if a response is an envelope response
 */
export function isEnvelopeResponse(value: unknown): value is EnvelopeResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as EnvelopeResponse).success === 'boolean' &&
    (
      ((value as EnvelopeResponse).success === true && 'data' in value) ||
      ((value as EnvelopeResponse).success === false && 'error' in value)
    )
  )
}

/**
 * Type guard to check if an envelope response is successful
 */
export function isEnvelopeSuccess<T>(value: EnvelopeResponse<T>): value is EnvelopeSuccess<T> {
  return value.success === true
}

/**
 * Type guard to check if an envelope response is an error
 */
export function isEnvelopeError(value: EnvelopeResponse): value is EnvelopeError {
  return value.success === false
}
