/**
 * Server Builder Types — Config-time options
 *
 * Type definitions for configuring a Raffel server: providers, plugins,
 * error handling, ServerOptions, and per-protocol options.
 */

import type { IncomingMessage } from 'node:http'
import type { Options as ProtoLoaderOptions } from '@grpc/proto-loader'
import type {
  Context,
  ContextSeed,
  Interceptor,
} from '../../types/index.js'
import type { EventDeliveryOptions } from '../../core/event-delivery.js'
import type { ChannelOptions } from '../../channels/index.js'
import type { HttpMiddleware } from '../../adapters/http.js'
import type { DiscoveryConfig } from '../fs-routes/index.js'
import type { GraphQLOptions } from '../../graphql/index.js'
import type { Codec } from '../../utils/content-codecs.js'
import type { EnvelopeConfig } from '../../middleware/types.js'
import type { SessionConfig } from '../../middleware/session/types.js'
import type { PolicyConfig } from '../../middleware/policy/types.js'
import type {
  RuntimeInspectionContribution,
  RuntimeInspectionGraph,
} from '../../inspect/index.js'
import type { TrustedProxyConfig } from '../../utils/client-ip.js'
import type {
  RaffelServer,
  ProtocolExtensionConfig,
} from './lifecycle-types.js'

// === Providers (Dependency Injection) ===

/**
 * Resolved provider instances (after initialization).
 */
export type ResolvedProviders = Record<string, unknown>

/**
 * Provider factory function.
 * Called once at server startup to create the singleton instance.
 */
export type ProviderFactory<T> = (services: Readonly<ResolvedProviders>) => T | Promise<T>

/**
 * Provider definition with optional lifecycle hooks.
 */
export interface ProviderDefinition<T = unknown> {
  /** Factory function to create the provider instance */
  factory: ProviderFactory<T>
  /** Called on server shutdown */
  onShutdown?: (instance: T) => void | Promise<void>
}

/**
 * Map of provider names to their definitions or factory functions.
 */
export type ProvidersConfig = Record<string, ProviderFactory<unknown> | ProviderDefinition<unknown>>

// === Server Plugins (Runtime Extensions) ===

export interface ServerPluginRegisterContext {
  server: RaffelServer
}

export interface ServerPluginRuntimeContext {
  server: RaffelServer
  providers: Readonly<ResolvedProviders>
  signal: AbortSignal
}

export interface ServerPluginInspectContext {
  server: RaffelServer
  providers: Readonly<ResolvedProviders>
  preview: RuntimeInspectionGraph
}

export interface ServerPlugin {
  name: string
  register?: (context: ServerPluginRegisterContext) => void
  beforeStart?: (context: ServerPluginRuntimeContext) => void | Promise<void>
  afterStart?: (context: ServerPluginRuntimeContext) => void | Promise<void>
  beforeStop?: (context: ServerPluginRuntimeContext) => void | Promise<void>
  afterStop?: (context: ServerPluginRuntimeContext) => void | Promise<void>
  inspect?: (
    context: ServerPluginInspectContext
  ) => RuntimeInspectionContribution | RuntimeInspectionContribution[] | null | undefined
}

// === Error Handling ===

/**
 * Protocol identifier for error context
 */
export type ErrorProtocol = 'http' | 'websocket' | 'jsonrpc' | 'grpc' | 'streams' | 'tcp' | 'udp' | 'graphql'

/**
 * Normalized error information for cross-protocol consistency
 */
export interface NormalizedError {
  /** String error code (e.g., 'NOT_FOUND', 'VALIDATION_ERROR') */
  code: string
  /** Numeric status (HTTP-compatible) */
  status: number
  /** Human-readable error message */
  message: string
  /** Additional error details */
  details?: unknown
  /** Original error */
  cause?: Error
  /** Stack trace (only in development) */
  stack?: string
}

/**
 * Global error handler function type
 *
 * @param error - The original error (may be RaffelError, HttpError, or plain Error)
 * @param protocol - The protocol where the error occurred
 * @param ctx - Request context (if available)
 */
export type GlobalErrorHandler = (
  error: Error,
  protocol: ErrorProtocol,
  ctx?: Context
) => void | Promise<void>

// === Server Options ===

