/**
 * Retry Interceptor
 *
 * Protocol-agnostic retry logic with multiple backoff strategies.
 * Handles transient failures gracefully.
 *
 * Strategies:
 * - `linear`: delay grows linearly (100, 200, 300...)
 * - `exponential`: delay doubles each attempt (100, 200, 400...)
 * - `decorrelated`: AWS-style jitter, prevents thundering herd
 */

import type { Interceptor, Envelope, Context } from '../../types/index.js'
import type { RetryConfig, BackoffStrategy, RetryEventContext } from '../types.js'

/**
 * Default retryable error codes
 */
const DEFAULT_RETRYABLE_CODES = [
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'RESOURCE_EXHAUSTED',
  'ABORTED',
  'INTERNAL_ERROR',
  'RATE_LIMITED',
]

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Parse Retry-After header value
 *
 * Supports two formats:
 * - Seconds: "120" → 120000ms
 * - HTTP-date: "Wed, 21 Oct 2015 07:28:00 GMT" → ms until that time
 *
 * @returns Delay in milliseconds, or undefined if invalid
 */
export function parseRetryAfter(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined
  }

  // Already a number (seconds)
  if (typeof value === 'number') {
    return value >= 0 ? value * 1000 : undefined
  }

  // Try parsing as seconds first
  const seconds = parseInt(value, 10)
  if (!isNaN(seconds) && seconds >= 0) {
    return seconds * 1000
  }

  // Try parsing as HTTP-date
  const date = Date.parse(value)
  if (!isNaN(date)) {
    const delay = date - Date.now()
    return delay > 0 ? delay : undefined
  }

  return undefined
}

/**
 * Calculate delay based on backoff strategy
 *
 * @param attempt - Current attempt number (1-based)
 * @param baseDelay - Initial delay in ms
 * @param maxDelay - Maximum delay cap in ms
 * @param multiplier - Multiplier for linear/exponential
 * @param strategy - Backoff strategy
 * @param jitter - Whether to add ±25% randomness
 * @param prevDelay - Previous delay (for decorrelated strategy)
 */
function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  multiplier: number,
  strategy: BackoffStrategy,
  jitter: boolean,
  prevDelay?: number
): number {
  let delay: number

  switch (strategy) {
    case 'linear':
      // Linear: baseDelay * attempt
      delay = baseDelay * attempt
      break

    case 'decorrelated':
      // AWS-style decorrelated jitter
      // random between baseDelay and (previous delay * 3)
      const previousDelay = prevDelay ?? baseDelay
      const maxRandom = Math.min(previousDelay * 3, maxDelay)
      delay = baseDelay + Math.random() * (maxRandom - baseDelay)
      break

    case 'exponential':
    default:
      // Exponential: baseDelay * (multiplier ^ (attempt - 1))
      delay = baseDelay * Math.pow(multiplier, attempt - 1)
      break
  }

  // Cap at max delay
  delay = Math.min(delay, maxDelay)

  // Add jitter (±25%) - skip for decorrelated as it already has randomness
  if (jitter && strategy !== 'decorrelated') {
    const jitterRange = delay * 0.25
    const jitterAmount = Math.random() * jitterRange * 2 - jitterRange
    delay += jitterAmount
  }

  return Math.max(0, Math.floor(delay))
}

/**
 * Check if an error is retryable
 */
function isRetryable(
  error: Error,
  retryableCodes: string[],
  shouldRetry?: (error: Error, attempt: number) => boolean,
  attempt: number = 1
): boolean {
  // Custom predicate takes precedence
  if (shouldRetry) {
    return shouldRetry(error, attempt)
  }

  // Check error code
  const code = (error as any).code
  if (code && retryableCodes.includes(code)) {
    return true
  }

  // Check for network errors
  if (error.message.includes('ECONNREFUSED') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('socket hang up')) {
    return true
  }

  return false
}

/**
 * Create a retry interceptor
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const retry = createRetryInterceptor()
 *
 * // Custom retry configuration
 * const retry = createRetryInterceptor({
 *   maxAttempts: 5,
 *   initialDelayMs: 200,
 *   maxDelayMs: 5000,
 *   backoffStrategy: 'exponential',
 * })
 *
 * // Decorrelated jitter (AWS-style, best for preventing thundering herd)
 * const retry = createRetryInterceptor({
 *   backoffStrategy: 'decorrelated',
 *   maxAttempts: 5,
 * })
 *
 * // With retry hook for observability
 * const retry = createRetryInterceptor({
 *   onRetry: ({ attempt, error, delayMs, procedure }) => {
 *     logger.warn({ attempt, procedure, delayMs }, `Retrying: ${error.message}`)
 *   }
 * })
 *
 * // Custom retry predicate
 * const retry = createRetryInterceptor({
 *   shouldRetry: (error, attempt) => {
 *     // Only retry specific errors
 *     return error.code === 'UNAVAILABLE' && attempt < 3
 *   }
 * })
 *
 * server.use(retry)
 * ```
 */
