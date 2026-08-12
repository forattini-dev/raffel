/**
 * USD Generator - Main Orchestrator
 *
 * Generates complete USD (Universal Service Documentation) documents
 * by coordinating all protocol-specific sub-generators.
 *
 * USD extends OpenAPI 3.1 with an x-usd namespace for multi-protocol support.
 */

import type {
  USDDocument,
  USDInfo,
  USDServer,
  USDTag,
  USDTagGroup,
  USDSchema,
  USDProtocol,
  USDComponents,
  USDSecurityScheme,
  USDExternalDocs,
  USDContentTypes,
  USDDocumentation,
  USDPathItem,
  USDParameter,
  USDResponse,
  USDRequestBody,
  USDExample,
  USDAuthentication,
} from '../../usd/index.js'
import { DEFAULT_USD_CONTENT_TYPES } from '../../usd/index.js'
import type { Registry } from '../../core/registry.js'
import type { SchemaRegistry } from '../../validation/index.js'
import type { LoadedChannel, LoadedGraphQLResource, LoadedRestResource } from '../../server/fs-routes/index.js'

import { generateHttpPaths, type HttpGeneratorOptions } from './http-generator.js'
import { generateWebSocket, type WebSocketGeneratorOptions } from './websocket-generator.js'
import { generateStreams, type StreamsGeneratorOptions, generateStreamEvents, generateStreamAuthSchemes } from './streams-generator.js'
import { generateTcp, generateTcpSchemas, type TcpGeneratorOptions, type LoadedTcpHandler } from './tcp-generator.js'
import { generateUdp, generateUdpSchemas, type UdpGeneratorOptions, type LoadedUdpHandler } from './udp-generator.js'
import { generateJsonRpc, type JsonRpcGeneratorOptions } from './jsonrpc-generator.js'
import { generateGrpc, type GrpcGeneratorOptions } from './grpc-generator.js'
import { generateGraphQL, type GraphQLGeneratorOptions } from './graphql-generator.js'
import { createUSDAssemblyContext } from './usd-assembly-context.js'

// =============================================================================
// Types
// =============================================================================

/**
 * USD generation options
 */
export interface USDGeneratorOptions {
  /** API information */
  info: {
    title: string
    version: string
    description?: string
    termsOfService?: string
    contact?: {
      name?: string
      url?: string
      email?: string
    }
    license?: {
      name: string
      url?: string
      identifier?: string
    }
    summary?: string
  }

  /** Server definitions */
  servers?: USDServer[]

  /** Protocols to include (auto-detected if not specified) */
  protocols?: USDProtocol[]

  /** Global content types */
  contentTypes?: USDContentTypes

  /** HTTP generation options */
  http?: HttpGeneratorOptions

  /** WebSocket generation options */
  websocket?: WebSocketGeneratorOptions

  /** Streams generation options */
  streams?: StreamsGeneratorOptions

  /** GraphQL generation options */
  graphql?: GraphQLGeneratorOptions

  /** JSON-RPC generation options */
  jsonrpc?: JsonRpcGeneratorOptions

  /** gRPC generation options */
  grpc?: GrpcGeneratorOptions

  /** TCP generation options */
  tcp?: TcpGeneratorOptions

  /** UDP generation options */
  udp?: UdpGeneratorOptions

  /** Security schemes */
  securitySchemes?: Record<string, USDSecurityScheme>

  /** Default security requirement */
  defaultSecurity?: Array<Record<string, string[]>>

  /** Interactive authentication recipes keyed by OpenAPI security scheme. */
  authentication?: USDAuthentication

  /** @internal Auth requirements inferred from middleware metadata. */
  authSecurity?: Array<Record<string, string[]>>

  /** @internal Global auth exemptions inferred from middleware metadata. */
  authPublicProcedures?: string[]

  /** OpenAPI 3.1 inbound webhook contracts. */
  webhooks?: USDDocument['webhooks']

  /** Tags for grouping */
  tags?: USDTag[]

  /** External documentation */
  externalDocs?: USDExternalDocs

  /** Documentation customization (hero, introduction, etc.) */
  documentation?: USDDocumentation

  /** Tag groups for sidebar/documentation organization */
  tagGroups?: USDTagGroup[]

