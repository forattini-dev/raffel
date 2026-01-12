/**
 * Protocol Configuration Utilities
 *
 * Helper functions for parsing protocol options into config objects.
 */

import type {
  ProtocolConfig,
  WebSocketOptions,
  JsonRpcOptions,
  TcpOptions,
  GrpcOptions,
} from './types.js'
import type { GraphQLOptions } from '../graphql/index.js'

/**
 * Options for building protocol configuration
 */
export interface ProtocolBuildOptions {
  websocket?: boolean | WebSocketOptions
  jsonrpc?: boolean | JsonRpcOptions
  tcp?: TcpOptions
  graphql?: boolean | GraphQLOptions
  grpc?: GrpcOptions
}

/**
 * Build protocol configuration from options
 */
export function buildProtocolConfig(options: ProtocolBuildOptions): ProtocolConfig {
  const { websocket, jsonrpc, tcp, graphql, grpc } = options
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

  // Process grpc option
  if (grpc) {
    protocols.grpc = { enabled: true, options: grpc }
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

  return protocols
}
