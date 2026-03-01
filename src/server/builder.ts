/**
 * Server Builder Implementation
 *
 * Unified server builder with fluent API for multi-protocol support.
 */

import type { z } from 'zod'
import type { PortBinding } from './port-binding.js'
import { createRegistry } from '../core/registry.js'
import { createRouter } from '../core/router.js'
import type { createHttpAdapter } from '../adapters/http.js'
import type { createWebSocketAdapter } from '../adapters/websocket.js'
import type { createTcpAdapter, createTcpConnectionHandler } from '../adapters/tcp.js'
import type { createGrpcAdapter } from '../adapters/grpc.js'
import type { JsonRpcAdapter } from '../adapters/jsonrpc.js'
import type { GraphQLAdapter, GraphQLMiddleware } from '../graphql/index.js'
import { getRouterModuleDefinition } from './router-module.js'
import { createSchemaRegistry } from '../validation/index.js'
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
  FrontDoorTransport,
  FrontDoorStrategy,
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
import {
  createProcedureBuilder,
  createStreamBuilder,
  createEventBuilder,
  createGroupBuilder,
  joinHandlerName,
} from './handler-builders.js'
import { createResourceBuilder } from './resource-builder.js'
import { registerDiscoveredHandlers, resolveHooksForProcedure } from './discovery-utils.js'
import { buildProtocolConfig, resolveSinglePortConfig } from './protocol-config.js'
import { normalizeInterceptors as normalizeInterceptorsShared } from './interceptor-utils.js'
import {
  buildServerConfigPreview,
  emitConfigWarnings,
  logSinglePortConfig,
} from './builder/config-preview.js'
import { createFrontDoorBootstrap, normalizeFrontDoorProtocol } from './front-door.js'
import { createDiscoveryBootstrap } from './discovery-bootstrap.js'
import { createServerLifecycle } from './builder/lifecycle.js'
import {
  configureMetrics,
  configureTracing,
  createTelemetryState,
  type TelemetryState,
} from './telemetry-bootstrap.js'
import {
  isSinglePortTcpRouteEnabled as detectSinglePortTcpRouteEnabled,
  isSinglePortUdpRouteEnabled as detectSinglePortUdpRouteEnabled,
} from './builder/single-port-utils.js'

const logger = createLogger('server')

/**
 * Check if a value is an async iterable
 */
