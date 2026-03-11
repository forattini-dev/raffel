/**
 * JSON-RPC 2.0 Inbound Adapter
 *
 * Translates JSON-RPC requests into Envelope format for the core Router.
 * @see ../jsonrpc.ts for the implementation.
 */
export { createJsonRpcAdapter, JsonRpcErrorCode, HttpMetadataKey } from '../jsonrpc.js'
export type {
  JsonRpcAdapter,
  JsonRpcAdapterOptions,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
} from '../jsonrpc.js'
