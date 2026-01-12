/**
 * UDP Generator for USD
 *
 * Converts Raffel UDP handlers to USD UDP specification (x-usd.udp).
 */

import type {
  USDUdp,
  USDUdpEndpoint,
  USDMessage,
  USDContentTypes,
  USDSchema,
} from '../../usd/index.js'
import { USD_PROTOCOL_CONTENT_TYPES } from '../../usd/index.js'
import { createSchemaRegistry, type ConvertedSchemaRegistry } from './schema-converter.js'
import { resolveContentTypes } from './content-types.js'

/**
 * UDP handler with optional docs field for rich documentation
 */
export interface UdpHandlerDocs {
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
  /** Maximum packet size in bytes (max 65507) */
  maxPacketSize?: number
  /** Zod schema for messages (will be converted to JSON Schema) */
  messageSchema?: unknown
  /** Zod schema for inbound messages (will be converted to JSON Schema) */
  inboundSchema?: unknown
  /** Zod schema for outbound messages (will be converted to JSON Schema) */
  outboundSchema?: unknown
  /** Multicast configuration */
  multicast?: {
    enabled: boolean
    group?: string
    ttl?: number
  }
  /** Reliability configuration */
  reliability?: {
    checksumValidation?: boolean
    duplicateDetection?: boolean
  }
  /** Tags for grouping */
  tags?: string[]
}

/**
 * Loaded UDP handler from discovery
 */
export interface LoadedUdpHandler {
  /** Handler name */
  name: string
  /** File path */
  filePath: string
  /** UDP endpoint config */
  config: {
    /** Port number */
    port: number
    /** Host address */
    host?: string
    /** Optional docs field */
    docs?: UdpHandlerDocs
    /** Message handler */
    onMessage?: (data: unknown, rinfo: unknown) => void | Promise<void>
  }
}

/**
 * UDP generation options
 */
export interface UdpGeneratorOptions {
  /** Default host if not specified */
  defaultHost?: string
  /** Default max packet size */
  defaultMaxPacketSize?: number
  /** Default security requirement */
  defaultSecurity?: Array<Record<string, string[]>>
  /** Protocol content types */
  contentTypes?: USDContentTypes
}

/**
 * UDP generation context
 */
export interface UdpGeneratorContext {
  /** Loaded UDP handlers */
  handlers: LoadedUdpHandler[]
}

/**
 * UDP generation result
 */
export interface UdpGeneratorResult {
  /** USD UDP specification */
  udp: USDUdp
  /** Component schemas used */
  schemas: Record<string, USDSchema>
}

/**
 * Generate USD UDP specification from loaded UDP handlers
 */
export function generateUdp(
  ctx: UdpGeneratorContext,
  options: UdpGeneratorOptions = {}
): UdpGeneratorResult {
  const {
    defaultHost = '0.0.0.0',
    defaultMaxPacketSize = 65507,
    defaultSecurity,
    contentTypes = USD_PROTOCOL_CONTENT_TYPES.udp,
  } = options
  const protocolContentTypes = contentTypes

  const schemaRegistry = createSchemaRegistry()
  const endpoints: Record<string, USDUdpEndpoint> = {}

  for (const handler of ctx.handlers) {
    const endpointName = sanitizeName(handler.name)
    endpoints[endpointName] = convertUdpHandler(
      handler,
      schemaRegistry,
      defaultHost,
      defaultMaxPacketSize,
      protocolContentTypes,
      defaultSecurity
    )
  }

  return {
    udp: {
      contentTypes: protocolContentTypes,
      endpoints: Object.keys(endpoints).length > 0 ? endpoints : undefined,
    },
    schemas: schemaRegistry.toObject(),
  }
}

/**
 * Convert a UDP handler to USD UdpEndpoint
 */
