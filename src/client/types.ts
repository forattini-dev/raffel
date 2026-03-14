/**
 * Raffel WebSocket Client Types
 */

/**
 * Client configuration
 */
export interface RaffelClientOptions {
  /** WebSocket URL (e.g. 'ws://localhost:3000/ws') */
  url: string

  /** Auto-reconnect on disconnect (default: true) */
  reconnect?: boolean

  /** Maximum reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number

  /** Initial reconnect delay in ms (default: 1000) */
  reconnectDelay?: number

  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number

  /** Reconnect backoff multiplier (default: 2) */
  reconnectBackoff?: number

  /** Connection timeout in ms (default: 10000) */
  connectTimeout?: number

  /** Per-request timeout in ms (default: 30000) */
  requestTimeout?: number

  /** Auth token to pass as query parameter */
  token?: string

  /** Custom WebSocket protocols */
  protocols?: string | string[]

  /** Called when connection is established */
  onConnect?: () => void

  /** Called when connection is lost */
  onDisconnect?: (code: number, reason: string) => void

  /** Called on reconnect attempt */
  onReconnect?: (attempt: number) => void

  /** Called on errors */
  onError?: (error: Error) => void
}

/**
 * Client stream handle for server streams
 */
export interface ClientStream<T = unknown> {
  /** Async iterable interface */
  [Symbol.asyncIterator](): AsyncIterator<T>

  /** Cancel the stream */
  cancel(): void
}

/**
 * Raffel client interface
 */
export interface RaffelClient {
  /** Make an RPC call */
  call<TInput = unknown, TOutput = unknown>(
    procedure: string,
    payload?: TInput,
    options?: CallOptions
  ): Promise<TOutput>

  /** Open a server stream */
  stream<T = unknown>(
    procedure: string,
    payload?: unknown,
    options?: CallOptions
  ): ClientStream<T>

  /** Close the connection */
  close(): void

  /** Current connection state */
  readonly connected: boolean
}

/**
 * Per-call options
 */
export interface CallOptions {
  /** Override request timeout for this call */
  timeout?: number
  /** Custom metadata to send */
  metadata?: Record<string, string>
}