export type FrontDoorTransport =
  | 'http'
  | 'websocket'
  | 'jsonrpc'
  | 'tcp'
  | 'udp'
  | 'grpc'
  | 'graphql'
  | 'rpc'
  | 'jrpc'
  | (string & {})

export type SinglePortProtocolKind =
  | 'http'
  | 'websocket'
  | 'jsonrpc'
  | 'tcp'
  | 'udp'
  | 'grpc'
  | 'graphql'
  | 'tls'
  | 'http2'
  | 'unknown'
  | (string & {})

export type SinglePortDecisionReason =
  | 'matched'
  | 'unsupported'
  | 'timeout'
  | 'limit_exceeded'
  | 'concurrency_limit'
  | 'unknown'

export type ProtocolFusionMode =
  | 'disabled'
  | 'front-door'
  | 'shared-port'
  | 'front-door+shared-port'

export type ProtocolFusionLayer = 'front-door' | 'shared-port'

export type ProtocolFusionOutcome = 'route' | 'fallback' | 'reject'

export interface ProtocolDecisionPayload {
  protocol: SinglePortProtocolKind
  detector: string
  reason: SinglePortDecisionReason
  elapsedMs: number
  bytesRead: number
  timedOut: boolean
}

export interface ProtocolFusionDecision {
  timestamp: string
  mode: ProtocolFusionMode
  entrypoint: 'http' | 'tcp'
  layer: ProtocolFusionLayer
  protocol: string
  outcome: ProtocolFusionOutcome
  reason: string
  detector?: string
  strategy?: FrontDoorStrategy
  elapsedMs?: number
  bytesRead?: number
  timedOut?: boolean
  connectionId?: string
  request?: {
    method?: string
    path?: string
    upgrade?: string
  }
  source?: {
    address?: string
    port?: number
  }
  target: {
    host: string
    port: number
  }
  allowedProtocols?: string[]
}

export interface ProtocolFusionState {
  enabled: boolean
  mode: ProtocolFusionMode
  entrypoint: 'http' | 'tcp'
  target: {
    host: string
    port: number
  }
  frontDoorProtocols: FrontDoorTransport[] | null
  sharedPortProtocols?: SinglePortProtocolKind[]
  recentDecisions: ProtocolFusionDecision[]
}

export interface ProtocolSnifferContext {
  remoteAddress?: string
  remotePort?: number
  connectionId?: string
  protocol?: string
  bytesRead: number
}

export interface ProtocolSniffer {
  name: string
  detect(input: {
    chunk: Buffer
    bytesRead: number
    context?: ProtocolSnifferContext
  }): SinglePortProtocolKind | null
}

export type ProtocolAliasMode = 'standard' | 'extended'

export interface SinglePortConfig {
  /** Enable single-port transport fusion mode */
  enabled?: boolean
  /** Alias for enabled */
  protocolFusion?: boolean
  /** TLS key for HTTPS on single-port */
  cert?: string | Buffer
  /** TLS certificate chain for single-port */
  key?: string | Buffer
  /** Optional ALPN values to pass to TLS handshakes */
  alpn?: string[]
  /** Max bytes read before protocol fallback/timeout */
  sniffMaxBytes?: number
  /** Max ms allowed per detection cycle */
  sniffTimeoutMs?: number
  /** Max concurrent detections in progress */
  maxConcurrentDetections?: number
  /** Custom protocol sniffers for shared TCP listener */
  sniffers?: ProtocolSniffer[]
  /** Optional protocol allowlist for single-port detection.
   * If omitted, all default detectors are executed.
   */
  protocols?: SinglePortProtocolKind[]

  /**
   * Alias expansion mode for single-port protocol names.
   * `standard` keeps built-in aliases minimal and strict.
   * `extended` enables the full alias set (`icmp`, `whois`, `telnet`, etc.).
   * If omitted, inherits from `protocolAliasMode` in `ServerOptions`.
   */
  protocolAliasMode?: ProtocolAliasMode
}

export interface ProtocolPreviewConfig {
  enabled: boolean
  shared?: boolean
  frontDoor?: boolean
  strategy?: FrontDoorStrategy
  path?: string
  host?: string
  port?: number
  source?: 'singlePort' | 'offload' | 'native' | 'custom' | 'unknown'
}

export interface ServerPresetOptions {
  websocketPath?: string
  jsonrpcPath?: string
  graphqlPath?: string
}

