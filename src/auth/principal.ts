export interface AuthPrincipalShape {
  type?: string
  id: string
  roles?: readonly string[]
  scopes?: readonly string[]
  tenantId?: string
  claims?: Readonly<Record<string, unknown>>
}

export type AuthPrincipalInput = string | AuthPrincipalShape

export interface AuthLike {
  authenticated?: boolean
  principal?: AuthPrincipalInput
  principalId?: string
  roles?: readonly string[]
  scopes?: readonly string[]
  tenantId?: string
  claims?: Record<string, unknown>
}

export interface DerivedPolicyPrincipal {
  id: string
  tenantId: string | null
  scopes: string[]
  groups: string[]
  attrs?: Record<string, unknown>
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

export function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    const values: string[] = []
    for (const entry of value) {
      if (typeof entry === 'string') {
        values.push(...entry.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))
      }
    }
    return unique(values)
  }

  if (typeof value === 'string') {
    return unique(value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean))
  }

  return []
}

export function isTypedPrincipal(principal: AuthPrincipalInput | undefined): principal is AuthPrincipalShape {
  return principal !== undefined && typeof principal === 'object' && principal !== null
}

export function getPrincipalId(principal: AuthPrincipalInput | undefined): string | undefined {
  if (!principal) return undefined
  return typeof principal === 'string' ? principal : principal.id
}

export function deriveAuthPrincipalId(auth: Pick<AuthLike, 'principalId' | 'principal' | 'claims'> | undefined): string | undefined {
  if (!auth) return undefined
  return auth.principalId
    ?? getPrincipalId(auth.principal)
    ?? (typeof auth.claims?.sub === 'string' ? auth.claims.sub : undefined)
}

export function getAuthRoles(auth: Pick<AuthLike, 'roles' | 'claims' | 'principal'> | undefined): readonly string[] {
  if (!auth) return []
  if (auth.roles && auth.roles.length > 0) {
    return auth.roles
  }
  if (isTypedPrincipal(auth.principal) && auth.principal.roles && auth.principal.roles.length > 0) {
    return auth.principal.roles
  }
  return Object.freeze(normalizeStringArray(auth.claims?.roles))
}

export function getAuthScopes(auth: Pick<AuthLike, 'scopes' | 'claims' | 'principal'> | undefined): readonly string[] {
  if (!auth) return []
  if (auth.scopes && auth.scopes.length > 0) {
    return auth.scopes
  }
  if (isTypedPrincipal(auth.principal) && auth.principal.scopes && auth.principal.scopes.length > 0) {
    return auth.principal.scopes
  }
  return Object.freeze(unique([
    ...normalizeStringList(auth.claims?.scope),
    ...normalizeStringList(auth.claims?.scopes),
    ...normalizeStringList(auth.claims?.permissions),
  ]))
}

export function getAuthGroups(auth: Pick<AuthLike, 'roles' | 'claims' | 'principal'> | undefined): readonly string[] {
  if (!auth) return []
  const claimsGroups = normalizeStringArray(auth.claims?.groups)
  if (claimsGroups.length > 0) return Object.freeze(claimsGroups)

  const claimsRoles = normalizeStringArray(auth.claims?.roles)
  if (claimsRoles.length > 0) return Object.freeze(claimsRoles)

  const authRoles = getAuthRoles(auth)
  return Object.freeze([...authRoles])
}

export function deriveAuthTenantId(auth: Pick<AuthLike, 'tenantId' | 'principal' | 'claims'> | undefined): string | undefined {
  if (!auth) return undefined
  if (auth.tenantId) return auth.tenantId
  if (isTypedPrincipal(auth.principal) && auth.principal.tenantId) return auth.principal.tenantId
  const claims = auth.claims
  return (
    (typeof claims?.tenantId === 'string' ? claims.tenantId : undefined)
    ?? (typeof claims?.tid === 'string' ? claims.tid : undefined)
    ?? (typeof claims?.org_id === 'string' ? claims.org_id : undefined)
  )
}

export function derivePolicyPrincipalFromAuth(
  auth: AuthLike | undefined,
  options: { preferClaimsSub?: boolean } = {}
): DerivedPolicyPrincipal {
  if (!auth?.authenticated) {
    throw new Error('Cannot derive policy principal from unauthenticated auth context.')
  }

  const claims = auth.claims ?? {}
  const id = options.preferClaimsSub && typeof claims.sub === 'string'
    ? claims.sub
    : deriveAuthPrincipalId(auth)

  if (!id) {
    throw new Error('Could not derive principal id.')
  }

  return {
    id,
    tenantId: deriveAuthTenantId(auth) ?? null,
    scopes: [...getAuthScopes(auth)],
    groups: [...getAuthGroups(auth)],
    attrs: claims,
  }
}
