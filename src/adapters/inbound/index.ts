/**
 * Inbound Adapters
 *
 * Protocol adapters that translate external protocol messages
 * into the core Envelope format. In hexagonal architecture terms,
 * these are the "driving" adapters (primary/inbound).
 */

// HTTP
export { createHttpAdapter } from './http.js'
export type { HttpAdapter, HttpAdapterOptions, HttpMiddleware } from './http.js'

// WebSocket
export { createWebSocketAdapter } from './websocket.js'
export type { WebSocketAdapter, WebSocketAdapterOptions } from './websocket.js'

// gRPC
export { createGrpcAdapter } from './grpc.js'
export type { GrpcAdapter, GrpcAdapterOptions, GrpcTlsOptions, GrpcMethodInfo } from './grpc.js'

// TCP
export { createTcpAdapter, createTcpClient } from './tcp.js'
export type { TcpAdapter, TcpAdapterOptions } from './tcp.js'

// UDP
export { createUdpAdapter, createUdpClient } from './udp.js'
export type { UdpAdapter, UdpAdapterOptions } from './udp.js'

// JSON-RPC 2.0
export { createJsonRpcAdapter, JsonRpcErrorCode, HttpMetadataKey } from './jsonrpc.js'
export type {
  JsonRpcAdapter,
  JsonRpcAdapterOptions,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
} from './jsonrpc.js'

// Connection Filter
export { checkConnectionFilter, checkWebSocketConnectionFilter } from './utils/connection-filter.js'
export type { ConnectionFilter, WebSocketConnectionFilter } from './utils/connection-filter.js'
