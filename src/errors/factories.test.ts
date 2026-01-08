/**
 * Error Factories Tests
 *
 * Tests for pre-built error helpers.
 */

import { describe, it, expect } from 'vitest'
import { Errors } from './factories.js'
import {
  ErrorCodes,
  getErrorCode,
  getStatusForCode,
  isClientError,
  isServerError,
  isRetryable,
} from './codes.js'
import { RaffelError } from '../core/router.js'

describe('ErrorCodes', () => {
  it('should define all standard error codes', () => {
    expect(ErrorCodes.NOT_FOUND.code).toBe('NOT_FOUND')
    expect(ErrorCodes.NOT_FOUND.status).toBe(404)

    expect(ErrorCodes.INTERNAL_ERROR.code).toBe('INTERNAL_ERROR')
    expect(ErrorCodes.INTERNAL_ERROR.status).toBe(500)

    expect(ErrorCodes.RATE_LIMITED.code).toBe('RATE_LIMITED')
    expect(ErrorCodes.RATE_LIMITED.status).toBe(429)
  })

  it('should have consistent code and key', () => {
    for (const [key, def] of Object.entries(ErrorCodes)) {
      expect(def.code).toBe(key)
    }
  })
})

describe('getErrorCode', () => {
  it('should return code definition for known codes', () => {
    const def = getErrorCode('NOT_FOUND')
    expect(def.code).toBe('NOT_FOUND')
    expect(def.status).toBe(404)
  })

  it('should return unknown definition for unrecognized codes', () => {
    const def = getErrorCode('CUSTOM_CODE')
    expect(def.code).toBe('CUSTOM_CODE')
    expect(def.status).toBe(500) // defaults to 500
  })
})

describe('getStatusForCode', () => {
  it('should return correct status for known codes', () => {
    expect(getStatusForCode('NOT_FOUND')).toBe(404)
    expect(getStatusForCode('UNAUTHENTICATED')).toBe(401)
    expect(getStatusForCode('PERMISSION_DENIED')).toBe(403)
    expect(getStatusForCode('RATE_LIMITED')).toBe(429)
    expect(getStatusForCode('INTERNAL_ERROR')).toBe(500)
    expect(getStatusForCode('UNAVAILABLE')).toBe(503)
  })

  it('should return 500 for unknown codes', () => {
    expect(getStatusForCode('UNKNOWN_CODE')).toBe(500)
  })
})

describe('isClientError', () => {
  it('should return true for 4xx status codes', () => {
    expect(isClientError(400)).toBe(true)
    expect(isClientError(401)).toBe(true)
    expect(isClientError(404)).toBe(true)
    expect(isClientError(429)).toBe(true)
    expect(isClientError(499)).toBe(true)
  })

  it('should return false for non-4xx status codes', () => {
    expect(isClientError(200)).toBe(false)
    expect(isClientError(500)).toBe(false)
    expect(isClientError(503)).toBe(false)
  })
})

describe('isServerError', () => {
  it('should return true for 5xx status codes', () => {
    expect(isServerError(500)).toBe(true)
    expect(isServerError(501)).toBe(true)
    expect(isServerError(503)).toBe(true)
  })

  it('should return false for non-5xx status codes', () => {
    expect(isServerError(200)).toBe(false)
    expect(isServerError(400)).toBe(false)
    expect(isServerError(404)).toBe(false)
  })
})

describe('isRetryable', () => {
  it('should return true for retryable errors', () => {
    expect(isRetryable('UNAVAILABLE')).toBe(true)
    expect(isRetryable('RESOURCE_EXHAUSTED')).toBe(true)
    expect(isRetryable('DEADLINE_EXCEEDED')).toBe(true)
    expect(isRetryable('RATE_LIMITED')).toBe(true)
    expect(isRetryable('INTERNAL_ERROR')).toBe(true)
    expect(isRetryable('BAD_GATEWAY')).toBe(true)
    expect(isRetryable('GATEWAY_TIMEOUT')).toBe(true)
  })

  it('should return false for non-retryable errors', () => {
    expect(isRetryable('NOT_FOUND')).toBe(false)
    expect(isRetryable('INVALID_ARGUMENT')).toBe(false)
    expect(isRetryable('UNAUTHENTICATED')).toBe(false)
    expect(isRetryable('PERMISSION_DENIED')).toBe(false)
    expect(isRetryable('ALREADY_EXISTS')).toBe(false)
    expect(isRetryable('UNPROCESSABLE_ENTITY')).toBe(false)
  })
})

