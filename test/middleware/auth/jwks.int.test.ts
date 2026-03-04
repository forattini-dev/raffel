import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { JWKSVerifier } from '../../../src/middleware/auth/jwks.js'

const mockGetKey = vi.fn() as unknown as ReturnType<
  Awaited<ReturnType<typeof import('jose').createRemoteJWKSet>>
>
Object.assign(mockGetKey, { clear: vi.fn() })

const mockCreateRemoteJWKSet = vi.fn()
const mockJwtVerify = vi.fn()

vi.mock('jose', () => ({
  createRemoteJWKSet: (...args: unknown[]) => {
    return mockCreateRemoteJWKSet(...args)
  },
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
}))

import { createJWKSVerifier } from '../../../src/middleware/auth/jwks.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createJWKSVerifier', () => {
  it('should create a verifier with defaults and verify token claims', async () => {
    const clear = vi.fn()
    const keyFn = Object.assign(vi.fn(), { clear }) as typeof mockGetKey
    mockCreateRemoteJWKSet.mockReturnValue(keyFn)
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-1', scope: 'read:users' } })

    const verifier = createJWKSVerifier({
      jwksUri: 'https://example.com/.well-known/jwks.json',
      issuer: 'https://issuer',
      audience: 'aud-1',
    })

    const claims = await verifier.verify('token-123')

    expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(
      new URL('https://example.com/.well-known/jwks.json'),
      expect.objectContaining({
        timeoutDuration: 5000,
        cacheMaxAge: 300000,
        cooldownDuration: 30000,
      })
    )
    expect(mockJwtVerify).toHaveBeenCalledWith(
      'token-123',
      keyFn,
      expect.objectContaining({
        audience: 'aud-1',
        issuer: 'https://issuer',
        algorithms: ['RS256', 'ES256'],
      })
    )
    expect(claims).toEqual({ sub: 'user-1', scope: 'read:users' })
  })

  it('should forward custom algorithms and cache settings', async () => {
    const keyFn = Object.assign(vi.fn(), { clear: vi.fn() }) as typeof mockGetKey
    mockCreateRemoteJWKSet.mockReturnValue(keyFn)
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-2' } })

    const verifier: JWKSVerifier = createJWKSVerifier({
      jwksUri: 'https://example.com/jwks',
      algorithms: ['RS256'],
      timeoutMs: 12345,
      cacheMaxAge: 120000,
      cooldownDuration: 45000,
    })

    await verifier.verify('token-456')

    expect(mockCreateRemoteJWKSet).toHaveBeenCalledWith(
      new URL('https://example.com/jwks'),
      expect.objectContaining({
        timeoutDuration: 12345,
        cacheMaxAge: 120000,
        cooldownDuration: 45000,
      })
    )
    expect(mockJwtVerify).toHaveBeenCalledWith(
      'token-456',
      keyFn,
      expect.objectContaining({
        algorithms: ['RS256'],
      })
    )
  })

  it('should clear cached keys when clearCache is called', async () => {
    const clear = vi.fn()
    const keyFn = Object.assign(vi.fn(), { clear }) as typeof mockGetKey
    mockCreateRemoteJWKSet.mockReturnValue(keyFn)
    mockJwtVerify.mockResolvedValue({ payload: {} })

    const verifier = createJWKSVerifier({
      jwksUri: 'https://example.com/jwks',
    })

    verifier.clearCache()

    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('should be resilient when key getter does not expose clear', async () => {
    const keyFn = vi.fn()
    mockCreateRemoteJWKSet.mockReturnValue(keyFn)
    mockJwtVerify.mockResolvedValue({ payload: { ok: true } })

    const verifier = createJWKSVerifier({
      jwksUri: 'https://example.com/jwks',
    })

    await expect(verifier.verify('token-789')).resolves.toEqual({ ok: true })
    expect(() => verifier.clearCache()).not.toThrow()
  })
})
