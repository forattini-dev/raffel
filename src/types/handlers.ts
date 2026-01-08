/**
 * Handler Types
 *
 * Defines the signatures for procedures, streams, and events.
 */

import type { Context } from './context.js'
import type { RaffelStream } from './stream.js'

/**
 * Procedure handler - unary RPC (request → response)
 */
export type ProcedureHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  ctx: Context
) => Promise<TOutput> | TOutput

/**
 * Server stream handler - server sends multiple responses
 */
export type ServerStreamHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  ctx: Context
) => RaffelStream<TOutput> | AsyncIterable<TOutput>

/**
 * Client stream handler - client sends multiple requests
 */
export type ClientStreamHandler<TInput = unknown, TOutput = unknown> = (
  input: RaffelStream<TInput> | AsyncIterable<TInput>,
  ctx: Context
) => Promise<TOutput>

/**
 * Bidirectional stream handler - both sides stream
 */
export type BidiStreamHandler<TInput = unknown, TOutput = unknown> = (
  input: RaffelStream<TInput> | AsyncIterable<TInput>,
  ctx: Context
) => RaffelStream<TOutput> | AsyncIterable<TOutput>

/**
 * Any stream handler type
 */
export type StreamHandler<TInput = unknown, TOutput = unknown> =
  | ServerStreamHandler<TInput, TOutput>
  | ClientStreamHandler<TInput, TOutput>
  | BidiStreamHandler<TInput, TOutput>

/**
 * Event acknowledgment function (for at-least-once delivery)
 */
export type AckFunction = () => void

/**
 * Event handler - pub/sub
 */
export type EventHandler<TPayload = unknown> = (
  payload: TPayload,
  ctx: Context,
  ack?: AckFunction
) => void | Promise<void>

/**
 * Handler kind discriminator
 */
export type HandlerKind = 'procedure' | 'stream' | 'event'

/**
 * Stream direction
 */
export type StreamDirection = 'server' | 'client' | 'bidi'

/**
 * Delivery guarantee for events
 */
export type DeliveryGuarantee = 'best-effort' | 'at-least-once' | 'at-most-once'

/**
 * Retry policy for at-least-once delivery
 */
export interface RetryPolicy {
  /** Maximum retry attempts */
  maxAttempts: number
  /** Initial delay (ms) */
  initialDelay: number
  /** Maximum delay (ms) */
  maxDelay: number
  /** Backoff multiplier */
  backoffMultiplier: number
}

/**
 * Handler metadata
 */
export interface HandlerMeta {
  /** Handler kind */
  kind: HandlerKind

  /** Procedure/stream/event name */
  name: string

  /** Description (for introspection) */
  description?: string

  /** Stream direction (for stream handlers) */
  streamDirection?: StreamDirection

  /** Delivery guarantee (for event handlers) */
  delivery?: DeliveryGuarantee

  /** Retry policy (for at-least-once events) */
  retryPolicy?: RetryPolicy

  /** Deduplication window (ms) for at-most-once events */
  deduplicationWindow?: number
}

/**
 * Registered handler entry
 */
export interface RegisteredHandler<H = unknown> {
  /** Handler function */
  handler: H

  /** Handler metadata */
  meta: HandlerMeta

  /** Per-handler interceptors */
  interceptors?: Interceptor[]
}

/**
 * Interceptor function (middleware)
 *
 * Interceptors wrap handler execution in an onion model.
 * They can modify the envelope, context, or result.
 */
export type Interceptor = (
  envelope: import('./envelope.js').Envelope,
  ctx: Context,
  next: () => Promise<unknown>
) => Promise<unknown>
