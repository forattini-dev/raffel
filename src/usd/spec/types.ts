/**
 * USD (Universal Service Documentation) Specification Types
 *
 * USD extends OpenAPI 3.1 with x-usd extensions to support
 * multiple protocols in a single document.
 */

import type { JSONSchema7 } from 'json-schema'

// =============================================================================
// Core USD Document
// =============================================================================

/**
 * USD Document - extends OpenAPI 3.1 with multi-protocol support
 */
export interface USDDocument {
  /** USD specification version */
  usd: '1.0.0'

  /** OpenAPI version (always 3.1.0) */
  openapi: '3.1.0'

  /** API metadata */
  info: USDInfo

  /** Server endpoints */
  servers?: USDServer[]

  /** HTTP paths (standard OpenAPI) */
  paths?: USDPaths

  /** Reusable components */
  components?: USDComponents

  /** Security requirements */
  security?: USDSecurityRequirement[]

  /** Tags for grouping */
  tags?: USDTag[]

  /** Tag groups for hierarchical organization (like Redoc) */
  'x-tagGroups'?: USDTagGroup[]

  /** External documentation */
  externalDocs?: USDExternalDocs

  /** USD extension namespace */
  'x-usd'?: USDX
}

export interface USDX {
  /** Protocols used in this service */
  protocols?: USDProtocol[]

  /** Protocol-specific servers (non-HTTP) */
  servers?: USDProtocolServer[]

  /** Default and supported content types */
  contentTypes?: USDContentTypes

  /** Shared message definitions */
  messages?: Record<string, USDMessage>

  /** Documentation customization (hero, introduction, etc.) */
  documentation?: USDDocumentation

  /** WebSocket channels */
  websocket?: USDWebSocket

  /** Stream endpoints */
  streams?: USDStreams

  /** JSON-RPC methods */
  jsonrpc?: USDJsonRpc

  /** gRPC services */
  grpc?: USDGrpc

  /** TCP servers */
  tcp?: USDTcp

  /** UDP endpoints */
  udp?: USDUdp

  /** Unified error definitions */
  errors?: USDErrors
}

// =============================================================================
// Documentation Extension (x-usd.documentation)
// =============================================================================

/**
 * Documentation customization for USD UI
 * This allows the spec to define hero section, introduction markdown, and other UI elements
 */
export interface USDDocumentation {
  /** Hero section configuration (Docsify-inspired cover page) */
  hero?: USDHero

  /** Introduction markdown content (displayed after hero, before endpoints) */
  introduction?: string

  /** External documentation links */
  externalLinks?: USDExternalLink[]

  /** Custom favicon URL */
  favicon?: string

  /** Custom logo URL */
  logo?: string
}

/**
 * Hero section configuration (Docsify-style cover page)
 */
export interface USDHero {
  /** Override title from info.title */
  title?: string

  /** Version badge (defaults to info.version) */
  version?: string

  /** Tagline/description below title */
  tagline?: string

  /** Feature list with checkmark bullets */
  features?: string[]

  /** Background style */
  background?: 'gradient' | 'solid' | 'pattern' | 'image'

  /** Custom background image URL (for 'image' background) */
  backgroundImage?: string

  /** Custom background color (for 'solid' background) */
  backgroundColor?: string

  /** Call-to-action buttons */
  buttons?: USDHeroButton[]

  /** Quick links grid below buttons */
  quickLinks?: USDQuickLink[]

  /** GitHub repository URL (shows corner octocat) */
  github?: string
}

/**
 * Hero button configuration
 */
export interface USDHeroButton {
  /** Button text */
  text: string
  /** Button link URL */
  href?: string
  /** Whether this is a primary (highlighted) button */
  primary?: boolean
}

/**
 * Quick link configuration
 */
export interface USDQuickLink {
  /** Link title */
  title: string
  /** Optional description */
  description?: string
  /** Link URL */
  href: string
  /** Optional icon (emoji or icon class) */
  icon?: string
}

/**
 * External link configuration
 */
export interface USDExternalLink {
  /** Link title */
  title: string
  /** Link URL */
  url: string
  /** Optional description */
  description?: string
}

// =============================================================================
// Info & Metadata
// =============================================================================

export interface USDInfo {
  /** API title */
  title: string

  /** API version */
  version: string

  /** Description (markdown supported) */
  description?: string

  /** Terms of service URL */
  termsOfService?: string

  /** Contact information */
  contact?: {
    name?: string
    url?: string
    email?: string
  }

  /** License information */
  license?: {
    name: string
    url?: string
    identifier?: string
  }

  /** Summary */
  summary?: string
}

