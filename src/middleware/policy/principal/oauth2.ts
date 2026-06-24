/**
 * OAuth2 adapter — derives `Principal` from `ctx.auth` populated by the
 * OAuth2 interceptor (`src/middleware/auth/oauth2.ts`).
 *
 * Default mapping:
 *   id        ← ctx.auth.principalId ?? ctx.auth.principal (when string)
 *               ?? ctx.auth.claims.sub
 *   tenantId  ← ctx.auth.tenantId ?? ctx.auth.claims.tid (Azure AD style) ?? null
 *   scopes    ← ctx.auth.scopes ?? split(ctx.auth.claims.scope, ' ')
 *   groups    ← ctx.auth.roles ?? ctx.auth.claims.groups
 *   attrs     ← ctx.auth.claims (full payload)
 *
 * Override via `principal: { from: 'oauth2', map: (rawAuth, ctx) => Principal }`.
 */

import type { Context, AuthContext } from '../../../types/context.js'
import { derivePolicyPrincipalFromAuth } from '../../../auth/principal.js'
import type { Principal, PrincipalConfig } from '../types.js'
import type { PrincipalResolver } from './index.js'
import { ANONYMOUS_PRINCIPAL } from './anonymous.js'

function defaultMap(ctx: Context): Principal {
  const auth = ctx.auth as AuthContext | undefined
  if (!auth?.authenticated) {
    // Unauthenticated request → anonymous principal. Policies that want to
    // restrict to authenticated callers must filter via their own patterns
    // (e.g. explicit allow rules or `defaultMode: 'deny'`). Throwing here
    // would surface as HTTP 500 INTERNAL_ERROR and break K8s probes against
    // `meta.auth: 'none'` routes that still carry co-located policies.
    return ANONYMOUS_PRINCIPAL
  }

  try {
    return derivePolicyPrincipalFromAuth(auth)
  } catch {
    throw new Error("policy.principal.from === 'oauth2': could not derive principal id (sub).")
  }
}

export function createOAuth2PrincipalResolver(config: PrincipalConfig): PrincipalResolver {
  if (config.map) {
    const map = config.map
    return async (ctx) => map(ctx.auth, ctx)
  }
  return async (ctx) => defaultMap(ctx)
}
