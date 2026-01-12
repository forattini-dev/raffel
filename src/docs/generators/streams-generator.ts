/**
 * Streams Generator for USD
 *
 * Converts Raffel streams to USD Streams specification (x-usd.streams).
 */

import type {
  USDStreams,
  USDStreamEndpoint,
  USDStreamDirection,
  USDSchema,
  USDMessage,
  USDContentTypes,
} from '../../usd/index.js'
import { USD_PROTOCOL_CONTENT_TYPES } from '../../usd/index.js'
import type { Registry } from '../../core/registry.js'
import type { SchemaRegistry, HandlerSchema } from '../../validation/index.js'
import type { StreamDirection, HandlerMeta } from '../../types/index.js'
import { createSchemaRegistry, type ConvertedSchemaRegistry } from './schema-converter.js'
import { resolveContentTypes } from './content-types.js'

/**
 * Streams generation options
 */
export interface StreamsGeneratorOptions {
  /** Include backpressure metadata */
  includeBackpressure?: boolean
  /** Default security requirement */
  defaultSecurity?: Array<Record<string, string[]>>
  /** Protocol content types */
  contentTypes?: USDContentTypes
}

/**
 * Streams generation context
 */
export interface StreamsGeneratorContext {
  /** Handler registry */
  registry: Registry
  /** Schema registry for input/output schemas */
  schemaRegistry?: SchemaRegistry
}

/**
 * Streams generation result
 */
export interface StreamsGeneratorResult {
  /** USD Streams specification */
  streams: USDStreams
  /** Component schemas used */
  schemas: Record<string, USDSchema>
}

/**
 * Generate USD Streams specification from registered streams
 */
export function generateStreams(
  ctx: StreamsGeneratorContext,
  options: StreamsGeneratorOptions = {}
): StreamsGeneratorResult {
  const {
    includeBackpressure = true,
    defaultSecurity,
    contentTypes = USD_PROTOCOL_CONTENT_TYPES.streams,
  } = options
  const protocolContentTypes = contentTypes

  const schemaRegistry = createSchemaRegistry()
  const endpoints: Record<string, USDStreamEndpoint> = {}

  // Convert registered streams
  for (const meta of ctx.registry.listStreams()) {
    const handlerSchema = ctx.schemaRegistry?.get(meta.name)
    const direction = convertDirection(meta.streamDirection)

    endpoints[meta.name] = convertStreamEndpoint(
      meta,
      handlerSchema,
      direction,
      schemaRegistry,
      includeBackpressure,
      protocolContentTypes,
      defaultSecurity
    )
  }

  return {
    streams: {
      contentTypes: protocolContentTypes,
      endpoints: Object.keys(endpoints).length > 0 ? endpoints : undefined,
    },
    schemas: schemaRegistry.toObject(),
  }
}

/**
 * Convert a stream handler to USD StreamEndpoint
 */
function convertStreamEndpoint(
  meta: HandlerMeta,
  handlerSchema: HandlerSchema | undefined,
  direction: USDStreamDirection,
  schemaRegistry: ConvertedSchemaRegistry,
  includeBackpressure: boolean,
  protocolContentTypes: USDContentTypes,
  defaultSecurity?: Array<Record<string, string[]>>
): USDStreamEndpoint {
  const resolvedContentTypes = resolveContentTypes(meta)
  const messageContentType = resolvedContentTypes?.default ?? protocolContentTypes.default

  const endpoint: USDStreamEndpoint = {
    description: meta.description ?? `Stream: ${meta.name}`,
    direction,
    message: createStreamMessage(meta.name, handlerSchema, schemaRegistry, direction, messageContentType),
  }

  if (resolvedContentTypes) {
    endpoint.contentTypes = resolvedContentTypes
  }

  // Add tags based on stream name
  const tags = extractStreamTags(meta.name)
  if (tags.length > 0) {
    endpoint.tags = tags
  }

  // Add security if provided
  if (defaultSecurity) {
    endpoint.security = defaultSecurity
  }

  // Add backpressure indicator for bidirectional streams
  if (includeBackpressure && direction === 'bidirectional') {
    endpoint['x-usd-backpressure'] = true
  }

  return endpoint
}

