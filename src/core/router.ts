/**
 * Router - Envelope Dispatch
 *
 * Routes incoming envelopes to the correct handler, executing
 * interceptors in an onion model.
 */

import type {
  Envelope,
  Interceptor,
  ProcedureHandler,
  EventHandler,
  RaffelStream,
  Context,
  CallFunction,
} from '../types/index.js'
import { createResponseEnvelope, createErrorEnvelope, type ErrorPayload } from '../types/envelope.js'
import type { Registry } from './registry.js'
import {
  createEventDeliveryEngine,
  type EventDeliveryOptions,
} from './event-delivery.js'
import { getStatusForCode } from '../errors/codes.js'
import { sid as generateId } from '../utils/id/index.js'

/**
 * Raffel error - thrown by handlers to signal known errors
 *
 * Contains both a string code (e.g., 'NOT_FOUND') and a numeric status (e.g., 404)
 * for interoperability across protocols.
 */
export class RaffelError extends Error {
  /**
   * Numeric status code (HTTP-compatible)
   *
   * - 400-499: Client errors
   * - 500-599: Server errors
   */
  public readonly status: number

  constructor(
    /** String error code (e.g., 'NOT_FOUND', 'VALIDATION_ERROR') */
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    /** Optional explicit status override */
    status?: number
  ) {
    super(message)
    this.name = 'RaffelError'
    this.status = status ?? getStatusForCode(code)
  }

  /**
   * Convert to plain object for serialization
   */
  toJSON(): { code: string; status: number; message: string; details?: unknown } {
    return {
      code: this.code,
      status: this.status,
      message: this.message,
      ...(this.details !== undefined && { details: this.details }),
    }
  }
}

/**
 * Router result - envelope or stream of envelopes
 */
export type RouterResult = Envelope | RaffelStream<Envelope> | AsyncIterable<Envelope>

/**
 * Router options
 */
export interface RouterOptions {
  /** Global interceptors (run for all handlers) */
  interceptors?: Interceptor[]
  /** Event delivery configuration */
  eventDelivery?: EventDeliveryOptions
}

/**
 * Router interface
 */
export interface Router {
  /** Handle an incoming envelope */
  handle(envelope: Envelope): Promise<RouterResult>

  /** Add a global interceptor */
  use(interceptor: Interceptor): void

  /** Stop background tasks (timers, retries) */
  stop(): void
}

/**
 * Build full interceptor chain with envelope and context
 */
function buildChain(
  envelope: Envelope,
  ctx: Context,
  interceptors: Interceptor[],
  finalHandler: () => Promise<unknown>
): () => Promise<unknown> {
  if (interceptors.length === 0) {
    return finalHandler
  }

  // Build chain from right to left
  let chain = finalHandler

  for (let i = interceptors.length - 1; i >= 0; i--) {
    const interceptor = interceptors[i]
    const next = chain
    chain = () => interceptor(envelope, ctx, next)
  }

  return chain
}

/**
 * Create a context with call function and incremented callingLevel
 *
 * Note: The call function is created lazily to capture the current context's
 * callingLevel properly for nested calls.
 */
function createContextWithCall(
  parentCtx: Context,
  router: Router
): Context {
  const callingLevel = (parentCtx.callingLevel ?? 0) + 1

  // Create the context first with a placeholder
  const ctxWithCall: Context = {
    ...parentCtx,
    extensions: new Map(parentCtx.extensions),
    callingLevel,
    call: undefined as unknown as CallFunction,
  }

  // Now create the call function with reference to this context
  const callFn: CallFunction = async <TInput = unknown, TOutput = unknown>(
    procedure: string,
    input: TInput
  ): Promise<TOutput> => {
    // Prevent excessive nesting (protection against infinite recursion)
    if (ctxWithCall.callingLevel! >= 100) {
      throw new RaffelError(
        'CALLING_DEPTH_EXCEEDED',
        `Maximum calling depth exceeded (${ctxWithCall.callingLevel}). Possible infinite recursion.`,
        { procedure, callingLevel: ctxWithCall.callingLevel },
        500
      )
    }

    // Create envelope for the internal call
    // Pass ctxWithCall so the next level will see the incremented callingLevel
    const envelope: Envelope<TInput> = {
      id: generateId(),
      procedure,
      type: 'request',
      payload: input,
      metadata: {
        ...(ctxWithCall.tracing && { 'x-trace-id': ctxWithCall.tracing.traceId }),
        'x-internal-call': 'true',
      },
      context: ctxWithCall,
    }

    // Execute through router
    const result = await router.handle(envelope)

    // Handle error response
    if (result && typeof result === 'object' && 'type' in result) {
      const responseEnvelope = result as Envelope
      if (responseEnvelope.type === 'error') {
        const errorPayload = responseEnvelope.payload as ErrorPayload
        throw new RaffelError(
          errorPayload.code,
          errorPayload.message,
          errorPayload.details,
          errorPayload.status
        )
      }
      // Extract payload from response
      return responseEnvelope.payload as TOutput
    }

    // For streams or other results, return as-is
    return result as TOutput
  }

  // Assign the call function
  ctxWithCall.call = callFn

  return ctxWithCall
}

