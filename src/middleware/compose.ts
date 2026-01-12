/**
 * Middleware Composition Helpers
 *
 * Utilities for combining multiple interceptors.
 */

import type { Interceptor, Envelope, Context } from '../types/index.js'

/**
 * Compose multiple interceptors into one (left-to-right execution order)
 *
 * The first interceptor in the list will be the outermost (runs first).
 * The last interceptor will be closest to the handler.
 *
 * @example
 * ```typescript
 * // auth runs first, then validation, then rateLimit
 * const middleware = compose(auth, validation, rateLimit)
 * ```
 *
 * @param interceptors - Interceptors to compose (left-to-right order)
 * @returns A single composed interceptor
 */
export function compose(...interceptors: Interceptor[]): Interceptor {
  if (interceptors.length === 0) {
    return (_envelope, _ctx, next) => next()
  }

  if (interceptors.length === 1) {
    return interceptors[0]
  }

  return (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    // Build chain from right to left
    let chain = next

    for (let i = interceptors.length - 1; i >= 0; i--) {
      const interceptor = interceptors[i]
      const nextInChain = chain
      chain = () => interceptor(envelope, ctx, nextInChain)
    }

    return chain()
  }
}

/**
 * Create a conditional interceptor that only runs if predicate is true
 *
 * @example
 * ```typescript
 * const adminOnly = when(
 *   (envelope) => envelope.procedure.startsWith('admin.'),
 *   requireAdmin
 * )
 * ```
 *
 * @param predicate - Function that returns true if interceptor should run
 * @param interceptor - Interceptor to conditionally run
 * @returns A conditional interceptor
 */
export function when(
  predicate: (envelope: Envelope, ctx: Context) => boolean,
  interceptor: Interceptor
): Interceptor {
  return (envelope, ctx, next) => {
    if (predicate(envelope, ctx)) {
      return interceptor(envelope, ctx, next)
    }
    return next()
  }
}

/**
 * Create an interceptor that only runs for specific procedures
 *
 * @example
 * ```typescript
 * const usersRateLimit = forProcedures(['users.create', 'users.update'], rateLimit)
 * ```
 *
 * @param procedures - List of procedure names to match
 * @param interceptor - Interceptor to run for matching procedures
 * @returns A procedure-filtered interceptor
 */
export function forProcedures(
  procedures: string[],
  interceptor: Interceptor
): Interceptor {
  const procedureSet = new Set(procedures)
  return when((envelope) => procedureSet.has(envelope.procedure), interceptor)
}

/**
 * Create an interceptor that only runs for procedures matching a pattern
 *
 * @example
 * ```typescript
 * const adminRateLimit = forPattern('admin.*', strictRateLimit)
 * ```
 *
 * @param pattern - Glob pattern (supports * and **)
 * @param interceptor - Interceptor to run for matching procedures
 * @returns A pattern-filtered interceptor
 */
export function forPattern(
  pattern: string,
  interceptor: Interceptor
): Interceptor {
  const regex = patternToRegex(pattern)
  return when((envelope) => regex.test(envelope.procedure), interceptor)
}

/**
 * Create an interceptor that skips specific procedures
 *
 * @example
 * ```typescript
 * const authWithExclusions = except(['health.check', 'system.ping'], authMiddleware)
 * ```
 *
 * @param procedures - List of procedure names to skip
 * @param interceptor - Interceptor to run for non-matching procedures
 * @returns An exclusion-filtered interceptor
 */
export function except(
  procedures: string[],
  interceptor: Interceptor
): Interceptor {
  const procedureSet = new Set(procedures)
  return when((envelope) => !procedureSet.has(envelope.procedure), interceptor)
}

/**
 * Create an interceptor that runs a different interceptor based on a condition
 *
 * @example
 * ```typescript
 * const rateLimiter = branch(
 *   (envelope, ctx) => ctx.auth?.authenticated,
 *   authenticatedRateLimit,  // 1000 req/min
 *   anonymousRateLimit       // 100 req/min
 * )
 * ```
 *
 * @param predicate - Function to determine which branch to take
 * @param onTrue - Interceptor to run if predicate is true
 * @param onFalse - Interceptor to run if predicate is false
 * @returns A branching interceptor
 */
export function branch(
  predicate: (envelope: Envelope, ctx: Context) => boolean,
  onTrue: Interceptor,
  onFalse: Interceptor
): Interceptor {
  return (envelope, ctx, next) => {
    if (predicate(envelope, ctx)) {
      return onTrue(envelope, ctx, next)
    }
    return onFalse(envelope, ctx, next)
  }
}

/**
 * Create a no-op interceptor (passthrough)
 *
 * Useful as a placeholder or default value.
 */
export const passthrough: Interceptor = (_envelope, _ctx, next) => next()

/**
 * Convert a glob pattern to regex
 */
function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // Escape special chars
    .replace(/\*\*/g, '{{DOUBLE_STAR}}')    // Temp placeholder for **
    .replace(/\*/g, '[^.]*')                // * = any chars except dot
    .replace(/{{DOUBLE_STAR}}/g, '.*')      // ** = any chars including dot

  return new RegExp(`^${escaped}$`)
}
