import { describe, it, expect, vi } from 'vitest'
import { HttpContext } from '../../src/http/context.js'
import { requireRole, requireScope, requireUser } from '../../src/http/guards.js'
import { createAuthContext, createContext } from '../../src/types/index.js'
import { HttpForbiddenError, HttpUnauthorizedError } from '../../src/http/errors.js'

describe('HTTP guards canonical auth migration', () => {
  it('prefers canonical runtime auth for requireUser', async () => {
    const c = new HttpContext(new Request('http://localhost/profile'))
    c.runtime = createContext('req-1', {
      auth: createAuthContext({
        authenticated: true,
        principal: {
          type: 'user',
          id: 'user-1',
          roles: ['member'],
        },
      }),
    })

    const next = vi.fn(async () => {})
    await requireUser()(c, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('uses canonical auth stored in context for role checks', async () => {
    const c = new HttpContext(new Request('http://localhost/admin'))
    c.set('auth', createAuthContext({
      authenticated: true,
      principal: 'service-admin',
      roles: ['admin'],
    }) as never)

    const next = vi.fn(async () => {})
    await requireRole('admin')(c, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('falls back to legacy user bag for scope checks during migration', async () => {
    const c = new HttpContext(new Request('http://localhost/api/users'))
    c.set('user', {
      id: 'legacy-user',
      permissions: ['read:users'],
    } as never)

    const next = vi.fn(async () => {})
    await requireScope('read:users')(c, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('rejects missing auth with HttpUnauthorizedError', async () => {
    const c = new HttpContext(new Request('http://localhost/profile'))

    await expect(requireUser()(c, async () => {})).rejects.toBeInstanceOf(HttpUnauthorizedError)
  })

  it('rejects missing role with HttpForbiddenError', async () => {
    const c = new HttpContext(new Request('http://localhost/admin'))
    c.runtime = createContext('req-2', {
      auth: createAuthContext({
        authenticated: true,
        principal: 'user-2',
        roles: ['member'],
      }),
    })

    await expect(requireRole('admin')(c, async () => {})).rejects.toBeInstanceOf(HttpForbiddenError)
  })
})
