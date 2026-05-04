/**
 * withProtocols() Helpers
 *
 * Per-protocol configuration appliers extracted from server/builder.ts to
 * collapse the cognitive complexity of `withProtocols()` (was 56) by
 * splitting one deeply-branched function into six narrow helpers.
 *
 * Behaviour-preserving extraction.
 */

import type {
  ExtendedProtocolConfig,
  GrpcOptions,
  JsonRpcOptions,
  RaffelServer,
  TcpOptions,
  WebSocketOptions,
} from '../types.js'
import type { GraphQLOptions } from '../../graphql/index.js'

interface AppliersLogger {
  debug(obj: object | string, msg?: string): void
}

function hasOwnFields(value: object): boolean {
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      return true
    }
  }
  return false
}

function isDisabled(value: unknown): boolean {
  if (value === false) return true
  if (typeof value === 'object' && value !== null && 'enabled' in value) {
    return (value as { enabled: boolean }).enabled === false
  }
  return false
}

function applyWebSocket(server: RaffelServer, value: NonNullable<ExtendedProtocolConfig['websocket']>): void {
  if (value === true) {
    server.enableWebSocket('/ws')
    return
  }
  if (typeof value === 'string') {
    server.enableWebSocket(value)
    return
  }
  if (typeof value === 'object' && 'enabled' in value) {
    const { enabled: _enabled, ...rest } = value as { enabled: boolean } & Partial<WebSocketOptions>
    if (hasOwnFields(rest)) {
      server.websocket(rest as WebSocketOptions)
    } else {
      server.enableWebSocket('/ws')
    }
    return
  }
  server.websocket(value as WebSocketOptions)
}

function applyJsonRpc(server: RaffelServer, value: NonNullable<ExtendedProtocolConfig['jsonrpc']>): void {
  if (value === true) {
    server.enableJsonRpc('/rpc')
    return
  }
  if (typeof value === 'string') {
    server.enableJsonRpc(value)
    return
  }
  if (typeof value === 'object' && 'enabled' in value) {
    const { enabled: _enabled, ...rest } = value as { enabled: boolean } & Partial<JsonRpcOptions>
    server.enableJsonRpc(rest.path ?? '/rpc')
    return
  }
  server.jsonrpc(value as JsonRpcOptions)
}

function applyGraphQL(server: RaffelServer, value: NonNullable<ExtendedProtocolConfig['graphql']>): void {
  if (value === true) {
    server.enableGraphQL('/graphql')
    return
  }
  if (typeof value === 'string') {
    server.enableGraphQL(value)
    return
  }
  if (typeof value === 'object' && 'enabled' in value) {
    const { enabled: _enabled, ...rest } = value as { enabled: boolean } & Partial<GraphQLOptions>
    if (hasOwnFields(rest)) {
      server.configureGraphQL(rest as GraphQLOptions)
    } else {
      server.enableGraphQL('/graphql')
    }
    return
  }
  server.configureGraphQL(value as GraphQLOptions)
}

function applyTcp(server: RaffelServer, value: NonNullable<ExtendedProtocolConfig['tcp']>): void {
  if (typeof value === 'object' && 'enabled' in value) {
    const { enabled: _enabled, ...rest } = value as { enabled: boolean } & Partial<TcpOptions>
    if (rest.port !== undefined) {
      server.tcp(rest as TcpOptions)
    }
    return
  }
  server.tcp(value as TcpOptions)
}

function applyGrpc(server: RaffelServer, value: NonNullable<ExtendedProtocolConfig['grpc']>): void {
  if (typeof value === 'object' && 'enabled' in value) {
    const { enabled: _enabled, ...rest } = value as { enabled: boolean } & Partial<GrpcOptions>
    if (rest.port !== undefined && rest.protoPath !== undefined) {
      server.grpc(rest as GrpcOptions)
    }
    return
  }
  server.grpc(value as GrpcOptions)
}

/**
 * Apply an `ExtendedProtocolConfig` to the server. Mirrors the previous
 * inline `withProtocols()` body — six per-protocol slots, each with
 * `isDisabled` short-circuit. Streams and UDP are markers only (no
 * production adapter), recorded via debug log.
 */
export function applyExtendedProtocolConfig(
  server: RaffelServer,
  logger: AppliersLogger,
  config: ExtendedProtocolConfig,
): void {
  if (config.websocket !== undefined && !isDisabled(config.websocket)) {
    applyWebSocket(server, config.websocket)
  }
  if (config.jsonrpc !== undefined && !isDisabled(config.jsonrpc)) {
    applyJsonRpc(server, config.jsonrpc)
  }
  if (config.streams !== undefined && config.streams !== false) {
    logger.debug({ streams: config.streams }, 'Streams protocol enabled')
  }
  if (config.graphql !== undefined && !isDisabled(config.graphql)) {
    applyGraphQL(server, config.graphql)
  }
  if (config.tcp !== undefined && !isDisabled(config.tcp)) {
    applyTcp(server, config.tcp)
  }
  if (config.udp !== undefined && !isDisabled(config.udp)) {
    logger.debug('UDP protocol noted (test-scope only; no production adapter registered)')
  }
  if (config.grpc !== undefined && !isDisabled(config.grpc)) {
    applyGrpc(server, config.grpc)
  }
}
