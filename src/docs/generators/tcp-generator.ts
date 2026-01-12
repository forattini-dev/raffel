/**
 * TCP Generator for USD
 *
 * Converts Raffel TCP handlers to USD TCP specification (x-usd.tcp).
 */

import type {
  USDTcp,
  USDTcpServer,
  USDTcpFraming,
  USDTcpTls,
  USDMessage,
  USDContentTypes,
  USDSchema,
} from '../../usd/index.js'
import { USD_PROTOCOL_CONTENT_TYPES } from '../../usd/index.js'
import { createSchemaRegistry, type ConvertedSchemaRegistry } from './schema-converter.js'
import { resolveContentTypes } from './content-types.js'

/**
 * TCP handler with optional docs field for rich documentation
 */
export interface TcpHandlerDocs {
  /** Handler summary */
  summary?: string
  /** Handler description */
  description?: string
  /** Content type shorthand */
  contentType?: string
  /** Content type configuration */
  contentTypes?: {
    default?: string
    supported?: string[]
  }
  /** Framing configuration */
  framing?: {
    type: 'length-prefixed' | 'delimiter' | 'fixed' | 'none'
    lengthBytes?: 1 | 2 | 4 | 8
    byteOrder?: 'big-endian' | 'little-endian'
    delimiter?: string
    fixedSize?: number
  }
  /** Zod schema for request messages (will be converted to JSON Schema) */
  requestSchema?: unknown
  /** Zod schema for response messages (will be converted to JSON Schema) */
  responseSchema?: unknown
  /** TLS configuration */
  tls?: {
    enabled: boolean
    cert?: string
    key?: string
    ca?: string
    clientAuth?: boolean
  }
  /** Connection lifecycle */
  lifecycle?: {
    onConnect?: string
    onDisconnect?: string
    keepAlive?: {
      enabled?: boolean
      intervalMs?: number
    }
  }
  /** Tags for grouping */
  tags?: string[]
}

/**
 * Loaded TCP handler from discovery
 */
export interface LoadedTcpHandler {
  /** Handler name */
  name: string
  /** File path */
  filePath: string
  /** TCP server config */
  config: {
    /** Port number */
    port: number
    /** Host address */
    host?: string
    /** TLS enabled */
    tls?: boolean
    /** Optional docs field */
    docs?: TcpHandlerDocs
    /** Connection handler */
    onConnection?: (socket: unknown) => void | Promise<void>
    /** Data handler */
    onData?: (socket: unknown, data: unknown) => void | Promise<void>
    /** Close handler */
    onClose?: (socket: unknown) => void | Promise<void>
  }
}

/**
 * TCP generation options
 */
export interface TcpGeneratorOptions {
  /** Default host if not specified */
  defaultHost?: string
  /** Default framing if not specified */
  defaultFraming?: USDTcpFraming
  /** Default security requirement */
  defaultSecurity?: Array<Record<string, string[]>>
  /** Protocol content types */
  contentTypes?: USDContentTypes
}

/**
 * TCP generation context
 */
export interface TcpGeneratorContext {
  /** Loaded TCP handlers */
  handlers: LoadedTcpHandler[]
}

/**
 * TCP generation result
 */
export interface TcpGeneratorResult {
  /** USD TCP specification */
  tcp: USDTcp
  /** Component schemas used */
  schemas: Record<string, USDSchema>
}

/**
 * Generate USD TCP specification from loaded TCP handlers
 */
export function generateTcp(
  ctx: TcpGeneratorContext,
  options: TcpGeneratorOptions = {}
): TcpGeneratorResult {
  const {
    defaultHost = 'localhost',
    defaultFraming = { type: 'length-prefixed', lengthBytes: 4, byteOrder: 'big-endian' },
    defaultSecurity,
    contentTypes = USD_PROTOCOL_CONTENT_TYPES.tcp,
  } = options
  const protocolContentTypes = contentTypes

  const schemaRegistry = createSchemaRegistry()
  const servers: Record<string, USDTcpServer> = {}

  for (const handler of ctx.handlers) {
    const serverName = sanitizeName(handler.name)
    servers[serverName] = convertTcpHandler(
      handler,
      schemaRegistry,
      defaultHost,
      defaultFraming,
      protocolContentTypes,
      defaultSecurity
    )
  }

  return {
    tcp: {
      contentTypes: protocolContentTypes,
      servers: Object.keys(servers).length > 0 ? servers : undefined,
    },
    schemas: schemaRegistry.toObject(),
  }
}

/**
 * Convert a TCP handler to USD TcpServer
 */
