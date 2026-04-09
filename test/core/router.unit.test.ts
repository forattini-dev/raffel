/**
 * Router — Unit Tests
 *
 * Tests for RaffelError class and createRouter() dispatch logic.
 */

import { describe, it, expect } from 'vitest'
import { createRouter, RaffelError } from '../../src/core/router.js'
import { createRegistry } from '../../src/core/registry.js'
import { createContext } from '../../src/types/context.js'
import type { Envelope, Interceptor } from '../../src/types/index.js'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// RaffelError
// ─────────────────────────────────────────────────────────────────────────────

describe('RaffelError', () => {
  it('extends Error', () => {
    const err = new RaffelError('NOT_FOUND', 'Gone')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(RaffelError)
  })

  it('sets name to RaffelError', () => {
    const err = new RaffelError('NOT_FOUND', 'Gone')
    expect(err.name).toBe('RaffelError')
  })

  it('stores code, message, and derives status from ErrorCodes', () => {
    const err = new RaffelError('NOT_FOUND', 'User not found')
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('User not found')
    expect(err.status).toBe(404)
  })

  it('stores details when provided', () => {
    const err = new RaffelError('VALIDATION_ERROR', 'Bad', { field: 'x' })
    expect(err.details).toEqual({ field: 'x' })
  })

  it('details is undefined when not provided', () => {
    const err = new RaffelError('INTERNAL_ERROR', 'Boom')
    expect(err.details).toBeUndefined()
  })

  it('allows explicit status override', () => {
    const err = new RaffelError('CUSTOM', 'Tea', undefined, 418)
    expect(err.status).toBe(418)
  })

  it('defaults to 500 for unknown codes', () => {
    const err = new RaffelError('NEVER_HEARD_OF', 'What')
    expect(err.status).toBe(500)
  })

  describe('toJSON()', () => {
    it('returns plain object with code, status, message', () => {
      const err = new RaffelError('PERMISSION_DENIED', 'Nope')
      const json = err.toJSON()
      expect(json).toEqual({
        code: 'PERMISSION_DENIED',
        status: 403,
        message: 'Nope',
      })
    })

    it('includes details when present', () => {
      const err = new RaffelError('NOT_FOUND', 'Gone', { id: 42 })
      const json = err.toJSON()
      expect(json).toEqual({
        code: 'NOT_FOUND',
        status: 404,
        message: 'Gone',
        details: { id: 42 },
      })
    })

    it('omits details key when details is undefined', () => {
      const err = new RaffelError('INTERNAL_ERROR', 'Crash')
      const json = err.toJSON()
      expect('details' in json).toBe(false)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// createRouter
// ─────────────────────────────────────────────────────────────────────────────

describe('createRouter', () => {
  it('returns a router object with handle, use, stop', () => {
    const registry = createRegistry()
    const router = createRouter(registry)

    expect(typeof router.handle).toBe('function')
    expect(typeof router.use).toBe('function')
    expect(typeof router.stop).toBe('function')
  })

  // ─── Procedure routing ──────────────────────────────────────────────

  describe('router.handle() — procedures', () => {
    it('routes to the correct procedure and returns response envelope', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('add', async (input: { a: number; b: number }) => {
        return input.a + input.b
      })

      const envelope = createTestEnvelope('add', { a: 3, b: 7 })
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('response')
      expect(result.payload).toBe(10)
      expect(result.procedure).toBe('add')
      expect(result.id).toBe('test-envelope-id:response')
    })

    it('returns error envelope for unknown procedure', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      const envelope = createTestEnvelope('nonexistent')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('NOT_FOUND')
      expect((result.payload as any).status).toBe(404)
      expect((result.payload as any).message).toContain('nonexistent')
    })

    it('wraps RaffelError from handler into error envelope', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('fail', async () => {
        throw new RaffelError('VALIDATION_ERROR', 'Bad email', { field: 'email' })
      })

      const envelope = createTestEnvelope('fail')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('VALIDATION_ERROR')
      expect((result.payload as any).status).toBe(400)
      expect((result.payload as any).message).toBe('Bad email')
      expect((result.payload as any).details).toEqual({ field: 'email' })
    })

    it('wraps unknown Error from handler into INTERNAL_ERROR envelope', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('boom', async () => {
        throw new Error('Oops')
      })

      const envelope = createTestEnvelope('boom')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('INTERNAL_ERROR')
      expect((result.payload as any).status).toBe(500)
      expect((result.payload as any).message).toBe('Oops')
    })

    it('wraps RaffelError-like objects (duck typing) into error envelope', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('ducky', async () => {
        const err: any = new Error('duck')
        err.code = 'CUSTOM_DUCK'
        err.status = 422
        err.details = { duck: true }
        throw err
      })

      const envelope = createTestEnvelope('ducky')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('CUSTOM_DUCK')
      expect((result.payload as any).status).toBe(422)
      expect((result.payload as any).details).toEqual({ duck: true })
    })

    it('handles synchronous return from procedure handler', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('sync', (input: { x: number }) => input.x * 2)

      const envelope = createTestEnvelope('sync', { x: 5 })
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('response')
      expect(result.payload).toBe(10)
    })
  })

  // ─── Interceptors ───────────────────────────────────────────────────

  describe('router.use() — interceptors', () => {
    it('adds an interceptor that wraps handler execution', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)
      const calls: string[] = []

      router.use(async (_env, _ctx, next) => {
        calls.push('before')
        const result = await next()
        calls.push('after')
        return result
      })

      registry.procedure('test', async () => {
        calls.push('handler')
        return 'ok'
      })

      const envelope = createTestEnvelope('test')
      await router.handle(envelope)

      expect(calls).toEqual(['before', 'handler', 'after'])
    })

    it('runs interceptor chain in onion order (A wraps B wraps handler)', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)
      const calls: string[] = []

      router.use(async (_env, _ctx, next) => {
        calls.push('A-in')
        const r = await next()
        calls.push('A-out')
        return r
      })

      router.use(async (_env, _ctx, next) => {
        calls.push('B-in')
        const r = await next()
        calls.push('B-out')
        return r
      })

      registry.procedure('test', async () => {
        calls.push('handler')
        return 'done'
      })

      await router.handle(createTestEnvelope('test'))

      expect(calls).toEqual(['A-in', 'B-in', 'handler', 'B-out', 'A-out'])
    })

    it('interceptor can modify the result', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      router.use(async (_env, _ctx, next) => {
        const result = (await next()) as string
        return result.toUpperCase()
      })

      registry.procedure('greet', async () => 'hello')

      const result = (await router.handle(createTestEnvelope('greet'))) as Envelope
      expect(result.payload).toBe('HELLO')
    })

    it('interceptor can short-circuit without calling next()', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)
      let handlerCalled = false

      router.use(async () => 'short-circuited')

      registry.procedure('test', async () => {
        handlerCalled = true
        return 'from handler'
      })

      const result = (await router.handle(createTestEnvelope('test'))) as Envelope

      expect(result.payload).toBe('short-circuited')
      expect(handlerCalled).toBe(false)
    })

    it('handler-specific interceptors run after global interceptors', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)
      const calls: string[] = []

      router.use(async (_env, _ctx, next) => {
        calls.push('global')
        return next()
      })

      const local: Interceptor = async (_env, _ctx, next) => {
        calls.push('local')
        return next()
      }

      registry.procedure('test', async () => {
        calls.push('handler')
        return 'done'
      }, { interceptors: [local] })

      await router.handle(createTestEnvelope('test'))

      expect(calls).toEqual(['global', 'local', 'handler'])
    })
  })

  // ─── Error handling in handler ──────────────────────────────────────

  describe('error handling', () => {
    it('produces error envelope when handler throws RaffelError', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('err', async () => {
        throw new RaffelError('RATE_LIMITED', 'Slow down', { retryAfter: 30 })
      })

      const result = (await router.handle(createTestEnvelope('err'))) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('RATE_LIMITED')
      expect((result.payload as any).status).toBe(429)
      expect((result.payload as any).details).toEqual({ retryAfter: 30 })
    })

    it('produces INTERNAL_ERROR envelope for untyped throws', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('wild', async () => {
        throw new TypeError('Cannot read property x of undefined')
      })

      const result = (await router.handle(createTestEnvelope('wild'))) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('INTERNAL_ERROR')
    })
  })

  // ─── Deadline / Cancellation ────────────────────────────────────────

  describe('deadline and cancellation', () => {
    it('returns DEADLINE_EXCEEDED for expired deadline', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('slow', async () => 'ok')

      const ctx = createContext('req-1')
      const envelope: Envelope = {
        id: 'env-1',
        procedure: 'slow',
        type: 'request',
        payload: {},
        metadata: {},
        context: { ...ctx, deadline: Date.now() - 1000 },
      }

      const result = (await router.handle(envelope)) as Envelope
      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('DEADLINE_EXCEEDED')
    })

    it('returns CANCELLED for aborted signal', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      registry.procedure('test', async () => 'ok')

      const ac = new AbortController()
      ac.abort()

      const ctx = createContext('req-2', { signal: ac.signal })
      const envelope: Envelope = {
        id: 'env-2',
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

  // ─── Invalid envelope type ─────────────────────────────────────────

  describe('invalid envelope type', () => {
    it('returns INVALID_TYPE for unroutable types', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      const envelope: Envelope = {
        id: 'env-3',
        procedure: 'test',
        type: 'response' as any,
        payload: {},
        metadata: {},
        context: createContext('req-3'),
      }

      const result = (await router.handle(envelope)) as Envelope
      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('INVALID_TYPE')
    })
  })

  // ─── Stream routing (basic) ─────────────────────────────────────────

  describe('stream routing', () => {
    it('returns NOT_FOUND for unknown stream', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      const envelope = createTestEnvelope('nope', {}, 'stream:start')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('NOT_FOUND')
    })
  })

  // ─── Event routing (basic) ──────────────────────────────────────────

  describe('event routing', () => {
    it('returns NOT_FOUND for unknown event', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      const envelope = createTestEnvelope('nope', {}, 'event')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('NOT_FOUND')
    })

    it('routes event to handler and returns received:true', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      let received: unknown = null
      registry.event('ping', async (payload) => {
        received = payload
      })

      const envelope = createTestEnvelope('ping', { ts: 123 }, 'event')
      const result = (await router.handle(envelope)) as Envelope

      expect(result.type).toBe('response')
      expect(result.payload).toEqual({ received: true })

      // Give the fire-and-forget handler time to execute
      await new Promise((r) => setTimeout(r, 10))
      expect(received).toEqual({ ts: 123 })
    })
  })

  // ─── stop() ─────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('can be called without error', () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      expect(() => router.stop()).not.toThrow()
    })
  })
})
