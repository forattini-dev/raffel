/**
 * HTTP Error Classes
 *
 * Typed error classes for common HTTP error responses.
 * Each error class corresponds to a specific HTTP status code and can be
 * thrown in handlers to automatically generate appropriate responses.
 *
 * @example
 * import { HttpNotFoundError, HttpValidationError, createHttpError } from 'raffel/http'
 *
 * // Throw specific error
 * throw new HttpNotFoundError('User not found')
 *
 * // Throw with details
 * throw new HttpValidationError('Validation failed', [
 *   { field: 'email', message: 'Invalid email format' }
 * ])
 *
 * // Create error dynamically
 * throw createHttpError(403, 'Access denied')
 *
 * // Error handler middleware
 * app.onError((err, c) => {
 *   if (err instanceof HttpError) {
 *     return err.toResponse()
 *   }
 *   return c.json({ error: 'Internal Server Error' }, 500)
 * })
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HTTP error options
 */
export interface HttpErrorOptions {
  /** Error code (e.g., 'NOT_FOUND', 'VALIDATION_ERROR') */
  code?: string
  /** Additional error details */
  details?: unknown
  /** Original error that caused this error */
  cause?: Error
}

/**
 * Validation error detail
 */
export interface ValidationDetail {
  field: string
  message: string
  value?: unknown
}

// ─────────────────────────────────────────────────────────────────────────────
// Base Error Class
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base HTTP Error class
 *
 * All specific HTTP error classes extend this base class.
 */
export class HttpError extends Error {
  /** HTTP status code */
  readonly status: number
  /** Error code for programmatic handling */
  readonly code: string
  /** Additional error details */
  readonly details?: unknown

