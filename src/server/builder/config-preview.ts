import type { FrontDoorTransport, ProtocolConfig, ProtocolPreviewConfig, ProtocolAliasMode, ServerConfigPreview } from '../types.js'

interface ConfigSourceLogger {
  info: (context: unknown, message: string) => void
  warn: (message: string) => void
}

interface SinglePortConfigLike {
  enabled: boolean
  protocolFusion: boolean
  sniffTimeoutMs: number
  sniffMaxBytes: number
  maxConcurrentDetections: number
  protocols?: readonly string[]
  alpn?: string[]
}

type SourceType = ProtocolPreviewConfig['source']

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
  protocols: ProtocolConfig
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
      protocols: singlePortConfig.protocols,
      alpn: singlePortConfig.alpn,
    },
    'Single-port transport fusion configured'
  )
}

export function getConfigWarnings(context: ServerConfigPreviewContext): string[] {
  const singlePortConfig = context.getSinglePortConfig()
  const warnings: string[] = []

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

  function buildProtocolPreviewEntry(
    protocolConfig: {
      enabled?: boolean
      options?: {
        path?: string
        host?: string
        port?: number
      }
      shared?: boolean
      frontDoor?: boolean
      strategy?: import('../types.js').FrontDoorStrategy
    } | undefined
  ): ProtocolPreviewConfig | undefined {
    if (!protocolConfig?.enabled) {
      return undefined
    }

    const shared = protocolConfig.shared ?? false
    const host = shared ? context.effectiveHost : protocolConfig.options?.host
    const port = protocolConfig.options?.port ?? (shared ? context.effectivePort : undefined)
    const source: SourceType = shared ? (context.getSinglePortSource() ?? 'unknown') : (protocolConfig.frontDoor ? 'offload' : 'native')

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
    frontDoor: {
      enabled: context.frontDoorEnabled,
      host: context.frontDoorHost,
      port: context.frontDoorPort,
      protocols: context.frontDoorProtocols,
      protocolAliasMode: context.protocolAliasMode,
    },
    singlePort: {
      enabled: singlePortConfig.enabled,
      protocolFusion: singlePortConfig.protocolFusion,
      protocolAliasMode: context.getSinglePortAliasMode(),
      sniffMaxBytes: singlePortConfig.sniffMaxBytes,
      sniffTimeoutMs: singlePortConfig.sniffTimeoutMs,
      maxConcurrentDetections: singlePortConfig.maxConcurrentDetections,
      protocols: singlePortConfig.protocols as import('../types.js').SinglePortProtocolKind[] | undefined,
    },
    protocols: {
      http: {
        enabled: true,
        shared: true,
        source: context.getSinglePortSource() ?? 'unknown',
      },
      websocket: buildProtocolPreviewEntry(context.protocols.websocket),
      jsonrpc: buildProtocolPreviewEntry(context.protocols.jsonrpc),
      graphql: buildProtocolPreviewEntry(context.protocols.graphql),
      tcp: buildProtocolPreviewEntry(context.protocols.tcp),
      grpc: buildProtocolPreviewEntry(context.protocols.grpc),
      streams: { enabled: false },
    },
    warnings,
  }
}
