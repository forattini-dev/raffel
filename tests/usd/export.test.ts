/**
 * USD Export Tests
 *
 * Comprehensive tests for exporting USD to OpenAPI 3.1
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { exportOpenAPI, OpenAPIDocument } from '../../src/usd/export/index.js'
import { document, object, string, integer, array, ref, formats } from '../../src/usd/builder/index.js'
import type { USDDocument } from '../../src/usd/spec/types.js'

// ============================================================================
// Basic Export Tests
// ============================================================================

describe('exportOpenAPI', () => {
  describe('basic export', () => {
    it('should export minimal document', () => {
      const usd = document({ title: 'Test API', version: '1.0.0' }).build()
      const openapi = exportOpenAPI(usd)

      assert.equal(openapi.openapi, '3.1.0')
      assert.equal(openapi.info.title, 'Test API')
      assert.equal(openapi.info.version, '1.0.0')
    })

    it('should export info fields', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .description('A test API')
        .summary('Test summary')
        .termsOfService('https://example.com/tos')
        .contact({ name: 'Support', email: 'support@example.com' })
        .license({ name: 'MIT' })
        .build()

      const openapi = exportOpenAPI(usd)

      assert.equal(openapi.info.description, 'A test API')
      assert.equal(openapi.info.summary, 'Test summary')
      assert.equal(openapi.info.termsOfService, 'https://example.com/tos')
      assert.deepEqual(openapi.info.contact, { name: 'Support', email: 'support@example.com' })
      assert.deepEqual(openapi.info.license, { name: 'MIT' })
    })

    it('should strip x-usd namespace from output', () => {
      const usd = document({
        title: 'Test',
        version: '1.0.0',
        protocols: ['http', 'websocket'],
      }).build()

      const openapi = exportOpenAPI(usd)

      assert.ok(!('x-usd' in openapi))
    })
  })

  describe('servers', () => {
    it('should export HTTP servers', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .server('https://api.example.com', { description: 'Production' })
        .build()

      const openapi = exportOpenAPI(usd)

      assert.equal(openapi.servers?.length, 1)
      assert.equal(openapi.servers?.[0].url, 'https://api.example.com')
      assert.equal(openapi.servers?.[0].description, 'Production')
    })

    it('should filter out WebSocket servers', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .server('https://api.example.com')
        .server('wss://ws.example.com', { protocol: 'websocket' })
        .build()

      const openapi = exportOpenAPI(usd)

      // Only HTTP server should be included
      assert.equal(openapi.servers?.length, 1)
      assert.equal(openapi.servers?.[0].url, 'https://api.example.com')
    })

    it('should export server variables', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .server('https://{environment}.example.com', {
          variables: {
            environment: {
              enum: ['dev', 'prod'],
              default: 'prod',
              description: 'Environment',
            },
          },
        })
        .build()

      const openapi = exportOpenAPI(usd)

      assert.deepEqual(openapi.servers?.[0].variables, {
        environment: {
          enum: ['dev', 'prod'],
          default: 'prod',
          description: 'Environment',
        },
      })
    })
  })

  describe('paths', () => {
    it('should export paths', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .http('/users')
          .get('listUsers')
            .summary('List users')
            .response(200, { type: 'array' })
            .done()
          .done()
        .done()
        .build()

      const openapi = exportOpenAPI(usd)

      assert.ok(openapi.paths?.['/users'])
      const pathItem = openapi.paths['/users'] as Record<string, unknown>
      assert.ok(pathItem.get)
    })

    it('should strip x-usd-streaming from operations', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .http('/events')
          .get()
            .streaming()
            .response(200, { type: 'string' })
            .done()
          .done()
        .done()
        .build()

      const openapi = exportOpenAPI(usd)

      const pathItem = openapi.paths?.['/events'] as Record<string, unknown>
      const operation = pathItem?.get as Record<string, unknown>
      assert.ok(!('x-usd-streaming' in operation))
    })

    it('should preserve x-usd extensions when stripExtensions is false', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .http('/events')
          .get()
            .streaming()
            .response(200, { type: 'string' })
            .done()
          .done()
        .done()
        .build()

      const openapi = exportOpenAPI(usd, { stripExtensions: false })

      const pathItem = openapi.paths?.['/events'] as Record<string, unknown>
      const operation = pathItem?.get as Record<string, unknown>
      assert.equal(operation['x-usd-streaming'], true)
    })

    it('should export path parameters', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .http('/users/{id}')
          .get()
            .path('id', { type: 'string' })
            .response(200, { type: 'object' })
            .done()
          .done()
        .done()
        .build()

      const openapi = exportOpenAPI(usd)

      const pathItem = openapi.paths?.['/users/{id}'] as Record<string, unknown>
      const operation = pathItem?.get as Record<string, unknown>
      assert.ok(Array.isArray(operation.parameters))
    })

    it('should export request body', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .http('/users')
          .post()
            .body({ type: 'object' })
            .response(201, { type: 'object' })
            .done()
          .done()
        .done()
        .build()

      const openapi = exportOpenAPI(usd)

      const pathItem = openapi.paths?.['/users'] as Record<string, unknown>
      const operation = pathItem?.post as Record<string, unknown>
      assert.ok(operation.requestBody)
    })

    it('should export responses', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .http('/users')
          .get()
            .response(200, { type: 'array' }, { description: 'Success' })
            .response(404, { type: 'object' }, { description: 'Not found' })
            .done()
          .done()
        .done()
        .build()

      const openapi = exportOpenAPI(usd)

      const pathItem = openapi.paths?.['/users'] as Record<string, unknown>
      const operation = pathItem?.get as Record<string, unknown>
      const responses = operation.responses as Record<string, unknown>
      assert.ok(responses['200'])
      assert.ok(responses['404'])
    })
  })

  describe('components', () => {
    it('should export schemas', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .schema('User', object({
          id: string(),
          name: string(),
        }))
        .build()

      const openapi = exportOpenAPI(usd)

      assert.ok(openapi.components?.schemas?.User)
    })

    it('should export security schemes', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .securityScheme('bearerAuth', {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        })
        .build()

      const openapi = exportOpenAPI(usd)

      assert.ok(openapi.components?.securitySchemes?.bearerAuth)
    })

    it('should filter out x-usd-* security schemes', () => {
      const usd: USDDocument = {
        usd: '1.0.0',
        openapi: '3.1.0',
        info: { title: 'Test', version: '1.0.0' },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer' },
            'x-usd-websocket-auth': { type: 'apiKey', in: 'query', name: 'token' },
          },
        },
      }

      const openapi = exportOpenAPI(usd)

      assert.ok(openapi.components?.securitySchemes?.bearerAuth)
      assert.ok(!openapi.components?.securitySchemes?.['x-usd-websocket-auth'])
    })

    it('should strip x-usd-* from schemas', () => {
      const usd: USDDocument = {
        usd: '1.0.0',
        openapi: '3.1.0',
        info: { title: 'Test', version: '1.0.0' },
        components: {
          schemas: {
            User: {
              type: 'object',
              'x-usd-example': 'test',
              properties: {
                id: { type: 'string' },
              },
            },
          },
        },
      }

      const openapi = exportOpenAPI(usd)

      const userSchema = openapi.components?.schemas?.User as Record<string, unknown>
      assert.ok(!('x-usd-example' in userSchema))
      assert.ok(userSchema.properties)
    })
  })

  describe('security', () => {
    it('should export global security', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .securityScheme('bearerAuth', { type: 'http', scheme: 'bearer' })
        .security({ bearerAuth: [] })
        .build()

      const openapi = exportOpenAPI(usd)

      assert.deepEqual(openapi.security, [{ bearerAuth: [] }])
    })
  })

  describe('tags', () => {
    it('should export tags', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .tag('users', { description: 'User operations' })
        .tag('products')
        .build()

      const openapi = exportOpenAPI(usd)

      assert.equal(openapi.tags?.length, 2)
      assert.equal(openapi.tags?.[0].name, 'users')
      assert.equal(openapi.tags?.[0].description, 'User operations')
    })
  })

  describe('externalDocs', () => {
    it('should export external docs', () => {
      const usd = document({ title: 'Test', version: '1.0.0' })
        .externalDocs('https://docs.example.com', 'Full documentation')
        .build()

      const openapi = exportOpenAPI(usd)

      assert.equal(openapi.externalDocs?.url, 'https://docs.example.com')
      assert.equal(openapi.externalDocs?.description, 'Full documentation')
    })
  })
})

// ============================================================================
// WebSocket to Webhooks Conversion Tests
// ============================================================================

describe('WebSocket to Webhooks conversion', () => {
  it('should not include webhooks by default', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .websocket()
        .public('notifications')
          .subscribe({ type: 'object' })
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd)

    assert.ok(!openapi.webhooks)
  })

  it('should convert WebSocket channels to webhooks when enabled', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .websocket()
        .public('notifications')
          .subscribe(
            object({ type: string(), data: { type: 'object' } }),
            { summary: 'Receive notifications' }
          )
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeWebSocketAsWebhooks: true })

    assert.ok(openapi.webhooks)
    assert.ok(openapi.webhooks['ws-notifications-receive'])
    const webhook = openapi.webhooks['ws-notifications-receive'] as Record<string, unknown>
    const post = webhook.post as Record<string, unknown>
    assert.equal(post.summary, 'Receive notifications')
  })

  it('should include request body in webhook', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .websocket()
        .public('events')
          .subscribe(object({ event: string() }))
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeWebSocketAsWebhooks: true })

    const webhook = openapi.webhooks?.['ws-events-receive'] as Record<string, unknown>
    const post = webhook?.post as Record<string, unknown>
    assert.ok(post.requestBody)
  })

  it('should handle multiple channels', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .websocket()
        .public('channel-a')
          .subscribe({ type: 'object' })
          .done()
        .public('channel-b')
          .subscribe({ type: 'object' })
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeWebSocketAsWebhooks: true })

    assert.ok(openapi.webhooks?.['ws-channel-a-receive'])
    assert.ok(openapi.webhooks?.['ws-channel-b-receive'])
  })
})

// ============================================================================
// JSON-RPC to Paths Conversion Tests
// ============================================================================

describe('JSON-RPC to paths conversion', () => {
  it('should not include RPC paths by default', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .jsonrpc('/rpc')
        .method('users.list')
          .result({ type: 'array' })
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd)

    // Should not have the RPC method path
    assert.ok(!openapi.paths?.['/rpc/users/list'])
  })

  it('should convert JSON-RPC methods to POST endpoints when enabled', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .jsonrpc('/rpc')
        .method('users.list')
          .description('List users')
          .result({ type: 'array' })
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeRpcAsEndpoints: true })

    assert.ok(openapi.paths?.['/rpc/users/list'])
    const pathItem = openapi.paths['/rpc/users/list'] as Record<string, unknown>
    const post = pathItem.post as Record<string, unknown>
    assert.equal(post.operationId, 'users.list')
  })

  it('should include params as request body', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .jsonrpc('/rpc')
        .method('users.get')
          .params(object({ id: string() }))
          .result({ type: 'object' })
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeRpcAsEndpoints: true })

    const pathItem = openapi.paths?.['/rpc/users/get'] as Record<string, unknown>
    const post = pathItem?.post as Record<string, unknown>
    assert.ok(post.requestBody)
  })

  it('should include result as response', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .jsonrpc('/rpc')
        .method('users.get')
          .result(object({ id: string(), name: string() }))
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeRpcAsEndpoints: true })

    const pathItem = openapi.paths?.['/rpc/users/get'] as Record<string, unknown>
    const post = pathItem?.post as Record<string, unknown>
    const responses = post.responses as Record<string, unknown>
    const response200 = responses['200'] as Record<string, unknown>
    assert.ok(response200.content)
  })

  it('should handle nested method names', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .jsonrpc('/api')
        .method('admin.users.create')
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeRpcAsEndpoints: true })

    // admin.users.create becomes /api/admin/users/create
    assert.ok(openapi.paths?.['/api/admin/users/create'])
  })

  it('should use default endpoint if not specified', () => {
    const usd: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      'x-usd': {
        jsonrpc: {
          version: '2.0',
          methods: {
            'test.method': {},
          },
        },
      },
    }

    const openapi = exportOpenAPI(usd, { includeRpcAsEndpoints: true })

    // Default endpoint is /rpc
    assert.ok(openapi.paths?.['/rpc/test/method'])
  })
})

// ============================================================================
// Streams to Paths Conversion Tests
// ============================================================================

describe('Streams to paths conversion', () => {
  it('should not include streams paths by default', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .streams()
        .serverToClient('/events')
          .message({ type: 'object' })
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd)

    assert.ok(!openapi.paths?.['/streams//events'])
  })

  it('should convert server-to-client streams to GET endpoints', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .streams()
        .serverToClient('/events')
          .message(object({ event: string() }))
          .description('Event stream')
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeStreamsAsEndpoints: true })

    assert.ok(openapi.paths?.['/streams//events'])
    const pathItem = openapi.paths['/streams//events'] as Record<string, unknown>
    assert.ok(pathItem.get)
    const get = pathItem.get as Record<string, unknown>
    assert.ok(get.responses)
  })

  it('should use text/event-stream content type for SSE', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .streams()
        .serverToClient('/events')
          .message({ type: 'object' })
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeStreamsAsEndpoints: true })

    const pathItem = openapi.paths?.['/streams//events'] as Record<string, unknown>
    const get = pathItem?.get as Record<string, unknown>
    const responses = get?.responses as Record<string, unknown>
    const response200 = responses?.['200'] as Record<string, unknown>
    const content = response200?.content as Record<string, unknown>
    assert.ok(content['text/event-stream'])
  })

  it('should convert client-to-server streams to POST endpoints', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .streams()
        .clientToServer('/upload')
          .message({ type: 'object' })
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeStreamsAsEndpoints: true })

    const pathItem = openapi.paths?.['/streams//upload'] as Record<string, unknown>
    assert.ok(pathItem.post)
    const post = pathItem.post as Record<string, unknown>
    assert.ok(post.requestBody)
  })

  it('should convert bidirectional streams to POST endpoints', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .streams()
        .bidirectional('/sync')
          .message({ type: 'object' })
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeStreamsAsEndpoints: true })

    const pathItem = openapi.paths?.['/streams//sync'] as Record<string, unknown>
    assert.ok(pathItem.post)
  })

  it('should include tags in converted streams', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .streams()
        .serverToClient('/events')
          .message({ type: 'object' })
          .tags('realtime', 'sse')
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeStreamsAsEndpoints: true })

    const pathItem = openapi.paths?.['/streams//events'] as Record<string, unknown>
    const get = pathItem?.get as Record<string, unknown>
    assert.deepEqual(get.tags, ['realtime', 'sse'])
  })
})

// ============================================================================
// Combined Conversion Tests
// ============================================================================

describe('combined conversions', () => {
  it('should merge existing paths with converted paths', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .http('/users')
        .get()
          .response(200, { type: 'array' })
          .done()
        .done()
      .done()
      .jsonrpc('/rpc')
        .method('admin.stats')
          .result({ type: 'object' })
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, { includeRpcAsEndpoints: true })

    // Both paths should exist
    assert.ok(openapi.paths?.['/users'])
    assert.ok(openapi.paths?.['/rpc/admin/stats'])
  })

  it('should enable all conversions together', () => {
    const usd = document({ title: 'Test', version: '1.0.0' })
      .http('/api/users')
        .get().response(200).done()
        .done()
      .done()
      .websocket()
        .public('events')
          .subscribe({ type: 'object' })
          .done()
        .done()
      .jsonrpc('/rpc')
        .method('test')
          .done()
        .done()
      .streams()
        .serverToClient('/events')
          .message({ type: 'object' })
          .done()
        .done()
      .build()

    const openapi = exportOpenAPI(usd, {
      includeWebSocketAsWebhooks: true,
      includeRpcAsEndpoints: true,
      includeStreamsAsEndpoints: true,
    })

    assert.ok(openapi.paths?.['/api/users'])
    assert.ok(openapi.webhooks?.['ws-events-receive'])
    assert.ok(openapi.paths?.['/rpc/test'])
    assert.ok(openapi.paths?.['/streams//events'])
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('edge cases', () => {
  it('should handle empty document', () => {
    const usd: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Empty', version: '0.0.0' },
    }

    const openapi = exportOpenAPI(usd)

    assert.equal(openapi.info.title, 'Empty')
    assert.ok(!openapi.paths)
    assert.ok(!openapi.webhooks)
    assert.ok(!openapi.components)
  })

  it('should handle document with empty components', () => {
    const usd: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      components: {},
    }

    const openapi = exportOpenAPI(usd)

    assert.ok(openapi.components)
  })

  it('should handle nested x-usd extensions in arrays', () => {
    const usd: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/test': {
          get: {
            parameters: [
              {
                name: 'id',
                in: 'query',
                schema: { type: 'string' },
                'x-usd-custom': 'value',
              },
            ],
            responses: {},
          },
        },
      },
    }

    const openapi = exportOpenAPI(usd)

    const pathItem = openapi.paths?.['/test'] as Record<string, unknown>
    const get = pathItem?.get as Record<string, unknown>
    const params = get?.parameters as Array<Record<string, unknown>>
    assert.ok(!('x-usd-custom' in params[0]))
  })

  it('should handle $ref in message payload', () => {
    const usd: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      'x-usd': {
        websocket: {
          channels: {
            test: {
              type: 'public',
              subscribe: {
                message: {
                  payload: { $ref: '#/components/schemas/Message' },
                },
              },
            },
          },
        },
      },
    }

    const openapi = exportOpenAPI(usd, { includeWebSocketAsWebhooks: true })

    const webhook = openapi.webhooks?.['ws-test-receive'] as Record<string, unknown>
    const post = webhook?.post as Record<string, unknown>
    const requestBody = post?.requestBody as Record<string, unknown>
    const content = requestBody?.content as Record<string, unknown>
    const json = content?.['application/json'] as Record<string, unknown>
    assert.deepEqual(json.schema, { $ref: '#/components/schemas/Message' })
  })

  it('should handle channel with only publish (no subscribe)', () => {
    const usd: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      'x-usd': {
        websocket: {
          channels: {
            'publish-only': {
              type: 'public',
              publish: {
                message: {
                  payload: { type: 'object' },
                },
              },
            },
          },
        },
      },
    }

    const openapi = exportOpenAPI(usd, { includeWebSocketAsWebhooks: true })

    // No webhook created since there's no subscribe operation
    assert.ok(!openapi.webhooks?.['ws-publish-only-receive'])
  })
})

// ============================================================================
// OpenAPIDocument Type Tests
// ============================================================================

describe('OpenAPIDocument type', () => {
  it('should be properly typed', () => {
    const openapi: OpenAPIDocument = {
      openapi: '3.1.0',
      info: {
        title: 'Test',
        version: '1.0.0',
      },
    }

    // This test just verifies the type compiles correctly
    assert.equal(openapi.openapi, '3.1.0')
  })

  it('should support all optional fields', () => {
    const openapi: OpenAPIDocument = {
      openapi: '3.1.0',
      info: {
        title: 'Complete API',
        version: '1.0.0',
        description: 'A complete API',
        termsOfService: 'https://example.com/tos',
        contact: {
          name: 'Support',
          url: 'https://example.com',
          email: 'support@example.com',
        },
        license: {
          name: 'MIT',
          url: 'https://opensource.org/licenses/MIT',
          identifier: 'MIT',
        },
        summary: 'Summary',
      },
      servers: [
        {
          url: 'https://api.example.com',
          description: 'Production',
          variables: {
            version: { default: 'v1' },
          },
        },
      ],
      paths: {},
      webhooks: {},
      components: {
        schemas: {},
        responses: {},
        parameters: {},
        examples: {},
        requestBodies: {},
        headers: {},
        securitySchemes: {},
        links: {},
        callbacks: {},
        pathItems: {},
      },
      security: [{ bearerAuth: [] }],
      tags: [{ name: 'test', description: 'Test', externalDocs: { url: 'https://example.com' } }],
      externalDocs: { url: 'https://docs.example.com', description: 'Docs' },
    }

    assert.ok(openapi.servers)
    assert.ok(openapi.components)
  })
})
