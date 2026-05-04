import { describe, it, expect } from 'vitest'
import {
  createPrincipalResolver,
  createSessionPrincipalResolver,
  createOAuth2PrincipalResolver,
  createOidcPrincipalResolver,
} from '../../src/middleware/policy/principal/index.js'
import type { Context } from '../../src/types/context.js'

function fakeCtx(extras: Record<string, unknown>): Context {
  return { auth: { authenticated: false } as any, ...extras } as Context
}

describe('principal adapters — session', () => {
  it('default mapping reads ctx.session.data.user', async () => {
    const resolver = createSessionPrincipalResolver({ from: 'session' })
    const ctx = fakeCtx({
      session: {
        data: {
          user: {
            id: 's1',
            tenantId: 't1',
            scopes: ['lead.read'],
            groups: ['admins'],
            attrs: { role: 'manager' },
          },
        },
      },
    })

    const principal = await resolver(ctx)
    expect(principal).toEqual({
      id: 's1',
      tenantId: 't1',
      scopes: ['lead.read'],
      groups: ['admins'],
      attrs: { role: 'manager' },
    })
  })

  it('throws helpful error when session.data.user.id missing', async () => {
    const resolver = createSessionPrincipalResolver({ from: 'session' })
    const ctx = fakeCtx({ session: { data: {} } })

    await expect(resolver(ctx)).rejects.toThrow(/ctx\.session\.data\.user\.id missing/)
  })

  it('throws when no session at all', async () => {
    const resolver = createSessionPrincipalResolver({ from: 'session' })
    const ctx = fakeCtx({})
    await expect(resolver(ctx)).rejects.toThrow()
  })

  it('custom map override', async () => {
    const resolver = createSessionPrincipalResolver({
      from: 'session',
      map: (_raw, ctx) => ({
        id: 'override',
        tenantId: null,
        scopes: ['*'],
        groups: [],
      }),
    })
    const principal = await resolver(fakeCtx({ session: { data: { user: { id: 'ignored' } } } }))
    expect(principal.id).toBe('override')
  })

  it('defaults missing scopes/groups to empty arrays', async () => {
    const resolver = createSessionPrincipalResolver({ from: 'session' })
    const principal = await resolver(
      fakeCtx({ session: { data: { user: { id: 's1' } } } }),
    )
    expect(principal.scopes).toEqual([])
    expect(principal.groups).toEqual([])
    expect(principal.tenantId).toBeNull()
  })
})

describe('principal adapters — oauth2', () => {
  it('reads from ctx.auth.principalId + claims', async () => {
    const resolver = createOAuth2PrincipalResolver({ from: 'oauth2' })
    const ctx = fakeCtx({
      auth: {
        authenticated: true,
        principalId: 's1',
        tenantId: 't1',
        claims: {
          sub: 's1',
          scope: 'lead.read lead.write',
          groups: ['admins', 'sellers'],
        },
      },
    })
    const principal = await resolver(ctx)
    expect(principal.id).toBe('s1')
    expect(principal.tenantId).toBe('t1')
    expect(principal.scopes).toEqual(['lead.read', 'lead.write'])
    expect(principal.groups).toEqual(['admins', 'sellers'])
  })

  it('falls back to claims.sub for id', async () => {
    const resolver = createOAuth2PrincipalResolver({ from: 'oauth2' })
    const principal = await resolver(
      fakeCtx({
        auth: {
          authenticated: true,
          claims: { sub: 'jwt-sub-id' },
        },
      }),
    )
    expect(principal.id).toBe('jwt-sub-id')
  })

  it('reads claims.tid as tenantId (Azure AD style)', async () => {
    const resolver = createOAuth2PrincipalResolver({ from: 'oauth2' })
    const principal = await resolver(
      fakeCtx({
        auth: {
          authenticated: true,
          claims: { sub: 's1', tid: 'tenant-from-jwt' },
        },
      }),
    )
    expect(principal.tenantId).toBe('tenant-from-jwt')
  })

  it('throws when not authenticated', async () => {
    const resolver = createOAuth2PrincipalResolver({ from: 'oauth2' })
    await expect(resolver(fakeCtx({ auth: { authenticated: false } }))).rejects.toThrow(
      /authenticated is false/,
    )
  })

  it('throws when no id derivable', async () => {
    const resolver = createOAuth2PrincipalResolver({ from: 'oauth2' })
    await expect(
      resolver(fakeCtx({ auth: { authenticated: true, claims: {} } })),
    ).rejects.toThrow(/derive principal id/)
  })

  it('exposes claims as attrs', async () => {
    const resolver = createOAuth2PrincipalResolver({ from: 'oauth2' })
    const principal = await resolver(
      fakeCtx({
        auth: {
          authenticated: true,
          claims: { sub: 's1', email: 'a@b.com', custom: 'x' },
        },
      }),
    )
    expect(principal.attrs).toMatchObject({ sub: 's1', email: 'a@b.com', custom: 'x' })
  })
})

describe('principal adapters — oidc', () => {
  it('prefers claims.sub for id', async () => {
    const resolver = createOidcPrincipalResolver({ from: 'oidc' })
    const principal = await resolver(
      fakeCtx({
        auth: {
          authenticated: true,
          principalId: 'fallback',
          claims: { sub: 'oidc-sub' },
        },
      }),
    )
    expect(principal.id).toBe('oidc-sub')
  })

  it('reads org_id as fallback for tenantId', async () => {
    const resolver = createOidcPrincipalResolver({ from: 'oidc' })
    const principal = await resolver(
      fakeCtx({
        auth: {
          authenticated: true,
          claims: { sub: 's1', org_id: 'org-123' },
        },
      }),
    )
    expect(principal.tenantId).toBe('org-123')
  })

  it('groups precedence: claims.groups > claims.roles > auth.roles', async () => {
    const resolver = createOidcPrincipalResolver({ from: 'oidc' })
    const principal = await resolver(
      fakeCtx({
        auth: {
          authenticated: true,
          roles: ['from-auth'],
          claims: { sub: 's1', roles: ['from-claims-roles'], groups: ['from-claims-groups'] },
        },
      }),
    )
    expect(principal.groups).toEqual(['from-claims-groups'])
  })
})

describe('principal adapters — dispatcher', () => {
  it('rejects unknown source', () => {
    expect(() => createPrincipalResolver({ from: 'wat' as never })).toThrow(/not a valid source/)
  })

  it('custom requires map', () => {
    expect(() => createPrincipalResolver({ from: 'custom' })).toThrow(/requires `map`/)
  })

  it('all 4 sources resolvable', () => {
    expect(() =>
      createPrincipalResolver({ from: 'custom', map: () => ({ id: 'x', tenantId: null, scopes: [], groups: [] }) }),
    ).not.toThrow()
    expect(() => createPrincipalResolver({ from: 'session' })).not.toThrow()
    expect(() => createPrincipalResolver({ from: 'oauth2' })).not.toThrow()
    expect(() => createPrincipalResolver({ from: 'oidc' })).not.toThrow()
  })
})
