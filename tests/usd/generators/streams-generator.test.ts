/**
 * Streams Generator Tests
 *
 * Tests for converting Raffel streams to USD Streams specification.
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  generateStreams,
  createSSEStreamConfig,
  createBidiStreamConfig,
  generateStreamEvents,
  type StreamsGeneratorContext,
  type StreamsGeneratorOptions,
} from '../../../src/docs/generators/streams-generator.js'
import { createRegistry, type Registry } from '../../../src/core/registry.js'
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

describe('Streams Generator', () => {
  let registry: Registry
  let ctx: StreamsGeneratorContext

  beforeEach(() => {
    registry = createRegistry()
    ctx = { registry }
  })

  describe('generateStreams', () => {
    describe('with empty registry', () => {
      it('should return empty endpoints', () => {
        const result = generateStreams(ctx)

        assert.equal(result.streams.endpoints, undefined)
      })

      it('should return empty schemas', () => {
        const result = generateStreams(ctx)

        assert.deepEqual(result.schemas, {})
      })
    })

    describe('with registered streams', () => {
      it('should convert stream to endpoint', () => {
        registry.stream('events', async function* () {
          yield { data: 'test' }
        })

        const result = generateStreams(ctx)

        assert.ok(result.streams.endpoints)
        assert.ok(result.streams.endpoints['events'])
      })

      it('should include default protocol content types', () => {
        registry.stream('events', async function* () {
          yield { data: 'test' }
        })

        const result = generateStreams(ctx)

        assert.equal(result.streams.contentTypes?.default, 'application/json')
      })

      it('should apply content type metadata to endpoint and message', () => {
        registry.stream('events', async function* () {
          yield { data: 'test' }
        }, { contentType: 'text/csv' })

        const result = generateStreams(ctx)
        const endpoint = result.streams.endpoints?.['events']

        assert.equal(endpoint?.contentTypes?.default, 'text/csv')
        assert.equal(endpoint?.message.contentType, 'text/csv')
      })

      it('should use default direction (server-to-client)', () => {
        registry.stream('events', async function* () {
          yield { data: 'test' }
        })

        const result = generateStreams(ctx)

        assert.equal(result.streams.endpoints?.['events'].direction, 'server-to-client')
      })

      it('should convert server direction', () => {
        registry.stream('server-events', async function* () {
          yield { data: 'test' }
        }, { direction: 'server' })

        const result = generateStreams(ctx)

        assert.equal(result.streams.endpoints?.['server-events'].direction, 'server-to-client')
      })

      it('should convert client direction', () => {
        registry.stream('client-stream', async function* () {
          yield { data: 'test' }
        }, { direction: 'client' })

        const result = generateStreams(ctx)

        assert.equal(result.streams.endpoints?.['client-stream'].direction, 'client-to-server')
      })

      it('should convert bidi direction', () => {
        registry.stream('chat', async function* () {
          yield { data: 'test' }
        }, { direction: 'bidi' })

        const result = generateStreams(ctx)

        assert.equal(result.streams.endpoints?.['chat'].direction, 'bidirectional')
      })

      it('should add description from stream options', () => {
        registry.stream('events', async function* () {
          yield { data: 'test' }
        }, { description: 'Event stream for notifications' })

        const result = generateStreams(ctx)

        assert.equal(result.streams.endpoints?.['events'].description, 'Event stream for notifications')
      })

      it('should use default description when not provided', () => {
        registry.stream('events', async function* () {
          yield { data: 'test' }
        })

        const result = generateStreams(ctx)

        assert.equal(result.streams.endpoints?.['events'].description, 'Stream: events')
      })
    })

    describe('with schema registry', () => {
      it('should register output schema for server-to-client streams', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('events', {
          output: z.object({ message: z.string() }),
        })

        registry.stream('events', async function* () {
          yield { message: 'test' }
        }, { direction: 'server' })

        ctx.schemaRegistry = schemaRegistry
        const result = generateStreams(ctx)

        // Schema should be registered
        assert.ok(result.schemas['Events_Output'])
        // Message should reference the schema
        assert.ok(result.streams.endpoints?.['events'].message.payload?.$ref?.includes('Events_Output'))
      })

      it('should register input schema for client-to-server streams', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('uploads', {
          input: z.object({ filename: z.string() }),
        })

        registry.stream('uploads', async function* () {
          yield {}
        }, { direction: 'client' })

        ctx.schemaRegistry = schemaRegistry
        const result = generateStreams(ctx)

        assert.ok(result.schemas['Uploads_Input'])
        assert.ok(result.streams.endpoints?.['uploads'].message.payload?.$ref?.includes('Uploads_Input'))
      })

      it('should register both schemas for bidirectional streams', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('chat', {
          input: z.object({ text: z.string() }),
          output: z.object({ response: z.string() }),
        })

        registry.stream('chat', async function* () {
          yield { response: 'test' }
        }, { direction: 'bidi' })

        ctx.schemaRegistry = schemaRegistry
        const result = generateStreams(ctx)

        assert.ok(result.schemas['Chat_ClientMessage'])
        assert.ok(result.schemas['Chat_ServerMessage'])
      })

      it('should use output schema as main payload for bidirectional', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('chat', {
          input: z.object({ text: z.string() }),
          output: z.object({ response: z.string() }),
        })

        registry.stream('chat', async function* () {
          yield { response: 'test' }
        }, { direction: 'bidi' })

        ctx.schemaRegistry = schemaRegistry
        const result = generateStreams(ctx)

        assert.ok(result.streams.endpoints?.['chat'].message.payload?.$ref?.includes('Chat_ServerMessage'))
      })

      it('should use generic object when no schema provided', () => {
        registry.stream('events', async function* () {
          yield { data: 'test' }
        })

        const result = generateStreams(ctx)

        assert.deepEqual(result.streams.endpoints?.['events'].message.payload, { type: 'object' })
      })
    })

    describe('stream tags extraction', () => {
      it('should extract tag from dotted stream name', () => {
        registry.stream('notifications.push', async function* () {
          yield {}
        })

        const result = generateStreams(ctx)

        assert.deepEqual(result.streams.endpoints?.['notifications.push'].tags, ['notifications'])
      })

      it('should extract tag from hyphenated stream name', () => {
        registry.stream('event-stream', async function* () {
          yield {}
        })

        const result = generateStreams(ctx)

        assert.deepEqual(result.streams.endpoints?.['event-stream'].tags, ['event'])
      })

      it('should extract tag from underscore stream name', () => {
        registry.stream('data_feed', async function* () {
          yield {}
        })

        const result = generateStreams(ctx)

        assert.deepEqual(result.streams.endpoints?.['data_feed'].tags, ['data'])
      })

      it('should not add tags for simple stream name', () => {
        registry.stream('events', async function* () {
          yield {}
        })

        const result = generateStreams(ctx)

        // No tags for simple names
        assert.equal(result.streams.endpoints?.['events'].tags?.length, undefined)
      })
    })

    describe('with options', () => {
      it('should add security when defaultSecurity is provided', () => {
        registry.stream('events', async function* () {
          yield {}
        })

        const result = generateStreams(ctx, {
          defaultSecurity: [{ bearerAuth: [] }],
        })

        assert.deepEqual(result.streams.endpoints?.['events'].security, [{ bearerAuth: [] }])
      })

      it('should add backpressure for bidirectional streams by default', () => {
        registry.stream('chat', async function* () {
          yield {}
        }, { direction: 'bidi' })

        const result = generateStreams(ctx)

        assert.equal((result.streams.endpoints?.['chat'] as any)['x-usd-backpressure'], true)
      })

      it('should not add backpressure when disabled', () => {
        registry.stream('chat', async function* () {
          yield {}
        }, { direction: 'bidi' })

        const result = generateStreams(ctx, { includeBackpressure: false })

        assert.equal((result.streams.endpoints?.['chat'] as any)['x-usd-backpressure'], undefined)
      })

      it('should not add backpressure for server-to-client streams', () => {
        registry.stream('events', async function* () {
          yield {}
        }, { direction: 'server' })

        const result = generateStreams(ctx)

        assert.equal((result.streams.endpoints?.['events'] as any)['x-usd-backpressure'], undefined)
      })
    })

    describe('message structure', () => {
      it('should create message with contentType', () => {
        registry.stream('events', async function* () {
          yield {}
        })

        const result = generateStreams(ctx)

        assert.equal(result.streams.endpoints?.['events'].message.contentType, 'application/json')
      })

      it('should create message with name', () => {
        registry.stream('events', async function* () {
          yield {}
        })

        const result = generateStreams(ctx)

        assert.equal(result.streams.endpoints?.['events'].message.name, 'EventsMessage')
      })

      it('should add summary for server-to-client message', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('events', {
          output: z.object({ data: z.string() }),
        })

        registry.stream('events', async function* () {
          yield {}
        }, { direction: 'server' })

        ctx.schemaRegistry = schemaRegistry
        const result = generateStreams(ctx)

        assert.equal(result.streams.endpoints?.['events'].message.summary, 'Server-sent message')
      })

      it('should add summary for client-to-server message', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('uploads', {
          input: z.object({ file: z.string() }),
        })

        registry.stream('uploads', async function* () {
          yield {}
        }, { direction: 'client' })

        ctx.schemaRegistry = schemaRegistry
        const result = generateStreams(ctx)

        assert.equal(result.streams.endpoints?.['uploads'].message.summary, 'Client-sent message')
      })

      it('should add summary and description for bidirectional message', () => {
        registry.stream('chat', async function* () {
          yield {}
        }, { direction: 'bidi' })

        const result = generateStreams(ctx)

        assert.equal(result.streams.endpoints?.['chat'].message.summary, 'Bidirectional message')
        assert.equal(result.streams.endpoints?.['chat'].message.description, 'Messages can flow in both directions')
      })
    })

    describe('schema name sanitization', () => {
      it('should sanitize dotted names', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('api.events.push', {
          output: z.object({ data: z.string() }),
        })

        registry.stream('api.events.push', async function* () {
          yield {}
        }, { direction: 'server' })

        ctx.schemaRegistry = schemaRegistry
        const result = generateStreams(ctx)

        // Should convert dots to underscores and capitalize
        assert.ok(result.schemas['ApiEventsPush_Output'])
      })

      it('should sanitize hyphenated names', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('event-stream', {
          output: z.object({ data: z.string() }),
        })

        registry.stream('event-stream', async function* () {
          yield {}
        }, { direction: 'server' })

        ctx.schemaRegistry = schemaRegistry
        const result = generateStreams(ctx)

        assert.ok(result.schemas['EventStream_Output'])
      })
    })

    describe('multiple streams', () => {
      it('should convert all registered streams', () => {
        registry.stream('events', async function* () { yield {} })
        registry.stream('notifications', async function* () { yield {} })
        registry.stream('chat', async function* () { yield {} }, { direction: 'bidi' })

        const result = generateStreams(ctx)

        assert.ok(result.streams.endpoints)
        assert.equal(Object.keys(result.streams.endpoints).length, 3)
        assert.ok(result.streams.endpoints['events'])
        assert.ok(result.streams.endpoints['notifications'])
        assert.ok(result.streams.endpoints['chat'])
      })
    })

    describe('bidirectional with only output schema', () => {
      it('should use _Message suffix for output-only bidirectional', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('chat', {
          output: z.object({ response: z.string() }),
        })

        registry.stream('chat', async function* () {
          yield {}
        }, { direction: 'bidi' })

        ctx.schemaRegistry = schemaRegistry
        const result = generateStreams(ctx)

        assert.ok(result.schemas['Chat_Message'])
      })
    })

    describe('bidirectional with only input schema', () => {
      it('should use _Message suffix for input-only bidirectional', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('commands', {
          input: z.object({ command: z.string() }),
        })

        registry.stream('commands', async function* () {
          yield {}
        }, { direction: 'bidi' })

        ctx.schemaRegistry = schemaRegistry
        const result = generateStreams(ctx)

        assert.ok(result.schemas['Commands_Message'])
      })
    })
  })

  describe('createSSEStreamConfig', () => {
    it('should create SSE stream config with name', () => {
      const config = createSSEStreamConfig({ name: 'events' })

      assert.equal(config.name, 'events')
      assert.equal(config.meta.name, 'events')
    })

    it('should set kind to stream', () => {
      const config = createSSEStreamConfig({ name: 'events' })

      assert.equal(config.meta.kind, 'stream')
    })

    it('should set direction to server', () => {
      const config = createSSEStreamConfig({ name: 'events' })

      assert.equal(config.meta.streamDirection, 'server')
    })

    it('should use provided description', () => {
      const config = createSSEStreamConfig({
        name: 'events',
        description: 'Real-time event stream',
      })

      assert.equal(config.meta.description, 'Real-time event stream')
    })

    it('should use default description when not provided', () => {
      const config = createSSEStreamConfig({ name: 'events' })

      assert.equal(config.meta.description, 'SSE Stream: events')
    })

    it('should set output schema from eventSchema', () => {
      const eventSchema = z.object({ message: z.string() })
      const config = createSSEStreamConfig({
        name: 'events',
        eventSchema,
      })

      assert.equal(config.schema.output, eventSchema)
    })

    it('should set input schema from inputSchema', () => {
      const inputSchema = z.object({ filter: z.string() })
      const config = createSSEStreamConfig({
        name: 'events',
        inputSchema,
      })

      assert.equal(config.schema.input, inputSchema)
    })
  })

  describe('createBidiStreamConfig', () => {
    it('should create bidi stream config with name', () => {
      const config = createBidiStreamConfig({ name: 'chat' })

      assert.equal(config.name, 'chat')
      assert.equal(config.meta.name, 'chat')
    })

    it('should set kind to stream', () => {
      const config = createBidiStreamConfig({ name: 'chat' })

      assert.equal(config.meta.kind, 'stream')
    })

    it('should set direction to bidi', () => {
      const config = createBidiStreamConfig({ name: 'chat' })

      assert.equal(config.meta.streamDirection, 'bidi')
    })

    it('should use provided description', () => {
      const config = createBidiStreamConfig({
        name: 'chat',
        description: 'Real-time chat stream',
      })

      assert.equal(config.meta.description, 'Real-time chat stream')
    })

    it('should use default description when not provided', () => {
      const config = createBidiStreamConfig({ name: 'chat' })

      assert.equal(config.meta.description, 'Bidirectional Stream: chat')
    })

    it('should set input schema from clientMessageSchema', () => {
      const clientSchema = z.object({ text: z.string() })
      const config = createBidiStreamConfig({
        name: 'chat',
        clientMessageSchema: clientSchema,
      })

      assert.equal(config.schema.input, clientSchema)
    })

    it('should set output schema from serverMessageSchema', () => {
      const serverSchema = z.object({ response: z.string() })
      const config = createBidiStreamConfig({
        name: 'chat',
        serverMessageSchema: serverSchema,
      })

      assert.equal(config.schema.output, serverSchema)
    })
  })

  describe('generateStreamEvents', () => {
    it('should return standard stream event schemas', () => {
      const events = generateStreamEvents()

      assert.ok(events.StreamData)
      assert.ok(events.StreamError)
      assert.ok(events.StreamEnd)
    })

    it('should have correct StreamData schema', () => {
      const events = generateStreamEvents()

      assert.equal(events.StreamData.type, 'object')
      assert.ok(events.StreamData.properties?.id)
      assert.ok(events.StreamData.properties?.event)
      assert.ok(events.StreamData.properties?.data)
      assert.ok(events.StreamData.properties?.retry)
      assert.deepEqual(events.StreamData.required, ['data'])
    })

    it('should have correct StreamError schema', () => {
      const events = generateStreamEvents()

      assert.equal(events.StreamError.type, 'object')
      assert.ok(events.StreamError.properties?.code)
      assert.ok(events.StreamError.properties?.message)
      assert.ok(events.StreamError.properties?.fatal)
      assert.deepEqual(events.StreamError.required, ['code', 'message'])
    })

    it('should have correct StreamEnd schema', () => {
      const events = generateStreamEvents()

      assert.equal(events.StreamEnd.type, 'object')
      assert.ok(events.StreamEnd.properties?.reason)
      assert.ok(events.StreamEnd.properties?.stats)
      // StreamEnd has no required fields
      assert.equal(events.StreamEnd.required, undefined)
    })

    it('should have stats nested schema in StreamEnd', () => {
      const events = generateStreamEvents()

      const stats = events.StreamEnd.properties?.stats
      assert.equal(stats?.type, 'object')
      assert.ok(stats?.properties?.messageCount)
      assert.ok(stats?.properties?.duration)
    })
  })
})
