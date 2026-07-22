import { createHash } from 'node:crypto'

import { deriveAuthPrincipalId, deriveAuthTenantId } from '../auth/principal.js'
import type { Context, Envelope } from '../types/index.js'

export type CacheIdentityScope = 'auto' | 'public' | 'tenant' | 'principal'

function stableJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, (_key, current) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return current
      return Object.fromEntries(
        Object.entries(current as Record<string, unknown>).sort(([left], [right]) =>
          left.localeCompare(right)
        )
      )
    })
  } catch {
    return undefined
  }
}

function identityFor(ctx: Context, scope: CacheIdentityScope): string | undefined {
  if (scope === 'public') return 'public'
  const principal = deriveAuthPrincipalId(ctx.auth)
  const tenant = deriveAuthTenantId(ctx.auth)
  if (scope === 'tenant') return tenant ? `tenant:${tenant}` : undefined
  if (scope === 'principal') return principal
    ? `tenant:${tenant ?? '-'}:principal:${principal}`
    : undefined
  if (!ctx.auth.authenticated) return 'anonymous'
  return principal ? `tenant:${tenant ?? '-'}:principal:${principal}` : undefined
}

export function procedureCacheKey(
  envelope: Envelope,
  ctx: Context,
  options: { scope?: CacheIdentityScope; version?: string } = {}
): string | undefined {
  return procedureCacheKeyFor(envelope.procedure, envelope.payload, ctx, options)
}

export function procedureCacheKeyFor(
  procedure: string,
  input: unknown,
  ctx: Context,
  options: { scope?: CacheIdentityScope; version?: string } = {},
): string | undefined {
  const payload = stableJson(input)
  const identity = identityFor(ctx, options.scope ?? 'auto')
  if (payload === undefined || identity === undefined) return undefined
  const digest = createHash('sha256').update(payload).digest('base64url')
  return `procedure:${procedure}:v${options.version ?? '1'}:${identity}:${digest}`
}
