/**
 * `ctx.policy.*` helpers — ad-hoc evaluation + resource filtering inside handlers.
 *
 * Attached to ctx by the policy interceptor on the first procedure that uses
 * `.authz()` in a request. Helpers reuse the cached principal and dedup
 * decisions per request by `(action, resource.type, resource.id)` when no
 * explicit evaluation context is supplied.
 */

import type { Context } from '../../types/context.js'
import type { PolicyEnginePort } from '../../ports/outbound/policy-engine.js'
import type { Decision, EvalContext, Principal, Resource } from './types.js'

export interface PolicyCtxHelpers {
  /**
   * Evaluate a single (action, resource) pair using the cached principal.
   * Synchronous when the engine is sync (default driver). Returns `Decision`.
   */
  evaluate(
    action: string,
    resource: Resource,
    context?: EvalContext,
  ): Decision | Promise<Decision>
  /**
   * Filter a list of resources, returning only those for which `engine.evaluate`
   * yields `allowed: true` for the given action. Deduplicated by
   * `(action, resource.type, resource.id)` within a request when no explicit
   * evaluation context is supplied.
   */
  filterResources(
    action: string,
    resources: readonly Resource[],
    context?: EvalContext,
  ): Promise<Resource[]>
}

const CTX_HELPERS_KEY = 'policy' as const
const DEDUP_CACHE_KEY = '__policyEvalCache' as const

interface DedupCache {
  /** Key: `${action}::${resource.type}:${resource.id}` → Decision (cached). */
  decisions: Map<string, Decision>
}

export function attachPolicyHelpers(
  ctx: Context,
  engine: PolicyEnginePort,
  principal: Principal,
): void {
  const bag = ctx as unknown as Record<string, unknown>
  if (bag[CTX_HELPERS_KEY]) return // already attached for this request

  const cache: DedupCache = { decisions: new Map() }
  bag[DEDUP_CACHE_KEY] = cache

  const helpers: PolicyCtxHelpers = {
    async evaluate(action, resource, context) {
      if (context) {
        return engine.evaluate({ principal, action, resource, context })
      }
      const key = `${action}::${resource.type}:${resource.id}`
      const cached = cache.decisions.get(key)
      if (cached) return cached
      const decision = await engine.evaluate({ principal, action, resource })
      cache.decisions.set(key, decision)
      return decision
    },
    async filterResources(action, resources, context) {
      const out: Resource[] = []
      for (const resource of resources) {
        const decision = await helpers.evaluate(action, resource, context)
        if (decision.allowed) out.push(resource)
      }
      return out
    },
  }

  bag[CTX_HELPERS_KEY] = helpers
}