export type USDProtocol = 'http' | 'websocket' | 'streams' | 'jsonrpc' | 'grpc' | 'tcp' | 'udp'

export interface USDContentTypes {
  /** Default content type when unspecified */
  default?: string

  /** Additional supported content types */
  supported?: string[]
}

export interface USDServer {
  /** Server URL */
  url: string

  /** Server description */
  description?: string

  /** Variable substitutions */
  variables?: Record<string, USDServerVariable>
}

export interface USDProtocolServer {
  /** Server URL */
  url: string

  /** Protocol for this server */
  protocol: USDProtocol

  /** Server description */
  description?: string

  /** Variable substitutions */
  variables?: Record<string, USDServerVariable>
}

export interface USDServerVariable {
  enum?: string[]
  default: string
  description?: string
}

export interface USDTag {
  name: string
  description?: string
  externalDocs?: USDExternalDocs
  /** Display name (if different from name) */
  'x-displayName'?: string
}

/**
 * Tag Group for hierarchical organization (like Redoc's x-tagGroups)
 */
export interface USDTagGroup {
  /** Group name displayed in sidebar */
  name: string
  /** Tags included in this group */
  tags: string[]
  /** Optional description */
  description?: string
  /** Expanded by default */
  expanded?: boolean
}

export interface USDExternalDocs {
  url: string
  description?: string
}

// =============================================================================
// HTTP Paths (OpenAPI Standard)
// =============================================================================

export type USDPaths = Record<string, USDPathItem>

export interface USDPathItem {
  $ref?: string
  summary?: string
  description?: string
  get?: USDOperation
  put?: USDOperation
  post?: USDOperation
  delete?: USDOperation
  options?: USDOperation
  head?: USDOperation
  patch?: USDOperation
  trace?: USDOperation
  servers?: USDServer[]
  parameters?: USDParameter[]
}

export interface USDOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  security?: USDSecurityRequirement[]
  servers?: USDServer[]
  externalDocs?: USDExternalDocs
  parameters?: USDParameter[]
  requestBody?: USDRequestBody
  responses: USDResponses
  callbacks?: Record<string, USDCallback>

  /** Mark as streaming response */
  'x-usd-streaming'?: boolean
}

export interface USDParameter {
  name: string
  in: 'query' | 'header' | 'path' | 'cookie'
  description?: string
  required?: boolean
  deprecated?: boolean
  allowEmptyValue?: boolean
  style?: string
  explode?: boolean
  allowReserved?: boolean
  schema?: USDSchema
  example?: unknown
  examples?: Record<string, USDExample>
  content?: Record<string, USDMediaType>
}

export interface USDRequestBody {
  description?: string
  required?: boolean
  content: Record<string, USDMediaType>
}

export type USDResponses = Record<string, USDResponse>

export interface USDResponse {
  description: string
  headers?: Record<string, USDHeader>
  content?: Record<string, USDMediaType>
  links?: Record<string, USDLink>
}

export interface USDMediaType {
  schema?: USDSchema
  example?: unknown
  examples?: Record<string, USDExample>
  encoding?: Record<string, USDEncoding>
}

export interface USDHeader {
  description?: string
  required?: boolean
  deprecated?: boolean
  schema?: USDSchema
}

export interface USDLink {
  operationRef?: string
  operationId?: string
  parameters?: Record<string, unknown>
  requestBody?: unknown
  description?: string
  server?: USDServer
}

export interface USDExample {
  summary?: string
  description?: string
  value?: unknown
  externalValue?: string
}

export interface USDEncoding {
  contentType?: string
  headers?: Record<string, USDHeader>
  style?: string
  explode?: boolean
  allowReserved?: boolean
}

export type USDCallback = Record<string, USDPathItem>

// =============================================================================
// Schema (JSON Schema Draft 2020-12 subset)
// =============================================================================

export type USDSchema = JSONSchema7 & {
  /** Reference to another schema */
  $ref?: string

  /** Discriminator for polymorphism */
  discriminator?: {
    propertyName: string
    mapping?: Record<string, string>
  }

  /** External documentation */
  externalDocs?: USDExternalDocs

  /** Example value */
  example?: unknown

  /** XML metadata */
  xml?: {
    name?: string
    namespace?: string
    prefix?: string
    attribute?: boolean
    wrapped?: boolean
  }
}

// =============================================================================
// Components (Reusable Definitions)
// =============================================================================

