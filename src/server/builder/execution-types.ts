import type { Interceptor } from '../../types/index.js'
import type { Registry } from '../../core/registry.js'
import type { Router } from '../../core/router.js'
import type { SchemaRegistry } from '../../validation/index.js'
import type { DiscoveryBootstrap } from '../discovery-bootstrap.js'
import type { createGrpcAdapter } from '../../adapters/grpc.js'
import type { createHttpAdapter } from '../../adapters/http.js'
import type { createJsonRpcAdapter } from '../../adapters/jsonrpc.js'
import type { createTcpAdapter, createTcpConnectionHandler } from '../../adapters/tcp.js'
import type { createWebSocketAdapter } from '../../adapters/websocket.js'
import type {
  createGraphQLAdapter,
  createGraphQLMiddleware,
} from '../../graphql/index.js'
import type {
  DiscoveryResult,
  LoadedChannel,
  LoadedRestResource,
  LoadedTcpHandler,
  LoadedUdpHandler,
  TcpServerInstance,
  UdpServerInstance,
} from '../fs-routes/index.js'
import type { createTcpServer } from '../fs-routes/tcp/index.js'
import type { createUdpServer } from '../fs-routes/udp/index.js'
import type { createPortBinding } from '../port-binding.js'
import type { RecordProtocolFusionDecisionInput } from '../protocol-fusion-diagnostics.js'
import type { TelemetryState } from '../telemetry-bootstrap.js'
import type {
  HttpOptions,
  ProtocolAdapter,
  ProtocolFusionDecision,
  ProviderDefinition,
  ResolvedProviders,
  WebSocketSubscribeHandler,
  WebSocketMessageHandler,
  WebSocketUnsubscribeHandler,
} from '../types.js'
import type { ServerLifecycleState } from './state.js'

export interface ServerLifecycleExecutionLogger {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}

export interface ServerLifecycleExecutionBootstrapContext {
  discoveryBootstrap: DiscoveryBootstrap
  telemetryState: TelemetryState
  applyDiscoveryResult: (result: DiscoveryResult) => void
}

export interface ServerLifecycleExecutionCoreContext {
  protocolAdapters: Map<string, ProtocolAdapter>
  providerDefinitions: Map<string, ProviderDefinition>
  resolvedProviders: ResolvedProviders
  registry: Registry
  schemaRegistry: SchemaRegistry
  router: Router
  globalInterceptors: Interceptor[]
  /**
   * Authorization snapshot — present only when `policy: { ... }` was passed
   * to `createServer`. Drives `x-usd.authz` in USD documents and similar
   * discovery surfaces.
   */
  getAuthzSnapshot?: () => {
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
  } | null
}

export interface ServerLifecycleExecutionHttpContext {
  channelRegistry: Map<string, LoadedChannel>
  restResourceRegistry: LoadedRestResource[]
  tcpHandlers: LoadedTcpHandler[]
  udpHandlers: LoadedUdpHandler[]
  tcpServers: TcpServerInstance[]
  udpServers: UdpServerInstance[]
  basePath: string
  httpOptions: HttpOptions | undefined
  wsInterceptors: Interceptor[]
  getWsSubscribeHandler: () => WebSocketSubscribeHandler | null | undefined
  getWsMessageHandler: () => WebSocketMessageHandler | null | undefined
  getWsUnsubscribeHandler: () => WebSocketUnsubscribeHandler | null | undefined
}

export interface ServerLifecycleExecutionRoutingContext {
  getSinglePortAliasMode: () => 'standard' | 'extended'
  recordProtocolFusionDecision?: (decision: RecordProtocolFusionDecisionInput) => ProtocolFusionDecision | void
  createFrontDoorDecisionMiddleware: () => any
}

export interface ServerLifecycleExecutionFactories {
  createGraphQLAdapter?: typeof createGraphQLAdapter
  createGraphQLMiddleware?: typeof createGraphQLMiddleware
  createGrpcAdapter?: typeof createGrpcAdapter
  createHttpAdapter?: typeof createHttpAdapter
  createJsonRpcAdapter?: typeof createJsonRpcAdapter
  createPortBinding?: typeof createPortBinding
  createTcpAdapter?: typeof createTcpAdapter
  createTcpConnectionHandler?: typeof createTcpConnectionHandler
  createTcpServer?: typeof createTcpServer
  createUdpServer?: typeof createUdpServer
  createWebSocketAdapter?: typeof createWebSocketAdapter
}

export interface ServerLifecycleExecutionContext {
  logger: ServerLifecycleExecutionLogger
  state: ServerLifecycleState
  bootstrap: ServerLifecycleExecutionBootstrapContext
  core: ServerLifecycleExecutionCoreContext
  http: ServerLifecycleExecutionHttpContext
  routing: ServerLifecycleExecutionRoutingContext
  factories?: ServerLifecycleExecutionFactories
}
