/**
 * Error Codes & Factories — Unit Tests
 *
 * Comprehensive tests for src/errors/codes.ts and src/errors/factories.ts
 */

import { describe, it, expect } from 'vitest'
import {
  ErrorCodes,
  getErrorCode,
  getStatusForCode,
  isClientError,
  isServerError,
  isRetryable,
} from '../../src/errors/codes.js'
import { Errors } from '../../src/errors/factories.js'
import { RaffelError } from '../../src/core/router.js'

// ─────────────────────────────────────────────────────────────────────────────
// codes.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('ErrorCodes constant', () => {
  it('should have consistent code property matching the key', () => {
    for (const [key, def] of Object.entries(ErrorCodes)) {
      expect(def.code).toBe(key)
    }
  })

  it('should have numeric status for every code', () => {
    for (const def of Object.values(ErrorCodes)) {
      expect(typeof def.status).toBe('number')
      expect(def.status).toBeGreaterThanOrEqual(400)
      expect(def.status).toBeLessThan(600)
    }
  })

  it('should have a non-empty message for every code', () => {
    for (const def of Object.values(ErrorCodes)) {
      expect(typeof def.message).toBe('string')
      expect(def.message.length).toBeGreaterThan(0)
    }
  })
})

describe('getErrorCode', () => {
  it('returns correct definition for NOT_FOUND', () => {
    const def = getErrorCode('NOT_FOUND')
    expect(def.code).toBe('NOT_FOUND')
    expect(def.status).toBe(404)
    expect(def.message).toBe('Not found')
  })

  it('returns correct definition for INTERNAL_ERROR', () => {
    const def = getErrorCode('INTERNAL_ERROR')
    expect(def.code).toBe('INTERNAL_ERROR')
    expect(def.status).toBe(500)
    expect(def.message).toBe('Internal error')
  })

  it('returns correct definition for UNAUTHENTICATED', () => {
    const def = getErrorCode('UNAUTHENTICATED')
    expect(def.code).toBe('UNAUTHENTICATED')
    expect(def.status).toBe(401)
  })

  it('returns correct definition for PERMISSION_DENIED', () => {
    const def = getErrorCode('PERMISSION_DENIED')
    expect(def.code).toBe('PERMISSION_DENIED')
    expect(def.status).toBe(403)
  })

  it('returns correct definition for RATE_LIMITED', () => {
    const def = getErrorCode('RATE_LIMITED')
    expect(def.code).toBe('RATE_LIMITED')
    expect(def.status).toBe(429)
  })

  it('returns correct definition for UNAVAILABLE', () => {
    const def = getErrorCode('UNAVAILABLE')
    expect(def.code).toBe('UNAVAILABLE')
    expect(def.status).toBe(503)
  })

  it('returns correct definition for DEADLINE_EXCEEDED', () => {
    const def = getErrorCode('DEADLINE_EXCEEDED')
    expect(def.code).toBe('DEADLINE_EXCEEDED')
    expect(def.status).toBe(408)
  })

  it('returns fallback definition for unknown codes (status 500)', () => {
    const def = getErrorCode('TOTALLY_UNKNOWN')
    expect(def.code).toBe('TOTALLY_UNKNOWN')
    expect(def.status).toBe(500)
    expect(def.message).toBe('TOTALLY_UNKNOWN')
  })

  it('returns fallback with code echoed as message for unknown codes', () => {
    const def = getErrorCode('MY_CUSTOM_CODE')
    expect(def.message).toBe('MY_CUSTOM_CODE')
  })
})

