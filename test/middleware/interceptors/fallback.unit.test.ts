/**
 * Fallback Interceptor Unit Tests
 *
 * Focused unit tests that complement the existing integration tests.
 * Covers: edge cases for config validation, undefined/null fallback values,
 * handler receiving correct arguments, and createProcedureFallback caching.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createFallbackInterceptor,
  createProcedureFallback,
  createCircuitAwareFallback,
} from '../../../src/middleware/interceptors/fallback.js'
import type { Envelope, Context } from '../../../src/types/index.js'
import { createContext } from '../../../src/types/index.js'

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

describe('createFallbackInterceptor — config validation', () => {
  it('should throw when config is empty (no response or handler)', () => {
    expect(() => createFallbackInterceptor({})).toThrow(
      'Fallback interceptor requires either "response" or "handler" option',
    )
  })

  it('should accept response with explicit undefined handler', () => {
    expect(() =>
      createFallbackInterceptor({ response: 'ok', handler: undefined }),
    ).not.toThrow()
  })

  it('should accept handler with explicit undefined response', () => {
    expect(() =>
      createFallbackInterceptor({ handler: () => 'ok', response: undefined }),
    ).not.toThrow()
  })
})

describe('createFallbackInterceptor — falsy fallback values', () => {
  it('should return null as fallback value', async () => {
    const fallback = createFallbackInterceptor({ response: null })

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('fail')
      },
    )

    expect(result).toBeNull()
  })

  it('should return 0 as fallback value', async () => {
    const fallback = createFallbackInterceptor({ response: 0 })

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('fail')
      },
    )

    expect(result).toBe(0)
  })

  it('should return empty string as fallback value', async () => {
    const fallback = createFallbackInterceptor({ response: '' })

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('fail')
      },
    )

    expect(result).toBe('')
  })

  it('should return false as fallback value', async () => {
    const fallback = createFallbackInterceptor({ response: false })

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('fail')
      },
    )

    expect(result).toBe(false)
  })
})

describe('createFallbackInterceptor — handler receives correct args', () => {
  it('should pass context as first arg and error as second to handler', async () => {
    const handler = vi.fn().mockReturnValue('recovered')

    const fallback = createFallbackInterceptor({ handler })
    const ctx = createTestContext()
    const thrownError = new Error('specific-error')

    await fallback(createEnvelope('test'), ctx, async () => {
      throw thrownError
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toBe(ctx)
    expect(handler.mock.calls[0][1]).toBe(thrownError)
  })

  it('should return undefined when handler returns undefined', async () => {
    const fallback = createFallbackInterceptor({ handler: () => undefined })

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('fail')
      },
    )

    expect(result).toBeUndefined()
  })
})

describe('createFallbackInterceptor — when predicate', () => {
  it('should call when predicate with the thrown error', async () => {
    const whenFn = vi.fn().mockReturnValue(true)
    const fallback = createFallbackInterceptor({
      response: 'fallback',
      when: whenFn,
    })

    const thrownError = new Error('check-me')

    await fallback(createEnvelope('test'), createTestContext(), async () => {
      throw thrownError
    })

    expect(whenFn).toHaveBeenCalledWith(thrownError)
  })

  it('should re-throw when predicate returns false with handler provided', async () => {
    const handler = vi.fn().mockReturnValue('should-not-run')
    const fallback = createFallbackInterceptor({
      handler,
      when: () => false,
    })

    await expect(
      fallback(createEnvelope('test'), createTestContext(), async () => {
        throw new Error('re-throw-me')
      }),
    ).rejects.toThrow('re-throw-me')

    expect(handler).not.toHaveBeenCalled()
  })
})

describe('createFallbackInterceptor — success passthrough', () => {
  it('should not invoke handler on success even with handler configured', async () => {
    const handler = vi.fn().mockReturnValue('fallback')

    const fallback = createFallbackInterceptor({ handler })

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => 'success',
    )

    expect(result).toBe('success')
    expect(handler).not.toHaveBeenCalled()
  })

  it('should not invoke when predicate on success', async () => {
    const whenFn = vi.fn().mockReturnValue(true)

    const fallback = createFallbackInterceptor({
      response: 'fallback',
      when: whenFn,
    })

    await fallback(createEnvelope('test'), createTestContext(), async () => 'ok')

    expect(whenFn).not.toHaveBeenCalled()
  })
})

describe('createProcedureFallback — caching', () => {
  it('should cache fallback interceptors for repeated procedures', async () => {
    const fallback = createProcedureFallback({
      procedures: {
        'users.get': { response: { cached: true } },
      },
    })

    // Call twice for same procedure
    const result1 = await fallback(
      createEnvelope('users.get'),
      createTestContext(),
      async () => {
        throw new Error('fail')
      },
    )

    const result2 = await fallback(
      createEnvelope('users.get'),
      createTestContext(),
      async () => {
        throw new Error('fail')
      },
    )

    expect(result1).toEqual({ cached: true })
    expect(result2).toEqual({ cached: true })
  })

  it('should pass through on success even with procedure fallback configured', async () => {
    const fallback = createProcedureFallback({
      procedures: {
        'users.get': { response: { fallback: true } },
      },
    })

    const result = await fallback(
      createEnvelope('users.get'),
      createTestContext(),
      async () => ({ real: true }),
    )

    expect(result).toEqual({ real: true })
  })
})

describe('createCircuitAwareFallback — edge cases', () => {
  it('should not fallback for errors without a code property', async () => {
    const fallback = createCircuitAwareFallback({
      response: { degraded: true },
    })

    await expect(
      fallback(createEnvelope('test'), createTestContext(), async () => {
        throw new Error('plain error')
      }),
    ).rejects.toThrow('plain error')
  })

  it('should work with custom error codes', async () => {
    const fallback = createCircuitAwareFallback({
      response: { degraded: true },
      errorCodes: ['CUSTOM_CODE'],
    })

    const error = new Error('custom') as Error & { code: string }
    error.code = 'CUSTOM_CODE'

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      },
    )

    expect(result).toEqual({ degraded: true })
  })

  it('should support handler with circuit-aware fallback', async () => {
    const fallback = createCircuitAwareFallback({
      handler: (_ctx, err) => ({ recovered: true, msg: err.message }),
      errorCodes: ['UNAVAILABLE'],
    })

    const error = new Error('down') as Error & { code: string }
    error.code = 'UNAVAILABLE'

    const result = await fallback(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      },
    )

    expect(result).toEqual({ recovered: true, msg: 'down' })
  })
})
