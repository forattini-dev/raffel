/**
 * Handler Types
 *
 * Defines the signatures for procedures, streams, and events.
 */

import type { Context } from './context.js'
import type { ContractPolicies } from './policies.js'
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

/** Operational controls for connection-scoped Live Streams. */
export interface StreamOperationalControls {
  /** Emit an SSE transport comment at this interval. */
  heartbeatMs?: number
  /** Emit an SSE retry hint when the connection opens. */
  retryMs?: number
  /** End the connection after this total duration. */
  maxDurationMs?: number
  /** End the connection when no business record is emitted for this duration. */
  idleTimeoutMs?: number
}

/** Documentation contract for one ordinary HTTP Long Poll Interaction. */
export interface LongPollContract {
  cursor: {
    /** Request query/input field containing the last observed cursor. */
    input: string
    /** Response field containing the next cursor. */
    output: string
    /** The application must return only changes strictly after the input cursor. */
    semantics: 'exclusive'
  }
  /** Maximum duration of one server-side wait. */
  waitMs: number
  /** Bounded client retry hint returned with either outcome. */
  retryMs: number
  /** Stable discriminator returned when the wait expires without a change. */
  timeoutOutcome: 'timeout'
}

/** Opaque ordered position supplied by an application-owned stream source. */
export type ResumeCursor = string

/** Delivery record kept separate from the business payload schema. */
export interface StreamRecord<TData = unknown> {
  cursor: ResumeCursor
  data: TData
}

/** Application-defined current state paired with a valid continuation cursor. */
export interface StreamSnapshot<TState = unknown> {
  cursor: ResumeCursor
  data: TState
}

export type ReplayOutcome<TData = unknown, TState = unknown> =
  | {
      outcome: 'records'
      records: AsyncIterable<StreamRecord<TData>>
      through: ResumeCursor
    }
  | {
      outcome: 'cursor-expired'
      snapshot: StreamSnapshot<TState>
    }

export interface DurableStreamSource<TInput = unknown, TData = unknown> {
  subscribe(
    input: TInput,
    options: { after?: ResumeCursor; signal: AbortSignal },
  ): AsyncIterable<StreamRecord<TData>>
}

export interface ReplayProvider<TInput = unknown, TData = unknown, TState = unknown> {
  replay(
    input: TInput,
    options: { after: ResumeCursor; signal: AbortSignal },
  ): Promise<ReplayOutcome<TData, TState>>
}

export interface ResumableStreamProvider<TInput = unknown, TData = unknown, TState = unknown> {
  source: DurableStreamSource<TInput, TData>
  replay: ReplayProvider<TInput, TData, TState>
}

/** Opt-in Source-Backed Resumable Stream contract. */
export interface ResumableStreamConfig {
  /** Name of the application provider registered through server.provide(). */
  provider: string
  delivery: 'at-least-once'
  cursor: {
    header: 'Last-Event-ID'
    query?: string
  }
  expiredCursor: {
    event: 'snapshot'
  }
}

export type StreamProjectionStatus = 'preserved' | 'adapted' | 'unsupported'

export interface StreamProjectionDiagnostic {
  status: StreamProjectionStatus
  transport: string
  resumeCursor?: string
  recordCursor?: string
  snapshot?: string
  reason?: string
}

/** Contract projection emitted by USD and protocol-specific documentation. */
export interface ResumableStreamProjectedContract extends ResumableStreamConfig {
  replay: {
    owner: 'application'
    provider: string
  }
  snapshot: {
    owner: 'application'
    event: 'snapshot'
    cursor: 'application'
    schema?: { $ref: string }
  }
  projections: {
    httpSse: StreamProjectionDiagnostic & { status: 'preserved' }
    websocket: StreamProjectionDiagnostic & { status: 'adapted' }
    grpc: StreamProjectionDiagnostic & { status: 'unsupported' }
  }
}

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

export interface GraphQLMeta {
  type: 'query' | 'mutation' | 'subscription'
  field?: string
  description?: string
  deprecationReason?: string
  tags?: string[]
  cost?: number
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface JsonRpcErrorMeta {
  code: number
  message: string
  description?: string
  dataSchema?: unknown
}

export interface JsonRpcMeta {
  streaming?: boolean
  notification?: boolean
  errors?: JsonRpcErrorMeta[]
}

export interface GrpcMeta {
  /** Service name */
  serviceName?: string
  /** Method name */
  methodName?: string
  /** Method type: unary, server-streaming, client-streaming, bidirectional */
  type?: 'unary' | 'server-streaming' | 'client-streaming' | 'bidirectional'
  /** Client streaming flag (deprecated, use type instead) */
  clientStreaming?: boolean
  /** Server streaming flag (deprecated, use type instead) */
  serverStreaming?: boolean
}

export interface ContentTypesMeta {
  default?: string
  supported?: string[]
}

/** Documentation-only controls for a handler. */
export interface HandlerDocumentationMeta {
  /** Omit the handler from every generated documentation surface. */
  hidden?: boolean
}

/**
 * Handler metadata
 */
export interface HandlerMeta {
  /** Handler kind */
  kind: HandlerKind

  /** Procedure/stream/event name */
  name: string

  /** Short summary (one-liner for OpenAPI) */
  summary?: string

  /** Description (for introspection, supports markdown) */
  description?: string

  /**
   * Tags for OpenAPI grouping.
   * Can be set via _meta.ts in fs-routes or programmatically.
   */
  tags?: string[]

  /** Controls how this handler appears in generated documentation. */
  docs?: HandlerDocumentationMeta

  /** Content type shorthand for this handler */
  contentType?: string

  /** Content type configuration for this handler */
  contentTypes?: ContentTypesMeta

  /** Stream direction (for stream handlers) */
  streamDirection?: StreamDirection

  /** Connection-scoped controls for Live Streams. */
  streamControls?: StreamOperationalControls

  /** Ordinary HTTP Long Poll Interaction metadata (procedures only). */
  longPoll?: LongPollContract

  /** Source-Backed Resumable Stream metadata (stream handlers only). */
  resumable?: ResumableStreamConfig

  /** Delivery guarantee (for event handlers) */
  delivery?: DeliveryGuarantee

  /** Retry policy (for at-least-once events) */
  retryPolicy?: RetryPolicy

  /** Deduplication window (ms) for at-most-once events */
  deduplicationWindow?: number

  /** GraphQL mapping metadata (procedures only) */
  graphql?: GraphQLMeta

  /** HTTP path override for procedures */
  httpPath?: string

  /** HTTP method override for procedures */
  httpMethod?: HttpMethod

  /**
   * HTTP success status applied by REST/HTTP-override middlewares when the
   * handler completes without error. Defaults to `200`.
   */
  httpSuccessStatus?: number

  /** JSON-RPC metadata */
  jsonrpc?: JsonRpcMeta

  /** gRPC metadata */
  grpc?: GrpcMeta

  /** Contract-bound runtime policies */
  policies?: ContractPolicies

  /** Explicit authentication requirement, including public opt-out. */
  auth?: 'required' | 'optional' | 'none'

  /** Authorization policy config (for discovery; runtime gate via interceptor). */
  authz?: import('../middleware/policy/types.js').ProcedurePolicyConfig
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
