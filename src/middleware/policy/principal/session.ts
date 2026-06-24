/**
 * Session adapter — reads `ctx.session.data.user` and maps to `Principal`.
 *
 * Default expected shape on the session bag:
 *   ctx.session.data.user = { id, tenantId, scopes, groups, attrs? }
 *
 * Override via `principal: { from: 'session', map: (raw, ctx) => Principal }`.
 */

import type { Context } from '../../../types/context.js'
import type { Principal, PrincipalConfig } from '../types.js'
import type { PrincipalResolver } from './index.js'
import { ANONYMOUS_PRINCIPAL } from './anonymous.js'

interface SessionLike {
  data?: {
    user?: Partial<Principal> & { id?: string }
  } & Record<string, unknown>
}

function defaultMap(ctx: Context): Principal {
  const session = (ctx as unknown as { session?: SessionLike }).session
  const user = session?.data?.user
  if (!user || typeof user.id !== 'string') {
    // No logged-in user → anonymous principal. Co-located policies on a
    // `meta.auth: 'none'` route (e.g. /health/live) used to crash here with a
    // plain Error that bubbled all the way up as HTTP 500 INTERNAL_ERROR,
    // killing the pod after the K8s probe failed. Returning the anonymous
    // principal lets the engine evaluate (or skip, when the route is marked
    // public by discovery-utils) instead of crashing the request.
    return ANONYMOUS_PRINCIPAL
  }
  return {
    id: user.id,
    tenantId: user.tenantId ?? null,
    scopes: Array.isArray(user.scopes) ? [...user.scopes] : [],
    groups: Array.isArray(user.groups) ? [...user.groups] : [],
    attrs: user.attrs,
  }
}

export function createSessionPrincipalResolver(config: PrincipalConfig): PrincipalResolver {
  if (config.map) {
    const map = config.map
    return async (ctx) => {
      const session = (ctx as unknown as { session?: SessionLike }).session
      return map(session?.data?.user, ctx)
    }
  }
  return async (ctx) => defaultMap(ctx)
}
