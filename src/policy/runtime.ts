/**
 * Runtime helpers for contract-bound policy metadata.
 */

import { RaffelError } from '../core/error.js'
import { createRateLimitInterceptor } from '../middleware/interceptors/rate-limit.js'
import { createTimeoutInterceptor } from '../middleware/interceptors/timeout.js'
import type { Context, Envelope, Interceptor } from '../types/index.js'
import { getAuthRoles, getAuthScopes, getPrincipalId } from '../types/index.js'
import type {
  ContractAuthPolicy,
  ContractPolicies,
  ContractRateLimitPolicy,
} from '../types/policies.js'
import { normalizeContractPolicies } from '../types/policies.js'

function createContractAuthPolicyInterceptor(policy: ContractAuthPolicy): Interceptor {
  const mode = policy.mode ?? 'required'
  const requiredRoles = policy.roles ?? []
  const requiredScopes = policy.scopes ?? []

  return async (_envelope, ctx, next) => {
    const auth = ctx.auth
    const isAuthenticated = auth?.authenticated === true && typeof auth.principal === 'string'

    if (!isAuthenticated) {
      if (mode === 'optional') {
        return next()
      }
      throw new RaffelError('UNAUTHENTICATED', 'Authentication required')
    }

    if (requiredRoles.length > 0) {
      const roles = [...getAuthRoles(ctx.auth)]
      const allowed = requiredRoles.some((role) => roles.includes(role))
      if (!allowed) {
        throw new RaffelError('PERMISSION_DENIED', 'Required role policy not satisfied', {
          requiredRoles,
          roles,
        })
      }
    }

    if (requiredScopes.length > 0) {
      const scopes = [...getAuthScopes(ctx.auth)]
      const allowed = requiredScopes.some((scope) => scopes.includes(scope))
      if (!allowed) {
        throw new RaffelError('PERMISSION_DENIED', 'Required scope policy not satisfied', {
          requiredScopes,
          scopes,
        })
      }
    }

    return next()
  }
}

function createRateLimitKeyGenerator(
  policy: ContractRateLimitPolicy
): ((envelope: Envelope, ctx: Context) => string) | undefined {
  switch (policy.key) {
    case 'user':
      return (_envelope, ctx) => getPrincipalId(ctx.auth?.principal) ?? `req:${ctx.requestId}`
    case 'client':
      return (envelope, ctx) =>
        envelope.metadata['x-client-id']
        || envelope.metadata['x-client-ip']
        || envelope.metadata['x-forwarded-for']
        || getPrincipalId(ctx.auth?.principal)
        || `req:${ctx.requestId}`
    case 'request':
      return (_envelope, ctx) => `req:${ctx.requestId}`
    default:
      return undefined
  }
}

export function createPolicyInterceptors(
  policies?: ContractPolicies
): Interceptor[] {
  const normalized = normalizeContractPolicies(policies)
  if (!normalized) return []

  const interceptors: Interceptor[] = []

  if (normalized.auth) {
    interceptors.push(createContractAuthPolicyInterceptor(normalized.auth))
  }

  if (normalized.timeout) {
    interceptors.push(createTimeoutInterceptor({ defaultMs: normalized.timeout.timeoutMs }))
  }

  if (normalized.rateLimit) {
    interceptors.push(
      (() => {
        const keyGenerator = createRateLimitKeyGenerator(normalized.rateLimit)
        return createRateLimitInterceptor({
          windowMs: normalized.rateLimit.windowMs,
          maxRequests: normalized.rateLimit.maxRequests,
          ...(keyGenerator && { keyGenerator }),
        })
      })()
    )
  }

  return interceptors
}