export interface USDComponents {
  schemas?: Record<string, USDSchema>
  responses?: Record<string, USDResponse>
  parameters?: Record<string, USDParameter>
  examples?: Record<string, USDExample>
  requestBodies?: Record<string, USDRequestBody>
  headers?: Record<string, USDHeader>
  securitySchemes?: Record<string, USDSecurityScheme>
  links?: Record<string, USDLink>
  callbacks?: Record<string, USDCallback>
  pathItems?: Record<string, USDPathItem>
}

// =============================================================================
// Security
// =============================================================================

export type USDSecurityRequirement = Record<string, string[]>

export interface USDSecurityScheme {
  type: 'apiKey' | 'http' | 'oauth2' | 'openIdConnect' | 'mutualTLS'
  description?: string
  name?: string
  in?: 'query' | 'header' | 'cookie'
  scheme?: string
  bearerFormat?: string
  flows?: USDOAuthFlows
  openIdConnectUrl?: string

  /** WebSocket auth scheme */
  'x-usd-websocket'?: {
    in: 'query' | 'header' | 'cookie'
    name: string
  }

  /** Streams auth scheme (SSE/fetch streams) */
  'x-usd-streams'?: {
    /**
     * Supported locations for auth token
     * - 'query': Token in query parameter (EventSource compatible)
     * - 'header': Token in HTTP header (fetch API only)
     * - 'cookie': Session cookie (automatic with EventSource)
     */
    in: ('query' | 'header' | 'cookie')[]
    /** Parameter/header/cookie name */
    name: string
    /** Description of how to use this auth method with streams */
    description?: string
  }
}

export interface USDOAuthFlows {
  implicit?: USDOAuthFlow
  password?: USDOAuthFlow
  clientCredentials?: USDOAuthFlow
  authorizationCode?: USDOAuthFlow
}

export interface USDOAuthFlow {
  authorizationUrl?: string
  tokenUrl?: string
  refreshUrl?: string
  scopes: Record<string, string>
}

// =============================================================================
// WebSocket Extension (x-usd.websocket)
// =============================================================================

export interface USDWebSocket {
  /** WebSocket endpoint path */
  path?: string

  /** Content types for WebSocket messages */
  contentTypes?: USDContentTypes

  /** Channel definitions */
  channels?: Record<string, USDChannel>

  /** Authentication configuration */
  authentication?: {
    /** How to pass auth token */
    in: 'query' | 'header' | 'cookie'
    /** Parameter name */
    name: string
    /** Description */
    description?: string
  }

  /** Connection lifecycle events */
  events?: {
    onConnect?: USDMessage
    onDisconnect?: USDMessage
    onError?: USDMessage
  }
}

export type USDChannelType = 'public' | 'private' | 'presence'

export interface USDChannel {
  /** Channel type */
  type: USDChannelType

  /** Channel description */
  description?: string

  /** Channel parameters for templated names (e.g. rooms.{roomId}) */
  parameters?: Record<string, USDChannelParameter>

  /** Tags for grouping */
  tags?: string[]

  /** Subscribe operation (server → client) */
  subscribe?: USDChannelOperation

  /** Publish operation (client → server) */
  publish?: USDChannelOperation

  /** Presence configuration (only for presence channels) */
  'x-usd-presence'?: {
    /** Schema for member data */
    memberSchema?: USDSchema | { $ref: string }
    /** Presence events */
    events?: ('member_added' | 'member_removed' | 'member_updated')[]
  }
}

export interface USDChannelOperation {
  /** Operation summary */
  summary?: string

  /** Operation description */
  description?: string

  /** Content types for this operation */
  contentTypes?: USDContentTypes

  /** Message schema */
  message: USDMessageDefinition

  /** Tags for grouping */
  tags?: string[]

  /** Security requirements */
  security?: USDSecurityRequirement[]
}

export interface USDMessage {
  /** Message name */
  name?: string

  /** Message title */
  title?: string

  /** Message summary */
  summary?: string

  /** Message description */
  description?: string

  /** Content type */
  contentType?: string

  /** Message payload schema */
  payload?: USDSchema | { $ref: string }

  /** Tags */
  tags?: string[]

  /** Example */
  example?: unknown

  /** Multiple examples */
  examples?: Record<string, USDExample>
}

export interface USDChannelParameter {
  description?: string
  required?: boolean
  schema?: USDSchema | { $ref: string }
  example?: unknown
}

export type USDMessageDefinition = USDMessage | { $ref: string } | USDSchema

// =============================================================================
// Streams Extension (x-usd.streams)
// =============================================================================

export interface USDStreams {
  /** Content types for stream messages */
  contentTypes?: USDContentTypes

  /** Stream endpoints */
  endpoints?: Record<string, USDStreamEndpoint>
}

export type USDStreamDirection = 'server-to-client' | 'client-to-server' | 'bidirectional'