/**
 * Create stream message schema
 */
function createStreamMessage(
  name: string,
  handlerSchema: HandlerSchema | undefined,
  schemaRegistry: ConvertedSchemaRegistry,
  direction: USDStreamDirection,
  contentType?: string
): USDMessage {
  const message: USDMessage = {
    name: `${sanitizeSchemaName(name)}Message`,
    contentType: contentType ?? USD_PROTOCOL_CONTENT_TYPES.streams.default ?? 'application/json',
  }

  // Determine which schema to use based on direction
  if (direction === 'server-to-client' && handlerSchema?.output) {
    // Server sends, use output schema
    const schemaName = `${sanitizeSchemaName(name)}_Output`
    schemaRegistry.add(schemaName, handlerSchema.output)
    message.payload = { $ref: `#/components/schemas/${schemaName}` }
    message.summary = 'Server-sent message'
  } else if (direction === 'client-to-server' && handlerSchema?.input) {
    // Client sends, use input schema
    const schemaName = `${sanitizeSchemaName(name)}_Input`
    schemaRegistry.add(schemaName, handlerSchema.input)
    message.payload = { $ref: `#/components/schemas/${schemaName}` }
    message.summary = 'Client-sent message'
  } else if (direction === 'bidirectional') {
    // Bidirectional: create combined schema with both input and output
    message.summary = 'Bidirectional message'
    message.description = 'Messages can flow in both directions'

    if (handlerSchema?.input && handlerSchema?.output) {
      // Create a oneOf schema for bidirectional streams
      const inputName = `${sanitizeSchemaName(name)}_ClientMessage`
      const outputName = `${sanitizeSchemaName(name)}_ServerMessage`

      schemaRegistry.add(inputName, handlerSchema.input)
      schemaRegistry.add(outputName, handlerSchema.output)

      // For bidirectional, we typically use the output schema as the main payload
      // since that's what clients will receive
      message.payload = { $ref: `#/components/schemas/${outputName}` }
    } else if (handlerSchema?.output) {
      const schemaName = `${sanitizeSchemaName(name)}_Message`
      schemaRegistry.add(schemaName, handlerSchema.output)
      message.payload = { $ref: `#/components/schemas/${schemaName}` }
    } else if (handlerSchema?.input) {
      const schemaName = `${sanitizeSchemaName(name)}_Message`
      schemaRegistry.add(schemaName, handlerSchema.input)
      message.payload = { $ref: `#/components/schemas/${schemaName}` }
    }
  }

  // Default to generic object if no schema
  if (!message.payload) {
    message.payload = { type: 'object' }
  }

  return message
}

/**
 * Convert Raffel StreamDirection to USD StreamDirection
 */
function convertDirection(direction?: StreamDirection): USDStreamDirection {
  switch (direction) {
    case 'server':
      return 'server-to-client'
    case 'client':
      return 'client-to-server'
    case 'bidi':
      return 'bidirectional'
    default:
      // Default to server-to-client (SSE-style)
      return 'server-to-client'
  }
}

/**
 * Extract tags from stream name
 */
function extractStreamTags(name: string): string[] {
  // Split by . and take first part as tag
  const parts = name.split('.')
  if (parts.length > 1) {
    return [parts[0]]
  }

  // Split by - or _ and take first part
  const segments = name.split(/[-_]/)
  if (segments.length > 1) {
    return [segments[0]]
  }

  return []
}

/**
 * Sanitize stream name for schema naming
 */
