/**
 * WebSocket Generator Tests
 *
 * Tests for converting Raffel channels to USD WebSocket specification.
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import {
  generateWebSocket,
  generateChannelSchemas,
  type WebSocketGeneratorContext,
  type WebSocketGeneratorOptions,
} from '../../../src/docs/generators/websocket-generator.js'
import type { LoadedChannel, ChannelExports } from '../../../src/server/fs-routes/index.js'

// Helper to create a mock LoadedChannel
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

describe('WebSocket Generator', () => {
  describe('generateWebSocket', () => {
    describe('with empty channels', () => {
      it('should return empty channels', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx)

        assert.deepEqual(result.websocket.channels, {})
      })

      it('should use default path /ws', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx)

        assert.equal(result.websocket.path, '/ws')
      })

      it('should include authentication by default', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx)

        assert.ok(result.websocket.authentication)
        assert.equal(result.websocket.authentication?.in, 'query')
        assert.equal(result.websocket.authentication?.name, 'token')
      })

      it('should include default content types', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx)

        assert.equal(result.websocket.contentTypes?.default, 'application/json')
      })

      it('should include protocol events by default', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx)

        assert.ok(result.websocket.events)
        assert.ok(result.websocket.events?.subscribe)
        assert.ok(result.websocket.events?.subscribed)
        assert.ok(result.websocket.events?.unsubscribe)
        assert.ok(result.websocket.events?.unsubscribed)
        assert.ok(result.websocket.events?.publish)
        assert.ok(result.websocket.events?.message)
        assert.ok(result.websocket.events?.error)
        assert.ok(result.websocket.events?.ping)
        assert.ok(result.websocket.events?.pong)
      })
    })

    describe('with options', () => {
      it('should use custom path', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx, { path: '/realtime' })

        assert.equal(result.websocket.path, '/realtime')
      })

      it('should not include authentication when disabled', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx, { includeAuthentication: false })

        assert.equal(result.websocket.authentication, undefined)
      })

      it('should use custom auth location', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx, { authIn: 'header' })

        assert.equal(result.websocket.authentication?.in, 'header')
      })

      it('should use custom auth name', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx, { authName: 'authorization' })

        assert.equal(result.websocket.authentication?.name, 'authorization')
      })

      it('should not include protocol events when disabled', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx, { includeProtocol: false })

        assert.equal(result.websocket.events, undefined)
      })

      it('should support cookie authentication', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx, { authIn: 'cookie', authName: 'session' })

        assert.equal(result.websocket.authentication?.in, 'cookie')
        assert.equal(result.websocket.authentication?.name, 'session')
      })
    })

    describe('channel type inference', () => {
      it('should infer public type for plain channel names', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('general')],
        }
        const result = generateWebSocket(ctx)

        assert.equal(result.websocket.channels['general'].type, 'public')
      })

      it('should infer private type for private- prefix', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('private-user-123')],
        }
        const result = generateWebSocket(ctx)

        assert.equal(result.websocket.channels['private-user-123'].type, 'private')
      })

      it('should infer presence type for presence- prefix', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('presence-lobby')],
        }
        const result = generateWebSocket(ctx)

        assert.equal(result.websocket.channels['presence-lobby'].type, 'presence')
      })
    })

    describe('channel tags extraction', () => {
      it('should extract tag from simple channel name', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('chat')],
        }
        const result = generateWebSocket(ctx)

        assert.deepEqual(result.websocket.channels['chat'].tags, ['chat'])
      })

      it('should extract tag from hyphenated channel name', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('chat-room')],
        }
        const result = generateWebSocket(ctx)

        assert.deepEqual(result.websocket.channels['chat-room'].tags, ['chat'])
      })

      it('should extract tag from private channel name', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('private-notifications')],
        }
        const result = generateWebSocket(ctx)

        assert.deepEqual(result.websocket.channels['private-notifications'].tags, ['notifications'])
      })

      it('should extract tag from presence channel name', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('presence-lobby')],
        }
        const result = generateWebSocket(ctx)

        assert.deepEqual(result.websocket.channels['presence-lobby'].tags, ['lobby'])
      })

      it('should filter out parameter placeholders', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('private-:userId')],
        }
        const result = generateWebSocket(ctx)

        // When all parts are filtered out (only :userId remains after removing prefix),
        // tags array should be empty/undefined - no tags containing ':'
        const tags = result.websocket.channels['private-:userId'].tags
        // Either no tags, or tags don't include parameter placeholders
        if (tags && tags.length > 0) {
          assert.equal(tags.some(t => t.startsWith(':')), false)
        }
      })

      it('should include parameters for templated channel names', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('private-:userId')],
        }
        const result = generateWebSocket(ctx)

        assert.ok(result.websocket.channels['private-:userId'].parameters?.userId)
      })
    })

    describe('channel events (subscribe - server to client)', () => {
      it('should generate subscribe message for channels with events', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [
            createMockChannel('chat', {
              events: {
                message: {},
                typing: {},
              },
            }),
          ],
        }
        const result = generateWebSocket(ctx)

        assert.ok(result.websocket.channels['chat'].subscribe)
        assert.ok(result.websocket.channels['chat'].subscribe?.message)
      })

      it('should generate oneOf schema for multiple events', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [
            createMockChannel('chat', {
              events: {
                message: {},
                typing: {},
                read: {},
              },
            }),
          ],
        }
        const result = generateWebSocket(ctx)

        const payload = result.websocket.channels['chat'].subscribe?.message?.payload as any
        assert.ok(payload?.oneOf)
        assert.equal(payload.oneOf.length, 3)
      })

      it('should include event name as const in payload', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [
            createMockChannel('chat', {
              events: {
                message: {},
              },
            }),
          ],
        }
        const result = generateWebSocket(ctx)

        const payload = result.websocket.channels['chat'].subscribe?.message?.payload as any
        const firstEvent = payload.oneOf[0]
        assert.equal(firstEvent.properties.event.const, 'message')
      })

      it('should convert event input schema and register it', () => {
        const messageSchema = z.object({ text: z.string(), sender: z.string() })
        const ctx: WebSocketGeneratorContext = {
          channels: [
            createMockChannel('chat', {
              events: {
                message: { input: messageSchema },
              },
            }),
          ],
        }
        const result = generateWebSocket(ctx)

        // Schema should be registered
        assert.ok(result.schemas['Chat_message_Payload'])
      })
    })

    describe('channel publish (client to server)', () => {
      it('should generate publish message when canPublish is defined', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [
            createMockChannel('chat', {
              events: {
                message: {},
              },
              canPublish: async () => true,
            }),
          ],
        }
        const result = generateWebSocket(ctx)

        assert.ok(result.websocket.channels['chat'].publish)
        assert.ok(result.websocket.channels['chat'].publish?.message)
      })

      it('should not generate publish when canPublish is undefined', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [
            createMockChannel('chat', {
              events: {
                message: {},
              },
            }),
          ],
        }
        const result = generateWebSocket(ctx)

        assert.equal(result.websocket.channels['chat'].publish, undefined)
      })

      it('should include required fields in publish payload', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [
            createMockChannel('chat', {
              events: {
                message: {},
              },
              canPublish: async () => true,
            }),
          ],
        }
        const result = generateWebSocket(ctx)

        const payload = result.websocket.channels['chat'].publish?.message?.payload as any
        const firstEvent = payload.oneOf[0]
        assert.deepEqual(firstEvent.required, ['event', 'data'])
      })

      it('should convert publish event input schema', () => {
        const messageSchema = z.object({ text: z.string() })
        const ctx: WebSocketGeneratorContext = {
          channels: [
            createMockChannel('chat', {
              events: {
                message: { input: messageSchema },
              },
              canPublish: async () => true,
            }),
          ],
        }
        const result = generateWebSocket(ctx)

        const payload = result.websocket.channels['chat'].publish?.message?.payload as any
        const dataSchema = payload.oneOf[0].properties.data
        // Schema should be converted
        assert.ok(dataSchema.type || dataSchema.$ref)
      })
    })

    describe('presence channels', () => {
      it('should add x-usd-presence for presence channels', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('presence-lobby')],
        }
        const result = generateWebSocket(ctx)

        const presence = (result.websocket.channels['presence-lobby'] as any)['x-usd-presence']
        assert.ok(presence)
      })

      it('should include presence events in x-usd-presence', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('presence-lobby')],
        }
        const result = generateWebSocket(ctx)

        const presence = (result.websocket.channels['presence-lobby'] as any)['x-usd-presence']
        assert.deepEqual(presence.events, ['member_added', 'member_removed', 'member_updated'])
      })

      it('should include member schema in x-usd-presence', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('presence-lobby')],
        }
        const result = generateWebSocket(ctx)

        const presence = (result.websocket.channels['presence-lobby'] as any)['x-usd-presence']
        assert.ok(presence.memberSchema)
        assert.equal(presence.memberSchema.type, 'object')
        assert.ok(presence.memberSchema.properties.id)
        assert.ok(presence.memberSchema.properties.userId)
        assert.ok(presence.memberSchema.properties.info)
      })

      it('should not add x-usd-presence for public channels', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('general')],
        }
        const result = generateWebSocket(ctx)

        const presence = (result.websocket.channels['general'] as any)['x-usd-presence']
        assert.equal(presence, undefined)
      })

      it('should not add x-usd-presence for private channels', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [createMockChannel('private-user-123')],
        }
        const result = generateWebSocket(ctx)

        const presence = (result.websocket.channels['private-user-123'] as any)['x-usd-presence']
        assert.equal(presence, undefined)
      })
    })

    describe('protocol events structure', () => {
      it('should have correct subscribe event schema', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx)

        const subscribe = result.websocket.events?.subscribe
        assert.equal(subscribe?.type, 'object')
        assert.ok(subscribe?.properties?.type)
        assert.ok(subscribe?.properties?.channel)
        assert.ok(subscribe?.properties?.id)
        assert.deepEqual(subscribe?.required, ['type', 'channel'])
      })

      it('should have correct publish event schema', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx)

        const publish = result.websocket.events?.publish
        assert.equal(publish?.type, 'object')
        assert.ok(publish?.properties?.type)
        assert.ok(publish?.properties?.channel)
        assert.ok(publish?.properties?.event)
        assert.ok(publish?.properties?.data)
        assert.deepEqual(publish?.required, ['type', 'channel', 'event', 'data'])
      })

      it('should have correct error event schema', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx)

        const error = result.websocket.events?.error
        assert.equal(error?.type, 'object')
        assert.ok(error?.properties?.type)
        assert.ok(error?.properties?.code)
        assert.ok(error?.properties?.status)
        assert.ok(error?.properties?.message)
        assert.deepEqual(error?.required, ['type', 'code', 'message'])
      })

      it('should have correct heartbeat events', () => {
        const ctx: WebSocketGeneratorContext = { channels: [] }
        const result = generateWebSocket(ctx)

        const ping = result.websocket.events?.ping
        const pong = result.websocket.events?.pong
        assert.equal(ping?.properties?.type?.const, 'ping')
        assert.equal(pong?.properties?.type?.const, 'pong')
      })
    })

    describe('with Map input', () => {
      it('should accept Map<string, LoadedChannel>', () => {
        const channelsMap = new Map<string, LoadedChannel>()
        channelsMap.set('chat', createMockChannel('chat'))
        channelsMap.set('notifications', createMockChannel('notifications'))

        const ctx: WebSocketGeneratorContext = { channels: channelsMap }
        const result = generateWebSocket(ctx)

        assert.ok(result.websocket.channels['chat'])
        assert.ok(result.websocket.channels['notifications'])
      })
    })

    describe('multiple channels', () => {
      it('should convert all channels', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [
            createMockChannel('general'),
            createMockChannel('private-user-1'),
            createMockChannel('presence-lobby'),
          ],
        }
        const result = generateWebSocket(ctx)

        assert.equal(Object.keys(result.websocket.channels).length, 3)
        assert.ok(result.websocket.channels['general'])
        assert.ok(result.websocket.channels['private-user-1'])
        assert.ok(result.websocket.channels['presence-lobby'])
      })

      it('should have correct types for all channels', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [
            createMockChannel('general'),
            createMockChannel('private-user-1'),
            createMockChannel('presence-lobby'),
          ],
        }
        const result = generateWebSocket(ctx)

        assert.equal(result.websocket.channels['general'].type, 'public')
        assert.equal(result.websocket.channels['private-user-1'].type, 'private')
        assert.equal(result.websocket.channels['presence-lobby'].type, 'presence')
      })
    })

    describe('schema name sanitization', () => {
      it('should sanitize channel names for schema names', () => {
        const ctx: WebSocketGeneratorContext = {
          channels: [
            createMockChannel('private-user-:id', {
              events: {
                update: { input: z.object({ data: z.string() }) },
              },
            }),
          ],
        }
        const result = generateWebSocket(ctx)

        // Should remove prefix, hyphens, colons, etc.
        const schemaNames = Object.keys(result.schemas)
        // Should be something like PrivateUserId_update_Payload
        assert.ok(schemaNames.some(name => name.includes('update_Payload')))
      })
    })
  })

  describe('generateChannelSchemas', () => {
    it('should extract schemas from channels with events', () => {
      const messageSchema = z.object({ text: z.string() })
      const channels: LoadedChannel[] = [
        createMockChannel('chat', {
          events: {
            message: { input: messageSchema },
          },
        }),
      ]

      const schemas = generateChannelSchemas(channels)

      assert.ok(schemas['Chat_message_Payload'])
    })

    it('should handle Map input', () => {
      const messageSchema = z.object({ text: z.string() })
      const channelsMap = new Map<string, LoadedChannel>()
      channelsMap.set('chat', createMockChannel('chat', {
        events: {
          message: { input: messageSchema },
        },
      }))

      const schemas = generateChannelSchemas(channelsMap)

      assert.ok(schemas['Chat_message_Payload'])
    })

    it('should skip events without input schema', () => {
      const channels: LoadedChannel[] = [
        createMockChannel('chat', {
          events: {
            typing: {}, // no input schema
          },
        }),
      ]

      const schemas = generateChannelSchemas(channels)

      assert.equal(Object.keys(schemas).length, 0)
    })

    it('should handle multiple events from same channel', () => {
      const channels: LoadedChannel[] = [
        createMockChannel('chat', {
          events: {
            message: { input: z.object({ text: z.string() }) },
            typing: { input: z.object({ userId: z.string() }) },
          },
        }),
      ]

      const schemas = generateChannelSchemas(channels)

      assert.ok(schemas['Chat_message_Payload'])
      assert.ok(schemas['Chat_typing_Payload'])
    })

    it('should handle multiple channels', () => {
      const channels: LoadedChannel[] = [
        createMockChannel('chat', {
          events: {
            message: { input: z.object({ text: z.string() }) },
          },
        }),
        createMockChannel('notifications', {
          events: {
            alert: { input: z.object({ level: z.string() }) },
          },
        }),
      ]

      const schemas = generateChannelSchemas(channels)

      assert.ok(schemas['Chat_message_Payload'])
      assert.ok(schemas['Notifications_alert_Payload'])
    })

    it('should return empty object for channels without events', () => {
      const channels: LoadedChannel[] = [
        createMockChannel('empty'),
      ]

      const schemas = generateChannelSchemas(channels)

      assert.deepEqual(schemas, {})
    })
  })

  describe('channel description', () => {
    it('should add description to channel', () => {
      const ctx: WebSocketGeneratorContext = {
        channels: [createMockChannel('chat')],
      }
      const result = generateWebSocket(ctx)

      assert.equal(result.websocket.channels['chat'].description, 'Channel: chat')
    })
  })
})
