/**
 * OIDC adapter — same as OAuth2 with OIDC-standard claims.
 *
 * Differences from `oauth2`:
 *   - prefers `groups` claim over `roles`
 *   - reads `email`/`name`/`preferred_username` into attrs
 *
 * Default mapping (in addition to OAuth2):
 *   id        ← claims.sub (preferred)
 *   tenantId  ← claims.tid ?? claims.org_id ?? null
 *   scopes    ← claims.scope (space-split)
 *   groups    ← claims.groups ?? claims.roles
 *   attrs     ← full claims
 */

import type { Context, AuthContext } from '../../../types/context.js'
import { derivePolicyPrincipalFromAuth } from '../../../auth/principal.js'
import type { Principal, PrincipalConfig } from '../types.js'
import type { PrincipalResolver } from './index.js'

function defaultMap(ctx: Context): Principal {
  const auth = ctx.auth as AuthContext | undefined
  if (!auth?.authenticated) {
    throw new Error(
      "policy.principal.from === 'oidc': ctx.auth.authenticated is false — " +
        'configure the OIDC interceptor before the policy interceptor.',
    )
  }

  try {
    return derivePolicyPrincipalFromAuth(auth, { preferClaimsSub: true })
  } catch {
    throw new Error("policy.principal.from === 'oidc': could not derive principal id (sub).")
  }
}

export function createOidcPrincipalResolver(config: PrincipalConfig): PrincipalResolver {
  if (config.map) {
    const map = config.map
    return async (ctx) => map(ctx.auth, ctx)
  }
  return async (ctx) => defaultMap(ctx)
}
