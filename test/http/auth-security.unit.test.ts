import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import {
  basicAuth,
  bearerAuth,
  compositeAuth,
  cookieSession,
  type SessionManager,
} from '../../src/http/auth.js'
import { HttpContext, type HttpContextInterface } from '../../src/http/context.js'
import { setCookies } from '../../src/http/cookie.js'
import { setSignedCookie } from '../../src/http/cookie.js'
import { extractCookieSession } from '../../src/http/stream-auth.js'

function createContext(cookie?: string): {
  context: HttpContextInterface<Record<string, unknown>>
  values: Record<string, unknown>
  responseHeaders: Headers
} {
  const values: Record<string, unknown> = {}
  const responseHeaders = new Headers()
  const request = new Request('https://app.example.test/private', {
    headers: cookie ? { cookie } : undefined,
  })

  const context = {
    req: {
      raw: request,
      method: request.method,
      url: request.url,
      path: '/private',
      header: (name?: string) => name ? request.headers.get(name) ?? undefined : {},
    },
    res: undefined,
    set: (key: string, value: unknown) => { values[key] = value },
    get: (key: string) => values[key],
    get var() { return values },
    header: (name: string, value: string) => responseHeaders.append(name, value),
  } as unknown as HttpContextInterface<Record<string, unknown>>

  return { context, values, responseHeaders }
}

describe('HTTP auth security regressions', () => {
  it('preserves multiple Set-Cookie headers on real HTTP responses', () => {
    const context = new HttpContext(new Request('https://app.example.test/'))
    setCookies(context, { csrf: 'one', session: 'two' }, { httpOnly: true })

    const response = context.text('ok')
    const cookies = (response.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()

    expect(cookies).toHaveLength(2)
    expect(cookies.join('\n')).toContain('csrf=one')
    expect(cookies.join('\n')).toContain('session=two')
  })

  it('restores a legitimate signed cookie session on the next request', async () => {
    const middleware = cookieSession({ secret: 'a-long-random-test-secret', secure: true })
    const first = createContext()

    await middleware(first.context, async () => {
      const session = first.values.session as SessionManager
      session.set('role', 'admin')
    })

    const setCookie = first.responseHeaders.get('set-cookie')
    expect(setCookie).toBeTruthy()
    const second = createContext(setCookie!.split(';', 1)[0])

    await middleware(second.context, async () => {
      const session = second.values.session as SessionManager
      expect(session.get('role')).toBe('admin')
    })
  })

  it('restores signed sessions for the legacy stream authentication adapter', async () => {
    const secret = 'a-long-random-test-secret'
    let setCookie = ''
    await setSignedCookie({
      req: { header: () => undefined },
      header: (_name, value) => { setCookie = value },
    }, 'stream_session', JSON.stringify({ data: { userId: 'stream-user' } }), secret)
    const request = {
      headers: { cookie: setCookie.split(';', 1)[0] },
    } as IncomingMessage

    await expect(extractCookieSession(request, {
      cookieName: 'stream_session',
      secret,
    })).resolves.toMatchObject({ principal: 'stream-user' })
  })

  it('rejects session state middleware as a composite authentication driver', () => {
    expect(() => compositeAuth({
      strategy: 'any',
      drivers: [
        cookieSession({ secret: 'a-long-random-test-secret' }),
        bearerAuth({ verifyToken: async () => null }),
      ],
    })).toThrow(/authentication driver/i)
  })

  it('does not let an unauthenticated request reach a composite protected handler', async () => {
    const next = vi.fn(async () => undefined)
    const middleware = compositeAuth({
      strategy: 'any',
      drivers: [
        bearerAuth({ verifyToken: async () => null }),
        bearerAuth({ prefix: 'ApiKey', verifyToken: async () => null }),
      ],
    })

    const response = await middleware(createContext().context, next)

    expect(next).not.toHaveBeenCalled()
    expect(response).toBeInstanceOf(Response)
    expect((response as Response).status).toBe(401)
  })

  it('rejects Basic credentials whose username or password has a different length', async () => {
    const next = vi.fn(async () => undefined)
    const middleware = basicAuth({ username: 'admin', password: 'correct-password' })
    const request = (credentials: string) => {
      const { context } = createContext()
      const originalHeader = context.req.header.bind(context.req)
      context.req.header = (name?: string) => name?.toLowerCase() === 'authorization'
        ? `Basic ${Buffer.from(credentials).toString('base64')}`
        : originalHeader(name as string)
      return context
    }

    const wrongUsername = await middleware(request('attacker:correct-password'), next)
    const wrongPassword = await middleware(request('admin:x'), next)

    expect((wrongUsername as Response).status).toBe(401)
    expect((wrongPassword as Response).status).toBe(401)
    expect(next).not.toHaveBeenCalled()
  })
})
