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
import { createJsonRpcAdapter } from '../adapters/jsonrpc.js'
import { createGrpcAdapter } from '../adapters/grpc.js'
import { createGraphQLAdapter, type GraphQLAdapter } from '../graphql/index.js'
import { getRouterModuleDefinition } from './router-module.js'
import { createSchemaRegistry, createValidationInterceptor } from '../validation/index.js'
import type { Registry } from '../core/registry.js'
import type { Router } from '../core/router.js'
import type {
  Interceptor,
  ProcedureHandler,
  StreamHandler,
  EventHandler,
  StreamDirection,
  Context,
  RetryPolicy,
} from '../types/index.js'
import type { SchemaRegistry, HandlerSchema } from '../validation/index.js'
import type {
  ServerOptions,
  WebSocketOptions,
  JsonRpcOptions,
  TcpOptions,
  GrpcOptions,
  ProtocolConfig,
  ServerAddresses,
  RaffelServer,
  ProcedureBuilder,
  StreamBuilder,
  EventBuilder,
  GroupBuilder,
  RouterModule,
  MountOptions,
  AddProcedureInput,
  AddStreamInput,
  AddEventInput,
} from './types.js'
import type { GraphQLOptions } from '../graphql/index.js'
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

const logger = createLogger('server')

/**
 * Create handler builders for fluent registration
 */