function convertUdpHandler(
  handler: LoadedUdpHandler,
  schemaRegistry: ConvertedSchemaRegistry,
  defaultHost: string,
  defaultMaxPacketSize: number,
  protocolContentTypes: USDContentTypes,
  defaultSecurity?: Array<Record<string, string[]>>
): USDUdpEndpoint {
  const { config } = handler
  const docs = config.docs
  const resolvedContentTypes = resolveContentTypes(docs)
  const messageContentType = resolvedContentTypes?.default ?? protocolContentTypes.default

  const endpoint: USDUdpEndpoint = {
    host: config.host ?? defaultHost,
    port: config.port,
  }

  // Add description
  if (docs?.description) {
    endpoint.description = docs.description
  } else if (docs?.summary) {
    endpoint.description = docs.summary
  } else {
    endpoint.description = `UDP endpoint: ${handler.name}`
  }

  // Add max packet size
  endpoint.maxPacketSize = docs?.maxPacketSize ?? defaultMaxPacketSize

  // Add multicast configuration
  if (docs?.multicast) {
    endpoint.multicast = docs.multicast
  }

  // Add message schema
  const inboundSchema = docs?.inboundSchema ?? docs?.messageSchema
  const outboundSchema = docs?.outboundSchema
  const baseName = sanitizeName(handler.name)

  if (inboundSchema || outboundSchema) {
    endpoint.messages = {}
  }

  if (inboundSchema) {
    const schemaName = docs?.inboundSchema ? `${baseName}Inbound` : `${baseName}Message`
    schemaRegistry.add(schemaName, inboundSchema)
    endpoint.messages!.inbound = createMessageRef(schemaName, messageContentType)
    if (docs?.messageSchema && !docs?.inboundSchema) {
      endpoint.message = createMessageRef(schemaName, messageContentType)
    }
  }

  if (outboundSchema) {
    const schemaName = `${baseName}Outbound`
    schemaRegistry.add(schemaName, outboundSchema)
    endpoint.messages!.outbound = createMessageRef(schemaName, messageContentType)
  }

  // Add reliability configuration
  if (docs?.reliability) {
    endpoint.reliability = docs.reliability
  }

  // Add tags
  if (docs?.tags && docs.tags.length > 0) {
    endpoint.tags = docs.tags
  } else {
    // Extract tags from handler name
    const tags = extractTags(handler.name)
    if (tags.length > 0) {
      endpoint.tags = tags
    }
  }

  // Add security
  if (defaultSecurity) {
    endpoint.security = defaultSecurity
  }

  if (resolvedContentTypes) {
    endpoint.contentTypes = resolvedContentTypes
  }

  return endpoint
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

function createMessageRef(schemaName: string, contentType?: string): USDMessage {
  return {
    contentType,
    payload: { $ref: `#/components/schemas/${schemaName}` },
  }
}

/**
 * Helper to create a UDP endpoint definition for manual configuration
 */
export function createUdpEndpointConfig(options: {
  name: string
  port: number
  host?: string
  description?: string
  contentType?: string
  contentTypes?: UdpHandlerDocs['contentTypes']
  messageSchema?: unknown
  inboundSchema?: unknown
  outboundSchema?: unknown
  maxPacketSize?: number
  multicast?: UdpHandlerDocs['multicast']
  reliability?: UdpHandlerDocs['reliability']
  tags?: string[]
}): LoadedUdpHandler {
  return {
    name: options.name,
    filePath: `<manual>/${options.name}.ts`,
    config: {
      port: options.port,
      host: options.host,
      docs: {
        description: options.description,
        contentType: options.contentType,
        contentTypes: options.contentTypes,
        messageSchema: options.messageSchema,
        inboundSchema: options.inboundSchema,
        outboundSchema: options.outboundSchema,
        maxPacketSize: options.maxPacketSize,
        multicast: options.multicast,
        reliability: options.reliability,
        tags: options.tags,
      },
    },
  }
}

/**
 * Generate standard UDP schemas for common patterns
 */
export function generateUdpSchemas(): Record<string, USDSchema> {
  return {
    UdpDatagram: {
      type: 'object',
      description: 'Generic UDP datagram',
      properties: {
        data: { type: 'string', format: 'binary', description: 'Datagram payload' },
        sourceAddress: { type: 'string', description: 'Source IP address' },
        sourcePort: { type: 'integer', description: 'Source port' },
      },
      required: ['data'],
    },
    StatsDMetric: {
      type: 'object',
      description: 'StatsD-format metric',
      properties: {
        metric: { type: 'string', description: 'Metric name' },
        value: { type: 'number', description: 'Metric value' },
        type: {
          type: 'string',
          enum: ['counter', 'gauge', 'timer', 'histogram', 'set'],
          description: 'Metric type',
        },
        sampleRate: { type: 'number', description: 'Sample rate (0-1)' },
        tags: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Metric tags',
        },
      },
      required: ['metric', 'value', 'type'],
    },
    SyslogMessage: {
      type: 'object',
      description: 'Syslog UDP message (RFC 5424)',
      properties: {
        facility: { type: 'integer', minimum: 0, maximum: 23 },
        severity: { type: 'integer', minimum: 0, maximum: 7 },
        timestamp: { type: 'string', format: 'date-time' },
        hostname: { type: 'string' },
        appName: { type: 'string' },
        procId: { type: 'string' },
        msgId: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['facility', 'severity', 'message'],
    },
    DnsQuery: {
      type: 'object',
      description: 'DNS query message',
      properties: {
        id: { type: 'integer', description: 'Query ID' },
        query: { type: 'string', description: 'Domain name to query' },
        type: {
          type: 'string',
          enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'PTR', 'SRV'],
          description: 'Record type',
        },
      },
      required: ['id', 'query', 'type'],
    },
    DiscoveryBeacon: {
      type: 'object',
      description: 'Service discovery beacon',
      properties: {
        serviceId: { type: 'string', description: 'Unique service identifier' },
        serviceName: { type: 'string', description: 'Human-readable service name' },
        version: { type: 'string', description: 'Service version' },
        address: { type: 'string', description: 'Service address' },
        port: { type: 'integer', description: 'Service port' },
        metadata: {
          type: 'object',
          additionalProperties: true,
          description: 'Additional service metadata',
        },
        ttl: { type: 'integer', description: 'Time-to-live in seconds' },
      },
      required: ['serviceId', 'serviceName', 'address', 'port'],
    },
  }
}
