/**
 * Request ID Interceptor
 *
 * Ensures every request has a unique ID for tracing and debugging.
 * Propagates IDs from incoming requests or generates new ones.
 */

import { sid } from '../../utils/id/index.js'
import type { Interceptor, Envelope, Context } from '../../types/index.js'
import type { RequestIdConfig } from '../types.js'

/**
 * Create a request ID interceptor
 *
 * This interceptor ensures every request has a unique ID that can be used
 * for distributed tracing, logging, and debugging.
 *
 * @example
 * ```typescript
 * // Basic usage - generates nanoid for each request
 * const requestId = createRequestIdInterceptor()
 *
 * // Custom generator
 * const requestId = createRequestIdInterceptor({
 *   generator: () => `req_${Date.now()}_${Math.random().toString(36).slice(2)}`,
 * })
 *
 * // Propagate from incoming metadata
 * const requestId = createRequestIdInterceptor({
 *   propagate: true,
 *   metadataKey: 'x-request-id',
 * })
 *
 * server.use(requestId)
 * ```
 */
export function createRequestIdInterceptor(config: RequestIdConfig = {}): Interceptor {
  const {
    generator = () => sid(),
    propagate = true,
    metadataKey = 'x-request-id',
  } = config

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    let requestId: string

    // Try to propagate from incoming metadata
    if (propagate) {
      const incomingId = envelope.metadata[metadataKey] || envelope.metadata[metadataKey.toLowerCase()]

      if (incomingId) {
        requestId = incomingId
      } else {
        requestId = generator()
      }
    } else {
      requestId = generator()
    }

    // Update context with the request ID
    // Note: Context is immutable, but we can update the requestId since
    // it's the same request flow
    ;(ctx as any).requestId = requestId

    // Update tracing context
    if (ctx.tracing) {
      ;(ctx.tracing as any).traceId = ctx.tracing.traceId || requestId
      ;(ctx.tracing as any).spanId = requestId
    }

    // Store in envelope metadata for propagation
    envelope.metadata[metadataKey] = requestId

    // Also set the trace ID for distributed tracing
    if (!envelope.metadata['x-trace-id']) {
      envelope.metadata['x-trace-id'] = ctx.tracing?.traceId || requestId
    }

    return next()
  }
}

/**
 * Create a request ID interceptor with prefix
 *
 * Useful for identifying requests from specific services or environments.
 *
 * @example
 * ```typescript
 * const requestId = createPrefixedRequestIdInterceptor('api')
 * // Generates IDs like: api_V1StGXR8_Z5jdHi6B-myT
 * ```
 */
export function createPrefixedRequestIdInterceptor(
  prefix: string,
  config: Omit<RequestIdConfig, 'generator'> = {}
): Interceptor {
  return createRequestIdInterceptor({
    ...config,
    generator: () => `${prefix}_${sid()}`,
  })
}

/**
 * Create a request ID interceptor with correlation ID support
 *
 * Supports both request ID (per-request) and correlation ID (per-user-action).
 *
 * @example
 * ```typescript
 * const requestId = createCorrelatedRequestIdInterceptor({
 *   correlationKey: 'x-correlation-id',
 * })
 * ```
 */
export function createCorrelatedRequestIdInterceptor(config: {
  correlationKey?: string
  requestIdKey?: string
} = {}): Interceptor {
  const {
    correlationKey = 'x-correlation-id',
    requestIdKey = 'x-request-id',
  } = config

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    // Generate or propagate request ID (always unique per request)
    const requestId = envelope.metadata[requestIdKey] || sid()

    // Propagate or generate correlation ID (shared across related requests)
    const correlationId = envelope.metadata[correlationKey] || requestId

    // Update context
    ;(ctx as any).requestId = requestId

    // Update tracing with correlation ID as trace ID
    if (ctx.tracing) {
      ;(ctx.tracing as any).traceId = correlationId
      ;(ctx.tracing as any).spanId = requestId
    }

    // Store in metadata for propagation
    envelope.metadata[requestIdKey] = requestId
    envelope.metadata[correlationKey] = correlationId

    return next()
  }
}