export interface USDStreamEndpoint {
  /** Stream description */
  description?: string

  /** Stream direction */
  direction: USDStreamDirection

  /** Content types for this endpoint */
  contentTypes?: USDContentTypes

  /** Message schema */
  message: USDMessageDefinition

  /** Tags */
  tags?: string[]

  /** Security requirements */
  security?: USDSecurityRequirement[]

  /** Whether stream supports backpressure */
  'x-usd-backpressure'?: boolean
}

// =============================================================================
// JSON-RPC Extension (x-usd.jsonrpc)
// =============================================================================

export interface USDJsonRpc {
  /** JSON-RPC endpoint path */
  endpoint?: string

  /** JSON-RPC version */
  version?: '2.0'

  /** Content types for JSON-RPC messages */
  contentTypes?: USDContentTypes

  /** Method definitions */
  methods?: Record<string, USDJsonRpcMethod>

  /** Batch support */
  batch?: {
    enabled?: boolean
    maxSize?: number
  }
}

export interface USDJsonRpcMethod {
  /** Method description */
  description?: string

  /** Content types for this method */
  contentTypes?: USDContentTypes

  /** Parameter schema */
  params?: USDSchema | { $ref: string }

  /** Result schema */
  result?: USDSchema | { $ref: string }

  /** Error definitions */
  errors?: USDJsonRpcError[]

  /** Tags */
  tags?: string[]

  /** Security requirements */
  security?: USDSecurityRequirement[]

  /** Whether this is a streaming method */
  'x-usd-streaming'?: boolean

  /** Whether this is a notification (no response expected) */
  'x-usd-notification'?: boolean
}

export interface USDJsonRpcError {
  /** JSON-RPC error code */
  code: number
  /** Error message */
  message: string
  /** Error description */
  description?: string
  /** Error data schema */
  data?: USDSchema | { $ref: string }
}

// =============================================================================
// gRPC Extension (x-usd.grpc)
// =============================================================================

export interface USDGrpc {
  /** Proto package name */
  package?: string

  /** Proto syntax version */
  syntax?: 'proto3' | 'proto2'

  /** Content types for gRPC messages */
  contentTypes?: USDContentTypes

  /** Service definitions */
  services?: Record<string, USDGrpcService>

  /** Proto file options */
  options?: Record<string, unknown>
}

export interface USDGrpcService {
  /** Service description */
  description?: string

  /** Method definitions */
  methods?: Record<string, USDGrpcMethod>
}

export interface USDGrpcMethod {
  /** Method description */
  description?: string

  /** Content types for this method */
  contentTypes?: USDContentTypes

  /** Input message schema */
  input: USDSchema | { $ref: string }

  /** Output message schema */
  output: USDSchema | { $ref: string }

  /** Tags */
  tags?: string[]

  /** Client streaming */
  'x-usd-client-streaming'?: boolean

  /** Server streaming */
  'x-usd-server-streaming'?: boolean
}

// =============================================================================
// TCP Extension (x-usd.tcp)
// =============================================================================

export interface USDTcp {
  /** Content types for TCP messages */
  contentTypes?: USDContentTypes

  /** TCP server definitions */
  servers?: Record<string, USDTcpServer>
}

export interface USDTcpServer {
  /** Server description */
  description?: string

  /** Content types for this server */
  contentTypes?: USDContentTypes

  /** Host address */
  host: string

  /** Port number */
  port: number

  /** TLS configuration */
  tls?: USDTcpTls

  /** Message framing configuration */
  framing?: USDTcpFraming

  /** Message schemas */
  messages?: {
    /** Inbound message schema (client → server) */
    inbound?: USDMessageDefinition
    /** Outbound message schema (server → client) */
    outbound?: USDMessageDefinition
  }

  /** Connection lifecycle */
  lifecycle?: {
    /** Connection handshake description */
    onConnect?: string
    /** Disconnection description */
    onDisconnect?: string
    /** Keep-alive configuration */
    keepAlive?: {
      enabled?: boolean
      intervalMs?: number
    }
  }

  /** Tags for grouping */
  tags?: string[]

  /** Security requirements */
  security?: USDSecurityRequirement[]
}

export interface USDTcpTls {
  /** Whether TLS is enabled */
  enabled: boolean
  /** Certificate path (for documentation) */
  cert?: string
  /** Key path (for documentation) */
  key?: string
  /** CA certificate path (for documentation) */
  ca?: string
  /** Whether to require client certificates */
  clientAuth?: boolean
}

export type USDTcpFramingType = 'length-prefixed' | 'delimiter' | 'fixed' | 'none'