  /** Include standard error schemas */
  includeErrorSchemas?: boolean

  /** Include stream event schemas */
  includeStreamEventSchemas?: boolean

  /**
   * External paths to merge into the document after generation.
   * Keys are OpenAPI-style paths (e.g. '/users/{id}').
   */
  externalPaths?: Record<string, USDPathItem>

  /**
   * External components to shallow-merge into the generated document components.
   */
  externalComponents?: {
    schemas?: Record<string, USDSchema>
    securitySchemes?: Record<string, USDSecurityScheme | { $ref: string }>
    parameters?: Record<string, USDParameter | { $ref: string }>
    responses?: Record<string, USDResponse | { $ref: string }>
    requestBodies?: Record<string, USDRequestBody | { $ref: string }>
    examples?: Record<string, USDExample | { $ref: string }>
  }
}

/**
 * USD generation context
 */
export interface USDGeneratorContext {
  /** Handler registry for procedures, streams, events */
  registry: Registry

  /** Schema registry for input/output validation schemas */
  schemaRegistry?: SchemaRegistry

  /** WebSocket channels (from discovery or manual registration) */
  channels?: Map<string, LoadedChannel> | LoadedChannel[]

  /** REST resources (from discovery or manual registration) */
  restResources?: LoadedRestResource[]

  /** GraphQL resources (from discovery or manual registration) */
  graphqlResources?: LoadedGraphQLResource[]

  /** TCP handlers (from discovery or manual registration) */
  tcpHandlers?: LoadedTcpHandler[]

  /** UDP handlers (from discovery or manual registration) */
  udpHandlers?: LoadedUdpHandler[]

  /** Protocol configuration (for jsonrpc/grpc detection) */
  protocolConfig?: USDGeneratorProtocolConfig

  /**
   * Authorization snapshot (when `policy: { ... }` is configured on the
   * server). Drives the document-level `x-usd.authz` catalog. Omit to skip.
   */
  authz?: {
    defaultMode: 'allow' | 'deny'
    policies: ReadonlyArray<{
      id: string
      description?: string
      effect: 'allow' | 'deny' | 'audit'
      principals: readonly string[]
      actions: readonly string[]
      resources: readonly string[]
      hasCondition: boolean
      match?: unknown
    }>
  }
}

export interface USDGeneratorProtocolConfig {
  graphql?: {
    enabled?: boolean
    options?: {
      path?: string
    }
  }
  jsonrpc?: {
    enabled?: boolean
    options?: {
      path?: string
    }
  }
  grpc?: {
    enabled?: boolean
    options?: {
      packageName?: string
    }
  }
}

/**
 * USD generation result
 */
export interface USDGeneratorResult {
  /** Complete USD document */
  document: USDDocument

  /** Detected protocols */
  protocols: USDProtocol[]

