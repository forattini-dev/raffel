import { createConnection, type Socket } from 'node:net'

import { createHttpAdapter, type HttpAdapterOptions, type HttpMiddleware } from '../../adapters/http.js'
import { createPortBinding, type PortBinding } from '../port-binding.js'
import { createWebSocketAdapter } from '../../adapters/websocket.js'
import { createTcpAdapter, createTcpConnectionHandler } from '../../adapters/tcp.js'
import { createJsonRpcAdapter, createJsonRpcMiddleware } from '../../adapters/jsonrpc.js'
import { createGrpcAdapter, type GrpcAdapter } from '../../adapters/grpc.js'
import {
  createGraphQLAdapter,
  createGraphQLMiddleware,
  type GraphQLOptions,
  type GraphQLAdapter,
  type GraphQLMiddleware,
} from '../../graphql/index.js'
import { createUSDHandlers } from '../../docs/index.js'
import { isDevelopment, type DiscoveryResult } from '../fs-routes/index.js'
import type { DiscoveryBootstrap } from '../discovery-bootstrap.js'
import {
  collectTelemetryShutdownTasks,
  initializeTelemetry,
  type StopTask,
  type TelemetryState,
} from '../telemetry-bootstrap.js'
import { buildChannelOptions, joinBasePath } from '../channel-utils.js'
import {
  createDocsRouteMiddleware,
  createHttpOverrideMiddleware,
  logRestMiddlewareRegistered,
  createRestMiddleware,
} from '../rest-middleware.js'
import type { Interceptor } from '../../types/index.js'
import {
  createRegistry,
} from '../../core/registry.js'
import { createRouter } from '../../core/router.js'
import { createSchemaRegistry } from '../../validation/index.js'
import type {
  FrontDoorTransport,
  ProtocolFusionDecision,
  ProtocolAdapter,
  ProtocolExtensionConfig,
  ProtocolAdapterContext,
  ProtocolConfig,
  ProviderDefinition,
  ResolvedProviders,
  ServerAddresses,
  SinglePortConfig,
  USDDocsConfig,
} from '../types.js'
import type { RecordProtocolFusionDecisionInput } from '../protocol-fusion-diagnostics.js'
import type {
  LoadedChannel,
  LoadedRestResource,
  LoadedTcpHandler,
  LoadedUdpHandler,
  TcpServerInstance,
  UdpServerInstance,
} from '../fs-routes/index.js'
import type { USDHandlers } from '../../docs/usd-middleware.js'
import { cleanupResolvedProviders as cleanupResolvedProvidersInternal, runStopTasks as runStopTasksInternal } from './lifecycle-utils.js'
import type { WebSocketMessageHandler, HttpOptions } from '../types.js'
import type { Logger } from 'pino'

interface MutableRef<T> {
  value: T
}

interface SinglePortSocketConnectionHandler {
  handleConnection(socket: Socket): void
  closeAllConnections(): void
  readonly clientCount: number
}

function createGrpcProxyConnectionHandler(options: {
  getAddress: () => { host: string; port: number } | null
  logger: Pick<ServerLifecycleContext['logger'], 'debug' | 'warn'>
}): SinglePortSocketConnectionHandler {
  const connections = new Set<Socket>()

  return {
    handleConnection(socket: Socket): void {
      const address = options.getAddress()
      if (!address) {
        options.logger.warn({ remoteAddress: socket.remoteAddress, remotePort: socket.remotePort }, 'Dropping single-port gRPC connection before upstream was ready')
        socket.destroy()
        return
      }

      const upstream = createConnection(address)
      connections.add(socket)
      connections.add(upstream)

      const cleanup = () => {
        connections.delete(socket)
        connections.delete(upstream)
      }

      socket.pipe(upstream)
      upstream.pipe(socket)

      upstream.on('error', (error) => {
        options.logger.warn({ err: error, address }, 'Single-port gRPC upstream proxy failed')
        if (!socket.destroyed) {
          socket.destroy()
        }
      })

      socket.on('error', (error) => {
        options.logger.warn({ err: error, address }, 'Single-port gRPC client proxy failed')
        if (!upstream.destroyed) {
          upstream.destroy()
        }
      })

      upstream.on('close', () => {
        if (!socket.destroyed) {
          socket.destroy()
        }
      })
      upstream.on('close', cleanup)
      socket.on('close', () => {
        if (!upstream.destroyed) {
          upstream.destroy()
        }
        cleanup()
      })
    },

    closeAllConnections(): void {
      for (const connection of connections) {
        if (!connection.destroyed) {
          connection.destroy()
        }
      }
      connections.clear()
    },

    get clientCount(): number {
      return Math.floor(connections.size / 2)
    },
  }
}

