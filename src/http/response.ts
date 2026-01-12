/**
 * Response Formatters
 *
 * Standardized response helpers for consistent API responses.
 * These formatters provide a unified structure for success, error, and list responses.
 *
 * @example
 * import { success, error, list, created, notFound, validationError } from 'raffel/http'
 *
 * // Success response
 * return success({ id: '123', name: 'John' })
 * // → { success: true, data: { id: '123', name: 'John' } }
 *
 * // Error response
 * return error('User not found', 404)
 * // → { success: false, error: { message: 'User not found', code: 'NOT_FOUND' } }
 *
 * // List response with pagination
 * return list(users, { page: 1, pageSize: 10, total: 100 })
 * // → { success: true, data: [...], pagination: { page: 1, pageSize: 10, total: 100, totalPages: 10 } }
 *
 * // Convenience helpers
 * return created({ id: '123' })
 * return notFound('User not found')
 * return validationError([{ field: 'email', message: 'Invalid email' }])
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard success response structure
 */
export interface SuccessResponse<T = unknown> {
  success: true
  data: T
}

/**
 * Standard error response structure
 */
export interface ErrorResponse {
  success: false
  error: {
    message: string
    code?: string
    details?: unknown
  }
}

/**
 * Pagination metadata
 */
export interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

/**
 * Pagination input options
 */
export interface PaginationOptions {
  page?: number
  pageSize?: number
  total: number
}

/**
 * Standard list response with pagination
 */
export interface ListResponse<T = unknown> extends SuccessResponse<T[]> {
  pagination: PaginationMeta
}

/**
 * Validation error details
 */
export interface ValidationErrorDetail {
  field: string
  message: string
  value?: unknown
}

/**
 * Response options
 */
export interface ResponseOptions {
  status?: number
  headers?: Record<string, string>
}

/**
 * Error code mapping
 */
const HTTP_ERROR_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
}

// ─────────────────────────────────────────────────────────────────────────────
// Response Formatters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a success response
 *
 * @param data - Response data
 * @param options - Response options (status, headers)
 * @returns JSON response with success structure
 *
 * @example
 * return success({ user: { id: '1', name: 'John' } })
 * return success(user, { status: 200 })
 */
export function success<T>(data: T, options: ResponseOptions = {}): Response {
  const body: SuccessResponse<T> = {
    success: true,
    data,
  }

  return createJsonResponse(body, options.status ?? 200, options.headers)
}

/**
 * Create an error response
 *
 * @param message - Error message
 * @param status - HTTP status code (default: 500)
 * @param details - Additional error details
 * @returns JSON response with error structure
 *
 * @example
 * return error('User not found', 404)
 * return error('Validation failed', 400, { field: 'email' })
 */
export function error(
  message: string,
  status: number = 500,
  details?: unknown
): Response {
  const body: ErrorResponse = {
    success: false,
    error: {
      message,
      code: HTTP_ERROR_CODES[status] || 'ERROR',
      ...(details !== undefined && { details }),
    },
  }

  return createJsonResponse(body, status)
}

/**
 * Create a list response with pagination
 *
 * @param items - Array of items
 * @param pagination - Pagination options
 * @param options - Response options
 * @returns JSON response with list and pagination
 *
 * @example
 * return list(users, { page: 1, pageSize: 10, total: 100 })
 */
