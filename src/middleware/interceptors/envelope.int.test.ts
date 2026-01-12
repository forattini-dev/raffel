/**
 * Response Envelope Interceptor Tests
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createEnvelopeInterceptor,
  createMinimalEnvelopeInterceptor,
  createStandardEnvelopeInterceptor,
  createDetailedEnvelopeInterceptor,
  isEnvelopeResponse,
  isEnvelopeSuccess,
  isEnvelopeError,
  EnvelopePresets,
} from './envelope.js'
import type { Envelope, Context } from '../../types/index.js'
import { createContext } from '../../types/index.js'
import { RaffelError } from '../../core/router.js'

function createEnvelope(procedure: string): Envelope {
  return {
    id: `test-${Date.now()}`,
    procedure,
    payload: {},
    type: 'request',
    metadata: {},
    context: createContext('test-id'),
  }
}

function createTestContext(requestId = 'req-123'): Context {
  return createContext(requestId)
}

describe('createEnvelopeInterceptor', () => {
  it('should wrap successful response in envelope format', async () => {
    const envelope = createEnvelopeInterceptor()

    const result = await envelope(
      createEnvelope('users.get'),
      createTestContext(),
      async () => ({ id: 1, name: 'John' })
    )

    expect(result).toMatchObject({
      success: true,
      data: { id: 1, name: 'John' },
      meta: expect.objectContaining({
        requestId: 'req-123',
      }),
    })
  })

  it('should include timestamp in meta', async () => {
    const envelope = createEnvelopeInterceptor({ includeTimestamp: true })

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => ({ status: 'ok' })
    ) as any

    expect(result.meta.timestamp).toBeDefined()
    expect(new Date(result.meta.timestamp).getTime()).toBeGreaterThan(0)
  })

  it('should include duration in meta', async () => {
    const envelope = createEnvelopeInterceptor({ includeDuration: true })

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        await new Promise(r => setTimeout(r, 10))
        return { status: 'ok' }
      }
    ) as any

    expect(result.meta.duration).toBeDefined()
    expect(result.meta.duration).toBeGreaterThanOrEqual(0)
  })

  it('should include requestId in meta', async () => {
    const envelope = createEnvelopeInterceptor({ includeRequestId: true })

    const result = await envelope(
      createEnvelope('test'),
      createTestContext('my-request-id'),
      async () => ({ status: 'ok' })
    ) as any

    expect(result.meta.requestId).toBe('my-request-id')
  })

  it('should wrap error in envelope format', async () => {
    const envelope = createEnvelopeInterceptor()

    const result = await envelope(
      createEnvelope('users.get'),
      createTestContext(),
      async () => {
        throw new Error('User not found')
      }
    )

    expect(result).toMatchObject({
      success: false,
      error: {
        message: 'User not found',
        code: 'INTERNAL_ERROR',
      },
      meta: expect.any(Object),
    })
  })

  it('should extract error code from RaffelError', async () => {
    const envelope = createEnvelopeInterceptor()

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new RaffelError('VALIDATION_ERROR', 'Invalid input')
      }
    ) as any

    expect(result.success).toBe(false)
    expect(result.error.code).toBe('VALIDATION_ERROR')
    expect(result.error.message).toBe('Invalid input')
  })

  it('should use custom errorCodeMapper', async () => {
    const envelope = createEnvelopeInterceptor({
      errorCodeMapper: (error) => `CUSTOM_${error.name.toUpperCase()}`,
    })

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new TypeError('Type mismatch')
      }
    ) as any

    expect(result.error.code).toBe('CUSTOM_TYPEERROR')
  })

  it('should include error details when configured', async () => {
    const envelope = createEnvelopeInterceptor({
      includeErrorDetails: true,
    })

    const errorWithDetails = new Error('Validation failed')
    ;(errorWithDetails as any).details = { field: 'email', reason: 'invalid format' }

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw errorWithDetails
      }
    ) as any

    expect(result.error.details).toEqual({ field: 'email', reason: 'invalid format' })
  })

  it('should include validation errors array', async () => {
    const envelope = createEnvelopeInterceptor({
      includeErrorDetails: true,
    })

    const validationError = new Error('Validation failed')
    ;(validationError as any).errors = [
      { field: 'email', message: 'required' },
      { field: 'name', message: 'too short' },
    ]

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw validationError
      }
    ) as any

    expect(result.error.details).toEqual({
      errors: [
        { field: 'email', message: 'required' },
        { field: 'name', message: 'too short' },
      ],
    })
  })

  it('should not include error details when disabled', async () => {
    const envelope = createEnvelopeInterceptor({
      includeErrorDetails: false,
    })

    const errorWithDetails = new Error('Validation failed')
    ;(errorWithDetails as any).details = { sensitive: 'data' }

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw errorWithDetails
      }
    ) as any

    expect(result.error.details).toBeUndefined()
  })

  it('should not include stack trace by default in production', async () => {
    const originalEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      const envelope = createEnvelopeInterceptor()

      const result = await envelope(
        createEnvelope('test'),
        createTestContext(),
        async () => {
          throw new Error('Failed')
        }
      ) as any

      expect(result.error.details?.stack).toBeUndefined()
    } finally {
      process.env.NODE_ENV = originalEnv
    }
  })

  it('should include duration even for error responses', async () => {
    const envelope = createEnvelopeInterceptor({ includeDuration: true })

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        await new Promise(r => setTimeout(r, 5))
        throw new Error('Failed')
      }
    ) as any

    expect(result.success).toBe(false)
    expect(result.meta.duration).toBeDefined()
    expect(result.meta.duration).toBeGreaterThanOrEqual(0)
  })
})

describe('EnvelopePresets', () => {
  it('minimal preset should exclude all metadata', async () => {
    const envelope = createEnvelopeInterceptor(EnvelopePresets.minimal)

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => ({ data: 'test' })
    ) as any

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ data: 'test' })
    expect(result.meta).toEqual({})
  })

  it('standard preset should include all metadata except stack', async () => {
    const envelope = createEnvelopeInterceptor(EnvelopePresets.standard)

    const result = await envelope(
      createEnvelope('test'),
      createTestContext('std-req'),
      async () => ({ data: 'test' })
    ) as any

    expect(result.meta.requestId).toBe('std-req')
    expect(result.meta.timestamp).toBeDefined()
    expect(result.meta.duration).toBeDefined()
  })

  it('detailed preset should include everything', async () => {
    const envelope = createEnvelopeInterceptor(EnvelopePresets.detailed)

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('Test error')
      }
    ) as any

    expect(result.success).toBe(false)
    expect(result.error.details?.stack).toBeDefined()
  })
})

describe('Preset Factory Functions', () => {
  it('createMinimalEnvelopeInterceptor should work', async () => {
    const envelope = createMinimalEnvelopeInterceptor()

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => 'minimal'
    ) as any

    expect(result.success).toBe(true)
    expect(result.data).toBe('minimal')
    expect(result.meta).toEqual({})
  })

  it('createStandardEnvelopeInterceptor should work', async () => {
    const envelope = createStandardEnvelopeInterceptor()

    const result = await envelope(
      createEnvelope('test'),
      createTestContext('std-id'),
      async () => 'standard'
    ) as any

    expect(result.success).toBe(true)
    expect(result.data).toBe('standard')
    expect(result.meta.requestId).toBe('std-id')
  })

  it('createDetailedEnvelopeInterceptor should work', async () => {
    const envelope = createDetailedEnvelopeInterceptor()

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('detailed')
      }
    ) as any

    expect(result.success).toBe(false)
    expect(result.error.message).toBe('detailed')
  })
})

describe('Type Guards', () => {
  describe('isEnvelopeResponse', () => {
    it('should return true for success response', () => {
      const response = { success: true, data: {}, meta: {} }
      expect(isEnvelopeResponse(response)).toBe(true)
    })

    it('should return true for error response', () => {
      const response = {
        success: false,
        error: { message: 'err', code: 'ERR' },
        meta: {},
      }
      expect(isEnvelopeResponse(response)).toBe(true)
    })

    it('should return false for non-envelope objects', () => {
      expect(isEnvelopeResponse({ data: {} })).toBe(false)
      expect(isEnvelopeResponse({ success: 'yes' })).toBe(false)
      expect(isEnvelopeResponse(null)).toBe(false)
      expect(isEnvelopeResponse(undefined)).toBe(false)
      expect(isEnvelopeResponse('string')).toBe(false)
    })

    it('should return false for partial envelope', () => {
      expect(isEnvelopeResponse({ success: true })).toBe(false)
      expect(isEnvelopeResponse({ success: false })).toBe(false)
    })
  })

  describe('isEnvelopeSuccess', () => {
    it('should return true for success response', () => {
      const response = { success: true as const, data: { id: 1 }, meta: {} }
      expect(isEnvelopeSuccess(response)).toBe(true)
    })

    it('should return false for error response', () => {
      const response = {
        success: false as const,
        error: { message: 'err', code: 'ERR' },
        meta: {},
      }
      expect(isEnvelopeSuccess(response)).toBe(false)
    })
  })

  describe('isEnvelopeError', () => {
    it('should return true for error response', () => {
      const response = {
        success: false as const,
        error: { message: 'err', code: 'ERR' },
        meta: {},
      }
      expect(isEnvelopeError(response)).toBe(true)
    })

    it('should return false for success response', () => {
      const response = { success: true as const, data: { id: 1 }, meta: {} }
      expect(isEnvelopeError(response)).toBe(false)
    })
  })
})

describe('HTTP Status Code Mapping', () => {
  it('should map 400 to BAD_REQUEST', async () => {
    const envelope = createEnvelopeInterceptor()
    const error = new Error('Bad request')
    ;(error as any).status = 400

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      }
    ) as any

    expect(result.error.code).toBe('BAD_REQUEST')
  })

  it('should map 401 to UNAUTHORIZED', async () => {
    const envelope = createEnvelopeInterceptor()
    const error = new Error('Unauthorized')
    ;(error as any).status = 401

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      }
    ) as any

    expect(result.error.code).toBe('UNAUTHORIZED')
  })

  it('should map 403 to FORBIDDEN', async () => {
    const envelope = createEnvelopeInterceptor()
    const error = new Error('Forbidden')
    ;(error as any).status = 403

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      }
    ) as any

    expect(result.error.code).toBe('FORBIDDEN')
  })

  it('should map 404 to NOT_FOUND', async () => {
    const envelope = createEnvelopeInterceptor()
    const error = new Error('Not found')
    ;(error as any).status = 404

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      }
    ) as any

    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('should map 429 to RATE_LIMIT_EXCEEDED', async () => {
    const envelope = createEnvelopeInterceptor()
    const error = new Error('Too many requests')
    ;(error as any).status = 429

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      }
    ) as any

    expect(result.error.code).toBe('RATE_LIMIT_EXCEEDED')
  })

  it('should map 500 to INTERNAL_ERROR', async () => {
    const envelope = createEnvelopeInterceptor()
    const error = new Error('Server error')
    ;(error as any).status = 500

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      }
    ) as any

    expect(result.error.code).toBe('INTERNAL_ERROR')
  })

  it('should map 503 to SERVICE_UNAVAILABLE', async () => {
    const envelope = createEnvelopeInterceptor()
    const error = new Error('Service unavailable')
    ;(error as any).status = 503

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      }
    ) as any

    expect(result.error.code).toBe('SERVICE_UNAVAILABLE')
  })
})

describe('Error Name Mapping', () => {
  it('should map ValidationError to VALIDATION_ERROR', async () => {
    const envelope = createEnvelopeInterceptor()
    const error = new Error('Validation failed')
    error.name = 'ValidationError'

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      }
    ) as any

    expect(result.error.code).toBe('VALIDATION_ERROR')
  })

  it('should map UnauthorizedError to UNAUTHORIZED', async () => {
    const envelope = createEnvelopeInterceptor()
    const error = new Error('Not authorized')
    error.name = 'UnauthorizedError'

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      }
    ) as any

    expect(result.error.code).toBe('UNAUTHORIZED')
  })

  it('should map ForbiddenError to FORBIDDEN', async () => {
    const envelope = createEnvelopeInterceptor()
    const error = new Error('Access denied')
    error.name = 'ForbiddenError'

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      }
    ) as any

    expect(result.error.code).toBe('FORBIDDEN')
  })

  it('should map NotFoundError to NOT_FOUND', async () => {
    const envelope = createEnvelopeInterceptor()
    const error = new Error('Resource not found')
    error.name = 'NotFoundError'

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      }
    ) as any

    expect(result.error.code).toBe('NOT_FOUND')
  })
})

describe('Edge Cases', () => {
  it('should handle null data', async () => {
    const envelope = createEnvelopeInterceptor()

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => null
    ) as any

    expect(result.success).toBe(true)
    expect(result.data).toBe(null)
  })

  it('should handle undefined data', async () => {
    const envelope = createEnvelopeInterceptor()

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => undefined
    ) as any

    expect(result.success).toBe(true)
    expect(result.data).toBe(undefined)
  })

  it('should handle primitive data', async () => {
    const envelope = createEnvelopeInterceptor()

    const result1 = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => 'string'
    ) as any

    expect(result1.data).toBe('string')

    const result2 = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => 42
    ) as any

    expect(result2.data).toBe(42)

    const result3 = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => true
    ) as any

    expect(result3.data).toBe(true)
  })

  it('should handle array data', async () => {
    const envelope = createEnvelopeInterceptor()

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => [1, 2, 3]
    ) as any

    expect(result.success).toBe(true)
    expect(result.data).toEqual([1, 2, 3])
  })

  it('should handle deeply nested data', async () => {
    const envelope = createEnvelopeInterceptor()
    const deepData = {
      level1: {
        level2: {
          level3: {
            value: 'deep',
          },
        },
      },
    }

    const result = await envelope(
      createEnvelope('test'),
      createTestContext(),
      async () => deepData
    ) as any

    expect(result.success).toBe(true)
    expect(result.data).toEqual(deepData)
  })

  it('should handle context without requestId', async () => {
    const envelope = createEnvelopeInterceptor({ includeRequestId: true })
    const ctx = createContext('')

    const result = await envelope(
      createEnvelope('test'),
      ctx,
      async () => 'ok'
    ) as any

    expect(result.success).toBe(true)
    // Should not include empty requestId
    expect(result.meta.requestId).toBeFalsy()
  })
})
