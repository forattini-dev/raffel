import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import {
  createRuntimeTaskRegistry,
  runActiveShutdownPlan,
  runStopTasks,
  cleanupResolvedProviders,
} from '../../src/server/builder/lifecycle-utils.js'

function createLoggerStub(): Logger {
  return {
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as Logger
}

describe('server lifecycle utils', () => {
  describe('createRuntimeTaskRegistry', () => {
    it('captures phase buckets and rolls startup tasks back in reverse registration order', async () => {
      const logger = createLoggerStub()
      const registry = createRuntimeTaskRegistry()
      const order: string[] = []

      registry.register('entrypoint', {
        name: 'http',
        stop: async () => {
          order.push('http')
        },
      })
      registry.register('post-port-binding', {
        name: 'websocket',
        stop: async () => {
          order.push('websocket')
        },
      })

      const snapshot = registry.snapshot([
        'post-port-binding',
        'entrypoint',
        'providers',
      ])

      expect(snapshot.phases).toEqual([
        'post-port-binding',
        'entrypoint',
        'providers',
      ])
      expect(snapshot.tasksByPhase['entrypoint']?.map((task) => task.name)).toEqual(['http'])
      expect(snapshot.tasksByPhase['post-port-binding']?.map((task) => task.name)).toEqual(['websocket'])

      await registry.rollback(logger, 'startup')

      expect(order).toEqual(['websocket', 'http'])
    })

    it('returns empty snapshot when no tasks are registered', () => {
      const registry = createRuntimeTaskRegistry()
      const snapshot = registry.snapshot(['entrypoint', 'providers'])

      expect(snapshot.phases).toEqual(['entrypoint', 'providers'])
      expect(snapshot.tasksByPhase).toEqual({})
    })

    it('groups multiple tasks under the same phase', () => {
      const registry = createRuntimeTaskRegistry()
      registry.register('entrypoint', { name: 'http', stop: vi.fn() })
      registry.register('entrypoint', { name: 'grpc', stop: vi.fn() })
      registry.register('entrypoint', { name: 'tcp', stop: vi.fn() })

      const snapshot = registry.snapshot(['entrypoint'])
      const names = snapshot.tasksByPhase['entrypoint']?.map((t) => t.name)
      expect(names).toEqual(['http', 'grpc', 'tcp'])
    })

    it('snapshot returns a defensive copy (mutations do not affect registry)', () => {
      const registry = createRuntimeTaskRegistry()
      registry.register('entrypoint', { name: 'http', stop: vi.fn() })

      const snap1 = registry.snapshot(['entrypoint'])
      snap1.phases.push('providers')
      snap1.tasksByPhase['entrypoint']!.push({ name: 'extra', stop: vi.fn() })

      const snap2 = registry.snapshot(['entrypoint'])
      expect(snap2.phases).toEqual(['entrypoint'])
      expect(snap2.tasksByPhase['entrypoint']?.length).toBe(1)
    })

    it('rollback continues even if a stop task throws', async () => {
      const logger = createLoggerStub()
      const registry = createRuntimeTaskRegistry()
      const order: string[] = []

      registry.register('entrypoint', {
        name: 'first',
        stop: async () => {
          order.push('first')
        },
      })
      registry.register('entrypoint', {
        name: 'failing',
        stop: async () => {
          throw new Error('boom')
        },
      })
      registry.register('entrypoint', {
        name: 'third',
        stop: async () => {
          order.push('third')
        },
      })

      await registry.rollback(logger, 'startup')

      // Reverse order: third (index 2), failing (index 1), first (index 0)
      expect(order).toEqual(['third', 'first'])
      expect(logger.error).toHaveBeenCalledOnce()
    })

    it('rollback uses "startup" as default phase label', async () => {
      const logger = createLoggerStub()
      const registry = createRuntimeTaskRegistry()
      registry.register('entrypoint', {
        name: 'task',
        stop: async () => {
          throw new Error('fail')
        },
      })

      await registry.rollback(logger)

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ component: 'task', phase: 'startup' }),
        expect.stringContaining('task')
      )
    })
  })

  describe('runActiveShutdownPlan', () => {
    it('runs shutdown phases in plan order and preserves reverse order within each phase', async () => {
      const logger = createLoggerStub()
      const order: string[] = []

      await runActiveShutdownPlan(
        {
          phases: ['post-port-binding', 'providers'],
          tasksByPhase: {
            'post-port-binding': [
              {
                name: 'websocket',
                stop: async () => {
                  order.push('websocket:first')
                },
              },
              {
                name: 'graphql',
                stop: async () => {
                  order.push('graphql:second')
                },
              },
            ],
          },
        },
        logger,
        {
          providers: async () => {
            order.push('providers')
          },
        }
      )

      expect(order).toEqual([
        'graphql:second',
        'websocket:first',
        'providers',
      ])
    })

    it('handles empty plan with no phases', async () => {
      const logger = createLoggerStub()
      await runActiveShutdownPlan({ phases: [], tasksByPhase: {} }, logger)
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('handles phases with no tasks gracefully', async () => {
      const logger = createLoggerStub()
      const order: string[] = []

      await runActiveShutdownPlan(
        {
          phases: ['entrypoint', 'providers'],
          tasksByPhase: {},
        },
        logger
      )

      // Should not throw, no tasks to run
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('continues to next phase even if phaseHandler throws', async () => {
      const logger = createLoggerStub()
      const order: string[] = []

      await runActiveShutdownPlan(
        {
          phases: ['entrypoint', 'providers'],
          tasksByPhase: {
            providers: [
              {
                name: 'db',
                stop: async () => {
                  order.push('db')
                },
              },
            ],
          },
        },
        logger,
        {
          entrypoint: async () => {
            throw new Error('entrypoint handler failed')
          },
        }
      )

      expect(order).toEqual(['db'])
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'entrypoint' }),
        expect.stringContaining('entrypoint')
      )
    })

    it('phaseHandler takes precedence over tasks in tasksByPhase', async () => {
      const logger = createLoggerStub()
      const order: string[] = []

      await runActiveShutdownPlan(
        {
          phases: ['entrypoint'],
          tasksByPhase: {
            entrypoint: [
              {
                name: 'should-not-run',
                stop: async () => {
                  order.push('task')
                },
              },
            ],
          },
        },
        logger,
        {
          entrypoint: async () => {
            order.push('handler')
          },
        }
      )

      expect(order).toEqual(['handler'])
    })
  })

  describe('runStopTasks', () => {
    it('runs tasks in reverse order', async () => {
      const logger = createLoggerStub()
      const order: string[] = []

      await runStopTasks(
        [
          { name: 'a', stop: async () => { order.push('a') } },
          { name: 'b', stop: async () => { order.push('b') } },
          { name: 'c', stop: async () => { order.push('c') } },
        ],
        'test-phase',
        logger
      )

      expect(order).toEqual(['c', 'b', 'a'])
    })

    it('handles empty task list', async () => {
      const logger = createLoggerStub()
      await runStopTasks([], 'empty', logger)
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('continues after a task throws and logs the error', async () => {
      const logger = createLoggerStub()
      const order: string[] = []

      await runStopTasks(
        [
          { name: 'first', stop: async () => { order.push('first') } },
          {
            name: 'failing',
            stop: async () => {
              throw new Error('stop failed')
            },
          },
          { name: 'last', stop: async () => { order.push('last') } },
        ],
        'my-phase',
        logger
      )

      // Reverse order: last, failing (throws), first
      expect(order).toEqual(['last', 'first'])
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          component: 'failing',
          phase: 'my-phase',
        }),
        expect.stringContaining('failing')
      )
    })

    it('includes the phase name in the error log message', async () => {
      const logger = createLoggerStub()
      await runStopTasks(
        [{ name: 'broken', stop: async () => { throw new Error('oops') } }],
        'shutdown:entrypoint',
        logger
      )

      expect(logger.error).toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('shutdown:entrypoint')
      )
    })
  })

  describe('cleanupResolvedProviders', () => {
    it('calls onShutdown for providers that have it', async () => {
      const logger = createLoggerStub()
      const dbInstance = { close: vi.fn() }
      const onShutdown = vi.fn()
      const resolvedProviders: Record<string, unknown> = {
        db: dbInstance,
      }
      const providerDefinitions = new Map([
        ['db', { factory: vi.fn(), onShutdown }],
      ])

      await cleanupResolvedProviders(resolvedProviders, providerDefinitions, 'shutdown', logger)

      expect(onShutdown).toHaveBeenCalledWith(dbInstance)
      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'db', phase: 'shutdown' }),
        expect.any(String)
      )
    })

    it('skips providers without onShutdown', async () => {
      const logger = createLoggerStub()
      const resolvedProviders: Record<string, unknown> = {
        cache: { data: [] },
      }
      const providerDefinitions = new Map([
        ['cache', { factory: vi.fn() }],
      ])

      await cleanupResolvedProviders(resolvedProviders, providerDefinitions, 'shutdown', logger)

      expect(logger.error).not.toHaveBeenCalled()
    })

    it('skips providers that are not in resolvedProviders', async () => {
      const logger = createLoggerStub()
      const onShutdown = vi.fn()
      const resolvedProviders: Record<string, unknown> = {}
      const providerDefinitions = new Map([
        ['db', { factory: vi.fn(), onShutdown }],
      ])

      await cleanupResolvedProviders(resolvedProviders, providerDefinitions, 'shutdown', logger)

      expect(onShutdown).not.toHaveBeenCalled()
    })

    it('clears all keys from resolvedProviders after cleanup', async () => {
      const logger = createLoggerStub()
      const resolvedProviders: Record<string, unknown> = {
        db: { connection: true },
        cache: { items: [] },
        queue: { pending: 0 },
      }
      const providerDefinitions = new Map<string, { factory: any; onShutdown?: any }>([
        ['db', { factory: vi.fn(), onShutdown: vi.fn() }],
      ])

      await cleanupResolvedProviders(resolvedProviders, providerDefinitions, 'shutdown', logger)

      expect(Object.keys(resolvedProviders)).toEqual([])
    })

    it('continues cleanup if onShutdown throws and logs error', async () => {
      const logger = createLoggerStub()
      const shutdown1 = vi.fn().mockRejectedValue(new Error('db close failed'))
      const shutdown2 = vi.fn()
      const resolvedProviders: Record<string, unknown> = {
        db: { id: 1 },
        cache: { id: 2 },
      }
      const providerDefinitions = new Map([
        ['db', { factory: vi.fn(), onShutdown: shutdown1 }],
        ['cache', { factory: vi.fn(), onShutdown: shutdown2 }],
      ])

      await cleanupResolvedProviders(resolvedProviders, providerDefinitions, 'shutdown', logger)

      expect(shutdown1).toHaveBeenCalled()
      expect(shutdown2).toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'db', phase: 'shutdown' }),
        expect.stringContaining('provider')
      )
      // All keys should still be cleared
      expect(Object.keys(resolvedProviders)).toEqual([])
    })

    it('handles empty provider definitions gracefully', async () => {
      const logger = createLoggerStub()
      const resolvedProviders: Record<string, unknown> = { db: {} }
      const providerDefinitions = new Map()

      await cleanupResolvedProviders(resolvedProviders, providerDefinitions, 'shutdown', logger)

      expect(Object.keys(resolvedProviders)).toEqual([])
    })
  })
})