/**
 * Create a new Router
 */
export function createRouter(registry: Registry, options: RouterOptions = {}): Router {
  const globalInterceptors: Interceptor[] = options.interceptors ?? []
  const deliveryEngine = createEventDeliveryEngine(options.eventDelivery)

  return {
    use(interceptor: Interceptor): void {
      globalInterceptors.push(interceptor)
    },

    stop(): void {
      deliveryEngine.stop()
    },

    async handle(envelope: Envelope): Promise<RouterResult> {
      const { procedure, type, payload, context } = envelope

      // Create call function bound to this router
      // We need a reference to `this` (the router) for ctx.call()
      const router = this

      try {
        // Check deadline
        if (context.deadline && Date.now() > context.deadline) {
          return createErrorEnvelope(envelope, 'DEADLINE_EXCEEDED', 'Request deadline exceeded')
        }

        // Check cancellation
        if (context.signal.aborted) {
          return createErrorEnvelope(envelope, 'CANCELLED', 'Request was cancelled')
        }

        // Create enhanced context with call function
        const ctxWithCall = createContextWithCall(context, router)

        // Route based on envelope type
        switch (type) {
          case 'request': {
            // Look up procedure
            const registered = registry.getProcedure(procedure)
            if (!registered) {
              return createErrorEnvelope(envelope, 'NOT_FOUND', `Procedure '${procedure}' not found`)
            }

            // Build interceptor chain
            const interceptors = [
              ...globalInterceptors,
              ...(registered.interceptors ?? []),
            ]

            const handler = registered.handler as ProcedureHandler
            const chain = buildChain(
              envelope,
              ctxWithCall,
              interceptors,
              async () => handler(payload, ctxWithCall)
            )

            // Execute chain
            const result = await chain()
            return createResponseEnvelope(envelope, result)
          }

          case 'stream:start': {
            // Look up stream handler
            const registered = registry.getStream(procedure)
            if (!registered) {
              return createErrorEnvelope(envelope, 'NOT_FOUND', `Stream '${procedure}' not found`)
            }

            // Build interceptor chain for stream initiation
            const interceptors = [
              ...globalInterceptors,
              ...(registered.interceptors ?? []),
            ]

            const streamDirection = registered.meta.streamDirection ?? 'server'

            const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> | RaffelStream<unknown> =>
              !!value && typeof value === 'object' && Symbol.asyncIterator in value

            if (streamDirection === 'server') {
              const handler = registered.handler as (
                input: unknown,
                ctx: Context
              ) => AsyncIterable<unknown> | RaffelStream<unknown>

              const chain = buildChain(
                envelope,
                ctxWithCall,
                interceptors,
                async () => handler(payload, ctxWithCall)
              )

              // Execute chain - returns stream or async iterable
              const result = (await chain()) as AsyncIterable<unknown> | RaffelStream<unknown>

              // Wrap in envelope stream
              return wrapStreamInEnvelopes(envelope, result)
            }

            if (!isAsyncIterable(payload)) {
              return createErrorEnvelope(
                envelope,
                'INVALID_ARGUMENT',
                'Stream payload must be an async iterable'
              )
            }

            if (streamDirection === 'client') {
              const handler = registered.handler as (
                input: AsyncIterable<unknown> | RaffelStream<unknown>,
                ctx: Context
              ) => Promise<unknown>

              const chain = buildChain(
                envelope,
                ctxWithCall,
                interceptors,
                async () => handler(payload, ctxWithCall)
              )

              const result = await chain()
              return createResponseEnvelope(envelope, result)
            }

            const handler = registered.handler as (
              input: AsyncIterable<unknown> | RaffelStream<unknown>,
              ctx: Context
            ) => AsyncIterable<unknown> | RaffelStream<unknown>

            const chain = buildChain(
              envelope,
              ctxWithCall,
              interceptors,
              async () => handler(payload, ctxWithCall)
            )

            const result = (await chain()) as AsyncIterable<unknown> | RaffelStream<unknown>
            return wrapStreamInEnvelopes(envelope, result)
          }

          case 'event': {
            // Look up event handler
            const registered = registry.getEvent(procedure)
            if (!registered) {
              // Events are fire-and-forget, but still return error for bad routing
              return createErrorEnvelope(envelope, 'NOT_FOUND', `Event '${procedure}' not found`)
            }

            // Build interceptor chain
            const interceptors = [
              ...globalInterceptors,
              ...(registered.interceptors ?? []),
            ]

            const handler = registered.handler as EventHandler

            const delivery = registered.meta.delivery ?? 'best-effort'
            const execute = async (ack: () => void) => {
              const chain = buildChain(
                envelope,
                ctxWithCall,
                interceptors,
                async () => handler(payload, ctxWithCall, ack)
              )
              await chain()
            }

            const deliveryPromise = deliveryEngine.deliver({
              eventId: envelope.id,
              delivery,
              retryPolicy: registered.meta.retryPolicy,
              deduplicationWindow: registered.meta.deduplicationWindow,
              execute,
            })

            if (delivery === 'best-effort') {
              deliveryPromise.catch((err) => {
                console.error(`Event handler error for '${procedure}':`, err)
              })
            } else {
              await deliveryPromise
            }

            // Events don't return meaningful responses
            return createResponseEnvelope(envelope, { received: true })
          }

          default:
            return createErrorEnvelope(
              envelope,
              'INVALID_TYPE',
              `Cannot route envelope type: ${type}`
            )
        }
      } catch (err) {
        // Handle known errors
        if (err instanceof RaffelError) {
          return createErrorEnvelope(envelope, err.code, err.message, err.details, err.status)
        }

        // Handle unknown errors
        const error = err as Error
        return createErrorEnvelope(
          envelope,
          'INTERNAL_ERROR',
          error.message ?? 'Unknown error',
          process.env.NODE_ENV === 'development' ? error.stack : undefined
        )
      }
    },
  }
}

