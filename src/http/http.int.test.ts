/**
 * HTTP Module Integration Tests
 *
 * Tests for HTTP utilities: cookies, CORS, body-limit, etc.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  parseCookies,
  getCookie,
  getCookies,
  setCookie,
  deleteCookie,
  generateCookie,
  setCookies,
  deleteCookies,
  getSignedCookie,
  setSignedCookie,
  setHostCookie,
  setSecureCookie,
  setChunkedCookie,
  getChunkedCookie,
  deleteChunkedCookie,
  isChunkedCookie,
  CookieChunkOverflowError,
  type CookieContext,
} from './cookie.js'
import { cors, type CorsOptions } from './cors.js'
import { bodyLimit, parseSize, formatSize, type SizeString } from './body-limit.js'

// ============================================================================
// Cookie Tests
// ============================================================================

describe('Cookie Utilities', () => {
  // Helper to create mock context
  function createMockContext(cookieHeader?: string): CookieContext & { headers: Map<string, string[]> } {
    const headers = new Map<string, string[]>()
    return {
      req: {
        header: (name: string) => {
          if (name.toLowerCase() === 'cookie') return cookieHeader
          return undefined
        },
      },
      header: (name: string, value: string, options?: { append?: boolean }) => {
        const existing = headers.get(name.toLowerCase()) || []
        if (options?.append) {
          existing.push(value)
        } else {
          existing.length = 0
          existing.push(value)
        }
        headers.set(name.toLowerCase(), existing)
      },
      headers,
    }
  }

  describe('parseCookies', () => {
    it('should parse simple cookies', () => {
      const cookies = parseCookies('session=abc123; theme=dark')
      expect(cookies).toEqual({ session: 'abc123', theme: 'dark' })
    })

    it('should handle quoted values', () => {
      const cookies = parseCookies('name="John Doe"; value="with spaces"')
      expect(cookies.name).toBe('John Doe')
      expect(cookies.value).toBe('with spaces')
    })

    it('should decode URI-encoded values', () => {
      const cookies = parseCookies('name=John%20Doe; emoji=%F0%9F%8E%89')
      expect(cookies.name).toBe('John Doe')
      expect(cookies.emoji).toBe('🎉')
    })

    it('should return empty object for empty input', () => {
      expect(parseCookies('')).toEqual({})
      expect(parseCookies(null)).toEqual({})
      expect(parseCookies(undefined)).toEqual({})
    })

    it('should handle malformed cookies', () => {
      const cookies = parseCookies('valid=value; invalid; another=one')
      expect(cookies.valid).toBe('value')
      expect(cookies.another).toBe('one')
      expect(cookies.invalid).toBeUndefined()
    })
  })

  describe('getCookie / getCookies', () => {
    it('should get a specific cookie', () => {
      const ctx = createMockContext('session=abc123; theme=dark')
      expect(getCookie(ctx, 'session')).toBe('abc123')
      expect(getCookie(ctx, 'theme')).toBe('dark')
      expect(getCookie(ctx, 'nonexistent')).toBeUndefined()
    })

    it('should get all cookies', () => {
      const ctx = createMockContext('a=1; b=2; c=3')
      expect(getCookies(ctx)).toEqual({ a: '1', b: '2', c: '3' })
    })
  })

  describe('generateCookie', () => {
    it('should generate basic cookie', () => {
      const cookie = generateCookie('session', 'abc123')
      expect(cookie).toBe('session=abc123')
    })

    it('should generate cookie with options', () => {
      const cookie = generateCookie('session', 'abc123', {
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
        path: '/',
        maxAge: 3600,
      })
      expect(cookie).toContain('session=abc123')
      expect(cookie).toContain('HttpOnly')
      expect(cookie).toContain('Secure')
      expect(cookie).toContain('SameSite=Lax')
      expect(cookie).toContain('Path=/')
      expect(cookie).toContain('Max-Age=3600')
    })

    it('should handle expires date', () => {
      const expires = new Date('2025-12-31T23:59:59Z')
      const cookie = generateCookie('session', 'abc123', { expires })
      expect(cookie).toContain(`Expires=${expires.toUTCString()}`)
    })

    it('should handle domain option', () => {
      const cookie = generateCookie('session', 'abc123', { domain: '.example.com' })
      expect(cookie).toContain('Domain=.example.com')
    })

    it('should handle __Host- prefix', () => {
      const cookie = generateCookie('session', 'abc123', { prefix: 'host' })
      expect(cookie).toContain('__Host-session=abc123')
      expect(cookie).toContain('Path=/')
      expect(cookie).toContain('Secure')
    })

    it('should handle __Secure- prefix', () => {
      const cookie = generateCookie('session', 'abc123', { prefix: 'secure' })
      expect(cookie).toContain('__Secure-session=abc123')
      expect(cookie).toContain('Secure')
    })

    it('should handle partitioned attribute', () => {
      const cookie = generateCookie('session', 'abc123', { partitioned: true })
      expect(cookie).toContain('Partitioned')
    })

    it('should handle priority attribute', () => {
      const cookie = generateCookie('session', 'abc123', { priority: 'High' })
      expect(cookie).toContain('Priority=High')
    })

    it('should encode special characters', () => {
      const cookie = generateCookie('name', 'John Doe & Friends')
      expect(cookie).toContain('name=John%20Doe%20%26%20Friends')
    })
  })

  describe('setCookie / deleteCookie', () => {
    it('should set a cookie', () => {
      const ctx = createMockContext()
      setCookie(ctx, 'session', 'abc123', { httpOnly: true })

      const setCookieHeaders = ctx.headers.get('set-cookie')
      expect(setCookieHeaders).toHaveLength(1)
      expect(setCookieHeaders![0]).toContain('session=abc123')
      expect(setCookieHeaders![0]).toContain('HttpOnly')
    })

    it('should delete a cookie', () => {
      const ctx = createMockContext()
      deleteCookie(ctx, 'session')

      const setCookieHeaders = ctx.headers.get('set-cookie')
      expect(setCookieHeaders).toHaveLength(1)
      expect(setCookieHeaders![0]).toContain('session=')
      expect(setCookieHeaders![0]).toContain('Max-Age=0')
    })
  })

  describe('setCookies / deleteCookies', () => {
    it('should set multiple cookies', () => {
      const ctx = createMockContext()
      setCookies(ctx, { a: '1', b: '2', c: '3' }, { path: '/' })

      const setCookieHeaders = ctx.headers.get('set-cookie')
      expect(setCookieHeaders).toHaveLength(3)
    })

    it('should delete multiple cookies', () => {
      const ctx = createMockContext()
      deleteCookies(ctx, ['a', 'b', 'c'])

      const setCookieHeaders = ctx.headers.get('set-cookie')
      expect(setCookieHeaders).toHaveLength(3)
    })
  })

  describe('Signed Cookies', () => {
    const SECRET = 'my-secret-key'

    it('should set and get signed cookie', async () => {
      const ctx = createMockContext()

      await setSignedCookie(ctx, 'user_id', '12345', SECRET)

      const setCookieHeaders = ctx.headers.get('set-cookie')
      expect(setCookieHeaders).toHaveLength(1)

      // The value should contain a signature (format: value.signature)
      const cookieValue = setCookieHeaders![0].split('=')[1].split(';')[0]
      expect(cookieValue).toContain('.')
    })

    it('should verify valid signed cookie', async () => {
      // First set the cookie
      const ctx = createMockContext()
      await setSignedCookie(ctx, 'user_id', '12345', SECRET)

      // Extract the signed value from the Set-Cookie header
      const setCookieHeaders = ctx.headers.get('set-cookie')
      const signedValue = decodeURIComponent(setCookieHeaders![0].split('=')[1].split(';')[0])

      // Create new context with the cookie
      const readCtx = createMockContext(`user_id=${encodeURIComponent(signedValue)}`)

      const value = await getSignedCookie(readCtx, 'user_id', SECRET)
      expect(value).toBe('12345')
    })

    it('should reject tampered signed cookie', async () => {
      const readCtx = createMockContext('user_id=12345.invalidSignature')

      const value = await getSignedCookie(readCtx, 'user_id', SECRET)
      expect(value).toBe(false)
    })

    it('should return false for missing cookie', async () => {
      const ctx = createMockContext()
      const value = await getSignedCookie(ctx, 'nonexistent', SECRET)
      expect(value).toBe(false)
    })
  })

  describe('Host and Secure Cookies', () => {
    it('should set __Host- prefixed cookie', () => {
      const ctx = createMockContext()
      setHostCookie(ctx, 'session', 'abc123', { httpOnly: true })

      const setCookieHeaders = ctx.headers.get('set-cookie')
      expect(setCookieHeaders![0]).toContain('__Host-session=abc123')
      expect(setCookieHeaders![0]).toContain('Secure')
      expect(setCookieHeaders![0]).toContain('Path=/')
    })

    it('should set __Secure- prefixed cookie', () => {
      const ctx = createMockContext()
      setSecureCookie(ctx, 'token', 'xyz789', { httpOnly: true, path: '/api' })

      const setCookieHeaders = ctx.headers.get('set-cookie')
      expect(setCookieHeaders![0]).toContain('__Secure-token=xyz789')
      expect(setCookieHeaders![0]).toContain('Secure')
      expect(setCookieHeaders![0]).toContain('Path=/api')
    })
  })

  describe('Chunked Cookies', () => {
    it('should set small cookie without chunking', () => {
      const ctx = createMockContext()
      setChunkedCookie(ctx, 'small', 'hello', {})

      const setCookieHeaders = ctx.headers.get('set-cookie')
      expect(setCookieHeaders).toHaveLength(1)
      expect(setCookieHeaders![0]).toContain('small=hello')
    })

    it('should chunk large cookies', () => {
      const ctx = createMockContext()
      const largeValue = 'x'.repeat(10000)
      setChunkedCookie(ctx, 'large', largeValue, {}, { maxCookieSize: 1000 })

      const setCookieHeaders = ctx.headers.get('set-cookie')
      expect(setCookieHeaders!.length).toBeGreaterThan(1)

      // Should have chunk count metadata
      const chunksHeader = setCookieHeaders!.find(h => h.includes('large.__chunks='))
      expect(chunksHeader).toBeDefined()
    })

    it('should get chunked cookie', () => {
      const ctx = createMockContext('large.0=hello; large.1=world; large.__chunks=2')
      const value = getChunkedCookie(ctx, 'large')
      expect(value).toBe('helloworld')
    })

    it('should get non-chunked cookie', () => {
      const ctx = createMockContext('simple=value')
      const value = getChunkedCookie(ctx, 'simple')
      expect(value).toBe('value')
    })

    it('should return null for missing cookie', () => {
      const ctx = createMockContext()
      const value = getChunkedCookie(ctx, 'nonexistent')
      expect(value).toBeNull()
    })

    it('should check if cookie is chunked', () => {
      const chunkedCtx = createMockContext('data.0=a; data.1=b; data.__chunks=2')
      expect(isChunkedCookie(chunkedCtx, 'data')).toBe(true)

      const normalCtx = createMockContext('data=value')
      expect(isChunkedCookie(normalCtx, 'data')).toBe(false)
    })

    it('should throw on chunk overflow', () => {
      const ctx = createMockContext()
      const hugeValue = 'x'.repeat(100000)

      expect(() => {
        setChunkedCookie(ctx, 'huge', hugeValue, {}, { maxCookieSize: 1000, maxChunks: 5 })
      }).toThrow(CookieChunkOverflowError)
    })

    it('should handle onOverflow callback', () => {
      const ctx = createMockContext()
      const hugeValue = 'x'.repeat(100000)
      const onOverflow = vi.fn(() => true) // Suppress error

      setChunkedCookie(ctx, 'huge', hugeValue, {}, {
        maxCookieSize: 1000,
        maxChunks: 5,
        onOverflow,
      })

      expect(onOverflow).toHaveBeenCalled()
    })

    it('should delete chunked cookie', () => {
      const ctx = createMockContext('large.0=a; large.1=b; large.__chunks=2')
      deleteChunkedCookie(ctx, 'large')

      const setCookieHeaders = ctx.headers.get('set-cookie')
      // Should delete all chunk cookies and metadata
      expect(setCookieHeaders!.length).toBeGreaterThan(0)
    })
  })
})

// ============================================================================
// CORS Tests
// ============================================================================

describe('CORS Middleware', () => {
  // Helper to create mock context
  function createMockContext(options: {
    method: string
    origin?: string
    headers?: Record<string, string>
  }) {
    const requestHeaders = new Headers()
    if (options.origin) {
      requestHeaders.set('origin', options.origin)
    }
    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        requestHeaders.set(key, value)
      }
    }

    let response: Response | null = null

    return {
      req: {
        method: options.method,
        header: (name: string) => requestHeaders.get(name) ?? undefined,
        raw: {
          headers: Object.fromEntries(requestHeaders.entries()),
        },
      },
      set res(r: Response | null) {
        response = r
      },
      get res(): Response | null {
        return response
      },
    }
  }

  describe('Preflight requests (OPTIONS)', () => {
    it('should handle preflight with wildcard origin', async () => {
      const middleware = cors()
      const ctx = createMockContext({
        method: 'OPTIONS',
        origin: 'https://example.com',
      })

      const response = await middleware(ctx as any, async () => {})

      expect(response).toBeDefined()
      expect(response?.status).toBe(204)
      expect(response?.headers.get('access-control-allow-origin')).toBe('*')
      expect(response?.headers.get('access-control-allow-methods')).toContain('GET')
    })

    it('should handle preflight with specific origin', async () => {
      const middleware = cors({ origin: 'https://example.com' })
      const ctx = createMockContext({
        method: 'OPTIONS',
        origin: 'https://example.com',
      })

      const response = await middleware(ctx as any, async () => {})

      expect(response?.headers.get('access-control-allow-origin')).toBe('https://example.com')
    })

    it('should reject preflight from non-allowed origin', async () => {
      const middleware = cors({ origin: 'https://allowed.com' })
      const ctx = createMockContext({
        method: 'OPTIONS',
        origin: 'https://notallowed.com',
      })

      const response = await middleware(ctx as any, async () => {})

      expect(response?.headers.get('access-control-allow-origin')).toBeNull()
    })

    it('should reflect requested headers if not configured', async () => {
      const middleware = cors()
      const ctx = createMockContext({
        method: 'OPTIONS',
        origin: 'https://example.com',
        headers: { 'access-control-request-headers': 'Content-Type, X-Custom' },
      })

      const response = await middleware(ctx as any, async () => {})

      expect(response?.headers.get('access-control-allow-headers')).toBe('Content-Type, X-Custom')
    })

    it('should set max-age header', async () => {
      const middleware = cors({ maxAge: 86400 })
      const ctx = createMockContext({
        method: 'OPTIONS',
        origin: 'https://example.com',
      })

      const response = await middleware(ctx as any, async () => {})

      expect(response?.headers.get('access-control-max-age')).toBe('86400')
    })

    it('should set credentials header', async () => {
      const middleware = cors({ credentials: true })
      const ctx = createMockContext({
        method: 'OPTIONS',
        origin: 'https://example.com',
      })

      const response = await middleware(ctx as any, async () => {})

      expect(response?.headers.get('access-control-allow-credentials')).toBe('true')
      // When credentials is true with *, should echo origin
      expect(response?.headers.get('access-control-allow-origin')).toBe('https://example.com')
    })
  })

  describe('Actual requests', () => {
    it('should add CORS headers to response', async () => {
      const middleware = cors()
      const ctx = createMockContext({
        method: 'GET',
        origin: 'https://example.com',
      })

      // Simulate response from handler
      ctx.res = new Response('OK')

      await middleware(ctx as any, async () => {})

      expect(ctx.res?.headers.get('access-control-allow-origin')).toBe('*')
    })

    it('should add Vary header for dynamic origins', async () => {
      const middleware = cors({ origin: 'https://example.com' })
      const ctx = createMockContext({
        method: 'GET',
        origin: 'https://example.com',
      })

      ctx.res = new Response('OK')

      await middleware(ctx as any, async () => {})

      expect(ctx.res?.headers.get('vary')).toContain('Origin')
    })

    it('should set expose headers', async () => {
      const middleware = cors({ exposeHeaders: ['X-Request-Id', 'X-Custom'] })
      const ctx = createMockContext({
        method: 'GET',
        origin: 'https://example.com',
      })

      ctx.res = new Response('OK')

      await middleware(ctx as any, async () => {})

      expect(ctx.res?.headers.get('access-control-expose-headers')).toBe('X-Request-Id, X-Custom')
    })
  })

  describe('Origin validation', () => {
    it('should allow multiple origins (array)', async () => {
      const middleware = cors({ origin: ['https://a.com', 'https://b.com'] })

      const ctxA = createMockContext({ method: 'OPTIONS', origin: 'https://a.com' })
      const responseA = await middleware(ctxA as any, async () => {})
      expect(responseA?.headers.get('access-control-allow-origin')).toBe('https://a.com')

      const ctxB = createMockContext({ method: 'OPTIONS', origin: 'https://b.com' })
      const responseB = await middleware(ctxB as any, async () => {})
      expect(responseB?.headers.get('access-control-allow-origin')).toBe('https://b.com')

      const ctxC = createMockContext({ method: 'OPTIONS', origin: 'https://c.com' })
      const responseC = await middleware(ctxC as any, async () => {})
      expect(responseC?.headers.get('access-control-allow-origin')).toBeNull()
    })

    it('should allow function origin validator', async () => {
      const middleware = cors({
        origin: (origin) => origin.endsWith('.example.com'),
      })

      const ctxAllowed = createMockContext({ method: 'OPTIONS', origin: 'https://sub.example.com' })
      const responseAllowed = await middleware(ctxAllowed as any, async () => {})
      expect(responseAllowed?.headers.get('access-control-allow-origin')).toBe('https://sub.example.com')

      const ctxNotAllowed = createMockContext({ method: 'OPTIONS', origin: 'https://other.com' })
      const responseNotAllowed = await middleware(ctxNotAllowed as any, async () => {})
      expect(responseNotAllowed?.headers.get('access-control-allow-origin')).toBeNull()
    })

    it('should allow function origin validator returning string', async () => {
      const middleware = cors({
        origin: (origin) => origin === 'https://app.example.com' ? 'https://example.com' : false,
      })

      const ctx = createMockContext({ method: 'OPTIONS', origin: 'https://app.example.com' })
      const response = await middleware(ctx as any, async () => {})
      expect(response?.headers.get('access-control-allow-origin')).toBe('https://example.com')
    })
  })

  describe('No origin header', () => {
    it('should not set CORS headers for same-origin requests', async () => {
      const middleware = cors()
      const ctx = createMockContext({
        method: 'GET',
        // No origin header
      })

      ctx.res = new Response('OK')

      await middleware(ctx as any, async () => {})

      // For actual requests without origin, the response should still work
      // but no CORS headers should be added since there's no origin
    })
  })
})

// ============================================================================
// Body Limit Tests
// ============================================================================

describe('Body Limit Middleware', () => {
  describe('parseSize', () => {
    it('should parse numeric values', () => {
      expect(parseSize(1024)).toBe(1024)
      expect(parseSize(0)).toBe(0)
    })

    it('should parse size strings', () => {
      expect(parseSize('100b')).toBe(100)
      expect(parseSize('1kb')).toBe(1024)
      expect(parseSize('1mb')).toBe(1024 * 1024)
      expect(parseSize('1gb')).toBe(1024 * 1024 * 1024)
    })

    it('should parse decimal values', () => {
      expect(parseSize('1.5kb')).toBe(Math.floor(1.5 * 1024))
      expect(parseSize('0.5mb')).toBe(Math.floor(0.5 * 1024 * 1024))
    })

    it('should be case insensitive', () => {
      expect(parseSize('1KB' as SizeString)).toBe(1024)
      expect(parseSize('1Mb' as SizeString)).toBe(1024 * 1024)
      expect(parseSize('1GB' as SizeString)).toBe(1024 * 1024 * 1024)
    })

    it('should throw for invalid format', () => {
      expect(() => parseSize('invalid' as SizeString)).toThrow(/Invalid size format/)
      expect(() => parseSize('100tb' as SizeString)).toThrow(/Invalid size format/)
      expect(() => parseSize('100' as SizeString)).toThrow(/Invalid size format/)
    })
  })

  describe('formatSize', () => {
    it('should format bytes', () => {
      expect(formatSize(100)).toBe('100 bytes')
    })

    it('should format kilobytes', () => {
      expect(formatSize(1024)).toBe('1.00 KB')
      expect(formatSize(2048)).toBe('2.00 KB')
    })

    it('should format megabytes', () => {
      expect(formatSize(1024 * 1024)).toBe('1.00 MB')
      expect(formatSize(5 * 1024 * 1024)).toBe('5.00 MB')
    })

    it('should format gigabytes', () => {
      expect(formatSize(1024 * 1024 * 1024)).toBe('1.00 GB')
    })
  })

  describe('middleware behavior', () => {
    // Helper to create mock context
    function createMockContext(options: {
      method: string
      contentLength?: number
      body?: string
    }) {
      let res: Response | null = null
      const bodyContent = options.body ?? ''
      const bodyStream = bodyContent ? new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(bodyContent))
          controller.close()
        },
      }) : null

      return {
        req: {
          method: options.method,
          header: (name: string) => {
            if (name.toLowerCase() === 'content-length' && options.contentLength !== undefined) {
              return String(options.contentLength)
            }
            return undefined
          },
          raw: new Request('http://localhost', {
            method: options.method,
            body: bodyStream,
            headers: options.contentLength !== undefined
              ? { 'content-length': String(options.contentLength) }
              : undefined,
          }),
        },
        set res(r: Response | null) {
          res = r
        },
        get res(): Response | null {
          return res
        },
      }
    }

    it('should pass through GET requests', async () => {
      const middleware = bodyLimit({ maxSize: 100 })
      const ctx = createMockContext({ method: 'GET' })

      let nextCalled = false
      await middleware(ctx as any, async () => {
        nextCalled = true
      })

      expect(nextCalled).toBe(true)
      expect(ctx.res).toBeNull()
    })

    it('should pass through HEAD requests', async () => {
      const middleware = bodyLimit({ maxSize: 100 })
      const ctx = createMockContext({ method: 'HEAD' })

      let nextCalled = false
      await middleware(ctx as any, async () => {
        nextCalled = true
      })

      expect(nextCalled).toBe(true)
    })

    it('should pass through OPTIONS requests', async () => {
      const middleware = bodyLimit({ maxSize: 100 })
      const ctx = createMockContext({ method: 'OPTIONS' })

      let nextCalled = false
      await middleware(ctx as any, async () => {
        nextCalled = true
      })

      expect(nextCalled).toBe(true)
    })

    it('should reject POST with Content-Length exceeding limit', async () => {
      const middleware = bodyLimit({ maxSize: 100 })
      const ctx = createMockContext({
        method: 'POST',
        contentLength: 200,
      })

      await middleware(ctx as any, async () => {})

      expect(ctx.res).toBeDefined()
      expect(ctx.res?.status).toBe(413)
    })

    it('should allow POST within limit', async () => {
      const middleware = bodyLimit({ maxSize: 1000 })
      const ctx = createMockContext({
        method: 'POST',
        contentLength: 50,
        body: 'hello',
      })

      let nextCalled = false
      await middleware(ctx as any, async () => {
        nextCalled = true
      })

      expect(nextCalled).toBe(true)
    })

    it('should use custom error handler', async () => {
      const middleware = bodyLimit({
        maxSize: 100,
        onError: (c, maxSize) => new Response(`Custom error: max ${maxSize}`, { status: 413 }),
      })
      const ctx = createMockContext({
        method: 'POST',
        contentLength: 200,
      })

      await middleware(ctx as any, async () => {})

      expect(ctx.res?.status).toBe(413)
      const body = await ctx.res?.text()
      expect(body).toContain('Custom error')
    })
  })
})
