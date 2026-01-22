/**
 * WebSocket Generator for USD
 *
 * Converts Raffel channels to USD WebSocket specification (x-usd.websocket).
 */

import type { USDWebSocket, USDChannel, USDChannelType, USDSchema, USDContentTypes } from '../../usd/index.js'
import { USD_PROTOCOL_CONTENT_TYPES } from '../../usd/index.js'
import type { LoadedChannel } from '../../server/fs-routes/index.js'
import { convertSchema, createSchemaRegistry, type ConvertedSchemaRegistry } from './schema-converter.js'

/**
 * WebSocket generation options
 */
export interface WebSocketGeneratorOptions {
  /** WebSocket endpoint path */
  path?: string
  /** Protocol content types */
  contentTypes?: USDContentTypes
  /** Include protocol documentation */
  includeProtocol?: boolean
  /** Include authentication info */
  includeAuthentication?: boolean
  /** Authentication location */
  authIn?: 'query' | 'header' | 'cookie'
  /** Authentication parameter name */
  authName?: string
}

/**
 * WebSocket generation context
 */
export interface WebSocketGeneratorContext {
  /** Loaded channels from discovery or manual registration */
  channels: Map<string, LoadedChannel> | LoadedChannel[]
}

/**
 * WebSocket generation result
 */
export interface WebSocketGeneratorResult {
  /** USD WebSocket specification */
  websocket: USDWebSocket
  /** Component schemas used */
  schemas: Record<string, USDSchema>
}

/**
 * Generate USD WebSocket specification from channels
 */
export function generateWebSocket(
  ctx: WebSocketGeneratorContext,
  options: WebSocketGeneratorOptions = {}
): WebSocketGeneratorResult {
  const {
    path = '/ws',
    contentTypes = USD_PROTOCOL_CONTENT_TYPES.websocket,
    includeProtocol = true,
    includeAuthentication = true,
    authIn = 'query',
    authName = 'token',
  } = options

  const schemaRegistry = createSchemaRegistry()
  const channels: Record<string, USDChannel> = {}

  // Convert channels (Map or Array)
  const channelList = ctx.channels instanceof Map
    ? Array.from(ctx.channels.values())
    : ctx.channels

  for (const channel of channelList) {
    channels[channel.name] = convertChannel(channel, schemaRegistry)
  }

  const websocket: USDWebSocket = {
    path,
    channels,
    contentTypes,
  }

  // Add authentication info
  if (includeAuthentication) {
    websocket.authentication = {
      in: authIn,
      name: authName,
      description: 'Authentication token for private and presence channels',
    }
  }

  // Add events (protocol messages)
  if (includeProtocol) {
    websocket.events = createProtocolEvents()
  }

  return {
    websocket,
    schemas: schemaRegistry.toObject(),
  }
}

/**
 * Convert a LoadedChannel to USD Channel
 */
function convertChannel(
  channel: LoadedChannel,
  schemaRegistry: ConvertedSchemaRegistry
): USDChannel {
  // Use explicit type if provided, otherwise infer from channel name
  const type = channel.type ?? inferChannelType(channel.name)

  const usdChannel: USDChannel = {
    type,
    // Use explicit description if provided, otherwise generate from name
    description: channel.description ?? `Channel: ${channel.name}`,
  }

  // Use explicit tags if provided, otherwise extract from channel name
  const tags = channel.tags ?? extractChannelTags(channel.name)
  if (tags.length > 0) {
    usdChannel.tags = tags
  }

  const params = extractChannelParameters(channel.name)
  if (params.length > 0) {
    usdChannel.parameters = Object.fromEntries(
      params.map((param) => [
        param,
        {
          description: `Channel parameter: ${param}`,
          required: true,
          schema: { type: 'string' },
        },
      ])
    )
  }

  // Process events (subscribe operations - server to client)
  if (channel.config.events) {
    const subscribe: Record<string, { summary: string; message?: { payload?: USDSchema } }> = {}

    for (const [eventName, eventConfig] of Object.entries(channel.config.events)) {
      const message: { payload?: USDSchema } = {}

      if (eventConfig.input) {
        const schemaName = `${sanitizeSchemaName(channel.name)}_${eventName}_Payload`
        schemaRegistry.add(schemaName, eventConfig.input)
        message.payload = { $ref: `#/components/schemas/${schemaName}` }
      }

      subscribe[eventName] = {
        summary: `${eventName} event`,
        message: Object.keys(message).length > 0 ? message : undefined,
      }
    }

    if (Object.keys(subscribe).length > 0) {
      usdChannel.subscribe = {
        message: {
          summary: 'Server events',
          payload: {
            oneOf: Object.entries(subscribe).map(([name, config]) => ({
              type: 'object',
              properties: {
                event: { const: name },
                data: config.message?.payload ?? { type: 'object' },
              },
            })),
          } as USDSchema,
        },
      }
    }
  }

  // Process publish operations (client to server)
  if (channel.config.events && channel.config.canPublish) {
    const publishable = Object.keys(channel.config.events)
    if (publishable.length > 0) {
      usdChannel.publish = {
        message: {
          summary: 'Client messages',
          payload: {
            oneOf: publishable.map((eventName) => {
              const eventConfig = channel.config.events![eventName]
              return {
                type: 'object',
                properties: {
                  event: { const: eventName },
                  data: eventConfig.input
                    ? convertSchema(eventConfig.input)
                    : { type: 'object' },
                },
                required: ['event', 'data'],
              }
            }),
          } as USDSchema,
        },
      }
    }
  }

  // Add presence configuration for presence channels
  if (type === 'presence') {
    usdChannel['x-usd-presence'] = {
      events: ['member_added', 'member_removed', 'member_updated'],
      memberSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Connection ID' },
          userId: { type: 'string', description: 'User ID' },
          info: { type: 'object', description: 'Custom member data' },
        },
      },
    }
  }

  return usdChannel
}