/**
 * Wrap a stream result in envelope stream
 */
async function* wrapStreamInEnvelopes(
  request: Envelope,
  stream: AsyncIterable<unknown> | RaffelStream<unknown>
): AsyncIterable<Envelope> {
  // Send stream start
  yield {
    id: `${request.id}:stream:start`,
    procedure: request.procedure,
    type: 'stream:start',
    payload: null,
    metadata: {},
    context: request.context,
  }

  try {
    // Send data chunks
    for await (const chunk of stream) {
      yield {
        id: `${request.id}:stream:data:${Date.now()}`,
        procedure: request.procedure,
        type: 'stream:data',
        payload: chunk,
        metadata: {},
        context: request.context,
      }
    }

    // Send stream end
    yield {
      id: `${request.id}:stream:end`,
      procedure: request.procedure,
      type: 'stream:end',
      payload: null,
      metadata: {},
      context: request.context,
    }
  } catch (err) {
    // Send stream error
    const error = err as Error
    const code = err instanceof RaffelError ? err.code : 'STREAM_ERROR'
    yield {
      id: `${request.id}:stream:error`,
      procedure: request.procedure,
      type: 'stream:error',
      payload: {
        code,
        status: err instanceof RaffelError ? err.status : getStatusForCode(code),
        message: error.message ?? 'Stream error',
        details: err instanceof RaffelError ? err.details : undefined,
      },
      metadata: {},
      context: request.context,
    }
  }
}
