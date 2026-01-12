/**
 * USD Generator (Orchestrator) Tests
 *
 * Tests for the main USD document generator that coordinates all protocol-specific sub-generators.
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  generateUSD,
  createHttpOnlyUSD,
  createWebSocketOnlyUSD,
  createStreamsOnlyUSD,
  type USDGeneratorContext,
  type USDGeneratorOptions,
} from '../../../src/docs/generators/usd-generator.js'
import { createRegistry, type Registry } from '../../../src/core/registry.js'
import type { LoadedChannel, ChannelExports } from '../../../src/server/fs-routes/index.js'
import type { SchemaRegistry } from '../../../src/validation/index.js'

// Helper to create mock schema registry
function createMockSchemaRegistry(): SchemaRegistry {
  const schemas = new Map<string, { input?: unknown; output?: unknown }>()
  return {
    set(name: string, handler: { input?: unknown; output?: unknown }) {
      schemas.set(name, handler)
    },
    get(name: string) {
      return schemas.get(name)
    },
    has(name: string) {
      return schemas.has(name)
    },
    entries() {
      return schemas.entries()
    },
  } as unknown as SchemaRegistry
}

// Helper to create mock channel
function createMockChannel(
  name: string,
  configOverrides: Partial<ChannelExports> = {}
): LoadedChannel {
  return {
    name,
    filePath: `/channels/${name}.ts`,
    config: {
      auth: 'none',
      ...configOverrides,
    },
  }
}

describe('USD Generator (Orchestrator)', () => {
  let registry: Registry
  let ctx: USDGeneratorContext
  let baseOptions: USDGeneratorOptions

  beforeEach(() => {
    registry = createRegistry()
    ctx = { registry }
    baseOptions = {
      info: {
        title: 'Test API',
        version: '1.0.0',
      },
    }
  })

  describe('generateUSD', () => {
    describe('document structure', () => {
      it('should return document with USD and OpenAPI versions', () => {
        const result = generateUSD(ctx, baseOptions)

        assert.equal(result.document.usd, '1.0.0')
        assert.equal(result.document.openapi, '3.1.0')
      })

      it('should include info with title and version', () => {
        const result = generateUSD(ctx, baseOptions)

        assert.equal(result.document.info.title, 'Test API')
        assert.equal(result.document.info.version, '1.0.0')
      })

      it('should include description when provided', () => {
        const result = generateUSD(ctx, {
          info: {
            title: 'Test API',
            version: '1.0.0',
            description: 'API for testing',
          },
        })

        assert.equal(result.document.info.description, 'API for testing')
      })

      it('should include contact info when provided', () => {
        const result = generateUSD(ctx, {
          info: {
            title: 'Test API',
            version: '1.0.0',
            contact: {
              name: 'Support',
              email: 'support@example.com',
              url: 'https://example.com/support',
            },
          },
        })

        assert.deepEqual(result.document.info.contact, {
          name: 'Support',
          email: 'support@example.com',
          url: 'https://example.com/support',
        })
      })

      it('should include license info when provided', () => {
        const result = generateUSD(ctx, {
          info: {
            title: 'Test API',
            version: '1.0.0',
            license: {
              name: 'MIT',
              url: 'https://opensource.org/licenses/MIT',
            },
          },
        })

        assert.deepEqual(result.document.info.license, {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT',
        })
      })

      it('should include x-usd protocols', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.document['x-usd']?.protocols)
        assert.ok(result.document['x-usd']?.protocols?.includes('http'))
      })

      it('should include global content types', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateUSD(ctx, baseOptions)

        assert.equal(result.document['x-usd']?.contentTypes?.default, 'application/json')
      })
    })

    describe('protocol detection', () => {
      it('should detect HTTP when procedures exist', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.protocols.includes('http'))
      })

      it('should detect HTTP when REST resources exist', () => {
        ctx.restResources = [{
          name: 'users',
          filePath: '/api/users.ts',
          schema: z.object({ id: z.string() }),
          config: {} as any,
          handlers: new Map(),
          actions: new Map(),
          routes: [],
        }]

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.protocols.includes('http'))
      })

      it('should detect WebSocket when channels exist (array)', () => {
        ctx.channels = [createMockChannel('chat')]

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.protocols.includes('websocket'))
      })

      it('should detect WebSocket when channels exist (Map)', () => {
        const channelsMap = new Map<string, LoadedChannel>()
        channelsMap.set('chat', createMockChannel('chat'))
        ctx.channels = channelsMap

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.protocols.includes('websocket'))
      })

      it('should detect Streams when streams exist', () => {
        registry.stream('events', async function* () { yield {} })

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.protocols.includes('streams'))
      })

      it('should detect multiple protocols', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))
        registry.stream('events', async function* () { yield {} })
        ctx.channels = [createMockChannel('chat')]

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.protocols.includes('http'))
        assert.ok(result.protocols.includes('websocket'))
        assert.ok(result.protocols.includes('streams'))
      })

      it('should use specified protocols instead of auto-detect', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))
        registry.stream('events', async function* () { yield {} })

        const result = generateUSD(ctx, {
          ...baseOptions,
          protocols: ['http'],
        })

        assert.deepEqual(result.protocols, ['http'])
        assert.equal(result.document['x-usd']?.streams, undefined)
      })
    })

    describe('HTTP paths generation', () => {
      it('should generate paths for procedures', () => {
        registry.procedure('users.list', async () => [])
        registry.procedure('users.get', async () => ({}))

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.document.paths)
        assert.ok(result.document.paths['/users/list'])
        assert.ok(result.document.paths['/users/get'])
      })

      it('should not include paths when no HTTP content', () => {
        registry.stream('events', async function* () { yield {} })

        const result = generateUSD(ctx, {
          ...baseOptions,
          protocols: ['streams'],
        })

        assert.equal(result.document.paths, undefined)
      })
    })

    describe('WebSocket generation', () => {
      it('should generate x-usd.websocket for channels', () => {
        ctx.channels = [createMockChannel('chat')]

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.document['x-usd']?.websocket)
        assert.ok(result.document['x-usd']?.websocket?.channels?.['chat'])
      })

      it('should include authentication in websocket spec', () => {
        ctx.channels = [createMockChannel('chat')]

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.document['x-usd']?.websocket?.authentication)
      })

      it('should include protocol events in websocket spec', () => {
        ctx.channels = [createMockChannel('chat')]

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.document['x-usd']?.websocket?.events)
      })

      it('should not include x-usd.websocket when no channels', () => {
        registry.procedure('health', async () => ({}))

        const result = generateUSD(ctx, baseOptions)

        assert.equal(result.document['x-usd']?.websocket, undefined)
      })
    })

    describe('Streams generation', () => {
      it('should generate x-usd.streams for registered streams', () => {
        registry.stream('events', async function* () { yield {} })

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.document['x-usd']?.streams)
        assert.ok(result.document['x-usd']?.streams?.endpoints?.['events'])
      })

      it('should include stream event schemas by default', () => {
        registry.stream('events', async function* () { yield {} })

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.document.components?.schemas?.StreamData)
        assert.ok(result.document.components?.schemas?.StreamError)
        assert.ok(result.document.components?.schemas?.StreamEnd)
      })

      it('should not include stream event schemas when disabled', () => {
        registry.stream('events', async function* () { yield {} })

        const result = generateUSD(ctx, {
          ...baseOptions,
          includeStreamEventSchemas: false,
        })

        assert.equal(result.document.components?.schemas?.StreamData, undefined)
      })
    })

    describe('security', () => {
      it('should add security schemes when provided', () => {
        const result = generateUSD(ctx, {
          ...baseOptions,
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        })

        assert.ok(result.document.components?.securitySchemes?.bearerAuth)
      })

      it('should add default security when provided', () => {
        const result = generateUSD(ctx, {
          ...baseOptions,
          defaultSecurity: [{ bearerAuth: [] }],
        })

        assert.deepEqual(result.document.security, [{ bearerAuth: [] }])
      })
    })

    describe('tags', () => {
      it('should collect tags from HTTP generation', () => {
        registry.procedure('users.list', async () => [])
        registry.procedure('tasks.list', async () => [])

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.tags.includes('users'))
        assert.ok(result.tags.includes('tasks'))
      })

      it('should collect tags from channels', () => {
        ctx.channels = [
          createMockChannel('chat'),
          createMockChannel('notifications'),
        ]

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.tags.includes('chat'))
        assert.ok(result.tags.includes('notifications'))
      })

      it('should collect tags from streams', () => {
        registry.stream('events.push', async function* () { yield {} })

        const result = generateUSD(ctx, baseOptions)

        assert.ok(result.tags.includes('events'))
      })

      it('should include custom tags', () => {
        const result = generateUSD(ctx, {
          ...baseOptions,
          tags: [
            { name: 'auth', description: 'Authentication operations' },
          ],
        })

        assert.ok(result.document.tags?.some(t => t.name === 'auth'))
      })

      it('should merge custom tag descriptions with auto-detected tags', () => {
        registry.procedure('users.list', async () => [])

        const result = generateUSD(ctx, {
          ...baseOptions,
          tags: [
            { name: 'users', description: 'User management operations' },
          ],
        })

        const usersTag = result.document.tags?.find(t => t.name === 'users')
        assert.ok(usersTag)
        assert.equal(usersTag.description, 'User management operations')
      })

      it('should sort tags alphabetically', () => {
        registry.procedure('zebra.list', async () => [])
        registry.procedure('alpha.list', async () => [])

        const result = generateUSD(ctx, baseOptions)

        const tagNames = result.document.tags?.map(t => t.name) ?? []
        assert.equal(tagNames[0], 'alpha')
        assert.equal(tagNames[1], 'zebra')
      })
    })

    describe('servers', () => {
      it('should include servers when provided', () => {
        const result = generateUSD(ctx, {
          ...baseOptions,
          servers: [
            { url: 'https://api.example.com', description: 'Production' },
            { url: 'https://staging-api.example.com', description: 'Staging' },
          ],
        })

        assert.equal(result.document.servers?.length, 2)
        assert.equal(result.document.servers?.[0].url, 'https://api.example.com')
      })
    })

    describe('external docs', () => {
      it('should include external docs when provided', () => {
        const result = generateUSD(ctx, {
          ...baseOptions,
          externalDocs: {
            description: 'Full documentation',
            url: 'https://docs.example.com',
          },
        })

        assert.ok(result.document.externalDocs)
        assert.equal(result.document.externalDocs.url, 'https://docs.example.com')
      })
    })

    describe('components cleanup', () => {
      it('should not include empty schemas object', () => {
        // Empty context, no schemas generated
        const result = generateUSD(ctx, {
          ...baseOptions,
          includeErrorSchemas: false,
          includeStreamEventSchemas: false,
        })

        // Should either not have components or not have empty schemas
        if (result.document.components) {
          assert.notEqual(Object.keys(result.document.components.schemas ?? {}).length, 0)
        }
      })

      it('should not include empty components object', () => {
        const result = generateUSD(ctx, {
          ...baseOptions,
          includeErrorSchemas: false,
          includeStreamEventSchemas: false,
        })

        // If components exists, it should have content
        if (result.document.components) {
          assert.ok(Object.keys(result.document.components).length > 0)
        }
      })
    })

    describe('schema merging', () => {
      it('should merge schemas from all generators', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('users.list', {
          output: z.array(z.object({ id: z.string() })),
        })
        schemaRegistry.set('events', {
          output: z.object({ message: z.string() }),
        })

        registry.procedure('users.list', async () => [])
        registry.stream('events', async function* () { yield {} }, { direction: 'server' })
        ctx.schemaRegistry = schemaRegistry
        ctx.channels = [createMockChannel('chat', {
          events: {
            message: { input: z.object({ text: z.string() }) },
          },
        })]

        const result = generateUSD(ctx, baseOptions)

        // Should have schemas from HTTP, WebSocket, and Streams
        assert.ok(result.document.components?.schemas)
        const schemas = result.document.components.schemas
        // HTTP schema
        assert.ok(schemas['UsersListOutput'])
        // Stream schema
        assert.ok(schemas['Events_Output'])
      })
    })
  })

  describe('createHttpOnlyUSD', () => {
    it('should create HTTP-only document', () => {
      registry.procedure('health', async () => ({ status: 'ok' }))

      const doc = createHttpOnlyUSD(
        { registry },
        { title: 'HTTP API', version: '1.0.0' }
      )

      assert.ok(doc.paths)
      assert.ok(doc.paths['/health'])
    })

    it('should have x-usd protocols with only http', () => {
      registry.procedure('health', async () => ({ status: 'ok' }))

      const doc = createHttpOnlyUSD(
        { registry },
        { title: 'HTTP API', version: '1.0.0' }
      )

      assert.deepEqual(doc['x-usd']?.protocols, ['http'])
    })

    it('should not include websocket or streams extensions', () => {
      registry.procedure('health', async () => ({ status: 'ok' }))
      registry.stream('events', async function* () { yield {} })

      const doc = createHttpOnlyUSD(
        { registry },
        { title: 'HTTP API', version: '1.0.0' }
      )

      assert.equal(doc['x-usd']?.websocket, undefined)
      assert.equal(doc['x-usd']?.streams, undefined)
    })
  })

  describe('createWebSocketOnlyUSD', () => {
    it('should create WebSocket-only document', () => {
      const channels = [createMockChannel('chat')]

      const doc = createWebSocketOnlyUSD(
        channels,
        { title: 'WebSocket API', version: '1.0.0' }
      )

      assert.ok(doc['x-usd']?.websocket)
      assert.ok(doc['x-usd']?.websocket?.channels?.['chat'])
    })

    it('should have x-usd protocols with only websocket', () => {
      const channels = [createMockChannel('chat')]

      const doc = createWebSocketOnlyUSD(
        channels,
        { title: 'WebSocket API', version: '1.0.0' }
      )

      assert.deepEqual(doc['x-usd']?.protocols, ['websocket'])
    })

    it('should accept Map<string, LoadedChannel>', () => {
      const channelsMap = new Map<string, LoadedChannel>()
      channelsMap.set('chat', createMockChannel('chat'))

      const doc = createWebSocketOnlyUSD(
        channelsMap,
        { title: 'WebSocket API', version: '1.0.0' }
      )

      assert.ok(doc['x-usd']?.websocket?.channels?.['chat'])
    })

    it('should include authentication and protocol events', () => {
      const channels = [createMockChannel('chat')]

      const doc = createWebSocketOnlyUSD(
        channels,
        { title: 'WebSocket API', version: '1.0.0' }
      )

      assert.ok(doc['x-usd']?.websocket?.authentication)
      assert.ok(doc['x-usd']?.websocket?.events)
    })

    it('should include schemas in components', () => {
      const channels = [createMockChannel('chat', {
        events: {
          message: { input: z.object({ text: z.string() }) },
        },
      })]

      const doc = createWebSocketOnlyUSD(
        channels,
        { title: 'WebSocket API', version: '1.0.0' }
      )

      assert.ok(doc.components?.schemas)
    })
  })

  describe('createStreamsOnlyUSD', () => {
    it('should create Streams-only document', () => {
      registry.stream('events', async function* () { yield {} })

      const doc = createStreamsOnlyUSD(
        { registry },
        { title: 'Streams API', version: '1.0.0' }
      )

      assert.ok(doc['x-usd']?.streams)
    })

    it('should have x-usd protocols with only streams', () => {
      registry.stream('events', async function* () { yield {} })

      const doc = createStreamsOnlyUSD(
        { registry },
        { title: 'Streams API', version: '1.0.0' }
      )

      assert.deepEqual(doc['x-usd']?.protocols, ['streams'])
    })

    it('should include standard stream event schemas', () => {
      registry.stream('events', async function* () { yield {} })

      const doc = createStreamsOnlyUSD(
        { registry },
        { title: 'Streams API', version: '1.0.0' }
      )

      assert.ok(doc.components?.schemas?.StreamData)
      assert.ok(doc.components?.schemas?.StreamError)
      assert.ok(doc.components?.schemas?.StreamEnd)
    })
  })

  describe('channel tag extraction', () => {
    it('should extract tag from public channel', () => {
      ctx.channels = [createMockChannel('notifications')]

      const result = generateUSD(ctx, baseOptions)

      assert.ok(result.tags.includes('notifications'))
    })

    it('should extract tag from private channel', () => {
      ctx.channels = [createMockChannel('private-user-updates')]

      const result = generateUSD(ctx, baseOptions)

      assert.ok(result.tags.includes('user'))
    })

    it('should extract tag from presence channel', () => {
      ctx.channels = [createMockChannel('presence-lobby')]

      const result = generateUSD(ctx, baseOptions)

      assert.ok(result.tags.includes('lobby'))
    })
  })

  describe('stream tag extraction', () => {
    it('should extract tag from dotted stream name', () => {
      registry.stream('notifications.push', async function* () { yield {} })

      const result = generateUSD(ctx, baseOptions)

      assert.ok(result.tags.includes('notifications'))
    })

    it('should extract tag from hyphenated stream name', () => {
      registry.stream('event-stream', async function* () { yield {} })

      const result = generateUSD(ctx, baseOptions)

      assert.ok(result.tags.includes('event'))
    })
  })
})
