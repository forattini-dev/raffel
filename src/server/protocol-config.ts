/**
 * Protocol Configuration Utilities
 *
 * Helper functions for parsing protocol options into config objects.
 */

import type {
  ProtocolConfig,
  FrontDoorConfig,
  FrontDoorTransport,
  FrontDoorStrategy,
  WebSocketOptions,
  JsonRpcOptions,
  TcpOptions,
  GrpcOptions,
  SinglePortConfig,
  ProtocolSniffer,
  SinglePortProtocolKind,
  ProtocolAliasMode,
} from './types.js'
import type { GraphQLOptions } from '../graphql/index.js'
import { getFrontDoorProtocolAliases } from './protocol-aliases.js'

/**
 * Options for building protocol configuration
 */
export interface ProtocolBuildOptions {
  websocket?: boolean | WebSocketOptions
  jsonrpc?: boolean | JsonRpcOptions
  tcp?: TcpOptions
  graphql?: boolean | GraphQLOptions
  grpc?: GrpcOptions
  frontDoor?: FrontDoorConfig
  protocolAliasMode?: ProtocolAliasMode
}

const DEFAULT_SINGLE_PORT_MAX_BYTES = 4096
const DEFAULT_SINGLE_PORT_TIMEOUT_MS = 75
const DEFAULT_SINGLE_PORT_MAX_CONCURRENT_DETECTIONS = 256

export interface SinglePortBuildOptions {
  enabled: boolean
  protocolFusion: boolean
  cert?: string | Buffer
  key?: string | Buffer
  alpn?: string[]
  sniffMaxBytes: number
  sniffTimeoutMs: number
  maxConcurrentDetections: number
  sniffers?: ProtocolSniffer[]
  protocols?: SinglePortProtocolKind[]
}

function normalizeSinglePortProtocol(protocol: string): SinglePortProtocolKind | null {
  const normalized = protocol.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  return normalized as SinglePortProtocolKind
}

export function resolveSinglePortConfig(
  options?: SinglePortConfig
): SinglePortBuildOptions {
  const enabled = options?.enabled ?? options?.protocolFusion ?? false
  const protocolFusion = options?.protocolFusion ?? enabled
  const protocols = options?.protocols?.length
    ? Array.from(
      new Set(
        options.protocols
          .map((protocol) => normalizeSinglePortProtocol(protocol))
          .filter((protocol): protocol is SinglePortProtocolKind => protocol !== null)
      )
    )
    : undefined

  return {
    enabled,
    protocolFusion,
    cert: options?.cert,
    key: options?.key,
    alpn: options?.alpn ?? [],
    sniffMaxBytes: options?.sniffMaxBytes ?? DEFAULT_SINGLE_PORT_MAX_BYTES,
    sniffTimeoutMs: options?.sniffTimeoutMs ?? DEFAULT_SINGLE_PORT_TIMEOUT_MS,
    maxConcurrentDetections: options?.maxConcurrentDetections ?? DEFAULT_SINGLE_PORT_MAX_CONCURRENT_DETECTIONS,
    sniffers: options?.sniffers,
    protocols,
  }
}

export function mergeSinglePortConfigInputs(
  sharedPort?: SinglePortConfig,
  singlePort?: SinglePortConfig
): SinglePortConfig | undefined {
  if (!sharedPort) {
    return singlePort
  }

  return {
    ...(singlePort ?? {}),
    ...sharedPort,
  }
}

const FRONT_DOOR_SUPPORTED_PROTOCOLS = ['http', 'websocket', 'jsonrpc', 'tcp', 'udp', 'grpc', 'graphql'] as const

function normalizeFrontDoorProtocol(
  protocol: string,
  protocolAliasMode: ProtocolAliasMode
): FrontDoorTransport {
  const aliases = getFrontDoorProtocolAliases(protocolAliasMode)
  const normalized = aliases[(protocol.toLowerCase() as keyof typeof aliases)]
    ?? protocol.toLowerCase()

  const supported = FRONT_DOOR_SUPPORTED_PROTOCOLS.includes(
    normalized as (typeof FRONT_DOOR_SUPPORTED_PROTOCOLS)[number]
  )

  if (supported) {
    return normalized as FrontDoorTransport
  }

  return normalized
}

