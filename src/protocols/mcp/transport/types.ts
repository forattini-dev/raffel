/**
 * MCP Transport Interface
 *
 * Abstraction over communication channels (stdio, HTTP, SSE).
 * The protocol handler sends/receives JSON-RPC messages through transports.
 */

import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification, McpAuthInfo } from '../types.js'

export type JsonRpcMessage = JsonRpcResponse | JsonRpcNotification

export interface McpMessageExtra {
  /** Authenticated client info (set by transport auth) */
  authInfo?: McpAuthInfo
}

export type McpMessageHandler = (message: JsonRpcRequest, extra?: McpMessageExtra) => Promise<JsonRpcResponse | null>

export interface McpTransport {
  /** Start listening for incoming messages */
  start(handler: McpMessageHandler): Promise<void>

  /** Stop listening and clean up */
  stop(): Promise<void>

  /** Send a message to the client (response or server-initiated notification) */
  send(message: JsonRpcMessage): Promise<void>
}
