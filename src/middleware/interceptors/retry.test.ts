/**
 * Retry Interceptor Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createRetryInterceptor,
  createSelectiveRetryInterceptor,
  createRetryAfterInterceptor,
  parseRetryAfter,
} from './retry.js'
import type { Envelope, Context } from '../../types/index.js'
import { createContext } from '../../types/index.js'
import { RaffelError } from '../../core/router.js'

function createEnvelope(procedure: string, metadata: Record<string, string> = {}): Envelope {
  return {
    id: `test-${Date.now()}`,
    procedure,
    payload: {},
    type: 'request',
    metadata: { ...metadata },
    context: createContext('test-id'),
  }
}

function createTestContext(): Context {
  return createContext('test')
}

describe('createRetryInterceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should succeed without retries when no error', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 3,
    })

    let callCount = 0
    const result = await interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        return 'success'
      }
    )

    expect(result).toBe('success')
    expect(callCount).toBe(1)
  })

  it('should retry on transient errors', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 3,
      initialDelayMs: 10,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount < 3) {
          throw new RaffelError('UNAVAILABLE', 'Service temporarily unavailable')
        }
        return 'success'
      }
    )

    // Advance through retries
    await vi.advanceTimersByTimeAsync(100)

    const result = await promise
    expect(result).toBe('success')
    expect(callCount).toBe(3)
  })

  it('should give up after max attempts', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 3,
      initialDelayMs: 10,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        throw new RaffelError('UNAVAILABLE', 'Always fails')
      }
    )

    // Attach catch handler immediately to prevent unhandled rejection
    const resultPromise = promise.catch((e) => e)

    // Advance through all retries
    await vi.advanceTimersByTimeAsync(500)

    const result = await resultPromise as RaffelError
    expect(result).toBeInstanceOf(RaffelError)
    expect(result.message).toBe('Always fails')
    expect(callCount).toBe(3)
  })

  it('should not retry non-retryable errors', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 3,
    })

    let callCount = 0
    await expect(
      interceptor(
        createEnvelope('test'),
        createTestContext(),
        async () => {
          callCount++
          throw new RaffelError('INVALID_ARGUMENT', 'Bad input')
        }
      )
    ).rejects.toThrow('Bad input')

    expect(callCount).toBe(1) // No retries
  })

  it('should respect backoff multiplier', async () => {
    const delays: number[] = []
    const originalSetTimeout = global.setTimeout

    vi.stubGlobal('setTimeout', (fn: () => void, delay: number) => {
      delays.push(delay)
      return originalSetTimeout(fn, 0) // Execute immediately for testing
    })

    const interceptor = createRetryInterceptor({
      maxAttempts: 4,
      initialDelayMs: 100,
      backoffMultiplier: 2,
      maxDelayMs: 10000,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount < 4) {
          throw new RaffelError('UNAVAILABLE', 'Retry me')
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(10000)

    await promise

    // Check that delays increase exponentially
    // First delay: 100, Second: 200, Third: 400
    expect(delays.length).toBe(3)

    vi.unstubAllGlobals()
  })

  it('should add retry metadata', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 3,
      initialDelayMs: 10,
    })

    const envelope = createEnvelope('test')
    let attempts: string[] = []

    const promise = interceptor(
      envelope,
      createTestContext(),
      async () => {
        attempts.push(envelope.metadata['x-retry-attempt'] || '0')
        if (attempts.length < 2) {
          throw new RaffelError('UNAVAILABLE', 'Retry')
        }
        return 'done'
      }
    )

    await vi.advanceTimersByTimeAsync(100)
    await promise

    expect(attempts).toEqual(['0', '1'])
  })

  it('should use custom shouldRetry function', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 3,
      shouldRetry: (error) => {
        // Only retry specific custom error
        return error.message === 'Retry this'
      },
    })

    let callCount = 0

    // This error should not be retried
    await expect(
      interceptor(
        createEnvelope('test'),
        createTestContext(),
        async () => {
          callCount++
          throw new Error('Do not retry this')
        }
      )
    ).rejects.toThrow('Do not retry this')

    expect(callCount).toBe(1)
  })
})

describe('createSelectiveRetryInterceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should only retry specified procedures', async () => {
    const interceptor = createSelectiveRetryInterceptor({
      procedures: ['external.api', 'database.query'],
      config: {
        maxAttempts: 3,
        initialDelayMs: 10,
      },
    })

    // Included procedure - should retry
    let callCount1 = 0
    const promise1 = interceptor(
      createEnvelope('external.api'),
      createTestContext(),
      async () => {
        callCount1++
        if (callCount1 < 2) {
          throw new RaffelError('UNAVAILABLE', 'Retry')
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(100)
    await promise1
    expect(callCount1).toBe(2)

    // Non-included procedure - should not retry
    let callCount2 = 0
    await expect(
      interceptor(
        createEnvelope('local.operation'),
        createTestContext(),
        async () => {
          callCount2++
          throw new RaffelError('UNAVAILABLE', 'No retry')
        }
      )
    ).rejects.toThrow('No retry')

    expect(callCount2).toBe(1)
  })

  it('should support glob patterns for procedures', async () => {
    const interceptor = createSelectiveRetryInterceptor({
      procedures: ['external.*'],
      config: {
        maxAttempts: 2,
        initialDelayMs: 10,
      },
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('external.payment'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount < 2) {
          throw new RaffelError('UNAVAILABLE', 'Retry')
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(100)
    await promise
    expect(callCount).toBe(2)
  })
})

describe('createRetryAfterInterceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should respect retry-after header from error', async () => {
    const interceptor = createRetryAfterInterceptor({
      maxAttempts: 3,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount === 1) {
          const error = new RaffelError('RATE_LIMITED', 'Too many requests', {
            retryAfter: 2, // 2 seconds
          })
          throw error
        }
        return 'success'
      }
    )

    // Should wait approximately 2 seconds before retry
    await vi.advanceTimersByTimeAsync(2500)

    const result = await promise
    expect(result).toBe('success')
    expect(callCount).toBe(2)
  })

  it('should use default delay when no retry-after provided', async () => {
    const interceptor = createRetryAfterInterceptor({
      maxAttempts: 3,
      initialDelayMs: 500,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount === 1) {
          throw new RaffelError('UNAVAILABLE', 'Try again')
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(1000)

    const result = await promise
    expect(result).toBe('success')
    expect(callCount).toBe(2)
  })
})

describe('parseRetryAfter', () => {
  it('should parse seconds as string', () => {
    expect(parseRetryAfter('120')).toBe(120000)
    expect(parseRetryAfter('0')).toBe(0)
    expect(parseRetryAfter('1')).toBe(1000)
  })

  it('should parse seconds as number', () => {
    expect(parseRetryAfter(60)).toBe(60000)
    expect(parseRetryAfter(0)).toBe(0)
  })

  it('should return undefined for null/undefined', () => {
    expect(parseRetryAfter(null)).toBeUndefined()
    expect(parseRetryAfter(undefined)).toBeUndefined()
  })

  it('should return undefined for negative values', () => {
    expect(parseRetryAfter(-1)).toBeUndefined()
    expect(parseRetryAfter('-5')).toBeUndefined()
  })

  it('should parse HTTP-date format', () => {
    // Set a fixed date for testing
    const futureDate = new Date(Date.now() + 30000) // 30 seconds in future
    const httpDate = futureDate.toUTCString()

    const result = parseRetryAfter(httpDate)
    expect(result).toBeDefined()
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThanOrEqual(30000)
  })

  it('should return undefined for past HTTP-date', () => {
    const pastDate = new Date(Date.now() - 30000) // 30 seconds in past
    const httpDate = pastDate.toUTCString()

    expect(parseRetryAfter(httpDate)).toBeUndefined()
  })

  it('should return undefined for invalid values', () => {
    expect(parseRetryAfter('invalid')).toBeUndefined()
  })
})

describe('backoffStrategy', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should use linear strategy', async () => {
    const delays: number[] = []
    const originalSetTimeout = global.setTimeout

    vi.stubGlobal('setTimeout', (fn: () => void, delay: number) => {
      delays.push(delay)
      return originalSetTimeout(fn, 0)
    })

    const interceptor = createRetryInterceptor({
      maxAttempts: 4,
      initialDelayMs: 100,
      backoffStrategy: 'linear',
      jitter: false,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount < 4) {
          throw new RaffelError('UNAVAILABLE', 'Retry')
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(10000)
    await promise

    // Linear: 100*1=100, 100*2=200, 100*3=300
    expect(delays).toEqual([100, 200, 300])

    vi.unstubAllGlobals()
  })

  it('should use exponential strategy', async () => {
    const delays: number[] = []
    const originalSetTimeout = global.setTimeout

    vi.stubGlobal('setTimeout', (fn: () => void, delay: number) => {
      delays.push(delay)
      return originalSetTimeout(fn, 0)
    })

    const interceptor = createRetryInterceptor({
      maxAttempts: 4,
      initialDelayMs: 100,
      backoffStrategy: 'exponential',
      backoffMultiplier: 2,
      jitter: false,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount < 4) {
          throw new RaffelError('UNAVAILABLE', 'Retry')
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(10000)
    await promise

    // Exponential: 100*2^0=100, 100*2^1=200, 100*2^2=400
    expect(delays).toEqual([100, 200, 400])

    vi.unstubAllGlobals()
  })

  it('should use decorrelated strategy with randomness', async () => {
    const delays: number[] = []
    const originalSetTimeout = global.setTimeout

    vi.stubGlobal('setTimeout', (fn: () => void, delay: number) => {
      delays.push(delay)
      return originalSetTimeout(fn, 0)
    })

    const interceptor = createRetryInterceptor({
      maxAttempts: 4,
      initialDelayMs: 100,
      maxDelayMs: 10000,
      backoffStrategy: 'decorrelated',
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount < 4) {
          throw new RaffelError('UNAVAILABLE', 'Retry')
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(30000)
    await promise

    // Decorrelated has randomness, just verify we got delays
    expect(delays.length).toBe(3)
    // Each delay should be >= baseDelay
    delays.forEach(d => expect(d).toBeGreaterThanOrEqual(100))

    vi.unstubAllGlobals()
  })
})

describe('onRetry hook', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should call onRetry before each retry', async () => {
    const retryCalls: Array<{ attempt: number; procedure: string }> = []

    const interceptor = createRetryInterceptor({
      maxAttempts: 3,
      initialDelayMs: 10,
      onRetry: ({ attempt, procedure, error }) => {
        retryCalls.push({ attempt, procedure })
      },
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test.procedure'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount < 3) {
          throw new RaffelError('UNAVAILABLE', 'Retry')
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(100)
    await promise

    expect(retryCalls).toEqual([
      { attempt: 1, procedure: 'test.procedure' },
      { attempt: 2, procedure: 'test.procedure' },
    ])
  })

  it('should provide correct context to onRetry', async () => {
    let capturedContext: any = null

    const interceptor = createRetryInterceptor({
      maxAttempts: 2,
      initialDelayMs: 100,
      onRetry: (ctx) => {
        capturedContext = ctx
      },
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('my.proc'),
      createTestContext(),
      async () => {
        callCount++
        throw new RaffelError('UNAVAILABLE', 'Test error')
      }
    )

    // Attach catch handler
    const resultPromise = promise.catch((e) => e)

    await vi.advanceTimersByTimeAsync(500)
    await resultPromise

    expect(capturedContext).not.toBeNull()
    expect(capturedContext.attempt).toBe(1)
    expect(capturedContext.maxAttempts).toBe(2)
    expect(capturedContext.procedure).toBe('my.proc')
    expect(capturedContext.delayMs).toBeGreaterThan(0)
    expect(capturedContext.error.message).toBe('Test error')
  })

  it('should support async onRetry', async () => {
    const calls: number[] = []

    const interceptor = createRetryInterceptor({
      maxAttempts: 2,
      initialDelayMs: 10,
      onRetry: async ({ attempt }) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        calls.push(attempt)
      },
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount < 2) {
          throw new RaffelError('UNAVAILABLE', 'Retry')
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(100)
    await promise

    expect(calls).toEqual([1])
  })
})

describe('respectRetryAfter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should use Retry-After from error.details', async () => {
    const delays: number[] = []
    const originalSetTimeout = global.setTimeout

    vi.stubGlobal('setTimeout', (fn: () => void, delay: number) => {
      delays.push(delay)
      return originalSetTimeout(fn, 0)
    })

    const interceptor = createRetryInterceptor({
      maxAttempts: 2,
      respectRetryAfter: true,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount === 1) {
          const error = new RaffelError('RATE_LIMITED', 'Rate limited', {
            retryAfter: 5, // 5 seconds
          })
          throw error
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(6000)
    await promise

    expect(delays[0]).toBe(5000) // Should use 5 seconds from Retry-After

    vi.unstubAllGlobals()
  })

  it('should cap Retry-After at maxDelayMs', async () => {
    const delays: number[] = []
    const originalSetTimeout = global.setTimeout

    vi.stubGlobal('setTimeout', (fn: () => void, delay: number) => {
      delays.push(delay)
      return originalSetTimeout(fn, 0)
    })

    const interceptor = createRetryInterceptor({
      maxAttempts: 2,
      maxDelayMs: 2000, // Cap at 2 seconds
      respectRetryAfter: true,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount === 1) {
          const error = new RaffelError('RATE_LIMITED', 'Rate limited', {
            retryAfter: 10, // 10 seconds - should be capped
          })
          throw error
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(3000)
    await promise

    expect(delays[0]).toBe(2000) // Capped at maxDelayMs

    vi.unstubAllGlobals()
  })

  it('should fall back to calculated delay when no Retry-After', async () => {
    const delays: number[] = []
    const originalSetTimeout = global.setTimeout

    vi.stubGlobal('setTimeout', (fn: () => void, delay: number) => {
      delays.push(delay)
      return originalSetTimeout(fn, 0)
    })

    const interceptor = createRetryInterceptor({
      maxAttempts: 2,
      initialDelayMs: 200,
      backoffStrategy: 'exponential',
      jitter: false,
      respectRetryAfter: true,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount === 1) {
          throw new RaffelError('UNAVAILABLE', 'No retry-after')
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(500)
    await promise

    expect(delays[0]).toBe(200) // Falls back to calculated delay

    vi.unstubAllGlobals()
  })

  it('should skip Retry-After when respectRetryAfter is false', async () => {
    const delays: number[] = []
    const originalSetTimeout = global.setTimeout

    vi.stubGlobal('setTimeout', (fn: () => void, delay: number) => {
      delays.push(delay)
      return originalSetTimeout(fn, 0)
    })

    const interceptor = createRetryInterceptor({
      maxAttempts: 2,
      initialDelayMs: 100,
      jitter: false,
      respectRetryAfter: false, // Disabled
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount === 1) {
          const error = new RaffelError('RATE_LIMITED', 'Rate limited', {
            retryAfter: 10, // 10 seconds - should be ignored
          })
          throw error
        }
        return 'success'
      }
    )

    await vi.advanceTimersByTimeAsync(500)
    await promise

    expect(delays[0]).toBe(100) // Uses calculated delay, not Retry-After

    vi.unstubAllGlobals()
  })
})