export interface USDTcpFraming {
  /** Framing type */
  type: USDTcpFramingType
  /** Number of bytes for length prefix (for length-prefixed type) */
  lengthBytes?: 1 | 2 | 4 | 8
  /** Byte order for length prefix (for length-prefixed type) */
  byteOrder?: 'big-endian' | 'little-endian'
  /** Delimiter string (for delimiter type) */
  delimiter?: string
  /** Fixed frame size in bytes (for fixed type) */
  fixedSize?: number
}

// =============================================================================
// UDP Extension (x-usd.udp)
// =============================================================================

export interface USDUdp {
  /** Content types for UDP messages */
  contentTypes?: USDContentTypes

  /** UDP endpoint definitions */
  endpoints?: Record<string, USDUdpEndpoint>
}

export interface USDUdpEndpoint {
  /** Endpoint description */
  description?: string

  /** Content types for this endpoint */
  contentTypes?: USDContentTypes

  /** Host address (0.0.0.0 for all interfaces) */
  host: string

  /** Port number */
  port: number

  /** Multicast configuration */
  multicast?: USDUdpMulticast

  /** Maximum packet size in bytes (max 65507) */
  maxPacketSize?: number

  /** Message schemas (preferred) */
  messages?: {
    /** Inbound message schema (client → server) */
    inbound?: USDMessageDefinition
    /** Outbound message schema (server → client) */
    outbound?: USDMessageDefinition
  }

  /** Message schema (legacy inbound) */
  message?: USDMessageDefinition

  /** Reliability configuration */
  reliability?: {
    /** Whether to validate checksums */
    checksumValidation?: boolean
    /** Whether to detect duplicates */
    duplicateDetection?: boolean
  }

  /** Tags for grouping */
  tags?: string[]

  /** Security requirements */
  security?: USDSecurityRequirement[]
}

export interface USDUdpMulticast {
  /** Whether multicast is enabled */
  enabled: boolean
  /** Multicast group address */
  group?: string
  /** Time-to-live for multicast packets */
  ttl?: number
}

// =============================================================================
// Unified Errors (x-usd.errors)
// =============================================================================

export type USDErrors = Record<string, USDError>

export interface USDError {
  /** HTTP status code */
  status?: number

  /** JSON-RPC error code */
  code?: number

  /** gRPC status code */
  grpcCode?: number

  /** Error message */
  message: string

  /** Detailed description */
  description?: string

  /** Data schema for additional error info */
  data?: USDSchema | { $ref: string }
}

// =============================================================================
// Builder Types
// =============================================================================

/**
 * Options for creating a USD document
 */
export interface USDDocumentOptions {
  /** API title */
  title: string

  /** API version */
  version: string

  /** Description */
  description?: string

  /** Protocols to enable */
  protocols?: USDProtocol[]
}

/**
 * Validation result
 */
export interface USDValidationResult {
  /** Whether the document is valid */
  valid: boolean

  /** Validation errors */
  errors: USDValidationError[]

  /** Validation warnings */
  warnings: USDValidationError[]
}

export interface USDValidationError {
  /** JSON pointer path to the error */
  path: string

  /** Error message */
  message: string

  /** Error code */
  code?: string

  /** Severity */
  severity: 'error' | 'warning'
}

/**
 * Export options for converting to pure OpenAPI
 */
export interface USDExportOptions {
  /** Include WebSocket channels as webhooks */
  includeWebSocketAsWebhooks?: boolean

  /** Include JSON-RPC methods as POST endpoints */
  includeRpcAsEndpoints?: boolean

  /** Include streams as endpoints */
  includeStreamsAsEndpoints?: boolean

  /** Strip all USD extensions (x-usd namespace) */
  stripExtensions?: boolean
}

// =============================================================================
// Type Guards
// =============================================================================

export function isUSDDocument(obj: unknown): obj is USDDocument {
  if (typeof obj !== 'object' || obj === null) return false
  const doc = obj as Record<string, unknown>
  return (
    doc.usd === '1.0.0' &&
    doc.openapi === '3.1.0' &&
    typeof doc.info === 'object' &&
    doc.info !== null
  )
}

export function isRefObject(obj: unknown): obj is { $ref: string } {
  if (typeof obj !== 'object' || obj === null) return false
  return '$ref' in obj && typeof (obj as { $ref: unknown }).$ref === 'string'
}

export function isPresenceChannel(channel: USDChannel): boolean {
  return channel.type === 'presence'
}

export function isPrivateChannel(channel: USDChannel): boolean {
  return channel.type === 'private'
}

export function isPublicChannel(channel: USDChannel): boolean {
  return channel.type === 'public'
}
