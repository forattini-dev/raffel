import type { Interceptor } from '../../types/index.js'
import type { Registry } from '../../core/registry.js'
import type { Router } from '../../core/router.js'
import type { SchemaRegistry } from '../../validation/index.js'
import type { DiscoveryBootstrap } from '../discovery-bootstrap.js'
import type {
  DiscoveryResult,
  LoadedChannel,
  LoadedRestResource,
  LoadedTcpHandler,
  LoadedUdpHandler,
  TcpServerInstance,
  UdpServerInstance,
} from '../fs-routes/index.js'
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

export interface ServerLifecycleExecutionContext {
  logger: ServerLifecycleExecutionLogger
  state: ServerLifecycleState
  bootstrap: ServerLifecycleExecutionBootstrapContext
  core: ServerLifecycleExecutionCoreContext
  http: ServerLifecycleExecutionHttpContext
  routing: ServerLifecycleExecutionRoutingContext
}
