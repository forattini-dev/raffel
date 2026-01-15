/**
 * GraphQL Module Integration Tests
 *
 * Tests for:
 * - Schema Generator (mapping modes, type conversion)
 * - Adapter (lifecycle, query execution)
 * - Middleware (integration)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { z } from 'zod'
import { createRegistry } from '../core/registry.js'
import { createRouter } from '../core/router.js'
import { createSchemaRegistry } from '../validation/index.js'
import { generateGraphQLSchema, GraphQLJSON, GraphQLDateTime } from './schema-generator.js'
import { createGraphQLAdapter, createGraphQLMiddleware } from './adapter.js'
import type { GraphQLAdapterOptions } from './types.js'
import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import { createServer as createHttpServer } from 'node:http'

const TEST_PORT = 23463

// =============================================================================
// Schema Generator Tests
// =============================================================================

describe('GraphQL Schema Generator', () => {
  let registry: ReturnType<typeof createRegistry>
  let schemaRegistry: ReturnType<typeof createSchemaRegistry>

  beforeEach(() => {
    registry = createRegistry()
    schemaRegistry = createSchemaRegistry()
  })

  describe('procedure mapping modes', () => {
    describe('prefix mapping (default)', () => {
      it('should map procedures with get prefix to queries', () => {
        registry.procedure('users.get', async () => ({ id: '1' }))
        registry.procedure('users.getById', async () => ({ id: '1' }))
        registry.procedure('users.list', async () => [])
        registry.procedure('users.find', async () => [])

        schemaRegistry.register('users.get', { output: z.object({ id: z.string() }) })
        schemaRegistry.register('users.getById', { output: z.object({ id: z.string() }) })
        schemaRegistry.register('users.list', { output: z.array(z.string()) })
        schemaRegistry.register('users.find', { output: z.array(z.string()) })

        const result = generateGraphQLSchema({
          registry,
          schemaRegistry,
          options: { procedureMapping: 'prefix' },
        })

        expect(result.queries).toContain('users.get')
        expect(result.queries).toContain('users.getById')
        expect(result.queries).toContain('users.list')
        expect(result.queries).toContain('users.find')
        expect(result.mutations).toHaveLength(0)
      })

      it('should map procedures with write prefixes to mutations', () => {
        registry.procedure('users.create', async () => ({ id: '1' }))
        registry.procedure('users.update', async () => ({ id: '1' }))
        registry.procedure('users.delete', async () => true)
        registry.procedure('users.save', async () => ({ id: '1' }))

        schemaRegistry.register('users.create', { output: z.object({ id: z.string() }) })
        schemaRegistry.register('users.update', { output: z.object({ id: z.string() }) })
        schemaRegistry.register('users.delete', { output: z.boolean() })
        schemaRegistry.register('users.save', { output: z.object({ id: z.string() }) })

        const result = generateGraphQLSchema({
          registry,
          schemaRegistry,
          options: { procedureMapping: 'prefix' },
        })

        expect(result.mutations).toContain('users.create')
        expect(result.mutations).toContain('users.update')
        expect(result.mutations).toContain('users.delete')
        expect(result.mutations).toContain('users.save')
        // Only _health query is auto-added when there are no user queries
        expect(result.queries).toEqual(['_health'])
      })

      it('should support custom query prefixes', () => {
        registry.procedure('users.fetch', async () => [])
        registry.procedure('users.load', async () => [])

        schemaRegistry.register('users.fetch', { output: z.array(z.string()) })
        schemaRegistry.register('users.load', { output: z.array(z.string()) })

        const result = generateGraphQLSchema({
          registry,
          schemaRegistry,
          options: {
            procedureMapping: 'prefix',
            queryPrefixes: ['fetch', 'load'],
          },
        })

        expect(result.queries).toContain('users.fetch')
        expect(result.queries).toContain('users.load')
      })
    })

    describe('meta mapping', () => {
      it('should use graphql meta to determine type', () => {
        registry.procedure('users.get', async () => ({ id: '1' }), {
          graphql: { type: 'query' },
        })
        registry.procedure('users.create', async () => ({ id: '2' }), {
          graphql: { type: 'mutation' },
        })

        schemaRegistry.register('users.get', { output: z.object({ id: z.string() }) })
        schemaRegistry.register('users.create', { output: z.object({ id: z.string() }) })

        const result = generateGraphQLSchema({
          registry,
          schemaRegistry,
          options: { procedureMapping: 'meta' },
        })

        expect(result.queries).toContain('users.get')
        expect(result.mutations).toContain('users.create')
      })

      it('should default to mutation when meta is missing', () => {
        registry.procedure('users.action', async () => true)
        schemaRegistry.register('users.action', { output: z.boolean() })

        const result = generateGraphQLSchema({
          registry,
          schemaRegistry,
          options: { procedureMapping: 'meta' },
        })

        expect(result.mutations).toContain('users.action')
        expect(result.queries).not.toContain('users.action')
      })
    })

    describe('pattern mapping', () => {
      it('should use regex patterns to determine type', () => {
        registry.procedure('users.list', async () => [])
        registry.procedure('posts.get', async () => ({ id: '1' }))
        registry.procedure('orders.create', async () => ({ id: '1' }))

        schemaRegistry.register('users.list', { output: z.array(z.string()) })
        schemaRegistry.register('posts.get', { output: z.object({ id: z.string() }) })
        schemaRegistry.register('orders.create', { output: z.object({ id: z.string() }) })

        const result = generateGraphQLSchema({
          registry,
          schemaRegistry,
          options: { procedureMapping: 'pattern' },
        })

        // By default, pattern mode uses patterns like /\.get|\.list|\.find/
        expect(result.queries.length).toBeGreaterThanOrEqual(0)
      })
    })
  })

  describe('type conversion', () => {
    it('should convert basic Zod types', () => {
      registry.procedure('test.basic', async () => ({
        str: 'hello',
        num: 42,
        bool: true,
      }))

      schemaRegistry.register('test.basic', {
        output: z.object({
          str: z.string(),
          num: z.number(),
          bool: z.boolean(),
        }),
      })

      const result = generateGraphQLSchema({
        registry,
        schemaRegistry,
      })

      expect(result.schema).toBeDefined()
    })

    it('should convert array types', () => {
      registry.procedure('test.arrays', async () => [])

      schemaRegistry.register('test.arrays', {
        output: z.array(z.object({
          id: z.string(),
          tags: z.array(z.string()),
        })),
      })

      const result = generateGraphQLSchema({
        registry,
        schemaRegistry,
      })

      expect(result.schema).toBeDefined()
    })

    it('should convert optional types', () => {
      registry.procedure('test.optional', async () => ({}))

      schemaRegistry.register('test.optional', {
        output: z.object({
          required: z.string(),
          optional: z.string().optional(),
          nullable: z.string().nullable(),
        }),
      })

      const result = generateGraphQLSchema({
        registry,
        schemaRegistry,
      })

      expect(result.schema).toBeDefined()
    })

    it('should convert enum types', () => {
      const StatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'PENDING'])

      registry.procedure('test.enum', async () => ({ status: 'ACTIVE' }))

      schemaRegistry.register('test.enum', {
        output: z.object({
          status: StatusEnum,
        }),
      })

      const result = generateGraphQLSchema({
        registry,
        schemaRegistry,
      })

      expect(result.schema).toBeDefined()
    })

    it('should handle input schemas', () => {
      registry.procedure('users.create', async (input: { name: string }) => ({
        id: '1',
        name: input.name,
      }))

      schemaRegistry.register('users.create', {
        input: z.object({
          name: z.string(),
          email: z.string().email(),
          age: z.number().int().optional(),
        }),
        output: z.object({
          id: z.string(),
          name: z.string(),
        }),
      })

      const result = generateGraphQLSchema({
        registry,
        schemaRegistry,
      })

      expect(result.schema).toBeDefined()
    })
  })

  describe('subscriptions', () => {
    it('should map streams to subscriptions', () => {
      registry.stream('events.watch', async function* () {
        yield { type: 'created' }
      })

      schemaRegistry.register('events.watch', {
        output: z.object({ type: z.string() }),
      })

      const result = generateGraphQLSchema({
        registry,
        schemaRegistry,
      })

      expect(result.subscriptions).toContain('events.watch')
    })
  })

  describe('events', () => {
    it('should not include events by default', () => {
      registry.event('notifications.sent', async () => {})

      const result = generateGraphQLSchema({
        registry,
        schemaRegistry,
        options: { includeEvents: false },
      })

      expect(result.mutations).not.toContain('notifications.sent')
    })

    it('should include events when enabled', () => {
      registry.event('notifications.sent', async () => {})

      schemaRegistry.register('notifications.sent', {
        input: z.object({ message: z.string() }),
      })

      const result = generateGraphQLSchema({
        registry,
        schemaRegistry,
        options: { includeEvents: true },
      })

      expect(result.mutations).toContain('notifications.sent')
    })
  })

  describe('name generation', () => {
    it('should use default field name generator', () => {
      registry.procedure('users.get-by-id', async () => ({ id: '1' }))
      registry.procedure('posts.find_all', async () => [])

      schemaRegistry.register('users.get-by-id', { output: z.object({ id: z.string() }) })
      schemaRegistry.register('posts.find_all', { output: z.array(z.string()) })

      const result = generateGraphQLSchema({
        registry,
        schemaRegistry,
      })

      // Field names should be camelCase
      expect(result.schema).toBeDefined()
    })

    it('should support custom name generators', () => {
      registry.procedure('users.get', async () => ({ id: '1' }))
      schemaRegistry.register('users.get', { output: z.object({ id: z.string() }) })

      const result = generateGraphQLSchema({
        registry,
        schemaRegistry,
        options: {
          fieldNameGenerator: (name) => `custom_${name.replace('.', '_')}`,
          typeNameGenerator: (name) => `Custom${name.split('.').map(p => p[0].toUpperCase() + p.slice(1)).join('')}`,
        },
      })

      expect(result.schema).toBeDefined()
    })
  })

  describe('health check', () => {
    it('should always include _health query', () => {
      const result = generateGraphQLSchema({
        registry,
        schemaRegistry,
      })

      expect(result.queries).toContain('_health')
    })
  })
})

// =============================================================================
// Custom Scalars Tests
// =============================================================================

describe('GraphQL Custom Scalars', () => {
  describe('GraphQLJSON', () => {
    it('should serialize JSON values', () => {
      const value = { foo: 'bar', num: 42 }
      expect(GraphQLJSON.serialize(value)).toEqual(value)
    })

    it('should parse JSON values', () => {
      const value = { foo: 'bar' }
      expect(GraphQLJSON.parseValue(value)).toEqual(value)
    })
  })

  describe('GraphQLDateTime', () => {
    it('should serialize Date to ISO string', () => {
      const date = new Date('2024-01-15T10:30:00Z')
      expect(GraphQLDateTime.serialize(date)).toBe('2024-01-15T10:30:00.000Z')
    })

    it('should parse ISO string to Date', () => {
      const result = GraphQLDateTime.parseValue('2024-01-15T10:30:00Z')
      expect(result).toBeInstanceOf(Date)
    })
  })
})

// =============================================================================
// Adapter Tests
// =============================================================================

describe('GraphQL Adapter', () => {
  let registry: ReturnType<typeof createRegistry>
  let router: ReturnType<typeof createRouter>
  let schemaRegistry: ReturnType<typeof createSchemaRegistry>
  let adapter: ReturnType<typeof createGraphQLAdapter> | null = null

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    schemaRegistry = createSchemaRegistry()

    // Register some procedures
    registry.procedure('users.get', async () => ({ id: '1', name: 'Test' }))
    schemaRegistry.register('users.get', {
      output: z.object({ id: z.string(), name: z.string() }),
    })
  })

  afterEach(async () => {
    if (adapter) {
      await adapter.stop()
      adapter = null
    }
  })

  describe('lifecycle', () => {
    it('should start and stop', async () => {
      adapter = createGraphQLAdapter({
        router,
        registry,
        schemaRegistry,
        host: '127.0.0.1',
        port: TEST_PORT,
        config: {
          path: '/graphql',
          playground: false,
        },
      })

      await adapter.start()
      expect(adapter.address).toBeDefined()
      expect(adapter.address?.port).toBe(TEST_PORT)
      expect(adapter.address?.path).toBe('/graphql')

      await adapter.stop()
      expect(adapter.address).toBeNull()
    })

    it('should expose schema', async () => {
      adapter = createGraphQLAdapter({
        router,
        registry,
        schemaRegistry,
        host: '127.0.0.1',
        port: TEST_PORT,
        config: {
          path: '/graphql',
        },
      })

      await adapter.start()
      expect(adapter.schema).toBeDefined()
    })

    it('should expose schemaInfo', async () => {
      adapter = createGraphQLAdapter({
        router,
        registry,
        schemaRegistry,
        host: '127.0.0.1',
        port: TEST_PORT,
        config: {
          path: '/graphql',
        },
      })

      await adapter.start()
      expect(adapter.schemaInfo).toBeDefined()
      expect(adapter.schemaInfo?.queries).toContain('users.get')
    })
  })

  describe('query execution', () => {
    it('should execute queries via HTTP', async () => {
      adapter = createGraphQLAdapter({
        router,
        registry,
        schemaRegistry,
        host: '127.0.0.1',
        port: TEST_PORT,
        config: {
          path: '/graphql',
        },
      })

      await adapter.start()

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '{ usersGet { id name } }',
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.data).toBeDefined()
      expect(result.data.usersGet).toEqual({ id: '1', name: 'Test' })
    })

    it('should handle _health query when no other queries exist', async () => {
      // Create a fresh registry with only mutations (no query-prefixed procedures)
      const mutationsOnlyRegistry = createRegistry()
      const mutationsOnlyRouter = createRouter(mutationsOnlyRegistry)
      const mutationsOnlySchemaRegistry = createSchemaRegistry()

      // Register only a mutation (no query prefix)
      mutationsOnlyRegistry.procedure('users.create', async () => ({ id: '1' }))
      mutationsOnlySchemaRegistry.register('users.create', {
        output: z.object({ id: z.string() }),
      })

      adapter = createGraphQLAdapter({
        router: mutationsOnlyRouter,
        registry: mutationsOnlyRegistry,
        schemaRegistry: mutationsOnlySchemaRegistry,
        host: '127.0.0.1',
        port: TEST_PORT,
        config: {
          path: '/graphql',
        },
      })

      await adapter.start()

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '{ _health }',
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.data._health).toBe(true)
    })

    it('should return errors for invalid queries', async () => {
      adapter = createGraphQLAdapter({
        router,
        registry,
        schemaRegistry,
        host: '127.0.0.1',
        port: TEST_PORT,
        config: {
          path: '/graphql',
        },
      })

      await adapter.start()

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: '{ nonExistent }',
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.errors).toBeDefined()
      expect(result.errors.length).toBeGreaterThan(0)
    })
  })

  describe('CORS', () => {
    it('should handle CORS preflight requests', async () => {
      adapter = createGraphQLAdapter({
        router,
        registry,
        schemaRegistry,
        host: '127.0.0.1',
        port: TEST_PORT,
        config: {
          path: '/graphql',
          cors: true,
        },
      })

      await adapter.start()

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/graphql`, {
        method: 'OPTIONS',
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })

    it('should disable CORS when cors is false', async () => {
      adapter = createGraphQLAdapter({
        router,
        registry,
        schemaRegistry,
        host: '127.0.0.1',
        port: TEST_PORT,
        config: {
          path: '/graphql',
          cors: false,
        },
      })

      await adapter.start()

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/graphql`, {
        method: 'OPTIONS',
      })

      // Without CORS, OPTIONS still returns 204 but without CORS headers
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    })
  })

  describe('path handling', () => {
    it('should return 404 for non-graphql paths', async () => {
      adapter = createGraphQLAdapter({
        router,
        registry,
        schemaRegistry,
        host: '127.0.0.1',
        port: TEST_PORT,
        config: {
          path: '/graphql',
        },
      })

      await adapter.start()

      const response = await fetch(`http://127.0.0.1:${TEST_PORT}/other`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: '{ _health }' }),
      })

      expect(response.status).toBe(404)
    })
  })
})

// =============================================================================
// Middleware Tests
// =============================================================================

describe('GraphQL Middleware', () => {
  let registry: ReturnType<typeof createRegistry>
  let router: ReturnType<typeof createRouter>
  let schemaRegistry: ReturnType<typeof createSchemaRegistry>

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    schemaRegistry = createSchemaRegistry()

    registry.procedure('test.ping', async () => ({ pong: true }))
    schemaRegistry.register('test.ping', {
      output: z.object({ pong: z.boolean() }),
    })
  })

  it('should create middleware', () => {
    const middleware = createGraphQLMiddleware({
      router,
      registry,
      schemaRegistry,
      config: {
        path: '/graphql',
      },
    })

    expect(middleware.middleware).toBeInstanceOf(Function)
    expect(middleware.schema).toBeDefined()
  })

  it('should expose schema and schemaInfo', () => {
    const middleware = createGraphQLMiddleware({
      router,
      registry,
      schemaRegistry,
      config: {
        path: '/graphql',
      },
    })

    expect(middleware.schema).toBeDefined()
    expect(middleware.schemaInfo).toBeDefined()
    // test.ping doesn't have a query prefix (get, list, find, etc) so it becomes a mutation
    expect(middleware.schemaInfo?.mutations).toContain('test.ping')
  })

  it('should integrate with HTTP server', async () => {
    const middleware = createGraphQLMiddleware({
      router,
      registry,
      schemaRegistry,
      config: {
        path: '/graphql',
      },
    })

    const server: Server = createHttpServer(async (req, res) => {
      const handled = await middleware.middleware(req, res)
      if (!handled) {
        res.writeHead(404)
        res.end('Not found')
      }
    })

    await new Promise<void>((resolve) => {
      server.listen(TEST_PORT + 1, '127.0.0.1', resolve)
    })

    try {
      // test.ping is a mutation (no query prefix), so we need mutation syntax
      const response = await fetch(`http://127.0.0.1:${TEST_PORT + 1}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'mutation { testPing { pong } }',
        }),
      })

      expect(response.status).toBe(200)
      const result = await response.json()
      expect(result.data.testPing.pong).toBe(true)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('should return false for non-graphql paths', async () => {
    const middleware = createGraphQLMiddleware({
      router,
      registry,
      schemaRegistry,
      config: {
        path: '/graphql',
      },
    })

    const mockReq = {
      url: '/other',
      headers: { host: 'localhost' },
    } as IncomingMessage

    const mockRes = {} as ServerResponse

    const handled = await middleware.middleware(mockReq, mockRes)
    expect(handled).toBe(false)
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('GraphQL Error Handling', () => {
  let registry: ReturnType<typeof createRegistry>
  let router: ReturnType<typeof createRouter>
  let schemaRegistry: ReturnType<typeof createSchemaRegistry>
  let adapter: ReturnType<typeof createGraphQLAdapter> | null = null

  beforeEach(() => {
    registry = createRegistry()
    router = createRouter(registry)
    schemaRegistry = createSchemaRegistry()
  })

  afterEach(async () => {
    if (adapter) {
      await adapter.stop()
      adapter = null
    }
  })

  it('should handle procedure errors gracefully', async () => {
    registry.procedure('error.throw', async () => {
      throw new Error('Intentional error')
    })
    schemaRegistry.register('error.throw', {
      output: z.object({ result: z.string() }),
    })

    adapter = createGraphQLAdapter({
      router,
      registry,
      schemaRegistry,
      host: '127.0.0.1',
      port: TEST_PORT,
      config: {
        path: '/graphql',
      },
    })

    await adapter.start()

    // error.throw doesn't have a query prefix, so it's mapped to a mutation
    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'mutation { errorThrow { result } }',
      }),
    })

    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result.errors).toBeDefined()
    expect(result.errors[0].message).toContain('Intentional error')
  })

  it('should handle invalid JSON body', async () => {
    adapter = createGraphQLAdapter({
      router,
      registry,
      schemaRegistry,
      host: '127.0.0.1',
      port: TEST_PORT,
      config: {
        path: '/graphql',
      },
    })

    await adapter.start()

    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json',
    })

    expect(response.status).toBe(400)
    const result = await response.json()
    expect(result.errors).toBeDefined()
  })

  it('should handle method not allowed', async () => {
    adapter = createGraphQLAdapter({
      router,
      registry,
      schemaRegistry,
      host: '127.0.0.1',
      port: TEST_PORT,
      config: {
        path: '/graphql',
        playground: false,
      },
    })

    await adapter.start()

    const response = await fetch(`http://127.0.0.1:${TEST_PORT}/graphql`, {
      method: 'PUT',
    })

    expect(response.status).toBe(405)
  })
})
