/**
 * TCP Custom Handler Types
 *
 * Type definitions for custom TCP handlers with full control.
 */

import type { Socket, Server as NetServer } from 'node:net'
import type { Context } from '../../../types/index.js'

// === TCP Configuration ===

export interface TcpConfig {
  /** Port to listen on */
  port: number | 'shared'

  /** Host to bind to (default: '0.0.0.0') */
  host?: string

  /** Enable keep-alive (default: true) */
  keepAlive?: boolean

  /** Keep-alive initial delay in ms (default: 30000) */
  keepAliveInitialDelay?: number

  /** Connection timeout in ms (default: 0 = no timeout) */
  timeout?: number

  /** Max connections (default: unlimited) */
  maxConnections?: number

  /** Enable TCP_NODELAY (default: true) */
  noDelay?: boolean

  /** Message framing configuration */
  framing?: TcpFramingConfig
}

export interface TcpFramingConfig {
  /**
   * Framing type:
   * - 'none': Raw data, onData receives chunks as-is
   * - 'length-prefixed': Messages prefixed with length header
   * - 'delimiter': Messages separated by delimiter
   */
  type: 'none' | 'length-prefixed' | 'delimiter'

  // Length-prefixed options
  /** Number of bytes for length header (default: 4) */
  lengthBytes?: 1 | 2 | 4

  /** Length encoding (default: 'BE') */
  lengthEncoding?: 'BE' | 'LE'

  /** Max message size in bytes (default: 16MB) */
  maxMessageSize?: number

  // Delimiter options
  /** Delimiter string or buffer */
  delimiter?: string | Buffer
}

// === TCP Context ===

/**
 * Context available in TCP handlers.
 */
export interface TcpContext<TState = unknown> extends Omit<Context, 'deadline' | 'signal'> {
  /** Per-connection state (mutable) */
  state: TState

  /** Socket ID */
  socketId: string

  /** Remote address info */
  remote: {
    address: string
    port: number
    family: string
  }

  /** Server reference */
  server: TcpServerRef

  /** Send data to this socket */
  send(data: Buffer | string): void

  /** Close this connection */
  close(): void
}

export interface TcpServerRef {
  /** All connected sockets */
  readonly connections: Map<string, Socket>

  /** Broadcast to all connections */
  broadcast(data: Buffer | string, except?: string): void

  /** Get connection by ID */
  getConnection(socketId: string): Socket | undefined

  /** Disconnect a socket */
  disconnect(socketId: string): void

  /** Server address info */
  readonly address: { host: string; port: number } | null
}

// === TCP Handler Exports ===

/**
 * TCP handler file exports.
 *
 * @example
 * ```typescript
 * // src/tcp/game-server.ts
 * import type { Socket } from 'node:net'
 * import type { TcpContext } from 'raffel'
 *
 * export const config = {
 *   port: 9000,
 *   framing: { type: 'length-prefixed', lengthBytes: 4 },
 * }
 *
 * interface GameState {
 *   playerId?: string
 *   authenticated: boolean
 * }
 *
 * export function onConnect(socket: Socket, ctx: TcpContext<GameState>) {
 *   ctx.state = { authenticated: false }
 *   ctx.send(Buffer.from('WELCOME'))
 * }
 *
 * export function onMessage(data: Buffer, socket: Socket, ctx: TcpContext<GameState>) {
 *   // Handle framed message
 * }
 *
 * export function onClose(socket: Socket, ctx: TcpContext<GameState>) {
 *   console.log('Client disconnected')
 * }
 * ```
 */
export interface TcpHandlerExports<TState = unknown> {
  /** TCP server configuration */
  config?: TcpConfig

  /**
   * Called when a client connects.
   * Initialize connection state here.
   */
  onConnect?: TcpConnectHandler<TState>

  /**
   * Called when raw data is received (framing: 'none').
   * Receives chunks as they arrive from the socket.
   */
  onData?: TcpDataHandler<TState>

  /**
   * Called when a complete message is received (framing: 'length-prefixed' | 'delimiter').
   * Only called when framing is enabled.
   */
  onMessage?: TcpMessageHandler<TState>

  /**
   * Called when connection closes.
   * Cleanup connection state here.
   */
  onClose?: TcpCloseHandler<TState>

  /**
   * Called on socket error.
   */
  onError?: TcpErrorHandler<TState>

  /**
   * Called when connection times out.
   */
  onTimeout?: TcpTimeoutHandler<TState>

  /**
   * Called when socket drain event fires (write buffer empty).
   * Useful for backpressure handling.
   */
  onDrain?: TcpDrainHandler<TState>
}

// === Handler Types ===

export type TcpConnectHandler<TState = unknown> = (
  socket: Socket,
  ctx: TcpContext<TState>
) => void | Promise<void>

export type TcpDataHandler<TState = unknown> = (
  data: Buffer,
  socket: Socket,
  ctx: TcpContext<TState>
) => void | Promise<void>

export type TcpMessageHandler<TState = unknown> = (
  message: Buffer,
  socket: Socket,
  ctx: TcpContext<TState>
) => void | Promise<void>

export type TcpCloseHandler<TState = unknown> = (
  hadError: boolean,
  socket: Socket,
  ctx: TcpContext<TState>
) => void | Promise<void>

export type TcpErrorHandler<TState = unknown> = (
  error: Error,
  socket: Socket,
  ctx: TcpContext<TState>
) => void | Promise<void>

export type TcpTimeoutHandler<TState = unknown> = (
  socket: Socket,
  ctx: TcpContext<TState>
) => void | Promise<void>

export type TcpDrainHandler<TState = unknown> = (
  socket: Socket,
  ctx: TcpContext<TState>
) => void | Promise<void>

// === Loaded TCP Handler ===

export interface LoadedTcpHandler {
  /** Handler name (from filename) */
  name: string

  /** File path */
  filePath: string

  /** Resolved configuration */
  config: ResolvedTcpConfig

  /** Handler exports */
  handlers: TcpHandlerExports
}

export interface ResolvedTcpConfig extends Omit<Required<Omit<TcpConfig, 'framing'>>, 'port'> {
  /** Port (always a number, 'shared' becomes 0) */
  port: number
  framing: ResolvedTcpFramingConfig | null
}

export interface ResolvedTcpFramingConfig {
  type: 'length-prefixed' | 'delimiter'
  lengthBytes: 1 | 2 | 4
  lengthEncoding: 'BE' | 'LE'
  maxMessageSize: number
  delimiter?: Buffer
}

// === TCP Loader Options ===

export interface TcpLoaderOptions {
  /** Base directory */
  baseDir: string

  /** TCP directory path */
  tcpDir: string

  /** File extensions to load */
  extensions?: string[]

  /** Default port if not specified in handler */
  defaultPort?: number
}

export interface TcpLoaderResult {
  handlers: LoadedTcpHandler[]
  stats: {
    handlers: number
    duration: number
  }
}

// === TCP Server Manager ===

export interface TcpServerInstance {
  /** Handler name */
  name: string

  /** Net server instance */
  server: NetServer

  /** Port */
  port: number

  /** Host */
  host: string

  /** Connected sockets */
  connections: Map<string, Socket>

  /** Connection states */
  states: Map<string, unknown>

  /** Start the server */
  start(): Promise<void>

  /** Stop the server */
  stop(): Promise<void>

  /** Broadcast to all connections */
  broadcast(data: Buffer | string, except?: string): void
}
