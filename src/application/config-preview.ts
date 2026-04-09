import type {
  SharedPortPreviewConfig,
  FrontDoorTransport,
  SinglePortProtocolKind,
  ProtocolFusionMode,
  ProtocolAliasMode,
} from '../server/types.js'

export type { FrontDoorTransport, SinglePortProtocolKind, ProtocolFusionMode, ProtocolAliasMode }

export type FrontDoorStrategy = 'shared' | 'native' | 'offload'
export type ProtocolPreviewSource = 'singlePort' | 'offload' | 'native' | 'custom' | 'unknown'

export interface ProtocolPreviewConfig {
  enabled: boolean
  shared?: boolean
  frontDoor?: boolean
  strategy?: FrontDoorStrategy
  path?: string
  host?: string
  port?: number
  source?: ProtocolPreviewSource
}

export interface ServerConfigPreview {
  entrypoint: {
    host: string
    port: number
    source: 'frontDoor' | 'native'
  }
  protocolFusion: {
    enabled: boolean
    mode: ProtocolFusionMode
    entrypoint: 'http' | 'tcp'
  }
  frontDoor: {
    enabled: boolean
    host: string
    port: number
    protocols: FrontDoorTransport[] | null
    protocolAliasMode: ProtocolAliasMode
  }
  sharedPort: SharedPortPreviewConfig
  singlePort: SharedPortPreviewConfig
  protocols: {
    http: {
      enabled: true
      shared: true
      source: ProtocolPreviewSource
    }
    websocket?: ProtocolPreviewConfig
    jsonrpc?: ProtocolPreviewConfig
    graphql?: ProtocolPreviewConfig
    tcp?: ProtocolPreviewConfig
    grpc?: ProtocolPreviewConfig
    streams: {
      enabled: boolean
    }
  }
  warnings: string[]
}

interface ConfigSourceLogger {
  info: (context: unknown, message: string) => void
  warn: (message: string) => void
}

interface ProtocolEndpointOptions {
  path?: string
  host?: string
  port?: number
}

