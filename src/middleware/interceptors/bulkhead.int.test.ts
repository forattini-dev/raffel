/**
 * Bulkhead (Concurrency Limiter) Interceptor Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createBulkheadInterceptor,
  createProcedureBulkhead,
  createBulkheadManager,
} from './bulkhead.js'
import type { Envelope, Context } from '../../types/index.js'
import { createContext } from '../../types/index.js'

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

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('createBulkheadInterceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should throw if concurrency is less than 1', () => {
    expect(() => createBulkheadInterceptor({ concurrency: 0 })).toThrow(
      'Bulkhead concurrency must be at least 1'
    )
  })

  it('should allow requests within concurrency limit', async () => {
    const interceptor = createBulkheadInterceptor({ concurrency: 2 })

    const results = await Promise.all([
      interceptor(createEnvelope('test'), createTestContext(), async () => 'result-1'),
      interceptor(createEnvelope('test'), createTestContext(), async () => 'result-2'),
    ])

    expect(results).toEqual(['result-1', 'result-2'])
  })

  it('should reject requests exceeding limit when no queue', async () => {
    vi.useRealTimers() // Need real timers for concurrent execution

    const interceptor = createBulkheadInterceptor({
      concurrency: 1,
      maxQueueSize: 0, // No queue
    })

    // Start a long-running request
    const slowRequest = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        await delay(100)
        return 'slow'
      }
    )

    // Give the first request time to start
    await delay(10)

    // Second request should be rejected immediately
    await expect(
      interceptor(createEnvelope('test'), createTestContext(), async () => 'fast')
    ).rejects.toThrow('Bulkhead capacity exceeded')

    // First request should complete
    await expect(slowRequest).resolves.toBe('slow')
  })

  it('should queue requests when maxQueueSize > 0', async () => {
    vi.useRealTimers()

    const interceptor = createBulkheadInterceptor({
      concurrency: 1,
      maxQueueSize: 10,
    })

    // Start first request
    const firstRequest = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        await delay(50)
        return 'first'
      }
    )

    // Give it time to start
    await delay(10)

    // Second request should queue
    const secondRequest = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => 'second'
    )

    const results = await Promise.all([firstRequest, secondRequest])
    expect(results).toEqual(['first', 'second'])
  })

  it('should reject when queue is full', async () => {
    vi.useRealTimers()

    const interceptor = createBulkheadInterceptor({
      concurrency: 1,
      maxQueueSize: 1, // Only 1 can wait
    })

    // Start first request
    const firstRequest = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        await delay(100)
        return 'first'
      }
    )

    // Give it time to start
    await delay(10)

    // Second request goes to queue
    const secondRequest = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => 'second'
    )

    // Give second time to queue
    await delay(10)

    // Third should be rejected (queue full)
    await expect(
      interceptor(createEnvelope('test'), createTestContext(), async () => 'third')
    ).rejects.toThrow('Bulkhead capacity exceeded')

    // First two should complete
    const results = await Promise.all([firstRequest, secondRequest])
    expect(results).toEqual(['first', 'second'])
  })

  it('should timeout queued requests after queueTimeout', async () => {
    vi.useRealTimers()

    const interceptor = createBulkheadInterceptor({
      concurrency: 1,
      maxQueueSize: 10,
      queueTimeout: 50, // 50ms timeout
    })

    // Start a very slow request
    const slowRequest = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        await delay(200)
        return 'slow'
      }
    )

    // Give it time to start
    await delay(10)

    // Second request should timeout in queue
    await expect(
      interceptor(createEnvelope('test'), createTestContext(), async () => 'waiting')
    ).rejects.toThrow('timed out waiting in bulkhead queue')

    // First request completes normally
    await expect(slowRequest).resolves.toBe('slow')
  })

  it('should release slot on successful completion', async () => {
    vi.useRealTimers()

    const interceptor = createBulkheadInterceptor({
      concurrency: 1,
    })

    // First request
    await interceptor(createEnvelope('test'), createTestContext(), async () => 'first')

    // Second request should work (slot was released)
    const result = await interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => 'second'
    )

    expect(result).toBe('second')
  })

  it('should release slot on error', async () => {
    vi.useRealTimers()

    const interceptor = createBulkheadInterceptor({
      concurrency: 1,
    })

    // First request fails
    await expect(
      interceptor(createEnvelope('test'), createTestContext(), async () => {
        throw new Error('Boom!')
      })
    ).rejects.toThrow('Boom!')

    // Second request should work (slot was released)
    const result = await interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => 'second'
    )

    expect(result).toBe('second')
  })

  it('should track procedures independently', async () => {
    vi.useRealTimers()

    const interceptor = createBulkheadInterceptor({
      concurrency: 1,
      maxQueueSize: 0,
    })

    // Start request for procedure-a
    const reqA = interceptor(
      createEnvelope('procedure-a'),
      createTestContext(),
      async () => {
        await delay(100)
        return 'a'
      }
    )

    await delay(10)

    // procedure-b should work (different bulkhead)
    const resultB = await interceptor(
      createEnvelope('procedure-b'),
      createTestContext(),
      async () => 'b'
    )

    expect(resultB).toBe('b')
    await expect(reqA).resolves.toBe('a')
  })

  it('should call onReject callback when rejecting', async () => {
    vi.useRealTimers()

    const onReject = vi.fn()

    const interceptor = createBulkheadInterceptor({
      concurrency: 1,
      maxQueueSize: 0,
      onReject,
    })

    // Start first request
    const firstRequest = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        await delay(100)
        return 'first'
      }
    )

    await delay(10)

    // Second request should be rejected
    await expect(
      interceptor(createEnvelope('test'), createTestContext(), async () => 'second')
    ).rejects.toThrow()

    expect(onReject).toHaveBeenCalledWith('test')

    await firstRequest
  })

  it('should call onQueued and onDequeued callbacks', async () => {
    vi.useRealTimers()

    const onQueued = vi.fn()
    const onDequeued = vi.fn()

    const interceptor = createBulkheadInterceptor({
      concurrency: 1,
      maxQueueSize: 10,
      onQueued,
      onDequeued,
    })

    // Start first request
    const firstRequest = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        await delay(50)
        return 'first'
      }
    )

    await delay(10)

    // Second request should queue
    const secondRequest = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => 'second'
    )

    await Promise.all([firstRequest, secondRequest])

    expect(onQueued).toHaveBeenCalledTimes(1)
    expect(onDequeued).toHaveBeenCalledTimes(1)
  })
})

describe('createProcedureBulkhead', () => {
  it('should use default config for unspecified procedures', async () => {
    const interceptor = createProcedureBulkhead({
      default: { concurrency: 5 },
      procedures: {},
    })

    const results = await Promise.all([
      interceptor(createEnvelope('test'), createTestContext(), async () => 'a'),
      interceptor(createEnvelope('test'), createTestContext(), async () => 'b'),
    ])

    expect(results).toEqual(['a', 'b'])
  })

  it('should use procedure-specific config', async () => {
    vi.useRealTimers()

    const interceptor = createProcedureBulkhead({
      default: { concurrency: 10 },
      procedures: {
        'limited.procedure': { concurrency: 1, maxQueueSize: 0 },
      },
    })

    // Start limited procedure
    const firstReq = interceptor(
      createEnvelope('limited.procedure'),
      createTestContext(),
      async () => {
        await delay(100)
        return 'first'
      }
    )

    await delay(10)

    // Should reject (concurrency: 1)
    await expect(
      interceptor(
        createEnvelope('limited.procedure'),
        createTestContext(),
        async () => 'second'
      )
    ).rejects.toThrow('Bulkhead capacity exceeded')

    await firstReq
  })

  it('should match patterns', async () => {
    vi.useRealTimers()

    const interceptor = createProcedureBulkhead({
      default: { concurrency: 10 },
      procedures: {
        'heavy.*': { concurrency: 1, maxQueueSize: 0 },
      },
    })

    // Start heavy.process
    const firstReq = interceptor(
      createEnvelope('heavy.process'),
      createTestContext(),
      async () => {
        await delay(100)
        return 'first'
      }
    )

    await delay(10)

    // Should reject (matches heavy.* pattern)
    await expect(
      interceptor(
        createEnvelope('heavy.another'),
        createTestContext(),
        async () => 'second'
      )
    ).rejects.toThrow('Bulkhead capacity exceeded')

    await firstReq
  })
})

describe('createBulkheadManager', () => {
  it('should provide interceptor', async () => {
    const manager = createBulkheadManager({ concurrency: 5 })

    const result = await manager.interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => 'success'
    )

    expect(result).toBe('success')
  })

  it('should provide getStats method', () => {
    const manager = createBulkheadManager({ concurrency: 5 })

    const stats = manager.getStats()
    expect(stats).toBeInstanceOf(Map)
  })
})
