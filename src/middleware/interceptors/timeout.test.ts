/**
 * Timeout Interceptor Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createTimeoutInterceptor,
  createCascadingTimeoutInterceptor,
  createDeadlinePropagationInterceptor,
} from './timeout.js'
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

describe('createTimeoutInterceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should allow fast requests to complete', async () => {
    const interceptor = createTimeoutInterceptor({
      defaultMs: 5000,
    })

    const result = await interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => 'done'
    )

    expect(result).toBe('done')
  })

  it('should timeout slow requests', async () => {
    const interceptor = createTimeoutInterceptor({
      defaultMs: 100,
    })

    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return 'done'
      }
    )

    // Advance time to trigger timeout
    vi.advanceTimersByTime(150)

    await expect(promise).rejects.toThrow()
  })

  it('should use procedure-specific timeouts', async () => {
    const interceptor = createTimeoutInterceptor({
      defaultMs: 100,
      procedures: {
        'slow.operation': 5000,
      },
    })

    // Default timeout - should fail
    const fastPromise = interceptor(
      createEnvelope('fast.operation'),
      createTestContext(),
      async () => {
        await new Promise(resolve => setTimeout(resolve, 200))
        return 'done'
      }
    )

    vi.advanceTimersByTime(150)
    await expect(fastPromise).rejects.toThrow()

    // Procedure-specific timeout - should succeed
    vi.useRealTimers()
    const slowResult = await interceptor(
      createEnvelope('slow.operation'),
      createTestContext(),
      async () => 'done'
    )

    expect(slowResult).toBe('done')
  })

  it('should use pattern-based timeouts', async () => {
    const interceptor = createTimeoutInterceptor({
      defaultMs: 100,
      patterns: {
        'reports.**': 5000,
        'export.*': 10000,
      },
    })

    // Pattern match should use longer timeout
    const result = await interceptor(
      createEnvelope('reports.monthly.generate'),
      createTestContext(),
      async () => 'done'
    )

    expect(result).toBe('done')
  })

  it('should set deadline in context', async () => {
    const interceptor = createTimeoutInterceptor({
      defaultMs: 5000,
    })

    const ctx = createTestContext()
    const startTime = Date.now()

    await interceptor(createEnvelope('test'), ctx, async () => 'done')

    expect(ctx.deadline).toBeDefined()
    expect(ctx.deadline).toBeGreaterThanOrEqual(startTime + 5000)
  })

  it('should throw DEADLINE_EXCEEDED error code', async () => {
    const interceptor = createTimeoutInterceptor({
      defaultMs: 50,
    })

    const promise = interceptor(
      createEnvelope('test'),
      createTestContext(),
      async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'done'
      }
    )

    vi.advanceTimersByTime(60)

    try {
      await promise
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RaffelError)
      expect((error as RaffelError).code).toBe('DEADLINE_EXCEEDED')
    }
  })

  it('should use shorter of context deadline and configured timeout', async () => {
    const interceptor = createTimeoutInterceptor({
      defaultMs: 10000, // 10 seconds
    })

    // Context has shorter deadline
    const ctx = createTestContext()
    ;(ctx as any).deadline = Date.now() + 50

    const promise = interceptor(
      createEnvelope('test'),
      ctx,
      async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        return 'done'
      }
    )

    vi.advanceTimersByTime(60)

    try {
      await promise
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RaffelError)
      expect((error as RaffelError).code).toBe('DEADLINE_EXCEEDED')
    }
  })
})

describe('createCascadingTimeoutInterceptor', () => {
  it('should apply initial timeout when no deadline exists', async () => {
    const interceptor = createCascadingTimeoutInterceptor({
      initialMs: 1000,
      reductionMs: 100,
      minimumMs: 100,
    })

    const ctx = createTestContext()
    const startTime = Date.now()

    await interceptor(createEnvelope('test'), ctx, async () => 'done')

    expect(ctx.deadline).toBeDefined()
    expect(ctx.deadline).toBeGreaterThanOrEqual(startTime + 1000)
  })

  it('should reduce timeout for nested calls with existing deadline', async () => {
    const interceptor = createCascadingTimeoutInterceptor({
      initialMs: 1000,
      reductionMs: 200,
      minimumMs: 100,
    })

    const ctx = createTestContext()
    ;(ctx as any).deadline = Date.now() + 1000 // Existing deadline

    const startTime = Date.now()
    await interceptor(createEnvelope('test'), ctx, async () => 'done')

    // New deadline should be reduced by reductionMs
    expect(ctx.deadline).toBeDefined()
    expect(ctx.deadline! - startTime).toBeLessThanOrEqual(800) // 1000 - 200
  })

  it('should respect minimum timeout', async () => {
    const interceptor = createCascadingTimeoutInterceptor({
      initialMs: 1000,
      reductionMs: 500,
      minimumMs: 200,
    })

    const ctx = createTestContext()
    ;(ctx as any).deadline = Date.now() + 100 // Very short deadline

    const startTime = Date.now()
    await interceptor(createEnvelope('test'), ctx, async () => 'done')

    // Should not go below minimum
    expect(ctx.deadline! - startTime).toBeGreaterThanOrEqual(200)
  })
})

describe('createDeadlinePropagationInterceptor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should propagate deadline from metadata to context', async () => {
    const interceptor = createDeadlinePropagationInterceptor()

    const deadline = Date.now() + 5000
    const envelope = createEnvelope('test', { 'x-deadline': deadline.toString() })
    const ctx = createTestContext()

    await interceptor(envelope, ctx, async () => 'done')

    expect(ctx.deadline).toBe(deadline)
  })

  it('should use default timeout when no deadline in metadata', async () => {
    const interceptor = createDeadlinePropagationInterceptor({
      defaultMs: 10000,
    })

    const envelope = createEnvelope('test')
    const ctx = createTestContext()
    const startTime = Date.now()

    await interceptor(envelope, ctx, async () => 'done')

    expect(ctx.deadline).toBeGreaterThanOrEqual(startTime + 10000)
  })

  it('should propagate deadline in metadata for downstream calls', async () => {
    const interceptor = createDeadlinePropagationInterceptor()

    const deadline = Date.now() + 5000
    const envelope = createEnvelope('test', { 'x-deadline': deadline.toString() })
    const ctx = createTestContext()

    await interceptor(envelope, ctx, async () => 'done')

    expect(envelope.metadata['x-deadline']).toBe(deadline.toString())
  })

  it('should timeout when deadline has passed', async () => {
    const interceptor = createDeadlinePropagationInterceptor()

    // Set deadline in the past
    const deadline = Date.now() - 100
    const envelope = createEnvelope('test', { 'x-deadline': deadline.toString() })
    const ctx = createTestContext()

    try {
      await interceptor(envelope, ctx, async () => 'done')
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RaffelError)
      expect((error as RaffelError).code).toBe('DEADLINE_EXCEEDED')
    }
  })

  it('should use custom metadata key', async () => {
    const interceptor = createDeadlinePropagationInterceptor({
      metadataKey: 'x-custom-deadline',
    })

    const deadline = Date.now() + 5000
    const envelope = createEnvelope('test', { 'x-custom-deadline': deadline.toString() })
    const ctx = createTestContext()

    await interceptor(envelope, ctx, async () => 'done')

    expect(ctx.deadline).toBe(deadline)
  })
})
