/**
 * Server Builder Implementation
 *
 * Unified server builder with fluent API for multi-protocol support.
 */

import type { z } from 'zod'
import { createRegistry } from '../core/registry.js'
import { createRouter } from '../core/router.js'
import { createHttpAdapter } from '../adapters/http.js'
import { createWebSocketAdapter } from '../adapters/websocket.js'
import { createTcpAdapter } from '../adapters/tcp.js'
import { createJsonRpcAdapter, createJsonRpcMiddleware } from '../adapters/jsonrpc.js'
import { createGrpcAdapter } from '../adapters/grpc.js'
import { createGraphQLAdapter, createGraphQLMiddleware, type GraphQLAdapter, type GraphQLMiddleware } from '../graphql/index.js'
import { getRouterModuleDefinition } from './router-module.js'
import { createSchemaRegistry, createValidationInterceptor } from '../validation/index.js'
import type { Interceptor, ProcedureHandler, StreamHandler, EventHandler } from '../types/index.js'
import type { HandlerSchema } from '../validation/index.js'
import type {
  ServerOptions,
  WebSocketOptions,
  JsonRpcOptions,
  TcpOptions,
  GrpcOptions,
  ServerAddresses,
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
} from './types.js'
import type { GraphQLOptions } from '../graphql/index.js'
import type { MetricsConfig, MetricRegistry } from '../metrics/index.js'
import {
  createMetricRegistry,
  createMetricsInterceptor,
  startProcessMetricsCollection,
} from '../metrics/index.js'
import type { TracingConfig, Tracer } from '../tracing/index.js'
import { createTracer, createTracingInterceptor } from '../tracing/index.js'
import { createUSDHandlers, type USDHandlers } from '../docs/index.js'
import type { USDDocsConfig } from './types.js'
import {
  createDiscoveryWatcher,
  createRouteInterceptors,
  isDevelopment,
  generateResourceRoutes,
  type DiscoveryWatcher,
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
import { buildChannelOptions, joinBasePath } from './channel-utils.js'
import {
  createRestMiddleware,
  createHttpOverrideMiddleware,
  logRestMiddlewareRegistered,
  createDocsRouteMiddleware,
} from './rest-middleware.js'
import { buildProtocolConfig } from './protocol-config.js'

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
    graphql,
    middleware,
    http: httpOptions,
    discovery,
    hotReload = isDevelopment(),
    providers: initialProviders,
  } = options

  // Core components
  const registry = createRegistry()
  const router = createRouter(registry, { eventDelivery })
  const schemaRegistry = createSchemaRegistry()

  // Discovery watcher for file-system handlers
  let discoveryWatcher: DiscoveryWatcher | null = null

  // Create discovery watcher if configured
  if (discovery) {
    discoveryWatcher = createDiscoveryWatcher({
      discovery: discovery === true
        ? { http: true, channels: true, rpc: true, streams: true, rest: true, resources: true, tcp: true, udp: true }
        : discovery,
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
  }

  // Protocol configuration (from options)
  const protocols = buildProtocolConfig({ websocket, jsonrpc, tcp, graphql })

  // Global interceptors (from options + added via .use())
  const globalInterceptors: Interceptor[] = middleware ? [...middleware] : []

  // Namespace-level interceptors (for shared middleware per protocol)
  // These are persistent across getter calls, enabling shared middleware chains
  const httpInterceptors: Interceptor[] = []
  const wsInterceptors: Interceptor[] = []
  const streamInterceptors: Interceptor[] = []
  const rpcInterceptors: Interceptor[] = []
  const tcpInterceptors: Interceptor[] = []
  const udpInterceptors: Interceptor[] = []

  // Global hooks configuration (added via .hooks())
  let globalHooks: GlobalHooksConfig = {}

  // Create hooks resolver that uses current globalHooks state
  const createHooksResolver = () => (name: string) => resolveHooksForProcedure(name, globalHooks)

  // Active adapters
  let httpServer: ReturnType<typeof createHttpAdapter> | null = null
  let wsAdapter: ReturnType<typeof createWebSocketAdapter> | null = null
  let jsonRpcAdapter: ReturnType<typeof createJsonRpcAdapter> | null = null
  let tcpAdapter: ReturnType<typeof createTcpAdapter> | null = null
  let grpcAdapter: ReturnType<typeof createGrpcAdapter> | null = null
  let graphqlAdapter: GraphQLAdapter | null = null
  let graphqlMiddleware: GraphQLMiddleware | null = null
  let graphqlSubscriptionServer: ReturnType<GraphQLMiddleware['createSubscriptionServer']> | null = null

  // Metrics
  let metricsConfig: MetricsConfig | null = null
  let metricsRegistry: MetricRegistry | null = null
  let processMetricsCleanup: (() => void) | null = null

  // Tracing
  let tracingConfig: TracingConfig | null = null
  let tracerInstance: Tracer | null = null

  // USD Documentation
  let usdDocsConfig: USDDocsConfig | null = null
  let usdDocsHandlers: USDHandlers | null = null

  // State
  let running = false
  let addresses: ServerAddresses | null = null

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
    const interceptors = [...globalInterceptors, ...httpInterceptors, ...(options.use ?? [])]

    // Register schema if provided
    if (options.input || options.output) {
      const schema: HandlerSchema = {}
      if (options.input) schema.input = options.input
      if (options.output) schema.output = options.output
      schemaRegistry.register(name, schema)
      interceptors.unshift(createValidationInterceptor(schema))
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
      protocols.websocket = {
        enabled: true,
        options: { path },
        shared: true,
      }
      return server
    },

    websocket(opts: WebSocketOptions) {
      protocols.websocket = {
        enabled: true,
        options: opts,
        shared: opts.port === undefined,
      }
      return server
    },

    enableJsonRpc(path = '/rpc') {
      protocols.jsonrpc = {
        enabled: true,
        options: { path },
        shared: true,
      }
      return server
    },

    jsonrpc(opts: JsonRpcOptions) {
      protocols.jsonrpc = {
        enabled: true,
        options: opts,
        shared: opts.port === undefined,
      }
      return server
    },

    tcp(opts: TcpOptions) {
      protocols.tcp = {
        enabled: true,
        options: opts,
      }
      return server
    },

    grpc(opts: GrpcOptions) {
      protocols.grpc = {
        enabled: true,
        options: opts,
      }
      return server
    },

    protocols(config: import('./types.js').UnifiedProtocolConfig) {
      // WebSocket
      if (config.websocket !== undefined && config.websocket !== false) {
        if (config.websocket === true) {
          server.enableWebSocket('/ws')
        } else if (typeof config.websocket === 'string') {
          server.enableWebSocket(config.websocket)
        } else {
          server.websocket(config.websocket)
        }
      }

      // JSON-RPC
      if (config.jsonrpc !== undefined && config.jsonrpc !== false) {
        if (config.jsonrpc === true) {
          server.enableJsonRpc('/rpc')
        } else if (typeof config.jsonrpc === 'string') {
          server.enableJsonRpc(config.jsonrpc)
        } else {
          server.jsonrpc(config.jsonrpc)
        }
      }

      // Streams (SSE)
      if (config.streams !== undefined && config.streams !== false) {
        // Streams are enabled automatically when stream handlers are registered
        // This is a marker for documentation and configuration
        logger.debug({ streams: config.streams }, 'Streams protocol enabled')
      }

      // GraphQL
      if (config.graphql !== undefined && config.graphql !== false) {
        if (config.graphql === true) {
          server.enableGraphQL('/graphql')
        } else if (typeof config.graphql === 'string') {
          server.enableGraphQL(config.graphql)
        } else {
          server.configureGraphQL(config.graphql)
        }
      }

      // TCP (requires full options)
      if (config.tcp) {
        server.tcp(config.tcp)
      }

      // gRPC (requires full options)
      if (config.grpc) {
        server.grpc(config.grpc)
      }

      logger.info({ protocols: Object.keys(config).filter((k) => (config as Record<string, unknown>)[k]) }, 'Protocols configured')
      return server
    },

    enableGraphQL(path = '/graphql') {
      protocols.graphql = {
        enabled: true,
        options: { path },
        shared: true,
      }
      return server
    },

    configureGraphQL(opts: GraphQLOptions) {
      protocols.graphql = {
        enabled: true,
        options: opts,
        shared: opts.port === undefined,
      }
      return server
    },

    // === Metrics ===

    enableMetrics(config: MetricsConfig = {}) {
      metricsConfig = {
        enabled: config.enabled ?? true,
        endpoint: config.endpoint ?? '/metrics',
        defaultLabels: config.defaultLabels,
        collectRequestMetrics: config.collectRequestMetrics ?? true,
        collectProcessMetrics: config.collectProcessMetrics ?? false,
      }

      // Create registry immediately so it's available for custom metrics
      metricsRegistry = createMetricRegistry()
      if (metricsConfig.defaultLabels) {
        metricsRegistry.setDefaultLabels(metricsConfig.defaultLabels)
      }

      return server
    },

    // === Tracing ===

    enableTracing(config: TracingConfig = {}) {
      tracingConfig = {
        enabled: config.enabled ?? true,
        serviceName: config.serviceName ?? 'raffel',
        sampleRate: config.sampleRate ?? 1.0,
        rateLimit: config.rateLimit ?? 0,
        exporters: config.exporters ?? [],
        batchSize: config.batchSize ?? 100,
        batchTimeout: config.batchTimeout ?? 5000,
        defaultAttributes: config.defaultAttributes ?? {},
      }

      // Create tracer immediately so it's available
      tracerInstance = createTracer(tracingConfig)

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
        createHooksResolver()
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
        const interceptors = [...globalInterceptors, ...(def.use ?? [])]

        // Register schema
        if (def.input || def.output) {
          const schema: HandlerSchema = {}
          if (def.input) schema.input = def.input
          if (def.output) schema.output = def.output
          schemaRegistry.register(name, schema)
          interceptors.unshift(createValidationInterceptor(schema))
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
          const interceptors = [...baseInterceptors]

          if (inputSchema || def.schema) {
            const schema: HandlerSchema = {}
            if (inputSchema) schema.input = inputSchema
            if (def.schema) schema.output = def.schema
            schemaRegistry.register(procedureName, schema)
            if (inputSchema) {
              interceptors.unshift(createValidationInterceptor({ input: inputSchema }))
            }
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
      return createGroupBuilder(registry, schemaRegistry, prefix, [...globalInterceptors], createHooksResolver())
    },

    mount(prefix: string, module: RouterModule, options: MountOptions = {}) {
      const definition = getRouterModuleDefinition(module)
      const mountInterceptors = options.interceptors ?? []

      for (const route of definition.routes) {
        const fullName = joinHandlerName(prefix, route.name)
        const interceptors: Interceptor[] = [
          ...(route.kind === 'procedure' && route.schema
            ? [createValidationInterceptor(route.schema)]
            : []),
          ...globalInterceptors,
          ...mountInterceptors,
          ...route.moduleInterceptors,
          ...route.interceptors,
        ]

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

      const interceptors = [...globalInterceptors, ...routeInterceptors, ...inputInterceptors]

      // Register schema if defined
      if (inputSchema || outputSchema) {
        const schema: HandlerSchema = {}
        if (inputSchema) schema.input = inputSchema
        if (outputSchema) schema.output = outputSchema
        schemaRegistry.register(name, schema)
        interceptors.unshift(createValidationInterceptor(schema))
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
      if (running) {
        throw new Error('Server is already running')
      }

      // Initialize providers
      if (providerDefinitions.size > 0) {
        logger.debug({ count: providerDefinitions.size }, 'Initializing providers')
        for (const [name, definition] of providerDefinitions) {
          try {
            const instance = await definition.factory()
            resolvedProviders[name] = instance
            logger.debug({ name }, 'Provider initialized')
          } catch (err) {
            logger.error({ err, name }, 'Failed to initialize provider')
            throw err
          }
        }

        // Add interceptor to inject providers into context
        globalInterceptors.unshift(async (_env, ctx, next) => {
          // Inject all providers into context
          const ctxAny = ctx as unknown as Record<string, unknown>
          for (const [name, instance] of Object.entries(resolvedProviders)) {
            ctxAny[name] = instance
          }
          return next()
        })
      }

      // Initialize metrics if enabled
      if (metricsConfig?.enabled && metricsRegistry) {
        logger.debug({ endpoint: metricsConfig.endpoint }, 'Initializing metrics')

        // Add request metrics interceptor
        if (metricsConfig.collectRequestMetrics) {
          globalInterceptors.unshift(createMetricsInterceptor(metricsRegistry))
        }

        // Start process metrics collection
        if (metricsConfig.collectProcessMetrics) {
          processMetricsCleanup = startProcessMetricsCollection(metricsRegistry)
        }

        // Register /metrics endpoint as a procedure
        const metricsEndpointName = `__metrics__`
        registry.procedure(metricsEndpointName, async () => {
          return metricsRegistry!.export('prometheus')
        })

        logger.info({ endpoint: metricsConfig.endpoint }, 'Metrics enabled')
      }

      // Initialize tracing if enabled
      if (tracingConfig?.enabled && tracerInstance) {
        logger.debug(
          {
            serviceName: tracingConfig.serviceName,
            sampleRate: tracingConfig.sampleRate,
          },
          'Initializing tracing'
        )

        // Add tracing interceptor (should be first to capture full request duration)
        globalInterceptors.unshift(createTracingInterceptor(tracerInstance))

        logger.info(
          {
            serviceName: tracingConfig.serviceName,
            sampleRate: tracingConfig.sampleRate,
            exporters: tracingConfig.exporters?.length ?? 0,
          },
          'Tracing enabled'
        )
      }

      // Load file-system handlers first (before starting adapters)
      if (discoveryWatcher) {
        const result = await discoveryWatcher.start()
        applyDiscoveryResult(result)
      }

      addresses = {
        http: { host, port },
      }

      // Build HTTP middleware list
      const httpMiddleware: Array<(req: any, res: any) => boolean | Promise<boolean>> = []
      if (httpOptions?.middleware?.length) {
        httpMiddleware.push(...httpOptions.middleware)
      }

      // Add USD Documentation handlers if enabled
      if (usdDocsConfig) {
        usdDocsHandlers = createUSDHandlers(
          {
            registry,
            schemaRegistry,
            channels: channelRegistry,
            restResources: restResourceRegistry,
            tcpHandlers,
            udpHandlers,
            protocolConfig: protocols,
          },
          {
            basePath: usdDocsConfig.basePath ?? '/docs',
            info: usdDocsConfig.info,
            servers: usdDocsConfig.servers,
            protocols: usdDocsConfig.protocols,
            securitySchemes: usdDocsConfig.securitySchemes,
            defaultSecurity: usdDocsConfig.defaultSecurity,
            tags: usdDocsConfig.tags,
            externalDocs: usdDocsConfig.externalDocs,
            ui: usdDocsConfig.ui,
            includeErrorSchemas: usdDocsConfig.includeErrorSchemas,
            includeStreamEventSchemas: usdDocsConfig.includeStreamEventSchemas,
            jsonrpc: usdDocsConfig.jsonrpc,
            grpc: usdDocsConfig.grpc,
          }
        )

        // Create Hono middleware for USD routes
        const usdBasePath = usdDocsConfig.basePath ?? '/docs'
        httpMiddleware.push(createDocsRouteMiddleware([
          { method: 'GET', path: usdBasePath, handler: usdDocsHandlers.serveUI },
          { method: 'GET', path: `${usdBasePath}/usd.json`, handler: usdDocsHandlers.serveUSD },
          { method: 'GET', path: `${usdBasePath}/usd.yaml`, handler: usdDocsHandlers.serveUSDYaml },
          { method: 'GET', path: `${usdBasePath}/openapi.json`, handler: usdDocsHandlers.serveOpenAPI },
        ]))
        logger.info({ basePath: usdBasePath }, 'USD Documentation middleware registered')
      }

      httpMiddleware.push(createHttpOverrideMiddleware({
        router,
        registry,
        basePath,
        maxBodySize: httpOptions?.maxBodySize ?? 1024 * 1024,
        contextFactory: httpOptions?.contextFactory,
        codecs: httpOptions?.codecs,
      }))

      // Add REST middleware for proper HTTP verb routing
      if (restResourceRegistry.length > 0) {
        httpMiddleware.push(createRestMiddleware({
          restResources: restResourceRegistry,
          router,
          basePath,
          maxBodySize: httpOptions?.maxBodySize ?? 1024 * 1024,
          contextFactory: httpOptions?.contextFactory,
          codecs: httpOptions?.codecs,
        }))
        logRestMiddlewareRegistered(restResourceRegistry.length)
      }

      // Add JSON-RPC middleware when sharing the HTTP port
      if (protocols.jsonrpc?.enabled && protocols.jsonrpc.shared) {
        const rpcOpts = protocols.jsonrpc.options
        const rpcPath = rpcOpts.path || '/rpc'
        const sharedRpcPath = joinBasePath(basePath, rpcPath)
        httpMiddleware.push(createJsonRpcMiddleware(router, {
          path: sharedRpcPath,
          timeout: rpcOpts.timeout,
          maxBodySize: rpcOpts.maxBodySize,
          cors: false,
          codecs: rpcOpts.codecs,
        }))
      }

      // Add GraphQL middleware when sharing the HTTP port
      if (protocols.graphql?.enabled && protocols.graphql.shared) {
        const gqlOpts = protocols.graphql.options
        const gqlPath = gqlOpts.path || '/graphql'
        const sharedGqlPath = joinBasePath(basePath, gqlPath)
        const isDev = isDevelopment()

        graphqlMiddleware = createGraphQLMiddleware({
          router,
          registry,
          schemaRegistry,
          config: {
            ...gqlOpts,
            path: sharedGqlPath,
            playground: gqlOpts.playground ?? isDev,
            introspection: gqlOpts.introspection ?? isDev,
            timeout: gqlOpts.timeout ?? 30000,
            maxBodySize: gqlOpts.maxBodySize ?? 1024 * 1024,
          },
        })
        httpMiddleware.push(graphqlMiddleware.middleware)

        graphqlAdapter = {
          async start() {
            if (!httpServer?.server) return
            graphqlSubscriptionServer = graphqlMiddleware?.createSubscriptionServer(httpServer.server) ?? null
          },
          async stop() {
            if (graphqlSubscriptionServer) {
              graphqlSubscriptionServer.close()
              graphqlSubscriptionServer = null
            }
          },
          get schema() {
            return graphqlMiddleware!.schema
          },
          get schemaInfo() {
            return graphqlMiddleware!.schemaInfo
          },
          get address() {
            return { host, port, path: sharedGqlPath }
          },
        }
      }

      // Start HTTP adapter (always)
      httpServer = createHttpAdapter(router, {
        port,
        host,
        basePath,
        maxBodySize: httpOptions?.maxBodySize,
        contextFactory: httpOptions?.contextFactory,
        codecs: httpOptions?.codecs,
        cors: cors === true
          ? {
              origin: '*',
              methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
              headers: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id', 'Traceparent', 'Tracestate'],
            }
          : cors,
        middleware: httpMiddleware.length > 0 ? httpMiddleware : undefined,
      })
      await httpServer.start()

      // Start WebSocket adapter
      if (protocols.websocket?.enabled) {
        const wsOpts = protocols.websocket.options
        const channels = buildChannelOptions(channelRegistry, wsOpts.channels)
        if (protocols.websocket.shared) {
          // Share HTTP port - attach to HTTP server
          wsAdapter = createWebSocketAdapter(router, {
            host,
            port,
            server: httpServer.server ?? undefined,
            path: wsOpts.path || '/',
            maxPayloadSize: wsOpts.maxPayloadSize,
            heartbeatInterval: wsOpts.heartbeatInterval,
            channels,
            contextFactory: wsOpts.contextFactory,
          })
          addresses.websocket = { host, port, path: wsOpts.path || '/', shared: true }
        } else {
          wsAdapter = createWebSocketAdapter(router, {
            port: wsOpts.port!,
            host,
            path: wsOpts.path || '/',
            maxPayloadSize: wsOpts.maxPayloadSize,
            heartbeatInterval: wsOpts.heartbeatInterval,
            channels,
            contextFactory: wsOpts.contextFactory,
          })
          addresses.websocket = { host, port: wsOpts.port!, path: wsOpts.path || '/', shared: false }
        }
        await wsAdapter.start()
      }

      // Start JSON-RPC adapter
      if (protocols.jsonrpc?.enabled) {
        const rpcOpts = protocols.jsonrpc.options
        if (protocols.jsonrpc.shared) {
          const rpcPath = rpcOpts.path || '/rpc'
          addresses.jsonrpc = { host, port, path: joinBasePath(basePath, rpcPath), shared: true }
        } else {
          jsonRpcAdapter = createJsonRpcAdapter(router, {
            port: rpcOpts.port!,
            host,
            path: rpcOpts.path || '/rpc',
            timeout: rpcOpts.timeout,
            maxBodySize: rpcOpts.maxBodySize,
          })
          addresses.jsonrpc = { host, port: rpcOpts.port!, path: rpcOpts.path || '/rpc', shared: false }
          await jsonRpcAdapter.start()
        }
      }

      // Start TCP adapter
      if (protocols.tcp?.enabled) {
        const tcpOpts = protocols.tcp.options
        tcpAdapter = createTcpAdapter(router, {
          port: tcpOpts.port,
          host: tcpOpts.host || host,
          maxMessageSize: tcpOpts.maxMessageSize,
          keepAliveInterval: tcpOpts.keepAliveInterval,
        })
        await tcpAdapter.start()
        addresses.tcp = { host: tcpOpts.host || host, port: tcpOpts.port }
      }

      // Start gRPC adapter
      if (protocols.grpc?.enabled) {
        const grpcOpts = protocols.grpc.options
        grpcAdapter = createGrpcAdapter(router, {
          host: grpcOpts.host || host,
          port: grpcOpts.port,
          protoPath: grpcOpts.protoPath,
          packageName: grpcOpts.packageName,
          serviceNames: grpcOpts.serviceNames,
          loaderOptions: grpcOpts.loaderOptions,
          tls: grpcOpts.tls,
          maxReceiveMessageLength: grpcOpts.maxReceiveMessageLength,
          maxSendMessageLength: grpcOpts.maxSendMessageLength,
        })
        await grpcAdapter.start()
        if (grpcAdapter.address) {
          addresses.grpc = grpcAdapter.address
        } else {
          addresses.grpc = { host: grpcOpts.host || host, port: grpcOpts.port }
        }
      }

      // Start GraphQL adapter
      if (protocols.graphql?.enabled) {
        const gqlOpts = protocols.graphql.options
        const gqlPath = gqlOpts.path || '/graphql'
        if (protocols.graphql.shared) {
          if (graphqlAdapter) {
            await graphqlAdapter.start()
          }
          addresses.graphql = { host, port, path: joinBasePath(basePath, gqlPath), shared: true }
        } else {
          const isDev = isDevelopment()
          graphqlAdapter = createGraphQLAdapter({
            router,
            registry,
            schemaRegistry,
            host,
            port: gqlOpts.port!,
            config: {
              ...gqlOpts,
              path: gqlPath,
              playground: gqlOpts.playground ?? isDev,
              introspection: gqlOpts.introspection ?? isDev,
              timeout: gqlOpts.timeout ?? 30000,
              maxBodySize: gqlOpts.maxBodySize ?? 1024 * 1024,
            },
          })
          await graphqlAdapter.start()
          addresses.graphql = { host, port: gqlOpts.port!, path: gqlPath, shared: false }
        }
      }

      // Start custom TCP handlers (added via .addTcpHandler())
      for (const handler of tcpHandlers) {
        const { createTcpServer } = await import('./fs-routes/tcp/index.js')
        const tcpServer = createTcpServer(handler)
        await tcpServer.start()
        tcpServers.push(tcpServer)
        logger.info({ name: handler.name, port: handler.config.port }, 'TCP handler started')
      }

      // Start custom UDP handlers (added via .addUdpHandler())
      for (const handler of udpHandlers) {
        const { createUdpServer } = await import('./fs-routes/udp/index.js')
        const udpServer = createUdpServer(handler)
        await udpServer.start()
        udpServers.push(udpServer)
        logger.info({ name: handler.name, port: handler.config.port }, 'UDP handler started')
      }

      running = true
    },

    async stop() {
      if (!running) return

      const stops: Promise<void>[] = []

      if (tcpAdapter) {
        stops.push(tcpAdapter.stop())
        tcpAdapter = null
      }
      if (jsonRpcAdapter) {
        stops.push(jsonRpcAdapter.stop())
        jsonRpcAdapter = null
      }
      if (wsAdapter) {
        stops.push(wsAdapter.stop())
        wsAdapter = null
      }
      if (httpServer) {
        stops.push(httpServer.stop())
        httpServer = null
      }
      if (grpcAdapter) {
        stops.push(grpcAdapter.stop())
        grpcAdapter = null
      }
      if (graphqlAdapter) {
        stops.push(graphqlAdapter.stop())
        graphqlAdapter = null
      }

      await Promise.all(stops)

      // Stop custom TCP servers
      for (const tcpServer of tcpServers) {
        await tcpServer.stop()
      }
      tcpServers.length = 0

      // Stop custom UDP servers
      for (const udpServer of udpServers) {
        await udpServer.stop()
      }
      udpServers.length = 0

      // Stop discovery watcher
      if (discoveryWatcher) {
        discoveryWatcher.stop()
      }

      // Stop process metrics collection
      if (processMetricsCleanup) {
        processMetricsCleanup()
        processMetricsCleanup = null
      }

      // Shutdown tracer (flush pending spans)
      if (tracerInstance) {
        await tracerInstance.shutdown()
        tracerInstance = null
      }

      // Shutdown providers
      for (const [name, definition] of providerDefinitions) {
        if (definition.onShutdown && resolvedProviders[name]) {
          try {
            await definition.onShutdown(resolvedProviders[name])
            logger.debug({ name }, 'Provider shut down')
          } catch (err) {
            logger.error({ err, name }, 'Error shutting down provider')
          }
        }
      }

      router.stop()

      running = false
      addresses = null
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
      // Handler state for chained API - these are local since channel() consumes them
      let subscribeHandler: import('./types.js').WebSocketSubscribeHandler | null = null
      let messageHandler: import('./types.js').WebSocketMessageHandler | null = null
      let unsubscribeHandler: import('./types.js').WebSocketUnsubscribeHandler | null = null
      // Uses persistent wsInterceptors from outer scope for shared middleware chain

      const wsNamespace: import('./types.js').WebSocketNamespace = {
        channel(channelName: string, options?: import('./types.js').WebSocketChannelOptions) {
          // Determine auth requirement based on type
          const authRequirement = options?.type === 'public' ? 'none' : 'required'

          // Wrap handlers to match ChannelExports signature
          const wrappedOnJoin = subscribeHandler
            ? (member: { userId: string; socketId: string }, ctx: import('../types/index.js').Context) => subscribeHandler!(channelName, ctx)
            : undefined
          const wrappedOnLeave = unsubscribeHandler
            ? (member: { userId: string; socketId: string }, ctx: import('../types/index.js').Context) => unsubscribeHandler!(channelName, ctx)
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
          }
          channelRegistry.set(channelName, channelDef)
          logger.debug({ name: channelName, type: options?.type ?? 'public', auth: authRequirement }, 'Added WebSocket channel')

          return wsNamespace
        },
        onSubscribe(handler: import('./types.js').WebSocketSubscribeHandler) {
          subscribeHandler = handler
          return wsNamespace
        },
        onMessage(handler: import('./types.js').WebSocketMessageHandler) {
          messageHandler = handler
          return wsNamespace
        },
        onUnsubscribe(handler: import('./types.js').WebSocketUnsubscribeHandler) {
          unsubscribeHandler = handler
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
      const streamsNamespace: import('./types.js').StreamsNamespace = {
        source(name: string, optionsOrHandler: any, maybeHandler?: any) {
          const isOptionsObject = typeof optionsOrHandler === 'object' && optionsOrHandler !== null && !isAsyncIterable(optionsOrHandler)
          const options = isOptionsObject ? (optionsOrHandler as import('./types.js').StreamOptions) : {}
          const handler = isOptionsObject ? maybeHandler : optionsOrHandler

          // Register as a stream handler using the registry
          const streamName = `stream:${name}`
          const interceptors = [...globalInterceptors, ...streamInterceptors]

          if (options.input) {
            const schema: HandlerSchema = { input: options.input }
            schemaRegistry.register(streamName, schema)
            interceptors.unshift(createValidationInterceptor(schema))
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
          const isOptionsObject = typeof optionsOrHandler === 'object' && optionsOrHandler !== null
          const options = isOptionsObject ? (optionsOrHandler as import('./types.js').StreamOptions) : {}
          const handler = isOptionsObject ? maybeHandler : optionsOrHandler

          const streamName = `stream:${name}`
          const interceptors = [...globalInterceptors, ...streamInterceptors]

          if (options.input) {
            const schema: HandlerSchema = { input: options.input }
            schemaRegistry.register(streamName, schema)
            interceptors.unshift(createValidationInterceptor(schema))
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
          const isOptionsObject = typeof optionsOrHandler === 'object' && optionsOrHandler !== null
          const options = isOptionsObject ? (optionsOrHandler as import('./types.js').StreamOptions) : {}
          const handler = isOptionsObject ? maybeHandler : optionsOrHandler

          const streamName = `stream:${name}`
          const interceptors = [...globalInterceptors, ...streamInterceptors]

          if (options.input) {
            const schema: HandlerSchema = { input: options.input }
            schemaRegistry.register(streamName, schema)
            interceptors.unshift(createValidationInterceptor(schema))
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

        const interceptors = [...globalInterceptors, ...rpcInterceptors]

        if (options.input) {
          const schema: HandlerSchema = { input: options.input, output: options.output }
          schemaRegistry.register(name, schema)
          interceptors.unshift(createValidationInterceptor(schema))
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
              const interceptors = [...globalInterceptors, ...grpcInterceptors]

              if (options.input || options.output) {
                const schema: HandlerSchema = {}
                if (options.input) schema.input = options.input
                if (options.output) schema.output = options.output
                schemaRegistry.register(procedureName, schema)
                interceptors.unshift(createValidationInterceptor(schema))
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
      return running
    },

    get addresses() {
      return addresses
    },

    get channels() {
      return wsAdapter?.channels ?? null
    },

    get discoveryWatcher() { return discoveryWatcher },
    get providers() { return resolvedProviders },
    get graphql() { return graphqlAdapter },
    get metrics() { return metricsRegistry },
    get tracer() { return tracerInstance },
    get usd() { return usdDocsHandlers },

    // === USD Document Access ===

    getUSDDocument() {
      if (!usdDocsHandlers) {
        return null
      }
      return usdDocsHandlers.getUSDDocument()
    },

    getOpenAPIDocument() {
      if (!usdDocsHandlers) {
        return null
      }
      return usdDocsHandlers.getOpenAPIDocument()
    },
  } as RaffelServer

  return server
}