export interface ProtocolConfig {
  websocket?: {
    enabled: boolean
    options: ProtocolEndpointOptions
    shared: boolean
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
  jsonrpc?: {
    enabled: boolean
    options: ProtocolEndpointOptions
    shared: boolean
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
  graphql?: {
    enabled: boolean
    options: ProtocolEndpointOptions
    shared: boolean
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
  tcp?: {
    enabled: boolean
    options: ProtocolEndpointOptions
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
  grpc?: {
    enabled: boolean
    options: ProtocolEndpointOptions
    shared?: boolean
    frontDoor?: boolean
    strategy?: FrontDoorStrategy
  }
}

interface SinglePortConfigLike {
  enabled: boolean
  protocolFusion: boolean
  sniffTimeoutMs: number
  sniffMaxBytes: number
  maxConcurrentDetections: number
  sniffers?: readonly { name: string }[]
  protocols?: readonly string[]
  alpn?: string[]
}

type SourceType = ProtocolPreviewSource

export interface ServerConfigPreviewContext {
  effectiveHost: string
  effectivePort: number
  frontDoorEnabled: boolean
  frontDoorHost: string
  frontDoorPort: number
  frontDoorProtocols: FrontDoorTransport[] | null
  protocolAliasMode: ProtocolAliasMode
  getSinglePortConfig: () => SinglePortConfigLike
  getSinglePortAliasMode: () => ProtocolAliasMode
  getSinglePortSource: () => SourceType
  getProviderCount?: () => number
  getHttpExposure?: () => {
    corsWildcard: boolean
    trustedProxies: false | string[]
  }
  protocols: ProtocolConfig
}

export function resolveProtocolFusionMode(
  frontDoorEnabled: boolean,
  sharedPortEnabled: boolean
): ProtocolFusionMode {
  if (frontDoorEnabled && sharedPortEnabled) {
    return 'front-door+shared-port'
  }
  if (sharedPortEnabled) {
    return 'shared-port'
  }
  if (frontDoorEnabled) {
    return 'front-door'
  }
  return 'disabled'
}

export function logSinglePortConfig(
  context: Pick<ServerConfigPreviewContext, 'getSinglePortConfig'>,
  logger: Pick<ConfigSourceLogger, 'info'>
): void {
  const singlePortConfig = context.getSinglePortConfig()
  if (!singlePortConfig.enabled) return

  logger.info(
    {
      enabled: singlePortConfig.enabled,
      protocolFusion: singlePortConfig.protocolFusion,
      sniffTimeoutMs: singlePortConfig.sniffTimeoutMs,
      sniffMaxBytes: singlePortConfig.sniffMaxBytes,
      maxConcurrentDetections: singlePortConfig.maxConcurrentDetections,
      sniffers: singlePortConfig.sniffers?.map((sniffer) => sniffer.name),
      protocols: singlePortConfig.protocols,
      alpn: singlePortConfig.alpn,
    },
    'Single-port transport fusion configured'
  )
}

export function getConfigWarnings(context: ServerConfigPreviewContext): string[] {
  const singlePortConfig = context.getSinglePortConfig()
  const warnings: string[] = []
  const providerCount = context.getProviderCount?.() ?? 0
  const httpExposure = context.getHttpExposure?.()

  if (
    context.protocols.tcp?.enabled
    && context.protocols.tcp.options.port === context.effectivePort
    && !singlePortConfig.enabled
  ) {
    warnings.push(
      'TCP is configured with the entrypoint HTTP port. Enable single-port transport to avoid bind conflicts.'
    )
  }

  if (
    context.protocols.grpc?.enabled
    && context.protocols.grpc.options.port === context.effectivePort
    && !singlePortConfig.enabled
  ) {
    warnings.push(
      'gRPC is configured with the entrypoint HTTP port. Enable single-port transport to avoid bind conflicts.'
    )
  }

  if (providerCount > 0) {
    warnings.push(
      'Startup providers are still mirrored onto top-level context keys for compatibility. Prefer ctx.services in new handlers.'
    )
  }

  if (context.frontDoorEnabled && httpExposure?.trustedProxies === false) {
    warnings.push(
      'Front-door routing is enabled without http.trustedProxies. Forwarded client IP headers will be ignored until trusted proxies are configured.'
    )
  }

  if (context.frontDoorEnabled && httpExposure?.corsWildcard) {
    warnings.push(
      'Front-door routing is enabled with wildcard CORS. Prefer explicit origins before public exposure.'
    )
  }

  return warnings
}

export function emitConfigWarnings(
  context: ServerConfigPreviewContext,
  logger: Pick<ConfigSourceLogger, 'warn'>
): void {
  for (const warning of getConfigWarnings(context)) {
    logger.warn(warning)
  }
}

export function buildServerConfigPreview(context: ServerConfigPreviewContext): ServerConfigPreview {
  const warnings = getConfigWarnings(context)
  const singlePortConfig = context.getSinglePortConfig()
  const sharedPortPreview: SharedPortPreviewConfig = {
    enabled: singlePortConfig.enabled,
    protocolFusion: singlePortConfig.protocolFusion,
    protocolAliasMode: context.getSinglePortAliasMode(),
    sniffMaxBytes: singlePortConfig.sniffMaxBytes,
    sniffTimeoutMs: singlePortConfig.sniffTimeoutMs,
    maxConcurrentDetections: singlePortConfig.maxConcurrentDetections,
    sniffers: singlePortConfig.sniffers?.map((sniffer) => sniffer.name),
    protocols: singlePortConfig.protocols as SinglePortProtocolKind[] | undefined,
  }
  const protocolFusionMode = resolveProtocolFusionMode(
    context.frontDoorEnabled,
    singlePortConfig.enabled
  )

  function buildProtocolPreviewEntry(
    protocolName: 'websocket' | 'jsonrpc' | 'graphql' | 'tcp' | 'grpc',
    protocolConfig: {
      enabled?: boolean
      options?: ProtocolEndpointOptions
      shared?: boolean
      frontDoor?: boolean
      strategy?: FrontDoorStrategy
    } | undefined
  ): ProtocolPreviewConfig | undefined {
    if (!protocolConfig?.enabled) {
      return undefined
    }

    const shared = protocolName === 'grpc'
      ? (
          protocolConfig.shared === true
          || (singlePortConfig.enabled && protocolConfig.options?.port === context.effectivePort)
        )
      : (protocolConfig.shared ?? false)
    const host = shared ? context.effectiveHost : protocolConfig.options?.host
    const port = protocolConfig.options?.port ?? (shared ? context.effectivePort : undefined)
    const source: SourceType = shared
      ? (context.getSinglePortSource() ?? 'unknown')
      : (protocolConfig.frontDoor ? 'offload' : 'native')

    return {
      enabled: true,
      shared,
      frontDoor: protocolConfig.frontDoor,
      strategy: protocolConfig.strategy,
      path: protocolConfig.options?.path,
      host,
      port,
      source,
    }
  }

  return {
    entrypoint: {
      host: context.effectiveHost,
      port: context.effectivePort,
      source: context.frontDoorEnabled ? 'frontDoor' : 'native',
    },
    protocolFusion: {
      enabled: protocolFusionMode !== 'disabled',
      mode: protocolFusionMode,
      entrypoint: singlePortConfig.enabled ? 'tcp' : 'http',
    },
    frontDoor: {
      enabled: context.frontDoorEnabled,
      host: context.frontDoorHost,
      port: context.frontDoorPort,
      protocols: context.frontDoorProtocols,
      protocolAliasMode: context.protocolAliasMode,
    },
    sharedPort: sharedPortPreview,
    singlePort: sharedPortPreview,
    protocols: {
      http: {
        enabled: true,
        shared: true,
        source: context.getSinglePortSource() ?? 'unknown',
      },
      websocket: buildProtocolPreviewEntry('websocket', context.protocols.websocket),
      jsonrpc: buildProtocolPreviewEntry('jsonrpc', context.protocols.jsonrpc),
      graphql: buildProtocolPreviewEntry('graphql', context.protocols.graphql),
      tcp: buildProtocolPreviewEntry('tcp', context.protocols.tcp),
      grpc: buildProtocolPreviewEntry('grpc', context.protocols.grpc),
      streams: { enabled: false },
    },
    warnings,
  }
}
