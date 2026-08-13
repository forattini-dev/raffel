import type {
  USDContentTypes,
  USDExample,
  USDSchema,
  USDSecurityRequirement,
} from './types.js'

// =============================================================================
// GraphQL Extension (x-usd.graphql)
// =============================================================================

export interface USDGraphQL {
  /** GraphQL endpoint path */
  endpoint?: string

  /** Content types for GraphQL requests/responses */
  contentTypes?: USDContentTypes

  /** Resource-first GraphQL object/resource definitions */
  resources?: Record<string, USDGraphQLResource>

  /** Query root fields */
  queries?: Record<string, USDGraphQLOperation>

  /** Mutation root fields */
  mutations?: Record<string, USDGraphQLOperation>

  /** Subscription root fields */
  subscriptions?: Record<string, USDGraphQLOperation>
}

export interface USDGraphQLResource {
  /** GraphQL object type name */
  name: string
  pluralName?: string
  namespace?: string
  description?: string
  schema: USDSchema | { $ref: string }
  idField?: string
  source?: string
  policies?: string[]
  relations?: Record<string, USDGraphQLRelation>
}

export interface USDGraphQLRelation {
  type: string
  description?: string
  many?: boolean
  nullable?: boolean
  args?: USDSchema | { $ref: string }
  loader?: string
  procedureRef?: string
  batchKey?: boolean
  auth?: 'required' | 'optional' | 'none'
  authz?: USDGraphQLAuthz
}

export interface USDGraphQLOperation {
  field: string
  kind: 'query' | 'mutation' | 'subscription'
  description?: string
  resource?: string
  source?: 'procedure' | 'stream' | 'event' | 'resource'
  procedureRef?: string
  streamRef?: string
  deprecationReason?: string
  cost?: number
  auth?: 'required' | 'optional' | 'none'
  args?: USDSchema | { $ref: string }
  input?: USDSchema | { $ref: string }
  output?: USDSchema | { $ref: string }
  many?: boolean
  nullable?: boolean
  pagination?: false | {
    style: 'offset' | 'cursor'
    defaultLimit?: number
    maxLimit?: number
    cursorField?: string
  }
  authorize?: USDGraphQLAuthz
  authz?: USDGraphQLAuthz
  tags?: string[]
}

export interface USDGraphQLAuthz {
  action: string
  mode: 'all' | 'any'
  onDeny?: 'throw' | 'null' | 'filter'
  'has-resource-resolver': boolean
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

  /** Subscribe operation (server -> client) */
  subscribe?: USDChannelOperation

  /** Publish operation (client -> server) */
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

  /** Connection-scoped controls for a Live Stream. */
  'x-usd-live-stream'?: import('../../types/handlers.js').StreamOperationalControls

  /** Application-owned replay and durable-source contract. */
  'x-usd-resumable'?: import('../../types/handlers.js').ResumableStreamProjectedContract
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
    /** Inbound message schema (client -> server) */
    inbound?: USDMessageDefinition
    /** Outbound message schema (server -> client) */
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
    /** Inbound message schema (client -> server) */
    inbound?: USDMessageDefinition
    /** Outbound message schema (server -> client) */
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
