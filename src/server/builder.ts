/**
 * Server Builder Implementation
 *
 * Unified server builder with fluent API for multi-protocol support.
 */

import type { z } from 'zod'
import type { PortBinding } from './port-binding.js'
import { createRegistry } from '../core/registry.js'
import { createRouter } from '../core/router.js'
import type { HttpAdapter } from '../adapters/http.js'
import type { WebSocketAdapter } from '../adapters/websocket.js'
import type { TcpAdapter, TcpConnectionHandler } from '../adapters/tcp.js'
import type { GrpcAdapter } from '../adapters/grpc.js'
import type { JsonRpcAdapter } from '../adapters/jsonrpc.js'
import type { GraphQLAdapter, GraphQLMiddleware } from '../graphql/index.js'
import { getRouterModuleDefinition } from './router-module.js'
import { createSchemaRegistry } from '../validation/index.js'
import { isAsyncIterable } from '../utils/type-guards.js'
import type { Interceptor, ProcedureHandler, StreamHandler, EventHandler } from '../types/index.js'
import type { HandlerSchema } from '../validation/index.js'
import { createEnvelopeInterceptor, createStandardEnvelopeInterceptor } from '../middleware/interceptors/envelope.js'
import type { EnvelopeConfig } from '../middleware/types.js'
import type {
  ServerOptions,
  WebSocketOptions,
  JsonRpcOptions,
  TcpOptions,
  GrpcOptions,
  ServerAddresses,
  SinglePortConfig,
  ServerPreset,
  ServerPresetOptions,
  RaffelServer,
  RouterModule,
  MountOptions,
  AddProcedureInput,
  AddStreamInput,
  AddEventInput,
  ProviderFactory,
  ProviderDefinition,
  ResolvedProviders,
  ServerPlugin,
  GlobalHooksConfig,
  ProtocolAdapter,
  ProtocolExtensionConfig,
  ExtendedProtocolConfig,
  ServerProfile,
} from './types.js'
import type { GraphQLOptions } from '../graphql/index.js'
import type { USDHandlers } from '../docs/index.js'
import type { USDDocsConfig } from './types.js'
import {
  createRouteInterceptors,
  isDevelopment,
  generateResourceRoutes,
  type DiscoveryResult,
  type LoadedRoute,
  type LoadedChannel,
  type LoadedRestResource,
  type LoadedResource,
  type LoadedTcpHandler,
  type LoadedUdpHandler,
  type TcpServerInstance,
  type UdpServerInstance,
} from './fs-routes/index.js'
import { createLogger } from '../utils/logger.js'
import { createPolicyBootstrap } from '../middleware/policy/index.js'
import type { ProcedurePolicyConfig } from '../middleware/policy/types.js'
import type { PolicyEnginePort } from '../ports/outbound/policy-engine.js'
import {
  createProcedureBuilder,
  createStreamBuilder,
  createEventBuilder,
  createGroupBuilder,
  joinHandlerName,
} from './handler-builders.js'
import { createResourceBuilder } from './resource-builder.js'
import { registerDiscoveredHandlers, resolveHooksForProcedure } from './discovery-utils.js'
import { createRegistrationService } from './orchestration/registration.js'
import { createRuntimePreviewService } from './orchestration/runtime-preview.js'
import { normalizeInterceptors as normalizeInterceptorsShared } from './interceptor-utils.js'
import { createFrontDoorBootstrap } from './front-door.js'
import { createProtocolFusionDiagnosticsStore } from './protocol-fusion-diagnostics.js'
import { createDiscoveryBootstrap } from './discovery-bootstrap.js'
import { createServerLifecycle } from './builder/lifecycle.js'
import {
  configureMetrics,
  configureTracing,
  createTelemetryState,
  type TelemetryState,
} from './telemetry-bootstrap.js'
import type { ContractPolicies } from '../types/index.js'
import { mergeContractPolicies } from '../types/policies.js'
import {
  type RuntimeInspectionContribution,
  type RuntimeInspectionGraph,
  type RuntimeInspectionOperationRegistration,
  type RuntimeInspectionSource,
} from '../inspect/index.js'
import { adaptPinoLogger } from '../adapters/outbound/logger/pino.js'
import { createServerPlanner } from './planner.js'
import { createServerRuntimePlanBuilder } from './runtime-plan.js'
import type { ServerLifecycleState } from './builder/state.js'
import {
  createHttpNamespace,
  createWebSocketNamespace,
  createStreamsNamespace,
  createRpcNamespace,
  createTcpNamespace,
  createUdpNamespace,
  createGrpcNamespace,
} from './builder/protocol-namespaces.js'

const logger = createLogger('server')
const loggerPort = adaptPinoLogger(logger)

function policyMetadataFromRouteMeta(
  meta: {
    auth?: 'required' | 'optional' | 'none'
    roles?: string[]
    rateLimit?: { limit: number; window: number }
  } | undefined
): ContractPolicies | undefined {
  if (!meta) return undefined

  return mergeContractPolicies(
    meta.auth && meta.auth !== 'none'
      ? {
          auth: {
            mode: meta.auth,
            ...(meta.roles && meta.roles.length > 0 && { roles: meta.roles }),
          },
        }
      : undefined,
    meta.rateLimit
      ? {
          rateLimit: {
            maxRequests: meta.rateLimit.limit,
            windowMs: meta.rateLimit.window,
          },
        }
      : undefined
  )
}

/**
 * Create a unified Raffel server
 */
