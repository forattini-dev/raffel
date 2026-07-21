import { initializeTelemetry, type StopTask } from '../telemetry-bootstrap.js'
import type {
  ServerRuntimeDiscoveryStep,
  ServerRuntimeProviderStep,
  ServerRuntimeTelemetryStep,
} from '../runtime-plan.js'
import type { ServerLifecycleExecutionContext } from './execution-types.js'

const RESERVED_CONTEXT_KEYS = new Set([
  'requestId',
  'auth',
  'tracing',
  'signal',
  'deadline',
  'input',
  'services',
  'logger',
  'protocol',
  'contract',
  'http',
  'ws',
  'rpc',
  'graphql',
  'grpc',
  'tcp',
  'udp',
  'smtp',
  'stream',
  'extensions',
  'call',
  'callingLevel',
])

export function createExecutionBootstrap(context: ServerLifecycleExecutionContext) {
  const { logger, state } = context
  const { discoveryBootstrap, telemetryState, applyDiscoveryResult } = context.bootstrap
  const {
    protocolAdapters,
    providerDefinitions,
    resolvedProviders,
    registry,
    router,
    globalInterceptors,
  } = context.core
  const { tcpServers, udpServers } = context.http

  function resetRuntimeState() {
    state.activeShutdownPlan.value = null
    state.addresses.value = null
    state.portBinding.value = null
    state.singlePortTcpConnectionHandler.value = null
    state.singlePortGrpcConnectionHandler.value = null
    state.httpServer.value = null
    state.wsAdapter.value = null
    state.jsonRpcAdapter.value = null
    state.tcpAdapter.value = null
    state.grpcAdapter.value = null
    state.graphqlAdapter.value = null
    state.graphqlMiddleware.value = null
    state.graphqlSubscriptionServer.value = null
    state.usdDocsHandlers.value = null
    state.running.value = false
    protocolAdapters.clear()
    tcpServers.length = 0
    udpServers.length = 0
  }

  async function executeProviderStep(step: ServerRuntimeProviderStep) {
    if (step.kind !== 'providers' || providerDefinitions.size === 0) {
      return
    }

    logger.debug({ count: providerDefinitions.size }, 'Initializing providers')
    for (const [name, definition] of providerDefinitions) {
      try {
        const instance = await definition.factory(Object.freeze({ ...resolvedProviders }))
        resolvedProviders[name] = instance
        logger.debug({ name }, 'Provider initialized')
      } catch (err) {
        logger.error({ err, name }, 'Failed to initialize provider')
        throw err
      }
    }

    if (!state.providerMiddlewareInstalled.value) {
      router.use(async (_env: unknown, ctx: unknown, next: () => Promise<unknown>) => {
        const ctxAny = ctx as Record<string, unknown>

        ctxAny.services = Object.freeze({
          ...((ctxAny.services as Record<string, unknown> | undefined) ?? {}),
          ...resolvedProviders,
        })

        for (const [name, instance] of Object.entries(resolvedProviders)) {
          if (RESERVED_CONTEXT_KEYS.has(name)) {
            continue
          }
          ctxAny[name] = instance
        }
        return next()
      })
      state.providerMiddlewareInstalled.value = true
    }
  }

  async function executeTelemetryStep(
    step: ServerRuntimeTelemetryStep,
    registerStopTask: (task: StopTask) => void
  ) {
    if (step.kind !== 'telemetry') {
      return
    }

    await initializeTelemetry(telemetryState, {
      registry,
      router,
      startupStopTasks: [],
      registerStopTask,
      globalInterceptors,
      logger: {
        debug: logger.debug.bind(logger),
        info: logger.info.bind(logger),
      },
    })
  }

  async function executeDiscoveryStep(
    step: ServerRuntimeDiscoveryStep,
    registerStopTask: (task: StopTask) => void
  ) {
    if (step.kind !== 'discovery') {
      return
    }

    const discoveryResult = await discoveryBootstrap.start()
    if (!discoveryResult) {
      return
    }

    applyDiscoveryResult(discoveryResult)
    registerStopTask({
      name: 'discovery-watcher',
      stop: async () => {
        discoveryBootstrap.stop()
      },
    })
  }

  return {
    resetRuntimeState,
    executeProviderStep,
    executeTelemetryStep,
    executeDiscoveryStep,
  }
}
