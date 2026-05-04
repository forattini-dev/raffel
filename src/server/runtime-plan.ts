import {
  buildServerConfigPreview,
  type ServerConfigPreview,
  type ServerConfigPreviewContext,
} from './orchestration/config-preview.js'
import type { HttpAdapterOptions } from '../adapters/http.js'
import { joinBasePath } from './path-utils.js'
import type { LoadedTcpHandler, LoadedUdpHandler } from './fs-routes/index.js'
import type {
  FrontDoorProtocolAddress,
  HttpOptions,
  ProtocolConfig,
  ProtocolExtensionConfig,
  ServerAddresses,
  SinglePortConfig,
  USDDocsConfig,
} from './types.js'
import type { McpAdapterOptions } from '../protocols/mcp/types.js'

type SinglePortRouteMode = 'disabled' | 'dedicated' | 'single-port'

interface PlannedHttpBinding {
  host: string
  port: number
}

interface PlannedPortBindingConfig {
  host: string
  port: number
  attachTcpHandler: boolean
  attachGrpcHandler: boolean
  singlePortConfig?: SinglePortConfig
}

type PlannedHttpAdapterConfig = Omit<HttpAdapterOptions, 'middleware'> & {
  host: string
  port: number
  basePath: string
  listenOnStart: false
}

interface PlannedServerEntrypoint {
  portBinding: PlannedPortBindingConfig
  httpAdapter: PlannedHttpAdapterConfig
}

interface PlannedProtocolBinding<TOptions, TMode extends string> {
  mode: TMode
  host: string
  port: number
  options: TOptions
  path?: string
}

type PlannedWebSocketBinding = PlannedProtocolBinding<
  NonNullable<ProtocolConfig['websocket']>['options'],
  'shared' | 'dedicated'
>
type PlannedJsonRpcBinding = PlannedProtocolBinding<
  NonNullable<ProtocolConfig['jsonrpc']>['options'],
  'shared' | 'dedicated'
>
type PlannedGraphQLBinding = PlannedProtocolBinding<
  NonNullable<ProtocolConfig['graphql']>['options'],
  'shared' | 'dedicated'
>
type PlannedTcpBinding = PlannedProtocolBinding<
  NonNullable<ProtocolConfig['tcp']>['options'],
  'single-port' | 'dedicated'
>
type PlannedGrpcBinding = PlannedProtocolBinding<
  NonNullable<ProtocolConfig['grpc']>['options'],
  'single-port' | 'dedicated'
>

interface PlannedHttpSharedMiddleware {
  maxBodySize: number
  contextFactory?: HttpOptions['contextFactory']
  codecs?: HttpOptions['codecs']
  trustedProxies?: HttpOptions['trustedProxies']
}

interface PlannedUsdDocsFeature {
  basePath: string
  config: USDDocsConfig
}

interface PlannedSharedJsonRpcFeature {
  path: string
  options: NonNullable<ProtocolConfig['jsonrpc']>['options']
}

interface PlannedSharedGraphQLFeature {
  path: string
  options: NonNullable<ProtocolConfig['graphql']>['options']
}

interface PlannedMcpFeature {
  path: string
  options: McpAdapterOptions
}

export type ServerRuntimeProviderStep = {
  kind: 'providers'
}

export type ServerRuntimeTelemetryStep = {
  kind: 'telemetry'
}

export type ServerRuntimeDiscoveryStep = {
  kind: 'discovery'
}

export type ServerRuntimeStartupPhase =
  | 'providers'
  | 'telemetry'
  | 'discovery'
  | 'http-middleware'
  | 'pre-port-binding'
  | 'entrypoint'
  | 'post-port-binding'

export type ServerRuntimeHttpMiddlewareStep =
  | {
      kind: 'front-door-decision'
    }
  | {
      kind: 'custom'
    }
  | {
      kind: 'docs'
      feature: PlannedUsdDocsFeature
    }
  | {
      kind: 'override'
      feature: PlannedHttpSharedMiddleware
    }
  | {
      kind: 'rest'
      feature: PlannedHttpSharedMiddleware
    }
  | {
      kind: 'jsonrpc'
      feature: PlannedSharedJsonRpcFeature
    }
  | {
      kind: 'graphql'
      feature: PlannedSharedGraphQLFeature
    }
  | {
      kind: 'mcp'
      feature: PlannedMcpFeature
    }

