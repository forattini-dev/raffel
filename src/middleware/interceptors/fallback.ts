/**
 * Fallback Interceptor
 *
 * Protocol-agnostic graceful degradation pattern.
 * Returns a default response when the handler fails, preventing error propagation.
 *
 * Features:
 * - Static fallback response
 * - Dynamic fallback handler with access to error and context
 * - Conditional fallback based on error type
 * - Async fallback support
 */

import type { Interceptor, Envelope, Context } from '../../types/index.js'
import type { FallbackConfig } from '../types.js'

/**
 * Create a fallback interceptor for graceful degradation
 *
 * When the handler throws an error, the fallback interceptor catches it
 * and returns a default response instead of propagating the error.
 *
 * @example
 * ```typescript
 * // Static fallback response
 * const fallback = createFallbackInterceptor({
 *   response: { id: 0, name: 'Guest', status: 'unavailable' }
 * })
 *
 * // Dynamic fallback with error info
 * const fallback = createFallbackInterceptor({
 *   handler: (ctx, error) => ({
 *     id: 0,
 *     name: 'Guest',
 *     errorReason: error.message
 *   })
 * })
 *
 * // Conditional fallback - only for specific errors
 * const fallback = createFallbackInterceptor({
 *   response: defaultUser,
 *   when: (error) => error.code === 'SERVICE_UNAVAILABLE'
 * })
 *
 * // Async fallback - fetch from cache
 * const fallback = createFallbackInterceptor({
 *   handler: async (ctx, error) => {
 *     return await cache.get(`user:${ctx.input?.id}`) ?? defaultUser
 *   }
 * })
 *
 * server
 *   .procedure('users.get')
 *   .use(fallback)
 *   .handler(...)
 * ```
 */
export function createFallbackInterceptor<TOutput = unknown>(
  config: FallbackConfig<TOutput>
): Interceptor {
  const { response, handler, when } = config

  // Validate config - must have response or handler
  if (response === undefined && handler === undefined) {
    throw new Error('Fallback interceptor requires either "response" or "handler" option')
  }

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    try {
      return await next()
    } catch (error) {
      const err = error as Error

      // Check if fallback should apply
      if (when && !when(err)) {
        // Condition not met, re-throw error
        throw error
      }

      // Use handler if provided, otherwise return static response
      if (handler) {
        return await handler(ctx, err)
      }

      return response
    }
  }
}

/**
 * Create a fallback interceptor with procedure-specific configurations
 *
 * @example
 * ```typescript
 * const fallback = createProcedureFallback({
 *   default: { response: { status: 'unavailable' } },
 *   procedures: {
 *     'users.get': { response: { id: 0, name: 'Guest' } },
 *     'config.get': { handler: async (ctx, err) => getDefaultConfig() },
 *   }
 * })
 * ```
 */
export function createProcedureFallback<TDefault = unknown>(config: {
  default?: FallbackConfig<TDefault>
  procedures: Record<string, FallbackConfig<unknown>>
}): Interceptor {
  const { default: defaultConfig, procedures } = config

  // Create fallback interceptors for each configured procedure
  const fallbacks = new Map<string, Interceptor>()

  // Default fallback if provided
  const defaultFallback = defaultConfig
    ? createFallbackInterceptor(defaultConfig)
    : null

  return async (envelope, ctx, next) => {
    const procedure = envelope.procedure

    // Check for exact match
    if (procedures[procedure]) {
      let fallback = fallbacks.get(procedure)
      if (!fallback) {
        fallback = createFallbackInterceptor(procedures[procedure])
        fallbacks.set(procedure, fallback)
      }
      return fallback(envelope, ctx, next)
    }

    // Check for pattern match
    for (const [pattern, procedureConfig] of Object.entries(procedures)) {
      const regex = pattern
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '{{DOUBLE_STAR}}')
        .replace(/\*/g, '[^.]*')
        .replace(/{{DOUBLE_STAR}}/g, '.*')

      if (new RegExp(`^${regex}$`).test(procedure)) {
        let fallback = fallbacks.get(pattern)
        if (!fallback) {
          fallback = createFallbackInterceptor(procedureConfig)
          fallbacks.set(pattern, fallback)
        }
        return fallback(envelope, ctx, next)
      }
    }

    // Use default fallback if available
    if (defaultFallback) {
      return defaultFallback(envelope, ctx, next)
    }

    // No fallback configured for this procedure
    return next()
  }
}

/**
 * Create a conditional fallback that combines circuit breaker awareness
 *
 * Useful when you want fallback behavior only when services are degraded.
 *
 * @example
 * ```typescript
 * const fallback = createCircuitAwareFallback({
 *   response: cachedData,
 *   // Only fallback for infrastructure errors
 *   errorCodes: ['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL_ERROR']
 * })
 * ```
 */
export function createCircuitAwareFallback<TOutput = unknown>(config: {
  response?: TOutput
  handler?: (ctx: Context, error: Error) => TOutput | Promise<TOutput>
  errorCodes?: string[]
}): Interceptor {
  const {
    response,
    handler,
    errorCodes = ['UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL_ERROR'],
  } = config

  return createFallbackInterceptor({
    response,
    handler,
    when: (error) => {
      const code = (error as any).code
      return code && errorCodes.includes(code)
    },
  })
}
