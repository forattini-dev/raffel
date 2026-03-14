/**
 * Guard Interceptor Factory
 *
 * Protocol-agnostic guard interceptor that transforms a boolean check into
 * an interceptor. Unlike `src/http/guards.ts` which is HTTP-only, this works
 * across all transports (WebSocket, TCP, JSON-RPC, gRPC).
 *
 * @example
 * ```typescript
 * // Simple role check
 * const requireAdmin = createGuardInterceptor(
 *   (input, ctx) => ctx.auth?.hasRole('admin') ?? false,
 *   { code: 'FORBIDDEN', message: 'Admin only' }
 * )
 *
 * // Use on a specific procedure
 * server.procedure('users.delete').use(requireAdmin).handler(...)
 *
 * // Use on an entire module
 * const adminModule = createRouterModule()
 * adminModule.use(requireAdmin)
 * ```
 */

import type { Interceptor, Envelope, Context } from '../../types/index.js'
import { RaffelError } from '../../core/router.js'

/**
 * Guard check function
 *
 * Receives the input payload and context. Return true to allow, false to deny.
 */
export type GuardCheckFn = (
  input: unknown,
  ctx: Context
) => boolean | Promise<boolean>

/**
 * Guard error options
 */
export interface GuardErrorOptions {
  /** Error code (default: 'FORBIDDEN') */
  code?: string
  /** Error message (default: 'Access denied') */
  message?: string
}

/**
 * Create a protocol-agnostic guard interceptor
 *
 * Transforms a boolean check function into an interceptor that throws
 * a RaffelError when the check fails. Works with all transports.
 *
 * @param check - Function that returns true to allow, false to deny
 * @param options - Error code and message for denied requests
 * @returns Interceptor
 */
export function createGuardInterceptor(
  check: GuardCheckFn,
  options: GuardErrorOptions = {}
): Interceptor {
  const { code = 'FORBIDDEN', message = 'Access denied' } = options

  return async (envelope: Envelope, ctx: Context, next: () => Promise<unknown>) => {
    const allowed = await check(envelope.payload, ctx)
    if (!allowed) {
      throw new RaffelError(code, message)
    }
    return next()
  }
}