function sanitizeSchemaName(name: string): string {
  return name
    .replace(/\./g, '_')
    .replace(/-/g, '_')
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

/**
 * Helper to create an SSE stream definition for manual configuration
 */
export function createSSEStreamConfig(options: {
  name: string
  description?: string
  eventSchema?: unknown
  inputSchema?: unknown
  tags?: string[]
}): { name: string; meta: Partial<HandlerMeta>; schema: Partial<HandlerSchema> } {
  return {
    name: options.name,
    meta: {
      kind: 'stream',
      name: options.name,
      description: options.description ?? `SSE Stream: ${options.name}`,
      streamDirection: 'server',
    },
    schema: {
      output: options.eventSchema,
      input: options.inputSchema,
    },
  }
}

/**
 * Helper to create a bidirectional stream definition for manual configuration
 */
export function createBidiStreamConfig(options: {
  name: string
  description?: string
  clientMessageSchema?: unknown
  serverMessageSchema?: unknown
  tags?: string[]
}): { name: string; meta: Partial<HandlerMeta>; schema: Partial<HandlerSchema> } {
  return {
    name: options.name,
    meta: {
      kind: 'stream',
      name: options.name,
      description: options.description ?? `Bidirectional Stream: ${options.name}`,
      streamDirection: 'bidi',
    },
    schema: {
      input: options.clientMessageSchema,
      output: options.serverMessageSchema,
    },
  }
}

/**
 * Generate stream auth security schemes
 *
 * Documents the available authentication methods for SSE/fetch streams:
 * - Cookie session: Automatic with EventSource, uses session cookie
 * - Bearer token (query): For EventSource, token in ?token= param
 * - Bearer token (header): For fetch API streams, Authorization header
 * - API key (query): For EventSource, key in ?apiKey= param
 */
export function generateStreamAuthSchemes(): Record<string, import('../../usd/index.js').USDSecurityScheme> {
  return {
    StreamCookieSession: {
      type: 'apiKey',
      name: 'session',
      in: 'cookie',
      description: 'Cookie-based session authentication. Works automatically with EventSource. Use cookieSession() middleware to enable.',
      'x-usd-streams': {
        in: ['cookie'],
        name: 'session',
        description: 'Session cookie is sent automatically by browsers with EventSource requests. Use ctx.auth.user in stream handlers to access authenticated user.',
      },
    },
    StreamBearerToken: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Bearer token authentication for streams. Can be passed via Authorization header (fetch API) or query parameter (EventSource).',
      'x-usd-streams': {
        in: ['header', 'query'],
        name: 'token',
        description: 'For EventSource: append ?token=<JWT> to stream URL. For fetch API: use Authorization: Bearer <JWT> header.',
      },
    },
    StreamApiKey: {
      type: 'apiKey',
      name: 'apiKey',
      in: 'query',
      description: 'API key authentication for streams. Pass key as query parameter for EventSource compatibility.',
      'x-usd-streams': {
        in: ['query', 'header'],
        name: 'apiKey',
        description: 'For EventSource: append ?apiKey=<KEY> to stream URL. For fetch API: use X-API-Key header or query param.',
      },
    },
  }
}

/**
 * Generate standard stream events for SSE compatibility
 */
export function generateStreamEvents(): Record<string, USDSchema> {
  return {
    StreamData: {
      type: 'object',
      description: 'Standard data event for SSE streams',
      properties: {
        id: { type: 'string', description: 'Event ID for resumption' },
        event: { type: 'string', description: 'Event type/name' },
        data: { description: 'Event payload' },
        retry: { type: 'integer', description: 'Reconnection time in milliseconds' },
      },
      required: ['data'],
    },
    StreamError: {
      type: 'object',
      description: 'Stream error event',
      properties: {
        code: { type: 'string', description: 'Error code' },
        message: { type: 'string', description: 'Error message' },
        fatal: { type: 'boolean', description: 'Whether error terminates the stream' },
      },
      required: ['code', 'message'],
    },
    StreamEnd: {
      type: 'object',
      description: 'Stream end event',
      properties: {
        reason: { type: 'string', description: 'End reason' },
        stats: {
          type: 'object',
          description: 'Stream statistics',
          properties: {
            messageCount: { type: 'integer' },
            duration: { type: 'integer', description: 'Duration in milliseconds' },
          },
        },
      },
    },
  }
}
