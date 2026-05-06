/**
 * Adapters — Protocol & Infrastructure Adapters
 */

// === Inbound Adapters (protocol → Envelope) ===

// WebSocket adapter
export { createWebSocketAdapter } from './websocket.js'
export type { WebSocketAdapter, WebSocketAdapterOptions, WebSocketClientInfo } from './websocket.js'

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

// SMTP adapter
export { createSmtpAdapter, createSmtpClient } from './smtp.js'
export type { SmtpAdapter, SmtpAdapterOptions, SmtpContextCapability, SmtpTlsOptions, SmtpAuthVerifier, SmtpRecipientValidator } from './smtp.js'

// Connection Filter (TCP, UDP, WebSocket)
export { checkConnectionFilter, checkWebSocketConnectionFilter } from './utils/connection-filter.js'
export type { ConnectionFilter, WebSocketConnectionFilter } from './utils/connection-filter.js'

// Channel name validation (WebSocket subscribe/publish ingress, issue #106)
export {
  validateChannelName,
  DEFAULT_CHANNEL_NAME_PATTERN,
  DEFAULT_CHANNEL_NAME_MAX_LENGTH,
} from './utils/channel-name.js'
export type {
  ChannelNameValidation,
  ChannelNameValidationOptions,
} from './utils/channel-name.js'

// Cancel Handler (shared TCP/WebSocket)
export { handleCancelMessage, cleanupClientConnections } from './utils/cancel-handler.js'
export type { CancellableClient, SendErrorFn } from './utils/cancel-handler.js'
