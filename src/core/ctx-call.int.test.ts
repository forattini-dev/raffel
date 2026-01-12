/**
 * ctx.call() Tests
 *
 * Tests for internal procedure calls via context.
 */

import { describe, it, expect, vi } from 'vitest'
import { createRouter, RaffelError } from './router.js'
import { createRegistry } from './registry.js'
import type { Envelope, Context, ProcedureHandler, Interceptor } from '../types/index.js'
import { createContext } from '../types/index.js'

function createEnvelope(
  procedure: string,
  payload: unknown = {},
  ctx?: Context
): Envelope {
  return {
    id: `test-${Date.now()}`,
    procedure,
    type: 'request',
    payload,
    metadata: {},
    context: ctx ?? createContext('test-request'),
  }
}

describe('ctx.call()', () => {
  describe('basic functionality', () => {
    it('should call another procedure and return its result', async () => {
      const registry = createRegistry()

      registry.procedure('users.get', async (input: { id: string }, ctx) => {
        return { id: input.id, name: 'John' }
      })

      registry.procedure('orders.getWithUser', async (input: { orderId: string }, ctx) => {
        // Call users.get internally
        const user = await ctx.call!('users.get', { id: 'user-123' })
        return { orderId: input.orderId, user }
      })

      const router = createRouter(registry)
      const result = await router.handle(
        createEnvelope('orders.getWithUser', { orderId: 'order-456' })
      )

      expect(result).toMatchObject({
        type: 'response',
        payload: {
          orderId: 'order-456',
          user: { id: 'user-123', name: 'John' },
        },
      })
    })

    it('should propagate errors from called procedure', async () => {
      const registry = createRegistry()

      registry.procedure('users.get', async (input: { id: string }) => {
        throw new RaffelError('NOT_FOUND', `User ${input.id} not found`)
      })

      registry.procedure('orders.getWithUser', async (input: { orderId: string }, ctx) => {
        try {
          const user = await ctx.call!('users.get', { id: 'invalid' })
          return { orderId: input.orderId, user }
        } catch (err) {
          if (err instanceof RaffelError && err.code === 'NOT_FOUND') {
            return { orderId: input.orderId, user: null }
          }
          throw err
        }
      })

      const router = createRouter(registry)
      const result = await router.handle(
        createEnvelope('orders.getWithUser', { orderId: 'order-456' })
      )

      expect(result).toMatchObject({
        type: 'response',
        payload: {
          orderId: 'order-456',
          user: null,
        },
      })
    })

    it('should throw error for non-existent procedure', async () => {
      const registry = createRegistry()

      registry.procedure('caller', async (input, ctx) => {
        return await ctx.call!('nonexistent', {})
      })

      const router = createRouter(registry)
      const result = await router.handle(createEnvelope('caller', {}))

      expect(result).toMatchObject({
        type: 'error',
        payload: {
          code: 'NOT_FOUND',
          message: expect.stringContaining('nonexistent'),
        },
      })
    })
  })

  describe('context propagation', () => {
    it('should propagate requestId to nested calls', async () => {
      const registry = createRegistry()
      let capturedRequestId: string | undefined

      registry.procedure('inner', async (input, ctx) => {
        capturedRequestId = ctx.requestId
        return { captured: ctx.requestId }
      })

      registry.procedure('outer', async (input, ctx) => {
        return await ctx.call!('inner', {})
      })

      const context = createContext('original-request-id')
      const router = createRouter(registry)
      await router.handle(createEnvelope('outer', {}, context))

      expect(capturedRequestId).toBe('original-request-id')
    })

    it('should propagate auth context to nested calls', async () => {
      const registry = createRegistry()
      let capturedAuth: any

      registry.procedure('inner', async (input, ctx) => {
        capturedAuth = ctx.auth
        return { principal: ctx.auth?.principal }
      })

      registry.procedure('outer', async (input, ctx) => {
        return await ctx.call!('inner', {})
      })

      const context = createContext('req-1')
      ;(context as any).auth = {
        authenticated: true,
        principal: 'user-123',
        claims: { role: 'admin' },
      }

      const router = createRouter(registry)
      const result = await router.handle(createEnvelope('outer', {}, context))

      expect(capturedAuth).toEqual({
        authenticated: true,
        principal: 'user-123',
        claims: { role: 'admin' },
      })
    })

    it('should propagate tracing context', async () => {
      const registry = createRegistry()
      let capturedTracing: any

      registry.procedure('inner', async (input, ctx) => {
        capturedTracing = ctx.tracing
        return {}
      })

      registry.procedure('outer', async (input, ctx) => {
        return await ctx.call!('inner', {})
      })

      const context = createContext('req-1', {
        tracing: {
          traceId: 'trace-abc',
          spanId: 'span-123',
          parentSpanId: 'span-000',
        },
      })

      const router = createRouter(registry)
      await router.handle(createEnvelope('outer', {}, context))

      expect(capturedTracing.traceId).toBe('trace-abc')
    })
  })

  describe('calling level tracking', () => {
    it('should increment callingLevel for nested calls', async () => {
      const registry = createRegistry()
      const capturedLevels: number[] = []

      registry.procedure('level2', async (input, ctx) => {
        capturedLevels.push(ctx.callingLevel ?? 0)
        return {}
      })

      registry.procedure('level1', async (input, ctx) => {
        capturedLevels.push(ctx.callingLevel ?? 0)
        return await ctx.call!('level2', {})
      })

      registry.procedure('level0', async (input, ctx) => {
        capturedLevels.push(ctx.callingLevel ?? 0)
        return await ctx.call!('level1', {})
      })

      const router = createRouter(registry)
      await router.handle(createEnvelope('level0', {}))

      // level0 starts at 1 (enhanced by router), then increments each level
      expect(capturedLevels).toEqual([1, 2, 3])
    })

    it('should prevent excessive recursion', async () => {
      const registry = createRegistry()
      let maxDepthReached = 0

      // Create a procedure that keeps calling itself
      registry.procedure('recursive', async (input: { depth: number }, ctx) => {
        maxDepthReached = Math.max(maxDepthReached, ctx.callingLevel ?? 0)
        // This would recurse infinitely without the protection
        return await ctx.call!('recursive', { depth: input.depth + 1 })
      })

      const router = createRouter(registry)
      const result = await router.handle(createEnvelope('recursive', { depth: 0 }))

      // Should hit the depth limit (100) and return error
      expect(result).toMatchObject({
        type: 'error',
        payload: {
          code: 'CALLING_DEPTH_EXCEEDED',
        },
      })

      // Should have reached level 100 before failing
      expect(maxDepthReached).toBe(100)
    })
  })

  describe('interceptors', () => {
    it('should run interceptors on internal calls', async () => {
      const registry = createRegistry()
      const interceptorCalls: string[] = []

      const trackingInterceptor: Interceptor = async (envelope, ctx, next) => {
        interceptorCalls.push(envelope.procedure)
        return next()
      }

      registry.procedure(
        'inner',
        async () => ({ message: 'inner' }),
        { interceptors: [trackingInterceptor] }
      )

      registry.procedure(
        'outer',
        async (input, ctx) => await ctx.call!('inner', {}),
        { interceptors: [trackingInterceptor] }
      )

      const router = createRouter(registry)
      await router.handle(createEnvelope('outer', {}))

      expect(interceptorCalls).toEqual(['outer', 'inner'])
    })

    it('should run global interceptors on internal calls', async () => {
      const registry = createRegistry()
      const interceptorCalls: string[] = []

      const globalInterceptor: Interceptor = async (envelope, ctx, next) => {
        interceptorCalls.push(`global:${envelope.procedure}`)
        return next()
      }

      registry.procedure('inner', async () => ({ message: 'inner' }))
      registry.procedure('outer', async (input, ctx) => await ctx.call!('inner', {}))

      const router = createRouter(registry, { interceptors: [globalInterceptor] })
      await router.handle(createEnvelope('outer', {}))

      expect(interceptorCalls).toEqual(['global:outer', 'global:inner'])
    })
  })

  describe('concurrent calls', () => {
    it('should handle multiple concurrent internal calls', async () => {
      const registry = createRegistry()

      registry.procedure('slow', async (input: { delay: number; value: string }) => {
        await new Promise((r) => setTimeout(r, input.delay))
        return { value: input.value }
      })

      registry.procedure('aggregate', async (input, ctx) => {
        const [a, b, c] = await Promise.all([
          ctx.call!('slow', { delay: 30, value: 'a' }),
          ctx.call!('slow', { delay: 20, value: 'b' }),
          ctx.call!('slow', { delay: 10, value: 'c' }),
        ])
        return { results: [a, b, c] }
      })

      const router = createRouter(registry)
      const result = await router.handle(createEnvelope('aggregate', {}))

      expect(result).toMatchObject({
        type: 'response',
        payload: {
          results: [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
        },
      })
    })
  })

  describe('type safety', () => {
    it('should preserve types through ctx.call', async () => {
      const registry = createRegistry()

      interface User {
        id: string
        name: string
        email: string
      }

      registry.procedure('users.get', async (input: { id: string }, ctx): Promise<User> => {
        return { id: input.id, name: 'Test User', email: 'test@example.com' }
      })

      registry.procedure('users.getEmail', async (input: { userId: string }, ctx) => {
        const user = await ctx.call!<{ id: string }, User>('users.get', { id: input.userId })
        // TypeScript should recognize user.email
        return { email: user.email }
      })

      const router = createRouter(registry)
      const result = await router.handle(
        createEnvelope('users.getEmail', { userId: 'u-1' })
      )

      expect(result).toMatchObject({
        type: 'response',
        payload: { email: 'test@example.com' },
      })
    })
  })
})
