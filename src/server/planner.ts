import type { LoadedUdpHandler } from './fs-routes/index.js'
import { normalizeFrontDoorProtocol } from './front-door.js'
import {
  resolveProtocolFusionMode,
} from './protocol-fusion-diagnostics.js'
import {
  buildProtocolConfig,
  mergeSinglePortConfigInputs,
  resolveSinglePortConfig,
  type SinglePortBuildOptions,
} from './protocol-config.js'
import type {
  CorsOptions,
  FrontDoorConfig,
  FrontDoorStrategy,
  FrontDoorTransport,
  GrpcOptions,
  HttpOptions,
  JsonRpcOptions,
  ProtocolAliasMode,
  ProtocolConfig,
  SinglePortConfig,
  WebSocketOptions,
  TcpOptions,
} from './types.js'
import type { GraphQLOptions } from '../graphql/index.js'
import type { ServerConfigPreviewContext } from './orchestration/config-preview.js'
import {
  isSinglePortTcpRouteEnabled as detectSinglePortTcpRouteEnabled,
  isSinglePortGrpcRouteEnabled as detectSinglePortGrpcRouteEnabled,
  isSinglePortUdpRouteEnabled as detectSinglePortUdpRouteEnabled,
} from './builder/single-port-utils.js'

type SharedPortSource = 'singlePort' | 'offload' | 'native' | 'custom' | 'unknown'

type FrontDoorAwareProtocol = 'websocket' | 'jsonrpc' | 'tcp' | 'grpc' | 'graphql'

export interface CreateServerPlannerOptions {
  port: number
  host: string
  cors: CorsOptions | boolean
  httpOptions?: HttpOptions
  frontDoor?: FrontDoorConfig
  sharedPort?: SinglePortConfig
  singlePort?: SinglePortConfig
  websocket?: boolean | WebSocketOptions
  jsonrpc?: boolean | JsonRpcOptions
  tcp?: TcpOptions
  grpc?: GrpcOptions
  graphql?: boolean | GraphQLOptions
  serverProtocolAliasMode?: ProtocolAliasMode
}

export interface ServerPlanner {
  readonly protocols: ProtocolConfig
  readonly frontDoorEnabled: boolean
  readonly frontDoorHost: string
  readonly frontDoorPort: number
  readonly frontDoorProtocols: FrontDoorTransport[] | null
  readonly frontDoorAliasMode: ProtocolAliasMode
  readonly effectiveHost: string
  readonly effectivePort: number
  readonly singlePortConfig: SinglePortBuildOptions
  updateSinglePortConfig(next: boolean | SinglePortConfig | undefined): void
  shouldUseFrontDoor(name: FrontDoorAwareProtocol): boolean
  strategyFor(name: FrontDoorAwareProtocol, fallback: FrontDoorStrategy): FrontDoorStrategy
  getSinglePortAliasMode(): ProtocolAliasMode
  getSinglePortSource(): SharedPortSource
  resolveProtocolFusionMode(): ReturnType<typeof resolveProtocolFusionMode>
  isSinglePortTcpRouteEnabled(): boolean
  isSinglePortGrpcRouteEnabled(): boolean
  isSinglePortUdpRouteEnabled(handler: LoadedUdpHandler): boolean
  createPreviewContext(options: {
    getProviderCount?: () => number
  }): ServerConfigPreviewContext
}