describe('getStatusForCode', () => {
  it('returns 404 for NOT_FOUND', () => {
    expect(getStatusForCode('NOT_FOUND')).toBe(404)
  })

  it('returns 500 for INTERNAL_ERROR', () => {
    expect(getStatusForCode('INTERNAL_ERROR')).toBe(500)
  })

  it('returns 401 for UNAUTHENTICATED', () => {
    expect(getStatusForCode('UNAUTHENTICATED')).toBe(401)
  })

  it('returns 403 for PERMISSION_DENIED', () => {
    expect(getStatusForCode('PERMISSION_DENIED')).toBe(403)
  })

  it('returns 429 for RATE_LIMITED', () => {
    expect(getStatusForCode('RATE_LIMITED')).toBe(429)
  })

  it('returns 503 for UNAVAILABLE', () => {
    expect(getStatusForCode('UNAVAILABLE')).toBe(503)
  })

  it('returns 408 for DEADLINE_EXCEEDED', () => {
    expect(getStatusForCode('DEADLINE_EXCEEDED')).toBe(408)
  })

  it('returns 400 for VALIDATION_ERROR', () => {
    expect(getStatusForCode('VALIDATION_ERROR')).toBe(400)
  })

  it('returns 409 for ALREADY_EXISTS', () => {
    expect(getStatusForCode('ALREADY_EXISTS')).toBe(409)
  })

  it('returns 422 for UNPROCESSABLE_ENTITY', () => {
    expect(getStatusForCode('UNPROCESSABLE_ENTITY')).toBe(422)
  })

  it('returns 502 for BAD_GATEWAY', () => {
    expect(getStatusForCode('BAD_GATEWAY')).toBe(502)
  })

  it('returns 504 for GATEWAY_TIMEOUT', () => {
    expect(getStatusForCode('GATEWAY_TIMEOUT')).toBe(504)
  })

  it('returns 500 for unknown codes', () => {
    expect(getStatusForCode('DOES_NOT_EXIST')).toBe(500)
  })
})

describe('isClientError', () => {
  it('returns true for 400', () => {
    expect(isClientError(400)).toBe(true)
  })

  it('returns true for 401', () => {
    expect(isClientError(401)).toBe(true)
  })

  it('returns true for 404', () => {
    expect(isClientError(404)).toBe(true)
  })

  it('returns true for 429', () => {
    expect(isClientError(429)).toBe(true)
  })

  it('returns true for 499 (boundary)', () => {
    expect(isClientError(499)).toBe(true)
  })

  it('returns false for 500', () => {
    expect(isClientError(500)).toBe(false)
  })

  it('returns false for 200', () => {
    expect(isClientError(200)).toBe(false)
  })

  it('returns false for 399', () => {
    expect(isClientError(399)).toBe(false)
  })

  it('returns false for 503', () => {
    expect(isClientError(503)).toBe(false)
  })
})

describe('isServerError', () => {
  it('returns true for 500', () => {
    expect(isServerError(500)).toBe(true)
  })

  it('returns true for 501', () => {
    expect(isServerError(501)).toBe(true)
  })

  it('returns true for 503', () => {
    expect(isServerError(503)).toBe(true)
  })

  it('returns true for 599 (boundary)', () => {
    expect(isServerError(599)).toBe(true)
  })

  it('returns false for 400', () => {
    expect(isServerError(400)).toBe(false)
  })

  it('returns false for 404', () => {
    expect(isServerError(404)).toBe(false)
  })

  it('returns false for 200', () => {
    expect(isServerError(200)).toBe(false)
  })

  it('returns false for 600', () => {
    expect(isServerError(600)).toBe(false)
  })
})

