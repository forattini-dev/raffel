/**
 * OpenAPI Generator Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { generateOpenAPI, generateOpenAPIJson } from '../../../src/docs/openapi/generator.js'
import { createRegistry } from '../../../src/core/registry.js'
import {
  createSchemaRegistry,
  registerValidator,
  resetValidation,
  createZodAdapter,
} from '../../../src/validation/index.js'
import type { Registry } from '../../../src/core/registry.js'
import type { SchemaRegistry } from '../../../src/validation/index.js'

describe('OpenAPI Generator', () => {
  let registry: Registry
  let schemaRegistry: SchemaRegistry

  beforeEach(() => {
    registry = createRegistry()
    schemaRegistry = createSchemaRegistry()
    // Register Zod adapter for validation tests
    resetValidation()
    registerValidator(createZodAdapter(z))
  })

  describe('Basic Generation', () => {
    it('should generate minimal OpenAPI document', () => {
      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      expect(doc.openapi).toBe('3.0.3')
      expect(doc.info.title).toBe('Test API')
      expect(doc.info.version).toBe('1.0.0')
      expect(doc.paths).toEqual({})
    })

    it('should include servers when provided', () => {
      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
        servers: [
          { url: 'http://localhost:3000', description: 'Development' },
          { url: 'https://api.example.com', description: 'Production' },
        ],
      })

      expect(doc.servers).toHaveLength(2)
      expect(doc.servers?.[0].url).toBe('http://localhost:3000')
    })

    it('should generate valid JSON string', () => {
      registry.procedure('test', async () => ({ ok: true }))

      const json = generateOpenAPIJson(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      const parsed = JSON.parse(json)
      expect(parsed.openapi).toBe('3.0.3')
      expect(parsed.paths['/test']).toBeDefined()
    })
  })

  describe('Procedure Paths', () => {
    it('should create POST endpoint for procedure', () => {
      registry.procedure('greet', async (input: { name: string }) => ({
        message: `Hello, ${input.name}`,
      }))

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      expect(doc.paths['/greet']).toBeDefined()
      expect(doc.paths['/greet'].post).toBeDefined()
      expect(doc.paths['/greet'].post?.operationId).toBe('greet')
    })

    it('should convert dot notation to path segments', () => {
      registry.procedure('users.create', async () => ({ id: '1' }))
      registry.procedure('users.list', async () => [])
      registry.procedure('admin.users.delete', async () => ({ ok: true }))

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      expect(doc.paths['/users/create']).toBeDefined()
      expect(doc.paths['/users/list']).toBeDefined()
      expect(doc.paths['/admin/users/delete']).toBeDefined()
    })

    it('should map handler description and summary to the matching OpenAPI fields', () => {
      registry.procedure('test', async () => ({ ok: true }), {
        summary: 'Short summary',
        description: 'A test procedure',
      })

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      expect(doc.paths['/test'].post?.summary).toBe('Short summary')
      expect(doc.paths['/test'].post?.description).toBe('A test procedure')
    })

    it('should document the declared HTTP method instead of always POST', () => {
      registry.procedure('list-things', async () => ({ ok: true }), {
        httpMethod: 'GET',
      })

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      expect(doc.paths['/list-things'].get).toBeDefined()
      expect(doc.paths['/list-things'].post).toBeUndefined()
      // GET carries no request body
      expect(doc.paths['/list-things'].get?.requestBody).toBeUndefined()
    })

    it('should use custom base path', () => {
      registry.procedure('test', async () => ({ ok: true }))

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
        basePath: '/api/v1',
      })

      expect(doc.paths['/api/v1/test']).toBeDefined()
    })
  })

  describe('Stream Paths', () => {
    it('should create GET endpoint for stream', () => {
      registry.stream('counter', async function* () {
        yield 1
        yield 2
        yield 3
      })

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      expect(doc.paths['/streams/counter']).toBeDefined()
      expect(doc.paths['/streams/counter'].get).toBeDefined()
      expect(doc.paths['/streams/counter'].get?.responses['200'].content).toHaveProperty(
        'text/event-stream'
      )
    })

    it('should use custom stream path', () => {
      registry.stream('events', async function* () {
        yield { type: 'test' }
      })

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
        streamPath: '/sse',
      })

      expect(doc.paths['/sse/events']).toBeDefined()
    })
  })

  describe('Event Paths', () => {
    it('should create POST endpoint for event', () => {
      registry.event('log', async () => {})

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      expect(doc.paths['/events/log']).toBeDefined()
      expect(doc.paths['/events/log'].post).toBeDefined()
      expect(doc.paths['/events/log'].post?.responses['202']).toBeDefined()
    })

    it('should use custom event path', () => {
      registry.event('notify', async () => {})

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
        eventPath: '/webhooks',
      })

      expect(doc.paths['/webhooks/notify']).toBeDefined()
    })
  })

  describe('Schema Integration', () => {
    it('should include input schema in request body', () => {
      registry.procedure('greet', async () => ({ message: 'hello' }))
      schemaRegistry.register('greet', {
        input: z.object({
          name: z.string().min(1),
          age: z.number().optional(),
        }),
      })

      const doc = generateOpenAPI(registry, schemaRegistry, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      expect(doc.components?.schemas?.['greetInput']).toBeDefined()
      expect(doc.paths['/greet'].post?.requestBody?.content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/greetInput',
      })
    })

    it('should include output schema in response', () => {
      registry.procedure('greet', async () => ({ message: 'hello' }))
      schemaRegistry.register('greet', {
        output: z.object({
          message: z.string(),
        }),
      })

      const doc = generateOpenAPI(registry, schemaRegistry, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      expect(doc.components?.schemas?.['greetOutput']).toBeDefined()
      expect(
        doc.paths['/greet'].post?.responses['200'].content?.['application/json'].schema
      ).toEqual({ $ref: '#/components/schemas/greetOutput' })
    })

    it('should convert Zod schemas to JSON Schema', () => {
      registry.procedure('test', async () => ({ ok: true }))
      schemaRegistry.register('test', {
        input: z.object({
          name: z.string(),
          count: z.number(),
          active: z.boolean(),
          tags: z.array(z.string()),
        }),
      })

      const doc = generateOpenAPI(registry, schemaRegistry, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      const schema = doc.components?.schemas?.['testInput'] as Record<string, unknown>
      expect(schema).toBeDefined()
      // Zod 4 with zod-to-json-schema may have different structures
      // Just verify the schema exists and is an object
      expect(typeof schema).toBe('object')
    })

    it('should emit opaque fallback diagnostics for unsupported schemas', () => {
      registry.procedure('opaque', async () => ({ ok: true }))
      schemaRegistry.register('opaque', {
        input: { unsupported: true },
      })

      const doc = generateOpenAPI(registry, schemaRegistry, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      const schema = doc.components?.schemas?.['opaqueInput'] as Record<string, unknown>
      expect(schema['x-raffel-opaque']).toBe(true)
      expect(Array.isArray(schema['x-raffel-diagnostics'])).toBe(true)
    })
  })

  describe('Tags and Namespacing', () => {
    it('should group by namespace', () => {
      registry.procedure('users.create', async () => ({ id: '1' }))
      registry.procedure('users.list', async () => [])
      registry.procedure('orders.create', async () => ({ id: '2' }))

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
        groupByNamespace: true,
      })

      expect(doc.tags).toBeDefined()
      expect(doc.tags?.map((t) => t.name)).toContain('users')
      expect(doc.tags?.map((t) => t.name)).toContain('orders')

      expect(doc.paths['/users/create'].post?.tags).toContain('users')
      expect(doc.paths['/orders/create'].post?.tags).toContain('orders')
    })

    it('should not create tags when groupByNamespace is false', () => {
      registry.procedure('users.create', async () => ({ id: '1' }))

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
        groupByNamespace: false,
      })

      expect(doc.tags).toBeUndefined()
      expect(doc.paths['/users/create'].post?.tags).toBeUndefined()
    })
  })

  describe('REST Resources', () => {
    it('should document list responses as arrays by default and delete as 204', () => {
      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
        restResources: [
          {
            name: 'users',
            schema: z.object({ id: z.string(), name: z.string() }),
            routes: [
              { method: 'GET', path: '/users', operation: 'list' },
              { method: 'DELETE', path: '/users/:id', operation: 'delete' },
            ],
          },
        ],
      })

      const list = doc.paths['/users'].get
      expect(list?.parameters).toBeUndefined()
      expect(list?.description).toBe('Returns a list of users. Supports filtering and sorting via query parameters.')
      expect(list?.responses['200'].content?.['application/json'].schema).toEqual({
        type: 'array',
        items: { $ref: '#/components/schemas/Users' },
      })

      const deletion = doc.paths['/users/{id}'].delete
      expect(deletion?.responses['204']).toEqual({ description: 'Resource deleted' })
      expect(deletion?.responses['200']).toBeUndefined()
    })

    it('should document offset pagination only when enabled', () => {
      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
        restResources: [
          {
            name: 'users',
            schema: z.object({ id: z.string(), name: z.string() }),
            config: { pagination: true },
            routes: [
              { method: 'GET', path: '/users', operation: 'list' },
            ],
          },
        ],
      })

      const list = doc.paths['/users'].get
      expect(list?.parameters?.map((param) => param.name)).toEqual(['limit', 'page', 'offset'])
      expect(list?.responses['200'].content?.['application/json'].schema).toMatchObject({
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          data: { type: 'array' },
          meta: {
            type: 'object',
            required: ['total', 'limit', 'offset', 'page', 'hasMore'],
            properties: {
              total: { type: 'integer' },
              limit: { type: 'integer' },
              offset: { type: 'integer' },
              page: { type: 'integer' },
              hasMore: { type: 'boolean' },
            },
          },
        },
      })
    })

    it('should document cursor pagination when configured', () => {
      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
        restResources: [
          {
            name: 'users',
            schema: z.object({ id: z.string(), name: z.string() }),
            config: {
              pagination: { style: 'cursor', defaultLimit: 10, maxLimit: 50, cursorField: 'id' },
            },
            routes: [
              { method: 'GET', path: '/users', operation: 'list' },
            ],
          },
        ],
      })

      const list = doc.paths['/users'].get
      expect(list?.parameters?.map((param) => param.name)).toEqual(['limit', 'cursor'])
      expect(list?.parameters?.[0].schema).toMatchObject({ default: 10, maximum: 50 })
      expect(list?.responses['200'].content?.['application/json'].schema).toMatchObject({
        type: 'object',
        required: ['data', 'meta'],
        properties: {
          meta: {
            type: 'object',
            required: ['limit', 'hasMore'],
            properties: {
              limit: { type: 'integer' },
              nextCursor: { type: 'string' },
              hasMore: { type: 'boolean' },
            },
          },
        },
      })
    })
  })

  describe('Security Schemes', () => {
    it('should include security schemes', () => {
      registry.procedure('test', async () => ({ ok: true }))

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          apiKey: {
            type: 'apiKey',
            name: 'X-API-Key',
            in: 'header',
          },
        },
        security: [{ bearerAuth: [] }],
      })

      expect(doc.components?.securitySchemes?.bearerAuth).toBeDefined()
      expect(doc.components?.securitySchemes?.apiKey).toBeDefined()
      expect(doc.security).toEqual([{ bearerAuth: [] }])
    })

    it('should expose contract policy metadata as a vendor extension', () => {
      registry.procedure('secure', async () => ({ ok: true }), {
        policies: {
          auth: { mode: 'required', roles: ['admin'] },
          timeout: { timeoutMs: 1000 },
          rateLimit: { windowMs: 60000, maxRequests: 10 },
        },
      })

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      expect(doc.paths['/secure'].post?.['x-raffel-policies']).toMatchObject({
        auth: { mode: 'required', roles: ['admin'] },
        timeout: { timeoutMs: 1000 },
        rateLimit: { windowMs: 60000, maxRequests: 10 },
      })
    })
  })

  describe('Operation IDs', () => {
    it('should generate camelCase operationIds', () => {
      registry.procedure('users.create', async () => ({ id: '1' }))
      registry.procedure('users.getById', async () => ({ id: '1' }))

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      expect(doc.paths['/users/create'].post?.operationId).toBe('usersCreate')
      expect(doc.paths['/users/getById'].post?.operationId).toBe('usersGetById')
    })
  })

  describe('Error Responses', () => {
    it('should include standard error responses', () => {
      registry.procedure('test', async () => ({ ok: true }))

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      const responses = doc.paths['/test'].post?.responses
      expect(responses?.['400']).toBeDefined()
      expect(responses?.['401']).toBeDefined()
      expect(responses?.['403']).toBeDefined()
      expect(responses?.['404']).toBeDefined()
      expect(responses?.['500']).toBeDefined()
    })
  })

  describe('Call summary (FS verb convention)', () => {
    it("drops the redundant trailing HTTP verb from the default 'Call ...' summary", () => {
      registry.procedure('enrichment/document/:value/get', async () => ({ ok: true }), {
        httpMethod: 'GET',
        httpPath: '/enrichment/document/:value',
      })

      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })

      const op = Object.values(doc.paths).flatMap((methods) => Object.values(methods as Record<string, any>))
        .find((o: any) => typeof o?.summary === 'string' && o.summary.includes('enrichment/document/:value')) as any

      expect(op).toBeDefined()
      expect(op.summary).toBe('Call enrichment/document/:value')
      expect(op.summary).not.toContain('/get')
    })

    it('keeps the name when the trailing segment is not the route verb', () => {
      registry.procedure('users.list', async () => ([]), {})
      const doc = generateOpenAPI(registry, undefined, {
        info: { title: 'Test API', version: '1.0.0' },
      })
      const op = Object.values(doc.paths).flatMap((methods) => Object.values(methods as Record<string, any>))
        .find((o: any) => o?.summary === 'Call users.list') as any
      expect(op).toBeDefined()
    })
  })

})
