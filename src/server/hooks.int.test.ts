/**
 * Procedure Hooks Tests
 *
 * Tests for before/after/error hooks on procedures.
 */

import { describe, it, expect, vi } from 'vitest'
import { createServer } from './builder.js'
import type { BeforeHook, AfterHook, ErrorHook } from './types.js'

describe('Procedure Hooks', () => {
  describe('procedure-level hooks', () => {
    it('should run before hooks before handler', async () => {
      const calls: string[] = []

      const server = createServer({ port: 3000 })

      server
        .procedure('test')
        .before(async () => {
          calls.push('before')
        })
        .handler(async () => {
          calls.push('handler')
          return { success: true }
        })

      // Access router directly for testing
      const result = await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(result).toMatchObject({
        type: 'response',
        payload: { success: true },
      })
      expect(calls).toEqual(['before', 'handler'])
    })

    it('should run multiple before hooks in order', async () => {
      const calls: string[] = []

      const server = createServer({ port: 3000 })

      server
        .procedure('test')
        .before(async () => { calls.push('before1') })
        .before(async () => { calls.push('before2') })
        .before(async () => { calls.push('before3') })
        .handler(async () => {
          calls.push('handler')
          return {}
        })

      await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(calls).toEqual(['before1', 'before2', 'before3', 'handler'])
    })

    it('should run after hooks after handler', async () => {
      const calls: string[] = []

      const server = createServer({ port: 3000 })

      server
        .procedure('test')
        .after(async (input, ctx, result) => {
          calls.push('after')
          return result
        })
        .handler(async () => {
          calls.push('handler')
          return { value: 42 }
        })

      const result = await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(calls).toEqual(['handler', 'after'])
      expect(result).toMatchObject({
        type: 'response',
        payload: { value: 42 },
      })
    })

    it('should allow after hooks to transform result', async () => {
      const server = createServer({ port: 3000 })

      server
        .procedure('test')
        .after(async (input, ctx, result) => {
          const r = result as { value: number }
          return { ...r, doubled: r.value * 2 }
        })
        .handler(async () => ({ value: 21 }))

      const result = await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(result).toMatchObject({
        type: 'response',
        payload: { value: 21, doubled: 42 },
      })
    })

    it('should chain after hooks with transformed results', async () => {
      const server = createServer({ port: 3000 })

      server
        .procedure('test')
        .after(async (input, ctx, result) => {
          const r = result as { count: number }
          return { count: r.count + 1 }
        })
        .after(async (input, ctx, result) => {
          const r = result as { count: number }
          return { count: r.count * 2 }
        })
        .handler(async () => ({ count: 5 }))

      const result = await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      // 5 + 1 = 6, then 6 * 2 = 12
      expect(result).toMatchObject({
        type: 'response',
        payload: { count: 12 },
      })
    })

    it('should prevent handler execution if before hook throws', async () => {
      const calls: string[] = []

      const server = createServer({ port: 3000 })

      server
        .procedure('test')
        .before(async () => {
          calls.push('before')
          throw new Error('Unauthorized')
        })
        .handler(async () => {
          calls.push('handler') // Should not be called
          return {}
        })

      const result = await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(calls).toEqual(['before'])
      expect(result).toMatchObject({
        type: 'error',
        payload: {
          code: 'INTERNAL_ERROR',
          message: 'Unauthorized',
        },
      })
    })

    it('should run error hooks when handler throws', async () => {
      const calls: string[] = []

      const server = createServer({ port: 3000 })

      server
        .procedure('test')
        .error(async (input, ctx, error) => {
          calls.push(`error:${error.message}`)
          return { recovered: true }
        })
        .handler(async () => {
          calls.push('handler')
          throw new Error('Something went wrong')
        })

      const result = await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(calls).toEqual(['handler', 'error:Something went wrong'])
      expect(result).toMatchObject({
        type: 'response',
        payload: { recovered: true },
      })
    })

    it('should allow error hooks to re-throw', async () => {
      const server = createServer({ port: 3000 })

      server
        .procedure('test')
        .error(async (input, ctx, error) => {
          // Transform the error
          throw new Error(`Transformed: ${error.message}`)
        })
        .handler(async () => {
          throw new Error('Original error')
        })

      const result = await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(result).toMatchObject({
        type: 'error',
        payload: {
          message: 'Transformed: Original error',
        },
      })
    })
  })

  describe('global hooks', () => {
    it('should apply global hooks to matching procedures', async () => {
      const calls: string[] = []

      const server = createServer({ port: 3000 })
        .hooks({
          before: {
            '*': async () => { calls.push('global:before') },
          },
          after: {
            '*': async (input, ctx, result) => {
              calls.push('global:after')
              return result
            },
          },
        })

      server.procedure('test').handler(async () => {
        calls.push('handler')
        return {}
      })

      await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(calls).toEqual(['global:before', 'handler', 'global:after'])
    })

    it('should match pattern with wildcard prefix', async () => {
      const calls: string[] = []

      const server = createServer({ port: 3000 })
        .hooks({
          before: {
            'users.*': async () => { calls.push('users:before') },
          },
        })

      server.procedure('users.get').handler(async () => {
        calls.push('users.get')
        return {}
      })

      server.procedure('orders.get').handler(async () => {
        calls.push('orders.get')
        return {}
      })

      // Call users.get - should trigger hook
      await server.router.handle({
        id: 'test-1',
        procedure: 'users.get',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(calls).toEqual(['users:before', 'users.get'])

      // Reset
      calls.length = 0

      // Call orders.get - should NOT trigger hook
      await server.router.handle({
        id: 'test-2',
        procedure: 'orders.get',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-2',
          tracing: { traceId: 'trace-2', spanId: 'span-2' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(calls).toEqual(['orders.get'])
    })

    it('should match exact procedure name', async () => {
      const calls: string[] = []

      const server = createServer({ port: 3000 })
        .hooks({
          before: {
            'users.get': async () => { calls.push('exact:before') },
          },
        })

      server.procedure('users.get').handler(async () => {
        calls.push('users.get')
        return {}
      })

      server.procedure('users.list').handler(async () => {
        calls.push('users.list')
        return {}
      })

      // users.get should match
      await server.router.handle({
        id: 'test-1',
        procedure: 'users.get',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(calls).toEqual(['exact:before', 'users.get'])

      calls.length = 0

      // users.list should NOT match
      await server.router.handle({
        id: 'test-2',
        procedure: 'users.list',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-2',
          tracing: { traceId: 'trace-2', spanId: 'span-2' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(calls).toEqual(['users.list'])
    })

    it('should run global hooks before local hooks', async () => {
      const calls: string[] = []

      const server = createServer({ port: 3000 })
        .hooks({
          before: {
            '*': async () => { calls.push('global:before') },
          },
        })

      server
        .procedure('test')
        .before(async () => { calls.push('local:before') })
        .handler(async () => {
          calls.push('handler')
          return {}
        })

      await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(calls).toEqual(['global:before', 'local:before', 'handler'])
    })

    it('should support array of hooks per pattern', async () => {
      const calls: string[] = []

      const server = createServer({ port: 3000 })
        .hooks({
          before: {
            '*': [
              async () => { calls.push('global:before1') },
              async () => { calls.push('global:before2') },
            ],
          },
        })

      server.procedure('test').handler(async () => {
        calls.push('handler')
        return {}
      })

      await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(calls).toEqual(['global:before1', 'global:before2', 'handler'])
    })

    it('should merge multiple hooks() calls', async () => {
      const calls: string[] = []

      const server = createServer({ port: 3000 })
        .hooks({
          before: {
            '*': async () => { calls.push('first') },
          },
        })
        .hooks({
          before: {
            '*': async () => { calls.push('second') },
          },
        })

      server.procedure('test').handler(async () => {
        calls.push('handler')
        return {}
      })

      await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      // Second call should overwrite first for same pattern
      expect(calls).toEqual(['second', 'handler'])
    })
  })

  describe('hooks with groups', () => {
    it('should apply global hooks to grouped procedures', async () => {
      const calls: string[] = []

      const server = createServer({ port: 3000 })
        .hooks({
          before: {
            'admin.*': async () => { calls.push('admin:before') },
          },
        })

      server.group('admin').procedure('users').handler(async () => {
        calls.push('admin.users')
        return {}
      })

      await server.router.handle({
        id: 'test-1',
        procedure: 'admin.users',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(calls).toEqual(['admin:before', 'admin.users'])
    })
  })

  describe('hooks with context', () => {
    it('should have access to context in hooks', async () => {
      let capturedRequestId: string | undefined

      const server = createServer({ port: 3000 })

      server
        .procedure('test')
        .before(async (input, ctx) => {
          capturedRequestId = ctx.requestId
        })
        .handler(async () => ({}))

      await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: {
          requestId: 'my-request-id',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(capturedRequestId).toBe('my-request-id')
    })

    it('should have access to input in hooks', async () => {
      let capturedInput: any

      const server = createServer({ port: 3000 })

      server
        .procedure('test')
        .before(async (input) => {
          capturedInput = input
        })
        .handler(async () => ({}))

      await server.router.handle({
        id: 'test-1',
        procedure: 'test',
        type: 'request',
        payload: { userId: 'user-123', name: 'John' },
        metadata: {},
        context: {
          requestId: 'req-1',
          tracing: { traceId: 'trace-1', spanId: 'span-1' },
          signal: new AbortController().signal,
          extensions: new Map(),
        },
      })

      expect(capturedInput).toEqual({ userId: 'user-123', name: 'John' })
    })
  })
})
