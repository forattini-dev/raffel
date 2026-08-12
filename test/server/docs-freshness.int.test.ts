import { afterEach, describe, expect, it } from 'vitest'
import { createServer as createNodeHttpServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer } from '../../src/server/builder.js'
import {
  createApiKeyStrategy,
  createAuthMiddleware,
  createBearerStrategy,
  createCookieSessionStrategy,
} from '../../src/middleware/auth.js'
import { createOAuth2Strategy, createOIDCStrategy } from '../../src/middleware/auth/oauth2.js'
import { createClientCredentialsStrategy } from '../../src/middleware/auth/oauth2-client-credentials.js'
import { loadDiscovery } from '../../src/server/fs-routes/loader.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNodeHttpServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('no port')))
        return
      }
      const { port } = address
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

describe('API Documentation freshness', () => {
  let dir = ''
  let server: ReturnType<typeof createServer> | null = null

  afterEach(async () => {
    if (server?.isRunning) {
      await server.stop().catch(() => {})
    }
    server = null
    if (dir) {
      await rm(dir, { recursive: true, force: true })
      dir = ''
    }
  })

  it('keeps document access unavailable before docs handlers are mounted', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' }).enableUSD()

    expect(server.getUSDDocument()).toBeNull()
    expect(server.getOpenAPIDocument()).toBeNull()
  })

  it('mounts dynamic OpenAPI and USD format routes on the server builder', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' }).enableUSD({ basePath: '/docs' })
    await server.start()

    const openapi = await fetch(`http://127.0.0.1:${port}/docs/openapi.toon`)
    expect(openapi.status).toBe(200)
    expect(openapi.headers.get('content-type')).toBe('text/toon; charset=utf-8')

    const usd = await fetch(`http://127.0.0.1:${port}/docs/usd.yaml`)
    expect(usd.status).toBe(200)
    expect(usd.headers.get('content-type')).toBe('application/yaml; charset=utf-8')

    const unsupported = await fetch(`http://127.0.0.1:${port}/docs/usd.xml`)
    expect(unsupported.status).toBe(406)
  })

  it('preserves interactive authentication configured through enableUSD', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' }).enableUSD({
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
      defaultSecurity: [{ bearerAuth: [] }],
      authentication: {
        schemes: {
          bearerAuth: {
            strategy: 'operation',
            operationId: 'sessions.create',
            tokenPointers: { accessToken: '/accessToken' },
          },
        },
      },
    })
    await server.start()

    expect(server.getUSDDocument()?.['x-usd-authentication']).toEqual({
      schemes: {
        bearerAuth: {
          strategy: 'operation',
          operationId: 'sessions.create',
          tokenPointers: { accessToken: '/accessToken' },
        },
      },
    })
  })

  it('documents built-in authentication middleware without duplicate USD configuration', async () => {
    const port = await getFreePort()
    const auth = createAuthMiddleware({
      strategies: [
        createBearerStrategy({
          verify: async token => token === 'valid'
            ? { authenticated: true, principal: 'user-1' }
            : null,
        }),
      ],
    })
    server = createServer({ port, host: '127.0.0.1' })
      .use(auth)
      .enableUSD()
    server.procedure('profile.get').handler(async () => ({ id: 'user-1' }))
    await server.start()

    expect(server.getOpenAPIDocument()?.components?.securitySchemes).toEqual({
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    })
    expect(server.getOpenAPIDocument()?.security).toEqual([{ bearerAuth: [] }])
  })

  it('marks procedures exempted by global authentication as public', async () => {
    const port = await getFreePort()
    const auth = createAuthMiddleware({
      strategies: [createBearerStrategy({ verify: async () => null })],
      publicProcedures: ['health.*'],
    })
    server = createServer({ port, host: '127.0.0.1' }).use(auth).enableUSD()
    server.procedure('health.get').handler(async () => ({ ok: true }))
    server.procedure('profile.get').handler(async () => ({ id: 'user-1' }))
    await server.start()

    expect(server.getOpenAPIDocument()?.paths['/health/get']?.post?.security).toEqual([])
    expect(server.getOpenAPIDocument()?.paths['/profile/get']?.post?.security).toEqual([{ bearerAuth: [] }])
  })

  it('documents authentication middleware attached to one procedure', async () => {
    const port = await getFreePort()
    const auth = createAuthMiddleware({
      strategies: [createApiKeyStrategy({ verify: async () => null })],
    })
    server = createServer({ port, host: '127.0.0.1' }).enableUSD()
    server.procedure('profile.get').use(auth).handler(async () => ({ id: 'user-1' }))
    server.procedure('health.get').handler(async () => ({ ok: true }))
    await server.start()

    const document = server.getOpenAPIDocument()
    expect(document?.paths['/profile/get']?.post?.security).toEqual([{ apiKeyAuth: [] }])
    expect(document?.paths['/health/get']?.post?.security).toBeUndefined()
    expect(document?.security).toBeUndefined()
  })

  it('infers public security schemes for every built-in authentication strategy without secrets', async () => {
    const port = await getFreePort()
    const auth = createAuthMiddleware({
      strategies: [
        createApiKeyStrategy({ verify: async () => null, headerName: 'X-Partner-Key' }),
        createCookieSessionStrategy({ validate: async () => null, cookieName: 'sid' }),
        createOAuth2Strategy({
          provider: 'custom',
          clientId: 'docs-client',
          clientSecret: 'must-not-leak',
          redirectUri: 'https://app.example.com/callback',
          authorizationUrl: 'https://identity.example.com/authorize',
          tokenUrl: 'https://identity.example.com/token',
          userInfoUrl: 'https://identity.example.com/userinfo',
          scopes: ['profile:read'],
        }),
        createOIDCStrategy({
          issuer: 'https://identity.example.com',
          clientId: 'oidc-client',
          clientSecret: 'must-not-leak-either',
          redirectUri: 'https://app.example.com/callback',
        }),
        createClientCredentialsStrategy({
          tokenUrl: 'https://identity.example.com/token',
          clientId: 'service-client',
          clientSecret: 'also-secret',
          scope: ['tasks:read'],
        }),
      ],
    })
    server = createServer({ port, host: '127.0.0.1' }).use(auth).enableUSD()
    await server.start()

    const schemes = server.getOpenAPIDocument()?.components?.securitySchemes
    expect(schemes).toMatchObject({
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Partner-Key' },
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'sid' },
      oauth2: { type: 'oauth2' },
      oidc: {
        type: 'openIdConnect',
        openIdConnectUrl: 'https://identity.example.com/.well-known/openid-configuration',
      },
      clientCredentials: { type: 'oauth2' },
    })
    expect(JSON.stringify(schemes)).not.toContain('must-not-leak')
    expect(JSON.stringify(schemes)).not.toContain('also-secret')
  })

  it('documents authentication declared by file-system discovery', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-docs-auth-discovery-'))
    const httpDir = path.join(dir, 'http')
    await mkdir(path.join(httpDir, 'profile'), { recursive: true })
    await mkdir(path.join(httpDir, 'session'), { recursive: true })
    await mkdir(path.join(httpDir, 'health'), { recursive: true })
    await writeFile(path.join(httpDir, '_auth.ts'), `export default {
  strategy: 'api-key',
  verify: async (key) => key === 'valid' ? { principal: 'user-1' } : null,
}`)
    await writeFile(path.join(httpDir, 'profile', 'get.ts'), `
export const meta = { auth: 'required' }
export default async () => ({ id: 'user-1' })
`)
    await writeFile(path.join(httpDir, 'session', 'get.ts'), `
export const meta = { auth: 'optional' }
export default async () => ({ authenticated: false })
`)
    await writeFile(path.join(httpDir, 'health', 'get.ts'), `
export const meta = { auth: 'none' }
export default async () => ({ ok: true })
`)

    const port = await getFreePort()
    server = createServer({
      port,
      host: '127.0.0.1',
      discovery: { http: httpDir },
      extensions: ['.ts'],
    } as never).enableUSD()
    await server.start()

    const document = server.getOpenAPIDocument()
    expect(document?.components?.securitySchemes?.apiKeyAuth).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    })
    expect(document?.paths['/profile']?.get?.security).toEqual([{ apiKeyAuth: [] }])
    expect(document?.paths['/session']?.get?.security).toEqual([{ apiKeyAuth: [] }, {}])
    expect(document?.paths['/health']?.get?.security).toEqual([])
    expect(document?.security).toBeUndefined()
  })

  it('mounts docs after startup discovery and invalidates generated docs after a newer discovery revision', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-docs-freshness-'))
    const routesDir = path.join(dir, 'routes')
    await mkdir(path.join(routesDir, 'users'), { recursive: true })
    await writeFile(
      path.join(routesDir, 'users', 'get.js'),
      `export default async function () { return [{ id: 'u1' }] }`,
    )

    const port = await getFreePort()
    server = createServer({
      port,
      host: '127.0.0.1',
      discovery: {
        routes: [{ dir: routesDir, prefix: '/api' }],
      },
      extensions: ['.js'],
    } as never).enableUSD({
      basePath: '/docs',
      info: { title: 'Fresh Docs', version: '1.0.0' },
    })
    await server.start()

    const first = server.getOpenAPIDocument()
    expect(first?.paths['/api/users']?.get?.operationId).toBe('api/users/get')
    expect(server.getOpenAPIDocument()).toBe(first)

    const stateRes = await fetch(`http://127.0.0.1:${port}/docs/state.json`)
    expect(stateRes.status).toBe(200)
    const docsState = await stateRes.json()
    expect(docsState.api).toMatchObject({
      enabled: true,
      mounted: true,
      fresh: true,
      revision: 1,
      basePath: '/docs',
    })
    expect(docsState.api.endpoints.openApiJson).toBe('/docs/openapi.json')
    expect(docsState.api.routeCounts.total).toBeGreaterThan(0)
    expect(docsState.markdown).toMatchObject({
      enabled: false,
      mounted: false,
      fresh: true,
    })
    expect(server.preview().extensions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        namespace: 'docs-state',
        data: expect.objectContaining({
          api: expect.objectContaining({ revision: 1 }),
        }),
      }),
    ]))

    await mkdir(path.join(routesDir, 'projects'), { recursive: true })
    await writeFile(
      path.join(routesDir, 'projects', 'get.js'),
      `export default async function () { return [{ id: 'p1' }] }`,
    )
    const nextDiscovery = await loadDiscovery({
      baseDir: dir,
      discovery: {
        routes: [{ dir: routesDir, prefix: '/api' }],
      },
      extensions: ['.js'],
    })
    server.addDiscovery(nextDiscovery)

    const second = server.getOpenAPIDocument()
    expect(second).not.toBe(first)
    expect(second?.paths['/api/projects']?.get?.operationId).toBe('api/projects/get')

    const nextStateRes = await fetch(`http://127.0.0.1:${port}/docs/state.json`)
    const nextState = await nextStateRes.json()
    expect(nextState.api.revision).toBe(2)
    expect(nextState.api.routeCounts.total).toBeGreaterThan(docsState.api.routeCounts.total)
  })

  it('reports Markdown Documentation state independently from API documentation revisions', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'raffel-markdown-docs-state-'))
    const routesDir = path.join(dir, 'routes')
    const docsDir = path.join(dir, 'docs')
    await mkdir(path.join(routesDir, 'users'), { recursive: true })
    await mkdir(path.join(docsDir, 'guides'), { recursive: true })
    await writeFile(
      path.join(routesDir, 'users', 'get.js'),
      `export default async function () { return [{ id: 'u1' }] }`,
    )
    await writeFile(path.join(docsDir, 'README.md'), '# Home\n\nWelcome.')
    await writeFile(path.join(docsDir, 'guides', 'quickstart.md'), '# Quickstart\n\nStart here.')

    const port = await getFreePort()
    server = createServer({
      port,
      host: '127.0.0.1',
      discovery: {
        routes: [{ dir: routesDir, prefix: '/api' }],
      },
      extensions: ['.js'],
    } as never).enableUSD({
      basePath: '/docs',
      info: { title: 'Markdown State', version: '1.0.0' },
      docsDir,
    })
    await server.start()

    const firstStateRes = await fetch(`http://127.0.0.1:${port}/docs/state.json`)
    expect(firstStateRes.status).toBe(200)
    const firstState = await firstStateRes.json()

    expect(firstState.markdown).toMatchObject({
      enabled: true,
      mounted: true,
      fresh: true,
      revision: 1,
      basePath: '/docs',
      endpoints: {
        ui: '/docs',
        state: '/docs/state.json',
        assets: '/docs/-/assets/*',
      },
      paths: {
        routeBase: null,
        pages: ['/', '/guides/quickstart'],
        files: ['README.md', 'guides/quickstart.md'],
      },
      counts: {
        configured: 1,
        pages: 2,
        fileBackedPages: 2,
        explicitPages: 0,
      },
      staleReasons: [],
    })
    expect(firstState.markdown.updatedAt).toEqual(expect.any(String))
    expect(firstState.markdown.loadedAt).toEqual(expect.any(String))
    expect(firstState.markdown.mountedAt).toEqual(expect.any(String))

    await mkdir(path.join(routesDir, 'projects'), { recursive: true })
    await writeFile(
      path.join(routesDir, 'projects', 'get.js'),
      `export default async function () { return [{ id: 'p1' }] }`,
    )
    const nextDiscovery = await loadDiscovery({
      baseDir: dir,
      discovery: {
        routes: [{ dir: routesDir, prefix: '/api' }],
      },
      extensions: ['.js'],
    })
    server.addDiscovery(nextDiscovery)

    const secondStateRes = await fetch(`http://127.0.0.1:${port}/docs/state.json`)
    const secondState = await secondStateRes.json()
    expect(secondState.api.revision).toBe(firstState.api.revision + 1)
    expect(secondState.markdown.revision).toBe(firstState.markdown.revision)
    expect(secondState.markdown.loadedAt).toBe(firstState.markdown.loadedAt)
    expect(secondState.markdown.updatedAt).toBe(firstState.markdown.updatedAt)
    expect(secondState.markdown.counts).toEqual(firstState.markdown.counts)
    expect(secondState.markdown.paths).toEqual(firstState.markdown.paths)
  })

  it('does not expose docs state over HTTP when docs UI is not enabled', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })
    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/docs/state.json`)
    expect(res.status).not.toBe(200)
  })
})
