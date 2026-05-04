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

interface SessionLike {
  data?: {
    user?: Partial<Principal> & { id?: string }
  } & Record<string, unknown>
}

function defaultMap(ctx: Context): Principal {
  const session = (ctx as unknown as { session?: SessionLike }).session
  const user = session?.data?.user
  if (!user || typeof user.id !== 'string') {
    throw new Error(
      "policy.principal.from === 'session': ctx.session.data.user.id missing — " +
        'login the user or supply `map` to derive the principal differently.',
    )
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
