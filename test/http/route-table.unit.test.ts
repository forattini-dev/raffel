import { describe, expect, it } from 'vitest'
import { HttpRouteTable } from '../../src/http/route-table.js'
import { parseRoutePath } from '../../src/server/fs-routes/route-naming.js'

describe('HttpRouteTable', () => {
  it('matches dynamic params without Fetch dependencies', () => {
    const table = new HttpRouteTable<string, string>()
    table.register({
      method: 'GET',
      path: '/users/:id/books/:bookId',
      handler: 'show-book',
    })

    const match = table.match('GET', '/users/alice%20a/books/book-1')

    expect(match.route?.handler).toBe('show-book')
    expect(match.params).toEqual({ id: 'alice a', bookId: 'book-1' })
  })

  it('preserves malformed percent-encoding instead of throwing', () => {
    const table = new HttpRouteTable<string, string>()
    table.register({ method: 'GET', path: '/users/:id', handler: 'show-user' })

    expect(table.match('GET', '/users/%ZZ').params).toEqual({ id: '%ZZ' })
  })

  it('matches parameters embedded in a static path segment', () => {
    const table = new HttpRouteTable<string, string>()
    table.register({
      method: 'GET',
      path: '/docs/openapi.:extension',
      handler: 'serve-openapi',
    })

    const match = table.match('GET', '/docs/openapi.toon')

    expect(match.route?.handler).toBe('serve-openapi')
    expect(match.params).toEqual({ extension: 'toon' })
  })

  it('matches terminal wildcard routes and catch-all routes', () => {
    const table = new HttpRouteTable<string, string>()
    table.register({ method: 'GET', path: '/assets/*', handler: 'asset' })
    table.register({ method: 'GET', path: '*', handler: 'catch-all' })

    const nested = table.match('GET', '/assets/css/main.css')
    const emptyRemainder = table.match('GET', '/assets')
    const fallback = table.match('GET', '/system/health')

    expect(nested.route?.handler).toBe('asset')
    expect(nested.params).toEqual({ '*': 'css/main.css' })
    expect(emptyRemainder.route?.handler).toBe('asset')
    expect(emptyRemainder.params).toEqual({})
    expect(fallback.route?.handler).toBe('catch-all')
    expect(fallback.params).toEqual({ '*': 'system/health' })
  })

  it('matches the named catch-all pattern emitted by fs route discovery', () => {
    const parsed = parseRoutePath('[...path]/get')
    const table = new HttpRouteTable<string, string>()
    table.register({
      method: 'GET',
      path: `/${parsed.segments.slice(0, -1).join('/')}`,
      handler: 'catch-all',
    })

    expect(table.match('GET', '/a').params).toEqual({ path: 'a' })
    expect(table.match('GET', '/a/b/c').params).toEqual({ path: 'a/b/c' })
    expect(table.match('GET', '/a%40b/c').params).toEqual({ path: 'a@b/c' })
    expect(table.match('GET', '/').route).toBeNull()
  })

  it('supports optional named catch-all parameters', () => {
    const table = new HttpRouteTable<string, string>()
    table.register({ method: 'GET', path: '/docs/:path*?', handler: 'docs' })

    expect(table.match('GET', '/docs').params).toEqual({})
    expect(table.match('GET', '/docs/api/users').params).toEqual({ path: 'api/users' })
  })

  it('prefers exact routes over dynamic routes regardless of registration order', () => {
    const table = new HttpRouteTable<string, string>()
    table.register({ method: 'GET', path: '/users/:id', handler: 'dynamic' })
    table.register({ method: 'GET', path: '/users/new', handler: 'exact' })

    const match = table.match('GET', '/users/new')

    expect(match.route?.handler).toBe('exact')
    expect(match.params).toEqual({})
  })

  it('keeps dynamic route precedence in registration order', () => {
    const table = new HttpRouteTable<string, string>()
    table.register({ method: 'GET', path: '/:scope/:id', handler: 'generic' })
    table.register({ method: 'GET', path: '/users/:id', handler: 'users' })

    const match = table.match('GET', '/users/42')

    expect(match.route?.handler).toBe('generic')
    expect(match.params).toEqual({ scope: 'users', id: '42' })
  })

  it('looks up global middleware independently of route matching', () => {
    const table = new HttpRouteTable<string, string>()
    table.use('*', 'global')
    table.use('/api/*', 'api')
    table.use('/assets/*', 'assets')
    table.register({
      method: 'GET',
      path: '/api/users/:id',
      handler: 'user',
      middlewares: ['route-auth'],
    })

    const matched = table.match('GET', '/api/users/42')
    const notFound = table.match('GET', '/api/missing')

    expect(matched.middlewares).toEqual(['global', 'api'])
    expect(matched.route?.middlewares).toEqual(['route-auth'])
    expect(notFound.route).toBeNull()
    expect(notFound.middlewares).toEqual(['global', 'api'])
    expect(table.lookupMiddlewares('/assets/app.js')).toEqual(['global', 'assets'])
  })
})
