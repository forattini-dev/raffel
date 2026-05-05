import type { Registry } from '../../core/registry.js'
import type { Router } from '../../core/router.js'
import type { HttpAdapter } from '../../adapters/http.js'
import type { GraphQLOptions } from '../../graphql/index.js'
import type { SchemaRegistry } from '../../validation/index.js'
import type { ResolvedProviders, FrontDoorStrategy, WebSocketOptions, JsonRpcOptions, TcpOptions, GrpcOptions } from './config-types.js'

// === Address Info ===

export interface AddressInfo {
  host: string
  port: number
}

export type ProtocolAddress = AddressInfo & { path?: string; shared?: boolean; source?: 'singlePort' | 'offload' | 'native' | 'custom' | 'unknown' }

export type FrontDoorProtocolAddress = ProtocolAddress & {
  frontDoor?: boolean
  strategy?: FrontDoorStrategy
}

export interface ServerAddresses {
  http: FrontDoorProtocolAddress
  websocket?: FrontDoorProtocolAddress & { path: string; shared: boolean }
  jsonrpc?: FrontDoorProtocolAddress & { path: string; shared: boolean }
  graphql?: FrontDoorProtocolAddress & { path: string; shared: boolean }
  grpc?: FrontDoorProtocolAddress
  tcp?: FrontDoorProtocolAddress
  udp?: FrontDoorProtocolAddress
  protocols?: Record<string, ProtocolAddress>
}

// === Server Builder ===

/**
 * Unified protocol configuration for enabling multiple protocols at once.
 *
 * @example
 * ```typescript
 * const server = createServer({ port: 3000 })
 *   .protocols({
 *     http: true,                    // Already enabled by default
 *     websocket: { path: '/ws' },    // Enable WebSocket at /ws
 *     jsonrpc: '/rpc',               // Enable JSON-RPC at /rpc
 *     streams: true,                 // Enable SSE streams
 *     graphql: { path: '/graphql' }, // Enable GraphQL
 *   })
 * ```
 */
export interface UnifiedProtocolConfig {
  /** HTTP is enabled by default. Set to false to disable */
  http?: boolean
  /** WebSocket: boolean to enable on /ws, string for custom path, or full options */
  websocket?: boolean | string | WebSocketOptions
  /** JSON-RPC: boolean to enable on /rpc, string for custom path, or full options */
  jsonrpc?: boolean | string | JsonRpcOptions
  /** SSE Streams: boolean to enable on /streams, string for custom path */
  streams?: boolean | string
  /** GraphQL: boolean to enable on /graphql, string for custom path, or full options */
  graphql?: boolean | string | GraphQLOptions
  /** TCP: requires explicit port */
  tcp?: TcpOptions
  /** gRPC: requires proto path */
  grpc?: GrpcOptions
}

/**
 * Extended protocol configuration with per-protocol `enabled` toggle and UDP support.
 * Used by `withProtocols()` for richer DX.
 */
export interface ExtendedProtocolConfig {
  /** HTTP is enabled by default */
  http?: boolean | { enabled: boolean }
  /** WebSocket: toggle + optional path/options */
  websocket?: boolean | string | WebSocketOptions | ({ enabled: boolean } & Partial<WebSocketOptions>)
  /** JSON-RPC: toggle + optional path/options */
  jsonrpc?: boolean | string | JsonRpcOptions | ({ enabled: boolean } & Partial<JsonRpcOptions>)
  /** SSE Streams: toggle + optional path */
  streams?: boolean | string
  /** GraphQL: toggle + optional path/options */
  graphql?: boolean | string | GraphQLOptions | ({ enabled: boolean } & Partial<GraphQLOptions>)
  /** TCP: toggle + optional port/options (port required when enabled) */
  tcp?: TcpOptions | ({ enabled: boolean } & Partial<TcpOptions>)
  /** UDP: test-scope marker only, no production adapter */
  udp?: boolean | { enabled: boolean }
  /** gRPC: toggle + optional options (protoPath required when enabled) */
  grpc?: GrpcOptions | ({ enabled: boolean } & Partial<GrpcOptions>)
}

/**
 * Environment profile for `withProfile()`.
 * - `local`: development/mock mode with extended protocol aliases
 * - `staging`: neutral defaults
 * - `production`: production hardening with warnings for dev-only options
 */
export type ServerProfile = 'local' | 'staging' | 'production'

export interface ProtocolAdapterContext {
  router: Router
  registry: Registry
  schemaRegistry: SchemaRegistry
  httpServer: HttpAdapter | null
  basePath: string
  host: string
  port: number
  providers: ResolvedProviders
}

export interface ProtocolAdapter {
  start(): Promise<void>
  stop(): Promise<void>
  address?: ProtocolAddress
}

export type ProtocolAdapterFactory<TOptions = unknown> = (
  context: ProtocolAdapterContext,
  options: TOptions
) => ProtocolAdapter | Promise<ProtocolAdapter>

export interface ProtocolExtensionConfig<TOptions = unknown> {
  name: string
  factory: ProtocolAdapterFactory<TOptions>
  options?: TOptions
}