export type ServerRuntimePrePortBindingStep =
  | {
      kind: 'single-port-tcp'
      binding: PlannedTcpBinding & { mode: 'single-port' }
    }
  | {
      kind: 'single-port-grpc'
      binding: PlannedGrpcBinding & { mode: 'single-port' }
    }

export type ServerRuntimeEntrypointStep = {
  kind: 'shared-listener'
  entrypoint: PlannedServerEntrypoint
}

export type ServerRuntimeShutdownPhase =
  | 'post-port-binding'
  | 'entrypoint'
  | 'pre-port-binding'
  | 'http-middleware'
  | 'discovery'
  | 'telemetry'
  | 'providers'

export type ServerRuntimePostPortBindingStep =
  | {
      kind: 'shared-graphql'
      binding: PlannedGraphQLBinding & { mode: 'shared' }
      feature: PlannedSharedGraphQLFeature
    }
  | {
      kind: 'websocket'
      binding: PlannedWebSocketBinding
    }
  | {
      kind: 'jsonrpc'
      binding: PlannedJsonRpcBinding & { mode: 'dedicated' }
    }
  | {
      kind: 'tcp'
      binding: PlannedTcpBinding & { mode: 'dedicated' }
    }
  | {
      kind: 'grpc'
      binding: PlannedGrpcBinding & { mode: 'dedicated' }
    }
  | {
      kind: 'graphql'
      binding: PlannedGraphQLBinding & { mode: 'dedicated' }
    }
  | {
      kind: 'protocol-extension'
      extension: ProtocolExtensionConfig
    }
  | {
      kind: 'tcp-handler'
      handler: LoadedTcpHandler
    }
  | {
      kind: 'udp-handler'
      handler: LoadedUdpHandler
    }

interface ServerRuntimeExecutionPlan {
  providers: ServerRuntimeProviderStep[]
  telemetry: ServerRuntimeTelemetryStep[]
  discovery: ServerRuntimeDiscoveryStep[]
  httpMiddleware: ServerRuntimeHttpMiddlewareStep[]
  prePortBinding: ServerRuntimePrePortBindingStep[]
  entrypoint: ServerRuntimeEntrypointStep[]
  postPortBinding: ServerRuntimePostPortBindingStep[]
  startup: ServerRuntimeStartupPhase[]
  shutdown: ServerRuntimeShutdownPhase[]
}

export interface ServerRuntimePlan {
  previewContext: ServerConfigPreviewContext
  previewConfig: ServerConfigPreview
  protocols: ProtocolConfig
  host: string
  basePath: string
  effectiveHost: string
  effectivePort: number
  frontDoorEnabled: boolean
  frontDoorProtocols: ServerConfigPreviewContext['frontDoorProtocols']
  singlePortConfig: SinglePortConfig
  singlePortSource: ReturnType<ServerConfigPreviewContext['getSinglePortSource']>
  routeModes: {
    tcp: SinglePortRouteMode
    grpc: SinglePortRouteMode
  }
  entrypoint: PlannedServerEntrypoint
  httpSharedFeatures: {
    override: PlannedHttpSharedMiddleware
    rest?: PlannedHttpSharedMiddleware
    docs?: PlannedUsdDocsFeature
    jsonrpc?: PlannedSharedJsonRpcFeature
    graphql?: PlannedSharedGraphQLFeature
    mcp?: PlannedMcpFeature
  }
  execution: ServerRuntimeExecutionPlan
  bindings: {
    http: PlannedHttpBinding
    websocket?: PlannedWebSocketBinding
    jsonrpc?: PlannedJsonRpcBinding
    graphql?: PlannedGraphQLBinding
    tcp?: PlannedTcpBinding
    grpc?: PlannedGrpcBinding
  }
  addresses: ServerAddresses
  describeUdpAddress(input: {
    handler: LoadedUdpHandler
    host: string
    port: number
  }): FrontDoorProtocolAddress
}

export interface CreateServerRuntimePlanBuilderOptions {
  host: string
  basePath: string
  protocols: ProtocolConfig
  previewContext: ServerConfigPreviewContext
  cors: HttpAdapterOptions['cors']
  httpOptions?: HttpOptions
  getUsdDocsConfig?: () => USDDocsConfig | null
  getMcpOptions?: () => McpAdapterOptions | boolean | undefined
  hasRestResources?: () => boolean
  getProtocolExtensionConfigs?: () => ProtocolExtensionConfig[]
  getTcpHandlers?: () => LoadedTcpHandler[]
  getUdpHandlers?: () => LoadedUdpHandler[]
  isSinglePortTcpRouteEnabled: () => boolean
  isSinglePortGrpcRouteEnabled: () => boolean
  isSinglePortUdpRouteEnabled: (handler: LoadedUdpHandler) => boolean
}