function createProcedureBuilder(
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  name: string,
  inheritedInterceptors: Interceptor[] = []
): ProcedureBuilder {
  let inputSchema: z.ZodType | undefined
  let outputSchema: z.ZodType | undefined
  let description: string | undefined
  const interceptors: Interceptor[] = [...inheritedInterceptors]

  const builder: ProcedureBuilder = {
    input(schema) {
      inputSchema = schema
      return builder as ProcedureBuilder<z.infer<typeof schema>, unknown>
    },
    output(schema) {
      outputSchema = schema
      return builder as ProcedureBuilder<unknown, z.infer<typeof schema>>
    },
    description(desc) {
      description = desc
      return builder
    },
    use(interceptor) {
      interceptors.push(interceptor)
      return builder
    },
    handler(fn) {
      // Register schema if defined
      if (inputSchema || outputSchema) {
        const schema: HandlerSchema = {}
        if (inputSchema) schema.input = inputSchema
        if (outputSchema) schema.output = outputSchema
        schemaRegistry.register(name, schema)

        // Add validation interceptor
        interceptors.unshift(createValidationInterceptor(schema))
      }

      // Register the procedure
      registry.procedure(name, fn as ProcedureHandler, {
        description,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    },
  }

  return builder
}

function createStreamBuilder(
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  name: string,
  inheritedInterceptors: Interceptor[] = []
): StreamBuilder {
  let inputSchema: z.ZodType | undefined
  let outputSchema: z.ZodType | undefined
  let description: string | undefined
  let direction: StreamDirection | undefined
  const interceptors: Interceptor[] = [...inheritedInterceptors]

  const builder: StreamBuilder = {
    input(schema) {
      inputSchema = schema
      return builder as StreamBuilder<z.infer<typeof schema>, unknown>
    },
    output(schema) {
      outputSchema = schema
      return builder as StreamBuilder<unknown, z.infer<typeof schema>>
    },
    direction(value) {
      direction = value
      return builder
    },
    description(desc) {
      description = desc
      return builder
    },
    use(interceptor) {
      interceptors.push(interceptor)
      return builder
    },
    handler(fn) {
      if (inputSchema || outputSchema) {
        const schema: HandlerSchema = {}
        if (inputSchema) schema.input = inputSchema
        if (outputSchema) schema.output = outputSchema
        schemaRegistry.register(name, schema)
      }

      registry.stream(name, fn as any, {
        description,
        direction,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    },
  }

  return builder
}

function createEventBuilder(
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  name: string,
  inheritedInterceptors: Interceptor[] = []
): EventBuilder {
  let inputSchema: z.ZodType | undefined
  let description: string | undefined
  let deliveryGuarantee: 'best-effort' | 'at-least-once' | 'at-most-once' = 'best-effort'
  let retryPolicy: RetryPolicy | undefined
  let deduplicationWindow: number | undefined
  const interceptors: Interceptor[] = [...inheritedInterceptors]

  const builder: EventBuilder = {
    input(schema) {
      inputSchema = schema
      return builder as EventBuilder<z.infer<typeof schema>>
    },
    description(desc) {
      description = desc
      return builder
    },
    use(interceptor) {
      interceptors.push(interceptor)
      return builder
    },
    delivery(guarantee) {
      deliveryGuarantee = guarantee
      return builder
    },
    retryPolicy(policy) {
      retryPolicy = policy
      return builder
    },
    deduplicationWindow(ms) {
      deduplicationWindow = ms
      return builder
    },
    handler(fn) {
      if (inputSchema) {
        schemaRegistry.register(name, { input: inputSchema })
      }

      registry.event(name, fn as any, {
        description,
        delivery: deliveryGuarantee,
        retryPolicy,
        deduplicationWindow,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    },
  }

  return builder
}

function createGroupBuilder(
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  prefix: string,
  inheritedInterceptors: Interceptor[] = []
): GroupBuilder {
  const groupInterceptors: Interceptor[] = [...inheritedInterceptors]

  const builder: GroupBuilder = {
    use(interceptor) {
      groupInterceptors.push(interceptor)
      return builder
    },
    procedure(name) {
      const fullName = `${prefix}.${name}`
      return createProcedureBuilder(registry, schemaRegistry, fullName, groupInterceptors)
    },
    stream(name) {
      const fullName = `${prefix}.${name}`
      return createStreamBuilder(registry, schemaRegistry, fullName, groupInterceptors)
    },
    event(name) {
      const fullName = `${prefix}.${name}`
      return createEventBuilder(registry, schemaRegistry, fullName, groupInterceptors)
    },
    group(subPrefix) {
      const fullPrefix = `${prefix}.${subPrefix}`
      return createGroupBuilder(registry, schemaRegistry, fullPrefix, groupInterceptors)
    },
  }

  return builder
}

function joinHandlerName(prefix: string, name: string): string {
  if (!prefix) return name
  if (!name) return prefix
  return `${prefix}.${name}`
}

/**
 * Register discovered handlers from file-system
 */
function registerDiscoveredHandlers(
  result: DiscoveryResult,
  registry: Registry,
  schemaRegistry: SchemaRegistry,
  globalInterceptors: Interceptor[]
): void {
  for (const route of result.routes) {
    // Create interceptors from route config
    const routeInterceptors = createRouteInterceptors(route)
    const interceptors = [...globalInterceptors, ...routeInterceptors]

    // Register schema if defined
    if (route.inputSchema || route.outputSchema) {
      const schema: HandlerSchema = {}
      if (route.inputSchema) schema.input = route.inputSchema
      if (route.outputSchema) schema.output = route.outputSchema
      schemaRegistry.register(route.name, schema)
    }

    // Register based on kind
    if (route.kind === 'procedure') {
      registry.procedure(route.name, route.handler as ProcedureHandler, {
        description: route.meta?.description,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    } else if (route.kind === 'stream') {
      registry.stream(route.name, route.handler as StreamHandler, {
        description: route.meta?.description,
        direction: route.meta?.direction,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    } else if (route.kind === 'event') {
      registry.event(route.name, route.handler as EventHandler, {
        description: route.meta?.description,
        delivery: route.meta?.delivery,
        retryPolicy: route.meta?.retryPolicy,
        deduplicationWindow: route.meta?.deduplicationWindow,
        interceptors: interceptors.length > 0 ? interceptors : undefined,
      })
    }

    logger.debug({ name: route.name, kind: route.kind }, 'Registered handler')
  }
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
    discovery,
    hotReload = isDevelopment(),
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
      discovery: discovery === true ? { http: true, channels: true, rpc: true, streams: true } : discovery,
      hotReload,
      onLoad: (stats) => {
        logger.info(
          { http: stats.http, rpc: stats.rpc, streams: stats.streams, channels: stats.channels, duration: stats.duration },
          `Discovered ${stats.total} handlers`
        )
      },
      onReload: async (result) => {
        // Re-register handlers on hot reload
        registerDiscoveredHandlers(result, registry, schemaRegistry, globalInterceptors)
        logger.info({ total: result.stats.total }, 'Handlers hot-reloaded')
      },
      onError: (err) => {
        logger.error({ err }, 'Discovery loading error')
      },
    })
  }

  // Protocol configuration (from options)
  const protocols: ProtocolConfig = {}

  // Process websocket option
  if (websocket) {
    if (websocket === true) {
      protocols.websocket = { enabled: true, options: { path: '/' }, shared: true }
    } else {
      protocols.websocket = {
        enabled: true,
        options: websocket,
        shared: websocket.port === undefined,
      }
    }
  }

  // Process jsonrpc option
  if (jsonrpc) {
    if (jsonrpc === true) {
      protocols.jsonrpc = { enabled: true, options: { path: '/rpc' }, shared: true }
    } else {
      protocols.jsonrpc = {
        enabled: true,
        options: jsonrpc,
        shared: jsonrpc.port === undefined,
      }
    }
  }

  // Process tcp option
  if (tcp) {
    protocols.tcp = { enabled: true, options: tcp }
  }

  // Process graphql option
  if (graphql) {
    if (graphql === true) {
      protocols.graphql = { enabled: true, options: { path: '/graphql' }, shared: true }
    } else {
      protocols.graphql = {
        enabled: true,
        options: graphql,
        shared: graphql.port === undefined,
      }
    }
  }

  // Global interceptors (from options + added via .use())
  const globalInterceptors: Interceptor[] = middleware ? [...middleware] : []

  // Active adapters
  let httpServer: ReturnType<typeof createHttpAdapter> | null = null
  let wsAdapter: ReturnType<typeof createWebSocketAdapter> | null = null
  let jsonRpcAdapter: ReturnType<typeof createJsonRpcAdapter> | null = null
  let tcpAdapter: ReturnType<typeof createTcpAdapter> | null = null
  let grpcAdapter: ReturnType<typeof createGrpcAdapter> | null = null
  let graphqlAdapter: GraphQLAdapter | null = null

  // State
  let running = false
  let addresses: ServerAddresses | null = null

  // Custom protocol handlers (added via .addTcpHandler()/.addUdpHandler())
  const tcpHandlers: LoadedTcpHandler[] = []
  const udpHandlers: LoadedUdpHandler[] = []
  const tcpServers: TcpServerInstance[] = []
  const udpServers: UdpServerInstance[] = []

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

    // === Global Middleware ===

    use(interceptor: Interceptor) {
      globalInterceptors.push(interceptor)
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

      // Fluent builder
      return createProcedureBuilder(registry, schemaRegistry, nameOrHandler, [...globalInterceptors])
    },

    stream(name: string) {
      return createStreamBuilder(registry, schemaRegistry, name, [...globalInterceptors])
    },

    event(name: string) {
      return createEventBuilder(registry, schemaRegistry, name, [...globalInterceptors])
    },

    // === Grouping ===

    group(prefix: string) {
      return createGroupBuilder(registry, schemaRegistry, prefix, [...globalInterceptors])
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
            description: route.description,
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
      const description = 'meta' in input ? input.meta?.description : (input as AddProcedureInput).description
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
        description,
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
      // Channel configuration is stored for WebSocket adapter
      // The actual subscription handling happens in the WebSocket adapter
      // For now, we just log - full implementation would require channel registry
      logger.debug({ name: channel.name }, 'Channel configuration registered')
      // TODO: Store channel config for WebSocket adapter to use during authorization
      return server
    },

    addRest(resource: LoadedRestResource) {
      // Generate routes from REST resource and register each
      for (const route of resource.routes) {
        const name = `${resource.name}.${route.operation}`

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
      return server
    },

    addResource(resource: LoadedResource) {
      // Generate routes from resource handlers
      const routes = generateResourceRoutes([resource])

      for (const route of routes) {
        const name = `${resource.name}.${route.operation}`

        registry.procedure(name, route.handler as any, {
          interceptors: globalInterceptors.length > 0 ? [...globalInterceptors] : undefined,
        })
      }

      logger.debug({ name: resource.name, operations: routes.length }, 'Added resource')
      return server
    },

    addTcpHandler(handler: LoadedTcpHandler) {
      // TCP handlers are stored for later startup
      // They create their own server instances
      tcpHandlers.push(handler)
      logger.debug({ name: handler.name, port: handler.config.port }, 'Added TCP handler')
      return server
    },

    addUdpHandler(handler: LoadedUdpHandler) {
      // UDP handlers are stored for later startup
      udpHandlers.push(handler)
      logger.debug({ name: handler.name, port: handler.config.port }, 'Added UDP handler')
      return server
    },

    addDiscovery(result: DiscoveryResult) {
      // Register all discovered handlers
      registerDiscoveredHandlers(result, registry, schemaRegistry, globalInterceptors)
      logger.debug({ routes: result.routes.length, channels: result.channels.length }, 'Added discovery result')
      return server
    },

    // === Lifecycle ===

    async start() {
      if (running) {
        throw new Error('Server is already running')
      }

      // Load file-system handlers first (before starting adapters)
      if (discoveryWatcher) {
        const result = await discoveryWatcher.start()
        registerDiscoveredHandlers(result, registry, schemaRegistry, globalInterceptors)
      }

      addresses = {
        http: { host, port },
      }

      // Start HTTP adapter (always)
      httpServer = createHttpAdapter(router, {
        port,
        host,
        basePath,
        cors: cors === true
          ? { origin: '*', methods: ['GET', 'POST', 'OPTIONS'], headers: ['Content-Type', 'Authorization'] }
          : cors || undefined,
      })
      await httpServer.start()

      // Start WebSocket adapter
      if (protocols.websocket?.enabled) {
        const wsOpts = protocols.websocket.options
        if (protocols.websocket.shared) {
          // Share HTTP port - attach to HTTP server
          // For now, create separate adapter (TODO: true HTTP upgrade sharing)
          wsAdapter = createWebSocketAdapter(router, {
            port: port + 1, // Temporary: use next port
            host,
            path: wsOpts.path || '/',
            maxPayloadSize: wsOpts.maxPayloadSize,
            heartbeatInterval: wsOpts.heartbeatInterval,
            channels: wsOpts.channels,
          })
          addresses.websocket = { host, port: port + 1, path: wsOpts.path || '/', shared: false }
        } else {
          wsAdapter = createWebSocketAdapter(router, {
            port: wsOpts.port!,
            host,
            path: wsOpts.path || '/',
            maxPayloadSize: wsOpts.maxPayloadSize,
            heartbeatInterval: wsOpts.heartbeatInterval,
            channels: wsOpts.channels,
          })
          addresses.websocket = { host, port: wsOpts.port!, path: wsOpts.path || '/', shared: false }
        }
        await wsAdapter.start()
      }

      // Start JSON-RPC adapter
      if (protocols.jsonrpc?.enabled) {
        const rpcOpts = protocols.jsonrpc.options
        if (protocols.jsonrpc.shared) {
          // Share HTTP port - JSON-RPC just needs path routing
          // TODO: Integrate with HTTP adapter for true path-based routing
          jsonRpcAdapter = createJsonRpcAdapter(router, {
            port: port + 2, // Temporary: use different port
            host,
            path: rpcOpts.path || '/rpc',
            timeout: rpcOpts.timeout,
            maxBodySize: rpcOpts.maxBodySize,
          })
          addresses.jsonrpc = { host, port: port + 2, path: rpcOpts.path || '/rpc', shared: false }
        } else {
          jsonRpcAdapter = createJsonRpcAdapter(router, {
            port: rpcOpts.port!,
            host,
            path: rpcOpts.path || '/rpc',
            timeout: rpcOpts.timeout,
            maxBodySize: rpcOpts.maxBodySize,
          })
          addresses.jsonrpc = { host, port: rpcOpts.port!, path: rpcOpts.path || '/rpc', shared: false }
        }
        await jsonRpcAdapter.start()
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
        const gqlPort = protocols.graphql.shared ? port + 3 : gqlOpts.port!
        const gqlPath = gqlOpts.path || '/graphql'
        const isDev = isDevelopment()

        graphqlAdapter = createGraphQLAdapter({
          router,
          registry,
          schemaRegistry,
          host,
          port: gqlPort,
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
        addresses.graphql = { host, port: gqlPort, path: gqlPath, shared: protocols.graphql.shared }
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

      router.stop()

      running = false
      addresses = null
    },

    async restart() {
      await server.stop()
      await server.start()
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

    get discoveryWatcher() {
      return discoveryWatcher
    },

    // Deprecated alias
    get routeWatcher() {
      return discoveryWatcher
    },

    get graphql() {
      return graphqlAdapter
    },
  } as RaffelServer

  return server
}