/**
 * Create protocol events for USD WebSocket
 */
function createProtocolEvents(): Record<string, USDSchema> {
  return {
    subscribe: {
      type: 'object',
      description: 'Subscribe to a channel',
      properties: {
        type: { const: 'subscribe' },
        channel: { type: 'string', description: 'Channel name' },
        id: { type: 'string', description: 'Request ID for correlation' },
      },
      required: ['type', 'channel'],
    },
    subscribed: {
      type: 'object',
      description: 'Subscription confirmed',
      properties: {
        type: { const: 'subscribed' },
        channel: { type: 'string' },
        id: { type: 'string' },
        members: { type: 'array', description: 'Current members (presence channels)' },
      },
      required: ['type', 'channel'],
    },
    unsubscribe: {
      type: 'object',
      description: 'Unsubscribe from a channel',
      properties: {
        type: { const: 'unsubscribe' },
        channel: { type: 'string' },
        id: { type: 'string' },
      },
      required: ['type', 'channel'],
    },
    unsubscribed: {
      type: 'object',
      description: 'Unsubscription confirmed',
      properties: {
        type: { const: 'unsubscribed' },
        channel: { type: 'string' },
        id: { type: 'string' },
      },
      required: ['type', 'channel'],
    },
    publish: {
      type: 'object',
      description: 'Publish a message to a channel',
      properties: {
        type: { const: 'publish' },
        channel: { type: 'string' },
        event: { type: 'string', description: 'Event name' },
        data: { description: 'Event payload' },
        id: { type: 'string' },
      },
      required: ['type', 'channel', 'event', 'data'],
    },
    message: {
      type: 'object',
      description: 'Message from a channel',
      properties: {
        type: { const: 'message' },
        channel: { type: 'string' },
        event: { type: 'string' },
        data: { description: 'Event payload' },
      },
      required: ['type', 'channel', 'event', 'data'],
    },
    error: {
      type: 'object',
      description: 'Error response',
      properties: {
        type: { const: 'error' },
        id: { type: 'string' },
        code: { type: 'string' },
        status: { type: 'integer' },
        message: { type: 'string' },
      },
      required: ['type', 'code', 'message'],
    },
    ping: {
      type: 'object',
      description: 'Heartbeat ping',
      properties: {
        type: { const: 'ping' },
      },
      required: ['type'],
    },
    pong: {
      type: 'object',
      description: 'Heartbeat pong',
      properties: {
        type: { const: 'pong' },
      },
      required: ['type'],
    },
  }
}

/**
 * Infer channel type from name prefix
 */
function inferChannelType(name: string): USDChannelType {
  if (name.startsWith('presence-')) return 'presence'
  if (name.startsWith('private-')) return 'private'
  return 'public'
}

/**
 * Extract tags from channel name
 */
function extractChannelTags(name: string): string[] {
  // Remove prefix
  const withoutPrefix = name
    .replace(/^presence-/, '')
    .replace(/^private-/, '')

  // Split by - or _ and filter out parameter placeholders
  const parts = withoutPrefix
    .split(/[-_]/)
    .filter((p) => !p.startsWith(':') && !p.startsWith('{') && p.length > 0)

  // Take first part as tag
  if (parts.length > 0) {
    return [parts[0]]
  }

  return []
}

function extractChannelParameters(name: string): string[] {
  const withoutPrefix = name
    .replace(/^presence-/, '')
    .replace(/^private-/, '')

  const params: string[] = []
  const braceMatches = withoutPrefix.match(/\{([^}]+)\}/g) || []
  for (const match of braceMatches) {
    params.push(match.slice(1, -1))
  }

  const colonMatches = withoutPrefix.match(/:([a-zA-Z0-9_]+)/g) || []
  for (const match of colonMatches) {
    params.push(match.slice(1))
  }

  return Array.from(new Set(params))
}

/**
 * Sanitize channel name for schema naming
 */
function sanitizeSchemaName(name: string): string {
  return name
    .replace(/^presence-/, 'Presence')
    .replace(/^private-/, 'Private')
    .replace(/-/g, '_')
    .replace(/:/g, '')
    .replace(/\{|\}/g, '')
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

/**
 * Generate channel component schemas for reuse
 */
export function generateChannelSchemas(
  channels: Map<string, LoadedChannel> | LoadedChannel[]
): Record<string, USDSchema> {
  const schemaRegistry = createSchemaRegistry()
  const channelList = channels instanceof Map
    ? Array.from(channels.values())
    : channels

  for (const channel of channelList) {
    if (channel.config.events) {
      for (const [eventName, eventConfig] of Object.entries(channel.config.events)) {
        if (eventConfig.input) {
          const schemaName = `${sanitizeSchemaName(channel.name)}_${eventName}_Payload`
          schemaRegistry.add(schemaName, eventConfig.input)
        }
      }
    }
  }

  return schemaRegistry.toObject()
}
