import { describe, it, expect } from 'vitest'
import { createRegistry } from '../../src/core/registry.js'

describe('Registry', () => {
  describe('createRegistry()', () => {
    it('should return a registry object with all expected methods', () => {
      const registry = createRegistry()

      expect(typeof registry.procedure).toBe('function')
      expect(typeof registry.stream).toBe('function')
      expect(typeof registry.event).toBe('function')
      expect(typeof registry.getProcedure).toBe('function')
      expect(typeof registry.getStream).toBe('function')
      expect(typeof registry.getEvent).toBe('function')
      expect(typeof registry.has).toBe('function')
      expect(typeof registry.list).toBe('function')
      expect(typeof registry.listProcedures).toBe('function')
      expect(typeof registry.listStreams).toBe('function')
      expect(typeof registry.listEvents).toBe('function')
    })

    it('should start empty', () => {
      const registry = createRegistry()

      expect(registry.list()).toEqual([])
      expect(registry.listProcedures()).toEqual([])
      expect(registry.listStreams()).toEqual([])
      expect(registry.listEvents()).toEqual([])
    })
  })

  describe('procedure registration', () => {
    it('should register a procedure handler', () => {
      const registry = createRegistry()

      registry.procedure('users.create', async (input: { name: string }) => {
        return { id: '1', name: input.name }
      })

      expect(registry.has('users.create')).toBe(true)
      expect(registry.getProcedure('users.create')).toBeTruthy()
    })

    it('getProcedure() retrieves the registered handler', () => {
      const registry = createRegistry()
      const handler = async () => 'hello'
      registry.procedure('greet', handler)

      const registered = registry.getProcedure('greet')
      expect(registered).toBeTruthy()
      expect(registered!.handler).toBe(handler)
      expect(registered!.meta.kind).toBe('procedure')
      expect(registered!.meta.name).toBe('greet')
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

    it('should set all metadata from options (summary, tags, httpPath, httpMethod)', () => {
      const registry = createRegistry()

      registry.procedure(
        'users.list',
        async () => [],
        {
          summary: 'List all users',
          description: 'Returns a paginated list of users',
          tags: ['users', 'admin'],
          httpPath: '/users',
          httpMethod: 'GET',
        }
      )

      const registered = registry.getProcedure('users.list')
      expect(registered).toBeTruthy()
      expect(registered!.meta.summary).toBe('List all users')
      expect(registered!.meta.description).toBe('Returns a paginated list of users')
      expect(registered!.meta.tags).toEqual(['users', 'admin'])
      expect(registered!.meta.httpPath).toBe('/users')
      expect(registered!.meta.httpMethod).toBe('GET')
    })

    it('should set graphql metadata', () => {
      const registry = createRegistry()

      registry.procedure('users.get', async () => ({}), {
        graphql: { type: 'query' },
      })

      const registered = registry.getProcedure('users.get')
      expect(registered!.meta.graphql).toEqual({ type: 'query' })
    })

    it('should set jsonrpc metadata', () => {
      const registry = createRegistry()

      registry.procedure('notify', async () => {}, {
        jsonrpc: { notification: true },
      })

      const registered = registry.getProcedure('notify')
      expect(registered!.meta.jsonrpc).toEqual({ notification: true })
    })

    it('should set grpc metadata', () => {
      const registry = createRegistry()

      registry.procedure('users.get', async () => ({}), {
        grpc: { serviceName: 'UserService', methodName: 'GetUser', type: 'unary' },
      })

      const registered = registry.getProcedure('users.get')
      expect(registered!.meta.grpc).toEqual({
        serviceName: 'UserService',
        methodName: 'GetUser',
        type: 'unary',
      })
    })

    it('should set contentType and contentTypes', () => {
      const registry = createRegistry()

      registry.procedure('upload', async () => ({}), {
        contentType: 'multipart/form-data',
        contentTypes: { default: 'application/json', supported: ['multipart/form-data'] },
      })

      const registered = registry.getProcedure('upload')
      expect(registered!.meta.contentType).toBe('multipart/form-data')
      expect(registered!.meta.contentTypes).toEqual({
        default: 'application/json',
        supported: ['multipart/form-data'],
      })
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

    it('getStream() retrieves the registered handler', () => {
      const registry = createRegistry()
      const handler = async function* () { yield 1 }
      registry.stream('nums', handler)

      const registered = registry.getStream('nums')
      expect(registered).toBeTruthy()
      expect(registered!.handler).toBe(handler)
      expect(registered!.meta.kind).toBe('stream')
      expect(registered!.meta.name).toBe('nums')
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

    it('should accept client direction', () => {
      const registry = createRegistry()

      registry.stream('upload', async function* () {}, { direction: 'client' })

      const registered = registry.getStream('upload')
      expect(registered?.meta.streamDirection).toBe('client')
    })

    it('should set description from options', () => {
      const registry = createRegistry()

      registry.stream('feed', async function* () {}, {
        description: 'Real-time data feed',
      })

      const registered = registry.getStream('feed')
      expect(registered!.meta.description).toBe('Real-time data feed')
    })

    it('should return undefined for unknown stream', () => {
      const registry = createRegistry()
      expect(registry.getStream('nope')).toBeUndefined()
    })
  })

  describe('event registration', () => {
    it('should register an event handler', () => {
      const registry = createRegistry()

      registry.event('user.created', async () => {})

      expect(registry.has('user.created')).toBe(true)
      expect(registry.getEvent('user.created')).toBeTruthy()
    })

    it('getEvent() retrieves the registered handler', () => {
      const registry = createRegistry()
      const handler = async () => {}
      registry.event('ping', handler)

      const registered = registry.getEvent('ping')
      expect(registered).toBeTruthy()
      expect(registered!.handler).toBe(handler)
      expect(registered!.meta.kind).toBe('event')
      expect(registered!.meta.name).toBe('ping')
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

    it('should set description from options', () => {
      const registry = createRegistry()

      registry.event('alert', async () => {}, { description: 'System alert' })

      const registered = registry.getEvent('alert')
      expect(registered!.meta.description).toBe('System alert')
    })

    it('should set deduplicationWindow', () => {
      const registry = createRegistry()

      registry.event('dedup', async () => {}, {
        delivery: 'at-most-once',
        deduplicationWindow: 5000,
      })

      const registered = registry.getEvent('dedup')
      expect(registered!.meta.deduplicationWindow).toBe(5000)
    })

    it('should return undefined for unknown event', () => {
      const registry = createRegistry()
      expect(registry.getEvent('nope')).toBeUndefined()
    })
  })

  describe('cross-type collision', () => {
    it('should prevent same name across types', () => {
      const registry = createRegistry()

      registry.procedure('test', async () => {})

      expect(() => registry.stream('test', async function* () {})).toThrow(/already registered/)
      expect(() => registry.event('test', async () => {})).toThrow(/already registered/)
    })

    it('should prevent stream name from colliding with event', () => {
      const registry = createRegistry()

      registry.stream('shared', async function* () {})

      expect(() => registry.event('shared', async () => {})).toThrow(/already registered/)
      expect(() => registry.procedure('shared', async () => {})).toThrow(/already registered/)
    })

    it('should prevent event name from colliding with procedure', () => {
      const registry = createRegistry()

      registry.event('shared', async () => {})

      expect(() => registry.procedure('shared', async () => {})).toThrow(/already registered/)
      expect(() => registry.stream('shared', async function* () {})).toThrow(/already registered/)
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

    it('listProcedures() returns only procedures', () => {
      const registry = createRegistry()

      registry.procedure('p1', async () => {})
      registry.stream('s1', async function* () {})
      registry.event('e1', async () => {})

      const procedures = registry.listProcedures()
      expect(procedures.length).toBe(1)
      expect(procedures.every((m) => m.kind === 'procedure')).toBe(true)
    })

    it('listStreams() returns only streams', () => {
      const registry = createRegistry()

      registry.procedure('p1', async () => {})
      registry.stream('s1', async function* () {})
      registry.stream('s2', async function* () {})
      registry.event('e1', async () => {})

      const streams = registry.listStreams()
      expect(streams.length).toBe(2)
      expect(streams.every((m) => m.kind === 'stream')).toBe(true)
    })

    it('listEvents() returns only events', () => {
      const registry = createRegistry()

      registry.procedure('p1', async () => {})
      registry.stream('s1', async function* () {})
      registry.event('e1', async () => {})
      registry.event('e2', async () => {})
      registry.event('e3', async () => {})

      const events = registry.listEvents()
      expect(events.length).toBe(3)
      expect(events.every((m) => m.kind === 'event')).toBe(true)
    })

    it('list() returns empty array for empty registry', () => {
      const registry = createRegistry()
      expect(registry.list()).toEqual([])
    })

    it('list() contains all names across types', () => {
      const registry = createRegistry()

      registry.procedure('proc', async () => {})
      registry.stream('strm', async function* () {})
      registry.event('evt', async () => {})

      const names = registry.list().map((m) => m.name)
      expect(names).toContain('proc')
      expect(names).toContain('strm')
      expect(names).toContain('evt')
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

    it('returns true for registered names', () => {
      const registry = createRegistry()
      registry.procedure('a', async () => {})
      expect(registry.has('a')).toBe(true)
    })

    it('returns false for unregistered names', () => {
      const registry = createRegistry()
      expect(registry.has('nope')).toBe(false)
    })
  })
})
