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
import type { GraphQLAdapter, GraphQLMiddleware, GraphQLPolicyBridge } from '../graphql/index.js'
import { createSchemaRegistry } from '../validation/index.js'
import { isAsyncIterable } from '../utils/type-guards.js'
import type { Interceptor, ProcedureHandler, StreamHandler, EventHandler } from '../types/index.js'
import type { HandlerSchema } from '../validation/index.js'
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
import {
  createMarkdownDocsState,
  joinDocsEndpoint,
  normalizeDocsBasePath,
  type USDHandlers,
} from '../docs/index.js'
import type { USDDocsConfig } from './types.js'
import {
  isDevelopment,
  generateResourceRoutes,
  type DiscoveryResult,
  type LoadedRoute,
  type LoadedChannel,
  type LoadedGraphQLResource,
  type LoadedRestResource,
  type LoadedResource,
  type LoadedTcpHandler,
  type LoadedUdpHandler,
  type TcpServerInstance,
  type UdpServerInstance,
} from './fs-routes/index.js'
import { createLogger, configureLogger, getLogger } from '../utils/logger.js'
import { createPolicyBootstrap, type PolicyBootstrap } from '../middleware/policy/index.js'
import type { ProcedurePolicyConfig } from '../middleware/policy/types.js'
import type { PolicyEnginePort } from '../ports/outbound/policy-engine.js'
import {
  createProcedureBuilder,
  createStreamBuilder,
  createEventBuilder,
  createGroupBuilder,
} from './handler-builders.js'
import { createResourceBuilder } from './resource-builder.js'
import {
  addCoLocatedPoliciesToEngine,
  buildCoLocatedAuthzInterceptorsForName,
  registerDiscoveredHandlers,
  resolveHooksForProcedure,
} from './discovery-utils.js'
import { createRegistrationService } from './orchestration/registration.js'
import { createRuntimePreviewService } from './orchestration/runtime-preview.js'
import { normalizeInterceptors as normalizeInterceptorsShared } from './interceptor-utils.js'
import { createFrontDoorBootstrap } from './front-door.js'
import { createProtocolFusionDiagnosticsStore } from './protocol-fusion-diagnostics.js'
import { createDiscoveryBootstrap } from './discovery-bootstrap.js'
import { createServerLifecycle } from './builder/lifecycle.js'
import {
  createGraphQLPolicyBridge,
  createChannelCoLocatedPolicyEnforcer,
} from './builder/policy-bridges.js'
import { createProgrammaticRegistration } from './builder/programmatic-registration.js'
import {
  configureMetrics,
  configureTracing,
  createTelemetryState,
  type TelemetryState,
} from './telemetry-bootstrap.js'
import type { ContractPolicies } from '../types/index.js'
import {
  type RuntimeInspectionOperationRegistration,
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
import { applyExtendedProtocolConfig } from './builder/with-protocols.js'
import { applyResourceMap } from './builder/resources.js'
import {
  createEnvelopeInterceptorFromOptions,
  programmaticSource,
} from './builder/metadata.js'
import { createServerPluginRuntime } from './builder/plugin-runtime.js'
import { createProcedureOperationRegistrar } from './builder/operation-registrar.js'

const logger = createLogger('server')
const loggerPort = adaptPinoLogger(logger)

function discoveryMayLoadRestResources(discovery: ServerOptions['discovery']): boolean {
  if (discovery === true) return true
  if (!discovery) return false
  return Boolean(discovery.rest || discovery.routes)
}

/**
 * Create a unified Raffel server
 */
export function createServer(options: ServerOptions): RaffelServer {
  // Swap the base logger before anything logs, so the module-level `loggerPort`
  // proxy and every internal `createLogger(...)` resolve to the host's logger.
  if (options.logger) {
    configureLogger(options.logger)
  }

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

  // === Policy engine bootstrap (opt-in) ===
  // Constructed up-front so the discovery bootstrap can wire co-located
  // policy loading with the engine's `customConditions` registry.
  const policyBootstrap = createPolicyBootstrap(options.policy, { logger: loggerPort })

  const discoveryBootstrap = createDiscoveryBootstrap({
    discovery,
    hotReload,
    coLocatedPolicies: policyBootstrap
      ? {
          enabled: options.policy?.coLocated !== false,
          customConditions: options.policy?.customConditions,
        }
      : { enabled: false },
    onLoad: (stats) => {
      logger.info(
        {
          routes: stats.routes,
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
      applyDiscoveryResult(result, true)
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

  // === Policy engine bootstrap derived references ===
  const policyEngine: PolicyEnginePort | undefined = policyBootstrap?.engine
  const policyInterceptorFactory:
    | ((procedureName: string, config: ProcedurePolicyConfig) => Interceptor)
    | undefined = policyBootstrap?.interceptorFactory
  const policyDefaultMode: 'allow' | 'deny' | undefined = policyBootstrap?.defaultMode
  const noPolicyDeclaredFactory: ((procedureName: string) => Interceptor) | undefined =
    policyBootstrap?.noPolicyDeclaredFactory

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
  // Names of providers Raffel registered itself (not user-supplied). Excluded
  // from the user-provider diagnostics so a framework built-in never trips the
  // "prefer ctx.services" warning.
  const builtinProviderNames = new Set<string>()
  const resolvedProviders: ResolvedProviders = {}
  const registeredPlugins = new Map<string, ServerPlugin>()
  const pluginRuntime = createServerPluginRuntime({
    registeredPlugins,
    resolvedProviders,
    getServer: () => server,
  })

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

  // Built-in `log` provider: a single app-scoped child of the base logger,
  // created once at startup and injected as `ctx.log` into every handler. This
  // is the singleton companion to the request-scoped `ctx.logger` — same sink,
  // but carrying `component: 'app'` instead of `requestId`, and never
  // reallocated per request.
  //
  // Only registered when a logger is injected via `createServer({ logger })`,
  // so servers that don't opt into logger injection keep their exact prior
  // behavior (no provider middleware, no diagnostics change). Users can
  // override it by declaring their own `log` provider in `options.providers`.
  if (options.logger && !providerDefinitions.has('log')) {
    providerDefinitions.set('log', {
      factory: () => getLogger().child({ component: 'app' }),
    })
    builtinProviderNames.add('log')
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

  // GraphQL resources for object/relationship schema generation
  const graphqlResourceRegistry: LoadedGraphQLResource[] = []

  let apiDocumentationRevision = 0
  let apiDocumentationUpdatedAt: string | null = null
  let apiDocumentationMountedAt: string | null = null

  function advanceApiDocumentationRevision(): void {
    apiDocumentationRevision++
    apiDocumentationUpdatedAt = new Date().toISOString()
  }

  function getApiDocumentationRevision(): number {
    return apiDocumentationRevision
  }

  function markApiDocumentationMounted(): void {
    apiDocumentationMountedAt = new Date().toISOString()
  }

  function getDocsState(): Record<string, unknown> {
    const docsConfig = usdDocsConfig
    const enabled = Boolean(docsConfig)
    const mounted = Boolean(serverState.usdDocsHandlers.value)
    const base = normalizeDocsBasePath(docsConfig?.basePath ?? '/docs')
    const apiRouteCount = registry.listProcedures().length +
      restResourceRegistry.reduce((sum, resource) => sum + resource.routes.length, 0) +
      graphqlResourceRegistry.length
    const markdown = serverState.usdDocsHandlers.value?.getMarkdownDocsState?.()
      ?? createMarkdownDocsState({
        basePath: base,
        docsDir: docsConfig?.docsDir,
        documentation: docsConfig?.documentation,
        mounted,
        mountedAt: apiDocumentationMountedAt,
      })

    return {
      generatedAt: new Date().toISOString(),
      api: {
        enabled,
        mounted,
        fresh: enabled ? mounted : true,
        revision: apiDocumentationRevision,
        basePath: base,
        endpoints: enabled
          ? {
              ui: base,
              usdJson: joinDocsEndpoint(base, '/usd.json'),
              usdYaml: joinDocsEndpoint(base, '/usd.yaml'),
              openApiJson: joinDocsEndpoint(base, '/openapi.json'),
              state: joinDocsEndpoint(base, '/state.json'),
            }
          : {},
        routeCounts: {
          procedures: registry.listProcedures().length,
          restRoutes: restResourceRegistry.reduce((sum, resource) => sum + resource.routes.length, 0),
          graphqlResources: graphqlResourceRegistry.length,
          total: apiRouteCount,
        },
        updatedAt: apiDocumentationUpdatedAt,
        mountedAt: apiDocumentationMountedAt,
        staleReasons: enabled && !mounted ? ['not-mounted'] : [],
      },
      markdown,
    }
  }

  function recordOperationRegistration(
    name: string,
    registration: RuntimeInspectionOperationRegistration
  ): void {
    operationRegistrations.set(name, registration)
  }

  const registerProcedureOperation = createProcedureOperationRegistrar({
    globalInterceptors,
    registry,
    schemaRegistry,
    normalizeInterceptors,
    recordOperationRegistration,
    programmaticSource,
  })

  // Adapt resource routes for the orchestration layer: convert per-route
  // ResourceMiddleware (signature: `(ctx, next) => unknown`) into Interceptor
  // (signature: `(envelope, ctx, next) => unknown`) so the registration
  // service can splice them next to global / authz interceptors. Issue #115.
  const generateResourceRoutesWithInterceptors = (resources: LoadedResource[]) =>
    generateResourceRoutes(resources).map((route) => {
      const middleware = route.middleware ?? []
      const asInterceptors: Interceptor[] = middleware.map((mw) =>
        (_envelope, ctx, next) => mw(ctx as never, next)
      )
      return { ...route, middleware: asInterceptors }
    })

  // Registration service (owned by server/orchestration/registration.ts)
  const registrationService = createRegistrationService({
    registry,
    schemaRegistry,
    globalInterceptors,
    logger: loggerPort,
    recordOperationRegistration,
    generateResourceRoutes: generateResourceRoutesWithInterceptors,
    registerDiscoveredHandlers: (result, targetRegistry, targetSchemaRegistry, interceptors, onRegistered, previouslyDiscovered) => {
      return registerDiscoveredHandlers(
        result as import('./fs-routes/index.js').DiscoveryResult,
        targetRegistry,
        targetSchemaRegistry,
        interceptors,
        onRegistered,
        policyBootstrap ? { bootstrap: policyBootstrap } : undefined,
        previouslyDiscovered,
      )
    },
    buildAuthzInterceptorsForOperation: (operationName, coLocatedPolicies, diagnosticsFilePath, policyConfig) =>
      buildCoLocatedAuthzInterceptorsForName(
        operationName,
        coLocatedPolicies,
        policyBootstrap ? { bootstrap: policyBootstrap } : undefined,
        diagnosticsFilePath,
        policyConfig,
      ),
  })

  function registerChannel(channel: LoadedChannel): void {
    registrationService.registerChannel(channelRegistry, channel)
  }

  function registerRestResource(resource: LoadedRestResource): void {
    registrationService.registerRestResource(restResourceRegistry, resource)
  }

  function registerGraphQLResource(resource: LoadedGraphQLResource): void {
    addCoLocatedPoliciesToEngine(
      `graphql:${resource.name}`,
      resource.coLocatedPolicies,
      policyBootstrap ? { bootstrap: policyBootstrap } : undefined,
      resource.filePath,
      { protocol: 'graphql' },
    )
    graphqlResourceRegistry.push(resource)
    logger.debug({ name: resource.name, filePath: resource.filePath }, 'GraphQL resource registered')
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

  // Track names of procedures/streams/events that the discovery layer
  // registered, so a subsequent hot reload can drop the ones that
  // disappeared and re-register the rest. Programmatic registrations
  // (via `server.procedure(...)`) are never in this set, so they are
  // protected from the cleanup pass.
  let discoveredRoutes: Set<string> = new Set()

  function applyDiscoveryResult(
    result: DiscoveryResult,
    isReload: boolean = true
  ): void {
    // Hot reload: drop the previous load's accumulation so the next
    // flush only contains policies for routes that survived. The
    // engine entries themselves are overwritten by the engine's
    // replace-in-place semantics on the next flush.
    if (isReload) {
      policyBootstrap?.coLocatedAccumulator.reset()
    }
    const { discoveredNames } = registrationService.applyDiscoveryResult(
      result,
      channelRegistry,
      restResourceRegistry,
      tcpHandlers,
      udpHandlers,
      isReload ? discoveredRoutes : undefined
    )
    discoveredRoutes = discoveredNames

    // GraphQL resources also accumulate their co-located policies via
    // `registerGraphQLResource` → `addCoLocatedPoliciesToEngine`, so
    // they must run BEFORE the flush. Otherwise their accumulated
    // policies are dropped because the flush already happened.
    for (const resource of result.graphqlResources) {
      registerGraphQLResource(resource)
    }

    // Once every route, channel, and GraphQL resource in the load has
    // been registered (and its co-located policies accumulated),
    // materialise the union into the engine. One policy per
    // (source, index), regardless of how many routes referenced it.
    if (policyBootstrap) {
      policyBootstrap.coLocatedAccumulator.flush()
    }
    advanceApiDocumentationRevision()
  }

  const previewContext = serverPlanner.createPreviewContext({
    getProviderCount: () => providerDefinitions.size - builtinProviderNames.size,
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
    hasRestResources: () => restResourceRegistry.length > 0 || discoveryMayLoadRestResources(discovery),
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
    getInspectionExtensions: (preview) => [
      ...(pluginRuntime.getInspectionExtensions(preview) ?? []),
      {
        namespace: 'docs-state',
        title: 'Docs State',
        summary: 'Documentation enablement, mount, freshness, and revision state.',
        data: getDocsState(),
        nodes: [],
      },
    ],
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
    getApiDocumentationRevision,
    markApiDocumentationMounted,
    getDocsState,
    channelRegistry,
    restResourceRegistry,
    graphqlResourceRegistry,
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
    channelCoLocatedPolicyEnforcer: createChannelCoLocatedPolicyEnforcer(policyBootstrap),
    graphqlPolicyBridge: createGraphQLPolicyBridge(policyBootstrap),
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
      httpSuccessStatus: options.successStatus,
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

  // Programmatic registration methods (mount + addX + registerHandler)
  // are produced by a factory and spread into the server object below.
  // `getServer` is a thunk because the methods return `server` for
  // chaining, and `server` is defined immediately after this call.
  const programmaticRegistration = createProgrammaticRegistration({
    registry,
    schemaRegistry,
    globalInterceptors,
    normalizeInterceptors,
    policyInterceptorFactory,
    policyDefaultMode,
    noPolicyDeclaredFactory,
    recordOperationRegistration,
    registerProcedureOperation,
    registerChannel,
    registerRestResource,
    registerResource,
    registerTcpHandler,
    registerUdpHandler,
    logger,
    getServer: () => server,
  })

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
      applyExtendedProtocolConfig(server, logger, config)
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
        docsDir: config.docsDir,
        includeErrorSchemas: config.includeErrorSchemas,
        includeStreamEventSchemas: config.includeStreamEventSchemas,
        jsonrpc: config.jsonrpc,
        graphql: config.graphql,
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
      applyResourceMap(map, { registerProcedureOperation, logger })
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

    ...programmaticRegistration,

    addDiscovery(result: DiscoveryResult) {
      // `addDiscovery` accepts a complete view of the discovered surface.
      // Whether this is the initial load or a subsequent re-application
      // (e.g. from a watcher), the caller is asserting "this is the new
      // state" — so treat it as a reload: drop previously-discovered
      // names that disappeared, re-register what remains, and keep
      // programmatic registrations untouched. The first invocation has
      // no `previouslyDiscovered` set yet, so the cleanup pass is a
      // no-op and we just register everything fresh.
      applyDiscoveryResult(result, true)
      logger.debug(
        {
          routes: result.routes.length,
          channels: result.channels.length,
          rest: result.restResources.length,
          resources: result.resources.length,
          graphql: result.graphqlResources.length,
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

      const startPlugins = pluginRuntime.getPluginsInStartOrder()
      const startController = new AbortController()

      try {
        await pluginRuntime.runPluginRuntimeHooks('beforeStart', startPlugins, startController.signal)
        await serverLifecycle.start()
        await pluginRuntime.runPluginRuntimeHooks('afterStart', startPlugins, startController.signal)
      } catch (error) {
        startController.abort()

        if (serverState.running.value) {
          const stopPlugins = pluginRuntime.getPluginsInStopOrder()
          const rollbackController = new AbortController()

          try {
            await pluginRuntime.runPluginRuntimeHooks('beforeStop', stopPlugins, rollbackController.signal)
          } catch (rollbackError) {
            logger.error({ err: rollbackError }, 'Plugin rollback beforeStop hook failed')
          }

          try {
            await serverLifecycle.stop()
          } finally {
            try {
              await pluginRuntime.runPluginRuntimeHooks('afterStop', stopPlugins, rollbackController.signal)
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

      const stopPlugins = pluginRuntime.getPluginsInStopOrder()
      const stopController = new AbortController()

      try {
        await pluginRuntime.runPluginRuntimeHooks('beforeStop', stopPlugins, stopController.signal)
        await serverLifecycle.stop()
        await pluginRuntime.runPluginRuntimeHooks('afterStop', stopPlugins, stopController.signal)
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

    policyCoverage() {
      if (!policyBootstrap) return null
      const procedureEntries = registry.listProcedures().map((p) => ({
        name: p.name,
        kind: 'procedure',
        location: operationRegistrations.get(p.name)?.source.location,
      }))
      const channelEntries = Array.from(channelRegistry.values()).map((c) => ({
        name: c.name,
        kind: 'channel',
        location: c.filePath,
      }))
      return policyBootstrap.getCoverage([...procedureEntries, ...channelEntries])
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
