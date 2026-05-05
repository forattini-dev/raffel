import { describe, expect, it } from 'vitest'
import {
  deriveAuthPrincipalId,
  derivePolicyPrincipalFromAuth,
  getAuthGroups,
  getAuthRoles,
  getAuthScopes,
  normalizeStringList,
} from '../../src/auth/principal.js'

describe('auth principal normalization', () => {
  it('normalizes comma and space separated string lists', () => {
    expect(normalizeStringList('read write,admin')).toEqual(['read', 'write', 'admin'])
    expect(normalizeStringList(['read write', 'read,admin'])).toEqual(['read', 'write', 'admin'])
  })

  it('derives principal id from explicit id, typed principal, then claims sub', () => {
    expect(deriveAuthPrincipalId({ principalId: 'explicit', principal: 'principal', claims: { sub: 'sub' } }))
      .toBe('explicit')
    expect(deriveAuthPrincipalId({ principal: { id: 'typed' }, claims: { sub: 'sub' } }))
      .toBe('typed')
    expect(deriveAuthPrincipalId({ claims: { sub: 'sub' } }))
      .toBe('sub')
  })

  it('keeps roles strict while scopes accept OAuth-style strings', () => {
    const auth = {
      claims: {
        roles: 'admin',
        scope: 'read write',
        scopes: ['write', 'delete'],
        permissions: 'delete:own',
      },
    }

    expect(getAuthRoles(auth)).toEqual([])
    expect(getAuthScopes(auth)).toEqual(['read', 'write', 'delete', 'delete:own'])
  })

  it('prefers groups over role fallbacks for policy principals', () => {
    const auth = {
      authenticated: true,
      principal: { id: 'user-1', roles: ['principal-role'], scopes: ['profile'] },
      tenantId: 'tenant-1',
      claims: {
        groups: ['ops'],
        roles: ['claims-role'],
        scope: 'email',
      },
    }

    expect(getAuthGroups(auth)).toEqual(['ops'])
    expect(derivePolicyPrincipalFromAuth(auth)).toEqual({
      id: 'user-1',
      tenantId: 'tenant-1',
      scopes: ['profile'],
      groups: ['ops'],
      attrs: auth.claims,
    })
  })

  it('requires authenticated auth context for policy principal derivation', () => {
    expect(() => derivePolicyPrincipalFromAuth({ authenticated: false }))
      .toThrow('Cannot derive policy principal from unauthenticated auth context.')
  })
})
