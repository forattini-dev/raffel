import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { generateUIHTML } from '../../src/docs/ui/html-builder.js'

function createReference(
  spec: Record<string, unknown>,
  url = 'https://docs.example.com/',
  ui: Record<string, unknown> = {},
): any {
  const html = generateUIHTML({
    basePath: '/docs',
    doc: spec as never,
    ui,
  })
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url,
  })
  const win = dom.window as any
  const runtime = win.document.querySelector('script[data-raffel-runtime="inline"]')
  if (runtime?.textContent) win.eval(runtime.textContent)
  return win
}

function renderReference(spec: Record<string, unknown>, url?: string): string {
  const win = createReference(spec, url)
  return win.document.getElementById('mainContent')?.innerHTML ?? ''
}

describe('HTTP reference documentation', () => {
  it('renders a referenced error schema instead of its JSON pointer', () => {
    const html = renderReference({
      openapi: '3.1.0',
      info: { title: 'Payments API', version: '1.0.0' },
      paths: {
        '/payments': {
          post: {
            summary: 'Create payment',
            responses: {
              '422': {
                description: 'Invalid payment',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/ApiError' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          ApiError: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', example: 'invalid_payment' },
              message: { type: 'string', example: 'Card was declined' },
            },
          },
        },
      },
    })

    expect(html).toContain('invalid_payment')
    expect(html).toContain('Card was declined')
    expect(html).toContain('>code<')
    expect(html).toContain('>message<')
    expect(html).not.toContain('$ref: ApiError')
  })

  it('renders recursive schemas without crashing the reference page', () => {
    const html = renderReference({
      openapi: '3.1.0',
      info: { title: 'Tree API', version: '1.0.0' },
      paths: {
        '/tree': {
          get: {
            responses: {
              '200': {
                description: 'A tree node',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/TreeNode' },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          TreeNode: {
            type: 'object',
            properties: {
              value: { type: 'string', example: 'root' },
              child: { $ref: '#/components/schemas/TreeNode' },
            },
          },
        },
      },
    })

    expect(html).toContain('root')
    expect(html).toContain('Recursive schema: TreeNode')
  })

  it('keeps the page usable when a local schema reference is invalid', () => {
    const html = renderReference({
      openapi: '3.1.0',
      info: { title: 'Broken API', version: '1.0.0' },
      paths: {
        '/broken': {
          get: {
            responses: {
              '500': {
                description: 'Broken reference',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Missing' },
                  },
                },
              },
            },
          },
        },
      },
    })

    expect(html).toContain('Broken reference')
    expect(html).toContain('Unresolved schema reference: Missing')
  })

  it('lists every response media type with named and line-oriented examples', () => {
    const records = [
      { id: 1, name: 'Ada' },
      { id: 2, name: 'Lin' },
    ]
    const html = renderReference({
      openapi: '3.1.0',
      info: { title: 'Exports API', version: '1.0.0' },
      paths: {
        '/exports': {
          get: {
            responses: {
              '200': {
                description: 'Export rows',
                content: {
                  'application/json': {
                    examples: {
                      primary: { summary: 'Primary rows', value: records },
                      backup: { summary: 'Backup rows', value: [{ id: 3, name: 'Kay' }] },
                    },
                  },
                  'text/csv': { example: records },
                  'text/toon': { example: records },
                  'application/x-ndjson': { example: records },
                  'text/toonl': { example: records },
                },
              },
            },
          },
        },
      },
    })

    expect(html).toContain('application/json')
    expect(html).toContain('text/csv')
    expect(html).toContain('text/toon')
    expect(html).toContain('application/x-ndjson')
    expect(html).toContain('text/toonl')
    expect(html).toContain('Primary rows')
    expect(html).toContain('Backup rows')
    expect(html).toContain('id,name')
    expect(html).toContain('[2]{id,name}:')
    expect(html).toContain('{"id":1,"name":"Ada"}')
    expect(html).toContain('[]{id,name}:')
    expect(html).toContain('[=2]')
  })

  it('requires an explicit flat-record example before presenting TOONL', () => {
    const html = renderReference({
      openapi: '3.1.0',
      info: { title: 'Streams API', version: '1.0.0' },
      paths: {
        '/events': {
          get: {
            responses: {
              '200': {
                description: 'Events',
                content: {
                  'text/toonl': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { id: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    expect(html).toContain('TOONL examples require an explicit array of flat object records.')
    expect(html).not.toContain('[]{id}:')
  })

  it('shows highlighted request samples in the supported language order', () => {
    const html = renderReference({
      openapi: '3.1.0',
      info: { title: 'Samples API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/widgets': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string', example: 'Compass' } },
                  },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    })

    const labels = [...html.matchAll(/class="code-tab(?: active)?">([^<]+)</g)].map(match => match[1])
    expect(labels).toEqual(['cURL', 'TypeScript', 'Rust', 'Python', 'Go'])
    expect(html).toContain('class="language-bash"')
    expect(html).toContain('class="language-typescript"')
    expect(html).toContain('class="language-rust"')
    expect(html).toContain('class="language-python"')
    expect(html).toContain('class="language-go"')
    expect(html).toContain('fetch("https://api.example.com/widgets"')
    expect(html).toContain('http.NewRequest(')
  })

  it('renders authentication before routes and infers the viewed environment', () => {
    const html = renderReference({
      openapi: '3.1.0',
      info: { title: 'Secure API', version: '1.0.0' },
      servers: [
        {
          url: 'https://api.{environment}.example.com',
          description: '{environment}',
          variables: {
            environment: {
              default: 'production',
              enum: ['production', 'staging'],
            },
          },
        },
      ],
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          partnerKey: { type: 'apiKey', in: 'header', name: 'X-Partner-Key' },
        },
      },
      paths: {
        '/profile': {
          get: {
            security: [{ bearerAuth: [] }],
            responses: { '200': { description: 'Profile' } },
          },
        },
      },
    }, 'https://api.staging.example.com/docs')

    expect(html.indexOf('authentication-section')).toBeLessThan(html.indexOf('endpoint-section'))
    expect(html).toContain('Authentication')
    expect(html).toContain('Current environment')
    expect(html).toContain('https://api.staging.example.com')
    expect(html).toContain('value="https://api.staging.example.com" selected')
    expect(html).toContain('bearerAuth')
    expect(html).toContain('Bearer token')
    expect(html).toContain('partnerKey')
    expect(html).toContain('X-Partner-Key')
  })

  it('resolves relative OpenAPI servers against the documentation origin', () => {
    const html = renderReference({
      openapi: '3.1.0',
      info: { title: 'Relative API', version: '1.0.0' },
      servers: [{ url: '/api', description: 'Same-origin API' }],
      paths: {
        '/health': {
          get: { responses: { '200': { description: 'Healthy' } } },
        },
      },
    }, 'https://docs.example.com/reference')

    expect(html).toContain('https://docs.example.com/api/health')
    expect(html).not.toContain('curl -X GET "/api/health"')
  })

  it('partitions credentials by environment and shares them with protected request samples', () => {
    const win = createReference({
      openapi: '3.1.0',
      info: { title: 'Secure API', version: '1.0.0' },
      servers: [
        { url: 'https://staging.example.com', description: 'Staging' },
        { url: 'https://api.example.com', description: 'Production' },
      ],
      security: [{ bearerAuth: [] }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      paths: {
        '/profile': {
          get: {
            responses: { '200': { description: 'Profile' } },
          },
        },
      },
    }, 'https://staging.example.com/docs')

    const stagingToken = win.document.querySelector('[data-scheme="bearerAuth"] input[name="accessToken"]')
    stagingToken.value = 'stage-token'
    win.document.querySelector('[data-scheme="bearerAuth"] .auth-save').click()

    expect(win.document.getElementById('mainContent').textContent).toContain('Authorization: Bearer stage-token')

    const environment = win.document.querySelector('.auth-environment-select')
    environment.value = 'https://api.example.com'
    environment.dispatchEvent(new win.Event('change'))
    expect(win.document.querySelector('[data-scheme="bearerAuth"] input[name="accessToken"]').value).toBe('')
    expect(win.document.getElementById('mainContent').textContent).not.toContain('stage-token')

    const productionEnvironment = win.document.querySelector('.auth-environment-select')
    productionEnvironment.value = 'https://staging.example.com'
    productionEnvironment.dispatchEvent(new win.Event('change'))
    expect(win.document.querySelector('[data-scheme="bearerAuth"] input[name="accessToken"]').value).toBe('stage-token')
  })

  it('uses the configured OpenAPI security alternative for samples and execution', async () => {
    const win = createReference({
      openapi: '3.1.0',
      info: { title: 'Alternative Auth API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      security: [{ bearerAuth: [] }, { partnerKey: [] }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
          partnerKey: { type: 'apiKey', in: 'header', name: 'X-Partner-Key' },
        },
      },
      paths: {
        '/profile': {
          get: { responses: { '200': { description: 'Profile' } } },
        },
      },
    }, 'https://api.example.com/docs', { tryItOut: true })
    const partnerKey = win.document.querySelector('[data-scheme="partnerKey"] input[name="apiKey"]')
    partnerKey.value = 'partner-secret'
    win.document.querySelector('[data-scheme="partnerKey"] .auth-save').click()
    const requests: Array<{ url: string; init: RequestInit }> = []
    win.fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return { ok: true, status: 200, statusText: 'OK', headers: new Map(), text: async () => '{}' }
    }) as any

    expect(win.document.getElementById('mainContent').textContent).toContain('X-Partner-Key: partner-secret')
    win.document.querySelector('.http-try-run').click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(requests).toHaveLength(1)
    expect(new Headers(requests[0].init.headers).get('x-partner-key')).toBe('partner-secret')
    expect(new Headers(requests[0].init.headers).get('authorization')).toBeNull()
  })

  it('requests a proprietary token by operationId and extracts credentials with JSON Pointers', async () => {
    const win = createReference({
      openapi: '3.1.0',
      info: { title: 'Sessions API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com', description: 'Production' }],
      security: [{ sessionAuth: [] }],
      components: {
        securitySchemes: {
          sessionAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      'x-usd-authentication': {
        schemes: {
          sessionAuth: {
            strategy: 'operation',
            operationId: 'createSession',
            tokenPointers: {
              accessToken: '/tokens/access',
              refreshToken: '/tokens/refresh',
              expiresIn: '/tokens/expires_in',
            },
          },
        },
      },
      paths: {
        '/sessions': {
          post: {
            operationId: 'createSession',
            security: [],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      email: { type: 'string', example: 'ada@example.com' },
                      password: { type: 'string', example: 'secret' },
                    },
                  },
                },
              },
            },
            responses: { '200': { description: 'Session' } },
          },
        },
        '/profile': {
          get: {
            operationId: 'getProfile',
            responses: { '200': { description: 'Profile' } },
          },
        },
      },
    }, 'https://api.example.com/docs')
    const requests: Array<{ url: string; init: RequestInit }> = []
    win.fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tokens: { access: 'fresh-token', refresh: 'refresh-token', expires_in: 3600 },
        }),
      }
    }) as any

    expect(win.document.querySelector('.auth-operation-body').value).toContain('ada@example.com')
    win.document.querySelector('[data-scheme="sessionAuth"] .auth-request-token').click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://api.example.com/sessions')
    expect(requests[0].init.method).toBe('POST')
    expect(String(requests[0].init.body)).toContain('ada@example.com')
    expect(win.document.getElementById('mainContent').textContent).toContain('Authorization: Bearer fresh-token')
  })

  it('uses the configured proxy to request proprietary credentials', async () => {
    const win = createReference({
      openapi: '3.1.0',
      info: { title: 'Sessions API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      security: [{ sessionAuth: [] }],
      components: {
        securitySchemes: {
          sessionAuth: { type: 'http', scheme: 'bearer' },
        },
      },
      'x-usd-authentication': {
        schemes: {
          sessionAuth: {
            strategy: 'operation',
            operationId: 'createSession',
            tokenPointers: { accessToken: '/accessToken' },
          },
        },
      },
      paths: {
        '/sessions': {
          post: {
            operationId: 'createSession',
            security: [],
            requestBody: { content: { 'application/json': { example: { email: 'ada@example.com' } } } },
            responses: { '200': { description: 'Session' } },
          },
        },
        '/profile': {
          get: { responses: { '200': { description: 'Profile' } } },
        },
      },
    }, 'https://docs.example.com/docs', { tryItOut: { mode: 'proxy' } })
    const requests: Array<{ url: string; init: RequestInit }> = []
    win.fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: '{"accessToken":"proxy-token"}',
        }),
      }
    }) as any

    win.document.querySelector('.auth-request-token').click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('/docs/-/request')
    expect(JSON.parse(String(requests[0].init.body))).toMatchObject({
      url: 'https://api.example.com/sessions',
      method: 'POST',
      body: '{"email":"ada@example.com"}',
    })
    expect(win.document.getElementById('mainContent').textContent).toContain('Authorization: Bearer proxy-token')
  })

  it('supports every OAuth grant and keeps the client secret in session storage', async () => {
    const win = createReference({
      openapi: '3.1.0',
      info: { title: 'OAuth API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      security: [{ oauth: [] }],
      components: {
        securitySchemes: {
          oauth: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: 'https://identity.example.com/authorize',
                tokenUrl: 'https://identity.example.com/token',
                scopes: { read: 'Read data' },
              },
              implicit: {
                authorizationUrl: 'https://identity.example.com/authorize',
                scopes: { read: 'Read data' },
              },
              clientCredentials: {
                tokenUrl: 'https://identity.example.com/token',
                scopes: { read: 'Read data' },
              },
              password: {
                tokenUrl: 'https://identity.example.com/token',
                scopes: { read: 'Read data' },
              },
            },
          },
          oidc: {
            type: 'openIdConnect',
            openIdConnectUrl: 'https://identity.example.com/.well-known/openid-configuration',
          },
        },
      },
      paths: {
        '/profile': {
          get: { responses: { '200': { description: 'Profile' } } },
        },
      },
    }, 'https://api.example.com/docs')
    const requests: Array<{ url: string; init: RequestInit }> = []
    win.fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'oauth-token', refresh_token: 'oauth-refresh', expires_in: 600 }),
      }
    }) as any

    const oauth = win.document.querySelector('[data-scheme="oauth"]')
    expect(oauth.textContent).toContain('Authorization code')
    expect(oauth.textContent).toContain('Implicit')
    expect(oauth.textContent).toContain('Client credentials')
    expect(oauth.textContent).toContain('Resource owner password')
    expect(win.document.querySelector('[data-scheme="oidc"]').textContent).toContain('OpenID discovery')

    oauth.querySelector('[data-oauth-flow="clientCredentials"] input[name="clientId"]').value = 'docs-client'
    oauth.querySelector('[data-oauth-flow="clientCredentials"] input[name="clientSecret"]').value = 'session-secret'
    oauth.querySelector('[data-oauth-flow="clientCredentials"] .auth-oauth-token').click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(requests[0].url).toBe('https://identity.example.com/token')
    expect(String(requests[0].init.body)).toContain('grant_type=client_credentials')
    expect(String(requests[0].init.body)).toContain('client_secret=session-secret')
    expect(win.document.getElementById('mainContent').textContent).toContain('Authorization: Bearer oauth-token')
    expect([...Array(win.localStorage.length)].map((_, index) => win.localStorage.key(index))).not.toContainEqual(expect.stringContaining('oauth'))
    expect([...Array(win.sessionStorage.length)].map((_, index) => win.sessionStorage.getItem(win.sessionStorage.key(index)))).toContainEqual(expect.stringContaining('session-secret'))
  })

  it('uses PKCE for the browser authorization-code flow', async () => {
    const win = createReference({
      openapi: '3.1.0',
      info: { title: 'OAuth API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      security: [{ oauth: [] }],
      components: {
        securitySchemes: {
          oauth: {
            type: 'oauth2',
            flows: {
              authorizationCode: {
                authorizationUrl: 'https://identity.example.com/authorize',
                tokenUrl: 'https://identity.example.com/token',
                scopes: { read: 'Read data' },
              },
            },
          },
        },
      },
      paths: {
        '/profile': {
          get: { responses: { '200': { description: 'Profile' } } },
        },
      },
    }, 'https://docs.example.com/docs')
    Object.defineProperty(win.crypto, 'subtle', {
      configurable: true,
      value: {
        digest: async () => Uint8Array.from({ length: 32 }, (_, index) => index).buffer,
      },
    })
    let authorizationUrl = ''
    win.open = (url = '') => {
      authorizationUrl = String(url)
      return {
      location: { replace: (url: string) => { authorizationUrl = url } },
      close: () => {},
      }
    }
    const requests: Array<{ url: string; init: RequestInit }> = []
    win.fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'oauth-token' }),
      }
    }) as any

    const flow = win.document.querySelector('[data-oauth-flow="authorizationCode"]')
    flow.querySelector('input[name="clientId"]').value = 'docs-client'
    flow.querySelector('.auth-oauth-authorize').click()
    await new Promise(resolve => setTimeout(resolve, 0))

    const authorization = new URL(authorizationUrl)
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const pendingKey = [...Array(win.sessionStorage.length)]
      .map((_, index) => win.sessionStorage.key(index))
      .find(key => key?.endsWith(':pending'))
    const pending = JSON.parse(win.sessionStorage.getItem(pendingKey))
    expect(pending.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/)

    win.dispatchEvent(new win.MessageEvent('message', {
      origin: win.location.origin,
      data: {
        type: 'raffel-oauth-callback',
        params: new URLSearchParams({ code: 'authorization-code' }).toString(),
      },
    }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(requests).toHaveLength(0)

    win.dispatchEvent(new win.MessageEvent('message', {
      origin: win.location.origin,
      data: {
        type: 'raffel-oauth-callback',
        params: new URLSearchParams({ code: 'authorization-code', state: pending.state }).toString(),
      },
    }))
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(requests.length).toBeGreaterThanOrEqual(1)
    requests.forEach(request => {
      expect(request.url).toBe('https://identity.example.com/token')
      expect(String(request.init.body)).toContain(`code_verifier=${encodeURIComponent(pending.codeVerifier)}`)
    })
  })

  it('executes the structured fetch request only when try-it-out is enabled', async () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'Try API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/health': {
          get: { responses: { '200': { description: 'Healthy' } } },
        },
      },
    }
    const disabled = createReference(spec, 'https://docs.example.com/')
    expect(disabled.document.querySelector('.http-try-run')).toBeNull()

    const win = createReference(spec, 'https://docs.example.com/', { tryItOut: true })
    const requests: Array<{ url: string; init: RequestInit }> = []
    win.fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Map([['content-type', 'application/json']]),
        text: async () => '{"status":"healthy"}',
      }
    }) as any

    win.document.querySelector('.http-try-run').click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://api.example.com/health')
    expect(requests[0].init.method).toBe('GET')
    expect(win.document.querySelector('.http-try-result').textContent).toContain('200 OK')
    expect(win.document.querySelector('.http-try-result').textContent).toContain('healthy')
  })

  it('refreshes an expiring credential before one business request without retrying it', async () => {
    const win = createReference({
      openapi: '3.1.0',
      info: { title: 'Refresh API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      security: [{ sessionAuth: [] }],
      components: { securitySchemes: { sessionAuth: { type: 'http', scheme: 'bearer' } } },
      'x-usd-authentication': {
        schemes: {
          sessionAuth: {
            strategy: 'operation',
            operationId: 'createSession',
            refreshOperationId: 'refreshSession',
            refreshRequestBody: { refreshToken: '$refreshToken' },
            tokenPointers: {
              accessToken: '/accessToken',
              refreshToken: '/refreshToken',
              expiresIn: '/expiresIn',
            },
          },
        },
      },
      paths: {
        '/sessions': {
          post: {
            operationId: 'createSession',
            security: [],
            requestBody: { content: { 'application/json': { example: { email: 'ada@example.com' } } } },
            responses: { '200': { description: 'Session' } },
          },
        },
        '/sessions/refresh': {
          post: {
            operationId: 'refreshSession',
            security: [],
            responses: { '200': { description: 'Refreshed' } },
          },
        },
        '/profile': {
          get: {
            operationId: 'getProfile',
            responses: { '200': { description: 'Profile' } },
          },
        },
      },
    }, 'https://api.example.com/docs', { tryItOut: true })
    const requests: Array<{ url: string; init: RequestInit }> = []
    win.fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      if (url.endsWith('/sessions')) return {
        ok: true, status: 200,
        json: async () => ({ accessToken: 'expiring', refreshToken: 'refresh-1', expiresIn: 1 }),
      }
      if (url.endsWith('/sessions/refresh')) return {
        ok: true, status: 200,
        json: async () => ({ accessToken: 'renewed', refreshToken: 'refresh-2', expiresIn: 3600 }),
      }
      return {
        ok: true, status: 200, statusText: 'OK', headers: new Map(),
        text: async () => '{"id":"user_1"}',
      }
    }) as any

    win.document.querySelector('.auth-request-token').click()
    await new Promise(resolve => setTimeout(resolve, 0))
    const profile = [...win.document.querySelectorAll('.endpoint-section')]
      .find((section: any) => section.textContent.includes('/profile')) as any
    profile.querySelector('.http-try-run').click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(requests.map(request => request.url)).toEqual([
      'https://api.example.com/sessions',
      'https://api.example.com/sessions/refresh',
      'https://api.example.com/profile',
    ])
    expect(requests.filter(request => request.url.endsWith('/profile'))).toHaveLength(1)
    expect(new Headers(requests[2].init.headers).get('authorization')).toBe('Bearer renewed')
  })

  it('documents server variables and deprecated operations', () => {
    const html = renderReference({
      openapi: '3.1.0',
      info: { title: 'Versioned API', version: '1.0.0' },
      servers: [{
        url: 'https://{region}.example.com/{version}',
        description: 'Regional API',
        variables: {
          region: { default: 'us', enum: ['us', 'eu'], description: 'Data residency region' },
          version: { default: 'v2', description: 'API version' },
        },
      }],
      paths: {
        '/legacy': {
          get: {
            summary: 'Legacy endpoint',
            deprecated: true,
            responses: { '200': { description: 'Legacy response' } },
          },
        },
      },
    })

    expect(html).toContain('Server variables')
    expect(html).toContain('Data residency region')
    expect(html).toContain('default: us')
    expect(html).toContain('allowed: us, eu')
    expect(html).toContain('endpoint-deprecated')
    expect(html).toContain('Deprecated')
  })

  it('renders named request examples and response links', () => {
    const html = renderReference({
      openapi: '3.1.0',
      info: { title: 'Examples API', version: '1.0.0' },
      paths: {
        '/payments': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  examples: {
                    minimal: { summary: 'Minimal payment', value: { amount: 100 } },
                    complete: { summary: 'Complete payment', value: { amount: 100, currency: 'BRL' } },
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created',
                links: {
                  receipt: {
                    operationId: 'getReceipt',
                    description: 'Fetch the generated receipt',
                    parameters: { paymentId: '$response.body#/id' },
                  },
                },
              },
            },
          },
        },
      },
    })

    expect(html).toContain('Request examples')
    expect(html).toContain('Minimal payment')
    expect(html).toContain('Complete payment')
    expect(html).toContain('Response links')
    expect(html).toContain('receipt')
    expect(html).toContain('getReceipt')
    expect(html).toContain('Fetch the generated receipt')
  })

  it('renders callbacks and OpenAPI webhooks as read-only contracts', () => {
    const html = renderReference({
      openapi: '3.1.0',
      info: { title: 'Events API', version: '1.0.0' },
      webhooks: {
        paymentStatus: {
          post: {
            summary: 'Payment status changed',
            requestBody: {
              content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' } } } } },
            },
            responses: { '204': { description: 'Accepted' } },
          },
        },
      },
      paths: {
        '/subscriptions': {
          post: {
            summary: 'Create subscription',
            callbacks: {
              onEvent: {
                '{$request.body#/callbackUrl}': {
                  post: {
                    summary: 'Deliver event',
                    responses: { '202': { description: 'Received' } },
                  },
                },
              },
            },
            responses: { '201': { description: 'Subscribed' } },
          },
        },
      },
    })

    expect(html).toContain('Webhooks')
    expect(html).toContain('paymentStatus')
    expect(html).toContain('Payment status changed')
    expect(html).toContain('Callbacks')
    expect(html).toContain('onEvent')
    expect(html).toContain('{$request.body#/callbackUrl}')
    expect(html).toContain('Deliver event')
    expect(html).toContain('Read-only')
  })

  it('uses parameter examples in the shared sample and execution request', async () => {
    const win = createReference({
      openapi: '3.1.0',
      info: { title: 'Parameters API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/widgets/{id}': {
          get: {
            parameters: [
              { name: 'id', in: 'path', required: true, example: 'widget 1', schema: { type: 'string' } },
              { name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } },
              { name: 'X-Trace', in: 'header', example: 'trace-1', schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'Widget' } },
          },
        },
      },
    }, 'https://docs.example.com/', { tryItOut: true })
    const requests: Array<{ url: string; init: RequestInit }> = []
    win.fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init })
      return { ok: true, status: 200, statusText: 'OK', headers: new Map(), text: async () => '{}' }
    }) as any

    expect(win.document.getElementById('mainContent').textContent).toContain('https://api.example.com/widgets/widget%201?limit=10')
    expect(win.document.getElementById('mainContent').textContent).toContain('X-Trace: trace-1')
    win.document.querySelector('.http-try-run').click()
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(requests[0].url).toBe('https://api.example.com/widgets/widget%201?limit=10')
    expect(new Headers(requests[0].init.headers).get('x-trace')).toBe('trace-1')
  })

  it('inherits path-item parameters and lets operation parameters override them', () => {
    const html = renderReference({
      openapi: '3.1.0',
      info: { title: 'Parameters API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      components: {
        parameters: {
          locale: { name: 'locale', in: 'query', example: 'pt-BR', schema: { type: 'string' } },
        },
      },
      paths: {
        '/widgets/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, example: 'path-id', schema: { type: 'string' } },
            { $ref: '#/components/parameters/locale' },
          ],
          get: {
            parameters: [
              { name: 'id', in: 'path', required: true, example: 'operation-id', schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'Widget' } },
          },
        },
      },
    })

    expect(html).toContain('https://api.example.com/widgets/operation-id?locale=pt-BR')
    expect(html).not.toContain('/widgets/path-id')
  })
})
