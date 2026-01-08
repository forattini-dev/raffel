/**
 * Error Module
 *
 * Pre-built error factories, error types, and error code definitions.
 */

export { Errors } from './factories.js'

// Export error codes
export {
  ErrorCodes,
  type ErrorCode,
  type ErrorCodeDef,
  getErrorCode,
  getStatusForCode,
  isClientError,
  isServerError,
  isRetryable,
} from './codes.js'

// Re-export RaffelError for convenience
export { RaffelError } from '../core/router.js'
