import { describe, it, expect, vi } from 'vitest'
import { createRouter, RaffelError } from './router.js'
import { createRegistry } from './registry.js'
import { createContext } from '../types/context.js'
import type { Envelope, Interceptor } from '../types/index.js'

/**
 * Create a test envelope
 */
function createTestEnvelope(
  procedure: string,
  payload: unknown = {},
  type: Envelope['type'] = 'request',
  id = 'test-envelope-id'
): Envelope {
  const ctx = createContext('test-request-id')
  return {
    id,
    procedure,
    type,
    payload,
    metadata: {},
    context: ctx,
  }
}

describe('Router', () => {
  describe('procedure routing', () => {
    it('should route to registered procedure', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('greet', async (input: { name: string }) => {
        return `Hello, ${input.name}!`
      })

      const envelope = createTestEnvelope('greet', { name: 'World' })
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('response')
      expect(result.payload).toBe('Hello, World!')
    })

    it('should return NOT_FOUND for unknown procedure', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      const envelope = createTestEnvelope('unknown')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('NOT_FOUND')
    })

    it('should handle RaffelError from handler', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('fail', async () => {
        throw new RaffelError('VALIDATION_ERROR', 'Invalid input', {
          field: 'name',
        })
      })

      const envelope = createTestEnvelope('fail')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('VALIDATION_ERROR')
      expect((result.payload as any).message).toBe('Invalid input')
      expect((result.payload as any).details).toEqual({ field: 'name' })
    })

    it('should handle unknown errors', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('crash', async () => {
        throw new Error('Unexpected error')
      })

      const envelope = createTestEnvelope('crash')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('INTERNAL_ERROR')
    })
  })

  describe('stream routing', () => {
    it('should route to stream handler', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.stream('numbers', async function* (input: { count: number }) {
        for (let i = 0; i < input.count; i++) {
          yield i
        }
      })

      const envelope = createTestEnvelope('numbers', { count: 3 }, 'stream:start')
      const result = await router.handle(envelope)

      // Result should be an async iterable of envelopes
      const envelopes: Envelope[] = []
      for await (const env of result as AsyncIterable<Envelope>) {
        envelopes.push(env)
      }

      // Should have: start, data(0), data(1), data(2), end
      expect(envelopes.length).toBe(5)
      expect(envelopes[0].type).toBe('stream:start')
      expect(envelopes[1].type).toBe('stream:data')
      expect(envelopes[1].payload).toBe(0)
      expect(envelopes[2].payload).toBe(1)
      expect(envelopes[3].payload).toBe(2)
      expect(envelopes[4].type).toBe('stream:end')
    })

    it('should handle stream errors', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.stream('failing', async function* () {
        yield 1
        throw new Error('Stream failed')
      })

      const envelope = createTestEnvelope('failing', {}, 'stream:start')
      const result = await router.handle(envelope)

      const envelopes: Envelope[] = []
      for await (const env of result as AsyncIterable<Envelope>) {
        envelopes.push(env)
      }

      // Should have: start, data(1), error
      expect(envelopes.length).toBe(3)
      expect(envelopes[0].type).toBe('stream:start')
      expect(envelopes[1].type).toBe('stream:data')
      expect(envelopes[2].type).toBe('stream:error')
      expect((envelopes[2].payload as any).message).toBe('Stream failed')
    })
  })

  describe('event routing', () => {
    it('should route to event handler', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      let received: unknown = null
      registry.event('user.created', async (payload) => {
        received = payload
      })

      const envelope = createTestEnvelope('user.created', { userId: '123' }, 'event')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('response')
      expect(result.payload).toEqual({ received: true })

      // Give event handler time to execute (it's fire-and-forget)
      await new Promise((r) => setTimeout(r, 10))
      expect(received).toEqual({ userId: '123' })
    })

    it('should retry at-least-once until ack', async () => {
      vi.useFakeTimers()
      const registry = createRegistry()
      const router = createRouter(registry)

      let calls = 0
      registry.event(
        'job.process',
        async (_payload, _ctx, ack) => {
          calls += 1
          if (calls >= 2) {
            ack?.()
            return
          }
          throw new Error('fail once')
        },
        {
          delivery: 'at-least-once',
          retryPolicy: {
            maxAttempts: 3,
            initialDelay: 10,
            maxDelay: 10,
            backoffMultiplier: 1,
          },
        }
      )

      const envelope = createTestEnvelope('job.process', {}, 'event', 'evt-1')
      await router.handle(envelope)
      expect(calls).toBe(1)

      await vi.advanceTimersByTimeAsync(10)
      await vi.advanceTimersByTimeAsync(10)
      expect(calls).toBe(2)

      vi.useRealTimers()
    })

    it('should apply default retry policy when missing', async () => {
      vi.useFakeTimers()
      const registry = createRegistry()
      const router = createRouter(registry)

      let calls = 0
      registry.event('job.default', async () => {
        calls += 1
        throw new Error('always fail')
      }, { delivery: 'at-least-once' })

      const envelope = createTestEnvelope('job.default', {}, 'event', 'evt-2')
      await router.handle(envelope)
      expect(calls).toBe(1)

      await vi.advanceTimersByTimeAsync(15000)
      expect(calls).toBe(5)

      vi.useRealTimers()
    })

    it('should suppress duplicates for at-most-once', async () => {
      const registry = createRegistry()
      const retryState = new Map<string, { attempts: number }>()
      const dedup = new Set<string>()
      const router = createRouter(registry, {
        eventDelivery: {
          store: {
            async getRetryState(eventId: string) {
              return retryState.get(eventId) ?? null
            },
            async setRetryState(eventId: string, state: { attempts: number }) {
              retryState.set(eventId, state)
            },
            async deleteRetryState(eventId: string) {
              retryState.delete(eventId)
            },
            async isDuplicate(eventId: string) {
              return dedup.has(eventId)
            },
            async markDuplicate(eventId: string, _ttlMs: number) {
              dedup.add(eventId)
            },
          },
        },
      })

      let calls = 0
      registry.event('job.dedup', async () => {
        calls += 1
      }, { delivery: 'at-most-once', deduplicationWindow: 1000 })

      const envelope = createTestEnvelope('job.dedup', {}, 'event', 'evt-3')
      await router.handle(envelope)
      await router.handle(envelope)

      expect(calls).toBe(1)
    })
  })

  describe('interceptors', () => {
    it('should execute global interceptors', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      const calls: string[] = []

      router.use(async (envelope, ctx, next) => {
        calls.push('before')
        const result = await next()
        calls.push('after')
        return result
      })

      registry.procedure('test', async () => {
        calls.push('handler')
        return 'done'
      })

      const envelope = createTestEnvelope('test')
      await router.handle(envelope)

      expect(calls).toEqual(['before', 'handler', 'after'])
    })

    it('should execute multiple interceptors in order', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      const calls: string[] = []

      router.use(async (envelope, ctx, next) => {
        calls.push('A-before')
        const result = await next()
        calls.push('A-after')
        return result
      })

      router.use(async (envelope, ctx, next) => {
        calls.push('B-before')
        const result = await next()
        calls.push('B-after')
        return result
      })

      registry.procedure('test', async () => {
        calls.push('handler')
        return 'done'
      })

      const envelope = createTestEnvelope('test')
      await router.handle(envelope)

      // Onion model: A wraps B wraps handler
      expect(calls).toEqual([
        'A-before',
        'B-before',
        'handler',
        'B-after',
        'A-after',
      ])
    })

    it('should execute handler-specific interceptors', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      const calls: string[] = []

      router.use(async (envelope, ctx, next) => {
        calls.push('global')
        return next()
      })

      const handlerInterceptor: Interceptor = async (envelope, ctx, next) => {
        calls.push('handler-specific')
        return next()
      }

      registry.procedure(
        'test',
        async () => {
          calls.push('handler')
          return 'done'
        },
        { interceptors: [handlerInterceptor] }
      )

      const envelope = createTestEnvelope('test')
      await router.handle(envelope)

      expect(calls).toEqual(['global', 'handler-specific', 'handler'])
    })

    it('should allow interceptor to modify result', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      router.use(async (envelope, ctx, next) => {
        const result = (await next()) as string
        return result.toUpperCase()
      })

      registry.procedure('greet', async () => 'hello')

      const envelope = createTestEnvelope('greet')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.payload).toBe('HELLO')
    })

    it('should allow interceptor to short-circuit', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      let handlerCalled = false

      router.use(async (envelope, ctx, next) => {
        // Don't call next() - short circuit
        return 'intercepted'
      })

      registry.procedure('test', async () => {
        handlerCalled = true
        return 'from handler'
      })

      const envelope = createTestEnvelope('test')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.payload).toBe('intercepted')
      expect(handlerCalled).toBe(false)
    })
  })

  describe('deadline and cancellation', () => {
    it('should return error for expired deadline', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('slow', async () => 'done')

      const ctx = createContext('test-id')
      const envelope: Envelope = {
        id: 'test',
        procedure: 'slow',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          ...ctx,
          deadline: Date.now() - 1000, // Already expired
        },
      }

      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('DEADLINE_EXCEEDED')
    })

    it('should return error for cancelled request', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('test', async () => 'done')

      const abortController = new AbortController()
      abortController.abort()

      const ctx = createContext('test-id', { signal: abortController.signal })
      const envelope: Envelope = {
        id: 'test',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: ctx,
      }

      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('CANCELLED')
    })
  })

  describe('invalid envelope type', () => {
    it('should return error for unknown type', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      const envelope: Envelope = {
        id: 'test',
        procedure: 'test',
        type: 'response' as any, // Invalid for incoming
        payload: {},
        metadata: {},
        context: createContext('test-id'),
      }

      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('INVALID_TYPE')
    })
  })
})
