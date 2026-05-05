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

function defaultMap(ctx: Context): Principal {
  const auth = ctx.auth as AuthContext | undefined
  if (!auth?.authenticated) {
    throw new Error(
      "policy.principal.from === 'oauth2': ctx.auth.authenticated is false — " +
        'configure the OAuth2 interceptor before the policy interceptor.',
    )
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
