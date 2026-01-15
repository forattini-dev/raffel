/**
 * Unified Error Handling
 *
 * Provides consistent error handling across all protocols.
 * Normalizes errors to a standard format and provides helpers for error transformation.
 *
 * @example
 * import { normalizeError, isOperationalError, createErrorInterceptor } from 'raffel/server/errors'
 *
 * // Normalize any error to consistent format
 * const normalized = normalizeError(error)
 * console.log(normalized.code, normalized.status, normalized.message)
 *
 * // Create an error interceptor for logging/reporting
 * server.use(createErrorInterceptor({
 *   onError: (error, ctx) => {
 *     logger.error({ error: normalizeError(error), requestId: ctx.requestId })
 *   },
 * }))
 */

import type { Context, Interceptor, Envelope } from '../types/index.js'
import type { NormalizedError, GlobalErrorHandler, ErrorProtocol } from './types.js'
import { RaffelError } from '../core/router.js'

// ─────────────────────────────────────────────────────────────────────────────
// Error Normalization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if an error is an HttpError from the http module
 */
function isHttpError(error: unknown): error is {
  name: string
  status: number
  code: string
  message: string
  details?: unknown
} {
  return (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    'code' in error &&
    typeof (error as any).status === 'number'
  )
}

/**
 * Check if an error is a RaffelError
 */
function isRaffelError(error: unknown): error is RaffelError {
  return error instanceof RaffelError
}

/**
 * Get HTTP-compatible status from error code
 */
function getStatusForCode(code: string): number {
  const codeMap: Record<string, number> = {
    // 4xx Client Errors
    BAD_REQUEST: 400,
    VALIDATION_ERROR: 400,
    INVALID_INPUT: 400,
    UNAUTHORIZED: 401,
    UNAUTHENTICATED: 401,
    FORBIDDEN: 403,
    PERMISSION_DENIED: 403,
    NOT_FOUND: 404,
    HANDLER_NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    CONFLICT: 409,
    ALREADY_EXISTS: 409,
    PAYLOAD_TOO_LARGE: 413,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,
    RATE_LIMITED: 429,

    // 5xx Server Errors
    INTERNAL_ERROR: 500,
    INTERNAL_SERVER_ERROR: 500,
    NOT_IMPLEMENTED: 501,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504,
    TIMEOUT: 504,
  }

  return codeMap[code] ?? 500
}

/**
 * Normalize any error to a consistent format
 *
 * @example
 * try {
 *   await handler()
 * } catch (error) {
 *   const normalized = normalizeError(error)
 *   return { error: normalized }
 * }
 */
export function normalizeError(error: unknown, includeStack = false): NormalizedError {
  // Already a RaffelError
  if (isRaffelError(error)) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
      cause: error,
      stack: includeStack ? error.stack : undefined,
    }
  }

  // HttpError or similar structured error
  if (isHttpError(error)) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
      cause: error as Error,
      stack: includeStack ? (error as Error).stack : undefined,
    }
  }

  // Standard Error
  if (error instanceof Error) {
    // Check for common error properties
    const anyError = error as any
    const code = anyError.code ?? anyError.errorCode ?? 'INTERNAL_SERVER_ERROR'
    const status = anyError.status ?? anyError.statusCode ?? getStatusForCode(code)

    return {
      code: typeof code === 'string' ? code : 'INTERNAL_SERVER_ERROR',
      status: typeof status === 'number' ? status : 500,
      message: error.message || 'An unexpected error occurred',
      details: anyError.details,
      cause: error,
      stack: includeStack ? error.stack : undefined,
    }
  }

  // Non-Error thrown value
  const message = typeof error === 'string' ? error : 'An unexpected error occurred'
  return {
    code: 'INTERNAL_SERVER_ERROR',
    status: 500,
    message,
    cause: new Error(message),
  }
}

