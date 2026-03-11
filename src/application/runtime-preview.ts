/**
 * Runtime Preview Service
 *
 * Owns config preview and runtime inspection graph building without depending
 * on the server/bootstrap layer.
 */

import type { Registry } from '../core/registry.js'
import {
  buildRuntimeInspectionGraph,
  type RuntimeInspectionOperationRegistration,
} from '../inspect/index.js'
import type { SchemaRegistry } from '../validation/schema.js'
import {
  buildServerConfigPreview,
  emitConfigWarnings,
  logSinglePortConfig,
  type ProtocolConfig,
  type ServerConfigPreviewContext,
} from './config-preview.js'
import type { LoggerPort } from '../ports/outbound/logger.js'

export interface RuntimePreviewChannelDefinition {
  name: string
  filePath: string
  config: unknown
  authConfig?: unknown
  type?: 'public' | 'private' | 'presence'
  description?: string
  tags?: string[]
}

export interface RuntimePreviewUdpHandlerDefinition {
  name: string
  filePath: string
  config: {
    host: string
    port: number
    type?: 'udp4' | 'udp6'
    multicast?: {
      group: string
      interface?: string
    } | null
  }
}

export interface RuntimePreviewTcpHandlerDefinition {
  name: string
  filePath: string
  config: {
    host: string
    port: number
    framing?: {
      type: 'none' | 'length-prefixed' | 'delimiter'
      lengthBytes?: 1 | 2 | 4
      lengthEncoding?: 'BE' | 'LE'
      delimiter?: Buffer
    } | null
  }
}

export interface RuntimePreviewContext<
  TChannel extends RuntimePreviewChannelDefinition,
  TTcpHandler extends RuntimePreviewTcpHandlerDefinition = RuntimePreviewTcpHandlerDefinition,
  TUdpHandler extends RuntimePreviewUdpHandlerDefinition = RuntimePreviewUdpHandlerDefinition,
> {
  registry: Registry
  schemaRegistry: SchemaRegistry
  basePath: string
  channelRegistry: Map<string, TChannel>
  tcpHandlers: Iterable<TTcpHandler>
  udpHandlers: Iterable<TUdpHandler>
  operationRegistrations: Map<string, RuntimeInspectionOperationRegistration>
  protocols: ProtocolConfig
  serverConfigPreviewContext: ServerConfigPreviewContext
  logger: LoggerPort
}

export function createRuntimePreviewService<
  TChannel extends RuntimePreviewChannelDefinition,
  TTcpHandler extends RuntimePreviewTcpHandlerDefinition = RuntimePreviewTcpHandlerDefinition,
  TUdpHandler extends RuntimePreviewUdpHandlerDefinition = RuntimePreviewUdpHandlerDefinition,
>(
  ctx: RuntimePreviewContext<TChannel, TTcpHandler, TUdpHandler>
) {
  function getPreviewConfig() {
    return buildServerConfigPreview(ctx.serverConfigPreviewContext)
  }

  function getRuntimeInspectionPreview() {
    return buildRuntimeInspectionGraph({
      registry: ctx.registry,
      schemaRegistry: ctx.schemaRegistry,
      config: getPreviewConfig(),
      protocols: ctx.protocols as never,
      basePath: ctx.basePath,
      channels: ctx.channelRegistry.values() as never,
      tcpHandlers: ctx.tcpHandlers as never,
      udpHandlers: ctx.udpHandlers as never,
      operationRegistrations: ctx.operationRegistrations,
    })
  }

  function emitWarnings() {
    emitConfigWarnings(ctx.serverConfigPreviewContext, {
      warn: (message) => ctx.logger.warn(message),
    })
  }

  function logSinglePortConfiguration() {
    logSinglePortConfig(ctx.serverConfigPreviewContext, {
      info: (context, message) => ctx.logger.info(context as Record<string, unknown>, message),
    })
  }

  return {
    getPreviewConfig,
    getRuntimeInspectionPreview,
    emitWarnings,
    logSinglePortConfiguration,
  }
}

export type RuntimePreviewService<
  TChannel extends RuntimePreviewChannelDefinition = RuntimePreviewChannelDefinition,
  TTcpHandler extends RuntimePreviewTcpHandlerDefinition = RuntimePreviewTcpHandlerDefinition,
  TUdpHandler extends RuntimePreviewUdpHandlerDefinition = RuntimePreviewUdpHandlerDefinition,
> = ReturnType<typeof createRuntimePreviewService<TChannel, TTcpHandler, TUdpHandler>>
