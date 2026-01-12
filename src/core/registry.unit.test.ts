import { describe, it, expect } from 'vitest'
import { createRegistry } from './registry.js'

describe('Registry', () => {
  describe('procedure registration', () => {
    it('should register a procedure handler', () => {
      const registry = createRegistry()

      registry.procedure('users.create', async (input: { name: string }) => {
        return { id: '1', name: input.name }
      })

      expect(registry.has('users.create')).toBe(true)
      expect(registry.getProcedure('users.create')).toBeTruthy()
    })

    it('should register with options', () => {
      const registry = createRegistry()

      registry.procedure(
        'users.get',
        async (input: { id: string }) => ({ id: input.id }),
        { description: 'Get user by ID' }
      )

      const registered = registry.getProcedure('users.get')
      expect(registered?.meta.description).toBe('Get user by ID')
      expect(registered?.meta.kind).toBe('procedure')
    })

    it('should prevent duplicate registration', () => {
      const registry = createRegistry()

      registry.procedure('test', async () => {})

      expect(() => registry.procedure('test', async () => {})).toThrow(/already registered/)
    })

    it('should return undefined for unknown procedure', () => {
      const registry = createRegistry()

      expect(registry.getProcedure('unknown')).toBeUndefined()
    })
  })

  describe('stream registration', () => {
    it('should register a stream handler', () => {
      const registry = createRegistry()

      registry.stream('logs.stream', async function* () {
        yield { level: 'info', message: 'test' }
      })

      expect(registry.has('logs.stream')).toBe(true)
      expect(registry.getStream('logs.stream')).toBeTruthy()
    })

    it('should set default direction to server', () => {
      const registry = createRegistry()

      registry.stream('test', async function* () {})

      const registered = registry.getStream('test')
      expect(registered?.meta.streamDirection).toBe('server')
    })

    it('should accept custom direction', () => {
      const registry = createRegistry()

      registry.stream('chat', async function* () {}, { direction: 'bidi' })

      const registered = registry.getStream('chat')
      expect(registered?.meta.streamDirection).toBe('bidi')
    })
  })

  describe('event registration', () => {
    it('should register an event handler', () => {
      const registry = createRegistry()

      registry.event('user.created', async () => {})

      expect(registry.has('user.created')).toBe(true)
      expect(registry.getEvent('user.created')).toBeTruthy()
    })

    it('should set default delivery to best-effort', () => {
      const registry = createRegistry()

      registry.event('analytics.track', async () => {})

      const registered = registry.getEvent('analytics.track')
      expect(registered?.meta.delivery).toBe('best-effort')
    })

    it('should accept delivery guarantee config', () => {
      const registry = createRegistry()

      registry.event('order.created', async () => {}, {
        delivery: 'at-least-once',
        retryPolicy: {
          maxAttempts: 3,
          initialDelay: 1000,
          maxDelay: 30000,
          backoffMultiplier: 2,
        },
      })

      const registered = registry.getEvent('order.created')
      expect(registered?.meta.delivery).toBe('at-least-once')
      expect(registered?.meta.retryPolicy?.maxAttempts).toBe(3)
    })
  })

  describe('cross-type collision', () => {
    it('should prevent same name across types', () => {
      const registry = createRegistry()

      registry.procedure('test', async () => {})

      expect(() => registry.stream('test', async function* () {})).toThrow(/already registered/)
      expect(() => registry.event('test', async () => {})).toThrow(/already registered/)
    })
  })

  describe('introspection', () => {
    it('should list all handlers', () => {
      const registry = createRegistry()

      registry.procedure('users.create', async () => {})
      registry.procedure('users.get', async () => {})
      registry.stream('logs.stream', async function* () {})
      registry.event('user.created', async () => {})

      const all = registry.list()
      expect(all.length).toBe(4)
    })

    it('should list by type', () => {
      const registry = createRegistry()

      registry.procedure('p1', async () => {})
      registry.procedure('p2', async () => {})
      registry.stream('s1', async function* () {})
      registry.event('e1', async () => {})

      expect(registry.listProcedures().length).toBe(2)
      expect(registry.listStreams().length).toBe(1)
      expect(registry.listEvents().length).toBe(1)
    })

    it('should include metadata in listings', () => {
      const registry = createRegistry()

      registry.procedure('test', async () => {}, {
        description: 'Test procedure',
      })

      const [meta] = registry.listProcedures()
      expect(meta.name).toBe('test')
      expect(meta.kind).toBe('procedure')
      expect(meta.description).toBe('Test procedure')
    })
  })

  describe('has()', () => {
    it('should check existence across all types', () => {
      const registry = createRegistry()

      registry.procedure('proc', async () => {})
      registry.stream('stream', async function* () {})
      registry.event('event', async () => {})

      expect(registry.has('proc')).toBe(true)
      expect(registry.has('stream')).toBe(true)
      expect(registry.has('event')).toBe(true)
      expect(registry.has('unknown')).toBe(false)
    })
  })
})