/**
 * Check if an error is "operational" (expected, safe to show to users)
 * vs "programmer error" (bug, should not expose details)
 *
 * Operational errors:
 * - RaffelError
 * - HttpError
 * - Errors with 4xx status codes
 *
 * Programmer errors:
 * - TypeError, ReferenceError
 * - Errors without explicit status
 * - 5xx errors (unless explicitly thrown)
 */
export function isOperationalError(error: unknown): boolean {
  if (isRaffelError(error) || isHttpError(error)) {
    const status = (error as any).status
    return status >= 400 && status < 500
  }
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Interceptor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for the error interceptor
 */
export interface ErrorInterceptorOptions {
  /**
   * Called when an error occurs
   */
  onError: (error: Error, ctx: Context, envelope: Envelope) => void | Promise<void>

  /**
   * Whether to rethrow the error after handling
   * @default true
   */
  rethrow?: boolean

  /**
   * Transform the error before rethrowing
   * Return undefined to keep original error
   */
  transform?: (error: Error, ctx: Context) => Error | undefined
}

/**
 * Create an interceptor that catches and handles errors
 *
 * @example
 * server.use(createErrorInterceptor({
 *   onError: (error, ctx) => {
 *     // Log to console
 *     console.error(`[${ctx.requestId}]`, error.message)
 *
 *     // Report to error tracking
 *     errorTracker.captureException(error, {
 *       tags: { requestId: ctx.requestId },
 *     })
 *   },
 * }))
 */
export function createErrorInterceptor(options: ErrorInterceptorOptions): Interceptor {
  const { onError, rethrow = true, transform } = options

  return async (envelope, ctx, next) => {
    try {
      return await next()
    } catch (error) {
      // Call error handler
      await onError(error as Error, ctx, envelope)

      // Transform if needed
      const transformedError = transform
        ? (transform(error as Error, ctx) ?? error)
        : error

      // Rethrow or swallow
      if (rethrow) {
        throw transformedError
      }

      // Return error envelope if not rethrowing
      const normalized = normalizeError(transformedError)
      return {
        success: false as const,
        error: {
          code: normalized.code,
          message: normalized.message,
          details: normalized.details,
        },
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Response Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a standard error response envelope
 */
export function createErrorEnvelope(error: unknown): {
  success: false
  error: { code: string; message: string; details?: unknown }
} {
  const normalized = normalizeError(error)
  const errorObj: { code: string; message: string; details?: unknown } = {
    code: normalized.code,
    message: normalized.message,
  }
  if (normalized.details !== undefined) {
    errorObj.details = normalized.details
  }
  return {
    success: false,
    error: errorObj,
  }
}

/**
 * Create a RaffelError from any error
 */
export function toRaffelError(error: unknown): RaffelError {
  if (isRaffelError(error)) {
    return error
  }

  const normalized = normalizeError(error)
  return new RaffelError(
    normalized.code,
    normalized.message,
    normalized.details,
    normalized.status
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Protocol-Specific Error Formatters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format error for HTTP response
 */
export function formatHttpError(error: unknown): {
  status: number
  body: { success: false; error: { code: string; message: string; details?: unknown } }
} {
  const normalized = normalizeError(error)
  const errorObj: { code: string; message: string; details?: unknown } = {
    code: normalized.code,
    message: normalized.message,
  }
  if (normalized.details !== undefined) {
    errorObj.details = normalized.details
  }
  return {
    status: normalized.status,
    body: {
      success: false,
      error: errorObj,
    },
  }
}

/**
 * Format error for JSON-RPC response
 */
export function formatJsonRpcError(
  error: unknown,
  id: string | number | null
): {
  jsonrpc: '2.0'
  id: string | number | null
  error: { code: number; message: string; data?: unknown }
} {
  const normalized = normalizeError(error)

  // JSON-RPC error codes
  // -32700 Parse error
  // -32600 Invalid Request
  // -32601 Method not found
  // -32602 Invalid params
  // -32603 Internal error
  // -32000 to -32099 Server error (reserved)
  let rpcCode: number
  switch (normalized.code) {
    case 'PARSE_ERROR':
      rpcCode = -32700
      break
    case 'INVALID_REQUEST':
    case 'BAD_REQUEST':
      rpcCode = -32600
      break
    case 'NOT_FOUND':
    case 'HANDLER_NOT_FOUND':
      rpcCode = -32601
      break
    case 'VALIDATION_ERROR':
    case 'INVALID_INPUT':
      rpcCode = -32602
      break
    default:
      // Map HTTP status to JSON-RPC server error range
      rpcCode = normalized.status >= 500 ? -32603 : -32000 - (normalized.status - 400)
  }

  const errorObj: { code: number; message: string; data?: unknown } = {
    code: rpcCode,
    message: normalized.message,
  }
  if (normalized.details !== undefined) {
    errorObj.data = normalized.details
  }
  return {
    jsonrpc: '2.0',
    id,
    error: errorObj,
  }
}

/**
 * Format error for WebSocket message
 */
export function formatWebSocketError(error: unknown, messageId?: string): {
  type: 'error'
  id?: string
  code: string
  message: string
  details?: unknown
} {
  const normalized = normalizeError(error)
  const result: {
    type: 'error'
    id?: string
    code: string
    message: string
    details?: unknown
  } = {
    type: 'error',
    code: normalized.code,
    message: normalized.message,
  }
  if (messageId !== undefined) {
    result.id = messageId
  }
  if (normalized.details !== undefined) {
    result.details = normalized.details
  }
  return result
}

/**
 * Format error for SSE stream
 */
export function formatStreamError(error: unknown): string {
  const normalized = normalizeError(error)
  const errorObj: { code: string; message: string; details?: unknown } = {
    code: normalized.code,
    message: normalized.message,
  }
  if (normalized.details !== undefined) {
    errorObj.details = normalized.details
  }
  const data = JSON.stringify(errorObj)
  return `event: error\ndata: ${data}\n\n`
}

// ─────────────────────────────────────────────────────────────────────────────
// Global Error Handler Helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a global error handler with common error reporting patterns
 *
 * @example
 * const server = createServer({
 *   port: 3000,
 *   onError: createGlobalErrorHandler({
 *     log: true,
 *     logLevel: 'error',
 *     reportTo: (error, protocol, ctx) => {
 *       sentry.captureException(error, {
 *         tags: { protocol },
 *         extra: { requestId: ctx?.requestId },
 *       })
 *     },
 *   }),
 * })
 */
export function createGlobalErrorHandler(options: {
  /**
   * Log errors to console
   * @default true
   */
  log?: boolean

  /**
   * Log level for errors
   * @default 'error'
   */
  logLevel?: 'error' | 'warn' | 'info'

  /**
   * Only log operational errors (4xx) at warn level
   * @default true
   */
  operationalAsWarn?: boolean

  /**
   * Custom error reporter
   */
  reportTo?: GlobalErrorHandler

  /**
   * Filter errors before reporting
   * Return false to skip reporting for an error
   */
  filter?: (error: Error, protocol: ErrorProtocol) => boolean
}): GlobalErrorHandler {
  const {
    log = true,
    logLevel = 'error',
    operationalAsWarn = true,
    reportTo,
    filter,
  } = options

  return async (error, protocol, ctx) => {
    // Filter check
    if (filter && !filter(error, protocol)) {
      return
    }

    // Determine log level
    const level = operationalAsWarn && isOperationalError(error)
      ? 'warn'
      : logLevel

    // Log to console
    if (log) {
      const normalized = normalizeError(error)
      const logFn = console[level as 'error' | 'warn' | 'info']
      logFn(
        `[${protocol}] Error ${normalized.code} (${normalized.status}):`,
        normalized.message,
        ctx?.requestId ? `[${ctx.requestId}]` : ''
      )
    }

    // Report to external service
    if (reportTo) {
      await reportTo(error, protocol, ctx)
    }
  }
}