/**
 * Build protocol configuration from options
 */
export function buildProtocolConfig(options: ProtocolBuildOptions): ProtocolConfig {
  const {
    websocket,
    jsonrpc,
    tcp,
    graphql,
    grpc,
    frontDoor,
    protocolAliasMode = 'standard',
  } = options
  const frontDoorEnabled = frontDoor?.enabled === true
  const normalizedFrontDoorProtocolConfigs = frontDoor?.protocols
    ? frontDoor.protocols.map((protocol) => normalizeFrontDoorProtocol(protocol, protocolAliasMode))
    : null

  const selectedFrontDoorProtocols = frontDoor?.protocols && frontDoor.protocols.length > 0
    ? Array.from(new Set(normalizedFrontDoorProtocolConfigs as FrontDoorTransport[]))
    : null

  const shouldUseFrontDoor = (name: string): boolean => {
    if (!frontDoorEnabled) return false
    if (!selectedFrontDoorProtocols) {
      return ['websocket', 'jsonrpc', 'graphql'].includes(name as never)
    }
    return selectedFrontDoorProtocols.includes(name as never)
  }

  const strategyFor = (name: string, fallback: FrontDoorStrategy): FrontDoorStrategy => {
    const strategy = frontDoor?.strategy?.[name as keyof NonNullable<FrontDoorConfig['strategy']>]
    return strategy ?? fallback
  }
  const protocols: ProtocolConfig = {}

  // Process websocket option
  if (websocket) {
    const useFrontDoor = shouldUseFrontDoor('websocket')
    const requestedShared = websocket === true ? true : websocket.port === undefined
    const shared = useFrontDoor || requestedShared
    if (websocket === true) {
      protocols.websocket = {
        enabled: true,
        options: { path: '/' },
        shared: true,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('websocket', 'shared') : strategyFor('websocket', 'native'),
      }
    } else {
      protocols.websocket = {
        enabled: true,
        options: websocket,
        shared,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('websocket', 'shared') : strategyFor('websocket', 'native'),
      }
    }
  }

  // Process jsonrpc option
  if (jsonrpc) {
    const useFrontDoor = shouldUseFrontDoor('jsonrpc')
    const requestedShared = jsonrpc === true ? true : jsonrpc.port === undefined
    const shared = useFrontDoor || requestedShared
    if (jsonrpc === true) {
      protocols.jsonrpc = {
        enabled: true,
        options: { path: '/rpc' },
        shared: true,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('jsonrpc', 'shared') : strategyFor('jsonrpc', 'native'),
      }
    } else {
      protocols.jsonrpc = {
        enabled: true,
        options: jsonrpc,
        shared,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('jsonrpc', 'shared') : strategyFor('jsonrpc', 'native'),
      }
    }
  }

  // Process tcp option
  if (tcp) {
    const useFrontDoor = shouldUseFrontDoor('tcp')
    protocols.tcp = {
      enabled: true,
      options: tcp,
      frontDoor: useFrontDoor,
      strategy: useFrontDoor ? strategyFor('tcp', 'offload') : strategyFor('tcp', 'native'),
    }
  }

  // Process grpc option
  if (grpc) {
    const useFrontDoor = shouldUseFrontDoor('grpc')
    protocols.grpc = {
      enabled: true,
      options: grpc,
      shared: false,
      frontDoor: useFrontDoor,
      strategy: useFrontDoor ? strategyFor('grpc', 'offload') : strategyFor('grpc', 'native'),
    }
  }

  // Process graphql option
  if (graphql) {
    const useFrontDoor = shouldUseFrontDoor('graphql')
    const requestedShared = graphql === true ? true : graphql.port === undefined
    const shared = useFrontDoor || requestedShared
    if (graphql === true) {
      protocols.graphql = {
        enabled: true,
        options: { path: '/graphql' },
        shared: true,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('graphql', 'shared') : strategyFor('graphql', 'native'),
      }
    } else {
      protocols.graphql = {
        enabled: true,
        options: graphql,
        shared,
        frontDoor: useFrontDoor,
        strategy: useFrontDoor ? strategyFor('graphql', 'shared') : strategyFor('graphql', 'native'),
      }
    }
  }

  return protocols
}
