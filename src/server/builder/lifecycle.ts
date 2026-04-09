import type { HttpMiddleware } from '../../adapters/http.js'
import type { DiscoveryBootstrap } from '../discovery-bootstrap.js'
import type { StopTask, TelemetryState } from '../telemetry-bootstrap.js'
import type { Interceptor } from '../../types/index.js'
import type {
  ProtocolFusionDecision,
  ProtocolAdapter,
  ProviderDefinition,
  ResolvedProviders,
  ServerAddresses,
  HttpOptions,
  WebSocketSubscribeHandler,
  WebSocketMessageHandler,
  WebSocketUnsubscribeHandler,
} from '../types.js'
import type { RecordProtocolFusionDecisionInput } from '../protocol-fusion-diagnostics.js'
import type {
  DiscoveryResult,
  LoadedChannel,
  LoadedRestResource,
  LoadedTcpHandler,
  LoadedUdpHandler,
  TcpServerInstance,
  UdpServerInstance,
} from '../fs-routes/index.js'
import type { Registry } from '../../core/registry.js'
import type { Router } from '../../core/router.js'
import type { SchemaRegistry } from '../../validation/index.js'
import {
  cleanupResolvedProviders as cleanupResolvedProvidersInternal,
  createRuntimeTaskRegistry,
  runActiveShutdownPlan,
  type ActiveShutdownPlan,
} from './lifecycle-utils.js'
import {
  createServerLifecycleExecution,
} from './execution.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'
import type { Logger } from 'pino'
import type {
  ServerRuntimePlan,
  ServerRuntimeShutdownPhase,
} from '../runtime-plan.js'
import type {
  ServerLifecycleState,
} from './state.js'

export interface ServerLifecycleContext {
  logger: {
    debug: (...args: unknown[]) => void
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }

  state: ServerLifecycleState

  discoveryBootstrap: DiscoveryBootstrap
  telemetryState: TelemetryState

  protocolAdapters: Map<string, ProtocolAdapter>
  providerDefinitions: Map<string, ProviderDefinition>
  resolvedProviders: ResolvedProviders

  registry: Registry
  schemaRegistry: SchemaRegistry
  router: Router
  globalInterceptors: Interceptor[]
  channelRegistry: Map<string, LoadedChannel>
  restResourceRegistry: LoadedRestResource[]
  tcpHandlers: LoadedTcpHandler[]
  udpHandlers: LoadedUdpHandler[]
  tcpServers: TcpServerInstance[]
  udpServers: UdpServerInstance[]
  wsInterceptors: Interceptor[]

  getRuntimePlan: () => ServerRuntimePlan
  getSinglePortAliasMode: () => 'standard' | 'extended'
  recordProtocolFusionDecision?: (decision: RecordProtocolFusionDecisionInput) => ProtocolFusionDecision | void
  createFrontDoorDecisionMiddleware: () => any
  applyDiscoveryResult: (result: DiscoveryResult) => void
  logSinglePortConfig: () => void

  basePath: string
  httpOptions: HttpOptions | undefined
  getWsSubscribeHandler: () => WebSocketSubscribeHandler | null | undefined
  getWsMessageHandler: () => WebSocketMessageHandler | null | undefined
  getWsUnsubscribeHandler: () => WebSocketUnsubscribeHandler | null | undefined
}

export function createServerLifecycle(context: ServerLifecycleContext) {
  const {
    logger,
    state,
    discoveryBootstrap,
    telemetryState,
    protocolAdapters,
    providerDefinitions,
    resolvedProviders,
    registry,
    schemaRegistry,
    getRuntimePlan,
    globalInterceptors,
    channelRegistry,
    restResourceRegistry,
    tcpHandlers,
    udpHandlers,
    tcpServers,
    udpServers,
    wsInterceptors,
    getSinglePortAliasMode,
    recordProtocolFusionDecision,
    createFrontDoorDecisionMiddleware,
    applyDiscoveryResult,
    logSinglePortConfig,
    basePath,
    httpOptions,
    getWsSubscribeHandler,
    getWsMessageHandler,
    getWsUnsubscribeHandler,
    router,
  } = context
  const lifecycleLogger = logger as unknown as Logger
  const executionContext: ServerLifecycleExecutionContext = {
    logger,
    state,
    bootstrap: {
      discoveryBootstrap,
      telemetryState,
      applyDiscoveryResult,
    },
    core: {
      protocolAdapters,
      providerDefinitions,
      resolvedProviders,
      registry,
      schemaRegistry,
      router,
      globalInterceptors,
    },
    http: {
      channelRegistry,
      restResourceRegistry,
      tcpHandlers,
      udpHandlers,
      tcpServers,
      udpServers,
      basePath,
      httpOptions,
      wsInterceptors,
      getWsSubscribeHandler,
      getWsMessageHandler,
      getWsUnsubscribeHandler,
    },
    routing: {
      getSinglePortAliasMode,
      recordProtocolFusionDecision,
      createFrontDoorDecisionMiddleware,
    },
  }
  const { executeStartupPhase, resetRuntimeState } = createServerLifecycleExecution(executionContext)

  function clonePlannedAddresses(addresses: ServerAddresses): ServerAddresses {
    return addresses.protocols
      ? {
          ...addresses,
          protocols: { ...addresses.protocols },
        }
      : { ...addresses }
  }

  async function cleanupProviders(phase: 'startup' | 'shutdown') {
    await cleanupResolvedProvidersInternal(
      resolvedProviders,
      providerDefinitions,
      phase,
      lifecycleLogger
    )
  }

  async function start() {
    if (state.running.value) {
      throw new Error('Server is already running')
    }

    const taskRegistry = createRuntimeTaskRegistry()
    const registerStopTask = (phase: ServerRuntimeShutdownPhase, task: StopTask) => {
      taskRegistry.register(phase, task)
    }
    let runtimePlan: ServerRuntimePlan | null = null

    try {
      logSinglePortConfig()
      runtimePlan = getRuntimePlan()
      state.addresses.value = clonePlannedAddresses(runtimePlan.addresses)

      const httpMiddleware: HttpMiddleware[] = []
      for (const phase of runtimePlan.execution.startup) {
        await executeStartupPhase(runtimePlan, phase, httpMiddleware, registerStopTask)
      }

      state.activeShutdownPlan.value = taskRegistry.snapshot(runtimePlan.execution.shutdown)
      state.running.value = true
    } catch (err) {
      state.activeShutdownPlan.value = null
      if (runtimePlan) {
        await runActiveShutdownPlan(
          taskRegistry.snapshot(runtimePlan.execution.shutdown),
          lifecycleLogger,
          {
            providers: async () => cleanupProviders('startup'),
          }
        )
      } else {
        await cleanupProviders('startup')
        await taskRegistry.rollback(lifecycleLogger)
      }
      resetRuntimeState()
      throw err
    }
  }

  async function stop() {
    if (!state.running.value) return

    const activeShutdownPlan = state.activeShutdownPlan.value
    state.activeShutdownPlan.value = null

    if (activeShutdownPlan) {
      await runActiveShutdownPlan(activeShutdownPlan, lifecycleLogger, {
        providers: async () => cleanupProviders('shutdown'),
      })
    } else {
      await cleanupProviders('shutdown')
    }

    resetRuntimeState()
    router.stop()
  }

  return { start, stop }
}