function convertTcpHandler(
  handler: LoadedTcpHandler,
  schemaRegistry: ConvertedSchemaRegistry,
  defaultHost: string,
  defaultFraming: USDTcpFraming,
  protocolContentTypes: USDContentTypes,
  defaultSecurity?: Array<Record<string, string[]>>
): USDTcpServer {
  const { config } = handler
  const docs = config.docs
  const resolvedContentTypes = resolveContentTypes(docs)
  const messageContentType = resolvedContentTypes?.default ?? protocolContentTypes.default

  const server: USDTcpServer = {
    host: config.host ?? defaultHost,
    port: config.port,
  }

  // Add description
  if (docs?.description) {
    server.description = docs.description
  } else if (docs?.summary) {
    server.description = docs.summary
  } else {
    server.description = `TCP server: ${handler.name}`
  }

  // Add TLS configuration
  if (docs?.tls || config.tls) {
    server.tls = convertTls(docs?.tls, config.tls)
  }

  // Add framing configuration
  if (docs?.framing) {
    server.framing = docs.framing
  } else {
    server.framing = defaultFraming
  }

  // Add message schemas
  const messages = convertMessages(handler.name, docs, schemaRegistry, messageContentType)
  if (messages) {
    server.messages = messages
  }

  // Add lifecycle
  if (docs?.lifecycle) {
    server.lifecycle = docs.lifecycle
  }

  // Add tags
  if (docs?.tags && docs.tags.length > 0) {
    server.tags = docs.tags
  } else {
    // Extract tags from handler name
    const tags = extractTags(handler.name)
    if (tags.length > 0) {
      server.tags = tags
    }
  }

  // Add security
  if (defaultSecurity) {
    server.security = defaultSecurity
  }

  if (resolvedContentTypes) {
    server.contentTypes = resolvedContentTypes
  }

  return server
}

/**
 * Convert TLS configuration
 */
function convertTls(
  docs?: TcpHandlerDocs['tls'],
  enabled?: boolean
): USDTcpTls {
  if (docs) {
    return docs
  }

  return {
    enabled: enabled ?? false,
  }
}

/**
 * Convert message schemas
 */
function convertMessages(
  handlerName: string,
  docs: TcpHandlerDocs | undefined,
  schemaRegistry: ConvertedSchemaRegistry,
  contentType?: string
): USDTcpServer['messages'] | undefined {
  if (!docs?.requestSchema && !docs?.responseSchema) {
    return undefined
  }

  const messages: USDTcpServer['messages'] = {}
  const baseName = sanitizeName(handlerName)

  if (docs.requestSchema) {
    const schemaName = `${baseName}Request`
    schemaRegistry.add(schemaName, docs.requestSchema)
    messages.inbound = createMessageRef(schemaName, contentType)
  }

  if (docs.responseSchema) {
    const schemaName = `${baseName}Response`
    schemaRegistry.add(schemaName, docs.responseSchema)
    messages.outbound = createMessageRef(schemaName, contentType)
  }

  return messages
}

function createMessageRef(schemaName: string, contentType?: string): USDMessage {
  return {
    contentType,
    payload: { $ref: `#/components/schemas/${schemaName}` },
  }
}

/**
 * Sanitize handler name for schema naming
 */
function sanitizeName(name: string): string {
  return name
    .replace(/\./g, '_')
    .replace(/-/g, '_')
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

/**
 * Extract tags from handler name
 */
function extractTags(name: string): string[] {
  const parts = name.split('.')
  if (parts.length > 1) {
    return [parts[0]]
  }

  const segments = name.split(/[-_]/)
  if (segments.length > 1) {
    return [segments[0]]
  }

  return []
}

/**
 * Helper to create a TCP server definition for manual configuration
 */
export function createTcpServerConfig(options: {
  name: string
  port: number
  host?: string
  description?: string
  contentType?: string
  contentTypes?: TcpHandlerDocs['contentTypes']
  framing?: USDTcpFraming
  requestSchema?: unknown
  responseSchema?: unknown
  tls?: boolean
  tags?: string[]
}): LoadedTcpHandler {
  return {
    name: options.name,
    filePath: `<manual>/${options.name}.ts`,
    config: {
      port: options.port,
      host: options.host,
      tls: options.tls,
      docs: {
        description: options.description,
        contentType: options.contentType,
        contentTypes: options.contentTypes,
        framing: options.framing,
        requestSchema: options.requestSchema,
        responseSchema: options.responseSchema,
        tags: options.tags,
      },
    },
  }
}

/**
 * Generate standard TCP schemas for common patterns
 */
export function generateTcpSchemas(): Record<string, USDSchema> {
  return {
    TcpLengthPrefixedFrame: {
      type: 'object',
      description: 'Length-prefixed binary frame',
      properties: {
        length: { type: 'integer', description: 'Message length in bytes' },
        payload: { type: 'string', format: 'binary', description: 'Message payload' },
      },
      required: ['length', 'payload'],
    },
    TcpDelimitedFrame: {
      type: 'object',
      description: 'Delimiter-separated frame (typically newline)',
      properties: {
        data: { type: 'string', description: 'Frame data (excluding delimiter)' },
      },
      required: ['data'],
    },
    TcpHandshake: {
      type: 'object',
      description: 'Standard TCP handshake message',
      properties: {
        version: { type: 'string', description: 'Protocol version' },
        clientId: { type: 'string', description: 'Client identifier' },
        timestamp: { type: 'integer', description: 'Unix timestamp' },
        auth: {
          type: 'object',
          description: 'Authentication data',
          properties: {
            token: { type: 'string' },
            signature: { type: 'string' },
          },
        },
      },
      required: ['version'],
    },
    TcpHeartbeat: {
      type: 'object',
      description: 'Keep-alive heartbeat message',
      properties: {
        timestamp: { type: 'integer', description: 'Unix timestamp' },
        sequence: { type: 'integer', description: 'Sequence number' },
      },
    },
  }
}
