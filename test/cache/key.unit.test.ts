import { describe, expect, it } from 'vitest'

import { compileProcedureCacheKey, procedureCacheKeyFor } from '../../src/cache/key.js'
import { createContext } from '../../src/types/context.js'

describe('cache key composition', () => {
  it('fails open when a selected value cannot be safely inspected or encoded', () => {
    const context = createContext('unsafe-cache-key')
    const invalidDate = compileProcedureCacheKey('catalog.invalid-date', {
      keyFormat: 'v2',
      keys: ['when'],
    })
    const throwingGetter = compileProcedureCacheKey('catalog.throwing-getter', {
      keyFormat: 'v2',
      keys: ['unsafe'],
    })
    const input = Object.defineProperty({}, 'unsafe', {
      get() { throw new Error('do not inspect') },
    })

    expect(invalidDate({ when: new Date(Number.NaN) }, context)).toBeUndefined()
    expect(throwingGetter(input, context)).toBeUndefined()
  })

  it('keeps the legacy key byte-identical when v2 is not selected', () => {
    const ctx = createContext('legacy-cache-key')

    expect(procedureCacheKeyFor('catalog.public', {}, ctx)).toBe(
      'procedure:catalog.public:v1:anonymous:RBNvo1WzZ4oRRq0W9-hknpT7T8If536DEMBg9hyq_4o',
    )
  })

  it('composes named and typed procedure dimensions in configured order', () => {
    const ctx = createContext('cache-key')

    const key = procedureCacheKeyFor(
      'catalog.list',
      { page: 2, filter: { status: 'open' } },
      ctx,
      {
        keyFormat: 'v2',
        keys: ['filter.status', 'page'],
      },
    )

    expect(key).toBe(
      'procedure:catalog.list:k2:v1:anonymous:p.filter.status=s:open|p.page=n:2',
    )
  })

  it('precompiles selector syntax and paths into an immutable route key plan', () => {
    const selectors = ['filter.status']
    const keyFor = compileProcedureCacheKey('catalog.list', {
      keyFormat: 'v2',
      keys: selectors,
    })
    selectors[0] = 'other'

    expect(keyFor({ filter: { status: 'open' }, other: 'closed' }, createContext('compiled')))
      .toBe('procedure:catalog.list:k2:v1:anonymous:p.filter.status=s:open')
  })

  it('bounds a v2 key by hashing only the overflowing dimension tail', () => {
    const ctx = createContext('bounded-cache-key')

    const key = procedureCacheKeyFor(
      'catalog.list',
      { query: 'x'.repeat(100) },
      ctx,
      {
        keyFormat: 'v2',
        keys: ['query'],
        maxKeyLength: 100,
      },
    )

    expect(key).toBe(
      'procedure:catalog.list:k2:v1:anonymous:p.query=s:xxxxx|h:eE7Xk7vsgnREXVBh70eYU7xXEZejsLrKhBWMdfWpCW8',
    )
    expect(Buffer.byteLength(key!)).toBe(100)
  })

  it('escapes identity values in v2 keys without changing their structure', () => {
    const ctx = createContext('escaped-identity', {
      auth: {
        authenticated: true,
        principal: 'user/one',
        tenantId: 'team:blue',
      },
    })

    const key = procedureCacheKeyFor('catalog.list', {}, ctx, {
      keyFormat: 'v2',
      keys: [],
    })

    expect(key).toBe(
      'procedure:catalog.list:k2:v1:tenant:team%3Ablue:principal:user%2Fone:',
    )
  })

  it('distinguishes a missing tenant from a literal dash tenant in v2 identities', () => {
    const withoutTenant = createContext('without-tenant', {
      auth: { authenticated: true, principal: 'user-1' },
    })
    const dashTenant = createContext('dash-tenant', {
      auth: { authenticated: true, principal: 'user-1', tenantId: '-' },
    })

    const first = procedureCacheKeyFor('catalog.list', {}, withoutTenant, {
      keyFormat: 'v2',
      keys: [],
    })
    const second = procedureCacheKeyFor('catalog.list', {}, dashTenant, {
      keyFormat: 'v2',
      keys: [],
    })

    expect(first).toContain(':principal:user-1:')
    expect(first).not.toContain(':tenant:')
    expect(second).toContain(':tenant:-:principal:user-1:')
    expect(first).not.toBe(second)
  })

  it('bypasses v2 caching when maxKeyLength cannot hold the structural prefix and digest', () => {
    const ctx = createContext('impossible-key-bound')

    const key = procedureCacheKeyFor('catalog.list', { page: 2 }, ctx, {
      keyFormat: 'v2',
      maxKeyLength: 20,
    })

    expect(key).toBeUndefined()
  })

  it('bypasses v2 caching when a dimension cannot be percent-encoded safely', () => {
    const ctx = createContext('invalid-unicode-key')

    expect(() => procedureCacheKeyFor('catalog.list', { query: '\uD800' }, ctx, {
      keyFormat: 'v2',
      keys: ['query'],
    })).not.toThrow()
    expect(procedureCacheKeyFor('catalog.list', { query: '\uD800' }, ctx, {
      keyFormat: 'v2',
      keys: ['query'],
    })).toBeUndefined()
  })

  it('bypasses anonymous caching when credentials were presented but rejected', () => {
    const ctx = createContext('rejected-credentials', {
      auth: {
        authenticated: false,
        credentialsPresented: true,
      },
    })

    const key = procedureCacheKeyFor('catalog.public', {}, ctx)

    expect(key).toBeUndefined()
  })

  it('detects rejected credentials from protocol-neutral transport metadata', () => {
    const ctx = createContext('rejected-metadata-credentials', {
      auth: { authenticated: false },
      input: {
        metadata: { Authorization: 'Bearer expired' },
      },
    })

    expect(procedureCacheKeyFor('catalog.public', {}, ctx)).toBeUndefined()
  })

  it('selects transport metadata and case-insensitive HTTP headers explicitly', () => {
    const ctx = createContext('context-dimensions', {
      auth: {
        authenticated: true,
        principal: 'user-1',
        tenantId: 'stone',
      },
      input: {
        metadata: { tenantId: 'stone' },
      },
      http: {
        kind: 'http',
        method: 'GET',
        path: '/catalog',
        url: 'http://localhost/catalog',
        headers: { 'x-cohort': 'Beta' },
      },
    })

    const key = procedureCacheKeyFor('catalog.list', {}, ctx, {
      keyFormat: 'v2',
      keys: ['#tenantId', '@X-Cohort', 'missing'],
    })

    expect(key).toBe(
      'procedure:catalog.list:k2:v1:tenant:stone:principal:user-1:c.tenantId=s:stone|h.x-cohort=s:Beta|p.missing=u:',
    )
  })
})
