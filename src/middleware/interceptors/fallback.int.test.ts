/**
 * Fallback Interceptor Tests
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createFallbackInterceptor,
  createProcedureFallback,
  createCircuitAwareFallback,
} from './fallback.js'
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

function createTestContext(): Context {
  return createContext('test')
}

describe('createFallbackInterceptor', () => {
  it('should throw if neither response nor handler is provided', () => {
    expect(() => createFallbackInterceptor({})).toThrow(
      'Fallback interceptor requires either "response" or "handler" option'
    )
  })

  it('should return handler result on success', async () => {
    const fallback = createFallbackInterceptor({
      response: { status: 'fallback' },
    })

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => ({ status: 'success' })
    )

    expect(result).toEqual({ status: 'success' })
  })

  it('should return static response on error', async () => {
    const fallback = createFallbackInterceptor({
      response: { id: 0, name: 'Guest' },
    })

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('Service down')
      }
    )

    expect(result).toEqual({ id: 0, name: 'Guest' })
  })

  it('should call handler function on error', async () => {
    const fallback = createFallbackInterceptor({
      handler: (ctx, error) => ({
        id: 0,
        name: 'Guest',
        errorReason: error.message,
      }),
    })

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('Database timeout')
      }
    )

    expect(result).toEqual({
      id: 0,
      name: 'Guest',
      errorReason: 'Database timeout',
    })
  })

  it('should support async handler function', async () => {
    const fallback = createFallbackInterceptor({
      handler: async (_ctx, error) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { fromCache: true, error: error.message }
      },
    })

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('Failed')
      }
    )

    expect(result).toEqual({ fromCache: true, error: 'Failed' })
  })

  it('should apply fallback only when condition is true', async () => {
    const fallback = createFallbackInterceptor({
      response: { status: 'unavailable' },
      when: (error) => (error as any).code === 'SERVICE_UNAVAILABLE',
    })

    // Should fallback for SERVICE_UNAVAILABLE
    const result1 = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new RaffelError('SERVICE_UNAVAILABLE', 'Service down')
      }
    )

    expect(result1).toEqual({ status: 'unavailable' })

    // Should NOT fallback for other errors
    await expect(
      fallback(
        createEnvelope('test'),
        createTestContext(),
        async () => {
          throw new RaffelError('VALIDATION_ERROR', 'Bad input')
        }
      )
    ).rejects.toThrow('Bad input')
  })

  it('should re-throw when condition returns false', async () => {
    const fallback = createFallbackInterceptor({
      response: { status: 'unavailable' },
      when: (error) => error.message.includes('timeout'),
    })

    await expect(
      fallback(
        createEnvelope('test'),
        createTestContext(),
        async () => {
          throw new Error('validation failed')
        }
      )
    ).rejects.toThrow('validation failed')
  })

  it('should prefer handler over response when both provided', async () => {
    const fallback = createFallbackInterceptor({
      response: { source: 'static' },
      handler: () => ({ source: 'handler' }),
    })

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('Fail')
      }
    )

    expect(result).toEqual({ source: 'handler' })
  })
})

describe('createProcedureFallback', () => {
  it('should use procedure-specific fallback', async () => {
    const fallback = createProcedureFallback({
      procedures: {
        'users.get': { response: { id: 0, name: 'Guest' } },
        'config.get': { response: { theme: 'default' } },
      },
    })

    const userResult = await fallback(
      createEnvelope('users.get'),
      createTestContext(),
      async () => {
        throw new Error('Failed')
      }
    )

    expect(userResult).toEqual({ id: 0, name: 'Guest' })

    const configResult = await fallback(
      createEnvelope('config.get'),
      createTestContext(),
      async () => {
        throw new Error('Failed')
      }
    )

    expect(configResult).toEqual({ theme: 'default' })
  })

  it('should use default fallback for unconfigured procedures', async () => {
    const fallback = createProcedureFallback({
      default: { response: { status: 'unavailable' } },
      procedures: {
        'specific.procedure': { response: { status: 'specific-fallback' } },
      },
    })

    const result = await fallback(
      createEnvelope('other.procedure'),
      createTestContext(),
      async () => {
        throw new Error('Failed')
      }
    )

    expect(result).toEqual({ status: 'unavailable' })
  })

  it('should pass through if no fallback configured', async () => {
    const fallback = createProcedureFallback({
      procedures: {
        'specific.procedure': { response: { status: 'specific-fallback' } },
      },
    })

    // No default, no matching procedure - error should propagate
    await expect(
      fallback(
        createEnvelope('other.procedure'),
        createTestContext(),
        async () => {
          throw new Error('No fallback')
        }
      )
    ).rejects.toThrow('No fallback')
  })

  it('should match patterns', async () => {
    const fallback = createProcedureFallback({
      procedures: {
        'users.*': { response: { id: 0, type: 'user' } },
        'orders.**': { response: { orderId: null, type: 'order' } },
      },
    })

    const userResult = await fallback(
      createEnvelope('users.get'),
      createTestContext(),
      async () => {
        throw new Error('Failed')
      }
    )

    expect(userResult).toEqual({ id: 0, type: 'user' })

    const orderResult = await fallback(
      createEnvelope('orders.details.get'),
      createTestContext(),
      async () => {
        throw new Error('Failed')
      }
    )

    expect(orderResult).toEqual({ orderId: null, type: 'order' })
  })
})

describe('createCircuitAwareFallback', () => {
  it('should fallback only for specified error codes', async () => {
    const fallback = createCircuitAwareFallback({
      response: { status: 'degraded' },
      errorCodes: ['UNAVAILABLE', 'DEADLINE_EXCEEDED'],
    })

    // Should fallback for UNAVAILABLE
    const result1 = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new RaffelError('UNAVAILABLE', 'Service down')
      }
    )

    expect(result1).toEqual({ status: 'degraded' })

    // Should fallback for DEADLINE_EXCEEDED
    const result2 = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new RaffelError('DEADLINE_EXCEEDED', 'Timeout')
      }
    )

    expect(result2).toEqual({ status: 'degraded' })

    // Should NOT fallback for other codes
    await expect(
      fallback(
        createEnvelope('test'),
        createTestContext(),
        async () => {
          throw new RaffelError('INVALID_ARGUMENT', 'Bad input')
        }
      )
    ).rejects.toThrow('Bad input')
  })

  it('should use default error codes if not specified', async () => {
    const fallback = createCircuitAwareFallback({
      response: { status: 'degraded' },
      // Uses default codes: UNAVAILABLE, DEADLINE_EXCEEDED, INTERNAL_ERROR
    })

    // INTERNAL_ERROR should trigger fallback
    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new RaffelError('INTERNAL_ERROR', 'Something broke')
      }
    )

    expect(result).toEqual({ status: 'degraded' })
  })

  it('should support handler function', async () => {
    const fallback = createCircuitAwareFallback({
      handler: (ctx, error) => ({
        degraded: true,
        reason: error.message,
      }),
      errorCodes: ['UNAVAILABLE'],
    })

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new RaffelError('UNAVAILABLE', 'API unreachable')
      }
    )

    expect(result).toEqual({
      degraded: true,
      reason: 'API unreachable',
    })
  })
})