export type ServerPreset = 'api' | 'realtime' | 'rpc' | 'dev' | 'full'

export interface SharedPortPreviewConfig {
  enabled: boolean
  protocolFusion: boolean
  protocolAliasMode: ProtocolAliasMode
  sniffMaxBytes: number
  sniffTimeoutMs: number
  maxConcurrentDetections: number
  sniffers?: string[]
  protocols?: SinglePortProtocolKind[]
}

export interface ServerConfigPreview {
  entrypoint: {
    host: string
    port: number
    source: 'frontDoor' | 'native'
  }
  protocolFusion: {
    enabled: boolean
    mode: ProtocolFusionMode
    entrypoint: 'http' | 'tcp'
  }
  frontDoor: {
    enabled: boolean
    host: string
    port: number
    protocols: FrontDoorTransport[] | null
    protocolAliasMode: ProtocolAliasMode
  }
  sharedPort: SharedPortPreviewConfig
  singlePort: SharedPortPreviewConfig
  protocols: {
    http: {
      enabled: true
      shared: true
      source: 'singlePort' | 'offload' | 'native' | 'custom' | 'unknown'
    }
    websocket?: ProtocolPreviewConfig
    jsonrpc?: ProtocolPreviewConfig
    graphql?: ProtocolPreviewConfig
    tcp?: ProtocolPreviewConfig
    grpc?: ProtocolPreviewConfig
    streams?: {
      enabled: boolean
    }
  }
  warnings: string[]
}

/**
 * Strategy for how a protocol is handled by the server entrypoint.
 */
export type FrontDoorStrategy = 'shared' | 'native' | 'offload'

/**
 * Front-door configuration for single entrypoint composition.
 */
export interface FrontDoorConfig {
  /** Enable unified front-door orchestration */
  enabled: boolean
  /** Port for the front-door listener */
  port?: number
  /** Host for the front-door listener */
  host?: string
  /**
   * Protocols allowed on the front-door.
   * If omitted, HTTP + WebSocket + JSON-RPC + GraphQL are included by default.
   * TCP/gRPC/UDP require explicit inclusion when front-door is enabled.
   */
  protocols?: FrontDoorTransport[]

  /**
   * Alias expansion mode for front-door protocol names.
   * `standard` keeps built-in aliases minimal and strict.
   * `extended` enables the full alias set (`icmp`, `whois`, `telnet`, etc.).
   * If omitted, inherits from `protocolAliasMode` in `ServerOptions`.
   */
  protocolAliasMode?: ProtocolAliasMode

  /** Optional per-protocol strategy */
  strategy?: Partial<Record<FrontDoorTransport, FrontDoorStrategy>>
}

export interface ServerOptions {
  // === Core ===

  /** Port to listen on (HTTP) */
  port: number
  /** Host to bind to (default: '0.0.0.0') */
  host?: string
  /** Base path for HTTP procedures (default: '/') */
  basePath?: string
  /** CORS configuration (default: enabled with '*') */
  cors?: CorsOptions | boolean
  /** HTTP adapter options */
  http?: HttpOptions

  /** Front-door entrypoint options */
  frontDoor?: FrontDoorConfig

  /**
   * Shared-port transport fusion options.
   * Canonical name for the TCP entrypoint multiplexer.
   */
  sharedPort?: SinglePortConfig

  /**
   * @deprecated Use `sharedPort`.
   * Unified single-port transport options.
   */
  singlePort?: SinglePortConfig

  /**
   * Global protocol alias expansion mode.
   * `standard` keeps aliasing strict and predictable.
   * `extended` enables more permissive alias resolution (`icmp`, `whois`, `telnet`, etc.).
   *
   * Defaults to `standard`.
   */
  protocolAliasMode?: ProtocolAliasMode

  // === Protocols ===

  /**
   * WebSocket configuration.
   * - `true` enables with defaults (path: '/')
   * - Object for custom configuration
   *
   * @example
   * ```typescript
   * // Quick enable
   * websocket: true
   *
   * // With channels
   * websocket: {
   *   path: '/ws',
   *   channels: {
   *     authorize: async (socketId, channel, ctx) => ctx.auth?.authenticated ?? false,
   *     presenceData: (socketId, channel, ctx) => ({ userId: ctx.auth?.principal }),
   *   }
   * }
   * ```
   */
  websocket?: WebSocketOptions | boolean

