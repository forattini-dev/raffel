/**
 * Error Factories
 *
 * Pre-built error helpers for common error scenarios.
 * Each factory creates a RaffelError with both string code and numeric status.
 */

import { RaffelError } from '../core/router.js'
import { ErrorCodes } from './codes.js'

/**
 * Pre-built error factories for consistent error handling
 *
 * All factories create errors with both string code and numeric status.
 *
 * @example
 * ```typescript
 * throw Errors.notFound('User', userId)
 * // Creates: { code: 'NOT_FOUND', status: 404, message: "User 'abc' not found" }
 *
 * throw Errors.validation('email', 'must be valid')
 * // Creates: { code: 'VALIDATION_ERROR', status: 400, message: "email: must be valid" }
 * ```
 */
export const Errors = {
  /**
   * Resource not found
   * @param resource - Name of the resource (e.g., 'User', 'Order')
   * @param id - Optional resource identifier
   */
  notFound(resource: string, id?: string | number): RaffelError {
    const message = id ? `${resource} '${id}' not found` : `${resource} not found`
    return new RaffelError('NOT_FOUND', message, { resource, id })
  },

  /**
   * Validation error
   * @param field - Field name that failed validation
   * @param reason - Why validation failed
   * @param value - Optional offending value
   */
  validation(field: string, reason: string, value?: unknown): RaffelError {
    return new RaffelError('VALIDATION_ERROR', `${field}: ${reason}`, {
      field,
      reason,
      value,
    })
  },

  /**
   * Multiple validation errors
   * @param errors - Array of field errors
   */
  validationMultiple(errors: Array<{ field: string; reason: string }>): RaffelError {
    const message = errors.map((e) => `${e.field}: ${e.reason}`).join('; ')
    return new RaffelError('VALIDATION_ERROR', message, { errors })
  },

  /**
   * Authentication required
   * @param reason - Optional reason
   */
  unauthorized(reason?: string): RaffelError {
    return new RaffelError(
      'UNAUTHENTICATED',
      reason || 'Authentication required'
    )
  },

  /**
   * Permission denied
   * @param reason - Why permission was denied
   */
  forbidden(reason?: string): RaffelError {
    return new RaffelError(
      'PERMISSION_DENIED',
      reason || 'Access denied'
    )
  },

  /**
   * Rate limit exceeded
   * @param retryAfter - Optional seconds until retry is allowed
   */
  rateLimit(retryAfter?: number): RaffelError {
    return new RaffelError(
      'RATE_LIMITED',
      'Too many requests',
      retryAfter ? { retryAfter } : undefined
    )
  },

  /**
   * Request timeout
   * @param operation - What operation timed out
   */
  timeout(operation?: string): RaffelError {
    const message = operation ? `Operation '${operation}' timed out` : 'Request timed out'
    return new RaffelError('DEADLINE_EXCEEDED', message)
  },

  /**
   * Internal server error
   * @param message - Error message
   * @param details - Optional additional details
   */
  internal(message?: string, details?: unknown): RaffelError {
    return new RaffelError(
      'INTERNAL_ERROR',
      message || 'An internal error occurred',
      details
    )
  },

  /**
   * Bad request / invalid argument
   * @param message - What was wrong with the request
   */
  badRequest(message: string): RaffelError {
    return new RaffelError('INVALID_ARGUMENT', message)
  },

  /**
   * Resource already exists
   * @param resource - Name of the resource
   * @param identifier - What makes it duplicate
   */
  alreadyExists(resource: string, identifier?: string): RaffelError {
    const message = identifier
      ? `${resource} with ${identifier} already exists`
      : `${resource} already exists`
    return new RaffelError('ALREADY_EXISTS', message, { resource, identifier })
  },

  /**
   * Precondition failed
   * @param condition - What condition was not met
   */
  preconditionFailed(condition: string): RaffelError {
    return new RaffelError('FAILED_PRECONDITION', condition)
  },

  /**
   * Resource exhausted (quota, disk space, etc.)
   * @param resource - What resource is exhausted
   */
  resourceExhausted(resource: string): RaffelError {
    return new RaffelError('RESOURCE_EXHAUSTED', `${resource} exhausted`)
  },

  /**
   * Operation cancelled
   * @param operation - What was cancelled
   */
  cancelled(operation?: string): RaffelError {
    const message = operation ? `Operation '${operation}' was cancelled` : 'Operation cancelled'
    return new RaffelError('CANCELLED', message)
  },

  /**
   * Feature not implemented
   * @param feature - What feature is not implemented
   */
  unimplemented(feature?: string): RaffelError {
    const message = feature ? `Feature '${feature}' is not implemented` : 'Not implemented'
    return new RaffelError('UNIMPLEMENTED', message)
  },

  /**
   * Service unavailable
   * @param service - What service is unavailable
   */
  unavailable(service?: string): RaffelError {
    const message = service ? `Service '${service}' is unavailable` : 'Service unavailable'
    return new RaffelError('UNAVAILABLE', message)
  },

  /**
   * Unprocessable entity - semantically invalid request
   *
   * Use for business logic validation (e.g., "can't delete user with active orders")
   * vs validation() for schema/syntactic validation.
   *
   * @param reason - Why the entity cannot be processed
   * @param details - Optional additional details
   */
  unprocessable(reason: string, details?: unknown): RaffelError {
    return new RaffelError('UNPROCESSABLE_ENTITY', reason, details)
  },

  /**
   * Bad gateway - upstream service returned invalid response
   * @param upstream - Name of the upstream service
   * @param details - Optional error details
   */
  badGateway(upstream?: string, details?: unknown): RaffelError {
    const message = upstream
      ? `Invalid response from upstream service '${upstream}'`
      : 'Invalid response from upstream service'
    return new RaffelError('BAD_GATEWAY', message, details)
  },

  /**
   * Gateway timeout - upstream service did not respond in time
   * @param upstream - Name of the upstream service
   * @param timeoutMs - Optional timeout value in milliseconds
   */
  gatewayTimeout(upstream?: string, timeoutMs?: number): RaffelError {
    let message = upstream
      ? `Upstream service '${upstream}' timed out`
      : 'Upstream service timed out'
    if (timeoutMs) {
      message += ` after ${timeoutMs}ms`
    }
    return new RaffelError('GATEWAY_TIMEOUT', message, timeoutMs ? { timeoutMs } : undefined)
  },

  /**
   * Data loss / corruption detected
   * @param message - What happened
   */
  dataLoss(message: string): RaffelError {
    return new RaffelError('DATA_LOSS', message)
  },

  /**
   * Create a custom error
   * @param code - Error code
   * @param message - Error message
   * @param details - Optional details
   * @param status - Optional custom status code
   */
  custom(code: string, message: string, details?: unknown, status?: number): RaffelError {
    return new RaffelError(code, message, details, status)
  },
} as const
