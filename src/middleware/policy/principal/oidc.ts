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

  const claims = (auth.claims ?? {}) as Record<string, unknown>

  const id =
    (typeof claims.sub === 'string' ? claims.sub : undefined) ??
    auth.principalId ??
    (typeof auth.principal === 'string' ? auth.principal : undefined)

  if (!id) {
    throw new Error("policy.principal.from === 'oidc': could not derive principal id (sub).")
  }

  const tenantId =
    (auth.tenantId as string | undefined) ??
    (typeof claims.tid === 'string' ? (claims.tid as string) : undefined) ??
    (typeof claims.org_id === 'string' ? (claims.org_id as string) : undefined) ??
    null

  const scopes: string[] = Array.isArray(auth.scopes)
    ? [...auth.scopes]
    : typeof claims.scope === 'string'
      ? (claims.scope as string).split(/\s+/).filter(Boolean)
      : []

  const groups: string[] = Array.isArray(claims.groups)
    ? (claims.groups as string[])
    : Array.isArray(claims.roles)
      ? (claims.roles as string[])
      : Array.isArray(auth.roles)
        ? [...auth.roles]
        : []

  return { id, tenantId, scopes, groups, attrs: claims }
}

export function createOidcPrincipalResolver(config: PrincipalConfig): PrincipalResolver {
  if (config.map) {
    const map = config.map
    return async (ctx) => map(ctx.auth, ctx)
  }
  return async (ctx) => defaultMap(ctx)
}
