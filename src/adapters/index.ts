/**
 * Adapters — Protocol & Infrastructure Adapters
 *
 * This barrel re-exports from both inbound/ (protocol adapters) and the
 * legacy flat paths for backward compatibility.
 *
 * Canonical import paths:
 * - Inbound (protocol):  'raffel/adapters/inbound'
 * - Outbound (drivers):  'raffel/adapters/outbound'
 *
 * @deprecated Import from 'adapters/inbound' or 'adapters/outbound' for hexagonal clarity.
 */

// === Inbound Adapters (protocol → Envelope) ===

// WebSocket adapter
export { createWebSocketAdapter } from './websocket.js'
export type { WebSocketAdapter, WebSocketAdapterOptions } from './websocket.js'

// HTTP adapter
export { createHttpAdapter } from './http.js'
export type { HttpAdapter, HttpAdapterOptions, HttpMiddleware } from './http.js'

// TCP adapter
export { createTcpAdapter, createTcpClient } from './tcp.js'
export type { TcpAdapter, TcpAdapterOptions } from './tcp.js'

// UDP adapter
export { createUdpAdapter, createUdpClient } from './udp.js'
export type { UdpAdapter, UdpAdapterOptions } from './udp.js'

// JSON-RPC 2.0 adapter
export { createJsonRpcAdapter, JsonRpcErrorCode, HttpMetadataKey } from './jsonrpc.js'
export type {
  JsonRpcAdapter,
  JsonRpcAdapterOptions,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
} from './jsonrpc.js'

// gRPC adapter
export { createGrpcAdapter } from './grpc.js'
export type { GrpcAdapter, GrpcAdapterOptions, GrpcTlsOptions, GrpcMethodInfo } from './grpc.js'

// Connection Filter (TCP, UDP, WebSocket)
export { checkConnectionFilter, checkWebSocketConnectionFilter } from './utils/connection-filter.js'
export type { ConnectionFilter, WebSocketConnectionFilter } from './utils/connection-filter.js'
