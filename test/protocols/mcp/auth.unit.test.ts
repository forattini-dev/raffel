import { describe, it, expect } from 'vitest'
import {
  createBearerAuth,
  createApiKeyAuth,
  createCompositeAuth,
  createMcpAuthFromStrategy,
} from '../../../src/protocols/mcp/auth.js'
import type { McpAuthRequest } from '../../../src/protocols/mcp/types.js'

function makeReq(headers: Record<string, string> = {}): McpAuthRequest {
  return { headers, method: 'POST', url: '/mcp' }
}

describe('createBearerAuth', () => {
  const auth = createBearerAuth({
    verify: (token) => {
      if (token === 'valid-token') {
        return { token, clientId: 'user-1', scopes: ['read', 'write'] }
      }
      if (token === 'expired') {
        return { token, clientId: 'user-2', scopes: [], expiresAt: 0 }
      }
      return null
    },
  })

  it('should authenticate valid bearer token', async () => {
    const result = await auth.verify(makeReq({ authorization: 'Bearer valid-token' }))
    expect(result).not.toBeNull()
    expect(result!.clientId).toBe('user-1')
    expect(result!.scopes).toEqual(['read', 'write'])
    expect(result!.token).toBe('valid-token')
  })

  it('should reject invalid token', async () => {
    const result = await auth.verify(makeReq({ authorization: 'Bearer bad-token' }))
    expect(result).toBeNull()
  })

  it('should reject missing authorization header', async () => {
    const result = await auth.verify(makeReq())
    expect(result).toBeNull()
  })

  it('should reject non-bearer authorization', async () => {
    const result = await auth.verify(makeReq({ authorization: 'Basic dXNlcjpwYXNz' }))
    expect(result).toBeNull()
  })

  it('should reject empty bearer value', async () => {
    const result = await auth.verify(makeReq({ authorization: 'Bearer ' }))
    expect(result).toBeNull()
  })

  it('should handle expired tokens from verifier', async () => {
    const result = await auth.verify(makeReq({ authorization: 'Bearer expired' }))
    expect(result).not.toBeNull()
    expect(result!.expiresAt).toBe(0)
  })
})

describe('createApiKeyAuth', () => {
  describe('static keys', () => {
    const auth = createApiKeyAuth({
      keys: {
        'sk-abc123': { clientId: 'client-1', scopes: ['read'] },
        'sk-admin': { clientId: 'admin', scopes: ['read', 'write', 'admin'] },
      },
    })

    it('should authenticate valid API key', async () => {
      const result = await auth.verify(makeReq({ 'x-api-key': 'sk-abc123' }))
      expect(result).not.toBeNull()
      expect(result!.clientId).toBe('client-1')
      expect(result!.token).toBe('sk-abc123')
    })

    it('should reject unknown key', async () => {
      const result = await auth.verify(makeReq({ 'x-api-key': 'sk-unknown' }))
      expect(result).toBeNull()
    })

    it('should reject missing header', async () => {
      const result = await auth.verify(makeReq())
      expect(result).toBeNull()
    })
  })

  describe('custom header', () => {
    const auth = createApiKeyAuth({
      header: 'Authorization',
      verify: async (key) => {
        if (key === 'secret-key') return { token: key, clientId: 'svc', scopes: [] }
        return null
      },
    })

    it('should read from custom header', async () => {
      const result = await auth.verify(makeReq({ authorization: 'secret-key' }))
      expect(result).not.toBeNull()
      expect(result!.clientId).toBe('svc')
    })
  })

  describe('async verify', () => {
    const auth = createApiKeyAuth({
      verify: async (key) => {
        await new Promise((r) => setTimeout(r, 1))
        if (key === 'async-key') return { token: key, clientId: 'async-client', scopes: ['all'] }
        return null
      },
    })

    it('should work with async verifier', async () => {
      const result = await auth.verify(makeReq({ 'x-api-key': 'async-key' }))
      expect(result!.clientId).toBe('async-client')
    })
  })
})

describe('createCompositeAuth', () => {
  const bearer = createBearerAuth({
    verify: (token) => token === 'jwt-token' ? { token, clientId: 'jwt-user', scopes: ['read'] } : null,
  })

  const apiKey = createApiKeyAuth({
    keys: { 'sk-123': { clientId: 'key-user', scopes: ['write'] } },
  })

  const composite = createCompositeAuth(bearer, apiKey)

  it('should try bearer first', async () => {
    const result = await composite.verify(makeReq({ authorization: 'Bearer jwt-token' }))
    expect(result!.clientId).toBe('jwt-user')
  })

  it('should fall back to API key', async () => {
    const result = await composite.verify(makeReq({ 'x-api-key': 'sk-123' }))
    expect(result!.clientId).toBe('key-user')
  })

  it('should return null when all providers reject', async () => {
    const result = await composite.verify(makeReq({ authorization: 'Bearer wrong' }))
    expect(result).toBeNull()
  })
})

describe('createMcpAuthFromStrategy', () => {
  it('should bridge a Raffel AuthStrategy to McpAuthProvider', async () => {
    // Create a minimal mock strategy
    const strategy = {
      name: 'mock-bearer',
      authenticate: async (envelope: any) => {
        const auth = envelope.metadata?.authorization
        if (auth === 'Bearer test-jwt') {
          return {
            authenticated: true,
            principal: 'user-42',
            roles: ['admin'],
            claims: { sub: 'user-42', scopes: ['admin'], exp: 9999999999 },
          }
        }
        return null
      },
    }

    const provider = createMcpAuthFromStrategy(strategy)
    const result = await provider.verify(makeReq({ authorization: 'Bearer test-jwt' }))

    expect(result).not.toBeNull()
    expect(result!.clientId).toBe('user-42')
    expect(result!.scopes).toContain('admin')
    expect(result!.token).toBe('test-jwt')
  })

  it('should return null when strategy rejects', async () => {
    const strategy = {
      name: 'mock-reject',
      authenticate: async () => null,
    }

    const provider = createMcpAuthFromStrategy(strategy)
    const result = await provider.verify(makeReq({ authorization: 'Bearer bad' }))
    expect(result).toBeNull()
  })

  it('should return null for unauthenticated result', async () => {
    const strategy = {
      name: 'mock-unauth',
      authenticate: async () => ({ authenticated: false }),
    }

    const provider = createMcpAuthFromStrategy(strategy)
    const result = await provider.verify(makeReq({ authorization: 'Bearer test' }))
    expect(result).toBeNull()
  })
})