export function createServerPlanner(options: CreateServerPlannerOptions): ServerPlanner {
  const {
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
    serverProtocolAliasMode = 'standard',
  } = options

  const frontDoorEnabled = frontDoor?.enabled === true
  const frontDoorHost = frontDoor?.host ?? host
  const frontDoorPort = frontDoor?.port ?? port
  let singlePortConfigInput: SinglePortConfig | undefined = mergeSinglePortConfigInputs(
    sharedPort,
    singlePort
  )
  let resolvedSinglePortConfig = resolveSinglePortConfig(singlePortConfigInput)
  const frontDoorAliasMode = frontDoor?.protocolAliasMode ?? serverProtocolAliasMode
  const frontDoorProtocols = frontDoor?.protocols && frontDoor.protocols.length > 0
    ? Array.from(
      new Set(
        frontDoor.protocols
          .map((protocol) => normalizeFrontDoorProtocol(protocol, frontDoorAliasMode))
          .filter(Boolean)
      )
    ) as FrontDoorTransport[]
    : null

  const protocols = buildProtocolConfig({
    websocket,
    jsonrpc,
    tcp,
    graphql,
    grpc,
    frontDoor,
    protocolAliasMode: frontDoorAliasMode,
  })

  const getEffectiveHost = (): string => frontDoorEnabled ? frontDoorHost : host
  const getEffectivePort = (): number => frontDoorEnabled ? frontDoorPort : port

  const getSinglePortAliasMode = (): ProtocolAliasMode => {
    return singlePortConfigInput?.protocolAliasMode ?? serverProtocolAliasMode
  }

  const getSinglePortSource = (): SharedPortSource => {
    return resolvedSinglePortConfig.enabled ? 'singlePort' : 'native'
  }

  const shouldUseFrontDoor = (name: FrontDoorAwareProtocol): boolean => {
    if (!frontDoorEnabled) return false
    if (!frontDoorProtocols) {
      return ['websocket', 'jsonrpc', 'graphql'].includes(name)
    }
    return frontDoorProtocols.includes(name)
  }

  const strategyFor = (
    name: FrontDoorAwareProtocol,
    fallback: FrontDoorStrategy
  ): FrontDoorStrategy => {
    const strategy = frontDoor?.strategy?.[name]
    return strategy ?? fallback
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

    resolvedSinglePortConfig = resolveSinglePortConfig(singlePortConfigInput)
  }

  return {
    get protocols() {
      return protocols
    },
    get frontDoorEnabled() {
      return frontDoorEnabled
    },
    get frontDoorHost() {
      return frontDoorHost
    },
    get frontDoorPort() {
      return frontDoorPort
    },
    get frontDoorProtocols() {
      return frontDoorProtocols
    },
    get frontDoorAliasMode() {
      return frontDoorAliasMode
    },
    get effectiveHost() {
      return getEffectiveHost()
    },
    get effectivePort() {
      return getEffectivePort()
    },
    get singlePortConfig() {
      return resolvedSinglePortConfig
    },
    updateSinglePortConfig,
    shouldUseFrontDoor,
    strategyFor,
    getSinglePortAliasMode,
    getSinglePortSource,
    resolveProtocolFusionMode() {
      return resolveProtocolFusionMode(frontDoorEnabled, resolvedSinglePortConfig.enabled)
    },
    isSinglePortTcpRouteEnabled() {
      return detectSinglePortTcpRouteEnabled(
        resolvedSinglePortConfig.enabled,
        protocols.tcp?.enabled ?? false,
        protocols.tcp?.options.port,
        protocols.tcp?.options.host,
        getEffectiveHost(),
        getEffectivePort()
      )
    },
    isSinglePortGrpcRouteEnabled() {
      return detectSinglePortGrpcRouteEnabled(
        resolvedSinglePortConfig.enabled,
        protocols.grpc?.enabled ?? false,
        protocols.grpc?.options.port,
        protocols.grpc?.options.host,
        getEffectiveHost(),
        getEffectivePort()
      )
    },
    isSinglePortUdpRouteEnabled(handler: LoadedUdpHandler) {
      return detectSinglePortUdpRouteEnabled(
        resolvedSinglePortConfig.enabled,
        handler.config.port,
        handler.config.host,
        getEffectiveHost(),
        getEffectivePort()
      )
    },
    createPreviewContext({ getProviderCount } = {}) {
      return {
        effectiveHost: getEffectiveHost(),
        effectivePort: getEffectivePort(),
        frontDoorEnabled,
        frontDoorHost,
        frontDoorPort,
        frontDoorProtocols,
        protocolAliasMode: frontDoorAliasMode,
        getSinglePortConfig: () => ({
          enabled: resolvedSinglePortConfig.enabled,
          protocolFusion: resolvedSinglePortConfig.protocolFusion,
          sniffTimeoutMs: resolvedSinglePortConfig.sniffTimeoutMs,
          sniffMaxBytes: resolvedSinglePortConfig.sniffMaxBytes,
          maxConcurrentDetections: resolvedSinglePortConfig.maxConcurrentDetections,
          sniffers: resolvedSinglePortConfig.sniffers,
          protocols: resolvedSinglePortConfig.protocols,
          alpn: resolvedSinglePortConfig.alpn,
        }),
        getSinglePortAliasMode,
        getSinglePortSource,
        getProviderCount,
        getHttpExposure: () => ({
          corsWildcard: cors === true
            || (typeof cors === 'object' && cors !== null && cors.origin === '*'),
          trustedProxies: httpOptions?.trustedProxies ?? false,
        }),
        protocols,
      }
    },
  }
}