export interface ServerLifecycleContext {
  logger: {
    debug: (...args: unknown[]) => void
    info: (...args: unknown[]) => void
    warn: (...args: unknown[]) => void
    error: (...args: unknown[]) => void
  }

  state: {
    running: MutableRef<boolean>
    addresses: MutableRef<ServerAddresses | null>
    providerMiddlewareInstalled: MutableRef<boolean>
    portBinding: MutableRef<PortBinding | null>
    singlePortTcpConnectionHandler: MutableRef<ReturnType<typeof createTcpConnectionHandler> | null>
    singlePortGrpcConnectionHandler: MutableRef<SinglePortSocketConnectionHandler | null>
    httpServer: MutableRef<ReturnType<typeof createHttpAdapter> | null>
    wsAdapter: MutableRef<ReturnType<typeof createWebSocketAdapter> | null>
    jsonRpcAdapter: MutableRef<ReturnType<typeof createJsonRpcAdapter> | null>
    tcpAdapter: MutableRef<ReturnType<typeof createTcpAdapter> | null>
    grpcAdapter: MutableRef<GrpcAdapter | null>
    graphqlAdapter: MutableRef<GraphQLAdapter | null>
    graphqlMiddleware: MutableRef<GraphQLMiddleware | null>
    graphqlSubscriptionServer: MutableRef<ReturnType<GraphQLMiddleware['createSubscriptionServer']> | null>
    usdDocsHandlers: MutableRef<USDHandlers | null>
  }

  discoveryBootstrap: DiscoveryBootstrap
  telemetryState: TelemetryState

  protocolExtensionConfigs: ProtocolExtensionConfig[]
  protocolAdapters: Map<string, ProtocolAdapter>
  providerDefinitions: Map<string, ProviderDefinition>
  resolvedProviders: ResolvedProviders

  frontDoorEnabled: boolean
  frontDoorProtocols: FrontDoorTransport[] | null
  protocols: ProtocolConfig

  registry: ReturnType<typeof createRegistry>
  schemaRegistry: ReturnType<typeof createSchemaRegistry>
  router: ReturnType<typeof createRouter>
  globalInterceptors: Interceptor[]
  channelRegistry: Map<string, LoadedChannel>
  restResourceRegistry: LoadedRestResource[]
  tcpHandlers: LoadedTcpHandler[]
  udpHandlers: LoadedUdpHandler[]
  tcpServers: TcpServerInstance[]
  udpServers: UdpServerInstance[]

  singlePortConfig: SinglePortConfig
  isSinglePortTcpRouteEnabled: () => boolean
  isSinglePortGrpcRouteEnabled: () => boolean
  isSinglePortUdpRouteEnabled: (handler: LoadedUdpHandler) => boolean
  getSinglePortSource: () => 'singlePort' | 'offload' | 'native' | 'custom' | 'unknown'

  getSinglePortAliasMode: () => 'standard' | 'extended'
  recordProtocolFusionDecision?: (decision: RecordProtocolFusionDecisionInput) => ProtocolFusionDecision | void
  createFrontDoorDecisionMiddleware: () => any
  applyDiscoveryResult: (result: DiscoveryResult) => void
  logSinglePortConfig: () => void

  host: string
  effectiveHost: string
  effectivePort: number
  basePath: string
  cors: HttpAdapterOptions['cors']
  httpOptions: HttpOptions | undefined
  wsMessageHandler?: WebSocketMessageHandler | null

  usdDocsConfig: USDDocsConfig | null
}