function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return value !== null && typeof value === 'object' && Symbol.asyncIterator in value
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
    singlePort,
    envelope,
    discovery,
    hotReload = isDevelopment(),
    providers: initialProviders,
    protocolExtensions: initialProtocolExtensions,
    protocolAliasMode: serverProtocolAliasMode = 'standard',
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

  // Protocol configuration (from options)
  const frontDoorEnabled = frontDoor?.enabled === true
  const frontDoorHost = frontDoor?.host ?? host
  const frontDoorPort = frontDoor?.port ?? port
  let singlePortConfigInput: SinglePortConfig | undefined = singlePort
  let singlePortConfig = resolveSinglePortConfig(singlePortConfigInput)
  const frontDoorAliasMode = frontDoor?.protocolAliasMode ?? serverProtocolAliasMode
  const effectiveHost = frontDoorEnabled ? frontDoorHost : host
  const effectivePort = frontDoorEnabled ? frontDoorPort : port
  const frontDoorProtocols = frontDoor?.protocols && frontDoor.protocols.length > 0
    ? Array.from(new Set(frontDoor.protocols.map((protocol) => normalizeFrontDoorProtocol(protocol, frontDoorAliasMode)).filter(Boolean))) as FrontDoorTransport[]
    : null

  const getSinglePortAliasMode = (): 'standard' | 'extended' => {
    return singlePortConfigInput?.protocolAliasMode ?? serverProtocolAliasMode
  }

  const getSinglePortSource = (): 'singlePort' | 'offload' | 'native' | 'custom' | 'unknown' => {
    return singlePortConfig.enabled ? 'singlePort' : 'native'
  }

  const updateSinglePortConfig = (next: boolean | SinglePortConfig | undefined): void => {
    if (next === undefined) return

    if (typeof next === 'boolean') {
      singlePortConfigInput = {
        ...(singlePortConfigInput ?? {}),
        enabled: next,
        protocolFusion: next ? (singlePortConfigInput?.protocolFusion ?? true) : false,
      }
    } else {
      singlePortConfigInput = { ...(singlePortConfigInput ?? {}), ...next }
    }

    singlePortConfig = resolveSinglePortConfig(singlePortConfigInput)
  }

  const shouldUseFrontDoor = (name: 'websocket' | 'jsonrpc' | 'tcp' | 'grpc' | 'graphql'): boolean => {
    if (!frontDoorEnabled) return false
    if (!frontDoorProtocols) {
      return ['websocket', 'jsonrpc', 'graphql'].includes(name)
    }
    return frontDoorProtocols.includes(name)
  }

  const strategyFor = (
    name: 'websocket' | 'jsonrpc' | 'tcp' | 'grpc' | 'graphql',
    fallback: FrontDoorStrategy
  ): FrontDoorStrategy => {
    const strategy = frontDoor?.strategy?.[name]
    return strategy ?? fallback
  }

  const protocols = buildProtocolConfig({
    websocket,
    jsonrpc,
    tcp,
    graphql,
    grpc,
    frontDoor,
    singlePort,
    protocolAliasMode: frontDoorAliasMode,
  })

  const frontDoorBootstrap = createFrontDoorBootstrap({
    frontDoorEnabled,
    frontDoorProtocols,
    protocols,
    basePath,
    effectiveHost,
    effectivePort,
  })

  // Global interceptors (from options + added via .use())
  const globalInterceptors: Interceptor[] = middleware ? [...middleware] : []

  const envelopeInterceptor = createEnvelopeInterceptorFromOptions(envelope)
  if (envelopeInterceptor) {
    globalInterceptors.push(envelopeInterceptor)
  }

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

  const serverConfigPreviewContext = {
    effectiveHost,
    effectivePort,
    frontDoorEnabled,
    frontDoorHost,
    frontDoorPort,
    frontDoorProtocols,
    protocolAliasMode: frontDoorAliasMode,
    getSinglePortConfig: () => ({
      enabled: singlePortConfig.enabled,
      protocolFusion: singlePortConfig.protocolFusion,
      sniffTimeoutMs: singlePortConfig.sniffTimeoutMs,
      sniffMaxBytes: singlePortConfig.sniffMaxBytes,
      maxConcurrentDetections: singlePortConfig.maxConcurrentDetections,
      protocols: singlePortConfig.protocols,
      alpn: singlePortConfig.alpn,
    }),
    getSinglePortAliasMode,
    getSinglePortSource,
    protocols,
  }

  function emitConfiguredWarnings() {
    emitConfigWarnings(serverConfigPreviewContext, logger)
  }

  function getPreviewConfig() {
    return buildServerConfigPreview(serverConfigPreviewContext)
  }

  function logSinglePortConfiguration() {
    logSinglePortConfig(serverConfigPreviewContext, logger)
  }

  // Namespace-level interceptors (for shared middleware per protocol)
  // These are persistent across getter calls, enabling shared middleware chains
  const httpInterceptors: Interceptor[] = []
  const wsInterceptors: Interceptor[] = []
  const streamInterceptors: Interceptor[] = []
  const rpcInterceptors: Interceptor[] = []
  const tcpInterceptors: Interceptor[] = []
  const udpInterceptors: Interceptor[] = []
  let wsSubscribeHandler: import('./types.js').WebSocketSubscribeHandler | null = null
  let wsMessageHandler: import('./types.js').WebSocketMessageHandler | null = null
  let wsUnsubscribeHandler: import('./types.js').WebSocketUnsubscribeHandler | null = null

  // Global hooks configuration (added via .hooks())
  let globalHooks: GlobalHooksConfig = {}

  // Hooks resolver that closes over globalHooks (mutable by .hooks())
  const hooksResolver = (name: string) => resolveHooksForProcedure(name, globalHooks)

  // Runtime state shared with lifecycle module
  const serverState = {
    running: { value: false },
    addresses: { value: null as ServerAddresses | null },
    providerMiddlewareInstalled: { value: false },
    portBinding: { value: null as PortBinding | null },
    singlePortTcpConnectionHandler: { value: null as ReturnType<typeof createTcpConnectionHandler> | null },
    httpServer: { value: null as ReturnType<typeof createHttpAdapter> | null },
    wsAdapter: { value: null as ReturnType<typeof createWebSocketAdapter> | null },
    jsonRpcAdapter: { value: null as JsonRpcAdapter | null },
    tcpAdapter: { value: null as ReturnType<typeof createTcpAdapter> | null },
    grpcAdapter: { value: null as ReturnType<typeof createGrpcAdapter> | null },
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

  // REST resources for HTTP routing
  const restResourceRegistry: LoadedRestResource[] = []

  function registerChannel(channel: LoadedChannel): void {
    channelRegistry.set(channel.name, channel)
  }

  function registerRestResource(resource: LoadedRestResource): void {
    // Store in registry for HTTP middleware
    restResourceRegistry.push(resource)

    for (const route of resource.routes) {
      // HEAD and OPTIONS have both collection and item routes - differentiate them
      const suffix = (route.operation === 'head' || route.operation === 'options')
        ? (route.isCollection ? ':collection' : ':item')
        : ''
      const name = `${resource.name}.${route.operation}${suffix}`

      if (route.inputSchema || route.outputSchema) {
        const schema: HandlerSchema = {}
        if (route.inputSchema) schema.input = route.inputSchema
        if (route.outputSchema) schema.output = route.outputSchema
        schemaRegistry.register(name, schema)
      }

      registry.procedure(name, route.handler as any, {
        interceptors: globalInterceptors.length > 0 ? [...globalInterceptors] : undefined,
      })
    }

    logger.debug({ name: resource.name, routes: resource.routes.length }, 'Added REST resource')
  }

  function registerResource(resource: LoadedResource): void {
    const routes = generateResourceRoutes([resource])

    for (const route of routes) {
      const name = `${resource.name}.${route.operation}`

      registry.procedure(name, route.handler as any, {
        interceptors: globalInterceptors.length > 0 ? [...globalInterceptors] : undefined,
      })
    }

    logger.debug({ name: resource.name, operations: routes.length }, 'Added resource')
  }

  function registerTcpHandler(handler: LoadedTcpHandler): void {
    tcpHandlers.push(handler)
    logger.debug({ name: handler.name, port: handler.config.port }, 'Added TCP handler')
  }

  function registerUdpHandler(handler: LoadedUdpHandler): void {
    udpHandlers.push(handler)
    logger.debug({ name: handler.name, port: handler.config.port }, 'Added UDP handler')
  }

  function applyDiscoveryResult(result: DiscoveryResult): void {
    registerDiscoveredHandlers(result, registry, schemaRegistry, globalInterceptors)

    for (const channel of result.channels) {
      registerChannel(channel)
    }

    for (const resource of result.restResources) {
      registerRestResource(resource)
    }

    for (const resource of result.resources) {
      registerResource(resource)
    }

    for (const handler of result.tcpHandlers) {
      registerTcpHandler(handler)
    }

    for (const handler of result.udpHandlers) {
      registerUdpHandler(handler)
    }
  }

  const createFrontDoorDecisionMiddleware = () => frontDoorBootstrap.createDecisionMiddleware({
    info: logger.info.bind(logger),
    debug: logger.debug.bind(logger),
    warn: logger.warn.bind(logger),
  })

  const isSinglePortTcpRouteEnabled = (): boolean => detectSinglePortTcpRouteEnabled(
    singlePortConfig.enabled,
    protocols.tcp?.enabled ?? false,
    protocols.tcp?.options.port,
    protocols.tcp?.options.host,
    effectiveHost,
    effectivePort
  )

  const isSinglePortUdpRouteEnabled = (handler: LoadedUdpHandler): boolean => detectSinglePortUdpRouteEnabled(
    singlePortConfig.enabled,
    handler.config.port,
    handler.config.host,
    effectiveHost,
    effectivePort
  )

  const serverLifecycle = createServerLifecycle({
    logger,
    state: serverState,
    discoveryBootstrap,
    telemetryState,
    protocolExtensionConfigs,
    protocolAdapters,
    providerDefinitions,
    resolvedProviders,
    frontDoorEnabled,
    frontDoorProtocols,
    protocols,
    registry,
    schemaRegistry,
    router,
    globalInterceptors,
    channelRegistry,
    restResourceRegistry,
    tcpHandlers,
    udpHandlers,
    tcpServers,
    udpServers,
    singlePortConfig,
    isSinglePortTcpRouteEnabled,
    isSinglePortUdpRouteEnabled,
    getSinglePortSource,
    getSinglePortAliasMode,
    createFrontDoorDecisionMiddleware,
    applyDiscoveryResult,
    logSinglePortConfig: logSinglePortConfiguration,
    host,
    effectiveHost,
    effectivePort,
    basePath,
    cors,
    httpOptions,
    wsMessageHandler,
    usdDocsConfig,
  })

  /**
   * Register an HTTP route (Hono-style).
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

    // Build interceptors: global → namespace → route-specific
    const interceptors = normalizeInterceptors([...globalInterceptors, ...httpInterceptors, ...(options.use ?? [])])

    // Register schema if provided
    if (options.input || options.output) {
      const schema: HandlerSchema = {}
      if (options.input) schema.input = options.input
      if (options.output) schema.output = options.output
      schemaRegistry.register(name, schema)
      const normalizedWithSchema = normalizeInterceptors([...interceptors], schema)
      interceptors.length = 0
      interceptors.push(...normalizedWithSchema)
    }

    // Register as a procedure with HTTP metadata
    registry.procedure(name, handler as ProcedureHandler, {
      summary: options.summary,
      description: options.description,
      tags: options.tags,
      httpPath: path,
      httpMethod: method,
      interceptors: interceptors.length > 0 ? interceptors : undefined,
    })

    logger.debug({ name, path, method }, 'Added HTTP route')

    return server
  }

  const server: RaffelServer = {
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

      emitConfiguredWarnings()
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

    procedure(nameOrHandler: string, handler?: ProcedureHandler, opts?: any) {
      // Direct registration (backwards compatible)
      if (typeof handler === 'function') {
        // Include global interceptors for direct registration
        const interceptors = [...globalInterceptors, ...(opts?.interceptors ?? [])]
        registry.procedure(nameOrHandler, handler, {
          ...opts,
          interceptors: interceptors.length > 0 ? interceptors : undefined,
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
        envelopeInterceptor
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

    // === HTTP Routes (Hono-style) ===

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

        // Build interceptors
        let interceptors = normalizeInterceptors([...globalInterceptors, ...(def.use ?? [])])

        // Register schema
        if (def.input || def.output) {
          const schema: HandlerSchema = {}
          if (def.input) schema.input = def.input
          if (def.output) schema.output = def.output
          schemaRegistry.register(name, schema)
          interceptors = normalizeInterceptors(interceptors, schema)
        }

        registry.procedure(name, def.handler as ProcedureHandler, {
          summary: def.summary,
          description: def.description,
          tags: def.tags,
          httpPath,
          httpMethod,
          interceptors: interceptors.length > 0 ? interceptors : undefined,
        })

        logger.debug({ name, httpPath, httpMethod }, 'Added procedure from map')
      }

      return server
    },

    resources(map: import('./types.js').ResourceMap) {
      for (const [name, def] of Object.entries(map)) {
        const basePath = def.basePath ?? `/${name}`
        const tags = def.tags ?? [name]
        const baseInterceptors = [...globalInterceptors, ...(def.use ?? [])]

        // Helper to register an operation
        const registerOp = (
          opName: string,
          handler: Function,
          method: import('../types/index.js').HttpMethod,
          path: string,
          inputSchema?: z.ZodType
        ) => {
          const procedureName = `${name}.${opName}`
          let interceptors = [...baseInterceptors]

          if (inputSchema || def.schema) {
            const schema: HandlerSchema = {}
            if (inputSchema) schema.input = inputSchema
            if (def.schema) schema.output = def.schema
            schemaRegistry.register(procedureName, schema)
            if (inputSchema) {
              interceptors = normalizeInterceptors(interceptors, { input: inputSchema })
            }
          } else {
            interceptors = normalizeInterceptors(interceptors)
          }

          registry.procedure(procedureName, handler as ProcedureHandler, {
            tags,
            httpPath: path,
            httpMethod: method,
            summary: `${opName.charAt(0).toUpperCase() + opName.slice(1)} ${name}`,
            interceptors: interceptors.length > 0 ? interceptors : undefined,
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
        const interceptors = normalizeInterceptors(
          [...globalInterceptors, ...mountInterceptors, ...route.moduleInterceptors, ...route.interceptors],
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
      const routeInterceptors = 'middlewares' in input ? createRouteInterceptors(input as LoadedRoute) : []
      const inputInterceptors = 'interceptors' in input ? (input as AddProcedureInput).interceptors ?? [] : []

      let interceptors = normalizeInterceptors([...globalInterceptors, ...routeInterceptors, ...inputInterceptors])

      // Register schema if defined
      if (inputSchema || outputSchema) {
        const schema: HandlerSchema = {}
        if (inputSchema) schema.input = inputSchema
        if (outputSchema) schema.output = outputSchema
        schemaRegistry.register(name, schema)
        interceptors = normalizeInterceptors(interceptors, schema)
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
        interceptors: interceptors.length > 0 ? interceptors : undefined,
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
        interceptors: interceptors.length > 0 ? interceptors : undefined,
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
        interceptors: interceptors.length > 0 ? interceptors : undefined,
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
      await serverLifecycle.start()
    },

    async stop() {
      await serverLifecycle.stop()
    },

    async restart() {
      await server.stop()
      await server.start()
    },

    // === Protocol Namespaces ===

    get http(): import('./types.js').HttpNamespace {
      // Uses persistent httpInterceptors from outer scope for shared middleware chain
      const httpNamespace: import('./types.js').HttpNamespace = {
        get(path: string, optionsOrHandler: any, maybeHandler?: any) {
          registerHttpRoute('GET', path, optionsOrHandler, maybeHandler)
          return httpNamespace
        },
        post(path: string, optionsOrHandler: any, maybeHandler?: any) {
          registerHttpRoute('POST', path, optionsOrHandler, maybeHandler)
          return httpNamespace
        },
        put(path: string, optionsOrHandler: any, maybeHandler?: any) {
          registerHttpRoute('PUT', path, optionsOrHandler, maybeHandler)
          return httpNamespace
        },
        patch(path: string, optionsOrHandler: any, maybeHandler?: any) {
          registerHttpRoute('PATCH', path, optionsOrHandler, maybeHandler)
          return httpNamespace
        },
        delete(path: string, optionsOrHandler: any, maybeHandler?: any) {
          registerHttpRoute('DELETE', path, optionsOrHandler, maybeHandler)
          return httpNamespace
        },
        options(path: string, optionsOrHandler: any, maybeHandler?: any) {
          registerHttpRoute('OPTIONS', path, optionsOrHandler, maybeHandler)
          return httpNamespace
        },
        head(path: string, optionsOrHandler: any, maybeHandler?: any) {
          registerHttpRoute('HEAD', path, optionsOrHandler, maybeHandler)
          return httpNamespace
        },
        use(interceptor: Interceptor) {
          httpInterceptors.push(interceptor)
          return httpNamespace
        },
      }

      return httpNamespace
    },

    get ws(): import('./types.js').WebSocketNamespace {
      // Uses persistent wsInterceptors/handlers from outer scope for shared middleware chain

      const wsNamespace: import('./types.js').WebSocketNamespace = {
        channel(channelName: string, options?: import('./types.js').WebSocketChannelOptions) {
          // Determine auth requirement based on type
          const authRequirement = options?.type === 'public' ? 'none' : 'required'

          // Wrap handlers to match ChannelExports signature
          const wrappedOnJoin = wsSubscribeHandler
            ? (member: { userId: string; socketId: string }, ctx: import('../types/index.js').Context) => wsSubscribeHandler!(channelName, ctx)
            : undefined
          const wrappedOnLeave = wsUnsubscribeHandler
            ? (member: { userId: string; socketId: string }, ctx: import('../types/index.js').Context) => wsUnsubscribeHandler!(channelName, ctx)
            : undefined

          // Register channel with the channel registry using correct LoadedChannel structure
          const channelDef: LoadedChannel = {
            name: channelName,
            filePath: '<programmatic>',
            config: {
              auth: authRequirement,
              onJoin: wrappedOnJoin as any,
              onLeave: wrappedOnLeave as any,
            },
            // Include documentation metadata
            type: options?.type ?? 'public',
            description: options?.description,
            tags: options?.tags,
          }
          channelRegistry.set(channelName, channelDef)
          logger.debug({ name: channelName, type: options?.type ?? 'public', auth: authRequirement }, 'Added WebSocket channel')

          return wsNamespace
        },
        onSubscribe(handler: import('./types.js').WebSocketSubscribeHandler) {
          wsSubscribeHandler = handler
          return wsNamespace
        },
        onMessage(handler: import('./types.js').WebSocketMessageHandler) {
          wsMessageHandler = handler
          return wsNamespace
        },
        onUnsubscribe(handler: import('./types.js').WebSocketUnsubscribeHandler) {
          wsUnsubscribeHandler = handler
          return wsNamespace
        },
        use(interceptor: Interceptor) {
          wsInterceptors.push(interceptor)
          return wsNamespace
        },
      }

      return wsNamespace
    },

    get streams(): import('./types.js').StreamsNamespace {
      // Uses persistent streamInterceptors from outer scope for shared middleware chain
      const isStreamOptions = (optionsOrHandler: any): optionsOrHandler is import('./types.js').StreamOptions =>
        typeof optionsOrHandler === 'object'
        && optionsOrHandler !== null
        && !isAsyncIterable(optionsOrHandler)

      const streamsNamespace: import('./types.js').StreamsNamespace = {
        source(name: string, optionsOrHandler: any, maybeHandler?: any) {
          const isOptionsObject = isStreamOptions(optionsOrHandler)
          const options = isOptionsObject ? (optionsOrHandler as import('./types.js').StreamOptions) : {}
          const handler = isOptionsObject ? maybeHandler : optionsOrHandler

          // Register as a stream handler using the registry
          const streamName = `stream:${name}`
          let interceptors = normalizeInterceptors([...globalInterceptors, ...streamInterceptors])

          if (options.input) {
            const schema: HandlerSchema = { input: options.input }
            schemaRegistry.register(streamName, schema)
            interceptors = normalizeInterceptors(interceptors, schema)
          }

          registry.stream(streamName, handler, {
            description: options.description,
            direction: 'server',
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })

          logger.debug({ name: streamName, path: options.path ?? `/${name}` }, 'Added stream source')
          return streamsNamespace
        },

        sink(name: string, optionsOrHandler: any, maybeHandler?: any) {
          const isOptionsObject = isStreamOptions(optionsOrHandler)
          const options = isOptionsObject ? (optionsOrHandler as import('./types.js').StreamOptions) : {}
          const handler = isOptionsObject ? maybeHandler : optionsOrHandler

          const streamName = `stream:${name}`
          let interceptors = normalizeInterceptors([...globalInterceptors, ...streamInterceptors])

          if (options.input) {
            const schema: HandlerSchema = { input: options.input }
            schemaRegistry.register(streamName, schema)
            interceptors = normalizeInterceptors(interceptors, schema)
          }

          registry.stream(streamName, handler, {
            description: options.description,
            direction: 'client',
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })

          logger.debug({ name: streamName, path: options.path ?? `/${name}` }, 'Added stream sink')
          return streamsNamespace
        },

        duplex(name: string, optionsOrHandler: any, maybeHandler?: any) {
          const isOptionsObject = isStreamOptions(optionsOrHandler)
          const options = isOptionsObject ? (optionsOrHandler as import('./types.js').StreamOptions) : {}
          const handler = isOptionsObject ? maybeHandler : optionsOrHandler

          const streamName = `stream:${name}`
          let interceptors = normalizeInterceptors([...globalInterceptors, ...streamInterceptors])

          if (options.input) {
            const schema: HandlerSchema = { input: options.input }
            schemaRegistry.register(streamName, schema)
            interceptors = normalizeInterceptors(interceptors, schema)
          }

          registry.stream(streamName, handler, {
            description: options.description,
            direction: 'bidi',
            interceptors: interceptors.length > 0 ? interceptors : undefined,
          })

          logger.debug({ name: streamName, path: options.path ?? `/${name}` }, 'Added stream duplex')
          return streamsNamespace
        },

        use(interceptor: Interceptor) {
          streamInterceptors.push(interceptor)
          return streamsNamespace
        },
      }

      return streamsNamespace
    },

    get rpc(): import('./types.js').RpcNamespace {
      // Uses persistent rpcInterceptors from outer scope for shared middleware chain
      const registerRpcMethod = (
        name: string,
        optionsOrHandler: import('./types.js').RpcMethodOptions | ProcedureHandler,
        maybeHandler?: ProcedureHandler,
        isNotification = false
      ) => {
        const isOptionsObject = typeof optionsOrHandler === 'object' && optionsOrHandler !== null && typeof maybeHandler === 'function'
        const options = isOptionsObject ? (optionsOrHandler as import('./types.js').RpcMethodOptions) : {}
        const handler = isOptionsObject ? maybeHandler : (optionsOrHandler as ProcedureHandler)

        let interceptors = normalizeInterceptors([...globalInterceptors, ...rpcInterceptors])

          if (options.input) {
            const schema: HandlerSchema = { input: options.input, output: options.output }
            schemaRegistry.register(name, schema)
            interceptors = normalizeInterceptors(interceptors, schema)
          }

        registry.procedure(name, handler, {
          description: options.description,
          tags: options.tags,
          jsonrpc: { notification: isNotification },
          interceptors: interceptors.length > 0 ? interceptors : undefined,
        })

        logger.debug({ name, notification: isNotification }, 'Added RPC method')
      }

      const rpcNamespace: import('./types.js').RpcNamespace = {
        method(name: string, optionsOrHandler: any, maybeHandler?: any) {
          registerRpcMethod(name, optionsOrHandler, maybeHandler, false)
          return rpcNamespace
        },
        notification(name: string, optionsOrHandler: any, maybeHandler?: any) {
          registerRpcMethod(name, optionsOrHandler, maybeHandler, true)
          return rpcNamespace
        },
        use(interceptor: Interceptor) {
          rpcInterceptors.push(interceptor)
          return rpcNamespace
        },
      }

      return rpcNamespace
    },

    get tcpNs(): import('./types.js').TcpNamespace {
      // Uses persistent tcpInterceptors from outer scope for shared middleware chain
      const tcpNamespace: import('./types.js').TcpNamespace = {
        handler(name: string, options?: import('./types.js').TcpHandlerOptions): import('./types.js').TcpHandlerBuilder {
          let connectHandler: import('./fs-routes/tcp/types.js').TcpConnectHandler | undefined
          let dataHandler: import('./fs-routes/tcp/types.js').TcpDataHandler | undefined
          let closeHandler: import('./fs-routes/tcp/types.js').TcpCloseHandler | undefined
          let errorHandler: import('./fs-routes/tcp/types.js').TcpErrorHandler | undefined

          const handlerBuilder: import('./types.js').TcpHandlerBuilder = {
            onConnect(handler) {
              connectHandler = handler as unknown as import('./fs-routes/tcp/types.js').TcpConnectHandler
              return handlerBuilder
            },
            onData(handler) {
              dataHandler = handler as unknown as import('./fs-routes/tcp/types.js').TcpDataHandler
              return handlerBuilder
            },
            onClose(handler) {
              closeHandler = handler as unknown as import('./fs-routes/tcp/types.js').TcpCloseHandler
              return handlerBuilder
            },
            onError(handler) {
              errorHandler = handler as unknown as import('./fs-routes/tcp/types.js').TcpErrorHandler
              return handlerBuilder
            },
            end() {
              // Build framing config if specified
              const framingConfig = options?.framing ? {
                type: options.framing as 'length-prefixed' | 'delimiter',
                lengthBytes: 4 as const,
                lengthEncoding: 'BE' as const,
                maxMessageSize: 16 * 1024 * 1024,
                delimiter: options.delimiter ? Buffer.from(options.delimiter) : undefined,
              } : null

              // Store TCP handler configuration for later startup
              const tcpHandler: LoadedTcpHandler = {
                name,
                filePath: '<programmatic>',
                config: {
                  port: options?.port ?? 0,
                  host: options?.host ?? '0.0.0.0',
                  keepAlive: true,
                  keepAliveInitialDelay: 30000,
                  timeout: 0,
                  maxConnections: 0,
                  noDelay: true,
                  framing: framingConfig,
                },
                handlers: {
                  onConnect: connectHandler,
                  onData: dataHandler,
                  onClose: closeHandler,
                  onError: errorHandler,
                },
              }
              tcpHandlers.push(tcpHandler)
              logger.debug({ name, port: options?.port }, 'Added TCP handler')
              return tcpNamespace
            },
          }

          return handlerBuilder
        },
        use(interceptor: Interceptor) {
          tcpInterceptors.push(interceptor)
          return tcpNamespace
        },
      }

      return tcpNamespace
    },

    get udp(): import('./types.js').UdpNamespace {
      // Uses persistent udpInterceptors from outer scope for shared middleware chain
      const udpNamespace: import('./types.js').UdpNamespace = {
        handler(name: string, options?: import('./types.js').UdpHandlerOptions): import('./types.js').UdpHandlerBuilder {
          let messageHandler: import('./fs-routes/udp/types.js').UdpMessageHandler | undefined
          let errorHandler: import('./fs-routes/udp/types.js').UdpErrorHandler | undefined

          const handlerBuilder: import('./types.js').UdpHandlerBuilder = {
            onMessage(handler) {
              messageHandler = handler as unknown as import('./fs-routes/udp/types.js').UdpMessageHandler
              return handlerBuilder
            },
            onError(handler) {
              errorHandler = handler as unknown as import('./fs-routes/udp/types.js').UdpErrorHandler
              return handlerBuilder
            },
            end() {
              // Build multicast config if specified
              const multicastConfig = options?.multicast ? {
                group: options.multicast,
                ttl: 1,
                loopback: false,
              } : null

              // Store UDP handler configuration for later startup
              const udpHandler: LoadedUdpHandler = {
                name,
                filePath: '<programmatic>',
                config: {
                  port: options?.port ?? 0,
                  host: options?.host ?? '0.0.0.0',
                  type: options?.type ?? 'udp4',
                  reuseAddr: true,
                  reusePort: false,
                  recvBufferSize: 65536,
                  sendBufferSize: 65536,
                  ipv6Only: false,
                  multicast: multicastConfig,
                },
                handlers: {
                  onMessage: messageHandler!,
                  onError: errorHandler,
                },
              }
              udpHandlers.push(udpHandler)
              logger.debug({ name, port: options?.port }, 'Added UDP handler')
              return udpNamespace
            },
          }

          return handlerBuilder
        },
        use(interceptor: Interceptor) {
          udpInterceptors.push(interceptor)
          return udpNamespace
        },
      }

      return udpNamespace
    },

    get grpcNs(): import('./types.js').GrpcNamespace {
      // Interceptors for gRPC namespace
      const grpcInterceptors: Interceptor[] = []

      const grpcNamespace: import('./types.js').GrpcNamespace = {
        service(serviceName: string, serviceOptions?: import('./types.js').GrpcServiceOptions): import('./types.js').GrpcServiceBuilder {
          const packageName = serviceOptions?.packageName ?? ''

          const serviceBuilder: import('./types.js').GrpcServiceBuilder = {
            method(name: string, optionsOrHandler: any, maybeHandler?: any) {
              const isOptionsObject = typeof optionsOrHandler === 'object' && optionsOrHandler !== null && typeof maybeHandler === 'function'
              const options = isOptionsObject ? (optionsOrHandler as import('./types.js').GrpcMethodOptions) : {}
              const handler = isOptionsObject ? maybeHandler : optionsOrHandler

              const procedureName = packageName ? `${packageName}.${serviceName}.${name}` : `${serviceName}.${name}`
              let interceptors = normalizeInterceptors([...globalInterceptors, ...grpcInterceptors])

              if (options.input || options.output) {
                const schema: HandlerSchema = {}
                if (options.input) schema.input = options.input
                if (options.output) schema.output = options.output
                schemaRegistry.register(procedureName, schema)
                interceptors = normalizeInterceptors(interceptors, schema)
              }

              registry.procedure(procedureName, handler as ProcedureHandler, {
                description: options.description,
                grpc: { serviceName, methodName: name, type: 'unary' },
                interceptors: interceptors.length > 0 ? interceptors : undefined,
              })

              logger.debug({ name: procedureName, type: 'unary' }, 'Added gRPC method')
              return serviceBuilder
            },

            serverStream(name: string, optionsOrHandler: any, maybeHandler?: any) {
              const isOptionsObject = typeof optionsOrHandler === 'object' && optionsOrHandler !== null && typeof maybeHandler === 'function'
              const options = isOptionsObject ? (optionsOrHandler as import('./types.js').GrpcMethodOptions) : {}
              const handler = isOptionsObject ? maybeHandler : optionsOrHandler

              const procedureName = packageName ? `${packageName}.${serviceName}.${name}` : `${serviceName}.${name}`
              const interceptors = [...globalInterceptors, ...grpcInterceptors]

              if (options.input || options.output) {
                const schema: HandlerSchema = {}
                if (options.input) schema.input = options.input
                if (options.output) schema.output = options.output
                schemaRegistry.register(procedureName, schema)
              }

              registry.stream(procedureName, handler as StreamHandler, {
                description: options.description,
                direction: 'server',
                interceptors: interceptors.length > 0 ? interceptors : undefined,
              })

              logger.debug({ name: procedureName, type: 'server-stream' }, 'Added gRPC server stream')
              return serviceBuilder
            },

            clientStream(name: string, optionsOrHandler: any, maybeHandler?: any) {
              const isOptionsObject = typeof optionsOrHandler === 'object' && optionsOrHandler !== null && typeof maybeHandler === 'function'
              const options = isOptionsObject ? (optionsOrHandler as import('./types.js').GrpcMethodOptions) : {}
              const handler = isOptionsObject ? maybeHandler : optionsOrHandler

              const procedureName = packageName ? `${packageName}.${serviceName}.${name}` : `${serviceName}.${name}`
              const interceptors = [...globalInterceptors, ...grpcInterceptors]

              if (options.input || options.output) {
                const schema: HandlerSchema = {}
                if (options.input) schema.input = options.input
                if (options.output) schema.output = options.output
                schemaRegistry.register(procedureName, schema)
              }

              registry.stream(procedureName, handler as StreamHandler, {
                description: options.description,
                direction: 'client',
                interceptors: interceptors.length > 0 ? interceptors : undefined,
              })

              logger.debug({ name: procedureName, type: 'client-stream' }, 'Added gRPC client stream')
              return serviceBuilder
            },

            bidiStream(name: string, optionsOrHandler: any, maybeHandler?: any) {
              const isOptionsObject = typeof optionsOrHandler === 'object' && optionsOrHandler !== null && typeof maybeHandler === 'function'
              const options = isOptionsObject ? (optionsOrHandler as import('./types.js').GrpcMethodOptions) : {}
              const handler = isOptionsObject ? maybeHandler : optionsOrHandler

              const procedureName = packageName ? `${packageName}.${serviceName}.${name}` : `${serviceName}.${name}`
              const interceptors = [...globalInterceptors, ...grpcInterceptors]

              if (options.input || options.output) {
                const schema: HandlerSchema = {}
                if (options.input) schema.input = options.input
                if (options.output) schema.output = options.output
                schemaRegistry.register(procedureName, schema)
              }

              registry.stream(procedureName, handler as StreamHandler, {
                description: options.description,
                direction: 'bidi',
                interceptors: interceptors.length > 0 ? interceptors : undefined,
              })

              logger.debug({ name: procedureName, type: 'bidi-stream' }, 'Added gRPC bidi stream')
              return serviceBuilder
            },

            end() {
              return grpcNamespace
            },
          }

          return serviceBuilder
        },

        use(interceptor: Interceptor) {
          grpcInterceptors.push(interceptor)
          return grpcNamespace
        },
      }

      return grpcNamespace
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
      return getPreviewConfig()
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

  return server
}