export function createRetryInterceptor(config: RetryConfig = {}): Interceptor {
  const {
    maxAttempts = 3,
    initialDelayMs = 100,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    backoffStrategy = 'exponential',
    jitter = true,
    retryableCodes = DEFAULT_RETRYABLE_CODES,
    shouldRetry,
    respectRetryAfter = true,
    onRetry,
  } = config

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    let lastError: Error | undefined
    let attempt = 0
    let prevDelay: number | undefined

    while (attempt < maxAttempts) {
      attempt++

      try {
        // Check if request was cancelled
        if (ctx.signal?.aborted) {
          throw new Error('Request was cancelled')
        }

        // Check if deadline exceeded
        if (ctx.deadline && Date.now() >= ctx.deadline) {
          throw new Error('Request deadline exceeded')
        }

        return await next()
      } catch (error) {
        lastError = error as Error

        // Check if we should retry
        if (attempt >= maxAttempts) {
          break
        }

        if (!isRetryable(lastError, retryableCodes, shouldRetry, attempt)) {
          break
        }

        // Calculate delay - check for Retry-After first
        let delay: number | undefined

        if (respectRetryAfter) {
          // Check for Retry-After in error details, headers, or metadata
          const retryAfterValue =
            (lastError as any).details?.retryAfter ??
            (lastError as any).retryAfter ??
            (lastError as any).headers?.['retry-after'] ??
            envelope.metadata['retry-after']

          delay = parseRetryAfter(retryAfterValue)
          if (delay !== undefined) {
            delay = Math.min(delay, maxDelayMs)
          }
        }

        // Fall back to calculated delay if no Retry-After
        if (delay === undefined) {
          delay = calculateDelay(
            attempt,
            initialDelayMs,
            maxDelayMs,
            backoffMultiplier,
            backoffStrategy,
            jitter,
            prevDelay
          )
        }

        prevDelay = delay

        // Check if delay would exceed deadline
        if (ctx.deadline && Date.now() + delay >= ctx.deadline) {
          break
        }

        // Add retry info to metadata
        envelope.metadata['x-retry-attempt'] = attempt.toString()
        envelope.metadata['x-retry-delay'] = delay.toString()

        // Call onRetry hook if provided
        if (onRetry) {
          const retryCtx: RetryEventContext = {
            attempt,
            maxAttempts,
            error: lastError,
            delayMs: delay,
            procedure: envelope.procedure,
            requestId: ctx.requestId,
          }
          await Promise.resolve(onRetry(retryCtx))
        }

        // Wait before retrying
        await sleep(delay)
      }
    }

    // All retries exhausted
    if (lastError) {
      // Add final retry info
      ;(lastError as any).retryAttempts = attempt
      throw lastError
    }

    // This shouldn't happen, but just in case
    throw new Error('Retry logic failed unexpectedly')
  }
}

/**
 * Create a retry interceptor for specific procedures
 *
 * @example
 * ```typescript
 * const retry = createSelectiveRetryInterceptor({
 *   procedures: ['external.api.*', 'payment.*'],
 *   config: { maxAttempts: 5 }
 * })
 * ```
 */
export function createSelectiveRetryInterceptor(options: {
  procedures: string[]
  config?: RetryConfig
}): Interceptor {
  const { procedures, config = {} } = options
  const retryInterceptor = createRetryInterceptor(config)

  // Convert patterns to regex
  const patterns = procedures.map((pattern) => {
    const regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{DOUBLE_STAR}}')
      .replace(/\*/g, '[^.]*')
      .replace(/{{DOUBLE_STAR}}/g, '.*')

    return new RegExp(`^${regex}$`)
  })

  return async (envelope, ctx, next) => {
    const procedure = envelope.procedure

    // Check if this procedure should be retried
    const shouldRetry = patterns.some((pattern) => pattern.test(procedure))

    if (shouldRetry) {
      return retryInterceptor(envelope, ctx, next)
    }

    return next()
  }
}