  /** All tags used across protocols */
  tags: string[]
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generate a complete USD document from the provided context
 *
 * @example
 * ```ts
 * const result = generateUSD(
 *   {
 *     registry: server.getRegistry(),
 *     schemaRegistry: server.getSchemaRegistry(),
 *     channels: server.getChannels(),
 *     restResources: server.getRestResources(),
 *   },
 *   {
 *     info: {
 *       title: 'My API',
 *       version: '1.0.0',
 *     },
 *   }
 * )
 * ```
 */
export function generateUSD(
  ctx: USDGeneratorContext,
  options: USDGeneratorOptions
): USDGeneratorResult {
  const {
    info,
    servers,
    protocols: requestedProtocols,
    contentTypes: globalContentTypes,
    http: httpOptions = {},
    websocket: wsOptions = {},
    streams: streamsOptions = {},
    graphql: graphqlOptions = {},
    jsonrpc,
    grpc,
    tcp: tcpOptions = {},
    udp: udpOptions = {},
    securitySchemes,
    defaultSecurity,
    authentication,
    authSecurity,
    authPublicProcedures,
    webhooks,
    tags: customTags = [],
    tagGroups: customTagGroups = [],
    externalDocs,
    documentation,
    includeErrorSchemas = true,
    includeStreamEventSchemas = true,
    externalPaths,
    externalComponents,
  } = options

  const jsonrpcOptions = jsonrpc ?? {}
  const grpcOptions = grpc ?? {}
  const hasJsonRpcOptions = jsonrpc !== undefined
  const hasGrpcOptions = grpc !== undefined

  // Auto-detect protocols if not specified
  const detectedProtocols = requestedProtocols ?? detectProtocols(ctx, {
    includeJsonRpc: hasJsonRpcOptions,
    includeGrpc: hasGrpcOptions,
  })

  const assembly = createUSDAssemblyContext({
    info: buildInfo(info),
    servers,
    protocols: detectedProtocols,
    contentTypes: globalContentTypes ?? DEFAULT_USD_CONTENT_TYPES,
    documentation,
  })

  assembly.addTags(customTags)

  // Add security schemes if provided
  if (securitySchemes) {
    assembly.addSecuritySchemes(securitySchemes)
  }

  // Add stream auth schemes if streams protocol is detected
  if (detectedProtocols.includes('streams')) {
    const streamAuthSchemes = generateStreamAuthSchemes()
    assembly.addSecuritySchemes(streamAuthSchemes)
  }

  // Add default security requirement
  if (defaultSecurity) {
    assembly.setDefaultSecurity(defaultSecurity)
  }

  // Generate HTTP paths
  if (detectedProtocols.includes('http')) {
    const httpResult = generateHttpPaths(
      {
        registry: ctx.registry,
        schemaRegistry: ctx.schemaRegistry,
        restResources: ctx.restResources,
      },
      {
        ...httpOptions,
        defaultSecurity,
        authSecurity,
        authPublicProcedures,
        includeErrorResponses: includeErrorSchemas,
      }
    )

    if (Object.keys(httpResult.paths).length > 0) {
      assembly.addPaths(httpResult.paths)
    }

    // Collect tags and schemas
    assembly.addTags(httpResult.tags)
    assembly.addSchemas(httpResult.schemas)
  }

  // Generate WebSocket specification
  if (detectedProtocols.includes('websocket')) {
    const channels = ctx.channels instanceof Map
      ? ctx.channels
      : new Map((ctx.channels ?? []).map((c) => [c.name, c]))

    if (channels.size > 0) {
      const wsResult = generateWebSocket(
        { channels },
        {
          ...wsOptions,
          includeAuthentication: true,
          includeProtocol: true,
        }
      )

      assembly.setProtocolBlock('websocket', wsResult.websocket)
      assembly.addSchemas(wsResult.schemas)

      // Extract tags from channels
      for (const channel of channels.values()) {
        const channelTags = extractChannelTags(channel.name)
        assembly.addTags(channelTags)
      }
    }
  }

  // Generate Streams specification
  if (detectedProtocols.includes('streams')) {
    const streamsResult = generateStreams(
      {
        registry: ctx.registry,
        schemaRegistry: ctx.schemaRegistry,
      },
      {
        ...streamsOptions,
        defaultSecurity,
      }
    )

    if (streamsResult.streams.endpoints && Object.keys(streamsResult.streams.endpoints).length > 0) {
      assembly.setProtocolBlock('streams', streamsResult.streams)
      assembly.addSchemas(streamsResult.schemas)

      // Extract tags from streams
      for (const meta of ctx.registry.listStreams()) {
        const streamTags = extractStreamTags(meta.name)
        assembly.addTags(streamTags)
      }
    }
  }

  // Generate GraphQL specification
  if (detectedProtocols.includes('graphql')) {
    const endpoint = graphqlOptions.endpoint ?? ctx.protocolConfig?.graphql?.options?.path
    const graphqlResult = generateGraphQL(
      {
        registry: ctx.registry,
        schemaRegistry: ctx.schemaRegistry,
        graphqlResources: ctx.graphqlResources,
      },
      {
        ...graphqlOptions,
        endpoint: endpoint ?? graphqlOptions.endpoint,
      },
    )

    const hasGraphQLContent =
      Object.keys(graphqlResult.graphql.resources ?? {}).length > 0
      || Object.keys(graphqlResult.graphql.queries ?? {}).length > 0
      || Object.keys(graphqlResult.graphql.mutations ?? {}).length > 0
      || Object.keys(graphqlResult.graphql.subscriptions ?? {}).length > 0

    if (hasGraphQLContent) {
      assembly.setProtocolBlock('graphql', graphqlResult.graphql)
      assembly.addSchemas(graphqlResult.schemas)
      assembly.addTags(graphqlResult.tags)
    }
  }

  // Generate JSON-RPC specification
  if (detectedProtocols.includes('jsonrpc')) {
    const endpoint = jsonrpcOptions.endpoint ?? ctx.protocolConfig?.jsonrpc?.options?.path
    const jsonrpcResult = generateJsonRpc(
      {
        registry: ctx.registry,
        schemaRegistry: ctx.schemaRegistry,
      },
      {
        ...jsonrpcOptions,
        endpoint: endpoint ?? jsonrpcOptions.endpoint,
        defaultSecurity,
      }
    )

    if (jsonrpcResult.jsonrpc.methods && Object.keys(jsonrpcResult.jsonrpc.methods).length > 0) {
      assembly.setProtocolBlock('jsonrpc', jsonrpcResult.jsonrpc)
      assembly.addSchemas(jsonrpcResult.schemas)

      // Extract tags from JSON-RPC methods
      assembly.addTags(jsonrpcResult.tags)
    }
  }

  // Generate gRPC specification
  if (detectedProtocols.includes('grpc')) {
    const packageName = grpcOptions.package ?? ctx.protocolConfig?.grpc?.options?.packageName
    const grpcResult = generateGrpc(
      {
        registry: ctx.registry,
        schemaRegistry: ctx.schemaRegistry,
      },
      {
        ...grpcOptions,
        package: packageName ?? grpcOptions.package,
      }
    )

    if (grpcResult.grpc.services && Object.keys(grpcResult.grpc.services).length > 0) {
      assembly.setProtocolBlock('grpc', grpcResult.grpc)
      assembly.addSchemas(grpcResult.schemas)

      // Extract tags from gRPC services
      assembly.addTags(grpcResult.tags)
    }
  }

  // Add standard stream event schemas if requested
  if (includeStreamEventSchemas && detectedProtocols.includes('streams')) {
    const streamEvents = generateStreamEvents()
    assembly.addSchemas(streamEvents)
  }

  // Generate TCP specification
  if (detectedProtocols.includes('tcp') && ctx.tcpHandlers && ctx.tcpHandlers.length > 0) {
    const tcpResult = generateTcp(
      { handlers: ctx.tcpHandlers },
      {
        ...tcpOptions,
        defaultSecurity,
      }
    )

    if (tcpResult.tcp.servers && Object.keys(tcpResult.tcp.servers).length > 0) {
      assembly.setProtocolBlock('tcp', tcpResult.tcp)
      assembly.addSchemas(tcpResult.schemas)

      // Extract tags from TCP handlers
      for (const handler of ctx.tcpHandlers) {
        const tcpTags = extractHandlerTags(handler.name)
        assembly.addTags(tcpTags)
      }
    }

    // Add standard TCP schemas
    const tcpSchemas = generateTcpSchemas()
    assembly.addSchemas(tcpSchemas)
  }

  // Generate UDP specification
  if (detectedProtocols.includes('udp') && ctx.udpHandlers && ctx.udpHandlers.length > 0) {
    const udpResult = generateUdp(
      { handlers: ctx.udpHandlers },
      {
        ...udpOptions,
        defaultSecurity,
      }
    )

    if (udpResult.udp.endpoints && Object.keys(udpResult.udp.endpoints).length > 0) {
      assembly.setProtocolBlock('udp', udpResult.udp)
      assembly.addSchemas(udpResult.schemas)

      // Extract tags from UDP handlers
      for (const handler of ctx.udpHandlers) {
        const udpTags = extractHandlerTags(handler.name)
        assembly.addTags(udpTags)
      }
    }

    // Add standard UDP schemas
    const udpSchemas = generateUdpSchemas()
    assembly.addSchemas(udpSchemas)
  }

  if (customTagGroups.length > 0) {
    assembly.setTagGroups(customTagGroups)
  }

  // Add external docs
  if (externalDocs) {
    assembly.setExternalDocs(externalDocs)
  }

  // Merge external paths
  if (externalPaths && Object.keys(externalPaths).length > 0) {
    assembly.addPaths(externalPaths)
  }

  // Merge external components (shallow per category)
  if (externalComponents) {
    assembly.mergeComponents(externalComponents)
  }

  // Authorization catalog — top-level x-raffel-authz extension.
  // Only emitted when `policy: { ... }` is configured on the server.
  if (ctx.authz && ctx.authz.policies.length > 0) {
    assembly.setRaffelAuthz({
      'default-mode': ctx.authz.defaultMode,
      policies: ctx.authz.policies.map((p) => ({
        id: p.id,
        ...(p.description ? { description: p.description } : {}),
        effect: p.effect,
        principals: [...p.principals],
        actions: [...p.actions],
        resources: [...p.resources],
        'has-condition': p.hasCondition,
        ...(p.match !== undefined ? { match: p.match } : {}),
      })),
    })
  }

  const result = assembly.build()
  if (authentication) result.document['x-usd-authentication'] = authentication
  if (webhooks) result.document.webhooks = webhooks

  return {
    document: result.document,
    protocols: detectedProtocols,
    tags: result.tags,
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Auto-detect protocols based on context
 */
function detectProtocols(
  ctx: USDGeneratorContext,
  overrides?: { includeJsonRpc?: boolean; includeGrpc?: boolean }
): USDProtocol[] {
  const protocols: USDProtocol[] = []

  // Check for HTTP (procedures or REST resources)
  const hasProcedures = ctx.registry.listProcedures().length > 0
  const hasRestResources = ctx.restResources && ctx.restResources.length > 0
  if (hasProcedures || hasRestResources) {
    protocols.push('http')
  }

  // Check for WebSocket (channels)
  const hasChannels = ctx.channels instanceof Map
    ? ctx.channels.size > 0
    : (ctx.channels?.length ?? 0) > 0
  if (hasChannels) {
    protocols.push('websocket')
  }

  // Check for Streams
  const hasStreams = ctx.registry.listStreams().length > 0
  if (hasStreams) {
    protocols.push('streams')
  }

  // Check for GraphQL
  const hasGraphQLResources = (ctx.graphqlResources?.length ?? 0) > 0
  if (ctx.protocolConfig?.graphql?.enabled || hasGraphQLResources) {
    protocols.push('graphql')
  }

  // Check for JSON-RPC
  if (ctx.protocolConfig?.jsonrpc?.enabled || overrides?.includeJsonRpc) {
    protocols.push('jsonrpc')
  }

  // Check for gRPC
  if (ctx.protocolConfig?.grpc?.enabled || overrides?.includeGrpc) {
    protocols.push('grpc')
  }

  // Check for TCP handlers
  const hasTcp = ctx.tcpHandlers && ctx.tcpHandlers.length > 0
  if (hasTcp) {
    protocols.push('tcp')
  }

  // Check for UDP handlers
  const hasUdp = ctx.udpHandlers && ctx.udpHandlers.length > 0
  if (hasUdp) {
    protocols.push('udp')
  }

  return protocols
}

/**
 * Build USD info object
 */
function buildInfo(info: USDGeneratorOptions['info']): USDInfo {
  return {
    title: info.title,
    version: info.version,
    description: info.description,
    termsOfService: info.termsOfService,
    contact: info.contact,
    license: info.license,
    summary: info.summary,
  }
}

/**
 * Extract tags from channel name
 */
function extractChannelTags(name: string): string[] {
  // Remove prefix
  const withoutPrefix = name
    .replace(/^presence-/, '')
    .replace(/^private-/, '')

  // Split and take first part
  const parts = withoutPrefix.split(/[-_]/).filter((p) => !p.startsWith(':') && !p.startsWith('{') && p.length > 0)

  if (parts.length > 0) {
    return [parts[0]]
  }

  return []
}

/**
 * Extract tags from stream name
 */
function extractStreamTags(name: string): string[] {
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
 * Extract tags from handler name (TCP/UDP)
 */
function extractHandlerTags(name: string): string[] {
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

// =============================================================================
// Quick Builders
// =============================================================================

/**
 * Create a minimal USD document for a simple HTTP API
 */
export function createHttpOnlyUSD(
  ctx: Pick<USDGeneratorContext, 'registry' | 'schemaRegistry' | 'restResources'>,
  info: { title: string; version: string; description?: string }
): USDDocument {
  const result = generateUSD(
    { registry: ctx.registry, schemaRegistry: ctx.schemaRegistry, restResources: ctx.restResources },
    { info, protocols: ['http'] }
  )
  return result.document
}

/**
 * Create a minimal USD document for WebSocket-only API
 */
export function createWebSocketOnlyUSD(
  channels: Map<string, LoadedChannel> | LoadedChannel[],
  info: { title: string; version: string; description?: string },
  wsOptions?: WebSocketGeneratorOptions
): USDDocument {
  const wsResult = generateWebSocket(
    { channels },
    {
      ...wsOptions,
      includeAuthentication: true,
      includeProtocol: true,
    }
  )

  return {
    usd: '1.0.0',
    openapi: '3.1.0',
    info: {
      title: info.title,
      version: info.version,
      description: info.description,
    },
    'x-usd': {
      protocols: ['websocket'],
      contentTypes: DEFAULT_USD_CONTENT_TYPES,
      websocket: wsResult.websocket,
    },
    components: {
      schemas: wsResult.schemas,
    },
  }
}

/**
 * Create a minimal USD document for Streams-only API
 */
export function createStreamsOnlyUSD(
  ctx: Pick<USDGeneratorContext, 'registry' | 'schemaRegistry'>,
  info: { title: string; version: string; description?: string }
): USDDocument {
  const streamsResult = generateStreams({
    registry: ctx.registry,
    schemaRegistry: ctx.schemaRegistry,
  })

  const streamEvents = generateStreamEvents()

  return {
    usd: '1.0.0',
    openapi: '3.1.0',
    info: {
      title: info.title,
      version: info.version,
      description: info.description,
    },
    'x-usd': {
      protocols: ['streams'],
      contentTypes: DEFAULT_USD_CONTENT_TYPES,
      streams: streamsResult.streams,
    },
    components: {
      schemas: {
        ...streamsResult.schemas,
        ...streamEvents,
      },
    },
  }
}

/**
 * Create a minimal USD document for TCP-only API
 */
export function createTcpOnlyUSD(
  handlers: LoadedTcpHandler[],
  info: { title: string; version: string; description?: string },
  tcpOptions?: TcpGeneratorOptions
): USDDocument {
  const tcpResult = generateTcp({ handlers }, tcpOptions)
  const tcpSchemas = generateTcpSchemas()

  return {
    usd: '1.0.0',
    openapi: '3.1.0',
    info: {
      title: info.title,
      version: info.version,
      description: info.description,
    },
    'x-usd': {
      protocols: ['tcp'],
      contentTypes: DEFAULT_USD_CONTENT_TYPES,
      tcp: tcpResult.tcp,
    },
    components: {
      schemas: {
        ...tcpResult.schemas,
        ...tcpSchemas,
      },
    },
  }
}

/**
 * Create a minimal USD document for UDP-only API
 */
export function createUdpOnlyUSD(
  handlers: LoadedUdpHandler[],
  info: { title: string; version: string; description?: string },
  udpOptions?: UdpGeneratorOptions
): USDDocument {
  const udpResult = generateUdp({ handlers }, udpOptions)
  const udpSchemas = generateUdpSchemas()

  return {
    usd: '1.0.0',
    openapi: '3.1.0',
    info: {
      title: info.title,
      version: info.version,
      description: info.description,
    },
    'x-usd': {
      protocols: ['udp'],
      contentTypes: DEFAULT_USD_CONTENT_TYPES,
      udp: udpResult.udp,
    },
    components: {
      schemas: {
        ...udpResult.schemas,
        ...udpSchemas,
      },
    },
  }
}

// =============================================================================
// Export Types
// =============================================================================

export type {
  USDDocument,
  USDInfo,
  USDServer,
  USDTag,
  USDSchema,
  USDProtocol,
  USDComponents,
  USDSecurityScheme,
  USDExternalDocs,
  LoadedTcpHandler,
  LoadedUdpHandler,
}