describe('RaffelError status', () => {
  it('should include status from error code', () => {
    const error = new RaffelError('NOT_FOUND', 'User not found')
    expect(error.code).toBe('NOT_FOUND')
    expect(error.status).toBe(404)
  })

  it('should allow custom status override', () => {
    const error = new RaffelError('CUSTOM', 'Custom error', undefined, 418)
    expect(error.status).toBe(418)
  })

  it('should default to 500 for unknown codes', () => {
    const error = new RaffelError('UNKNOWN_CODE', 'Unknown')
    expect(error.status).toBe(500)
  })

  it('should serialize to JSON with status', () => {
    const error = new RaffelError('NOT_FOUND', 'User not found', { id: 123 })
    const json = error.toJSON()
    expect(json).toEqual({
      code: 'NOT_FOUND',
      status: 404,
      message: 'User not found',
      details: { id: 123 },
    })
  })
})

describe('Errors', () => {
  describe('notFound', () => {
    it('should create NOT_FOUND error with status 404', () => {
      const error = Errors.notFound('User')
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('NOT_FOUND')
      expect(error.status).toBe(404)
      expect(error.message).toBe('User not found')
    })

    it('should include id when provided', () => {
      const error = Errors.notFound('User', '123')
      expect(error.message).toBe("User '123' not found")
      expect(error.details).toEqual({ resource: 'User', id: '123' })
    })

    it('should support numeric ids', () => {
      const error = Errors.notFound('Order', 456)
      expect(error.message).toBe("Order '456' not found")
    })
  })

  describe('validation', () => {
    it('should create VALIDATION_ERROR', () => {
      const error = Errors.validation('email', 'must be valid')
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.message).toBe('email: must be valid')
    })

    it('should include value when provided', () => {
      const error = Errors.validation('age', 'must be positive', -5)
      expect(error.details).toEqual({
        field: 'age',
        reason: 'must be positive',
        value: -5,
      })
    })
  })

  describe('validationMultiple', () => {
    it('should create error for multiple fields', () => {
      const error = Errors.validationMultiple([
        { field: 'email', reason: 'invalid format' },
        { field: 'age', reason: 'must be positive' },
      ])
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.message).toBe('email: invalid format; age: must be positive')
    })
  })

  describe('unauthorized', () => {
    it('should create UNAUTHENTICATED error', () => {
      const error = Errors.unauthorized()
      expect(error.code).toBe('UNAUTHENTICATED')
      expect(error.message).toBe('Authentication required')
    })

    it('should use custom reason', () => {
      const error = Errors.unauthorized('Token expired')
      expect(error.message).toBe('Token expired')
    })
  })

  describe('forbidden', () => {
    it('should create PERMISSION_DENIED error', () => {
      const error = Errors.forbidden()
      expect(error.code).toBe('PERMISSION_DENIED')
      expect(error.message).toBe('Access denied')
    })

    it('should use custom reason', () => {
      const error = Errors.forbidden('Admin role required')
      expect(error.message).toBe('Admin role required')
    })
  })

  describe('rateLimit', () => {
    it('should create RATE_LIMITED error', () => {
      const error = Errors.rateLimit()
      expect(error.code).toBe('RATE_LIMITED')
      expect(error.message).toBe('Too many requests')
    })

    it('should include retryAfter', () => {
      const error = Errors.rateLimit(60)
      expect(error.details).toEqual({ retryAfter: 60 })
    })
  })

  describe('timeout', () => {
    it('should create DEADLINE_EXCEEDED error', () => {
      const error = Errors.timeout()
      expect(error.code).toBe('DEADLINE_EXCEEDED')
      expect(error.message).toBe('Request timed out')
    })

    it('should include operation name', () => {
      const error = Errors.timeout('database query')
      expect(error.message).toBe("Operation 'database query' timed out")
    })
  })

  describe('internal', () => {
    it('should create INTERNAL_ERROR', () => {
      const error = Errors.internal()
      expect(error.code).toBe('INTERNAL_ERROR')
      expect(error.message).toBe('An internal error occurred')
    })

    it('should use custom message and details', () => {
      const error = Errors.internal('Database connection failed', {
        host: 'localhost',
      })
      expect(error.message).toBe('Database connection failed')
      expect(error.details).toEqual({ host: 'localhost' })
    })
  })

  describe('badRequest', () => {
    it('should create INVALID_ARGUMENT error', () => {
      const error = Errors.badRequest('Missing required field: id')
      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.message).toBe('Missing required field: id')
    })
  })

  describe('alreadyExists', () => {
    it('should create ALREADY_EXISTS error', () => {
      const error = Errors.alreadyExists('User')
      expect(error.code).toBe('ALREADY_EXISTS')
      expect(error.message).toBe('User already exists')
    })

    it('should include identifier', () => {
      const error = Errors.alreadyExists('User', 'email=test@example.com')
      expect(error.message).toBe(
        'User with email=test@example.com already exists'
      )
    })
  })

  describe('preconditionFailed', () => {
    it('should create FAILED_PRECONDITION error', () => {
      const error = Errors.preconditionFailed('Account must be verified')
      expect(error.code).toBe('FAILED_PRECONDITION')
      expect(error.message).toBe('Account must be verified')
    })
  })

  describe('resourceExhausted', () => {
    it('should create RESOURCE_EXHAUSTED error', () => {
      const error = Errors.resourceExhausted('Storage quota')
      expect(error.code).toBe('RESOURCE_EXHAUSTED')
      expect(error.message).toBe('Storage quota exhausted')
    })
  })

  describe('cancelled', () => {
    it('should create CANCELLED error', () => {
      const error = Errors.cancelled()
      expect(error.code).toBe('CANCELLED')
      expect(error.message).toBe('Operation cancelled')
    })

    it('should include operation name', () => {
      const error = Errors.cancelled('file upload')
      expect(error.message).toBe("Operation 'file upload' was cancelled")
    })
  })

  describe('unimplemented', () => {
    it('should create UNIMPLEMENTED error', () => {
      const error = Errors.unimplemented()
      expect(error.code).toBe('UNIMPLEMENTED')
      expect(error.message).toBe('Not implemented')
    })

    it('should include feature name', () => {
      const error = Errors.unimplemented('batch processing')
      expect(error.message).toBe("Feature 'batch processing' is not implemented")
    })
  })

  describe('unavailable', () => {
    it('should create UNAVAILABLE error', () => {
      const error = Errors.unavailable()
      expect(error.code).toBe('UNAVAILABLE')
      expect(error.message).toBe('Service unavailable')
    })

    it('should include service name', () => {
      const error = Errors.unavailable('payment gateway')
      expect(error.message).toBe("Service 'payment gateway' is unavailable")
    })
  })

  describe('unprocessable', () => {
    it('should create UNPROCESSABLE_ENTITY error with status 422', () => {
      const error = Errors.unprocessable('Cannot delete user with active orders')
      expect(error.code).toBe('UNPROCESSABLE_ENTITY')
      expect(error.status).toBe(422)
      expect(error.message).toBe('Cannot delete user with active orders')
    })

    it('should include details when provided', () => {
      const error = Errors.unprocessable('Order total exceeds limit', {
        limit: 10000,
        actual: 15000,
      })
      expect(error.details).toEqual({ limit: 10000, actual: 15000 })
    })
  })

  describe('badGateway', () => {
    it('should create BAD_GATEWAY error with status 502', () => {
      const error = Errors.badGateway()
      expect(error.code).toBe('BAD_GATEWAY')
      expect(error.status).toBe(502)
      expect(error.message).toBe('Invalid response from upstream service')
    })

    it('should include upstream name', () => {
      const error = Errors.badGateway('payment-service')
      expect(error.message).toBe("Invalid response from upstream service 'payment-service'")
    })

    it('should include details when provided', () => {
      const error = Errors.badGateway('api', { statusCode: 500 })
      expect(error.details).toEqual({ statusCode: 500 })
    })
  })

  describe('gatewayTimeout', () => {
    it('should create GATEWAY_TIMEOUT error with status 504', () => {
      const error = Errors.gatewayTimeout()
      expect(error.code).toBe('GATEWAY_TIMEOUT')
      expect(error.status).toBe(504)
      expect(error.message).toBe('Upstream service timed out')
    })

    it('should include upstream name', () => {
      const error = Errors.gatewayTimeout('inventory-service')
      expect(error.message).toBe("Upstream service 'inventory-service' timed out")
    })

    it('should include timeout value', () => {
      const error = Errors.gatewayTimeout('api', 5000)
      expect(error.message).toBe("Upstream service 'api' timed out after 5000ms")
      expect(error.details).toEqual({ timeoutMs: 5000 })
    })
  })

  describe('dataLoss', () => {
    it('should create DATA_LOSS error', () => {
      const error = Errors.dataLoss('Checksum mismatch')
      expect(error.code).toBe('DATA_LOSS')
      expect(error.message).toBe('Checksum mismatch')
    })
  })

  describe('custom', () => {
    it('should create custom error', () => {
      const error = Errors.custom('CUSTOM_CODE', 'Custom message', {
        custom: true,
      })
      expect(error.code).toBe('CUSTOM_CODE')
      expect(error.message).toBe('Custom message')
      expect(error.details).toEqual({ custom: true })
    })

    it('should allow custom status code', () => {
      const error = Errors.custom('IM_A_TEAPOT', 'I am a teapot', undefined, 418)
      expect(error.code).toBe('IM_A_TEAPOT')
      expect(error.status).toBe(418)
    })
  })
})
