/**
 * Error Codes
 *
 * Central definition of all Raffel error codes with both string identifiers
 * and numeric status codes. The numeric codes follow HTTP semantics for
 * familiarity but work across all transports.
 *
 * Status Code Ranges:
 * - 400-499: Client errors (bad request, auth, rate limit)
 * - 500-599: Server errors (internal, unavailable)
 */

/**
 * Error code definition with string identifier and numeric status
 */
export interface ErrorCodeDef {
  /** String identifier (e.g., 'NOT_FOUND') */
  code: string
  /** Numeric status code (e.g., 404) */
  status: number
  /** Default message */
  message: string
}

/**
 * All Raffel error codes
 *
 * Based on gRPC status codes with HTTP-compatible numeric values.
 */
export const ErrorCodes = {
  // ─────────────────────────────────────────────────────────────
  // 4xx - Client Errors
  // ─────────────────────────────────────────────────────────────

  /** Invalid argument provided */
  INVALID_ARGUMENT: {
    code: 'INVALID_ARGUMENT',
    status: 400,
    message: 'Invalid argument',
  },

  /** Validation failed */
  VALIDATION_ERROR: {
    code: 'VALIDATION_ERROR',
    status: 400,
    message: 'Validation failed',
  },

  /** Invalid envelope type */
  INVALID_TYPE: {
    code: 'INVALID_TYPE',
    status: 400,
    message: 'Invalid type',
  },

  /** Authentication required */
  UNAUTHENTICATED: {
    code: 'UNAUTHENTICATED',
    status: 401,
    message: 'Authentication required',
  },

  /** Permission denied */
  PERMISSION_DENIED: {
    code: 'PERMISSION_DENIED',
    status: 403,
    message: 'Permission denied',
  },

  /** Resource not found */
  NOT_FOUND: {
    code: 'NOT_FOUND',
    status: 404,
    message: 'Not found',
  },

  /** Resource already exists */
  ALREADY_EXISTS: {
    code: 'ALREADY_EXISTS',
    status: 409,
    message: 'Already exists',
  },

  /** Precondition failed */
  FAILED_PRECONDITION: {
    code: 'FAILED_PRECONDITION',
    status: 412,
    message: 'Precondition failed',
  },

  /** Request timeout / deadline exceeded (local) */
  DEADLINE_EXCEEDED: {
    code: 'DEADLINE_EXCEEDED',
    status: 408,
    message: 'Deadline exceeded',
  },

  /**
   * Unprocessable entity - semantically invalid request
   *
   * Use for business logic validation errors (e.g., "can't delete user with active orders")
   * vs VALIDATION_ERROR (400) for syntactic/schema validation
   */
  UNPROCESSABLE_ENTITY: {
    code: 'UNPROCESSABLE_ENTITY',
    status: 422,
    message: 'Unprocessable entity',
  },

  /** Rate limit exceeded */
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    status: 429,
    message: 'Rate limit exceeded',
  },

  /** Resource exhausted (quota, memory, etc.) */
  RESOURCE_EXHAUSTED: {
    code: 'RESOURCE_EXHAUSTED',
    status: 429,
    message: 'Resource exhausted',
  },

  /** Request cancelled by client */
  CANCELLED: {
    code: 'CANCELLED',
    status: 499, // nginx convention for client closed request
    message: 'Cancelled',
  },

  // ─────────────────────────────────────────────────────────────
  // 5xx - Server Errors
  // ─────────────────────────────────────────────────────────────

  /** Internal server error */
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    status: 500,
    message: 'Internal error',
  },

  /** Feature not implemented */
  UNIMPLEMENTED: {
    code: 'UNIMPLEMENTED',
    status: 501,
    message: 'Not implemented',
  },

  /**
   * Bad gateway - upstream service returned invalid response
   *
   * Use when acting as proxy/gateway and the upstream service
   * returns a malformed or unexpected response.
   */
  BAD_GATEWAY: {
    code: 'BAD_GATEWAY',
    status: 502,
    message: 'Bad gateway',
  },

  /** Service unavailable */
  UNAVAILABLE: {
    code: 'UNAVAILABLE',
    status: 503,
    message: 'Service unavailable',
  },

  /**
   * Gateway timeout - upstream service did not respond in time
   *
   * Use when acting as proxy/gateway and the upstream service
   * times out. Different from DEADLINE_EXCEEDED (408) which is local.
   */
  GATEWAY_TIMEOUT: {
    code: 'GATEWAY_TIMEOUT',
    status: 504,
    message: 'Gateway timeout',
  },

  /** Data loss or corruption */
  DATA_LOSS: {
    code: 'DATA_LOSS',
    status: 500,
    message: 'Data loss',
  },

  /** Stream error */
  STREAM_ERROR: {
    code: 'STREAM_ERROR',
    status: 500,
    message: 'Stream error',
  },

  /** Unknown error */
  UNKNOWN: {
    code: 'UNKNOWN',
    status: 500,
    message: 'Unknown error',
  },
} as const satisfies Record<string, ErrorCodeDef>

/**
 * Error code type (string union)
 */
export type ErrorCode = keyof typeof ErrorCodes

/**
 * Get error code definition by string code
 */
export function getErrorCode(code: string): ErrorCodeDef {
  const def = (ErrorCodes as Record<string, ErrorCodeDef>)[code]
  if (def) {
    return def
  }

  // Return unknown for unrecognized codes
  return {
    code,
    status: 500,
    message: code,
  }
}

/**
 * Get numeric status for a string code
 */
export function getStatusForCode(code: string): number {
  return getErrorCode(code).status
}

/**
 * Check if status code is a client error (4xx)
 */
export function isClientError(status: number): boolean {
  return status >= 400 && status < 500
}

/**
 * Check if status code is a server error (5xx)
 */
export function isServerError(status: number): boolean {
  return status >= 500 && status < 600
}

/**
 * Check if error is retryable based on code
 *
 * Generally, 5xx errors and some 4xx (rate limit, timeout) are retryable.
 */
export function isRetryable(code: string): boolean {
  switch (code) {
    // Retryable server errors
    case 'UNAVAILABLE':
    case 'RESOURCE_EXHAUSTED':
    case 'DEADLINE_EXCEEDED':
    case 'RATE_LIMITED':
    case 'BAD_GATEWAY':
    case 'GATEWAY_TIMEOUT':
      return true

    // Not retryable - would just fail again
    case 'INVALID_ARGUMENT':
    case 'VALIDATION_ERROR':
    case 'UNPROCESSABLE_ENTITY':
    case 'UNAUTHENTICATED':
    case 'PERMISSION_DENIED':
    case 'NOT_FOUND':
    case 'ALREADY_EXISTS':
    case 'FAILED_PRECONDITION':
    case 'CANCELLED':
    case 'UNIMPLEMENTED':
    case 'DATA_LOSS':
      return false

    // Internal errors might be transient
    case 'INTERNAL_ERROR':
    case 'UNKNOWN':
    case 'STREAM_ERROR':
      return true

    default:
      return false
  }
}