export function createServerRuntimePlanBuilder(
  options: CreateServerRuntimePlanBuilderOptions
) {
  const {
    host,
    basePath,
    protocols,
    previewContext,
    cors,
    httpOptions,
    getUsdDocsConfig,
    getMcpOptions,
    hasRestResources,
    getProtocolExtensionConfigs,
    getTcpHandlers,
    getUdpHandlers,
    isSinglePortTcpRouteEnabled,
    isSinglePortGrpcRouteEnabled,
    isSinglePortUdpRouteEnabled,
  } = options

  const resolveDedicatedSource = (frontDoor: boolean | undefined): 'offload' | 'native' => (
    frontDoor ? 'offload' : 'native'
  )

  function buildBindings(routeModes: ServerRuntimePlan['routeModes']): ServerRuntimePlan['bindings'] {
    const bindings: ServerRuntimePlan['bindings'] = {
      http: {
        host: previewContext.effectiveHost,
        port: previewContext.effectivePort,
      },
    }

    if (protocols.websocket?.enabled) {
      bindings.websocket = protocols.websocket.shared
        ? {
            mode: 'shared',
            host: previewContext.effectiveHost,
            port: previewContext.effectivePort,
            path: protocols.websocket.options.path ?? '/',
            options: protocols.websocket.options,
          }
        : {
            mode: 'dedicated',
            host: host,
            port: protocols.websocket.options.port!,
            path: protocols.websocket.options.path ?? '/',
            options: protocols.websocket.options,
          }
    }

    if (protocols.jsonrpc?.enabled) {
      const rpcPath = protocols.jsonrpc.options.path ?? '/rpc'
      bindings.jsonrpc = protocols.jsonrpc.shared
        ? {
            mode: 'shared',
            host: previewContext.effectiveHost,
            port: previewContext.effectivePort,
            path: joinBasePath(basePath, rpcPath),
            options: protocols.jsonrpc.options,
          }
        : {
            mode: 'dedicated',
            host,
            port: protocols.jsonrpc.options.port!,
            path: rpcPath,
            options: protocols.jsonrpc.options,
          }
    }

    if (protocols.graphql?.enabled) {
      const gqlPath = protocols.graphql.options.path ?? '/graphql'
      bindings.graphql = protocols.graphql.shared
        ? {
            mode: 'shared',
            host: previewContext.effectiveHost,
            port: previewContext.effectivePort,
            path: joinBasePath(basePath, gqlPath),
            options: protocols.graphql.options,
          }
        : {
            mode: 'dedicated',
            host,
            port: protocols.graphql.options.port!,
            path: gqlPath,
            options: protocols.graphql.options,
          }
    }

    if (protocols.tcp?.enabled) {
      bindings.tcp = routeModes.tcp === 'single-port'
        ? {
            mode: 'single-port',
            host: previewContext.effectiveHost,
            port: previewContext.effectivePort,
            options: protocols.tcp.options,
          }
        : {
            mode: 'dedicated',
            host: protocols.tcp.options.host || host,
            port: protocols.tcp.options.port,
            options: protocols.tcp.options,
          }
    }

    if (protocols.grpc?.enabled) {
      bindings.grpc = routeModes.grpc === 'single-port'
        ? {
            mode: 'single-port',
            host: previewContext.effectiveHost,
            port: previewContext.effectivePort,
            options: protocols.grpc.options,
          }
        : {
            mode: 'dedicated',
            host: protocols.grpc.options.host || host,
            port: protocols.grpc.options.port,
            options: protocols.grpc.options,
          }
    }

    return bindings
  }

  function buildEntrypoint(
    routeModes: ServerRuntimePlan['routeModes'],
    singlePortConfig: SinglePortConfig
  ): PlannedServerEntrypoint {
    const normalizedCors = cors === true
      ? {
          origin: '*',
          methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
          headers: ['Content-Type', 'Authorization', 'Accept', 'X-Request-Id', 'Traceparent', 'Tracestate'],
        }
      : cors

    return {
      portBinding: {
        host: previewContext.effectiveHost,
        port: previewContext.effectivePort,
        attachTcpHandler: routeModes.tcp === 'single-port',
        attachGrpcHandler: routeModes.grpc === 'single-port',
        ...(singlePortConfig.enabled ? { singlePortConfig } : {}),
      },
      httpAdapter: {
        port: previewContext.effectivePort,
        host: previewContext.effectiveHost,
        basePath,
        maxBodySize: httpOptions?.maxBodySize,
        contextFactory: httpOptions?.contextFactory,
        codecs: httpOptions?.codecs,
        cors: normalizedCors,
        listenOnStart: false,
        tls: httpOptions?.tls,
        trustedProxies: httpOptions?.trustedProxies,
      },
    }
  }

  function buildAddresses(
    singlePortConfig: SinglePortConfig,
    singlePortSource: ReturnType<ServerConfigPreviewContext['getSinglePortSource']>,
    bindings: ServerRuntimePlan['bindings']
  ): ServerAddresses {
    const addresses: ServerAddresses = {
      http: {
        host: bindings.http.host,
        port: bindings.http.port,
        frontDoor: previewContext.frontDoorEnabled,
        strategy: previewContext.frontDoorEnabled ? 'shared' : 'native',
        source: singlePortSource,
      },
    }

    if (bindings.websocket) {
      addresses.websocket = {
        host: bindings.websocket.host,
        port: bindings.websocket.port,
        path: bindings.websocket.path!,
        shared: bindings.websocket.mode === 'shared',
        frontDoor: !!protocols.websocket?.frontDoor,
        strategy: protocols.websocket?.strategy,
        source: bindings.websocket.mode === 'shared'
          ? (singlePortConfig.enabled
              ? 'singlePort'
              : resolveDedicatedSource(protocols.websocket?.frontDoor))
          : resolveDedicatedSource(protocols.websocket?.frontDoor),
      }
    }

    if (bindings.jsonrpc) {
      addresses.jsonrpc = {
        host: bindings.jsonrpc.host,
        port: bindings.jsonrpc.port,
        path: bindings.jsonrpc.path!,
        shared: bindings.jsonrpc.mode === 'shared',
        frontDoor: !!protocols.jsonrpc?.frontDoor,
        strategy: protocols.jsonrpc?.strategy,
        source: bindings.jsonrpc.mode === 'shared'
          ? (singlePortConfig.enabled ? 'singlePort' : 'native')
          : resolveDedicatedSource(protocols.jsonrpc?.frontDoor),
      }
    }

    if (bindings.graphql) {
      addresses.graphql = {
        host: bindings.graphql.host,
        port: bindings.graphql.port,
        path: bindings.graphql.path!,
        shared: bindings.graphql.mode === 'shared',
        frontDoor: !!protocols.graphql?.frontDoor,
        strategy: protocols.graphql?.strategy,
        source: bindings.graphql.mode === 'shared'
          ? (singlePortConfig.enabled ? 'singlePort' : 'native')
          : resolveDedicatedSource(protocols.graphql?.frontDoor),
      }
    }

    if (bindings.tcp) {
      addresses.tcp = {
        host: bindings.tcp.host,
        port: bindings.tcp.port,
        frontDoor: bindings.tcp.mode === 'single-port' ? false : !!protocols.tcp?.frontDoor,
        strategy: bindings.tcp.mode === 'single-port' ? 'native' : protocols.tcp?.strategy,
        source: bindings.tcp.mode === 'single-port'
          ? 'singlePort'
          : resolveDedicatedSource(protocols.tcp?.frontDoor),
      }
    }

    if (bindings.grpc) {
      addresses.grpc = {
        host: bindings.grpc.host,
        port: bindings.grpc.port,
        ...(bindings.grpc.mode === 'single-port' && { shared: true }),
        frontDoor: !!protocols.grpc?.frontDoor,
        strategy: protocols.grpc?.strategy,
        source: bindings.grpc.mode === 'single-port'
          ? 'singlePort'
          : resolveDedicatedSource(protocols.grpc?.frontDoor),
      }
    }

    return addresses
  }

  function buildHttpSharedFeatures(
    bindings: ServerRuntimePlan['bindings']
  ): ServerRuntimePlan['httpSharedFeatures'] {
    const sharedMiddlewareBase: PlannedHttpSharedMiddleware = {
      maxBodySize: httpOptions?.maxBodySize ?? 1024 * 1024,
      contextFactory: httpOptions?.contextFactory,
      codecs: httpOptions?.codecs,
      trustedProxies: httpOptions?.trustedProxies,
    }

    const docsConfig = getUsdDocsConfig?.() ?? null
    const rawMcpOptions = getMcpOptions?.()
    const normalizedMcpOptions = rawMcpOptions && typeof rawMcpOptions === 'object'
      ? rawMcpOptions
      : rawMcpOptions === true
        ? {}
        : undefined

    return {
      override: sharedMiddlewareBase,
      ...(hasRestResources?.() ? { rest: sharedMiddlewareBase } : {}),
      ...(docsConfig
        ? {
            docs: {
              basePath: docsConfig.basePath ?? '/docs',
              config: docsConfig,
            },
          }
        : {}),
      ...(bindings.jsonrpc?.mode === 'shared'
        ? {
            jsonrpc: {
              path: bindings.jsonrpc.path!,
              options: bindings.jsonrpc.options,
            },
          }
        : {}),
      ...(bindings.graphql?.mode === 'shared'
        ? {
            graphql: {
              path: bindings.graphql.path!,
              options: bindings.graphql.options,
            },
          }
        : {}),
      ...(normalizedMcpOptions
        ? {
            mcp: {
              path: normalizedMcpOptions.path ?? '/mcp',
              options: normalizedMcpOptions,
            },
          }
        : {}),
    }
  }

  function buildExecutionPlan(
    entrypoint: PlannedServerEntrypoint,
    bindings: ServerRuntimePlan['bindings'],
    httpSharedFeatures: ServerRuntimePlan['httpSharedFeatures']
  ): ServerRuntimePlan['execution'] {
    const providers: ServerRuntimePlan['execution']['providers'] = [{
      kind: 'providers',
    }]
    const telemetry: ServerRuntimePlan['execution']['telemetry'] = [{
      kind: 'telemetry',
    }]
    const discovery: ServerRuntimePlan['execution']['discovery'] = [{
      kind: 'discovery',
    }]
    const httpMiddleware: ServerRuntimePlan['execution']['httpMiddleware'] = []
    const prePortBinding: ServerRuntimePlan['execution']['prePortBinding'] = []
    const runtimeEntrypoint: ServerRuntimePlan['execution']['entrypoint'] = [{
      kind: 'shared-listener',
      entrypoint,
    }]
    const postPortBinding: ServerRuntimePlan['execution']['postPortBinding'] = []

    if (previewContext.frontDoorEnabled) {
      httpMiddleware.push({
        kind: 'front-door-decision',
      })
    }

    if (httpOptions?.middleware?.length) {
      httpMiddleware.push({
        kind: 'custom',
      })
    }

    if (httpSharedFeatures.docs) {
      httpMiddleware.push({
        kind: 'docs',
        feature: httpSharedFeatures.docs,
      })
    }

    httpMiddleware.push({
      kind: 'override',
      feature: httpSharedFeatures.override,
    })

    if (httpSharedFeatures.rest) {
      httpMiddleware.push({
        kind: 'rest',
        feature: httpSharedFeatures.rest,
      })
    }

    if (httpSharedFeatures.jsonrpc) {
      httpMiddleware.push({
        kind: 'jsonrpc',
        feature: httpSharedFeatures.jsonrpc,
      })
    }

    if (httpSharedFeatures.graphql) {
      httpMiddleware.push({
        kind: 'graphql',
        feature: httpSharedFeatures.graphql,
      })
    }

    if (httpSharedFeatures.mcp) {
      httpMiddleware.push({
        kind: 'mcp',
        feature: httpSharedFeatures.mcp,
      })
    }

    if (bindings.tcp?.mode === 'single-port') {
      prePortBinding.push({
        kind: 'single-port-tcp',
        binding: {
          ...bindings.tcp,
          mode: 'single-port',
        },
      })
    }

    if (bindings.grpc?.mode === 'single-port') {
      prePortBinding.push({
        kind: 'single-port-grpc',
        binding: {
          ...bindings.grpc,
          mode: 'single-port',
        },
      })
    }

    if (bindings.graphql?.mode === 'shared' && httpSharedFeatures.graphql) {
      postPortBinding.push({
        kind: 'shared-graphql',
        binding: {
          ...bindings.graphql,
          mode: 'shared',
        },
        feature: httpSharedFeatures.graphql,
      })
    }

    if (bindings.websocket) {
      postPortBinding.push({
        kind: 'websocket',
        binding: bindings.websocket,
      })
    }

    if (bindings.jsonrpc?.mode === 'dedicated') {
      postPortBinding.push({
        kind: 'jsonrpc',
        binding: {
          ...bindings.jsonrpc,
          mode: 'dedicated',
        },
      })
    }

    if (bindings.tcp?.mode === 'dedicated') {
      postPortBinding.push({
        kind: 'tcp',
        binding: {
          ...bindings.tcp,
          mode: 'dedicated',
        },
      })
    }

    if (bindings.grpc?.mode === 'dedicated') {
      postPortBinding.push({
        kind: 'grpc',
        binding: {
          ...bindings.grpc,
          mode: 'dedicated',
        },
      })
    }

    if (bindings.graphql?.mode === 'dedicated') {
      postPortBinding.push({
        kind: 'graphql',
        binding: {
          ...bindings.graphql,
          mode: 'dedicated',
        },
      })
    }

    for (const extension of getProtocolExtensionConfigs?.() ?? []) {
      postPortBinding.push({
        kind: 'protocol-extension',
        extension,
      })
    }

    for (const handler of getTcpHandlers?.() ?? []) {
      postPortBinding.push({
        kind: 'tcp-handler',
        handler,
      })
    }

    for (const handler of getUdpHandlers?.() ?? []) {
      postPortBinding.push({
        kind: 'udp-handler',
        handler,
      })
    }

    return {
      providers,
      telemetry,
      discovery,
      httpMiddleware,
      prePortBinding,
      entrypoint: runtimeEntrypoint,
      postPortBinding,
      startup: [
        'providers',
        'telemetry',
        'discovery',
        'http-middleware',
        'pre-port-binding',
        'entrypoint',
        'post-port-binding',
      ],
      shutdown: [
        'post-port-binding',
        'entrypoint',
        'pre-port-binding',
        'http-middleware',
        'discovery',
        'telemetry',
        'providers',
      ],
    }
  }

  function materializeSinglePortConfig(
    input: ReturnType<ServerConfigPreviewContext['getSinglePortConfig']>
  ): SinglePortConfig {
    return {
      enabled: input.enabled,
      protocolFusion: input.protocolFusion,
      sniffMaxBytes: input.sniffMaxBytes,
      sniffTimeoutMs: input.sniffTimeoutMs,
      maxConcurrentDetections: input.maxConcurrentDetections,
      alpn: input.alpn ? [...input.alpn] : undefined,
      protocols: input.protocols ? [...input.protocols] : undefined,
      sniffers: input.sniffers
        ? [...(input.sniffers as unknown as NonNullable<SinglePortConfig['sniffers']>)]
        : undefined,
    }
  }

  function build(): ServerRuntimePlan {
    const previewConfig = buildServerConfigPreview(previewContext)
    const singlePortConfig = materializeSinglePortConfig(previewContext.getSinglePortConfig())
    const singlePortSource = previewContext.getSinglePortSource()
    const routeModes: ServerRuntimePlan['routeModes'] = {
      tcp: protocols.tcp?.enabled
        ? (isSinglePortTcpRouteEnabled() ? 'single-port' : 'dedicated')
        : 'disabled',
      grpc: protocols.grpc?.enabled
        ? (isSinglePortGrpcRouteEnabled() ? 'single-port' : 'dedicated')
        : 'disabled',
    }
    const bindings = buildBindings(routeModes)
    const entrypoint = buildEntrypoint(routeModes, singlePortConfig)
    const httpSharedFeatures = buildHttpSharedFeatures(bindings)
    const execution = buildExecutionPlan(entrypoint, bindings, httpSharedFeatures)

    return {
      previewContext,
      previewConfig,
      protocols,
      host,
      basePath,
      effectiveHost: previewContext.effectiveHost,
      effectivePort: previewContext.effectivePort,
      frontDoorEnabled: previewContext.frontDoorEnabled,
      frontDoorProtocols: previewContext.frontDoorProtocols,
      singlePortConfig,
      singlePortSource,
      routeModes,
      entrypoint,
      httpSharedFeatures,
      execution,
      bindings,
      addresses: buildAddresses(singlePortConfig, singlePortSource, bindings),
      describeUdpAddress({ handler, host: udpHost, port: udpPort }) {
        const isUdpOffload = previewContext.frontDoorEnabled
          && !!previewContext.frontDoorProtocols?.includes('udp')
        const isUdpSinglePort = isSinglePortUdpRouteEnabled(handler)

        return {
          host: udpHost,
          port: udpPort,
          frontDoor: isUdpOffload,
          strategy: isUdpOffload ? 'offload' : 'native',
          source: isUdpSinglePort ? 'singlePort' : isUdpOffload ? 'offload' : 'native',
        }
      },
    }
  }

  return { build }
}
