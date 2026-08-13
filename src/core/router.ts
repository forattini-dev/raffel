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
  StreamHandler,
  RaffelStream,
  Context,
  CallFunction,
  ContractPolicies,
  RegisteredHandler,
  DeliveryGuarantee,
  StreamRecord,
} from '../types/index.js'
import {
  createAuthContext,
  normalizeTracingContext,
  stripTransportCapabilities,
} from '../types/context.js'
import { createResponseEnvelope, createErrorEnvelope, type ErrorPayload } from '../types/envelope.js'
import type { Registry } from './registry.js'
import {
  createEventDeliveryEngine,
  type EventDeliveryOptions,
} from './event-delivery.js'
import { RaffelError, isRaffelLikeError } from './error.js'
import { getStatusForCode } from '../errors/codes.js'
import { sid as generateId } from '../utils/id/index.js'
import { createLogger } from '../utils/logger.js'
import { isAsyncIterable } from '../utils/type-guards.js'
import {
  CONTRACT_POLICY_METADATA_KEY,
  mergeContractPolicies,
  normalizeContractPolicies,
  parseContractPolicies,
  serializeContractPolicies,
} from '../types/policies.js'

const logger = createLogger('router')

export { RaffelError }

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
 * Pre-compile an interceptor executor for a stable interceptor list.
 *
 * The returned function still receives the dynamic envelope/context/final handler
 * for each request, but avoids rebuilding the interceptor array and walking it
 * right-to-left on every dispatch.
 */
type CompiledInterceptorExecutor = (
  envelope: Envelope,
  ctx: Context,
  finalHandler: () => Promise<unknown>
) => Promise<unknown>

function compileInterceptorExecutor(
  interceptors: readonly Interceptor[]
): CompiledInterceptorExecutor {
  if (interceptors.length === 0) {
    return async (_envelope, _ctx, finalHandler) => finalHandler()
  }

  const stages: CompiledInterceptorExecutor[] = new Array(interceptors.length)

  for (let i = interceptors.length - 1; i >= 0; i--) {
    const interceptor = interceptors[i]
    const nextStage = stages[i + 1]
    stages[i] = async (envelope, ctx, finalHandler) =>
      interceptor(
        envelope,
        ctx,
        () => (nextStage ? nextStage(envelope, ctx, finalHandler) : finalHandler())
      )
  }

  return stages[0]!
}

function invokeTracedHandler<T>(
  ctx: Context,
  procedure: string,
  kind: 'procedure' | 'stream' | 'event',
  handler: () => Promise<T> | T
): Promise<T> {
  return ctx.tracing.trace(
    'raffel.handler',
    {
      'raffel.procedure': procedure,
      'raffel.handler.kind': kind,
    },
    handler
  )
}

/**
 * Create a context with call function and incremented callingLevel
 *
 * Note: The call function is created lazily to capture the current context's
 * callingLevel properly for nested calls.
 */
function getPropagatedPolicyContext(
  policies?: ContractPolicies
): ContractPolicies | undefined {
  if (!policies) return undefined
  return normalizeContractPolicies(policies)
}

