/**
 * Policy bridges wired into the server lifecycle.
 *
 * Two protocol-bound authorization surfaces that evaluate the policy
 * engine outside the standard procedure interceptor pipeline:
 *
 *   - `createGraphQLPolicyBridge` — per-field authorization for GraphQL
 *     resolvers (`authz` / `authorize` blocks on a GraphQL resource).
 *   - `createChannelCoLocatedPolicyEnforcer` — subscribe-time gate for
 *     WebSocket channels carrying co-located policies.
 *
 * Both are extracted from `builder.ts` so the policy-evaluation logic
 * lives next to the rest of the policy code instead of inflating the
 * already-large server builder.
 */

import type { Context } from '../../types/context.js'
import type { GraphQLPolicyBridge } from '../../graphql/resource.js'
import type { PolicyBootstrap } from '../../middleware/policy/bootstrap.js'
import type { PolicyEnginePort } from '../../ports/outbound/policy-engine.js'
import type { Policy } from '../../middleware/policy/types.js'

/**
 * Build the GraphQL field-authorization bridge. Returns `undefined`
 * when no policy bootstrap is configured (GraphQL auth is then a
 * no-op and the resolver runs ungated).
 */
export function createGraphQLPolicyBridge(
  bootstrap: PolicyBootstrap | null,
): GraphQLPolicyBridge | undefined {
  if (!bootstrap) return undefined
  const resolvedBootstrap = bootstrap

  async function evaluateResources(
    ctx: Context,
    action: string,
    rawResource: import('../../middleware/policy/types.js').Resource | import('../../middleware/policy/types.js').Resource[] | null,
    mode: 'all' | 'any' | undefined,
  ) {
    const principal = await resolvedBootstrap.resolvePrincipal(ctx)
    const resources = rawResource == null
      ? [{ type: '*', id: '*', tenantId: principal.tenantId }]
      : Array.isArray(rawResource)
        ? [...rawResource]
        : [rawResource]
    if (resources.length === 0) {
      resources.push({ type: '*', id: '*', tenantId: principal.tenantId })
    }
    const protocol = (ctx as { protocol?: unknown }).protocol
    const protocolValue = typeof protocol === 'string' ? protocol : 'graphql'

    let lastDecision: Awaited<ReturnType<PolicyEnginePort['evaluate']>> | undefined
    if (mode === 'any') {
      for (const resource of resources) {
        const decision = await resolvedBootstrap.engine.evaluate({ principal, action, resource, protocol: protocolValue })
        lastDecision = decision
        if (decision.allowed) return decision
      }
      return lastDecision!
    }

    for (const resource of resources) {
      const decision = await resolvedBootstrap.engine.evaluate({ principal, action, resource, protocol: protocolValue })
      lastDecision = decision
      if (!decision.allowed) return decision
    }
    return lastDecision!
  }

  return {
    defaultMode: resolvedBootstrap.defaultMode,
    async evaluate(ctx, authz, value, args, parent) {
      const rawResource = await authz.resource(value, args, ctx, parent)
      return evaluateResources(ctx, authz.action, rawResource, authz.mode)
    },
    async evaluateOperation(ctx, authorization) {
      return evaluateResources(ctx, authorization.action, authorization.resource, authorization.mode)
    },
  }
}

export type ChannelCoLocatedPolicyEnforcer = (
  channelName: string,
  policies: readonly Policy[] | undefined,
  ctx: Context,
) => Promise<boolean>

/**
 * Build the subscribe-time enforcer for WebSocket channels carrying
 * co-located policies. Returns `undefined` when no policy bootstrap
 * is configured.
 *
 * The channel's co-located policies are already loaded into the engine
 * at discovery time (`registerChannel` →
 * `buildAuthzInterceptorsForOperation`), so the enforcer does NOT
 * re-register them here — it only evaluates. (Re-registering at
 * subscribe time would feed the per-load co-located accumulator
 * without ever flushing it, polluting accumulator state on every
 * subscribe; the engine entry is already present from the load.)
 */
export function createChannelCoLocatedPolicyEnforcer(
  bootstrap: PolicyBootstrap | null,
): ChannelCoLocatedPolicyEnforcer | undefined {
  if (!bootstrap) return undefined

  return async (channelName, _policies, ctx) => {
    const principal = await bootstrap.resolvePrincipal(ctx)
    const ctxProtocol = (ctx as { protocol?: unknown }).protocol
    const decision = await bootstrap.engine.evaluate({
      principal,
      action: channelName,
      resource: { type: 'channel', id: channelName, tenantId: principal.tenantId },
      protocol: typeof ctxProtocol === 'string' ? ctxProtocol : 'websocket',
    })
    return decision.allowed
  }
}