export function createServer(options: ServerOptions): RaffelServer {
  const {
    port,
    host = '0.0.0.0',
    basePath = '/',
    cors = true,
    eventDelivery,
    websocket,
    jsonrpc,
    tcp,
    grpc,
    graphql,
    middleware,
    http: httpOptions,
    frontDoor,
    sharedPort,
    singlePort,
    envelope,
    discovery,
    hotReload = isDevelopment(),
    providers: initialProviders,
    plugins: initialPlugins,
    protocolExtensions: initialProtocolExtensions,
    protocolAliasMode: serverProtocolAliasMode = 'standard',
    mcp: mcpOptions,
  } = options

  // Core components
  const registry = createRegistry()
  const router = createRouter(registry, { eventDelivery })
  const schemaRegistry = createSchemaRegistry()
  const telemetryState: TelemetryState = createTelemetryState()

  const discoveryBootstrap = createDiscoveryBootstrap({
    discovery,
    hotReload,
    onLoad: (stats) => {
      logger.info(
        {
          http: stats.http,
          rpc: stats.rpc,
          streams: stats.streams,
          channels: stats.channels,
          rest: stats.rest,
          resources: stats.resources,
          tcp: stats.tcp,
          udp: stats.udp,
          duration: stats.duration,
        },
        `Discovered ${stats.total} handlers`
      )
    },
    onReload: async (result) => {
      applyDiscoveryResult(result)
      logger.info({ total: result.stats.total }, 'Handlers hot-reloaded')
    },
    onError: (err) => {
      logger.error({ err }, 'Discovery loading error')
    },
  })

  const serverPlanner = createServerPlanner({
    port,
    host,
    cors,
    httpOptions,
    frontDoor,
    sharedPort,
    singlePort,
    websocket,
    jsonrpc,
    tcp,
    grpc,
    graphql,
    serverProtocolAliasMode,
  })
  const protocols = serverPlanner.protocols
  const frontDoorEnabled = serverPlanner.frontDoorEnabled
  const frontDoorProtocols = serverPlanner.frontDoorProtocols
  const effectiveHost = serverPlanner.effectiveHost
  const effectivePort = serverPlanner.effectivePort
  const updateSinglePortConfig = serverPlanner.updateSinglePortConfig
  const getSinglePortAliasMode = serverPlanner.getSinglePortAliasMode
  const shouldUseFrontDoor = serverPlanner.shouldUseFrontDoor
  const strategyFor = serverPlanner.strategyFor
  const getSinglePortConfig = () => serverPlanner.singlePortConfig

  const protocolFusionDiagnostics = createProtocolFusionDiagnosticsStore({
    getMode: () => serverPlanner.resolveProtocolFusionMode(),
    getEntrypoint: () => (getSinglePortConfig().enabled ? 'tcp' : 'http'),
    getTarget: () => ({
      host: effectiveHost,
      port: effectivePort,
    }),
    getFrontDoorProtocols: () => frontDoorProtocols,
    getSharedPortProtocols: () => getSinglePortConfig().protocols,
  })

  const frontDoorBootstrap = createFrontDoorBootstrap({
    frontDoorEnabled,
    frontDoorProtocols,
    protocols,
    basePath,
    effectiveHost,
    effectivePort,
    onDecision: (decision) => protocolFusionDiagnostics.record(decision),
  })

  // Global interceptors (from options + added via .use())
  const globalInterceptors: Interceptor[] = middleware ? [...middleware] : []

  const envelopeInterceptor = createEnvelopeInterceptorFromOptions(envelope)
  if (envelopeInterceptor) {
    globalInterceptors.push(envelopeInterceptor)
  }

  // === Policy engine bootstrap (opt-in) ===
  const policyBootstrap = createPolicyBootstrap(options.policy, { logger: loggerPort })
  const policyEngine: PolicyEnginePort | undefined = policyBootstrap?.engine
  const policyInterceptorFactory:
    | ((procedureName: string, config: ProcedurePolicyConfig) => Interceptor)
    | undefined = policyBootstrap?.interceptorFactory
  const policyDefaultMode: 'allow' | 'deny' | undefined = policyBootstrap?.defaultMode
  const noPolicyDeclaredFactory: ((procedureName: string) => Interceptor) | undefined =
    policyBootstrap?.noPolicyDeclaredFactory

  function createEnvelopeInterceptorFromOptions(config?: boolean | EnvelopeConfig): Interceptor | undefined {
    if (config === undefined || config === false) {
      return undefined
    }

    if (config === true) {
      return createStandardEnvelopeInterceptor()
    }

    return createEnvelopeInterceptor(config)
  }

  function normalizeInterceptors(interceptors: Interceptor[], schema?: HandlerSchema): Interceptor[] {
    return normalizeInterceptorsShared(interceptors, {
      envelopeInterceptor,
      schema,
    })
  }

  // Namespace-level interceptors (for shared middleware per protocol)
  // These are persistent across getter calls, enabling shared middleware chains
  const httpInterceptors: Interceptor[] = []
  const wsInterceptors: Interceptor[] = []
  const streamInterceptors: Interceptor[] = []
  const rpcInterceptors: Interceptor[] = []
  const tcpInterceptors: Interceptor[] = []
  const udpInterceptors: Interceptor[] = []
  const grpcInterceptors: Interceptor[] = []
  let wsSubscribeHandler: import('./types.js').WebSocketSubscribeHandler | null = null
  let wsMessageHandler: import('./types.js').WebSocketMessageHandler | null = null
  let wsUnsubscribeHandler: import('./types.js').WebSocketUnsubscribeHandler | null = null

  // Global hooks configuration (added via .hooks())
  let globalHooks: GlobalHooksConfig = {}

  // Hooks resolver that closes over globalHooks (mutable by .hooks())
  const hooksResolver = (name: string) => resolveHooksForProcedure(name, globalHooks)

  // Runtime state shared with lifecycle module
  const serverState: ServerLifecycleState = {
    running: { value: false },
    addresses: { value: null as ServerAddresses | null },
    activeShutdownPlan: { value: null },
    providerMiddlewareInstalled: { value: false },
    portBinding: { value: null as PortBinding | null },
    singlePortTcpConnectionHandler: { value: null as TcpConnectionHandler | null },
    singlePortGrpcConnectionHandler: { value: null },
    httpServer: { value: null as HttpAdapter | null },
    wsAdapter: { value: null as WebSocketAdapter | null },
    jsonRpcAdapter: { value: null as JsonRpcAdapter | null },
    tcpAdapter: { value: null as TcpAdapter | null },
    grpcAdapter: { value: null as GrpcAdapter | null },
    graphqlAdapter: { value: null as GraphQLAdapter | null },
    graphqlMiddleware: { value: null as GraphQLMiddleware | null },
    graphqlSubscriptionServer: { value: null as ReturnType<GraphQLMiddleware['createSubscriptionServer']> | null },
    usdDocsHandlers: { value: null as USDHandlers | null },
  }
  const protocolExtensionConfigs: ProtocolExtensionConfig[] = []
  const protocolAdapters = new Map<string, ProtocolAdapter>()

  // USD Documentation
  let usdDocsConfig: USDDocsConfig | null = null

  // Provider definitions (added via .provide() or options.providers)
  const providerDefinitions = new Map<string, ProviderDefinition>()
  const resolvedProviders: ResolvedProviders = {}
  const registeredPlugins = new Map<string, ServerPlugin>()

  // Initialize provider definitions from options
  if (initialProviders) {
    for (const [name, config] of Object.entries(initialProviders)) {
      if (typeof config === 'function') {
        providerDefinitions.set(name, { factory: config })
      } else {
        providerDefinitions.set(name, config)
      }
    }
  }

  function registerProtocolExtension(config: ProtocolExtensionConfig): void {
    if (protocolExtensionConfigs.some((extension) => extension.name === config.name)) {
      throw new Error(`Protocol adapter "${config.name}" already registered`)
    }
    protocolExtensionConfigs.push(config)
  }

  if (initialProtocolExtensions) {
    for (const extension of initialProtocolExtensions) {
      registerProtocolExtension(extension)
    }
  }

  // Custom protocol handlers (added via .addTcpHandler()/.addUdpHandler())
  const tcpHandlers: LoadedTcpHandler[] = []
  const udpHandlers: LoadedUdpHandler[] = []
  const tcpServers: TcpServerInstance[] = []
  const udpServers: UdpServerInstance[] = []

  // Channel definitions discovered from filesystem or added manually
  const channelRegistry = new Map<string, LoadedChannel>()
  const operationRegistrations = new Map<string, RuntimeInspectionOperationRegistration>()

  // REST resources for HTTP routing
  const restResourceRegistry: LoadedRestResource[] = []

  function recordOperationRegistration(
    name: string,
    registration: RuntimeInspectionOperationRegistration
  ): void {
    operationRegistrations.set(name, registration)
  }

  function getPluginProviders(): Readonly<ResolvedProviders> {
    return Object.freeze({ ...resolvedProviders })
  }

  function getPluginsInStartOrder(): ServerPlugin[] {
    return [...registeredPlugins.values()]
  }

  function getPluginsInStopOrder(): ServerPlugin[] {
    return getPluginsInStartOrder().reverse()
  }

  async function runPluginRuntimeHooks(
    hookName: 'beforeStart' | 'afterStart' | 'beforeStop' | 'afterStop',
    plugins: ServerPlugin[],
    signal: AbortSignal
  ): Promise<void> {
    for (const plugin of plugins) {
      const hook = plugin[hookName]
      if (!hook) continue

      await hook({
        server,
        providers: getPluginProviders(),
        signal,
      })
    }
  }

  function getInspectionExtensions(
    preview: RuntimeInspectionGraph
  ): RuntimeInspectionContribution[] {
    const contributions: RuntimeInspectionContribution[] = []

    for (const plugin of registeredPlugins.values()) {
      if (!plugin.inspect) continue

      const result = plugin.inspect({
        server,
        providers: getPluginProviders(),
        preview,
      })

      if (!result) continue

      if (Array.isArray(result)) {
        contributions.push(...result)
      } else {
        contributions.push(result)
      }
    }

    return contributions
  }

  function programmaticSource(kind: RuntimeInspectionSource['kind'] = 'programmatic'): RuntimeInspectionSource {
    return { kind, location: '<programmatic>' }
  }

  function registerProcedureOperation(
    input: {
      name: string
      handler: ProcedureHandler
      inputSchema?: z.ZodType
      outputSchema?: z.ZodType
      summary?: string
      description?: string
      tags?: string[]
      graphql?: AddProcedureInput['graphql']
      httpPath?: AddProcedureInput['httpPath']
      httpMethod?: AddProcedureInput['httpMethod']
      jsonrpc?: AddProcedureInput['jsonrpc']
      grpc?: AddProcedureInput['grpc']
      policies?: ContractPolicies
      interceptors?: Interceptor[]
      registration?: RuntimeInspectionOperationRegistration
    }
  ): void {
    const {
      name,
      handler,
      inputSchema,
      outputSchema,
      summary,
      description,
      tags,
      graphql,
      httpPath,
      httpMethod,
      jsonrpc,
      grpc,
      policies,
      interceptors = [],
      registration = { source: programmaticSource() },
    } = input

    let normalizedInterceptors = normalizeInterceptors([...globalInterceptors, ...interceptors])

    if (inputSchema || outputSchema) {
      const schema: HandlerSchema = {}
      if (inputSchema) schema.input = inputSchema
      if (outputSchema) schema.output = outputSchema
      schemaRegistry.register(name, schema)
      normalizedInterceptors = normalizeInterceptors(normalizedInterceptors, schema)
    }

    registry.procedure(name, handler, {
      summary,
      description,
      tags,
      graphql,
      httpPath,
      httpMethod,
      jsonrpc,
      grpc,
      policies,
      interceptors: normalizedInterceptors.length > 0 ? normalizedInterceptors : undefined,
    })
    recordOperationRegistration(name, registration)
  }

  // Registration service (extracted to application/registration.ts)
  const registrationService = createRegistrationService({
    registry,
    schemaRegistry,
    globalInterceptors,
    logger: loggerPort,
    recordOperationRegistration,
    generateResourceRoutes,
    registerDiscoveredHandlers: (result, targetRegistry, targetSchemaRegistry, interceptors, onRegistered) => {
      registerDiscoveredHandlers(
        result as import('./fs-routes/index.js').DiscoveryResult,
        targetRegistry,
        targetSchemaRegistry,
        interceptors,
        onRegistered,
      )
    },
  })

  function registerChannel(channel: LoadedChannel): void {
    registrationService.registerChannel(channelRegistry, channel)
  }

  function registerRestResource(resource: LoadedRestResource): void {
    registrationService.registerRestResource(restResourceRegistry, resource)
  }

  function registerResource(resource: LoadedResource): void {
    registrationService.registerResource(resource)
  }

  function registerTcpHandler(handler: LoadedTcpHandler): void {
    registrationService.registerTcpHandler(tcpHandlers, handler)
  }

  function registerUdpHandler(handler: LoadedUdpHandler): void {
    registrationService.registerUdpHandler(udpHandlers, handler)
  }

  function applyDiscoveryResult(result: DiscoveryResult): void {
    registrationService.applyDiscoveryResult(
      result,
      channelRegistry,
      restResourceRegistry,
      tcpHandlers,
      udpHandlers
    )
  }

  const previewContext = serverPlanner.createPreviewContext({
    getProviderCount: () => providerDefinitions.size,
  })
  const runtimePlanBuilder = createServerRuntimePlanBuilder({
    host,
    basePath,
    protocols,
    previewContext,
    cors,
    httpOptions,
    getUsdDocsConfig: () => usdDocsConfig,
    getMcpOptions: () => mcpOptions,
    hasRestResources: () => restResourceRegistry.length > 0,
    getProtocolExtensionConfigs: () => protocolExtensionConfigs,
    getTcpHandlers: () => tcpHandlers,
    getUdpHandlers: () => udpHandlers,
    isSinglePortTcpRouteEnabled: () => serverPlanner.isSinglePortTcpRouteEnabled(),
    isSinglePortGrpcRouteEnabled: () => serverPlanner.isSinglePortGrpcRouteEnabled(),
    isSinglePortUdpRouteEnabled: (handler) => serverPlanner.isSinglePortUdpRouteEnabled(handler),
  })
  const getRuntimePlan = runtimePlanBuilder.build

  const runtimePreviewService = createRuntimePreviewService({
    registry,
    schemaRegistry,
    basePath,
    channelRegistry,
    tcpHandlers,
    udpHandlers,
    operationRegistrations,
    getRuntimePlan,
    getInspectionExtensions,
    logger: loggerPort,
  })

  const createFrontDoorDecisionMiddleware = () => frontDoorBootstrap.createDecisionMiddleware({
    info: logger.info.bind(logger),
    debug: logger.debug.bind(logger),
    warn: logger.warn.bind(logger),
  })

  const getAuthzSnapshot = policyEngine
    ? () => ({
        defaultMode: policyDefaultMode ?? 'allow',
        policies: policyEngine!.list().map((p) => ({
          id: p.id,
          description: p.description,
          effect: p.effect,
          principals: [...p.principals],
          actions: [...p.actions],
          resources: [...p.resources],
          hasCondition: typeof p.condition === 'function',
          ...(p.match ? { match: p.match } : {}),
        })),
      })
    : undefined

  const serverLifecycle = createServerLifecycle({
    logger,
    state: serverState,
    discoveryBootstrap,
    telemetryState,
    protocolAdapters,
    providerDefinitions,
    resolvedProviders,
    registry,
    schemaRegistry,
    router,
    globalInterceptors,
    getAuthzSnapshot,
    channelRegistry,
    restResourceRegistry,
    tcpHandlers,
    udpHandlers,
    tcpServers,
    udpServers,
    wsInterceptors,
    getRuntimePlan,
    getSinglePortAliasMode,
    recordProtocolFusionDecision: (decision) => protocolFusionDiagnostics.record(decision),
    createFrontDoorDecisionMiddleware,
    applyDiscoveryResult,
    logSinglePortConfig: runtimePreviewService.logSinglePortConfiguration,
    basePath,
    httpOptions,
    getWsSubscribeHandler: () => wsSubscribeHandler,
    getWsMessageHandler: () => wsMessageHandler,
    getWsUnsubscribeHandler: () => wsUnsubscribeHandler,
  })

  /**
   * Register a native HTTP route.
   * Creates a procedure with the method and path as name (e.g., `get:/users/:id`).
   *
   * Interceptor chain order:
   * 1. Global interceptors (server.use())
   * 2. HTTP namespace interceptors (server.http.use())
   * 3. Route-specific interceptors (options.use)
   * 4. Validation interceptor (prepended if schema provided)
   */
  function registerHttpRoute(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD',
    path: string,
    optionsOrHandler: import('./types.js').HttpRouteOptions | import('./types.js').HttpRouteHandler,
    maybeHandler?: import('./types.js').HttpRouteHandler
  ): RaffelServer {
    // Parse overloaded arguments
    const isOptionsObject = typeof optionsOrHandler === 'object' && optionsOrHandler !== null
    const options = isOptionsObject ? (optionsOrHandler as import('./types.js').HttpRouteOptions) : {}
    const handler = isOptionsObject ? maybeHandler! : (optionsOrHandler as import('./types.js').HttpRouteHandler)

    // Generate procedure name from method and path (e.g., "get:/users/:id")
    const name = `${method.toLowerCase()}:${path}`

    registerProcedureOperation({
      name,
      handler: handler as ProcedureHandler,
      inputSchema: options.input,
      outputSchema: options.output,
      summary: options.summary,
      description: options.description,
      tags: options.tags,
      httpPath: path,
      httpMethod: method,
      interceptors: [...httpInterceptors, ...(options.use ?? [])],
      registration: { source: programmaticSource('http-namespace') },
    })

    logger.debug({ name, path, method }, 'Added HTTP route')

    return server
  }

  const policyNamespace = policyEngine
    ? Object.freeze({
        explain(input: import('../middleware/policy/types.js').AuthzInput) {
          return policyEngine!.evaluate(input)
        },
        list() {
          return policyEngine!.list()
        },
      })
    : undefined

  const server: RaffelServer = {
    // === Authorization (policies) ===
    policy: policyNamespace,

    // === Protocol Configuration ===

    enableWebSocket(path = '/') {
      const useFrontDoor = shouldUseFrontDoor('websocket')
      protocols.websocket = {
        enabled: true,
        options: { path },
        shared: true,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('websocket', 'shared') : strategyFor('websocket', 'native'),
      }
      return server
    },

    websocket(opts: WebSocketOptions) {
      const useFrontDoor = shouldUseFrontDoor('websocket')
      const requestedShared = opts.port === undefined
      const shared = useFrontDoor || requestedShared
      protocols.websocket = {
        enabled: true,
        options: opts,
        shared,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('websocket', 'shared') : strategyFor('websocket', 'native'),
      }
      return server
    },

    enableJsonRpc(path = '/rpc') {
      const useFrontDoor = shouldUseFrontDoor('jsonrpc')
      protocols.jsonrpc = {
        enabled: true,
        options: { path },
        shared: true,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('jsonrpc', 'shared') : strategyFor('jsonrpc', 'native'),
      }
      return server
    },

    jsonrpc(opts: JsonRpcOptions) {
      const useFrontDoor = shouldUseFrontDoor('jsonrpc')
      const requestedShared = opts.port === undefined
      const shared = useFrontDoor || requestedShared
      protocols.jsonrpc = {
        enabled: true,
        options: opts,
        shared,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('jsonrpc', 'shared') : strategyFor('jsonrpc', 'native'),
      }
      return server
    },

    tcp(opts: TcpOptions) {
      const useFrontDoor = shouldUseFrontDoor('tcp')
      protocols.tcp = {
        enabled: true,
        options: opts,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('tcp', 'offload') : strategyFor('tcp', 'native'),
      }
      return server
    },

    grpc(opts: GrpcOptions) {
      const useFrontDoor = shouldUseFrontDoor('grpc')
      protocols.grpc = {
        enabled: true,
        options: opts,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('grpc', 'offload') : strategyFor('grpc', 'native'),
      }
      return server
    },

    protocols(config: import('./types.js').UnifiedProtocolConfig) {
      server.withProtocols({
        websocket: config.websocket,
        jsonrpc: config.jsonrpc,
        streams: config.streams,
        graphql: config.graphql,
        tcp: config.tcp,
        grpc: config.grpc,
      })
      return server
    },

      withProtocols(config: ExtendedProtocolConfig) {
      const hasOwnFields = (value: object): boolean => {
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            return true
          }
        }

        return false
      }

      // Helper to check if a slot has enabled: false
      function isDisabled(value: unknown): boolean {
        if (value === false) return true
        if (typeof value === 'object' && value !== null && 'enabled' in value) {
          return (value as { enabled: boolean }).enabled === false
        }
        return false
      }

      // WebSocket
      if (config.websocket !== undefined && !isDisabled(config.websocket)) {
        const ws = config.websocket
        if (ws === true) {
          server.enableWebSocket('/ws')
        } else if (typeof ws === 'string') {
          server.enableWebSocket(ws)
        } else if (typeof ws === 'object' && 'enabled' in ws) {
          const { enabled: _enabled, ...rest } = ws as { enabled: boolean } & Partial<WebSocketOptions>
          if (hasOwnFields(rest)) {
            server.websocket(rest as WebSocketOptions)
          } else {
            server.enableWebSocket('/ws')
          }
        } else {
          server.websocket(ws as WebSocketOptions)
        }
      }

      // JSON-RPC
      if (config.jsonrpc !== undefined && !isDisabled(config.jsonrpc)) {
        const jrpc = config.jsonrpc
        if (jrpc === true) {
          server.enableJsonRpc('/rpc')
        } else if (typeof jrpc === 'string') {
          server.enableJsonRpc(jrpc)
        } else if (typeof jrpc === 'object' && 'enabled' in jrpc) {
          const { enabled: _enabled, ...rest } = jrpc as { enabled: boolean } & Partial<JsonRpcOptions>
          server.enableJsonRpc(rest.path ?? '/rpc')
        } else {
          server.jsonrpc(jrpc as JsonRpcOptions)
        }
      }

      // Streams
      if (config.streams !== undefined && config.streams !== false) {
        logger.debug({ streams: config.streams }, 'Streams protocol enabled')
      }

      // GraphQL
      if (config.graphql !== undefined && !isDisabled(config.graphql)) {
        const gql = config.graphql
        if (gql === true) {
          server.enableGraphQL('/graphql')
        } else if (typeof gql === 'string') {
          server.enableGraphQL(gql)
        } else if (typeof gql === 'object' && 'enabled' in gql) {
          const { enabled: _enabled, ...rest } = gql as { enabled: boolean } & Partial<import('../graphql/index.js').GraphQLOptions>
          if (hasOwnFields(rest)) {
            server.configureGraphQL(rest as import('../graphql/index.js').GraphQLOptions)
          } else {
            server.enableGraphQL('/graphql')
          }
        } else {
          server.configureGraphQL(gql as import('../graphql/index.js').GraphQLOptions)
        }
      }

      // TCP
      if (config.tcp !== undefined && !isDisabled(config.tcp)) {
        const tcpCfg = config.tcp
        if (typeof tcpCfg === 'object' && 'enabled' in tcpCfg) {
          const { enabled: _enabled, ...rest } = tcpCfg as { enabled: boolean } & Partial<TcpOptions>
          if (rest.port !== undefined) {
            server.tcp(rest as TcpOptions)
          }
        } else {
          server.tcp(tcpCfg as TcpOptions)
        }
      }

      // UDP (test-scope marker only — no production adapter)
      if (config.udp !== undefined && !isDisabled(config.udp)) {
        logger.debug('UDP protocol noted (test-scope only; no production adapter registered)')
      }

      // gRPC
      if (config.grpc !== undefined && !isDisabled(config.grpc)) {
        const grpcCfg = config.grpc
        if (typeof grpcCfg === 'object' && 'enabled' in grpcCfg) {
          const { enabled: _enabled, ...rest } = grpcCfg as { enabled: boolean } & Partial<GrpcOptions>
          if (rest.port !== undefined && rest.protoPath !== undefined) {
            server.grpc(rest as GrpcOptions)
          }
        } else {
          server.grpc(grpcCfg as GrpcOptions)
        }
      }

      runtimePreviewService.emitWarnings()
      return server
    },

    withProfile(profile: ServerProfile, overrides?: { protocols?: ExtendedProtocolConfig }) {
      if (profile === 'local') {
        updateSinglePortConfig({ protocolAliasMode: 'extended' })
      } else if (profile === 'staging') {
        updateSinglePortConfig({ protocolAliasMode: 'standard' })
      } else if (profile === 'production') {
        updateSinglePortConfig({ protocolAliasMode: 'standard' })
        if (hotReload) {
          logger.warn(
            'hotReload is enabled but profile is "production". Pass hotReload: false to createServer() for production.'
          )
        }
        if (serverProtocolAliasMode === 'extended') {
          logger.warn(
            'protocolAliasMode "extended" was passed to createServer() but profile is "production". Use "standard" in production.'
          )
        }
      }

      if (overrides?.protocols) {
        server.withProtocols(overrides.protocols)
      }

      return server
    },

    withPreset(preset: ServerPreset, options: ServerPresetOptions = {}) {
      const websocketPath = options.websocketPath ?? '/ws'
      const jsonrpcPath = options.jsonrpcPath ?? '/rpc'
      const graphqlPath = options.graphqlPath ?? '/graphql'

      if (preset === 'realtime') {
        server.enableWebSocket(websocketPath)
      } else if (preset === 'rpc') {
        server.enableJsonRpc(jsonrpcPath)
      } else if (preset === 'api' || preset === 'dev' || preset === 'full') {
        server.enableWebSocket(websocketPath)
        server.enableJsonRpc(jsonrpcPath)
        server.enableGraphQL(graphqlPath)
      }

      return server
    },

    enableSinglePort(config: boolean | SinglePortConfig = true) {
      return server.enableSharedPort(config)
    },

    enableSharedPort(config: boolean | SinglePortConfig = true) {
      updateSinglePortConfig(config)
      return server
    },

    registerProtocol<TOptions = unknown>(
      name: string,
      factory: ProtocolExtensionConfig<TOptions>['factory'],
      options?: TOptions
    ) {
      if (serverState.running.value) {
        throw new Error('Cannot register protocol adapter after the server has started')
      }
      registerProtocolExtension({
        name,
        factory: factory as ProtocolExtensionConfig['factory'],
        options,
      })
      return server
    },

    enableGraphQL(path = '/graphql') {
      const useFrontDoor = shouldUseFrontDoor('graphql')
      protocols.graphql = {
        enabled: true,
        options: { path },
        shared: true,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('graphql', 'shared') : strategyFor('graphql', 'native'),
      }
      return server
    },

    configureGraphQL(opts: GraphQLOptions) {
      const useFrontDoor = shouldUseFrontDoor('graphql')
      const requestedShared = opts.port === undefined
      const shared = useFrontDoor || requestedShared
      protocols.graphql = {
        enabled: true,
        options: opts,
        shared,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('graphql', 'shared') : strategyFor('graphql', 'native'),
      }
      return server
    },

    // === Metrics ===

    enableMetrics(config: Parameters<typeof configureMetrics>[1] = {}) {
      configureMetrics(telemetryState, config)
      return server
    },

    // === Tracing ===

    enableTracing(config: Parameters<typeof configureTracing>[1] = {}) {
      configureTracing(telemetryState, config)
      return server
    },

    // === USD Documentation ===

    enableUSD(config: USDDocsConfig = {}) {
      usdDocsConfig = {
        basePath: config.basePath ?? '/docs',
        info: config.info,
        servers: config.servers,
        protocols: config.protocols,
        securitySchemes: config.securitySchemes,
        defaultSecurity: config.defaultSecurity,
        tags: config.tags,
        contentTypes: config.contentTypes,
        tagGroups: config.tagGroups,
        externalDocs: config.externalDocs,
        ui: config.ui,
        documentation: config.documentation,
        includeErrorSchemas: config.includeErrorSchemas,
        includeStreamEventSchemas: config.includeStreamEventSchemas,
        jsonrpc: config.jsonrpc,
        grpc: config.grpc,
      }
      logger.info({ basePath: usdDocsConfig.basePath, protocols: usdDocsConfig.protocols ?? 'auto' }, 'USD Documentation enabled')
      return server
    },

    // === Providers ===

    provide<T>(
      name: string,
      factory: ProviderFactory<T>,
      options?: { onShutdown?: (instance: T) => void | Promise<void> }
    ) {
      providerDefinitions.set(name, {
        factory: factory as ProviderFactory<unknown>,
        onShutdown: options?.onShutdown as ((instance: unknown) => void | Promise<void>) | undefined,
      })
      return server
    },

    usePlugin(plugin: ServerPlugin) {
      if (serverState.running.value) {
        throw new Error('Cannot register plugin after the server has started')
      }

      const pluginName = plugin.name.trim()
      if (!pluginName) {
        throw new Error('Plugin name is required')
      }

      if (registeredPlugins.has(pluginName)) {
        throw new Error(`Plugin "${pluginName}" already registered`)
      }

      registeredPlugins.set(pluginName, plugin)
      try {
        plugin.register?.({ server })
      } catch (error) {
        registeredPlugins.delete(pluginName)
        throw error
      }

      return server
    },

    // === Global Middleware ===

    use(interceptor: Interceptor) {
      globalInterceptors.push(interceptor)
      return server
    },

    // === Global Hooks ===

    hooks(config: GlobalHooksConfig) {
      // Merge with existing hooks
      if (config.before) {
        globalHooks.before = { ...globalHooks.before, ...config.before }
      }
      if (config.after) {
        globalHooks.after = { ...globalHooks.after, ...config.after }
      }
      if (config.error) {
        globalHooks.error = { ...globalHooks.error, ...config.error }
      }
      return server
    },

    // === Handler Registration ===

    procedure(nameOrHandler: string, handler?: ProcedureHandler, opts?: import('./types.js').DirectProcedureOptions) {
      // Direct registration (backwards compatible)
      if (typeof handler === 'function') {
        server.addProcedure({
          name: nameOrHandler,
          handler,
          ...opts,
        })
        return
      }

      // Fluent builder with hooks resolver
      return createProcedureBuilder(
        registry,
        schemaRegistry,
        nameOrHandler,
        [...globalInterceptors],
        hooksResolver,
        envelopeInterceptor,
        (procedureName, procedureHandler, registration) => {
          registry.procedure(procedureName, procedureHandler as any, {
            summary: registration.summary,
            description: registration.description,
            tags: registration.tags,
            graphql: registration.graphql,
            httpPath: registration.httpPath,
            httpMethod: registration.httpMethod,
            jsonrpc: registration.jsonrpc,
            grpc: registration.grpc,
            policies: registration.policies,
            authz: registration.authz,
            interceptors: registration.interceptors,
          })
          recordOperationRegistration(procedureName, { source: programmaticSource() })
        },
        policyInterceptorFactory,
        policyDefaultMode,
        noPolicyDeclaredFactory
      )
    },

    stream(name: string) {
      return createStreamBuilder(registry, schemaRegistry, name, [...globalInterceptors])
    },

    event(name: string) {
      return createEventBuilder(registry, schemaRegistry, name, [...globalInterceptors])
    },

    resource<TOutput>(name: string, outputSchema?: z.ZodType<TOutput>, basePath?: string) {
      return createResourceBuilder<TOutput>({
        registry,
        schemaRegistry,
        name,
        basePath: basePath ?? `/${name}`,
        outputSchema,
        inheritedInterceptors: [...globalInterceptors],
        tags: [name],
      })
    },

    // === HTTP Routes ===

    get(path: string, optionsOrHandler: any, maybeHandler?: any) {
      return registerHttpRoute('GET', path, optionsOrHandler, maybeHandler)
    },

    post(path: string, optionsOrHandler: any, maybeHandler?: any) {
      return registerHttpRoute('POST', path, optionsOrHandler, maybeHandler)
    },

    put(path: string, optionsOrHandler: any, maybeHandler?: any) {
      return registerHttpRoute('PUT', path, optionsOrHandler, maybeHandler)
    },

    patch(path: string, optionsOrHandler: any, maybeHandler?: any) {
      return registerHttpRoute('PATCH', path, optionsOrHandler, maybeHandler)
    },

    delete(path: string, optionsOrHandler: any, maybeHandler?: any) {
      return registerHttpRoute('DELETE', path, optionsOrHandler, maybeHandler)
    },

    options(path: string, optionsOrHandler: any, maybeHandler?: any) {
      return registerHttpRoute('OPTIONS', path, optionsOrHandler, maybeHandler)
    },

    head(path: string, optionsOrHandler: any, maybeHandler?: any) {
      return registerHttpRoute('HEAD', path, optionsOrHandler, maybeHandler)
    },

    // === Declarative Registration ===

    procedures(map: import('./types.js').ProcedureMap) {
      for (const [name, def] of Object.entries(map)) {
        // Parse http config
        let httpPath: string | undefined
        let httpMethod: import('../types/index.js').HttpMethod | undefined

        if (def.http) {
          if (typeof def.http === 'string') {
            httpPath = def.http
            httpMethod = 'POST' // default
          } else if (Array.isArray(def.http)) {
            ;[httpMethod, httpPath] = def.http
          } else {
            httpPath = def.http.path
            httpMethod = def.http.method ?? 'POST'
          }
        }

        registerProcedureOperation({
          name,
          handler: def.handler as ProcedureHandler,
          inputSchema: def.input,
          outputSchema: def.output,
          summary: def.summary,
          description: def.description,
          tags: def.tags,
          httpPath,
          httpMethod,
          policies: def.policies,
          interceptors: def.use ?? [],
        })

        logger.debug({ name, httpPath, httpMethod }, 'Added procedure from map')
      }

      return server
    },

    resources(map: import('./types.js').ResourceMap) {
      for (const [name, def] of Object.entries(map)) {
        const basePath = def.basePath ?? `/${name}`
        const tags = def.tags ?? [name]

        // Helper to register an operation
        const registerOp = (
          opName: string,
          handler: Function,
          method: import('../types/index.js').HttpMethod,
          path: string,
          inputSchema?: z.ZodType
        ) => {
          const procedureName = `${name}.${opName}`
          registerProcedureOperation({
            name: procedureName,
            handler: handler as ProcedureHandler,
            inputSchema,
            outputSchema: def.schema,
            tags,
            httpPath: path,
            httpMethod: method,
            summary: `${opName.charAt(0).toUpperCase() + opName.slice(1)} ${name}`,
            interceptors: def.use ?? [],
          })
        }

        // Register standard operations
        if (def.list) {
          const listDef = def.list
          if (typeof listDef === 'function') {
            registerOp('list', listDef, 'GET', basePath, undefined)
          } else {
            registerOp('list', listDef.handler, 'GET', basePath, listDef.input)
          }
        }

        if (def.get) {
          registerOp(
            'get',
            async (input: { id: string }, ctx: any) => def.get!(input.id, ctx),
            'GET',
            `${basePath}/:id`
          )
        }

        if (def.create) {
          const createDef = def.create
          if (typeof createDef === 'function') {
            registerOp('create', createDef, 'POST', basePath, undefined)
          } else {
            registerOp('create', createDef.handler, 'POST', basePath, createDef.input)
          }
        }

        if (def.update) {
          const updateDef = def.update
          if (typeof updateDef === 'function') {
            const handler = async (input: { id: string } & Record<string, unknown>, ctx: any) =>
              updateDef(input.id, input, ctx)
            registerOp('update', handler, 'PUT', `${basePath}/:id`, undefined)
          } else {
            const handler = async (input: { id: string } & Record<string, unknown>, ctx: any) =>
              updateDef.handler(input.id, input, ctx)
            registerOp('update', handler, 'PUT', `${basePath}/:id`, updateDef.input)
          }
        }

        if (def.patch) {
          const patchDef = def.patch
          if (typeof patchDef === 'function') {
            const handler = async (input: { id: string } & Record<string, unknown>, ctx: any) =>
              patchDef(input.id, input, ctx)
            registerOp('patch', handler, 'PATCH', `${basePath}/:id`, undefined)
          } else {
            const handler = async (input: { id: string } & Record<string, unknown>, ctx: any) =>
              patchDef.handler(input.id, input, ctx)
            registerOp('patch', handler, 'PATCH', `${basePath}/:id`, patchDef.input)
          }
        }

        if (def.delete) {
          registerOp(
            'delete',
            async (input: { id: string }, ctx: any) => def.delete!(input.id, ctx),
            'DELETE',
            `${basePath}/:id`
          )
        }

        // Register custom actions
        if (def.actions) {
          for (const [actionName, action] of Object.entries(def.actions)) {
            registerOp(actionName, action.handler, 'POST', `${basePath}/${actionName}`, action.input)
          }
        }

        // Register item actions
        if (def.itemActions) {
          for (const [actionName, action] of Object.entries(def.itemActions)) {
            const isObj = typeof action === 'object' && 'handler' in action
            const handler = isObj
              ? async (input: { id: string } & Record<string, unknown>, ctx: any) =>
                  action.handler(input.id, input, ctx)
              : async (input: { id: string }, ctx: any) => (action as Function)(input.id, ctx)
            const inputSchema = isObj ? action.input : undefined
            registerOp(actionName, handler, 'POST', `${basePath}/:id/${actionName}`, inputSchema)
          }
        }

        logger.debug({ name, basePath, operations: Object.keys(def).length }, 'Added resource from map')
      }

      return server
    },

    // === Grouping ===

    group(prefix: string) {
      return createGroupBuilder(
        registry,
        schemaRegistry,
        prefix,
        [...globalInterceptors],
        hooksResolver,
        envelopeInterceptor
      )
    },

    mount(prefix: string, module: RouterModule, options: MountOptions = {}) {
      const definition = getRouterModuleDefinition(module)
      const mountInterceptors = options.interceptors ?? []

      for (const route of definition.routes) {
        const fullName = joinHandlerName(prefix, route.name)
        const routeSchema = route.kind === 'procedure' ? route.schema : undefined

        // Synthesize policy interceptor at mount-time using the host server's
        // factory. Module routes carry `route.authz` (resolved from per-procedure
        // .authz() or module's defaultAuthz). When defaultMode is 'deny' and
        // no authz was declared, inject the no-policy-declared deny.
        const authzInterceptors: Interceptor[] = []
        if (route.kind === 'procedure') {
          if (route.authz && policyInterceptorFactory) {
            authzInterceptors.push(policyInterceptorFactory(fullName, route.authz))
          } else if (
            !route.authz &&
            policyDefaultMode === 'deny' &&
            noPolicyDeclaredFactory
          ) {
            authzInterceptors.push(noPolicyDeclaredFactory(fullName))
          }
        }

        const interceptors = normalizeInterceptors(
          [
            ...globalInterceptors,
            ...mountInterceptors,
            ...route.moduleInterceptors,
            ...authzInterceptors,
            ...route.interceptors,
          ],
          routeSchema
        )

        if (route.schema) {
          schemaRegistry.register(fullName, route.schema)
        }

        if (route.kind === 'procedure') {
          registry.procedure(fullName, route.handler as ProcedureHandler, {
            summary: route.summary,
            description: route.description,
            tags: route.tags,
            graphql: route.graphql,
            httpPath: route.httpPath,
            httpMethod: route.httpMethod,
            jsonrpc: route.jsonrpc,
            grpc: route.grpc,
            authz: route.authz,
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })
        } else if (route.kind === 'stream') {
          registry.stream(fullName, route.handler as StreamHandler, {
            description: route.description,
            direction: route.streamDirection,
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })
        } else {
          registry.event(fullName, route.handler as EventHandler, {
            description: route.description,
            delivery: route.delivery,
            retryPolicy: route.retryPolicy,
            deduplicationWindow: route.deduplicationWindow,
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })
        }
      }

      return server
    },

    // === Programmatic Registration ===

    addProcedure(input: AddProcedureInput | LoadedRoute) {
      // Normalize input (LoadedRoute has 'handler' directly, AddProcedureInput also has 'handler')
      const name = input.name
      const handler = input.handler as ProcedureHandler
      const inputSchema = input.inputSchema
      const outputSchema = input.outputSchema
      const summary = 'meta' in input ? input.meta?.summary : (input as AddProcedureInput).summary
      const description = 'meta' in input ? input.meta?.description : (input as AddProcedureInput).description
      const tags = 'meta' in input ? input.meta?.tags : (input as AddProcedureInput).tags
      const graphql = 'meta' in input ? input.meta?.graphql : (input as AddProcedureInput).graphql
      const httpPath = 'meta' in input ? input.meta?.httpPath : (input as AddProcedureInput).httpPath
      const httpMethod = 'meta' in input ? input.meta?.httpMethod : (input as AddProcedureInput).httpMethod
      const jsonrpc = 'meta' in input ? input.meta?.jsonrpc : (input as AddProcedureInput).jsonrpc
      const grpc = 'meta' in input ? input.meta?.grpc : (input as AddProcedureInput).grpc
      const policies = 'meta' in input
        ? policyMetadataFromRouteMeta(input.meta)
        : (input as AddProcedureInput).policies
      const routeInterceptors = 'middlewares' in input ? createRouteInterceptors(input as LoadedRoute) : []
      const inputInterceptors = 'interceptors' in input ? (input as AddProcedureInput).interceptors ?? [] : []

      registerProcedureOperation({
        name,
        handler,
        inputSchema,
        outputSchema,
        summary,
        description,
        tags,
        graphql,
        httpPath,
        httpMethod,
        jsonrpc,
        grpc,
        policies,
        interceptors: [...routeInterceptors, ...inputInterceptors],
        registration: {
          source: 'filePath' in input
            ? { kind: 'discovery', location: input.filePath }
            : programmaticSource(),
        },
      })

      logger.debug({ name }, 'Added procedure')
      return server
    },

    addStream(input: AddStreamInput | LoadedRoute) {
      const name = input.name
      const handler = input.handler as StreamHandler
      const inputSchema = input.inputSchema
      const outputSchema = input.outputSchema
      const description = 'meta' in input ? input.meta?.description : (input as AddStreamInput).description
      const direction = 'meta' in input ? input.meta?.direction : (input as AddStreamInput).direction
      const policies = 'meta' in input
        ? policyMetadataFromRouteMeta(input.meta)
        : (input as AddStreamInput).policies
      const routeInterceptors = 'middlewares' in input ? createRouteInterceptors(input as LoadedRoute) : []
      const inputInterceptors = 'interceptors' in input ? (input as AddStreamInput).interceptors ?? [] : []

      const interceptors = [...globalInterceptors, ...routeInterceptors, ...inputInterceptors]

      if (inputSchema || outputSchema) {
        const schema: HandlerSchema = {}
        if (inputSchema) schema.input = inputSchema
        if (outputSchema) schema.output = outputSchema
        schemaRegistry.register(name, schema)
      }

      registry.stream(name, handler as any, {
        description,
        direction,
        policies,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
      recordOperationRegistration(name, {
        source: 'filePath' in input
          ? { kind: 'discovery', location: input.filePath }
          : programmaticSource(),
      })

      logger.debug({ name }, 'Added stream')
      return server
    },

    addEvent(input: AddEventInput | LoadedRoute) {
      const name = input.name
      const handler = input.handler as EventHandler
      const inputSchema = input.inputSchema
      const description = 'meta' in input ? input.meta?.description : (input as AddEventInput).description
      const delivery = 'meta' in input ? input.meta?.delivery : (input as AddEventInput).delivery
      const retryPolicy = 'meta' in input ? input.meta?.retryPolicy : (input as AddEventInput).retryPolicy
      const deduplicationWindow = 'meta' in input ? input.meta?.deduplicationWindow : (input as AddEventInput).deduplicationWindow
      const policies = 'meta' in input
        ? policyMetadataFromRouteMeta(input.meta)
        : (input as AddEventInput).policies
      const routeInterceptors = 'middlewares' in input ? createRouteInterceptors(input as LoadedRoute) : []
      const inputInterceptors = 'interceptors' in input ? (input as AddEventInput).interceptors ?? [] : []

      const interceptors = [...globalInterceptors, ...routeInterceptors, ...inputInterceptors]

      if (inputSchema) {
        schemaRegistry.register(name, { input: inputSchema })
      }

      registry.event(name, handler as any, {
        description,
        delivery,
        retryPolicy,
        deduplicationWindow,
        policies,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
      recordOperationRegistration(name, {
        source: 'filePath' in input
          ? { kind: 'discovery', location: input.filePath }
          : programmaticSource(),
      })

      logger.debug({ name }, 'Added event')
      return server
    },

    addChannel(channel: LoadedChannel) {
      registerChannel(channel)
      logger.debug({ name: channel.name }, 'Channel configuration registered')
      return server
    },

    addRest(resource: LoadedRestResource) {
      registerRestResource(resource)
      return server
    },

    addResource(resource: LoadedResource) {
      registerResource(resource)
      return server
    },

    addTcpHandler(handler: LoadedTcpHandler) {
      registerTcpHandler(handler)
      return server
    },

    addUdpHandler(handler: LoadedUdpHandler) {
      registerUdpHandler(handler)
      return server
    },

    addDiscovery(result: DiscoveryResult) {
      applyDiscoveryResult(result)
      logger.debug(
        {
          routes: result.routes.length,
          channels: result.channels.length,
          rest: result.restResources.length,
          resources: result.resources.length,
          tcp: result.tcpHandlers.length,
          udp: result.udpHandlers.length,
        },
        'Added discovery result'
      )
      return server
    },

    // === Lifecycle ===

    async start() {
      if (serverState.running.value) {
        throw new Error('Server is already running')
      }

      const startPlugins = getPluginsInStartOrder()
      const startController = new AbortController()

      try {
        await runPluginRuntimeHooks('beforeStart', startPlugins, startController.signal)
        await serverLifecycle.start()
        await runPluginRuntimeHooks('afterStart', startPlugins, startController.signal)
      } catch (error) {
        startController.abort()

        if (serverState.running.value) {
          const stopPlugins = getPluginsInStopOrder()
          const rollbackController = new AbortController()

          try {
            await runPluginRuntimeHooks('beforeStop', stopPlugins, rollbackController.signal)
          } catch (rollbackError) {
            logger.error({ err: rollbackError }, 'Plugin rollback beforeStop hook failed')
          }

          try {
            await serverLifecycle.stop()
          } finally {
            try {
              await runPluginRuntimeHooks('afterStop', stopPlugins, rollbackController.signal)
            } catch (rollbackError) {
              logger.error({ err: rollbackError }, 'Plugin rollback afterStop hook failed')
            }
            rollbackController.abort()
          }
        }

        throw error
      } finally {
        startController.abort()
      }
    },

    async stop() {
      if (!serverState.running.value) {
        return
      }

      const stopPlugins = getPluginsInStopOrder()
      const stopController = new AbortController()

      try {
        await runPluginRuntimeHooks('beforeStop', stopPlugins, stopController.signal)
        await serverLifecycle.stop()
        await runPluginRuntimeHooks('afterStop', stopPlugins, stopController.signal)
      } finally {
        stopController.abort()
      }
    },

    async restart() {
      await server.stop()
      await server.start()
    },

    // === Protocol Namespaces ===

    get http() {
      return createHttpNamespace({ registerHttpRoute, httpInterceptors })
    },

    get ws() {
      return createWebSocketNamespace({
        channelRegistry,
        wsInterceptors,
        setSubscribeHandler: (handler) => { wsSubscribeHandler = handler },
        setMessageHandler: (handler) => { wsMessageHandler = handler },
        setUnsubscribeHandler: (handler) => { wsUnsubscribeHandler = handler },
        logger,
      })
    },

    get streams() {
      return createStreamsNamespace({
        globalInterceptors,
        streamInterceptors,
        registry,
        schemaRegistry,
        normalizeInterceptors,
        recordOperationRegistration,
        programmaticSource,
        logger,
      })
    },

    get rpc() {
      return createRpcNamespace({
        globalInterceptors,
        rpcInterceptors,
        registry,
        schemaRegistry,
        normalizeInterceptors,
        recordOperationRegistration,
        programmaticSource,
        logger,
      })
    },

    get tcpNs() {
      return createTcpNamespace({ tcpHandlers, tcpInterceptors, logger })
    },

    get udp() {
      return createUdpNamespace({ udpHandlers, udpInterceptors, logger })
    },

    get grpcNs() {
      return createGrpcNamespace({
        globalInterceptors,
        grpcInterceptors,
        registry,
        schemaRegistry,
        normalizeInterceptors,
        recordOperationRegistration,
        programmaticSource,
        logger,
      })
    },

    // === Accessors ===

    get registry() {
      return registry
    },

    get router() {
      return router
    },

    get isRunning() {
      return serverState.running.value
    },

    get addresses() {
      return serverState.addresses.value
    },

    get channels() {
      return serverState.wsAdapter.value?.channels ?? null
    },

    get discoveryWatcher() { return discoveryBootstrap.watcher },
    get providers() { return resolvedProviders },
    get graphql() { return serverState.graphqlAdapter.value },
    get metrics() { return telemetryState.metricsRegistry },
    get tracer() { return telemetryState.tracerInstance },

    previewConfig() {
      return runtimePreviewService.getPreviewConfig()
    },

    preview() {
      return runtimePreviewService.getRuntimeInspectionPreview()
    },

    getProtocolFusionState() {
      return protocolFusionDiagnostics.snapshot()
    },

    get usd() { return serverState.usdDocsHandlers.value },

    // === USD Document Access ===

    getUSDDocument() {
      if (!serverState.usdDocsHandlers.value) {
        return null
      }
      return serverState.usdDocsHandlers.value.getUSDDocument()
    },

    getOpenAPIDocument() {
      if (!serverState.usdDocsHandlers.value) {
        return null
      }
      return serverState.usdDocsHandlers.value.getOpenAPIDocument()
    },
  } as RaffelServer

  if (initialPlugins) {
    for (const plugin of initialPlugins) {
      server.usePlugin(plugin)
    }
  }

  return server
}