function createContextWithCall(baseCtx: Context, router: Router): Context {
  const callingLevel = (baseCtx.callingLevel ?? 0) + 1

  // Build context base; call is assigned after callFn is created
  const ctxWithCall: Context = {
    ...baseCtx,
    auth: createAuthContext(baseCtx.auth),
    extensions: new Map(baseCtx.extensions),
    callingLevel,
  }

  // Create the call function with reference to this context
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

    const propagatedPolicyContext = getPropagatedPolicyContext(ctxWithCall.contract?.policyContext)
    const serializedPolicyContext = serializeContractPolicies(propagatedPolicyContext)
    const metadata = {
      ...(ctxWithCall.requestId && { 'x-request-id': ctxWithCall.requestId }),
      ...(ctxWithCall.deadline && { 'x-deadline': ctxWithCall.deadline.toString() }),
      ...(ctxWithCall.tracing && { 'x-trace-id': ctxWithCall.tracing.traceId }),
      ...(serializedPolicyContext && {
        [CONTRACT_POLICY_METADATA_KEY]: serializedPolicyContext,
      }),
      'x-internal-call': 'true',
    }

    // Create envelope for the internal call
    // Pass ctxWithCall so the next level will see the incremented callingLevel
    const envelope: Envelope<TInput> = {
      id: generateId(),
      procedure,
      type: 'request',
      payload: input,
      metadata,
      context: {
        ...stripTransportCapabilities(ctxWithCall),
        extensions: new Map(ctxWithCall.extensions),
        ...(ctxWithCall.contract && {
          contract: {
            ...ctxWithCall.contract,
            policyContext: propagatedPolicyContext,
          },
        }),
      },
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

function createHandlerContext(
  context: Context,
  envelope: Envelope,
  router: Router,
  meta: { name: string; kind: 'procedure' | 'stream' | 'event'; policies?: ContractPolicies }
): Context {
  const incomingPolicyContext =
    parseContractPolicies(envelope.metadata[CONTRACT_POLICY_METADATA_KEY])
    ?? context.contract?.policyContext

  const attachedPolicies = normalizeContractPolicies(meta.policies)
  const policyContext = mergeContractPolicies(incomingPolicyContext, attachedPolicies)

  return createContextWithCall(
    {
      ...context,
      tracing: normalizeTracingContext(context.tracing),
      extensions: new Map(context.extensions),
      contract: {
        name: meta.name,
        kind: meta.kind,
        policies: attachedPolicies,
        policyContext,
      },
    },
    router
  )
}

interface CachedProcedurePlan {
  version: number
  execute: CompiledInterceptorExecutor
  handler: ProcedureHandler
}

type CachedStreamPlan =
  | {
    version: number
    streamDirection: 'server'
    execute: CompiledInterceptorExecutor
    handler: (
      input: unknown,
      ctx: Context
    ) => AsyncIterable<unknown> | RaffelStream<unknown>
  }
  | {
    version: number
    streamDirection: 'client'
    execute: CompiledInterceptorExecutor
    handler: (
      input: AsyncIterable<unknown> | RaffelStream<unknown>,
      ctx: Context
    ) => Promise<unknown>
  }
  | {
    version: number
    streamDirection: 'bidi'
    execute: CompiledInterceptorExecutor
    handler: (
      input: AsyncIterable<unknown> | RaffelStream<unknown>,
      ctx: Context
    ) => AsyncIterable<unknown> | RaffelStream<unknown>
  }

interface CachedEventPlan {
  version: number
  delivery: DeliveryGuarantee
  retryPolicy?: RegisteredHandler<EventHandler>['meta']['retryPolicy']
  deduplicationWindow?: number
  execute: (
    envelope: Envelope,
    ctx: Context,
    payload: unknown,
    ack: () => void
  ) => Promise<void>
}

/**
 * Create a new Router
 */
export function createRouter(registry: Registry, options: RouterOptions = {}): Router {
  const globalInterceptors: Interceptor[] = options.interceptors ? [...options.interceptors] : []
  let globalInterceptorsVersion = 0
  const deliveryEngine = createEventDeliveryEngine(options.eventDelivery)
  const procedurePlanCache = new WeakMap<RegisteredHandler<ProcedureHandler>, CachedProcedurePlan>()
  const streamPlanCache = new WeakMap<RegisteredHandler<StreamHandler>, CachedStreamPlan>()
  const eventPlanCache = new WeakMap<RegisteredHandler<EventHandler>, CachedEventPlan>()

  const getProcedurePlan = (
    registered: RegisteredHandler<ProcedureHandler>
  ): CachedProcedurePlan => {
    const cached = procedurePlanCache.get(registered)
    if (cached && cached.version === globalInterceptorsVersion) {
      return cached
    }

    const plan: CachedProcedurePlan = {
      version: globalInterceptorsVersion,
      execute: compileInterceptorExecutor([
        ...globalInterceptors,
        ...(registered.interceptors ?? []),
      ]),
      handler: registered.handler,
    }
    procedurePlanCache.set(registered, plan)
    return plan
  }

  const getStreamPlan = (
    registered: RegisteredHandler<StreamHandler>
  ): CachedStreamPlan => {
    const cached = streamPlanCache.get(registered)
    if (cached && cached.version === globalInterceptorsVersion) {
      return cached
    }

    const execute = compileInterceptorExecutor([
      ...globalInterceptors,
      ...(registered.interceptors ?? []),
    ])
    const streamDirection = registered.meta.streamDirection ?? 'server'

    let plan: CachedStreamPlan
    switch (streamDirection) {
      case 'client':
        plan = {
          version: globalInterceptorsVersion,
          streamDirection,
          execute,
          handler: registered.handler as (
            input: AsyncIterable<unknown> | RaffelStream<unknown>,
            ctx: Context
          ) => Promise<unknown>,
        }
        break
      case 'bidi':
        plan = {
          version: globalInterceptorsVersion,
          streamDirection,
          execute,
          handler: registered.handler as (
            input: AsyncIterable<unknown> | RaffelStream<unknown>,
            ctx: Context
          ) => AsyncIterable<unknown> | RaffelStream<unknown>,
        }
        break
      default:
        plan = {
          version: globalInterceptorsVersion,
          streamDirection: 'server',
          execute,
          handler: registered.handler as (
            input: unknown,
            ctx: Context
          ) => AsyncIterable<unknown> | RaffelStream<unknown>,
        }
        break
    }

    streamPlanCache.set(registered, plan)
    return plan
  }

  const getEventPlan = (registered: RegisteredHandler<EventHandler>): CachedEventPlan => {
    const cached = eventPlanCache.get(registered)
    if (cached && cached.version === globalInterceptorsVersion) {
      return cached
    }

    const handler = registered.handler
    const execute = compileInterceptorExecutor([
      ...globalInterceptors,
      ...(registered.interceptors ?? []),
    ])
    const plan: CachedEventPlan = {
      version: globalInterceptorsVersion,
      delivery: registered.meta.delivery ?? 'best-effort',
      retryPolicy: registered.meta.retryPolicy,
      deduplicationWindow: registered.meta.deduplicationWindow,
      execute: async (envelope, ctx, payload, ack) => {
        await execute(envelope, ctx, () => invokeTracedHandler(
          ctx,
          envelope.procedure,
          'event',
          () => handler(payload, ctx, ack)
        ))
      },
    }

    eventPlanCache.set(registered, plan)
    return plan
  }

  return {
    use(interceptor: Interceptor): void {
      globalInterceptors.push(interceptor)
      globalInterceptorsVersion += 1
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

        // Route based on envelope type
        switch (type) {
          case 'request': {
            // Look up procedure
            const registered = registry.getProcedure(procedure)
            if (!registered) {
              return createErrorEnvelope(envelope, 'NOT_FOUND', `Procedure '${procedure}' not found`)
            }

            const ctxWithCall = createHandlerContext(context, envelope, router, registered.meta)
            const plan = getProcedurePlan(registered)
            const result = await plan.execute(
              envelope,
              ctxWithCall,
              () => invokeTracedHandler(
                ctxWithCall,
                procedure,
                'procedure',
                () => plan.handler(payload, ctxWithCall)
              )
            )
            return createResponseEnvelope(envelope, result)
          }

          case 'stream:start': {
            // Look up stream handler
            const registered = registry.getStream(procedure)
            if (!registered) {
              return createErrorEnvelope(envelope, 'NOT_FOUND', `Stream '${procedure}' not found`)
            }

            const ctxWithCall = createHandlerContext(context, envelope, router, registered.meta)
            const plan = getStreamPlan(registered)

            if (plan.streamDirection === 'server') {
              const result = (await plan.execute(
                envelope,
                ctxWithCall,
                () => invokeTracedHandler(
                  ctxWithCall,
                  procedure,
                  'stream',
                  () => plan.handler(payload, ctxWithCall)
                )
              )) as AsyncIterable<unknown> | RaffelStream<unknown>
              return wrapStreamInEnvelopes(
                envelope,
                result,
                registered.meta.resumable !== undefined,
              )
            }

            if (!isAsyncIterable(payload)) {
              return createErrorEnvelope(
                envelope,
                'INVALID_ARGUMENT',
                'Stream payload must be an async iterable'
              )
            }

            if (plan.streamDirection === 'client') {
              const result = await plan.execute(
                envelope,
                ctxWithCall,
                () => invokeTracedHandler(
                  ctxWithCall,
                  procedure,
                  'stream',
                  () => plan.handler(payload, ctxWithCall)
                )
              )
              return createResponseEnvelope(envelope, result)
            }

            const result = (await plan.execute(
              envelope,
              ctxWithCall,
              () => invokeTracedHandler(
                ctxWithCall,
                procedure,
                'stream',
                () => plan.handler(payload, ctxWithCall)
              )
            )) as AsyncIterable<unknown> | RaffelStream<unknown>
            return wrapStreamInEnvelopes(envelope, result, false)
          }

          case 'event': {
            // Look up event handler
            const registered = registry.getEvent(procedure)
            if (!registered) {
              // Events are fire-and-forget, but still return error for bad routing
              return createErrorEnvelope(envelope, 'NOT_FOUND', `Event '${procedure}' not found`)
            }

            const ctxWithCall = createHandlerContext(context, envelope, router, registered.meta)
            const plan = getEventPlan(registered)
            const execute = async (ack: () => void) => {
              await plan.execute(envelope, ctxWithCall, payload, ack)
            }

            const deliveryPromise = deliveryEngine.deliver({
              eventId: envelope.id,
              delivery: plan.delivery,
              retryPolicy: plan.retryPolicy,
              deduplicationWindow: plan.deduplicationWindow,
              execute,
            })

            if (plan.delivery === 'best-effort') {
              deliveryPromise.catch((err) => {
                logger.error({ err, procedure }, 'Event handler error')
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

        if (isRaffelLikeError(err)) {
          return createErrorEnvelope(
            envelope,
            err.code,
            (err as Error).message ?? 'Unknown error',
            err.details,
            err.status
          )
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
  stream: AsyncIterable<unknown> | RaffelStream<unknown>,
  resumable: boolean,
): AsyncIterable<Envelope> {
  let chunkIndex = 0

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
      const record = resumable && isStreamRecord(chunk) ? chunk : undefined
      yield {
        id: `${request.id}:stream:data:${chunkIndex++}`,
        procedure: request.procedure,
        type: 'stream:data',
        payload: record?.data ?? chunk,
        metadata: record ? { 'x-raffel-stream-cursor': record.cursor } : {},
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

function isStreamRecord(value: unknown): value is StreamRecord {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as StreamRecord).cursor === 'string' &&
    'data' in value,
  )
}
