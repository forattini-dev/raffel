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

  const claims = (auth.claims ?? {}) as Record<string, unknown>

  const id =
    auth.principalId ??
    (typeof auth.principal === 'string' ? auth.principal : undefined) ??
    (typeof claims.sub === 'string' ? claims.sub : undefined)

  if (!id) {
    throw new Error("policy.principal.from === 'oauth2': could not derive principal id (sub).")
  }

  const tenantId =
    (auth.tenantId as string | undefined) ??
    (typeof claims.tid === 'string' ? (claims.tid as string) : undefined) ??
    null

  const scopes: string[] = Array.isArray(auth.scopes)
    ? [...auth.scopes]
    : typeof claims.scope === 'string'
      ? (claims.scope as string).split(/\s+/).filter(Boolean)
      : Array.isArray(claims.scopes)
        ? (claims.scopes as string[])
        : []

  const groups: string[] = Array.isArray(auth.roles)
    ? [...auth.roles]
    : Array.isArray(claims.groups)
      ? (claims.groups as string[])
      : Array.isArray(claims.roles)
        ? (claims.roles as string[])
        : []

  return { id, tenantId, scopes, groups, attrs: claims }
}

export function createOAuth2PrincipalResolver(config: PrincipalConfig): PrincipalResolver {
  if (config.map) {
    const map = config.map
    return async (ctx) => map(ctx.auth, ctx)
  }
  return async (ctx) => defaultMap(ctx)
}