  /**
   * JSON-RPC configuration.
   * - `true` enables with defaults (path: '/rpc')
   * - Object for custom configuration
   */
  jsonrpc?: JsonRpcOptions | boolean

  /**
   * TCP configuration (always requires separate port).
   */
  tcp?: TcpOptions

  /**
   * GraphQL configuration.
   * - `true` enables with defaults (path: '/graphql', auto-generate schema)
   * - Object for custom configuration
   *
   * @example
   * ```typescript
   * // Quick enable
   * graphql: true
   *
   * // With configuration
   * graphql: {
   *   path: '/graphql',
   *   playground: true,
   *   subscriptions: true,
   *   schemaOptions: {
   *     procedureMapping: 'prefix', // get*, list* → Query, others → Mutation
   *   },
   * }
   * ```
   */
  graphql?: GraphQLOptions | boolean

  /**
   * gRPC configuration (requires a separate port).
   */
  grpc?: GrpcOptions

  /**
   * MCP (Model Context Protocol) configuration.
   *
   * - `true` enables with defaults (all procedures become MCP tools on /mcp)
   * - Object for custom configuration (filter, toolName, path, etc.)
   *
   * @example
   * ```typescript
   * const server = createServer({ port: 3000, mcp: true })
   * // or
   * const server = createServer({
   *   port: 3000,
   *   mcp: { path: '/mcp', filter: (meta) => meta.tags?.includes('public') },
   * })
   * ```
   */
  mcp?: import('../../protocols/mcp/types.js').McpAdapterOptions | boolean

  /**
   * Custom protocol adapters registered at startup.
   */
  protocolExtensions?: ProtocolExtensionConfig[]

  /**
   * Runtime plugins that can register handlers, attach lifecycle hooks, and
   * contribute framework-specific inspection metadata.
   */
  plugins?: ServerPlugin[]

  // === Middleware ===

  /**
   * Enable response envelope wrapper for all protocol responses.
   * - `true` enables default Standard envelope config.
   * - Object provides custom envelope settings.
   *
   * @example
   * ```typescript
   * createServer({
   *   port: 3000,
   *   envelope: true,
   * })
   *
   * createServer({
   *   port: 3000,
   *   envelope: { includeDuration: true },
   * })
   * ```
   */
  envelope?: boolean | EnvelopeConfig

  /**
   * Global middleware applied to all handlers.
   *
   * @example
   * ```typescript
   * middleware: [
   *   createAuthMiddleware({ ... }),
   *   createLoggingMiddleware(),
   *   createRateLimitInterceptor({ ... }),
   * ]
   * ```
   */
  middleware?: Interceptor[]

  // === File-System Discovery ===

  /**
   * Auto-discover handlers from file system (Next.js-style).
   * - `true` enables all defaults (./src/http, ./src/channels, ./src/rpc, ./src/streams, ./src/rest, ./src/resources, ./src/tcp, ./src/udp)
   * - Object for custom configuration
   *
   * This is separate from manual route definition (via `.procedure()`, `.stream()`, `.mount()`)
   * which can be used alongside or instead of discovery.
   *
   * @example
   * ```typescript
   * // Quick enable all
   * discovery: true
   *
   * // Custom paths
   * discovery: {
   *   http: './src/api',
   *   channels: './src/realtime',
   *   rpc: './src/rpc',
   *   streams: './src/streams',
   *   rest: './src/rest',
   *   resources: './src/resources',
   *   tcp: './src/tcp',
   *   udp: './src/udp',
   * }
   *
   * // Only HTTP and RPC
   * discovery: {
   *   http: true,
   *   rpc: './api/rpc',
   * }
   * ```
   */
  discovery?: DiscoveryConfig | boolean

  /**
   * Enable hot reload for discovered handlers in development.
   * @default true in development, false in production
   */
  hotReload?: boolean

  // === Providers (Dependency Injection) ===

