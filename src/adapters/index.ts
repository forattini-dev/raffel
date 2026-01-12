// WebSocket adapter
export { createWebSocketAdapter } from './websocket.js'
export type { WebSocketAdapter, WebSocketAdapterOptions } from './websocket.js'

// HTTP adapter
export { createHttpAdapter } from './http.js'
export type { HttpAdapter, HttpAdapterOptions, HttpMiddleware } from './http.js'

// TCP adapter
export { createTcpAdapter } from './tcp.js'
export type { TcpAdapter, TcpAdapterOptions } from './tcp.js'

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

// S3DB Resource Adapter
export {
  createS3DBAdapter,
  createS3DBContextInterceptor,
  generateS3DBHttpPaths,
} from './s3db/index.js'
export type {
  S3DBResourceLike,
  S3DBDatabaseLike,
  S3DBRelationDefinition,
  S3DBGuardsConfig,
  S3DBGuardDefinition,
  S3DBAdapterOptions,
  S3DBListInput,
  S3DBGetInput,
  S3DBCreateInput,
  S3DBUpdateInput,
  S3DBDeleteInput,
  S3DBListResponse,
  S3DBSingleResponse,
  S3DBDeleteResponse,
  S3DBOptionsResponse,
  S3DBHeadResponse,
} from './s3db/index.js'