  constructor(message: string, status: number, options: HttpErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'HttpError'
    this.status = status
    this.code = options.code || this.defaultCode(status)
    this.details = options.details

    // Maintain proper stack trace in V8
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }
  }

  /**
   * Convert error to JSON response
   */
  toResponse(): Response {
    const body = {
      success: false,
      error: {
        message: this.message,
        code: this.code,
        ...(this.details !== undefined && { details: this.details }),
      },
    }

    return new Response(JSON.stringify(body), {
      status: this.status,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
      },
    })
  }

  /**
   * Convert error to plain object
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      status: this.status,
      code: this.code,
      details: this.details,
    }
  }

  /**
   * Get default error code from status
   */
  private defaultCode(status: number): string {
    const codes: Record<number, string> = {
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
    return codes[status] || 'ERROR'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4xx Client Error Classes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 400 Bad Request Error
 *
 * The server cannot process the request due to client error.
 */
export class HttpBadRequestError extends HttpError {
  constructor(message: string = 'Bad Request', options?: HttpErrorOptions) {
    super(message, 400, { code: 'BAD_REQUEST', ...options })
    this.name = 'HttpBadRequestError'
  }
}

/**
 * 401 Unauthorized Error
 *
 * Authentication is required but was not provided or is invalid.
 */
export class HttpUnauthorizedError extends HttpError {
  constructor(message: string = 'Unauthorized', options?: HttpErrorOptions) {
    super(message, 401, { code: 'UNAUTHORIZED', ...options })
    this.name = 'HttpUnauthorizedError'
  }
}

/**
 * 402 Payment Required Error
 *
 * Payment is required to access this resource.
 */
export class HttpPaymentRequiredError extends HttpError {
  constructor(message: string = 'Payment Required', options?: HttpErrorOptions) {
    super(message, 402, { code: 'PAYMENT_REQUIRED', ...options })
    this.name = 'HttpPaymentRequiredError'
  }
}

/**
 * 403 Forbidden Error
 *
 * The server understood the request but refuses to authorize it.
 */
export class HttpForbiddenError extends HttpError {
  constructor(message: string = 'Forbidden', options?: HttpErrorOptions) {
    super(message, 403, { code: 'FORBIDDEN', ...options })
    this.name = 'HttpForbiddenError'
  }
}

/**
 * 404 Not Found Error
 *
 * The requested resource could not be found.
 */
export class HttpNotFoundError extends HttpError {
  constructor(message: string = 'Not Found', options?: HttpErrorOptions) {
    super(message, 404, { code: 'NOT_FOUND', ...options })
    this.name = 'HttpNotFoundError'
  }
}

/**
 * 405 Method Not Allowed Error
 *
 * The request method is not supported for the requested resource.
 */
export class HttpMethodNotAllowedError extends HttpError {
  /** Allowed HTTP methods */
  readonly allowedMethods: string[]

  constructor(
    message: string = 'Method Not Allowed',
    allowedMethods: string[] = [],
    options?: HttpErrorOptions
  ) {
    super(message, 405, { code: 'METHOD_NOT_ALLOWED', ...options })
    this.name = 'HttpMethodNotAllowedError'
    this.allowedMethods = allowedMethods
  }

  override toResponse(): Response {
    const body = {
      success: false,
      error: {
        message: this.message,
        code: this.code,
        ...(this.details !== undefined && { details: this.details }),
      },
    }

    return new Response(JSON.stringify(body), {
      status: this.status,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        ...(this.allowedMethods.length > 0 && { Allow: this.allowedMethods.join(', ') }),
      },
    })
  }
}

/**
 * 408 Request Timeout Error
 *
 * The server timed out waiting for the request.
 */
export class HttpRequestTimeoutError extends HttpError {
  constructor(message: string = 'Request Timeout', options?: HttpErrorOptions) {
    super(message, 408, { code: 'REQUEST_TIMEOUT', ...options })
    this.name = 'HttpRequestTimeoutError'
  }
}

/**
 * 409 Conflict Error
 *
 * The request conflicts with the current state of the resource.
 */
export class HttpConflictError extends HttpError {
  constructor(message: string = 'Conflict', options?: HttpErrorOptions) {
    super(message, 409, { code: 'CONFLICT', ...options })
    this.name = 'HttpConflictError'
  }
}

/**
 * 410 Gone Error
 *
 * The requested resource is no longer available.
 */
export class HttpGoneError extends HttpError {
  constructor(message: string = 'Gone', options?: HttpErrorOptions) {
    super(message, 410, { code: 'GONE', ...options })
    this.name = 'HttpGoneError'
  }
}

/**
 * 413 Payload Too Large Error
 *
 * The request payload is larger than the server is willing to process.
 */
export class HttpPayloadTooLargeError extends HttpError {
  constructor(message: string = 'Payload Too Large', options?: HttpErrorOptions) {
    super(message, 413, { code: 'PAYLOAD_TOO_LARGE', ...options })
    this.name = 'HttpPayloadTooLargeError'
  }
}

/**
 * 415 Unsupported Media Type Error
 *
 * The media format of the requested data is not supported.
 */
export class HttpUnsupportedMediaTypeError extends HttpError {
  constructor(message: string = 'Unsupported Media Type', options?: HttpErrorOptions) {
    super(message, 415, { code: 'UNSUPPORTED_MEDIA_TYPE', ...options })
    this.name = 'HttpUnsupportedMediaTypeError'
  }
}

/**
 * 422 Unprocessable Entity Error
 *
 * The request was well-formed but contains semantic errors.
 */
export class HttpUnprocessableEntityError extends HttpError {
  constructor(message: string = 'Unprocessable Entity', options?: HttpErrorOptions) {
    super(message, 422, { code: 'UNPROCESSABLE_ENTITY', ...options })
    this.name = 'HttpUnprocessableEntityError'
  }
}

/**
 * 400 Validation Error (special case with validation details)
 *
 * The request contains validation errors.
 */
export class HttpValidationError extends HttpError {
  /** Validation error details */
  readonly errors: ValidationDetail[]

  constructor(message: string = 'Validation Error', errors: ValidationDetail[] = []) {
    super(message, 400, {
      code: 'VALIDATION_ERROR',
      details: { errors },
    })
    this.name = 'HttpValidationError'
    this.errors = errors
  }
}

/**
 * 429 Too Many Requests Error
 *
 * The user has sent too many requests in a given amount of time.
 */
export class HttpTooManyRequestsError extends HttpError {
  /** Seconds until retry is allowed */
  readonly retryAfter?: number

  constructor(
    message: string = 'Too Many Requests',
    retryAfter?: number,
    options?: HttpErrorOptions
  ) {
    super(message, 429, { code: 'TOO_MANY_REQUESTS', ...options })
    this.name = 'HttpTooManyRequestsError'
    this.retryAfter = retryAfter
  }

  override toResponse(): Response {
    const body = {
      success: false,
      error: {
        message: this.message,
        code: this.code,
        ...(this.details !== undefined && { details: this.details }),
      },
    }

    return new Response(JSON.stringify(body), {
      status: this.status,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        ...(this.retryAfter !== undefined && { 'Retry-After': this.retryAfter.toString() }),
      },
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5xx Server Error Classes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 500 Internal Server Error
 *
 * The server encountered an unexpected condition.
 */
export class HttpInternalServerError extends HttpError {
  constructor(message: string = 'Internal Server Error', options?: HttpErrorOptions) {
    super(message, 500, { code: 'INTERNAL_SERVER_ERROR', ...options })
    this.name = 'HttpInternalServerError'
  }
}

/**
 * 501 Not Implemented Error
 *
 * The server does not support the functionality required.
 */
export class HttpNotImplementedError extends HttpError {
  constructor(message: string = 'Not Implemented', options?: HttpErrorOptions) {
    super(message, 501, { code: 'NOT_IMPLEMENTED', ...options })
    this.name = 'HttpNotImplementedError'
  }
}

/**
 * 502 Bad Gateway Error
 *
 * The server received an invalid response from the upstream server.
 */
export class HttpBadGatewayError extends HttpError {
  constructor(message: string = 'Bad Gateway', options?: HttpErrorOptions) {
    super(message, 502, { code: 'BAD_GATEWAY', ...options })
    this.name = 'HttpBadGatewayError'
  }
}

/**
 * 503 Service Unavailable Error
 *
 * The server is not ready to handle the request.
 */
export class HttpServiceUnavailableError extends HttpError {
  /** Seconds until service is expected to be available */
  readonly retryAfter?: number

  constructor(
    message: string = 'Service Unavailable',
    retryAfter?: number,
    options?: HttpErrorOptions
  ) {
    super(message, 503, { code: 'SERVICE_UNAVAILABLE', ...options })
    this.name = 'HttpServiceUnavailableError'
    this.retryAfter = retryAfter
  }

  override toResponse(): Response {
    const body = {
      success: false,
      error: {
        message: this.message,
        code: this.code,
        ...(this.details !== undefined && { details: this.details }),
      },
    }

    return new Response(JSON.stringify(body), {
      status: this.status,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        ...(this.retryAfter !== undefined && { 'Retry-After': this.retryAfter.toString() }),
      },
    })
  }
}

/**
 * 504 Gateway Timeout Error
 *
 * The server did not receive a timely response from the upstream server.
 */
export class HttpGatewayTimeoutError extends HttpError {
  constructor(message: string = 'Gateway Timeout', options?: HttpErrorOptions) {
    super(message, 504, { code: 'GATEWAY_TIMEOUT', ...options })
    this.name = 'HttpGatewayTimeoutError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create an HTTP error dynamically based on status code
 *
 * @param status - HTTP status code
 * @param message - Error message
 * @param details - Additional error details
 * @returns Appropriate HttpError subclass instance
 *
 * @example
 * throw createHttpError(404, 'User not found')
 * throw createHttpError(400, 'Invalid input', { field: 'email' })
 */
export function createHttpError(
  status: number,
  message?: string,
  details?: unknown
): HttpError {
  const options: HttpErrorOptions = details !== undefined ? { details } : {}

  switch (status) {
    case 400:
      return new HttpBadRequestError(message, options)
    case 401:
      return new HttpUnauthorizedError(message, options)
    case 402:
      return new HttpPaymentRequiredError(message, options)
    case 403:
      return new HttpForbiddenError(message, options)
    case 404:
      return new HttpNotFoundError(message, options)
    case 405:
      return new HttpMethodNotAllowedError(message, [], options)
    case 408:
      return new HttpRequestTimeoutError(message, options)
    case 409:
      return new HttpConflictError(message, options)
    case 410:
      return new HttpGoneError(message, options)
    case 413:
      return new HttpPayloadTooLargeError(message, options)
    case 415:
      return new HttpUnsupportedMediaTypeError(message, options)
    case 422:
      return new HttpUnprocessableEntityError(message, options)
    case 429:
      return new HttpTooManyRequestsError(message, undefined, options)
    case 500:
      return new HttpInternalServerError(message, options)
    case 501:
      return new HttpNotImplementedError(message, options)
    case 502:
      return new HttpBadGatewayError(message, options)
    case 503:
      return new HttpServiceUnavailableError(message, undefined, options)
    case 504:
      return new HttpGatewayTimeoutError(message, options)
    default:
      return new HttpError(message || 'Error', status, options)
  }
}

/**
 * Check if an error is an HTTP error
 */
export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  HttpError,
  HttpBadRequestError,
  HttpUnauthorizedError,
  HttpPaymentRequiredError,
  HttpForbiddenError,
  HttpNotFoundError,
  HttpMethodNotAllowedError,
  HttpRequestTimeoutError,
  HttpConflictError,
  HttpGoneError,
  HttpPayloadTooLargeError,
  HttpUnsupportedMediaTypeError,
  HttpUnprocessableEntityError,
  HttpValidationError,
  HttpTooManyRequestsError,
  HttpInternalServerError,
  HttpNotImplementedError,
  HttpBadGatewayError,
  HttpServiceUnavailableError,
  HttpGatewayTimeoutError,
  createHttpError,
  isHttpError,
}
