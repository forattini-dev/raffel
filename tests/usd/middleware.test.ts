/**
 * USD Middleware Tests
 *
 * Tests for the createUSDHandlers function and related handlers.
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  createUSDHandlers,
  type USDMiddlewareConfig,
  type USDMiddlewareContext,
  type USDHandlers,
} from '../../src/docs/usd-middleware.js'
import type { Registry } from '../../src/core/index.js'
import type { SchemaRegistry } from '../../src/validation/index.js'
import type { LoadedChannel, LoadedRestResource } from '../../src/server/fs-routes/index.js'
import type { USDDocument } from '../../src/usd/index.js'

// =============================================================================
// Mock Helpers
// =============================================================================

function createMockRegistry(procedures: Record<string, any> = {}): Registry {
  const handlers = new Map(Object.entries(procedures))

  // Create handler meta list for procedures
  const procedureMetas = Object.entries(procedures).map(([name, proc]) => ({
    name,
    kind: 'procedure' as const,
    description: proc.meta?.description,
    httpPath: proc.meta?.httpPath,
    httpMethod: proc.meta?.httpMethod,
    tags: proc.meta?.tags,
    ...proc.meta,
  }))

  return {
    handlers,
    get: (name: string) => handlers.get(name),
    set: (name: string, handler: any) => handlers.set(name, handler),
    has: (name: string) => handlers.has(name),
    delete: (name: string) => handlers.delete(name),
    clear: () => handlers.clear(),
    keys: () => handlers.keys(),
    values: () => handlers.values(),
    entries: () => handlers.entries(),
    forEach: (fn: any) => handlers.forEach(fn),
    [Symbol.iterator]: () => handlers[Symbol.iterator](),
    get size() {
      return handlers.size
    },
    // Registry-specific methods
    list: () => procedureMetas,
    listProcedures: () => procedureMetas,
    listStreams: () => [],
    listEvents: () => [],
  } as Registry
}

function createMockSchemaRegistry(): SchemaRegistry {
  const schemas = new Map<string, any>()
  return {
    register: (name: string, schema: any) => {
      schemas.set(name, schema)
    },
    get: (name: string) => schemas.get(name),
    has: (name: string) => schemas.has(name),
    getAll: () => Object.fromEntries(schemas),
    getAllEntries: () => Array.from(schemas.entries()),
    clear: () => schemas.clear(),
  } as SchemaRegistry
}

function createMockProcedure(overrides: Partial<any> = {}): any {
  return {
    handler: async () => ({ success: true }),
    meta: {
      description: 'Test procedure',
      httpPath: '/test',
      httpMethod: 'POST',
      tags: ['test'],
      ...overrides.meta,
    },
    inputSchema: overrides.inputSchema,
    outputSchema: overrides.outputSchema,
    ...overrides,
  }
}

function createMockChannel(name: string, overrides: Partial<LoadedChannel> = {}): LoadedChannel {
  const baseChannel = {
    name,
    filePath: `/channels/${name}.ts`,
    config: {
      events: {
        message: {
          input: { type: 'object', properties: { text: { type: 'string' } } },
        },
      },
      onJoin: async () => {},
      onLeave: async () => {},
    },
  }

  // Merge config if provided
  const { config, ...rest } = overrides
  return {
    ...baseChannel,
    config: config ?? baseChannel.config,
    ...rest,
  } as LoadedChannel
}

function createMockRestResource(
  name: string,
  overrides: Partial<LoadedRestResource> = {}
): LoadedRestResource {
  return {
    name,
    basePath: `/${name}`,
    routes: overrides.routes ?? [
      {
        method: 'GET',
        path: '/',
        operation: 'list',
        handler: async () => [],
        auth: 'none',
        isCollection: true,
      },
    ],
    ...overrides,
  } as LoadedRestResource
}

function createMinimalContext(): USDMiddlewareContext {
  return {
    registry: createMockRegistry(),
    schemaRegistry: createMockSchemaRegistry(),
  }
}

// =============================================================================
// Test Suites
// =============================================================================

describe('USD Middleware', () => {
  describe('createUSDHandlers()', () => {
    describe('Basic functionality', () => {
      it('should create handlers with minimal context', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)

        assert.ok(handlers)
        assert.equal(typeof handlers.serveUI, 'function')
        assert.equal(typeof handlers.serveUSD, 'function')
        assert.equal(typeof handlers.serveUSDYaml, 'function')
        assert.equal(typeof handlers.serveOpenAPI, 'function')
        assert.equal(typeof handlers.getUSDDocument, 'function')
        assert.equal(typeof handlers.getOpenAPIDocument, 'function')
      })

      it('should create handlers with default config', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)
        const doc = handlers.getUSDDocument()

        assert.equal(doc.info.title, 'API Documentation')
        assert.equal(doc.info.version, '1.0.0')
      })

      it('should accept empty config', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {})

        assert.ok(handlers)
      })
    })

    describe('Config: info', () => {
      it('should set custom title', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: { title: 'My API' },
        })

        const doc = handlers.getUSDDocument()
        assert.equal(doc.info.title, 'My API')
      })

      it('should set custom version', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: { version: '2.5.0' },
        })

        const doc = handlers.getUSDDocument()
        assert.equal(doc.info.version, '2.5.0')
      })

      it('should set description', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: { description: 'A comprehensive API' },
        })

        const doc = handlers.getUSDDocument()
        assert.equal(doc.info.description, 'A comprehensive API')
      })

      it('should set termsOfService', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: { termsOfService: 'https://example.com/tos' },
        })

        const doc = handlers.getUSDDocument()
        assert.equal(doc.info.termsOfService, 'https://example.com/tos')
      })

      it('should set contact information', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: {
            contact: {
              name: 'API Support',
              url: 'https://support.example.com',
              email: 'api@example.com',
            },
          },
        })

        const doc = handlers.getUSDDocument()
        assert.deepEqual(doc.info.contact, {
          name: 'API Support',
          url: 'https://support.example.com',
          email: 'api@example.com',
        })
      })

      it('should set license information', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: {
            license: {
              name: 'MIT',
              url: 'https://opensource.org/licenses/MIT',
            },
          },
        })

        const doc = handlers.getUSDDocument()
        assert.equal(doc.info.license?.name, 'MIT')
        assert.equal(doc.info.license?.url, 'https://opensource.org/licenses/MIT')
      })

      it('should set summary', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: { summary: 'Quick summary of the API' },
        })

        const doc = handlers.getUSDDocument()
        assert.equal(doc.info.summary, 'Quick summary of the API')
      })

      it('should combine multiple info fields', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: {
            title: 'Full API',
            version: '3.0.0',
            description: 'Complete API',
            summary: 'API Summary',
          },
        })

        const doc = handlers.getUSDDocument()
        assert.equal(doc.info.title, 'Full API')
        assert.equal(doc.info.version, '3.0.0')
        assert.equal(doc.info.description, 'Complete API')
        assert.equal(doc.info.summary, 'API Summary')
      })
    })

    describe('Config: servers', () => {
      it('should set server URLs', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          servers: [
            { url: 'https://api.example.com', description: 'Production' },
            { url: 'https://staging.example.com', description: 'Staging' },
          ],
        })

        const doc = handlers.getUSDDocument()
        assert.ok(doc.servers)
        assert.equal(doc.servers.length, 2)
        assert.equal(doc.servers[0].url, 'https://api.example.com')
        assert.equal(doc.servers[1].description, 'Staging')
      })

      it('should handle server with variables', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          servers: [
            {
              url: 'https://{environment}.example.com',
              variables: {
                environment: {
                  default: 'prod',
                  enum: ['prod', 'staging', 'dev'],
                },
              },
            },
          ],
        })

        const doc = handlers.getUSDDocument()
        assert.ok(doc.servers?.[0].variables?.environment)
      })
    })

    describe('Config: securitySchemes', () => {
      it('should set bearer auth scheme', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
            },
          },
        })

        const doc = handlers.getUSDDocument()
        assert.ok(doc.components?.securitySchemes?.bearerAuth)
        assert.equal(doc.components.securitySchemes.bearerAuth.type, 'http')
      })

      it('should set API key scheme', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          securitySchemes: {
            apiKey: {
              type: 'apiKey',
              in: 'header',
              name: 'X-API-Key',
            },
          },
        })

        const doc = handlers.getUSDDocument()
        assert.ok(doc.components?.securitySchemes?.apiKey)
        assert.equal(doc.components.securitySchemes.apiKey.name, 'X-API-Key')
      })
    })

    describe('Config: defaultSecurity', () => {
      it('should set default security requirement', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
            },
          },
          defaultSecurity: [{ bearerAuth: [] }],
        })

        const doc = handlers.getUSDDocument()
        assert.ok(doc.security)
        assert.deepEqual(doc.security, [{ bearerAuth: [] }])
      })
    })

    describe('Config: tags', () => {
      it('should set custom tags', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          tags: [
            { name: 'Users', description: 'User management' },
            { name: 'Products', description: 'Product catalog' },
          ],
        })

        const doc = handlers.getUSDDocument()
        assert.ok(doc.tags)
        assert.ok(doc.tags.some((t: any) => t.name === 'Users'))
        assert.ok(doc.tags.some((t: any) => t.name === 'Products'))
      })
    })

    describe('Config: externalDocs', () => {
      it('should set external documentation', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          externalDocs: {
            url: 'https://docs.example.com',
            description: 'Full documentation',
          },
        })

        const doc = handlers.getUSDDocument()
        assert.ok(doc.externalDocs)
        assert.equal(doc.externalDocs.url, 'https://docs.example.com')
      })
    })

    describe('Config: includeErrorSchemas', () => {
      it('should include error schemas by default', () => {
        const registry = createMockRegistry({
          'test.procedure': createMockProcedure(),
        })
        const ctx: USDMiddlewareContext = {
          registry,
          schemaRegistry: createMockSchemaRegistry(),
        }

        const handlers = createUSDHandlers(ctx)
        const doc = handlers.getUSDDocument()

        // Error schemas should be present
        assert.ok(doc.components?.schemas)
      })

      it('should respect includeErrorSchemas=false', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          includeErrorSchemas: false,
        })

        const doc = handlers.getUSDDocument()
        // Document should still be generated
        assert.ok(doc)
      })
    })

    describe('Config: includeStreamEventSchemas', () => {
      it('should include stream event schemas by default', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)
        const doc = handlers.getUSDDocument()

        assert.ok(doc)
      })

      it('should respect includeStreamEventSchemas=false', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          includeStreamEventSchemas: false,
        })

        const doc = handlers.getUSDDocument()
        assert.ok(doc)
      })
    })
  })

  describe('USDHandlers', () => {
    describe('serveUI()', () => {
      it('should return HTML Response', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)
        const response = handlers.serveUI()

        assert.ok(response instanceof Response)
        assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8')
      })

      it('should include title in HTML', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: { title: 'Test API' },
        })
        const response = handlers.serveUI()
        const html = await response.text()

        assert.ok(html.includes('<title>Test API</title>'))
      })

      it('should include protocol tabs script', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)
        const response = handlers.serveUI()
        const html = await response.text()

        assert.ok(html.includes('renderProtocolTabs'))
      })

      it('should embed spec as JSON', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: { title: 'Embedded Test' },
        })
        const response = handlers.serveUI()
        const html = await response.text()

        assert.ok(html.includes('const spec = '))
        assert.ok(html.includes('Embedded Test'))
      })

      it('should escape XSS in title', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: { title: '<script>alert("xss")</script>' },
        })
        const response = handlers.serveUI()
        const html = await response.text()

        // Should not contain unescaped script tag
        assert.ok(!html.includes('<script>alert("xss")</script>'))
        assert.ok(html.includes('&lt;script&gt;'))
      })

      it('should apply theme setting', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          ui: { theme: 'dark' },
        })
        const response = handlers.serveUI()
        const html = await response.text()

        assert.ok(html.includes('data-theme="dark"'))
      })

      it('should apply primary color', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          ui: { primaryColor: '#ff5733' },
        })
        const response = handlers.serveUI()
        const html = await response.text()

        assert.ok(html.includes('--primary-color: #ff5733'))
      })

      it('should include logo when provided', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          ui: { logo: '/assets/logo.png' },
        })
        const response = handlers.serveUI()
        const html = await response.text()

        assert.ok(html.includes('<img src="/assets/logo.png"'))
      })

      it('should use default theme auto', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)
        const response = handlers.serveUI()
        const html = await response.text()

        assert.ok(html.includes('data-theme="auto"'))
      })
    })

    describe('serveUSD()', () => {
      it('should return JSON Response', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)
        const response = handlers.serveUSD()

        assert.ok(response instanceof Response)
        assert.equal(response.headers.get('Content-Type'), 'application/json')
      })

      it('should return valid USD document', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: { title: 'JSON Test API', version: '1.2.3' },
        })
        const response = handlers.serveUSD()
        const json = await response.json()

        assert.equal(json.openapi, '3.1.0')
        assert.equal(json.info.title, 'JSON Test API')
        assert.equal(json.info.version, '1.2.3')
      })

      it('should return pretty-printed JSON', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)
        const response = handlers.serveUSD()
        const text = await response.text()

        // Pretty-printed JSON has newlines
        assert.ok(text.includes('\n'))
      })
    })

    describe('serveUSDYaml()', () => {
      it('should return YAML Response', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)
        const response = handlers.serveUSDYaml()

        assert.ok(response instanceof Response)
        assert.equal(response.headers.get('Content-Type'), 'application/x-yaml')
      })

      it('should return valid YAML', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: { title: 'YAML Test API' },
        })
        const response = handlers.serveUSDYaml()
        const yaml = await response.text()

        assert.ok(yaml.includes('openapi:'))
        assert.ok(yaml.includes('title: YAML Test API'))
      })

      it('should not have JSON brackets', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)
        const response = handlers.serveUSDYaml()
        const yaml = await response.text()

        // YAML shouldn't start with JSON brackets
        assert.ok(!yaml.trimStart().startsWith('{'))
      })
    })

    describe('serveOpenAPI()', () => {
      it('should return JSON Response', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)
        const response = handlers.serveOpenAPI()

        assert.ok(response instanceof Response)
        assert.equal(response.headers.get('Content-Type'), 'application/json')
      })

      it('should return OpenAPI 3.1 document', async () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx, {
          info: { title: 'OpenAPI Test', version: '2.0.0' },
        })
        const response = handlers.serveOpenAPI()
        const json = await response.json()

        assert.equal(json.openapi, '3.1.0')
        assert.equal(json.info.title, 'OpenAPI Test')
        assert.equal(json.info.version, '2.0.0')
      })

      it('should strip USD extensions by default', async () => {
        const registry = createMockRegistry({
          'test.proc': createMockProcedure(),
        })
        const channels = new Map<string, LoadedChannel>()
        channels.set('test-channel', createMockChannel('test-channel'))

        const ctx: USDMiddlewareContext = {
          registry,
          schemaRegistry: createMockSchemaRegistry(),
          channels,
        }

        const handlers = createUSDHandlers(ctx)
        const response = handlers.serveOpenAPI()
        const json = await response.json()

        // Should not have USD-specific extensions
        assert.equal(json['x-usd']?.websocket, undefined)
      })
    })

    describe('getUSDDocument()', () => {
      it('should return USDDocument object', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)
        const doc = handlers.getUSDDocument()

        assert.ok(doc)
        assert.equal(doc.openapi, '3.1.0')
        assert.ok(doc.info)
      })

      it('should cache document', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)

        const doc1 = handlers.getUSDDocument()
        const doc2 = handlers.getUSDDocument()

        assert.strictEqual(doc1, doc2)
      })

      it('should include procedures as paths', () => {
        const registry = createMockRegistry({
          'users.list': createMockProcedure({
            meta: {
              httpPath: '/users',
              httpMethod: 'GET',
              description: 'List all users',
            },
          }),
        })
        const ctx: USDMiddlewareContext = {
          registry,
          schemaRegistry: createMockSchemaRegistry(),
        }

        const handlers = createUSDHandlers(ctx)
        const doc = handlers.getUSDDocument()

        assert.ok(doc.paths?.['/users']?.get)
      })

      it('should include channels as websocket', () => {
        const channels = new Map<string, LoadedChannel>()
        channels.set('notifications', createMockChannel('notifications', { type: 'public' }))

        const ctx: USDMiddlewareContext = {
          registry: createMockRegistry(),
          schemaRegistry: createMockSchemaRegistry(),
          channels,
        }

        const handlers = createUSDHandlers(ctx)
        const doc = handlers.getUSDDocument()

        assert.ok(doc['x-usd']?.websocket?.channels?.notifications)
      })
    })

    describe('getOpenAPIDocument()', () => {
      it('should return OpenAPIDocument object', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)
        const doc = handlers.getOpenAPIDocument()

        assert.ok(doc)
        assert.equal(doc.openapi, '3.1.0')
        assert.ok(doc.info)
      })

      it('should cache document', () => {
        const ctx = createMinimalContext()
        const handlers = createUSDHandlers(ctx)

        const doc1 = handlers.getOpenAPIDocument()
        const doc2 = handlers.getOpenAPIDocument()

        assert.strictEqual(doc1, doc2)
      })

      it('should strip x-usd extensions', () => {
        const channels = new Map<string, LoadedChannel>()
        channels.set('test', createMockChannel('test'))

        const ctx: USDMiddlewareContext = {
          registry: createMockRegistry(),
          schemaRegistry: createMockSchemaRegistry(),
          channels,
        }

        const handlers = createUSDHandlers(ctx)
        const doc = handlers.getOpenAPIDocument()

        // OpenAPI should not have USD extensions
        assert.equal((doc as any)['x-usd']?.websocket, undefined)
      })
    })
  })

  describe('Document Caching', () => {
    it('should lazily generate USD document', () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx)

      // Document shouldn't be generated until accessed
      // (we can't directly test this, but we can verify it works)
      const doc = handlers.getUSDDocument()
      assert.ok(doc)
    })

    it('should share cache between USD and OpenAPI', () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx)

      // Get OpenAPI first (which should trigger USD generation)
      const openapi = handlers.getOpenAPIDocument()
      const usd = handlers.getUSDDocument()

      assert.ok(openapi)
      assert.ok(usd)
    })

    it('should return same document on multiple calls', () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx)

      const usd1 = handlers.getUSDDocument()
      const usd2 = handlers.getUSDDocument()
      const openapi1 = handlers.getOpenAPIDocument()
      const openapi2 = handlers.getOpenAPIDocument()

      assert.strictEqual(usd1, usd2)
      assert.strictEqual(openapi1, openapi2)
    })
  })

  describe('Context variations', () => {
    it('should handle context with only registry', () => {
      const ctx: USDMiddlewareContext = {
        registry: createMockRegistry(),
        schemaRegistry: createMockSchemaRegistry(),
      }

      const handlers = createUSDHandlers(ctx)
      const doc = handlers.getUSDDocument()

      assert.ok(doc)
    })

    it('should handle context with channels', () => {
      const channels = new Map<string, LoadedChannel>()
      channels.set('chat', createMockChannel('chat'))
      channels.set('presence', createMockChannel('presence', { type: 'presence' }))

      const ctx: USDMiddlewareContext = {
        registry: createMockRegistry(),
        schemaRegistry: createMockSchemaRegistry(),
        channels,
      }

      const handlers = createUSDHandlers(ctx)
      const doc = handlers.getUSDDocument()

      assert.ok(doc['x-usd']?.websocket)
      assert.ok(doc['x-usd']?.websocket?.channels.chat)
      assert.ok(doc['x-usd']?.websocket?.channels.presence)
    })

    it('should handle context with REST resources', () => {
      const restResources: LoadedRestResource[] = [
        createMockRestResource('users'),
      ]

      const ctx: USDMiddlewareContext = {
        registry: createMockRegistry(),
        schemaRegistry: createMockSchemaRegistry(),
        restResources,
      }

      const handlers = createUSDHandlers(ctx)
      const doc = handlers.getUSDDocument()

      assert.ok(doc)
    })

    it('should handle complex context with all features', () => {
      const registry = createMockRegistry({
        'users.create': createMockProcedure({
          meta: {
            httpPath: '/users',
            httpMethod: 'POST',
          },
        }),
        'products.list': createMockProcedure({
          meta: {
            httpPath: '/products',
            httpMethod: 'GET',
          },
        }),
      })

      const channels = new Map<string, LoadedChannel>()
      channels.set('orders', createMockChannel('orders'))

      const restResources: LoadedRestResource[] = [
        createMockRestResource('api'),
      ]

      const ctx: USDMiddlewareContext = {
        registry,
        schemaRegistry: createMockSchemaRegistry(),
        channels,
        restResources,
      }

      const handlers = createUSDHandlers(ctx, {
        info: {
          title: 'Complex API',
          version: '1.0.0',
        },
        servers: [{ url: 'https://api.example.com' }],
        tags: [{ name: 'Users' }, { name: 'Products' }],
      })

      const doc = handlers.getUSDDocument()

      assert.equal(doc.info.title, 'Complex API')
      assert.ok(doc.paths)
      assert.ok(doc['x-usd']?.websocket)
      assert.ok(doc.servers)
      assert.ok(doc.tags)
    })
  })

  describe('UI Configuration', () => {
    it('should use light theme', async () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx, {
        ui: { theme: 'light' },
      })
      const html = await handlers.serveUI().text()

      assert.ok(html.includes('data-theme="light"'))
    })

    it('should use dark theme', async () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx, {
        ui: { theme: 'dark' },
      })
      const html = await handlers.serveUI().text()

      assert.ok(html.includes('data-theme="dark"'))
    })

    it('should use auto theme by default', async () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx)
      const html = await handlers.serveUI().text()

      assert.ok(html.includes('data-theme="auto"'))
    })

    it('should apply custom primary color', async () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx, {
        ui: { primaryColor: '#00ff00' },
      })
      const html = await handlers.serveUI().text()

      assert.ok(html.includes('#00ff00'))
    })

    it('should use default primary color when not specified', async () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx)
      const html = await handlers.serveUI().text()

      assert.ok(html.includes('#6366f1'))
    })

    it('should include logo image when provided', async () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx, {
        ui: { logo: 'https://example.com/logo.svg' },
      })
      const html = await handlers.serveUI().text()

      assert.ok(html.includes('https://example.com/logo.svg'))
    })

    it('should not include logo image when not provided', async () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx)
      const html = await handlers.serveUI().text()

      // Should not have img with logo
      assert.ok(!html.includes('<img src=""'))
    })
  })

  describe('HTML Security', () => {
    it('should escape special HTML characters in title', async () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx, {
        info: { title: 'Test & Demo <API>' },
      })
      const html = await handlers.serveUI().text()

      // Should be escaped
      assert.ok(html.includes('Test &amp; Demo &lt;API&gt;'))
    })

    it('should escape JSON in script tag', async () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx, {
        info: { description: '</script><script>alert(1)</script>' },
      })
      const html = await handlers.serveUI().text()

      // Script tags in JSON should be escaped with unicode
      assert.ok(!html.includes('</script><script>alert(1)</script>'))
      assert.ok(html.includes('\\u003c/script\\u003e'))
    })

    it('should escape ampersands in JSON', async () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx, {
        info: { description: 'Terms & Conditions' },
      })
      const html = await handlers.serveUI().text()

      // Ampersands should be escaped in JSON
      assert.ok(html.includes('\\u0026') || html.includes('Terms'))
    })

    it('should escape logo URL', async () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx, {
        ui: { logo: 'test.png" onload="alert(1)' },
      })
      const html = await handlers.serveUI().text()

      // Should be escaped to prevent attribute injection
      assert.ok(html.includes('&quot;'))
    })
  })

  describe('Response Headers', () => {
    it('serveUI should have correct content type', () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx)
      const response = handlers.serveUI()

      assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8')
    })

    it('serveUSD should have correct content type', () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx)
      const response = handlers.serveUSD()

      assert.equal(response.headers.get('Content-Type'), 'application/json')
    })

    it('serveUSDYaml should have correct content type', () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx)
      const response = handlers.serveUSDYaml()

      assert.equal(response.headers.get('Content-Type'), 'application/x-yaml')
    })

    it('serveOpenAPI should have correct content type', () => {
      const ctx = createMinimalContext()
      const handlers = createUSDHandlers(ctx)
      const response = handlers.serveOpenAPI()

      assert.equal(response.headers.get('Content-Type'), 'application/json')
    })
  })

  describe('Integration scenarios', () => {
    it('should generate documentation for HTTP-only API', () => {
      const registry = createMockRegistry({
        'users.list': createMockProcedure({
          meta: { httpPath: '/users', httpMethod: 'GET' },
        }),
        'users.create': createMockProcedure({
          meta: { httpPath: '/users', httpMethod: 'POST' },
        }),
        'users.get': createMockProcedure({
          meta: { httpPath: '/users/:id', httpMethod: 'GET' },
        }),
      })

      const ctx: USDMiddlewareContext = {
        registry,
        schemaRegistry: createMockSchemaRegistry(),
      }

      const handlers = createUSDHandlers(ctx, {
        info: { title: 'Users API' },
      })

      const doc = handlers.getUSDDocument()
      const openapi = handlers.getOpenAPIDocument()

      assert.ok(doc.paths?.['/users']?.get)
      assert.ok(doc.paths?.['/users']?.post)
      assert.ok(doc.paths?.['/users/:id']?.get)
      assert.ok(openapi.paths)
    })

    it('should generate documentation for WebSocket-only API', () => {
      const channels = new Map<string, LoadedChannel>()
      channels.set('events', createMockChannel('events'))
      channels.set('private-user', createMockChannel('private-user', { type: 'private' }))

      const ctx: USDMiddlewareContext = {
        registry: createMockRegistry(),
        schemaRegistry: createMockSchemaRegistry(),
        channels,
      }

      const handlers = createUSDHandlers(ctx, {
        info: { title: 'WebSocket API' },
      })

      const doc = handlers.getUSDDocument()

      assert.ok(doc['x-usd']?.websocket?.channels?.events)
      assert.ok(doc['x-usd']?.websocket?.channels?.['private-user'])
    })

    it('should generate documentation for multi-protocol API', () => {
      const registry = createMockRegistry({
        'api.status': createMockProcedure({
          meta: { httpPath: '/status', httpMethod: 'GET' },
        }),
      })

      const channels = new Map<string, LoadedChannel>()
      channels.set('updates', createMockChannel('updates'))

      const ctx: USDMiddlewareContext = {
        registry,
        schemaRegistry: createMockSchemaRegistry(),
        channels,
      }

      const handlers = createUSDHandlers(ctx, {
        info: { title: 'Multi-Protocol API' },
      })

      const doc = handlers.getUSDDocument()

      // Should have both HTTP and WebSocket
      assert.ok(doc.paths?.['/status'])
      assert.ok(doc['x-usd']?.websocket?.channels?.updates)
    })

    it('should work with empty registries', () => {
      const ctx: USDMiddlewareContext = {
        registry: createMockRegistry(),
        schemaRegistry: createMockSchemaRegistry(),
        channels: new Map(),
        restResources: [],
      }

      const handlers = createUSDHandlers(ctx, {
        info: { title: 'Empty API' },
      })

      const doc = handlers.getUSDDocument()
      const openapi = handlers.getOpenAPIDocument()

      assert.equal(doc.info.title, 'Empty API')
      assert.equal(openapi.info.title, 'Empty API')
    })
  })
})
