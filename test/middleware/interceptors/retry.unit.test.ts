/**
 * Retry Interceptor Unit Tests
 *
 * Focused unit tests complementing the existing integration tests.
 * Covers: parseRetryAfter edge cases, non-retryable error types,
 * network error detection, signal/deadline abort, onRetry error
 * propagation, and retryAttempts metadata on final error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createRetryInterceptor,
  createSelectiveRetryInterceptor,
  parseRetryAfter,
} from '../../../src/middleware/interceptors/retry.js'
import type { Envelope, Context } from '../../../src/types/index.js'
import { createContext } from '../../../src/types/index.js'

function createEnvelope(
  procedure: string,
  metadata: Record<string, string> = {},
): Envelope {
  return {
    id: `test-${Date.now()}`,
    procedure,
    payload: {},
    type: 'request',
    metadata: { ...metadata },
    context: createContext('test-id'),
  }
}

function createTestContext(options: {
  signal?: AbortSignal
  deadline?: number
} = {}): Context {
  return createContext('test', {
    signal: options.signal,
    deadline: options.deadline,
  })
}

describe('parseRetryAfter — additional edge cases', () => {
  it('should return undefined for empty string', () => {
    expect(parseRetryAfter('')).toBeUndefined()
  })

  it('should parse "0" as 0ms', () => {
    expect(parseRetryAfter('0')).toBe(0)
  })

  it('should parse 0 as 0ms', () => {
    expect(parseRetryAfter(0)).toBe(0)
  })

  it('should handle large second values', () => {
    expect(parseRetryAfter(3600)).toBe(3600000)
  })

  it('should return undefined for negative number', () => {
    expect(parseRetryAfter(-10)).toBeUndefined()
  })

  it('should return undefined for NaN-like string', () => {
    expect(parseRetryAfter('not-a-number')).toBeUndefined()
  })

  it('should handle float-like string by truncating to integer', () => {
    // parseInt('3.5', 10) => 3
    expect(parseRetryAfter('3.5')).toBe(3000)
  })
})

describe('createRetryInterceptor — network error detection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should retry ECONNREFUSED errors', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 2,
      initialDelayMs: 10,
      jitter: false,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount < 2) throw new Error('connect ECONNREFUSED 127.0.0.1:3000')
        return 'success'
      },
    )

    await vi.advanceTimersByTimeAsync(100)
    const result = await promise
    expect(result).toBe('success')
    expect(callCount).toBe(2)
  })

  it('should retry ETIMEDOUT errors', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 2,
      initialDelayMs: 10,
      jitter: false,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount < 2) throw new Error('ETIMEDOUT')
        return 'recovered'
      },
    )

    await vi.advanceTimersByTimeAsync(100)
    const result = await promise
    expect(result).toBe('recovered')
    expect(callCount).toBe(2)
  })

  it('should retry socket hang up errors', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 2,
      initialDelayMs: 10,
      jitter: false,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount < 2) throw new Error('socket hang up')
        return 'ok'
      },
    )

    await vi.advanceTimersByTimeAsync(100)
    const result = await promise
    expect(result).toBe('ok')
    expect(callCount).toBe(2)
  })

  it('should NOT retry arbitrary non-retryable errors', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 3,
      initialDelayMs: 10,
    })

    let callCount = 0
    await expect(
      interceptor(createEnvelope('test'), createTestContext(), async () => {
        callCount++
        throw new Error('Some random application error')
      }),
    ).rejects.toThrow('Some random application error')

    expect(callCount).toBe(1)
  })
})

describe('createRetryInterceptor — abort/deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should abort immediately if signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()

    const interceptor = createRetryInterceptor({ maxAttempts: 3 })

    await expect(
      interceptor(
        createEnvelope('test'),
        createTestContext({ signal: ac.signal }),
        async () => 'should-not-reach',
      ),
    ).rejects.toThrow('Request was cancelled')
  })

  it('should abort if deadline is already passed', async () => {
    const interceptor = createRetryInterceptor({ maxAttempts: 3 })

    await expect(
      interceptor(
        createEnvelope('test'),
        createTestContext({ deadline: Date.now() - 1000 }),
        async () => 'should-not-reach',
      ),
    ).rejects.toThrow('Request deadline exceeded')
  })

  it('should stop retrying when deadline would be exceeded by delay', async () => {
    const now = Date.now()
    vi.setSystemTime(now)

    const interceptor = createRetryInterceptor({
      maxAttempts: 5,
      initialDelayMs: 500,
      jitter: false,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      // Deadline is 200ms from now — first retry delay (500ms) exceeds it
      createTestContext({ deadline: now + 200 }),
      async () => {
        callCount++
        const err = new Error('fail') as Error & { code: string }
        err.code = 'UNAVAILABLE'
        throw err
      },
    )

    const resultPromise = promise.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1000)
    const result = await resultPromise

    expect((result as Error).message).toBe('fail')
    // Should only attempt once — the retry delay would exceed deadline
    expect(callCount).toBe(1)
  })
})

describe('createRetryInterceptor — final error metadata', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should attach retryAttempts to the final error', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 3,
      initialDelayMs: 10,
      jitter: false,
    })

    const error = new Error('always fails') as Error & {
      code: string
      retryAttempts?: number
    }
    error.code = 'UNAVAILABLE'

    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw error
      },
    )

    const resultPromise = promise.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1000)
    const result = (await resultPromise) as Error & { retryAttempts: number }

    expect(result.retryAttempts).toBe(3)
  })

  it('should add x-retry-attempt and x-retry-delay metadata to envelope', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 3,
      initialDelayMs: 50,
      jitter: false,
    })

    const envelope = createEnvelope('test')
    let callCount = 0

    const promise = interceptor(envelope, createTestContext(), async () => {
      callCount++
      if (callCount < 3) {
        const err = new Error('retry') as Error & { code: string }
        err.code = 'UNAVAILABLE'
        throw err
      }
      return 'done'
    })

    await vi.advanceTimersByTimeAsync(1000)
    await promise

    expect(envelope.metadata['x-retry-attempt']).toBe('2')
    expect(envelope.metadata['x-retry-delay']).toBeDefined()
  })
})

describe('createRetryInterceptor — custom shouldRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should pass attempt number to shouldRetry', async () => {
    const attempts: number[] = []

    const interceptor = createRetryInterceptor({
      maxAttempts: 3,
      initialDelayMs: 10,
      jitter: false,
      shouldRetry: (_error, attempt) => {
        attempts.push(attempt)
        return true
      },
    })

    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        throw new Error('always')
      },
    )

    const resultPromise = promise.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(500)
    await resultPromise

    // shouldRetry is called after attempt 1 and 2 (not after 3 since that's maxAttempts)
    expect(attempts).toEqual([1, 2])
  })

  it('should stop retrying when shouldRetry returns false', async () => {
    const interceptor = createRetryInterceptor({
      maxAttempts: 5,
      initialDelayMs: 10,
      jitter: false,
      shouldRetry: (_error, attempt) => attempt < 2,
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        throw new Error('fail')
      },
    )

    const resultPromise = promise.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(500)
    await resultPromise

    // Attempt 1 fails, shouldRetry(err,1) => true => attempt 2
    // Attempt 2 fails, shouldRetry(err,2) => false => stop
    expect(callCount).toBe(2)
  })
})

describe('createSelectiveRetryInterceptor — edge cases', () => {
  it('should pass through non-matching procedures without delay', async () => {
    const interceptor = createSelectiveRetryInterceptor({
      procedures: ['external.*'],
      config: { maxAttempts: 3 },
    })

    await expect(
      interceptor(createEnvelope('local.method'), createTestContext(), async () => {
        throw new Error('no retry for you')
      }),
    ).rejects.toThrow('no retry for you')
  })

  it('should use default config when config is omitted', async () => {
    vi.useFakeTimers()

    const interceptor = createSelectiveRetryInterceptor({
      procedures: ['test'],
    })

    let callCount = 0
    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        callCount++
        if (callCount < 2) {
          const err = new Error('fail') as Error & { code: string }
          err.code = 'UNAVAILABLE'
          throw err
        }
        return 'ok'
      },
    )

    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise
    expect(result).toBe('ok')
    expect(callCount).toBe(2)

    vi.useRealTimers()
  })
})