export function list<T>(
  items: T[],
  pagination: PaginationOptions,
  options: ResponseOptions = {}
): Response {
  const page = pagination.page ?? 1
  const pageSize = pagination.pageSize ?? items.length
  const total = pagination.total
  const totalPages = Math.ceil(total / pageSize)

  const body: ListResponse<T> = {
    success: true,
    data: items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  }

  return createJsonResponse(body, options.status ?? 200, options.headers)
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience Formatters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a 201 Created response
 *
 * @param data - Created resource data
 * @param options - Response options
 */
export function created<T>(data: T, options: ResponseOptions = {}): Response {
  return success(data, { ...options, status: 201 })
}

/**
 * Create a 204 No Content response
 */
export function noContent(): Response {
  return new Response(null, { status: 204 })
}

/**
 * Create a 202 Accepted response
 *
 * @param data - Optional acceptance details
 */
export function accepted<T>(data?: T): Response {
  if (data === undefined) {
    return new Response(null, { status: 202 })
  }
  return success(data, { status: 202 })
}

/**
 * Create a 400 Bad Request response
 *
 * @param message - Error message
 * @param details - Additional error details
 */
export function badRequest(message: string = 'Bad Request', details?: unknown): Response {
  return error(message, 400, details)
}

/**
 * Create a 401 Unauthorized response
 *
 * @param message - Error message
 */
export function unauthorized(message: string = 'Unauthorized'): Response {
  return error(message, 401)
}

/**
 * Create a 403 Forbidden response
 *
 * @param message - Error message
 */
export function forbidden(message: string = 'Forbidden'): Response {
  return error(message, 403)
}

/**
 * Create a 404 Not Found response
 *
 * @param message - Error message
 */
export function notFound(message: string = 'Not Found'): Response {
  return error(message, 404)
}

/**
 * Create a 405 Method Not Allowed response
 *
 * @param allowed - Allowed methods
 */
export function methodNotAllowed(allowed: string[]): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message: 'Method Not Allowed',
        code: 'METHOD_NOT_ALLOWED',
      },
    }),
    {
      status: 405,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Allow: allowed.join(', '),
      },
    }
  )
}

/**
 * Create a 409 Conflict response
 *
 * @param message - Error message
 * @param details - Conflict details
 */
export function conflict(message: string = 'Conflict', details?: unknown): Response {
  return error(message, 409, details)
}

/**
 * Create a 422 Unprocessable Entity response (validation errors)
 *
 * @param errors - Array of validation error details
 */
export function validationError(errors: ValidationErrorDetail[]): Response {
  const body: ErrorResponse = {
    success: false,
    error: {
      message: 'Validation Error',
      code: 'VALIDATION_ERROR',
      details: { errors },
    },
  }

  return createJsonResponse(body, 422)
}

/**
 * Create a 429 Too Many Requests response
 *
 * @param message - Error message
 * @param retryAfter - Seconds until retry is allowed
 */
export function tooManyRequests(
  message: string = 'Too Many Requests',
  retryAfter?: number
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=UTF-8',
  }

  if (retryAfter !== undefined) {
    headers['Retry-After'] = retryAfter.toString()
  }

  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message,
        code: 'TOO_MANY_REQUESTS',
      },
    }),
    { status: 429, headers }
  )
}

/**
 * Create a 500 Internal Server Error response
 *
 * @param message - Error message (defaults to generic message for security)
 */
export function serverError(message: string = 'Internal Server Error'): Response {
  return error(message, 500)
}

/**
 * Create a 503 Service Unavailable response
 *
 * @param message - Error message
 * @param retryAfter - Seconds until service is expected to be available
 */
export function serviceUnavailable(
  message: string = 'Service Unavailable',
  retryAfter?: number
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=UTF-8',
  }

  if (retryAfter !== undefined) {
    headers['Retry-After'] = retryAfter.toString()
  }

  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message,
        code: 'SERVICE_UNAVAILABLE',
      },
    }),
    { status: 503, headers }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filter protected fields from response data
 *
 * Removes sensitive fields from objects before sending in response.
 * Works recursively on nested objects and arrays.
 *
 * @param data - Data to filter
 * @param fields - Array of field names to remove
 * @returns Filtered data copy
 *
 * @example
 * const user = { id: '1', name: 'John', password: 'hash', apiKey: 'secret' }
 * const safe = filterProtectedFields(user, ['password', 'apiKey'])
 * // → { id: '1', name: 'John' }
 */
export function filterProtectedFields<T>(data: T, fields: string[]): T {
  if (data === null || data === undefined) {
    return data
  }

  if (Array.isArray(data)) {
    return data.map((item) => filterProtectedFields(item, fields)) as T
  }

  if (typeof data === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (!fields.includes(key)) {
        result[key] = filterProtectedFields(value, fields)
      }
    }
    return result as T
  }

  return data
}

/**
 * Create JSON response with proper headers
 */
function createJsonResponse(
  body: unknown,
  status: number,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      ...headers,
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  success,
  error,
  list,
  created,
  noContent,
  accepted,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  methodNotAllowed,
  conflict,
  validationError,
  tooManyRequests,
  serverError,
  serviceUnavailable,
  filterProtectedFields,
}