  /**
   * Providers are singletons injected into the context of all handlers.
   * Use this to share database clients, services, configs, etc.
   *
   * @example
   * ```typescript
   * import { PrismaClient } from '@prisma/client'
   * import { Redis } from 'ioredis'
   *
   * const server = createServer({
   *   port: 3000,
   *   providers: {
   *     db: () => new PrismaClient(),
   *     cacheStore: () => new Redis(),
    *     config: () => ({
   *       apiKey: process.env.API_KEY,
   *       environment: process.env.NODE_ENV,
   *     }),
   *   },
   * })
   *
   * // In handlers (including discovered routes):
   * server.procedure('users.get').handler(async (input, ctx) => {
   *   return ctx.db.user.findUnique({ where: { id: input.id } })
   * })
   * ```
   */
  providers?: ProvidersConfig

  // === Session ===

  /**
   * Session store configuration.
   * Injects `ctx.session` into every handler via the session interceptor.
   *
   * - `driver: 'memory'` — in-memory store (dev/single-instance)
   * - `driver: 'custom'` — custom `SessionStore` instance (e.g. redis/session table adapter)
   *
   * Set to `false` to explicitly disable session support (default: disabled).
   *
   * @example
   * ```typescript
   * const server = createServer({
   *   port: 3000,
   *   session: {
   *     driver: 'memory',
   *     ttl: 3600,
   *     cookie: { name: 'sid', secure: true },
   *   },
   * })
   *
   * server.procedure('auth.login').handler(async (input, ctx) => {
   *   ctx.session.data.userId = input.userId
   *   ctx.session.touch()
   *   return { ok: true }
   * })
   * ```
   */
  session?: SessionConfig | false

  // === Policy (authorization) ===

  /**
   * Authorization policy configuration. Opt-in.
   *
   * When configured, procedures may declare `.authz({...})` to gate access by
   * principal + action + resource. The default driver is in-process and uses a
   * declarative match DSL plus inline `condition` functions.
   *
   * Pair with `session`, `oauth2`, or `oidc` and reference the source via
   * `principal.from`.
   *
   * @example
   * ```typescript
   * const server = createServer({
   *   port: 3000,
   *   session: { driver: 'memory' },
   *   policy: {
   *     principal: { from: 'session' },
   *     defaultMode: 'allow',
   *     policies: [
   *       {
   *         id: 'admins-everything',
   *         effect: 'allow',
   *         principals: ['group:admins'],
   *         actions: ['**'],
   *         resources: ['**'],
   *       },
   *     ],
   *   },
   * })
   *
   * server.procedure('lead.read')
   *   .authz({ resource: (input) => ({ type: 'lead', id: input.id, tenantId: input.tenantId }) })
   *   .handler(loadLead)
   * ```
   */
  policy?: PolicyConfig

  // === Advanced ===

  /** Event delivery configuration (for at-least-once/at-most-once) */
  eventDelivery?: EventDeliveryOptions

  // === Error Handling ===

  /**
   * Global error handler for all protocols.
   * Called when an error occurs in any handler (HTTP, WebSocket, Streams, JSON-RPC, etc.).
   *
   * @example
   * ```typescript
   * const server = createServer({
   *   port: 3000,
   *   onError: (error, protocol, ctx) => {
   *     console.error(`[${protocol}] Error:`, error.message)
   *     // Report to error tracking service
   *     errorTracker.captureException(error, { protocol, requestId: ctx?.requestId })
   *   },
   * })
   * ```
   */
  onError?: GlobalErrorHandler
}

export interface CorsOptions {
  /** Allowed origins (default: '*') */
  origin?: string | string[] | boolean
  /** Allowed HTTP methods */
  methods?: string[]
  /** Allowed headers */
  headers?: string[]
  /** Whether to allow credentials */
  credentials?: boolean
}

export interface HttpOptions {
  /** Maximum request body size in bytes (default: 1MB) */
  maxBodySize?: number

  /** Additional codecs for content negotiation */
  codecs?: Codec[]

  /**
   * HTTP middleware to run before routing.
   * Middleware that returns true indicates it handled the request.
   */
  middleware?: HttpMiddleware[]

  /** Context factory for creating request context */
  contextFactory?: (req: IncomingMessage) => ContextSeed | Promise<ContextSeed>

  /**
   * Trusted proxy IPs/CIDRs used to resolve client IP from forwarding headers.
   * When false, x-forwarded-for and x-real-ip are ignored for client IP resolution.
   * @default false
   */
  trustedProxies?: TrustedProxyConfig

