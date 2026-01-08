/**
 * RaffelStream Types
 *
 * Custom stream abstraction with backpressure, multiplex, and priority support.
 */

/**
 * Result of a read operation
 */
export interface StreamChunk<T> {
  /** true if stream is closed */
  done: boolean
  /** Value if done=false */
  value?: T
}

/**
 * Stream configuration options
 */
export interface StreamOptions {
  /** Stream ID for multiplexing (auto-generated if not provided) */
  id?: string
  /** Max items in buffer before backpressure kicks in (default: 16) */
  highWaterMark?: number
  /** Priority level: higher = processed first (default: 0) */
  priority?: number
}

/**
 * Stream state
 */
export type StreamState = 'open' | 'closing' | 'closed' | 'errored'

/**
 * RaffelStream interface - duplex stream with backpressure
 */
export interface RaffelStream<T> {
  // === Reading ===

  /** Read next chunk (resolves when data available or stream ends) */
  read(): Promise<StreamChunk<T>>

  /** Async iterator support for `for await...of` */
  [Symbol.asyncIterator](): AsyncIterator<T>

  // === Writing ===

  /** Write value (resolves when buffer has space - backpressure) */
  write(value: T): Promise<void>

  /** Signal end of writes (no more data coming) */
  end(): void

  /** Signal error (terminates stream) */
  error(err: Error): void

  // === Control ===

  /** Pause reading (manual backpressure) */
  pause(): void

  /** Resume reading */
  resume(): void

  /** Cancel stream with optional reason */
  cancel(reason?: string): void

  // === State ===

  /** Can read from stream */
  readonly readable: boolean

  /** Can write to stream */
  readonly writable: boolean

  /** Stream is closed (reads may still have buffered data) */
  readonly closed: boolean

  /** Error if stream errored */
  readonly errored: Error | null

  // === Metadata ===

  /** Stream ID (for multiplexing) */
  readonly id: string

  /** Priority level */
  readonly priority: number

  /** Number of items currently buffered */
  readonly bufferedAmount: number
}

/**
 * Function to create a new RaffelStream
 */
export type CreateStreamFn = <T>(options?: StreamOptions) => RaffelStream<T>