export function createServerLifecycle(context: ServerLifecycleContext) {
  const {
    logger,
    state,
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
    isSinglePortGrpcRouteEnabled,
    isSinglePortUdpRouteEnabled,
    getSinglePortSource,
    getSinglePortAliasMode,
    recordProtocolFusionDecision,
    createFrontDoorDecisionMiddleware,
    applyDiscoveryResult,
    logSinglePortConfig,
    host,
    effectiveHost,
    effectivePort,
    basePath,
    cors,
    httpOptions,
    wsMessageHandler,
    usdDocsConfig,
  } = context

  async function start() {
    if (state.running.value) {
      throw new Error('Server is already running')
    }

    const startupStopTasks: StopTask[] = []

    try {
      logSinglePortConfig()

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

        if (!state.providerMiddlewareInstalled.value) {
          globalInterceptors.unshift(async (_env: unknown, ctx: unknown, next: () => Promise<unknown>) => {
            const ctxAny = ctx as Record<string, unknown>
            for (const [name, instance] of Object.entries(resolvedProviders)) {
              ctxAny[name] = instance
            }
            return next()
          })
          state.providerMiddlewareInstalled.value = true
        }
      }

      await initializeTelemetry(telemetryState, {
        registry,
        startupStopTasks,
        globalInterceptors,
        logger: {
          debug: logger.debug.bind(logger),
          info: logger.info.bind(logger),
        },
      })

      const discoveryResult = await discoveryBootstrap.start()
      if (discoveryResult) {
        applyDiscoveryResult(discoveryResult)
        startupStopTasks.push({
          name: 'discovery-watcher',
          stop: async () => {
            discoveryBootstrap.stop()
          },
        })
      }

      state.addresses.value = {
        http: {
          host: effectiveHost,
          port: effectivePort,
          frontDoor: frontDoorEnabled,
          strategy: frontDoorEnabled ? 'shared' : 'native',
          source: getSinglePortSource(),
        },
      }

      const httpMiddleware: HttpMiddleware[] = []
      const frontDoorDecisionMiddleware = createFrontDoorDecisionMiddleware()
      if (frontDoorDecisionMiddleware) {
        httpMiddleware.push(frontDoorDecisionMiddleware)
      }
      if (httpOptions?.middleware?.length) {
        httpMiddleware.push(...httpOptions.middleware)
      }

      if (usdDocsConfig) {
        state.usdDocsHandlers.value = createUSDHandlers(
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
            contentTypes: usdDocsConfig.contentTypes,
            securitySchemes: usdDocsConfig.securitySchemes,
            defaultSecurity: usdDocsConfig.defaultSecurity,
            tags: usdDocsConfig.tags,
            tagGroups: usdDocsConfig.tagGroups,
            externalDocs: usdDocsConfig.externalDocs,
            ui: usdDocsConfig.ui,
            documentation: usdDocsConfig.documentation,
            includeErrorSchemas: usdDocsConfig.includeErrorSchemas,
            includeStreamEventSchemas: usdDocsConfig.includeStreamEventSchemas,
            jsonrpc: usdDocsConfig.jsonrpc,
            grpc: usdDocsConfig.grpc,
          }
        )

        const usdBasePath = usdDocsConfig.basePath ?? '/docs'
        httpMiddleware.push(createDocsRouteMiddleware([
          { method: 'GET', path: usdBasePath, handler: state.usdDocsHandlers.value.serveUI },
          { method: 'GET', path: `${usdBasePath}/usd.json`, handler: state.usdDocsHandlers.value.serveUSD },
          { method: 'GET', path: `${usdBasePath}/usd.yaml`, handler: state.usdDocsHandlers.value.serveUSDYaml },
          { method: 'GET', path: `${usdBasePath}/openapi.json`, handler: state.usdDocsHandlers.value.serveOpenAPI },
        ]))
        logger.info({ basePath: usdBasePath }, 'USD Documentation middleware registered')
      }

      httpMiddleware.push(
        createHttpOverrideMiddleware({
          router,
          registry,
          basePath,
          maxBodySize: httpOptions?.maxBodySize ?? 1024 * 1024,
          contextFactory: httpOptions?.contextFactory,
          codecs: httpOptions?.codecs,
        })
      )

      if (restResourceRegistry.length > 0) {
        httpMiddleware.push(
          createRestMiddleware({
            restResources: restResourceRegistry,
            router,
            basePath,
            maxBodySize: httpOptions?.maxBodySize ?? 1024 * 1024,
            contextFactory: httpOptions?.contextFactory,
            codecs: httpOptions?.codecs,
          })
        )
        logRestMiddlewareRegistered(restResourceRegistry.length)
      }

      if (protocols.jsonrpc?.enabled && protocols.jsonrpc.shared) {
        const rpcOpts = protocols.jsonrpc.options
        const rpcPath = rpcOpts.path || '/rpc'
        const sharedRpcPath = joinBasePath(basePath, rpcPath)
        state.addresses.value = {
          ...state.addresses.value!,
          jsonrpc: {
            host: effectiveHost,
            port: effectivePort,
            path: sharedRpcPath,
            shared: true,
            frontDoor: !!protocols.jsonrpc?.frontDoor,
            strategy: protocols.jsonrpc?.strategy,
            source: singlePortConfig.enabled ? 'singlePort' : 'native',
          },
        }
        httpMiddleware.push(createJsonRpcMiddleware(router, {
          path: sharedRpcPath,
          timeout: rpcOpts.timeout,
          maxBodySize: rpcOpts.maxBodySize,
          cors: false,
          codecs: rpcOpts.codecs,
        }))
      }

      if (protocols.graphql?.enabled && protocols.graphql.shared) {
        const gqlOpts = protocols.graphql.options
        const gqlPath = gqlOpts.path || '/graphql'
        const sharedGqlPath = joinBasePath(basePath, gqlPath)
        const isDev = isDevelopment()

        state.graphqlMiddleware.value = createGraphQLMiddleware({
          router,
          registry,
          schemaRegistry,
          config: {
            ...(gqlOpts as GraphQLOptions),
            path: sharedGqlPath,
            playground: gqlOpts.playground ?? isDev,
            introspection: gqlOpts.introspection ?? isDev,
            timeout: gqlOpts.timeout ?? 30000,
            maxBodySize: gqlOpts.maxBodySize ?? 1024 * 1024,
          },
        })
        httpMiddleware.push(state.graphqlMiddleware.value.middleware)

        state.graphqlAdapter.value = {
          async start() {
            if (!state.httpServer.value?.server) return
            state.graphqlSubscriptionServer.value = state.graphqlMiddleware.value?.createSubscriptionServer(
              state.httpServer.value.server
            ) ?? null
          },
          async stop() {
            if (state.graphqlSubscriptionServer.value) {
              state.graphqlSubscriptionServer.value.close()
              state.graphqlSubscriptionServer.value = null
            }
          },
          get schema() {
            return state.graphqlMiddleware.value!.schema
          },
          get schemaInfo() {
            return state.graphqlMiddleware.value!.schemaInfo
          },
          get address() {
            return { host: effectiveHost, port: effectivePort, path: sharedGqlPath }
          },
        }

        state.addresses.value = {
          ...state.addresses.value!,
          graphql: {
            host: effectiveHost,
            port: effectivePort,
            path: sharedGqlPath,
            shared: true,
            frontDoor: !!protocols.graphql?.frontDoor,
            strategy: protocols.graphql?.strategy,
            source: singlePortConfig.enabled ? 'singlePort' : 'native',
          },
        }
      }

      if (isSinglePortTcpRouteEnabled() && protocols.tcp?.enabled && !state.singlePortTcpConnectionHandler.value) {
        const tcpOpts = protocols.tcp.options
        state.singlePortTcpConnectionHandler.value = createTcpConnectionHandler(router, {
          maxMessageSize: tcpOpts.maxMessageSize,
          keepAliveInterval: tcpOpts.keepAliveInterval,
        })
      }

      if (state.singlePortTcpConnectionHandler.value) {
        state.addresses.value = {
          ...state.addresses.value!,
          tcp: {
            host: effectiveHost,
            port: effectivePort,
            frontDoor: false,
            strategy: 'native',
            source: 'singlePort',
          },
        }
      }

      const singlePortGrpcEnabled = isSinglePortGrpcRouteEnabled()
      if (singlePortGrpcEnabled) {
        const grpcOpts = protocols.grpc!.options
        if (grpcOpts.tls) {
          throw new Error('single-port gRPC currently supports h2c/insecure mode only; keep TLS gRPC on a dedicated listener')
        }

        state.grpcAdapter.value = createGrpcAdapter(router, {
          host: '127.0.0.1',
          port: 0,
          protoPath: grpcOpts.protoPath,
          packageName: grpcOpts.packageName,
          serviceNames: grpcOpts.serviceNames,
          loaderOptions: grpcOpts.loaderOptions,
          maxReceiveMessageLength: grpcOpts.maxReceiveMessageLength,
          maxSendMessageLength: grpcOpts.maxSendMessageLength,
        })
        await state.grpcAdapter.value.start()
        state.singlePortGrpcConnectionHandler.value = createGrpcProxyConnectionHandler({
          getAddress: () => state.grpcAdapter.value?.address ?? null,
          logger,
        })
        state.addresses.value = {
          ...state.addresses.value!,
          grpc: {
            host: effectiveHost,
            port: effectivePort,
            shared: true,
            frontDoor: !!protocols.grpc?.frontDoor,
            strategy: protocols.grpc?.strategy,
            source: 'singlePort',
          },
        }
        startupStopTasks.push({
          name: 'grpc',
          stop: async () => {
            state.singlePortGrpcConnectionHandler.value?.closeAllConnections()
            state.singlePortGrpcConnectionHandler.value = null
            if (!state.grpcAdapter.value) return
            await state.grpcAdapter.value.stop()
            state.grpcAdapter.value = null
          },
        })
      }

      // Create the PortBinding — always used regardless of singlePort mode.
      // It owns the OS port via a net.Server and dispatches connections.
      const portBinding = createPortBinding({
        port: effectivePort,
        host: effectiveHost,
        logger: {
          debug: (context, message) => logger.debug(context, message),
          warn: (context, message) => logger.warn(context, message),
        },
      })

      // Attach TCP handler when it shares the HTTP port.
      if (state.singlePortTcpConnectionHandler.value) {
        portBinding.attachTcpHandler(state.singlePortTcpConnectionHandler.value)
      }
      if (state.singlePortGrpcConnectionHandler.value) {
        portBinding.attachGrpcHandler(state.singlePortGrpcConnectionHandler.value)
      }

      // Activate protocol sniffing whenever singlePort mode is enabled.
      // Without a TCP handler, unknown protocols still get rejected (HTTP 400).
      if (singlePortConfig.enabled) {
        portBinding.setSinglePortConfig(
          singlePortConfig,
          getSinglePortAliasMode,
          recordProtocolFusionDecision
        )
      }

      state.httpServer.value = createHttpAdapter(router, {
        port: effectivePort,
        host: effectiveHost,
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
        listenOnStart: false,
        tls: httpOptions?.tls,
      })
      await state.httpServer.value.start()
      startupStopTasks.push({
        name: 'http',
        stop: async () => {
          if (!state.httpServer.value) return
          await state.httpServer.value.stop()
          state.httpServer.value = null
        },
      })

      // Forward HTTP connections from the PortBinding's net.Server.
      portBinding.attachHttpServer(state.httpServer.value.server!)

      // Bind the port. The PortBinding's net.Server now owns the OS port.
      const boundPort = await portBinding.start()
      logger.info({ port: boundPort, host: effectiveHost }, 'Port binding listening')
      state.portBinding.value = portBinding
      startupStopTasks.push({
        name: 'port-binding',
        stop: async () => {
          await portBinding.stop()
          state.portBinding.value = null
        },
      })

      if (protocols.websocket?.enabled) {
        const wsOpts = protocols.websocket.options
        const channels = buildChannelOptions(channelRegistry, wsOpts.channels, wsMessageHandler ?? undefined)

        if (protocols.websocket.shared) {
          state.wsAdapter.value = createWebSocketAdapter(router, {
            host: effectiveHost,
            port: effectivePort,
            server: state.httpServer.value.server ?? undefined,
            path: wsOpts.path || '/',
            maxPayloadSize: wsOpts.maxPayloadSize,
            heartbeatInterval: wsOpts.heartbeatInterval,
            channels,
            contextFactory: wsOpts.contextFactory,
          })
          state.addresses.value = {
            ...state.addresses.value!,
            websocket: {
              host: effectiveHost,
              port: effectivePort,
              path: wsOpts.path || '/',
              shared: true,
              frontDoor: !!protocols.websocket?.frontDoor,
              strategy: protocols.websocket?.strategy,
              source: singlePortConfig.enabled ? 'singlePort' : (protocols.websocket?.frontDoor ? 'offload' : 'native'),
            },
          }
        } else {
          state.wsAdapter.value = createWebSocketAdapter(router, {
            port: wsOpts.port!,
            host,
            path: wsOpts.path || '/',
            maxPayloadSize: wsOpts.maxPayloadSize,
            heartbeatInterval: wsOpts.heartbeatInterval,
            channels,
            contextFactory: wsOpts.contextFactory,
          })
          state.addresses.value = {
            ...state.addresses.value!,
            websocket: {
              host,
              port: wsOpts.port!,
              path: wsOpts.path || '/',
              shared: false,
              frontDoor: !!protocols.websocket?.frontDoor,
              strategy: protocols.websocket?.strategy,
              source: protocols.websocket?.frontDoor ? 'offload' : 'native',
            },
          }
        }

        await state.wsAdapter.value.start()
        startupStopTasks.push({
          name: 'websocket',
          stop: async () => {
            if (!state.wsAdapter.value) return
            await state.wsAdapter.value.stop()
            state.wsAdapter.value = null
          },
        })
      }

      if (protocols.jsonrpc?.enabled && !protocols.jsonrpc.shared) {
        const rpcOpts = protocols.jsonrpc.options
        state.jsonRpcAdapter.value = createJsonRpcAdapter(router, {
          port: rpcOpts.port!,
          host,
          path: rpcOpts.path || '/rpc',
          timeout: rpcOpts.timeout,
          maxBodySize: rpcOpts.maxBodySize,
        })
        await state.jsonRpcAdapter.value.start()
        startupStopTasks.push({
          name: 'jsonrpc',
          stop: async () => {
            if (!state.jsonRpcAdapter.value) return
            await state.jsonRpcAdapter.value.stop()
            state.jsonRpcAdapter.value = null
          },
        })
        state.addresses.value = {
          ...state.addresses.value!,
          jsonrpc: {
            host,
            port: rpcOpts.port!,
            path: rpcOpts.path || '/rpc',
            shared: false,
            frontDoor: !!protocols.jsonrpc?.frontDoor,
            strategy: protocols.jsonrpc?.strategy,
            source: protocols.jsonrpc?.frontDoor ? 'offload' : 'native',
          },
        }
      }

      if (protocols.tcp?.enabled) {
        const tcpOpts = protocols.tcp.options
        if (!state.singlePortTcpConnectionHandler.value) {
          state.tcpAdapter.value = createTcpAdapter(router, {
            port: tcpOpts.port,
            host: tcpOpts.host || host,
            maxMessageSize: tcpOpts.maxMessageSize,
            keepAliveInterval: tcpOpts.keepAliveInterval,
          })
          await state.tcpAdapter.value.start()
          startupStopTasks.push({
            name: 'tcp',
            stop: async () => {
              if (!state.tcpAdapter.value) return
              await state.tcpAdapter.value.stop()
              state.tcpAdapter.value = null
            },
          })
          state.addresses.value = {
            ...state.addresses.value!,
            tcp: {
              host: tcpOpts.host || host,
              port: tcpOpts.port,
              frontDoor: !!protocols.tcp?.frontDoor,
              strategy: protocols.tcp?.strategy,
              source: protocols.tcp?.frontDoor ? 'offload' : 'native',
            },
          }
        }
      }

      if (protocols.grpc?.enabled && !singlePortGrpcEnabled) {
        const grpcOpts = protocols.grpc.options
        state.grpcAdapter.value = createGrpcAdapter(router, {
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
        await state.grpcAdapter.value.start()
        startupStopTasks.push({
          name: 'grpc',
          stop: async () => {
            if (!state.grpcAdapter.value) return
            await state.grpcAdapter.value.stop()
            state.grpcAdapter.value = null
          },
        })

        if (state.grpcAdapter.value.address) {
          const grpcAddr = state.grpcAdapter.value.address
          state.addresses.value = {
            ...state.addresses.value!,
            grpc: {
              host: grpcAddr.host || host,
              port: grpcAddr.port,
              frontDoor: !!protocols.grpc?.frontDoor,
              strategy: protocols.grpc?.strategy,
              source: protocols.grpc?.frontDoor ? 'offload' : 'native',
            },
          }
        } else {
          state.addresses.value = {
            ...state.addresses.value!,
            grpc: {
              host: grpcOpts.host || host,
              port: grpcOpts.port,
              frontDoor: !!protocols.grpc?.frontDoor,
              strategy: protocols.grpc?.strategy,
              source: protocols.grpc?.frontDoor ? 'offload' : 'native',
            },
          }
        }
      }

      if (protocols.graphql?.enabled && !protocols.graphql.shared) {
        const gqlOpts = protocols.graphql.options
        const gqlPath = gqlOpts.path || '/graphql'
        const isDev = isDevelopment()

        state.graphqlAdapter.value = createGraphQLAdapter({
          router,
          registry,
          schemaRegistry,
          host,
          port: gqlOpts.port!,
          config: {
            ...(gqlOpts as GraphQLOptions),
            path: gqlPath,
            playground: gqlOpts.playground ?? isDev,
            introspection: gqlOpts.introspection ?? isDev,
            timeout: gqlOpts.timeout ?? 30000,
            maxBodySize: gqlOpts.maxBodySize ?? 1024 * 1024,
          },
        })

        await state.graphqlAdapter.value.start()
        startupStopTasks.push({
          name: 'graphql',
          stop: async () => {
            if (!state.graphqlAdapter.value) return
            await state.graphqlAdapter.value.stop()
            state.graphqlAdapter.value = null
          },
        })

        state.addresses.value = {
          ...state.addresses.value!,
          graphql: {
            host,
            port: gqlOpts.port!,
            path: gqlPath,
            shared: false,
            frontDoor: !!protocols.graphql?.frontDoor,
            strategy: protocols.graphql?.strategy,
            source: protocols.graphql?.frontDoor ? 'offload' : 'native',
          },
        }
      }

      if (protocolExtensionConfigs.length > 0) {
        const protocolContext: ProtocolAdapterContext = {
          router,
          registry,
          schemaRegistry,
          httpServer: state.httpServer.value,
          basePath,
          host: effectiveHost,
          port: effectivePort,
          providers: resolvedProviders,
        }

        for (const extension of protocolExtensionConfigs) {
          const extensionName = extension.name
          const adapter = await extension.factory(protocolContext, extension.options)
          protocolAdapters.set(extensionName, adapter)
          await adapter.start()
          startupStopTasks.push({
            name: `protocol-extension:${extensionName}`,
            stop: async () => {
              const toStop = protocolAdapters.get(extensionName)
              if (!toStop) return
              await toStop.stop()
              protocolAdapters.delete(extensionName)
            },
          })

          if (adapter.address) {
            if (state.addresses.value && !state.addresses.value.protocols) {
              state.addresses.value = {
                ...state.addresses.value,
                protocols: {},
              }
            }
            if (state.addresses.value?.protocols) {
              state.addresses.value.protocols[extensionName] = adapter.address
            }
          }

          logger.info({ name: extensionName }, 'Protocol adapter started')
        }
      }

      for (const handler of tcpHandlers) {
        const { createTcpServer } = await import('../fs-routes/tcp/index.js')
        const tcpServer = createTcpServer(handler)
        await tcpServer.start()
        tcpServers.push(tcpServer)
        startupStopTasks.push({
          name: `tcp-handler:${handler.name}`,
          stop: async () => {
            await tcpServer.stop()
          },
        })
        logger.info({ name: handler.name, port: handler.config.port }, 'TCP handler started')
      }

      for (const handler of udpHandlers) {
        const { createUdpServer } = await import('../fs-routes/udp/index.js')
        const udpServer = createUdpServer(handler)
        await udpServer.start()
        udpServers.push(udpServer)
        const isUdpOffload = frontDoorEnabled && !!frontDoorProtocols?.includes('udp')
        const isUdpSinglePort = isSinglePortUdpRouteEnabled(handler)

        if (!state.addresses.value?.udp) {
          state.addresses.value = {
            ...state.addresses.value!,
            udp: {
              host: udpServer.host,
              port: udpServer.port,
              frontDoor: isUdpOffload,
              strategy: isUdpOffload ? 'offload' : 'native',
              source: isUdpSinglePort ? 'singlePort' : isUdpOffload ? 'offload' : 'native',
            },
          }
        }

        startupStopTasks.push({
          name: `udp-handler:${handler.name}`,
          stop: async () => {
            await udpServer.stop()
          },
        })
        logger.info({ name: handler.name, port: handler.config.port }, 'UDP handler started')
      }

      state.running.value = true
    } catch (err) {
      await cleanupResolvedProvidersInternal(resolvedProviders, providerDefinitions, 'startup', logger as unknown as Logger)
      await runStopTasksInternal(startupStopTasks, 'startup', logger as unknown as Logger)
      state.addresses.value = null
      state.running.value = false
      throw err
    }
  }

  async function stop() {
    if (!state.running.value) return

    const stopTasks: StopTask[] = []

    if (protocolAdapters.size > 0) {
      for (const [name, adapter] of protocolAdapters) {
        logger.info({ name }, 'Protocol adapter stopping')
        stopTasks.push({
          name: `protocol-extension:${name}`,
          stop: async () => {
            await adapter.stop()
          },
        })
      }
      protocolAdapters.clear()
    }

    if (state.tcpAdapter.value) {
      stopTasks.push({
        name: 'tcp',
        stop: async () => {
          if (!state.tcpAdapter.value) return
          await state.tcpAdapter.value.stop()
          state.tcpAdapter.value = null
        },
      })
    }

    if (state.singlePortTcpConnectionHandler.value) {
      stopTasks.push({
        name: 'single-port-tcp-handler',
        stop: async () => {
          state.singlePortTcpConnectionHandler.value?.closeAllConnections()
          state.singlePortTcpConnectionHandler.value = null
        },
      })
    }

    if (state.singlePortGrpcConnectionHandler.value) {
      stopTasks.push({
        name: 'single-port-grpc-handler',
        stop: async () => {
          state.singlePortGrpcConnectionHandler.value?.closeAllConnections()
          state.singlePortGrpcConnectionHandler.value = null
        },
      })
    }

    if (state.jsonRpcAdapter.value) {
      stopTasks.push({
        name: 'jsonrpc',
        stop: async () => {
          if (!state.jsonRpcAdapter.value) return
          await state.jsonRpcAdapter.value.stop()
          state.jsonRpcAdapter.value = null
        },
      })
    }

    if (state.wsAdapter.value) {
      stopTasks.push({
        name: 'websocket',
        stop: async () => {
          if (!state.wsAdapter.value) return
          await state.wsAdapter.value.stop()
          state.wsAdapter.value = null
        },
      })
    }

    if (state.httpServer.value) {
      stopTasks.push({
        name: 'http',
        stop: async () => {
          if (!state.httpServer.value) return
          await state.httpServer.value.stop()
          state.httpServer.value = null
        },
      })
    }

    if (state.portBinding.value) {
      const pb = state.portBinding.value
      stopTasks.push({
        name: 'port-binding',
        stop: async () => {
          await pb.stop()
          state.portBinding.value = null
        },
      })
    }

    if (state.grpcAdapter.value) {
      stopTasks.push({
        name: 'grpc',
        stop: async () => {
          if (!state.grpcAdapter.value) return
          await state.grpcAdapter.value.stop()
          state.grpcAdapter.value = null
        },
      })
    }

    if (state.graphqlAdapter.value) {
      stopTasks.push({
        name: 'graphql',
        stop: async () => {
          if (!state.graphqlAdapter.value) return
          await state.graphqlAdapter.value.stop()
          state.graphqlMiddleware.value = null
          state.graphqlAdapter.value = null
        },
      })
    }

    for (const tcpServer of tcpServers) {
      stopTasks.push({
        name: `tcp-handler:${tcpServer.name}`,
        stop: async () => {
          await tcpServer.stop()
        },
      })
    }
    tcpServers.length = 0

    for (const udpServer of udpServers) {
      stopTasks.push({
        name: `udp-handler:${udpServer.name}`,
        stop: async () => {
          await udpServer.stop()
        },
      })
    }
    udpServers.length = 0

    if (discoveryBootstrap.watcher) {
      stopTasks.push({
        name: 'discovery-watcher',
        stop: async () => {
          discoveryBootstrap.stop()
        },
      })
    }

    collectTelemetryShutdownTasks(telemetryState, stopTasks)
    await runStopTasksInternal(stopTasks, 'shutdown', logger as unknown as Logger)
    await cleanupResolvedProvidersInternal(resolvedProviders, providerDefinitions, 'shutdown', logger as unknown as Logger)

    state.usdDocsHandlers.value = null
    state.graphqlMiddleware.value = null
    state.running.value = false
    state.addresses.value = null
    router.stop()
  }

  return { start, stop }
}