describe('isRetryable', () => {
  it('returns true for UNAVAILABLE', () => {
    expect(isRetryable('UNAVAILABLE')).toBe(true)
  })

  it('returns true for RESOURCE_EXHAUSTED', () => {
    expect(isRetryable('RESOURCE_EXHAUSTED')).toBe(true)
  })

  it('returns true for DEADLINE_EXCEEDED', () => {
    expect(isRetryable('DEADLINE_EXCEEDED')).toBe(true)
  })

  it('returns true for RATE_LIMITED', () => {
    expect(isRetryable('RATE_LIMITED')).toBe(true)
  })

  it('returns true for BAD_GATEWAY', () => {
    expect(isRetryable('BAD_GATEWAY')).toBe(true)
  })

  it('returns true for GATEWAY_TIMEOUT', () => {
    expect(isRetryable('GATEWAY_TIMEOUT')).toBe(true)
  })

  it('returns true for INTERNAL_ERROR (may be transient)', () => {
    expect(isRetryable('INTERNAL_ERROR')).toBe(true)
  })

  it('returns true for UNKNOWN (may be transient)', () => {
    expect(isRetryable('UNKNOWN')).toBe(true)
  })

  it('returns true for STREAM_ERROR (may be transient)', () => {
    expect(isRetryable('STREAM_ERROR')).toBe(true)
  })

  it('returns false for NOT_FOUND', () => {
    expect(isRetryable('NOT_FOUND')).toBe(false)
  })

  it('returns false for INVALID_ARGUMENT', () => {
    expect(isRetryable('INVALID_ARGUMENT')).toBe(false)
  })

  it('returns false for UNAUTHENTICATED', () => {
    expect(isRetryable('UNAUTHENTICATED')).toBe(false)
  })

  it('returns false for PERMISSION_DENIED', () => {
    expect(isRetryable('PERMISSION_DENIED')).toBe(false)
  })

  it('returns false for ALREADY_EXISTS', () => {
    expect(isRetryable('ALREADY_EXISTS')).toBe(false)
  })

  it('returns false for VALIDATION_ERROR', () => {
    expect(isRetryable('VALIDATION_ERROR')).toBe(false)
  })

  it('returns false for UNPROCESSABLE_ENTITY', () => {
    expect(isRetryable('UNPROCESSABLE_ENTITY')).toBe(false)
  })

  it('returns false for CANCELLED', () => {
    expect(isRetryable('CANCELLED')).toBe(false)
  })

  it('returns false for UNIMPLEMENTED', () => {
    expect(isRetryable('UNIMPLEMENTED')).toBe(false)
  })

  it('returns false for DATA_LOSS', () => {
    expect(isRetryable('DATA_LOSS')).toBe(false)
  })

  it('returns false for completely unknown codes', () => {
    expect(isRetryable('SOME_RANDOM_CODE')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// factories.ts
// ─────────────────────────────────────────────────────────────────────────────

describe('Errors factories', () => {
  describe('notFound', () => {
    it('returns RaffelError with code NOT_FOUND and status 404', () => {
      const error = Errors.notFound('user', '123')
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('NOT_FOUND')
      expect(error.status).toBe(404)
      expect(error.message).toBe("user '123' not found")
    })

    it('handles missing id', () => {
      const error = Errors.notFound('user')
      expect(error.message).toBe('user not found')
      expect(error.details).toEqual({ resource: 'user', id: undefined })
    })

    it('supports numeric id', () => {
      const error = Errors.notFound('Order', 42)
      expect(error.message).toBe("Order '42' not found")
    })
  })

  describe('validation', () => {
    it('returns RaffelError with code VALIDATION_ERROR and status 400', () => {
      const error = Errors.validation('email', 'invalid')
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.status).toBe(400)
      expect(error.message).toBe('email: invalid')
    })

    it('includes value in details when provided', () => {
      const error = Errors.validation('age', 'must be positive', -1)
      expect(error.details).toEqual({ field: 'age', reason: 'must be positive', value: -1 })
    })
  })

  describe('validationMultiple', () => {
    it('combines multiple field errors into one message', () => {
      const error = Errors.validationMultiple([
        { field: 'name', reason: 'required' },
        { field: 'email', reason: 'invalid format' },
      ])
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.message).toBe('name: required; email: invalid format')
      expect(error.details).toEqual({
        errors: [
          { field: 'name', reason: 'required' },
          { field: 'email', reason: 'invalid format' },
        ],
      })
    })
  })

  describe('unauthorized', () => {
    it('returns UNAUTHENTICATED error with status 401', () => {
      const error = Errors.unauthorized()
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('UNAUTHENTICATED')
      expect(error.status).toBe(401)
      expect(error.message).toBe('Authentication required')
    })

    it('accepts custom reason', () => {
      const error = Errors.unauthorized('Token expired')
      expect(error.message).toBe('Token expired')
    })
  })

  describe('forbidden', () => {
    it('returns PERMISSION_DENIED error with status 403', () => {
      const error = Errors.forbidden()
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('PERMISSION_DENIED')
      expect(error.status).toBe(403)
      expect(error.message).toBe('Access denied')
    })

    it('accepts custom reason', () => {
      const error = Errors.forbidden('Admin only')
      expect(error.message).toBe('Admin only')
    })
  })

  describe('rateLimit', () => {
    it('returns RATE_LIMITED error with status 429', () => {
      const error = Errors.rateLimit()
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('RATE_LIMITED')
      expect(error.status).toBe(429)
      expect(error.message).toBe('Too many requests')
    })

    it('includes retryAfter in details', () => {
      const error = Errors.rateLimit(30)
      expect(error.details).toEqual({ retryAfter: 30 })
    })

    it('has no details when retryAfter is not provided', () => {
      const error = Errors.rateLimit()
      expect(error.details).toBeUndefined()
    })
  })

  describe('timeout', () => {
    it('returns DEADLINE_EXCEEDED error with status 408', () => {
      const error = Errors.timeout()
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('DEADLINE_EXCEEDED')
      expect(error.status).toBe(408)
      expect(error.message).toBe('Request timed out')
    })

    it('includes operation name in message', () => {
      const error = Errors.timeout('db query')
      expect(error.message).toBe("Operation 'db query' timed out")
    })
  })

  describe('internal', () => {
    it('returns INTERNAL_ERROR with status 500', () => {
      const error = Errors.internal()
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('INTERNAL_ERROR')
      expect(error.status).toBe(500)
      expect(error.message).toBe('An internal error occurred')
    })

    it('accepts custom message and details', () => {
      const error = Errors.internal('DB down', { host: 'db1' })
      expect(error.message).toBe('DB down')
      expect(error.details).toEqual({ host: 'db1' })
    })
  })

  describe('badRequest', () => {
    it('returns INVALID_ARGUMENT error with status 400', () => {
      const error = Errors.badRequest('Missing field: id')
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('INVALID_ARGUMENT')
      expect(error.status).toBe(400)
      expect(error.message).toBe('Missing field: id')
    })
  })

  describe('alreadyExists', () => {
    it('returns ALREADY_EXISTS error with status 409', () => {
      const error = Errors.alreadyExists('User')
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('ALREADY_EXISTS')
      expect(error.status).toBe(409)
      expect(error.message).toBe('User already exists')
    })

    it('includes identifier in message', () => {
      const error = Errors.alreadyExists('User', 'email=a@b.com')
      expect(error.message).toBe('User with email=a@b.com already exists')
    })
  })

  describe('preconditionFailed', () => {
    it('returns FAILED_PRECONDITION error with status 412', () => {
      const error = Errors.preconditionFailed('Account not verified')
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('FAILED_PRECONDITION')
      expect(error.status).toBe(412)
    })
  })

  describe('resourceExhausted', () => {
    it('returns RESOURCE_EXHAUSTED error with status 429', () => {
      const error = Errors.resourceExhausted('Disk space')
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('RESOURCE_EXHAUSTED')
      expect(error.status).toBe(429)
      expect(error.message).toBe('Disk space exhausted')
    })
  })

  describe('cancelled', () => {
    it('returns CANCELLED error with status 499', () => {
      const error = Errors.cancelled()
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('CANCELLED')
      expect(error.status).toBe(499)
      expect(error.message).toBe('Operation cancelled')
    })

    it('includes operation name', () => {
      const error = Errors.cancelled('file upload')
      expect(error.message).toBe("Operation 'file upload' was cancelled")
    })
  })

  describe('unimplemented', () => {
    it('returns UNIMPLEMENTED error with status 501', () => {
      const error = Errors.unimplemented()
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('UNIMPLEMENTED')
      expect(error.status).toBe(501)
    })

    it('includes feature name', () => {
      const error = Errors.unimplemented('batch')
      expect(error.message).toBe("Feature 'batch' is not implemented")
    })
  })

  describe('unavailable', () => {
    it('returns UNAVAILABLE error with status 503', () => {
      const error = Errors.unavailable()
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('UNAVAILABLE')
      expect(error.status).toBe(503)
    })

    it('includes service name', () => {
      const error = Errors.unavailable('payments')
      expect(error.message).toBe("Service 'payments' is unavailable")
    })
  })

  describe('unprocessable', () => {
    it('returns UNPROCESSABLE_ENTITY error with status 422', () => {
      const error = Errors.unprocessable('Cannot delete active user')
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('UNPROCESSABLE_ENTITY')
      expect(error.status).toBe(422)
    })

    it('includes details', () => {
      const error = Errors.unprocessable('Limit exceeded', { limit: 100 })
      expect(error.details).toEqual({ limit: 100 })
    })
  })

  describe('badGateway', () => {
    it('returns BAD_GATEWAY error with status 502', () => {
      const error = Errors.badGateway()
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('BAD_GATEWAY')
      expect(error.status).toBe(502)
    })

    it('includes upstream name', () => {
      const error = Errors.badGateway('payment-svc')
      expect(error.message).toBe("Invalid response from upstream service 'payment-svc'")
    })
  })

  describe('gatewayTimeout', () => {
    it('returns GATEWAY_TIMEOUT error with status 504', () => {
      const error = Errors.gatewayTimeout()
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('GATEWAY_TIMEOUT')
      expect(error.status).toBe(504)
    })

    it('includes upstream name and timeout', () => {
      const error = Errors.gatewayTimeout('api', 5000)
      expect(error.message).toBe("Upstream service 'api' timed out after 5000ms")
      expect(error.details).toEqual({ timeoutMs: 5000 })
    })
  })

  describe('dataLoss', () => {
    it('returns DATA_LOSS error with status 500', () => {
      const error = Errors.dataLoss('Checksum mismatch')
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('DATA_LOSS')
      expect(error.status).toBe(500)
    })
  })

  describe('custom', () => {
    it('creates error with arbitrary code and message', () => {
      const error = Errors.custom('MY_CODE', 'my message')
      expect(error).toBeInstanceOf(RaffelError)
      expect(error.code).toBe('MY_CODE')
      expect(error.message).toBe('my message')
    })

    it('accepts details and custom status', () => {
      const error = Errors.custom('TEAPOT', 'I am a teapot', { brew: true }, 418)
      expect(error.status).toBe(418)
      expect(error.details).toEqual({ brew: true })
    })

    it('defaults to status 500 when no explicit status is given for an unknown code', () => {
      const error = Errors.custom('WHATEVER', 'whatever')
      expect(error.status).toBe(500)
    })
  })

  describe('all factories return RaffelError instances', () => {
    it('every factory method produces an instanceof RaffelError', () => {
      const errors = [
        Errors.notFound('x'),
        Errors.validation('f', 'r'),
        Errors.validationMultiple([{ field: 'a', reason: 'b' }]),
        Errors.unauthorized(),
        Errors.forbidden(),
        Errors.rateLimit(),
        Errors.timeout(),
        Errors.internal(),
        Errors.badRequest('x'),
        Errors.alreadyExists('x'),
        Errors.preconditionFailed('x'),
        Errors.resourceExhausted('x'),
        Errors.cancelled(),
        Errors.unimplemented(),
        Errors.unavailable(),
        Errors.unprocessable('x'),
        Errors.badGateway(),
        Errors.gatewayTimeout(),
        Errors.dataLoss('x'),
        Errors.custom('C', 'm'),
      ]

      for (const e of errors) {
        expect(e).toBeInstanceOf(RaffelError)
        expect(e).toBeInstanceOf(Error)
        expect(e.name).toBe('RaffelError')
        expect(typeof e.code).toBe('string')
        expect(typeof e.status).toBe('number')
        expect(typeof e.message).toBe('string')
      }
    })
  })
})
