import type { IncomingMessage, Server } from 'node:http'
import type { WebSocket } from 'ws'
import type { ContextSeed, Interceptor } from '../types/index.js'
import type {
  BackpressureConfig,
  ChannelManager,
  ChannelOptions,
  WebSocketAuthConfig,
} from '../channels/index.js'

/**
 * WebSocket adapter configuration
 */
export interface WebSocketAdapterOptions {
  /** Port to listen on (required if no server is provided) */
  port?: number

  /** Existing HTTP server to attach to */
  server?: Server

  /** Host to bind to (default: '0.0.0.0') */
  host?: string

  /** Path for WebSocket endpoint (default: '/') */
  path?: string

  /** Maximum message size in bytes (default: 1MB) */
  maxPayloadSize?: number

  /** Heartbeat interval in ms (default: 30000, 0 to disable) */
  heartbeatInterval?: number

  /** Context factory for creating request context */
  contextFactory?: (ws: WebSocket, req: IncomingMessage) => ContextSeed | Promise<ContextSeed>

  /** Interceptors applied only to Raffel envelopes arriving over WebSocket */
  interceptors?: Interceptor[]

  /**
   * Channel configuration for Pusher-like real-time channels.
   *
   * When enabled, clients can send subscribe/unsubscribe/publish messages
   * to join channels and broadcast events.
   */
  channels?: ChannelOptions

  /** Inbound connection filter — controls which source IPs/origins may connect */
  filter?: import('./utils/connection-filter.js').WebSocketConnectionFilter

  /** WebSocket authentication (ticket, bearer, or custom) */
  auth?: WebSocketAuthConfig

  /** Backpressure handling for slow consumers */
  backpressure?: BackpressureConfig

  /** Enable per-message compression (default: false) */
  compression?: boolean | {
    /** Minimum payload size in bytes to compress (default: 1024) */
    threshold?: number
    /** zlib compression level 1-9 (default: 1) */
    level?: number
  }

  /** Connection state recovery (requires channels to be enabled) */
  recovery?: {
    /** Enable connection recovery (default: false) */
    enabled: boolean
    /** TTL in ms for recovery sessions (default: 120000 = 2 minutes) */
    ttl?: number
    /** Custom recovery store (default: in-memory) */
    store?: import('../channels/recovery.js').ConnectionRecoveryPort
  }

  /**
   * Raw message handler — called BEFORE any Raffel processing.
   * Return `true` to indicate the message was handled (skip default processing).
   */
  onMessage?: (
    socketId: string,
    raw: string | Buffer,
    send: (message: unknown) => void
  ) => boolean | Promise<boolean>

  /**
   * Called when a new client connects (after auth + filter).
   * Receives the socket ID and a send function for the connection.
   */
  onConnection?: (
    socketId: string,
    send: (message: unknown) => void,
    req: IncomingMessage
  ) => void | Promise<void>

  /**
   * Called when a client disconnects.
   */
  onClose?: (
    socketId: string,
    code: number,
    reason: string
  ) => void | Promise<void>
}

/**
 * Client connection state
 */
export interface ClientConnection {
  id: string
  ws: WebSocket
  alive: boolean
  request: IncomingMessage
  connectionMetadata: Record<string, string>
  activeStreams: Map<string, AbortController>
  activeRequests: Map<string, AbortController>
  /** Auth context seed from ticket/bearer auth (merged into every request context) */
  authSeed?: ContextSeed
  /** When the client connected */
  connectedAt: number
}

/**
 * Minimal client info exposed by the adapter
 */
export interface WebSocketClientInfo {
  /** Unique socket ID */
  id: string
  /** Remote IP address */
  remoteAddress?: string
  /** Connection metadata (headers) */
  metadata: Record<string, string>
  /** Auth context seed (if authenticated) */
  authSeed?: ContextSeed
  /** When the client connected */
  connectedAt: number
}

/**
 * WebSocket Adapter
 */
export interface WebSocketAdapter {
  /** Start the server */
  start(): Promise<void>

  /** Stop the server */
  stop(): Promise<void>

  /** Get connected client count */
  readonly clientCount: number

  /**
   * Channel manager for Pusher-like channels.
   * Only available when `channels` option is provided.
   */
  readonly channels: ChannelManager | null

  /** Send a raw message to a specific client by socket ID. */
  send(socketId: string, message: unknown): void

  /** Send raw data (string or Buffer) to a specific client. */
  sendRaw(socketId: string, data: string | Buffer): void

  /** Broadcast a message to ALL connected clients. */
  broadcast(message: unknown, except?: string): void

  /** Get info about a specific connected client. */
  getClient(socketId: string): WebSocketClientInfo | undefined

  /** Get all connected clients. */
  getClients(): WebSocketClientInfo[]

  /** Disconnect a specific client. */
  disconnect(socketId: string, code?: number, reason?: string): void
}
