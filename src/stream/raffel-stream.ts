/**
 * RaffelStream Implementation
 *
 * A duplex stream with backpressure, designed for multi-protocol server runtime.
 *
 * Key features:
 * - Backpressure via highWaterMark (write() blocks when buffer full)
 * - AsyncIterator support (for await...of)
 * - Multiplex-ready (unique IDs)
 * - Priority scheduling support
 */

import { sid } from '../utils/id/index.js'
import type {
  RaffelStream,
  StreamChunk,
  StreamOptions,
  StreamState,
} from '../types/stream.js'

const DEFAULT_HIGH_WATER_MARK = 16

/**
 * Pending reader - waiting for data
 */
interface PendingReader<T> {
  resolve: (chunk: StreamChunk<T>) => void
  reject: (err: Error) => void
}

/**
 * Pending writer - waiting for buffer space
 */
interface PendingWriter<T> {
  value: T
  resolve: () => void
  reject: (err: Error) => void
}

/**
 * Creates a new RaffelStream
 */
export function createStream<T>(options: StreamOptions = {}): RaffelStream<T> {
  // Configuration
  const id = options.id ?? sid()
  const highWaterMark = options.highWaterMark ?? DEFAULT_HIGH_WATER_MARK
  const priority = options.priority ?? 0

  // State
  let state: StreamState = 'open'
  let error: Error | null = null
  let paused = false

  // Buffers
  const buffer: T[] = []
  const pendingReaders: PendingReader<T>[] = []
  const pendingWriters: PendingWriter<T>[] = []

  /**
   * Try to match pending readers with available data
   */
  function flush(): void {
    // If errored, reject all pending operations FIRST
    if (state === 'errored' && error) {
      while (pendingReaders.length > 0) {
        const reader = pendingReaders.shift()!
        reader.reject(error)
      }
      while (pendingWriters.length > 0) {
        const writer = pendingWriters.shift()!
        writer.reject(error)
      }
      return
    }

    // Don't flush if paused
    if (paused) return

    // Match readers with buffered data
    while (pendingReaders.length > 0 && buffer.length > 0) {
      const reader = pendingReaders.shift()!
      const value = buffer.shift()!
      reader.resolve({ done: false, value })
    }

    // Direct delivery: match readers with pending writers (for highWaterMark=0)
    while (pendingReaders.length > 0 && pendingWriters.length > 0) {
      const reader = pendingReaders.shift()!
      const writer = pendingWriters.shift()!
      reader.resolve({ done: false, value: writer.value })
      writer.resolve()
    }

    // If buffer has space, resolve pending writers
    while (pendingWriters.length > 0 && buffer.length < highWaterMark) {
      const writer = pendingWriters.shift()!
      buffer.push(writer.value)
      writer.resolve()
    }

    // If stream is closing and buffer empty, resolve remaining readers with done
    if (state === 'closing' && buffer.length === 0 && pendingWriters.length === 0) {
      state = 'closed'
      while (pendingReaders.length > 0) {
        const reader = pendingReaders.shift()!
        reader.resolve({ done: true })
      }
    }
  }

  const stream: RaffelStream<T> = {
    // === Reading ===

    read(): Promise<StreamChunk<T>> {
      return new Promise((resolve, reject) => {
        // If errored, reject immediately
        if (state === 'errored') {
          return reject(error!)
        }

        // If closed (and buffer empty), return done
        if (state === 'closed') {
          return resolve({ done: true })
        }

        // If data in buffer, return it
        if (buffer.length > 0 && !paused) {
          const value = buffer.shift()!
          // Try to unblock a writer
          if (pendingWriters.length > 0) {
            const writer = pendingWriters.shift()!
            buffer.push(writer.value)
            writer.resolve()
          }
          return resolve({ done: false, value })
        }

        // If closing and buffer empty, return done
        if (state === 'closing' && buffer.length === 0) {
          state = 'closed'
          return resolve({ done: true })
        }

        // Queue the read
        pendingReaders.push({ resolve, reject })

        // Try to match with pending writers (important for highWaterMark=0)
        // Use queueMicrotask to allow write() to complete first
        queueMicrotask(flush)
      })
    },

    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next: async (): Promise<IteratorResult<T>> => {
          const chunk = await stream.read()
          if (chunk.done) {
            return { done: true, value: undefined }
          }
          return { done: false, value: chunk.value! }
        },
        return: async (): Promise<IteratorResult<T>> => {
          stream.cancel('Iterator return called')
          return { done: true, value: undefined }
        },
        throw: async (err: Error): Promise<IteratorResult<T>> => {
          stream.error(err)
          return { done: true, value: undefined }
        },
      }
    },

    // === Writing ===

    write(value: T): Promise<void> {
      return new Promise((resolve, reject) => {
        // Can't write to closed/errored/closing stream
        if (state !== 'open') {
          return reject(
            new Error(`Cannot write to stream in state: ${state}`)
          )
        }

        // If there's a pending reader, deliver directly (fast path)
        if (pendingReaders.length > 0 && !paused) {
          const reader = pendingReaders.shift()!
          reader.resolve({ done: false, value })
          return resolve()
        }

        // If buffer has space, add to buffer
        if (buffer.length < highWaterMark) {
          buffer.push(value)
          return resolve()
        }

        // Buffer full - queue the write (backpressure)
        pendingWriters.push({ value, resolve, reject })
      })
    },

    end(): void {
      if (state !== 'open') return

      state = 'closing'
      flush()
    },

    error(err: Error): void {
      if (state === 'closed' || state === 'errored') return

      state = 'errored'
      error = err
      flush()
    },

    // === Control ===

    pause(): void {
      paused = true
    },

    resume(): void {
      paused = false
      flush()
    },

    cancel(reason?: string): void {
      if (state === 'closed' || state === 'errored') return

      state = 'errored'
      error = new Error(reason ?? 'Stream cancelled')

      // Clear buffer
      buffer.length = 0
      flush()
    },

    // === State ===

    get readable(): boolean {
      return state !== 'errored' && (state !== 'closed' || buffer.length > 0)
    },

    get writable(): boolean {
      return state === 'open'
    },

    get closed(): boolean {
      return state === 'closed'
    },

    get errored(): Error | null {
      return error
    },

    // === Metadata ===

    id,
    priority,

    get bufferedAmount(): number {
      return buffer.length
    },
  }

  return stream
}