  /**
   * TLS configuration for HTTPS.
   * - `true`: auto-generates a self-signed certificate for localhost
   * - `TlsOptions`: inline PEM, file paths (K8s volume mounts), or env vars (base64)
   */
  tls?: boolean | import('../../utils/tls.js').TlsOptions
}

// === Protocol Options ===

export interface WebSocketOptions {
  /** Port (if omitted, shares HTTP port via upgrade) */
  port?: number
  /** WebSocket path (default: '/') */
  path?: string
  /** Max payload size in bytes (default: 1MB) */
  maxPayloadSize?: number
  /** Heartbeat interval in ms (default: 30000, 0 to disable) */
  heartbeatInterval?: number
  /**
   * Enable Pusher-like channels for real-time pub/sub.
   *
   * @example
   * ```typescript
   * channels: {
   *   authorize: async (socketId, channel, ctx) => {
   *     if (channel.startsWith('private-') || channel.startsWith('presence-')) {
   *       return ctx.auth?.authenticated ?? false
   *     }
   *     return true
   *   },
   *   presenceData: (socketId, channel, ctx) => ({
   *     userId: ctx.auth?.principal,
   *     name: ctx.auth?.claims?.name,
   *   }),
   * }
   * ```
   */
  channels?: ChannelOptions
  /**
   * Context factory for creating auth context from WebSocket connection.
   * Called once per connection to establish the connection context.
   *
   * @example
   * ```typescript
   * contextFactory: (ws, req) => {
   *   const url = new URL(req.url, 'http://localhost')
   *   const token = url.searchParams.get('token')
   *   return {
   *     auth: token ? { authenticated: true, principal: token } : undefined,
   *   }
   * }
   * ```
   */
  contextFactory?: (
    ws: import('ws').WebSocket,
    req: import('http').IncomingMessage
  ) => ContextSeed | Promise<ContextSeed>

  /**
   * WebSocket authentication.
   *
   * Supports ticket-based (recommended for browsers), bearer token, or custom auth.
   *
   * @example
   * ```typescript
   * auth: {
   *   mode: 'ticket',
   *   ticketTTL: 30000,
   * }
   * ```
   */
  auth?: import('../../channels/types.js').WebSocketAuthConfig

  /**
   * Backpressure handling for slow consumers.
   * Prevents OOM from clients that can't keep up with message rate.
   *
   * @example
   * ```typescript
   * backpressure: {
   *   maxBufferedAmount: 1024 * 1024,  // 1MB
   *   strategy: 'drop',
   * }
   * ```
   */
  backpressure?: import('../../channels/types.js').BackpressureConfig
}

export interface JsonRpcOptions {
  /** Port (if omitted, shares HTTP port) */
  port?: number
  /** JSON-RPC endpoint path (default: '/rpc') */
  path?: string
  /** Request timeout in ms (default: 30000) */
  timeout?: number
  /** Max body size in bytes (default: 1MB) */
  maxBodySize?: number

  /** Additional codecs for content negotiation */
  codecs?: Codec[]
}

export interface TcpOptions {
  /** Port (required - TCP always needs separate port) */
  port: number
  /** Host to bind to (default: '0.0.0.0') */
  host?: string
  /** Max message size in bytes (default: 16MB) */
  maxMessageSize?: number
  /** Keep-alive interval in ms (default: 30000, 0 to disable) */
  keepAliveInterval?: number
}

export interface GrpcTlsOptions {
  /** Server private key */
  key: string | Buffer
  /** Server certificate chain */
  cert: string | Buffer
  /** Root CA certificates (optional) */
  ca?: string | Buffer
  /** Require client certificate */
  requireClientCert?: boolean
}

export interface GrpcOptions {
  /** Port to listen on */
  port: number
  /** Host to bind to (default: '0.0.0.0') */
  host?: string
  /** Proto file path(s) */
  protoPath: string | string[]
  /** Package name to scope services (optional) */
  packageName?: string
  /** Service names to register (optional) */
  serviceNames?: string[]
  /** Proto loader options */
  loaderOptions?: ProtoLoaderOptions
  /** TLS credentials */
  tls?: GrpcTlsOptions
  /** Max receive message length in bytes */
  maxReceiveMessageLength?: number
  /** Max send message length in bytes */
  maxSendMessageLength?: number
}
