/**
 * USD Builder Tests
 *
 * Comprehensive tests for the fluent builder API
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  DocumentBuilder,
  document,
  USD,
  Schema,
  string,
  number,
  integer,
  boolean,
  array,
  object,
  ref,
  enumeration,
  oneOf,
  anyOf,
  allOf,
  nullable,
  formats,
  createHttpBuilder,
  createWebSocketBuilder,
  createStreamsBuilder,
  createJsonRpcBuilder,
  createGrpcBuilder,
  createTcpBuilder,
  createUdpBuilder,
  HttpBuilder,
  PathBuilder,
  OperationBuilder,
  WebSocketBuilder,
  ChannelBuilder,
  StreamsBuilder,
  StreamEndpointBuilder,
  JsonRpcBuilder,
  JsonRpcMethodBuilder,
  GrpcBuilder,
  GrpcServiceBuilder,
  GrpcMethodBuilder,
} from '../../src/usd/builder/index.js'
import type { USDDocument } from '../../src/usd/spec/types.js'

// ============================================================================
// DocumentBuilder Tests
// ============================================================================

describe('DocumentBuilder', () => {
  describe('constructor and basics', () => {
    it('should create document with required fields', () => {
      const doc = document({ title: 'Test API', version: '1.0.0' }).build()

      assert.equal(doc.usd, '1.0.0')
      assert.equal(doc.openapi, '3.1.0')
      assert.equal(doc.info.title, 'Test API')
      assert.equal(doc.info.version, '1.0.0')
    })

    it('should create document with description', () => {
      const doc = document({
        title: 'Test API',
        version: '1.0.0',
        description: 'A test API',
      }).build()

      assert.equal(doc.info.description, 'A test API')
    })

    it('should create document with protocols', () => {
      const doc = document({
        title: 'Test API',
        version: '1.0.0',
        protocols: ['http', 'websocket'],
      }).build()

      assert.deepEqual(doc['x-usd']?.protocols, ['http', 'websocket'])
    })
  })

  describe('info methods', () => {
    it('should set description via method', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .description('Fluent description')
        .build()

      assert.equal(doc.info.description, 'Fluent description')
    })

    it('should set summary', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .summary('Short summary')
        .build()

      assert.equal(doc.info.summary, 'Short summary')
    })

    it('should set terms of service', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .termsOfService('https://example.com/tos')
        .build()

      assert.equal(doc.info.termsOfService, 'https://example.com/tos')
    })

    it('should set contact information', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .contact({
          name: 'Support',
          email: 'support@example.com',
          url: 'https://example.com',
        })
        .build()

      assert.deepEqual(doc.info.contact, {
        name: 'Support',
        email: 'support@example.com',
        url: 'https://example.com',
      })
    })

    it('should set license', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .license({ name: 'MIT', url: 'https://opensource.org/licenses/MIT' })
        .build()

      assert.deepEqual(doc.info.license, {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      })
    })

    it('should set license with identifier', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .license({ name: 'Apache 2.0', identifier: 'Apache-2.0' })
        .build()

      assert.equal(doc.info.license?.identifier, 'Apache-2.0')
    })

    it('should set protocols via method', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .protocols('http', 'streams', 'grpc')
        .build()

      assert.deepEqual(doc['x-usd']?.protocols, ['http', 'streams', 'grpc'])
    })

    it('should set content types via method', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .contentTypes({
          default: 'application/json',
          supported: ['application/json', 'text/csv'],
        })
        .build()

      assert.deepEqual(doc['x-usd']?.contentTypes, {
        default: 'application/json',
        supported: ['application/json', 'text/csv'],
      })
    })
  })

  describe('servers', () => {
    it('should add a server', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .server('https://api.example.com')
        .build()

      assert.equal(doc.servers?.length, 1)
      assert.equal(doc.servers?.[0].url, 'https://api.example.com')
    })

    it('should add server with description', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .server('https://api.example.com', { description: 'Production' })
        .build()

      assert.equal(doc.servers?.[0].description, 'Production')
    })

    it('should add server with protocol', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .server('wss://ws.example.com', { protocol: 'websocket' })
        .build()

      assert.equal(doc['x-usd']?.servers?.[0].protocol, 'websocket')
    })

    it('should add server with variables', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .server('https://{environment}.example.com', {
          variables: {
            environment: {
              enum: ['dev', 'staging', 'prod'],
              default: 'prod',
              description: 'Environment',
            },
          },
        })
        .build()

      assert.deepEqual(doc.servers?.[0].variables?.environment, {
        enum: ['dev', 'staging', 'prod'],
        default: 'prod',
        description: 'Environment',
      })
    })

    it('should add multiple servers', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .server('https://api.example.com', { description: 'Production' })
        .server('https://staging-api.example.com', { description: 'Staging' })
        .build()

      assert.equal(doc.servers?.length, 2)
    })
  })

  describe('tags', () => {
    it('should add a tag', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .tag('users')
        .build()

      assert.equal(doc.tags?.length, 1)
      assert.equal(doc.tags?.[0].name, 'users')
    })

    it('should add tag with description', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .tag('users', { description: 'User operations' })
        .build()

      assert.equal(doc.tags?.[0].description, 'User operations')
    })

    it('should add tag with external docs', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .tag('users', {
          externalDocs: { url: 'https://docs.example.com/users' },
        })
        .build()

      assert.equal(doc.tags?.[0].externalDocs?.url, 'https://docs.example.com/users')
    })

    it('should add multiple tags', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .tag('users')
        .tag('orders')
        .tag('products')
        .build()

      assert.equal(doc.tags?.length, 3)
    })
  })

  describe('external docs', () => {
    it('should set external docs', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .externalDocs('https://docs.example.com')
        .build()

      assert.equal(doc.externalDocs?.url, 'https://docs.example.com')
    })

    it('should set external docs with description', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .externalDocs('https://docs.example.com', 'Full documentation')
        .build()

      assert.equal(doc.externalDocs?.description, 'Full documentation')
    })
  })

  describe('components', () => {
    it('should add a schema', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .schema('User', { type: 'object', properties: { id: { type: 'string' } } })
        .build()

      assert.deepEqual(doc.components?.schemas?.User, {
        type: 'object',
        properties: { id: { type: 'string' } },
      })
    })

    it('should add multiple schemas', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .schemas({
          User: { type: 'object' },
          Product: { type: 'object' },
        })
        .build()

      assert.ok(doc.components?.schemas?.User)
      assert.ok(doc.components?.schemas?.Product)
    })

    it('should add security scheme', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .securityScheme('bearerAuth', {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        })
        .build()

      assert.deepEqual(doc.components?.securitySchemes?.bearerAuth, {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      })
    })

    it('should add global security', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .securityScheme('bearerAuth', { type: 'http', scheme: 'bearer' })
        .security({ bearerAuth: [] })
        .build()

      assert.deepEqual(doc.security, [{ bearerAuth: [] }])
    })
  })

  describe('errors', () => {
    it('should add an error', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .error('NOT_FOUND', {
          code: 'NOT_FOUND',
          message: 'Resource not found',
          httpStatus: 404,
        })
        .build()

      assert.deepEqual(doc['x-usd']?.errors?.NOT_FOUND, {
        code: 'NOT_FOUND',
        message: 'Resource not found',
        httpStatus: 404,
      })
    })

    it('should add multiple errors', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .errors({
          NOT_FOUND: { code: 'NOT_FOUND', message: 'Not found', httpStatus: 404 },
          UNAUTHORIZED: { code: 'UNAUTHORIZED', message: 'Unauthorized', httpStatus: 401 },
        })
        .build()

      assert.ok(doc['x-usd']?.errors?.NOT_FOUND)
      assert.ok(doc['x-usd']?.errors?.UNAUTHORIZED)
    })
  })

  describe('protocol inference', () => {
    it('should infer http protocol from paths', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .http('/users')
          .get('listUsers')
          .response(200, { type: 'array' })
          .done()
        .done()
        .done()
        .build()

      assert.ok(doc['x-usd']?.protocols?.includes('http'))
    })

    it('should infer websocket protocol from channels', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .websocket()
          .public('events')
          .subscribe({ type: 'object' })
          .done()
        .done()
        .build()

      assert.ok(doc['x-usd']?.protocols?.includes('websocket'))
    })

    it('should infer streams protocol from endpoints', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .streams()
          .serverToClient('/events')
          .message({ type: 'object' })
          .done()
        .done()
        .build()

      assert.ok(doc['x-usd']?.protocols?.includes('streams'))
    })

    it('should infer multiple protocols', () => {
      const doc = document({ title: 'Test', version: '1.0.0' })
        .http('/users')
          .get().response(200).done()
        .done().done()
        .websocket()
          .public('events')
          .subscribe({ type: 'object' })
          .done()
        .done()
        .build()

      assert.ok(doc['x-usd']?.protocols?.includes('http'))
      assert.ok(doc['x-usd']?.protocols?.includes('websocket'))
    })
  })

  describe('serialization', () => {
    it('should serialize to JSON', () => {
      const json = document({ title: 'Test', version: '1.0.0' }).toJson()

      const parsed = JSON.parse(json)
      assert.equal(parsed.info.title, 'Test')
    })

    it('should serialize to YAML', () => {
      const yaml = document({ title: 'Test', version: '1.0.0' }).toYaml()

      assert.ok(yaml.includes('title: Test'))
      assert.ok(yaml.includes('version: 1.0.0'))
    })

    it('should serialize to compact JSON', () => {
      const json = document({ title: 'Test', version: '1.0.0' }).toJson(false)

      assert.ok(!json.includes('\n'))
    })
  })
})

// ============================================================================
// USD namespace
// ============================================================================

describe('USD namespace', () => {
  it('should expose document function', () => {
    const doc = USD.document({ title: 'Test', version: '1.0.0' }).build()
    assert.equal(doc.info.title, 'Test')
  })
})

// ============================================================================
// Schema Helpers Tests
// ============================================================================

describe('Schema helpers', () => {
  describe('string()', () => {
    it('should create basic string schema', () => {
      const schema = string()
      assert.deepEqual(schema, { type: 'string' })
    })

    it('should create string with description', () => {
      const schema = string({ description: 'User name' })
      assert.equal(schema.description, 'User name')
    })

    it('should create string with length constraints', () => {
      const schema = string({ minLength: 1, maxLength: 100 })
      assert.equal(schema.minLength, 1)
      assert.equal(schema.maxLength, 100)
    })

    it('should create string with pattern', () => {
      const schema = string({ pattern: '^[a-z]+$' })
      assert.equal(schema.pattern, '^[a-z]+$')
    })

    it('should create string with format', () => {
      const schema = string({ format: 'email' })
      assert.equal(schema.format, 'email')
    })

    it('should create string with enum', () => {
      const schema = string({ enum: ['active', 'inactive'] })
      assert.deepEqual(schema.enum, ['active', 'inactive'])
    })

    it('should create string with default', () => {
      const schema = string({ default: 'default value' })
      assert.equal(schema.default, 'default value')
    })
  })

  describe('number()', () => {
    it('should create basic number schema', () => {
      const schema = number()
      assert.deepEqual(schema, { type: 'number' })
    })

    it('should create number with constraints', () => {
      const schema = number({
        minimum: 0,
        maximum: 100,
        multipleOf: 0.01,
      })
      assert.equal(schema.minimum, 0)
      assert.equal(schema.maximum, 100)
      assert.equal(schema.multipleOf, 0.01)
    })

    it('should create number with exclusive bounds', () => {
      const schema = number({
        exclusiveMinimum: 0,
        exclusiveMaximum: 100,
      })
      assert.equal(schema.exclusiveMinimum, 0)
      assert.equal(schema.exclusiveMaximum, 100)
    })
  })

  describe('integer()', () => {
    it('should create integer schema', () => {
      const schema = integer()
      assert.equal(schema.type, 'integer')
    })

    it('should create integer with constraints', () => {
      const schema = integer({ minimum: 1, maximum: 1000 })
      assert.equal(schema.type, 'integer')
      assert.equal(schema.minimum, 1)
      assert.equal(schema.maximum, 1000)
    })
  })

  describe('boolean()', () => {
    it('should create boolean schema', () => {
      const schema = boolean()
      assert.deepEqual(schema, { type: 'boolean' })
    })

    it('should create boolean with default', () => {
      const schema = boolean({ default: true })
      assert.equal(schema.default, true)
    })
  })

  describe('array()', () => {
    it('should create basic array schema', () => {
      const schema = array({ type: 'string' })
      assert.equal(schema.type, 'array')
      assert.deepEqual(schema.items, { type: 'string' })
    })

    it('should create array with constraints', () => {
      const schema = array({ type: 'string' }, {
        minItems: 1,
        maxItems: 10,
        uniqueItems: true,
      })
      assert.equal(schema.minItems, 1)
      assert.equal(schema.maxItems, 10)
      assert.equal(schema.uniqueItems, true)
    })

    it('should create array with ref items', () => {
      const schema = array({ $ref: '#/components/schemas/User' })
      assert.deepEqual(schema.items, { $ref: '#/components/schemas/User' })
    })
  })

  describe('object()', () => {
    it('should create basic object schema', () => {
      const schema = object({
        name: { type: 'string' },
        age: { type: 'integer' },
      })
      assert.equal(schema.type, 'object')
      assert.ok(schema.properties?.name)
      assert.ok(schema.properties?.age)
    })

    it('should create object with required fields', () => {
      const schema = object(
        { name: { type: 'string' } },
        { required: ['name'] }
      )
      assert.deepEqual(schema.required, ['name'])
    })

    it('should create object with additionalProperties', () => {
      const schema = object({}, { additionalProperties: false })
      assert.equal(schema.additionalProperties, false)
    })

    it('should create object with typed additionalProperties', () => {
      const schema = object({}, { additionalProperties: { type: 'string' } })
      assert.deepEqual(schema.additionalProperties, { type: 'string' })
    })
  })

  describe('ref()', () => {
    it('should create reference with short name', () => {
      const reference = ref('User')
      assert.deepEqual(reference, { $ref: '#/components/schemas/User' })
    })

    it('should preserve full path', () => {
      const reference = ref('#/components/schemas/User')
      assert.deepEqual(reference, { $ref: '#/components/schemas/User' })
    })
  })

  describe('enumeration()', () => {
    it('should create string enum', () => {
      const schema = enumeration(['active', 'inactive'])
      assert.deepEqual(schema.enum, ['active', 'inactive'])
    })

    it('should create number enum', () => {
      const schema = enumeration([1, 2, 3])
      assert.deepEqual(schema.enum, [1, 2, 3])
    })

    it('should create enum with default', () => {
      const schema = enumeration(['a', 'b'], { default: 'a' })
      assert.equal(schema.default, 'a')
    })
  })

  describe('composition helpers', () => {
    it('should create oneOf schema', () => {
      const schema = oneOf([{ type: 'string' }, { type: 'number' }])
      assert.deepEqual(schema.oneOf, [{ type: 'string' }, { type: 'number' }])
    })

    it('should create anyOf schema', () => {
      const schema = anyOf([{ type: 'string' }, { type: 'number' }])
      assert.deepEqual(schema.anyOf, [{ type: 'string' }, { type: 'number' }])
    })

    it('should create allOf schema', () => {
      const schema = allOf([ref('Base'), { type: 'object' }])
      assert.ok(schema.allOf)
      assert.equal(schema.allOf?.length, 2)
    })
  })

  describe('nullable()', () => {
    it('should create nullable schema', () => {
      const schema = nullable({ type: 'string' })
      assert.ok(schema.oneOf)
      assert.deepEqual(schema.oneOf?.[0], { type: 'string' })
      assert.deepEqual(schema.oneOf?.[1], { type: 'null' })
    })
  })

  describe('formats', () => {
    it('should create email format', () => {
      assert.equal(formats.email().format, 'email')
    })

    it('should create uri format', () => {
      assert.equal(formats.uri().format, 'uri')
    })

    it('should create uuid format', () => {
      assert.equal(formats.uuid().format, 'uuid')
    })

    it('should create datetime format', () => {
      assert.equal(formats.datetime().format, 'date-time')
    })

    it('should create date format', () => {
      assert.equal(formats.date().format, 'date')
    })

    it('should create time format', () => {
      assert.equal(formats.time().format, 'time')
    })

    it('should create ipv4 format', () => {
      assert.equal(formats.ipv4().format, 'ipv4')
    })

    it('should create ipv6 format', () => {
      assert.equal(formats.ipv6().format, 'ipv6')
    })

    it('should create hostname format', () => {
      assert.equal(formats.hostname().format, 'hostname')
    })
  })

  describe('Schema namespace', () => {
    it('should expose all helpers', () => {
      assert.equal(typeof Schema.string, 'function')
      assert.equal(typeof Schema.number, 'function')
      assert.equal(typeof Schema.integer, 'function')
      assert.equal(typeof Schema.boolean, 'function')
      assert.equal(typeof Schema.array, 'function')
      assert.equal(typeof Schema.object, 'function')
      assert.equal(typeof Schema.ref, 'function')
      assert.equal(typeof Schema.enum, 'function')
      assert.equal(typeof Schema.oneOf, 'function')
      assert.equal(typeof Schema.anyOf, 'function')
      assert.equal(typeof Schema.allOf, 'function')
      assert.equal(typeof Schema.nullable, 'function')
    })
  })
})

// ============================================================================
// HTTP Builder Tests
// ============================================================================

describe('HttpBuilder', () => {
  let docBuilder: DocumentBuilder

  beforeEach(() => {
    docBuilder = document({ title: 'Test', version: '1.0.0' })
  })

  describe('path creation', () => {
    it('should create a path', () => {
      const paths = createHttpBuilder(docBuilder)
        .path('/users')
        .get('listUsers')
        .response(200, { type: 'array' })
        .done()
        .done()
        .build()

      assert.ok(paths['/users'])
      assert.ok(paths['/users'].get)
    })

    it('should reuse existing path', () => {
      const builder = createHttpBuilder(docBuilder)
      builder.path('/users').get().done()
      builder.path('/users').post().done()

      const paths = builder.build()
      assert.ok(paths['/users'].get)
      assert.ok(paths['/users'].post)
    })
  })

  describe('shorthand methods', () => {
    it('should create GET via shorthand', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users', 'listUsers')
        .response(200, { type: 'array' })
        .done()
        .done()
        .build()

      assert.equal(paths['/users'].get?.operationId, 'listUsers')
    })

    it('should create POST via shorthand', () => {
      const paths = createHttpBuilder(docBuilder)
        .post('/users', 'createUser')
        .body({ type: 'object' })
        .done()
        .done()
        .build()

      assert.equal(paths['/users'].post?.operationId, 'createUser')
    })

    it('should create PUT via shorthand', () => {
      const paths = createHttpBuilder(docBuilder)
        .put('/users/{id}')
        .body({ type: 'object' })
        .done()
        .done()
        .build()

      assert.ok(paths['/users/{id}'].put)
    })

    it('should create PATCH via shorthand', () => {
      const paths = createHttpBuilder(docBuilder)
        .patch('/users/{id}')
        .body({ type: 'object' })
        .done()
        .done()
        .build()

      assert.ok(paths['/users/{id}'].patch)
    })

    it('should create DELETE via shorthand', () => {
      const paths = createHttpBuilder(docBuilder)
        .delete('/users/{id}')
        .response(204)
        .done()
        .done()
        .build()

      assert.ok(paths['/users/{id}'].delete)
    })
  })

  describe('PathBuilder', () => {
    it('should set path summary', () => {
      const paths = createHttpBuilder(docBuilder)
        .path('/users')
        .summary('User operations')
        .get().done()
        .done()
        .build()

      assert.equal(paths['/users'].summary, 'User operations')
    })

    it('should set path description', () => {
      const paths = createHttpBuilder(docBuilder)
        .path('/users')
        .description('Operations on users')
        .get().done()
        .done()
        .build()

      assert.equal(paths['/users'].description, 'Operations on users')
    })

    it('should set path-level parameters', () => {
      const paths = createHttpBuilder(docBuilder)
        .path('/users/{id}')
        .parameters({ name: 'id', in: 'path', required: true, schema: { type: 'string' } })
        .get().done()
        .delete().done()
        .done()
        .build()

      assert.ok(paths['/users/{id}'].parameters)
      assert.equal(paths['/users/{id}'].parameters?.[0].name, 'id')
    })

    it('should create all HTTP methods', () => {
      const builder = createHttpBuilder(docBuilder).path('/test')

      builder.get().done()
      builder.post().done()
      builder.put().done()
      builder.patch().done()
      builder.delete().done()
      builder.options().done()
      builder.head().done()
      builder.trace().done()

      const paths = builder.done().build()

      assert.ok(paths['/test'].get)
      assert.ok(paths['/test'].post)
      assert.ok(paths['/test'].put)
      assert.ok(paths['/test'].patch)
      assert.ok(paths['/test'].delete)
      assert.ok(paths['/test'].options)
      assert.ok(paths['/test'].head)
      assert.ok(paths['/test'].trace)
    })
  })

  describe('OperationBuilder', () => {
    it('should set operationId', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users')
        .operationId('listUsers')
        .done()
        .done()
        .build()

      assert.equal(paths['/users'].get?.operationId, 'listUsers')
    })

    it('should set summary', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users')
        .summary('List all users')
        .done()
        .done()
        .build()

      assert.equal(paths['/users'].get?.summary, 'List all users')
    })

    it('should set description', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users')
        .description('Returns a list of users')
        .done()
        .done()
        .build()

      assert.equal(paths['/users'].get?.description, 'Returns a list of users')
    })

    it('should set tags', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users')
        .tags('users', 'public')
        .done()
        .done()
        .build()

      assert.deepEqual(paths['/users'].get?.tags, ['users', 'public'])
    })

    it('should mark as deprecated', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users')
        .deprecated()
        .done()
        .done()
        .build()

      assert.equal(paths['/users'].get?.deprecated, true)
    })

    it('should set security requirements', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users')
        .security({ bearerAuth: [] })
        .done()
        .done()
        .build()

      assert.deepEqual(paths['/users'].get?.security, [{ bearerAuth: [] }])
    })

    it('should add parameter', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users')
        .parameter({
          name: 'limit',
          in: 'query',
          schema: { type: 'integer' },
        })
        .done()
        .done()
        .build()

      assert.equal(paths['/users'].get?.parameters?.[0].name, 'limit')
    })

    it('should add query parameter via shorthand', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users')
        .query('limit', { type: 'integer' }, { description: 'Max results' })
        .done()
        .done()
        .build()

      const param = paths['/users'].get?.parameters?.[0]
      assert.equal(param?.name, 'limit')
      assert.equal(param?.in, 'query')
      assert.equal(param?.description, 'Max results')
    })

    it('should add header parameter via shorthand', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users')
        .header('X-Request-ID', { type: 'string' })
        .done()
        .done()
        .build()

      const param = paths['/users'].get?.parameters?.[0]
      assert.equal(param?.name, 'X-Request-ID')
      assert.equal(param?.in, 'header')
    })

    it('should add path parameter via shorthand', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users/{id}')
        .path('id', { type: 'string' }, { description: 'User ID' })
        .done()
        .done()
        .build()

      const param = paths['/users/{id}'].get?.parameters?.[0]
      assert.equal(param?.name, 'id')
      assert.equal(param?.in, 'path')
      assert.equal(param?.required, true)
    })

    it('should add request body', () => {
      const paths = createHttpBuilder(docBuilder)
        .post('/users')
        .body({ type: 'object' }, { description: 'User data', required: true })
        .done()
        .done()
        .build()

      assert.ok(paths['/users'].post?.requestBody)
      assert.equal(paths['/users'].post?.requestBody?.description, 'User data')
      assert.equal(paths['/users'].post?.requestBody?.required, true)
    })

    it('should add body with custom content type', () => {
      const paths = createHttpBuilder(docBuilder)
        .post('/upload')
        .body({ type: 'string', format: 'binary' }, { contentType: 'multipart/form-data' })
        .done()
        .done()
        .build()

      assert.ok(paths['/upload'].post?.requestBody?.content?.['multipart/form-data'])
    })

    it('should add response', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users')
        .response(200, { type: 'array' }, { description: 'Success' })
        .done()
        .done()
        .build()

      assert.ok(paths['/users'].get?.responses['200'])
      assert.equal(paths['/users'].get?.responses['200'].description, 'Success')
    })

    it('should add response without body', () => {
      const paths = createHttpBuilder(docBuilder)
        .delete('/users/{id}')
        .response(204)
        .done()
        .done()
        .build()

      assert.ok(paths['/users/{id}'].delete?.responses['204'])
      assert.ok(!paths['/users/{id}'].delete?.responses['204'].content)
    })

    it('should add default response', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users')
        .response('default', ref('Error'))
        .done()
        .done()
        .build()

      assert.ok(paths['/users'].get?.responses['default'])
    })

    it('should mark as streaming', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/events')
        .streaming()
        .done()
        .done()
        .build()

      assert.equal(paths['/events'].get?.['x-usd-streaming'], true)
    })

    it('should chain multiple settings', () => {
      const paths = createHttpBuilder(docBuilder)
        .get('/users')
        .operationId('listUsers')
        .summary('List users')
        .description('Returns all users')
        .tags('users')
        .query('limit', { type: 'integer' })
        .query('offset', { type: 'integer' })
        .response(200, { type: 'array' })
        .response(400, ref('Error'))
        .done()
        .done()
        .build()

      const op = paths['/users'].get
      assert.equal(op?.operationId, 'listUsers')
      assert.equal(op?.summary, 'List users')
      assert.equal(op?.parameters?.length, 2)
      assert.ok(op?.responses['200'])
      assert.ok(op?.responses['400'])
    })
  })
})

// ============================================================================
// WebSocket Builder Tests
// ============================================================================

describe('WebSocketBuilder', () => {
  let docBuilder: DocumentBuilder

  beforeEach(() => {
    docBuilder = document({ title: 'Test', version: '1.0.0' })
  })

  describe('configuration', () => {
    it('should set path', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .path('/ws')
        .build()

      assert.equal(ws.path, '/ws')
    })

    it('should set authentication', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .authentication({
          in: 'query',
          name: 'token',
          description: 'Auth token',
        })
        .build()

      assert.deepEqual(ws.authentication, {
        in: 'query',
        name: 'token',
        description: 'Auth token',
      })
    })

    it('should set events', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .events({
          onConnect: { payload: { type: 'object' } },
          onDisconnect: { payload: { type: 'object' } },
        })
        .build()

      assert.ok(ws.events?.onConnect)
      assert.ok(ws.events?.onDisconnect)
    })

    it('should set content types', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .contentTypes({
          default: 'application/json',
          supported: ['application/json', 'application/octet-stream'],
        })
        .build()

      assert.deepEqual(ws.contentTypes, {
        default: 'application/json',
        supported: ['application/json', 'application/octet-stream'],
      })
    })
  })

  describe('channel creation', () => {
    it('should create public channel', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .public('notifications')
        .subscribe({ type: 'object' })
        .done()
        .build()

      assert.ok(ws.channels?.notifications)
      assert.equal(ws.channels?.notifications.type, 'public')
    })

    it('should create private channel with auto-prefix', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .private('user-updates')
        .subscribe({ type: 'object' })
        .done()
        .build()

      assert.ok(ws.channels?.['private-user-updates'])
      assert.equal(ws.channels?.['private-user-updates'].type, 'private')
    })

    it('should preserve existing private prefix', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .private('private-existing')
        .done()
        .build()

      assert.ok(ws.channels?.['private-existing'])
    })

    it('should create presence channel with auto-prefix', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .presence('room')
        .done()
        .build()

      assert.ok(ws.channels?.['presence-room'])
      assert.equal(ws.channels?.['presence-room'].type, 'presence')
    })

    it('should create channel with explicit type', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .channel('custom', 'public')
        .done()
        .build()

      assert.ok(ws.channels?.custom)
      assert.equal(ws.channels?.custom.type, 'public')
    })
  })

  describe('ChannelBuilder', () => {
    it('should set description', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .public('events')
        .description('Real-time events')
        .done()
        .build()

      assert.equal(ws.channels?.events.description, 'Real-time events')
    })

    it('should set tags', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .public('events')
        .tags('realtime', 'events')
        .done()
        .build()

      assert.deepEqual(ws.channels?.events.tags, ['realtime', 'events'])
    })

    it('should set subscribe operation', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .public('events')
        .subscribe({ type: 'object' }, { summary: 'Receive events' })
        .done()
        .build()

      assert.ok(ws.channels?.events.subscribe)
      assert.equal(ws.channels?.events.subscribe?.summary, 'Receive events')
    })

    it('should set subscribe content types', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .public('events')
        .subscribe({ type: 'object' }, {
          contentTypes: {
            default: 'application/json',
            supported: ['application/json', 'text/csv'],
          },
        })
        .done()
        .build()

      assert.deepEqual(ws.channels?.events.subscribe?.contentTypes, {
        default: 'application/json',
        supported: ['application/json', 'text/csv'],
      })
    })

    it('should set publish operation', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .public('chat')
        .publish({ type: 'object' }, { summary: 'Send message' })
        .done()
        .build()

      assert.ok(ws.channels?.chat.publish)
      assert.equal(ws.channels?.chat.publish?.summary, 'Send message')
    })

    it('should set bidirectional', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .public('chat')
        .bidirectional({ type: 'object' })
        .done()
        .build()

      assert.ok(ws.channels?.chat.subscribe)
      assert.ok(ws.channels?.chat.publish)
    })

    it('should set bidirectional content types', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .public('chat')
        .bidirectional({ type: 'object' }, {
          subscribeContentTypes: { default: 'application/json' },
          publishContentTypes: { default: 'application/octet-stream' },
        })
        .done()
        .build()

      assert.equal(ws.channels?.chat.subscribe?.contentTypes?.default, 'application/json')
      assert.equal(ws.channels?.chat.publish?.contentTypes?.default, 'application/octet-stream')
    })

    it('should accept USDMessage directly', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .public('events')
        .subscribe({
          name: 'Event',
          payload: { type: 'object' },
        })
        .done()
        .build()

      assert.equal(ws.channels?.events.subscribe?.message?.name, 'Event')
    })

    it('should set presence configuration', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .presence('lobby')
        .presence({
          memberSchema: { type: 'object' },
          events: ['member_added', 'member_removed', 'member_updated'],
        })
        .done()
        .build()

      const channel = ws.channels?.['presence-lobby']
      assert.ok(channel?.['x-usd-presence'])
      assert.deepEqual(channel?.['x-usd-presence']?.events, ['member_added', 'member_removed', 'member_updated'])
    })

    it('should set member schema shorthand', () => {
      const ws = createWebSocketBuilder(docBuilder)
        .presence('lobby')
        .memberSchema({ type: 'object', properties: { name: { type: 'string' } } })
        .done()
        .build()

      const channel = ws.channels?.['presence-lobby']
      assert.ok(channel?.['x-usd-presence']?.memberSchema)
    })
  })
})

// ============================================================================
// Streams Builder Tests
// ============================================================================

describe('StreamsBuilder', () => {
  let docBuilder: DocumentBuilder

  beforeEach(() => {
    docBuilder = document({ title: 'Test', version: '1.0.0' })
  })

  it('should create stream endpoint with direction', () => {
    const streams = createStreamsBuilder(docBuilder)
      .endpoint('/events', 'server-to-client')
      .message({ type: 'object' })
      .done()
      .build()

    assert.ok(streams.endpoints?.['/events'])
    assert.equal(streams.endpoints?.['/events'].direction, 'server-to-client')
  })

  it('should set stream content types', () => {
    const streams = createStreamsBuilder(docBuilder)
      .contentTypes({
        default: 'application/json',
        supported: ['application/json', 'text/event-stream'],
      })
      .serverToClient('/events')
      .message({ type: 'object' })
      .done()
      .build()

    assert.deepEqual(streams.contentTypes, {
      default: 'application/json',
      supported: ['application/json', 'text/event-stream'],
    })
  })

  it('should set message schema', () => {
    const streams = createStreamsBuilder(docBuilder)
      .serverToClient('/events')
      .message({ type: 'object' })
      .done()
      .build()

    assert.ok(streams.endpoints?.['/events'].message)
  })

  it('should set description', () => {
    const streams = createStreamsBuilder(docBuilder)
      .serverToClient('/events')
      .message({ type: 'object' })
      .description('Event stream')
      .done()
      .build()

    assert.equal(streams.endpoints?.['/events'].description, 'Event stream')
  })

  it('should set endpoint content types', () => {
    const streams = createStreamsBuilder(docBuilder)
      .serverToClient('/events')
      .contentTypes({ default: 'application/json' })
      .message({ type: 'object' })
      .done()
      .build()

    assert.equal(streams.endpoints?.['/events'].contentTypes?.default, 'application/json')
  })

  it('should set tags', () => {
    const streams = createStreamsBuilder(docBuilder)
      .serverToClient('/events')
      .message({ type: 'object' })
      .tags('realtime', 'sse')
      .done()
      .build()

    assert.deepEqual(streams.endpoints?.['/events'].tags, ['realtime', 'sse'])
  })

  it('should set security', () => {
    const streams = createStreamsBuilder(docBuilder)
      .serverToClient('/events')
      .message({ type: 'object' })
      .security({ bearerAuth: [] })
      .done()
      .build()

    assert.deepEqual(streams.endpoints?.['/events'].security, [{ bearerAuth: [] }])
  })

  it('should enable backpressure', () => {
    const streams = createStreamsBuilder(docBuilder)
      .bidirectional('/sync')
      .message({ type: 'object' })
      .backpressure()
      .done()
      .build()

    assert.equal(streams.endpoints?.['/sync']['x-usd-backpressure'], true)
  })

  it('should use serverToClient shorthand', () => {
    const streams = createStreamsBuilder(docBuilder)
      .serverToClient('/events')
      .message({ type: 'object' })
      .done()
      .build()

    assert.equal(streams.endpoints?.['/events'].direction, 'server-to-client')
  })

  it('should use clientToServer shorthand', () => {
    const streams = createStreamsBuilder(docBuilder)
      .clientToServer('/upload')
      .message({ type: 'object' })
      .done()
      .build()

    assert.equal(streams.endpoints?.['/upload'].direction, 'client-to-server')
  })

  it('should use bidirectional shorthand', () => {
    const streams = createStreamsBuilder(docBuilder)
      .bidirectional('/sync')
      .message({ type: 'object' })
      .done()
      .build()

    assert.equal(streams.endpoints?.['/sync'].direction, 'bidirectional')
  })

  it('should accept USDMessage directly', () => {
    const streams = createStreamsBuilder(docBuilder)
      .serverToClient('/events')
      .message({
        name: 'Event',
        payload: { type: 'object' },
      })
      .done()
      .build()

    assert.equal(streams.endpoints?.['/events'].message?.name, 'Event')
  })
})

// ============================================================================
// JSON-RPC Builder Tests
// ============================================================================

describe('JsonRpcBuilder', () => {
  let docBuilder: DocumentBuilder

  beforeEach(() => {
    docBuilder = document({ title: 'Test', version: '1.0.0' })
  })

  it('should set endpoint', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .endpoint('/rpc')
      .build()

    assert.equal(rpc.endpoint, '/rpc')
  })

  it('should have default version 2.0', () => {
    const rpc = createJsonRpcBuilder(docBuilder).build()

    assert.equal(rpc.version, '2.0')
  })

  it('should set JSON-RPC content types', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .contentTypes({ default: 'application/json', supported: ['application/json'] })
      .build()

    assert.deepEqual(rpc.contentTypes, {
      default: 'application/json',
      supported: ['application/json'],
    })
  })

  it('should add method', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .method('users.list')
      .done()
      .build()

    assert.ok(rpc.methods?.['users.list'])
  })

  it('should set method params', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .method('users.get')
      .params({ type: 'object', properties: { id: { type: 'string' } } })
      .done()
      .build()

    assert.ok(rpc.methods?.['users.get'].params)
  })

  it('should set method result', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .method('users.get')
      .result({ type: 'object' })
      .done()
      .build()

    assert.ok(rpc.methods?.['users.get'].result)
  })

  it('should set method description', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .method('users.get')
      .description('Get user by ID')
      .done()
      .build()

    assert.equal(rpc.methods?.['users.get'].description, 'Get user by ID')
  })

  it('should set method content types', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .method('users.get')
      .contentTypes({ default: 'application/json' })
      .done()
      .build()

    assert.equal(rpc.methods?.['users.get'].contentTypes?.default, 'application/json')
  })

  it('should set method tags', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .method('users.get')
      .tags('users')
      .done()
      .build()

    assert.deepEqual(rpc.methods?.['users.get'].tags, ['users'])
  })

  it('should set method security', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .method('users.get')
      .security({ bearerAuth: [] })
      .done()
      .build()

    assert.deepEqual(rpc.methods?.['users.get'].security, [{ bearerAuth: [] }])
  })

  it('should mark method as streaming', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .method('events.subscribe')
      .streaming()
      .done()
      .build()

    assert.equal(rpc.methods?.['events.subscribe']['x-usd-streaming'], true)
  })

  it('should mark method as notification', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .method('logs.send')
      .notification()
      .done()
      .build()

    assert.equal(rpc.methods?.['logs.send']['x-usd-notification'], true)
  })

  it('should create notification via shorthand', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .notification('logs.send')
      .done()
      .build()

    assert.equal(rpc.methods?.['logs.send']['x-usd-notification'], true)
  })

  it('should create stream via shorthand', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .stream('events.subscribe')
      .done()
      .build()

    assert.equal(rpc.methods?.['events.subscribe']['x-usd-streaming'], true)
  })

  it('should configure batch support', () => {
    const rpc = createJsonRpcBuilder(docBuilder)
      .batch({ enabled: true, maxSize: 10 })
      .build()

    assert.equal(rpc.batch?.enabled, true)
    assert.equal(rpc.batch?.maxSize, 10)
  })
})

// ============================================================================
// gRPC Builder Tests
// ============================================================================

describe('GrpcBuilder', () => {
  let docBuilder: DocumentBuilder

  beforeEach(() => {
    docBuilder = document({ title: 'Test', version: '1.0.0' })
  })

  it('should have default syntax proto3', () => {
    const grpc = createGrpcBuilder(docBuilder).build()

    assert.equal(grpc.syntax, 'proto3')
  })

  it('should set package name', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .package('com.example.api')
      .build()

    assert.equal(grpc.package, 'com.example.api')
  })

  it('should set syntax', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .syntax('proto2')
      .build()

    assert.equal(grpc.syntax, 'proto2')
  })

  it('should set options', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .options({ java_package: 'com.example.api' })
      .build()

    assert.deepEqual(grpc.options, { java_package: 'com.example.api' })
  })

  it('should set gRPC content types', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .contentTypes({ default: 'application/x-protobuf', supported: ['application/x-protobuf'] })
      .build()

    assert.deepEqual(grpc.contentTypes, {
      default: 'application/x-protobuf',
      supported: ['application/x-protobuf'],
    })
  })

  it('should add service', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('UserService')
      .done()
      .build()

    assert.ok(grpc.services?.UserService)
  })

  it('should set service description', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('UserService')
      .description('User management service')
      .done()
      .build()

    assert.equal(grpc.services?.UserService.description, 'User management service')
  })

  it('should add method to service', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('UserService')
      .method('GetUser')
      .input({ type: 'object' })
      .output({ type: 'object' })
      .done()
      .done()
      .build()

    assert.ok(grpc.services?.UserService.methods?.GetUser)
  })

  it('should set method input/output', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('UserService')
      .method('GetUser')
      .input({ $ref: '#/components/schemas/GetUserRequest' })
      .output({ $ref: '#/components/schemas/User' })
      .done()
      .done()
      .build()

    const method = grpc.services?.UserService.methods?.GetUser
    assert.ok(method?.input)
    assert.ok(method?.output)
  })

  it('should set method description', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('UserService')
      .method('GetUser')
      .description('Get user by ID')
      .input({ type: 'object' })
      .output({ type: 'object' })
      .done()
      .done()
      .build()

    assert.equal(grpc.services?.UserService.methods?.GetUser.description, 'Get user by ID')
  })

  it('should set method tags', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('UserService')
      .method('GetUser')
      .tags('users')
      .input({ type: 'object' })
      .output({ type: 'object' })
      .done()
      .done()
      .build()

    assert.deepEqual(grpc.services?.UserService.methods?.GetUser.tags, ['users'])
  })

  it('should set method content types', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('UserService')
      .method('GetUser')
      .contentTypes({ default: 'application/x-protobuf' })
      .input({ type: 'object' })
      .output({ type: 'object' })
      .done()
      .done()
      .build()

    assert.equal(grpc.services?.UserService.methods?.GetUser.contentTypes?.default, 'application/x-protobuf')
  })

  it('should set server streaming', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('UserService')
      .method('StreamUsers')
      .serverStreaming()
      .input({ type: 'object' })
      .output({ type: 'object' })
      .done()
      .done()
      .build()

    assert.equal(grpc.services?.UserService.methods?.StreamUsers['x-usd-server-streaming'], true)
  })

  it('should set client streaming', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('UserService')
      .method('UploadData')
      .clientStreaming()
      .input({ type: 'object' })
      .output({ type: 'object' })
      .done()
      .done()
      .build()

    assert.equal(grpc.services?.UserService.methods?.UploadData['x-usd-client-streaming'], true)
  })

  it('should set bidirectional streaming', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('ChatService')
      .method('Chat')
      .bidirectionalStreaming()
      .input({ type: 'object' })
      .output({ type: 'object' })
      .done()
      .done()
      .build()

    const method = grpc.services?.ChatService.methods?.Chat
    assert.equal(method?.['x-usd-client-streaming'], true)
    assert.equal(method?.['x-usd-server-streaming'], true)
  })

  it('should create unary method via shorthand', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('UserService')
      .unary('GetUser')
      .input({ type: 'object' })
      .output({ type: 'object' })
      .done()
      .done()
      .build()

    assert.ok(grpc.services?.UserService.methods?.GetUser)
    assert.ok(!grpc.services?.UserService.methods?.GetUser['x-usd-server-streaming'])
    assert.ok(!grpc.services?.UserService.methods?.GetUser['x-usd-client-streaming'])
  })

  it('should create server stream via shorthand', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('UserService')
      .serverStream('ListUsers')
      .input({ type: 'object' })
      .output({ type: 'object' })
      .done()
      .done()
      .build()

    assert.equal(grpc.services?.UserService.methods?.ListUsers['x-usd-server-streaming'], true)
  })

  it('should create client stream via shorthand', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('UserService')
      .clientStream('UploadData')
      .input({ type: 'object' })
      .output({ type: 'object' })
      .done()
      .done()
      .build()

    assert.equal(grpc.services?.UserService.methods?.UploadData['x-usd-client-streaming'], true)
  })

  it('should create bidi stream via shorthand', () => {
    const grpc = createGrpcBuilder(docBuilder)
      .service('ChatService')
      .bidiStream('Chat')
      .input({ type: 'object' })
      .output({ type: 'object' })
      .done()
      .done()
      .build()

    const method = grpc.services?.ChatService.methods?.Chat
    assert.equal(method?.['x-usd-client-streaming'], true)
    assert.equal(method?.['x-usd-server-streaming'], true)
  })
})

// ============================================================================
// TCP Builder Tests
// ============================================================================

describe('TcpBuilder', () => {
  let docBuilder: DocumentBuilder

  beforeEach(() => {
    docBuilder = document({ title: 'Test', version: '1.0.0' })
  })

  it('should set TCP content types', () => {
    const tcp = createTcpBuilder(docBuilder)
      .contentTypes({
        default: 'application/octet-stream',
        supported: ['application/octet-stream', 'application/json'],
      })
      .server('alpha', { host: 'localhost', port: 9000 })
      .done()
      .build()

    assert.deepEqual(tcp.contentTypes, {
      default: 'application/octet-stream',
      supported: ['application/octet-stream', 'application/json'],
    })
  })

  it('should set server content types', () => {
    const tcp = createTcpBuilder(docBuilder)
      .server('alpha', { host: 'localhost', port: 9000 })
      .contentTypes({ default: 'application/json' })
      .done()
      .build()

    assert.equal(tcp.servers?.alpha.contentTypes?.default, 'application/json')
  })
})

// ============================================================================
// UDP Builder Tests
// ============================================================================

describe('UdpBuilder', () => {
  let docBuilder: DocumentBuilder

  beforeEach(() => {
    docBuilder = document({ title: 'Test', version: '1.0.0' })
  })

  it('should set UDP content types', () => {
    const udp = createUdpBuilder(docBuilder)
      .contentTypes({
        default: 'application/octet-stream',
        supported: ['application/octet-stream', 'application/json'],
      })
      .endpoint('alpha', { host: '0.0.0.0', port: 9000 })
      .done()
      .build()

    assert.deepEqual(udp.contentTypes, {
      default: 'application/octet-stream',
      supported: ['application/octet-stream', 'application/json'],
    })
  })

  it('should set endpoint content types', () => {
    const udp = createUdpBuilder(docBuilder)
      .endpoint('alpha', { host: '0.0.0.0', port: 9000 })
      .contentTypes({ default: 'application/json' })
      .done()
      .build()

    assert.equal(udp.endpoints?.alpha.contentTypes?.default, 'application/json')
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Builder Integration', () => {
  it('should build complete multi-protocol document', () => {
    const doc = document({ title: 'Multi-Protocol API', version: '1.0.0' })
      .description('API with multiple protocols')
      .server('https://api.example.com')
      .server('wss://ws.example.com', { protocol: 'websocket' })
      .tag('users', { description: 'User operations' })
      .schema('User', object({
        id: formats.uuid(),
        name: string(),
        email: formats.email(),
      }, { required: ['id', 'name', 'email'] }))
      .schema('Error', object({
        code: string(),
        message: string(),
      }))
      .securityScheme('bearerAuth', { type: 'http', scheme: 'bearer' })
      .security({ bearerAuth: [] })
      .error('NOT_FOUND', { code: 'NOT_FOUND', message: 'Resource not found', httpStatus: 404 })
      .http('/users')
        .get('listUsers')
          .tags('users')
          .query('limit', integer({ minimum: 1, maximum: 100 }))
          .response(200, array(ref('User')))
          .done()
        .post('createUser')
          .tags('users')
          .body(ref('User'))
          .response(201, ref('User'))
          .done()
        .done()
        .done()
      .http('/users/{id}')
        .get('getUser')
          .path('id', formats.uuid())
          .response(200, ref('User'))
          .response(404, ref('Error'))
          .done()
        .done()
        .done()
      .websocket()
        .path('/ws')
        .authentication({ in: 'query', name: 'token' })
        .public('notifications')
          .description('User notifications')
          .subscribe(object({ type: string(), data: { type: 'object' } }))
          .done()
        .presence('users')
          .bidirectional(ref('User'))
          .memberSchema(ref('User'))
          .done()
        .done()
      .streams()
        .serverToClient('/events')
          .message(object({ event: string(), timestamp: formats.datetime() }))
          .description('Server-sent events')
          .done()
        .done()
      .build()

    // Verify structure
    assert.equal(doc.info.title, 'Multi-Protocol API')
    assert.equal(doc.servers?.length, 1)
    assert.equal(doc['x-usd']?.servers?.length, 1)
    assert.equal(doc.tags?.length, 1)
    assert.ok(doc.components?.schemas?.User)
    assert.ok(doc.components?.schemas?.Error)
    assert.ok(doc.components?.securitySchemes?.bearerAuth)
    assert.ok(doc.security)
    assert.ok(doc['x-usd']?.errors?.NOT_FOUND)
    assert.ok(doc.paths?.['/users'])
    assert.ok(doc.paths?.['/users/{id}'])
    assert.ok(doc['x-usd']?.websocket?.channels?.notifications)
    assert.ok(doc['x-usd']?.websocket?.channels?.['presence-users'])
    assert.ok(doc['x-usd']?.streams?.endpoints?.['/events'])

    // Verify protocol inference
    assert.ok(doc['x-usd']?.protocols?.includes('http'))
    assert.ok(doc['x-usd']?.protocols?.includes('websocket'))
    assert.ok(doc['x-usd']?.protocols?.includes('streams'))
  })

  it('should chain through document builder', () => {
    // Test that done() returns the correct parent builder
    // Chain: http(path) → PathBuilder, get() → OperationBuilder
    // done() → PathBuilder, done() → HttpBuilder, done() → DocumentBuilder
    const doc = document({ title: 'Test', version: '1.0.0' })
      .http('/a').get().done().done().done()
      .http('/b').post().done().done().done()
      .websocket().public('c').done().done()
      .streams().serverToClient('/d').message({ type: 'object' }).done().done()
      .jsonrpc().method('e').done().done()
      .grpc().service('F').done().done()
      .tcp().server('alpha', { host: 'localhost', port: 9000 }).done().done()
      .udp().endpoint('beta', { host: '0.0.0.0', port: 9001 }).done().done()
      .build()

    assert.ok(doc.paths?.['/a'])
    assert.ok(doc.paths?.['/b'])
    assert.ok(doc['x-usd']?.websocket?.channels?.c)
    assert.ok(doc['x-usd']?.streams?.endpoints?.['/d'])
    assert.ok(doc['x-usd']?.jsonrpc?.methods?.e)
    assert.ok(doc['x-usd']?.grpc?.services?.F)
    assert.ok(doc['x-usd']?.tcp?.servers?.alpha)
    assert.ok(doc['x-usd']?.udp?.endpoints?.beta)
  })

  it('should use http shorthand with path', () => {
    // Chain: http(path) → PathBuilder, done() → HttpBuilder, done() → DocumentBuilder
    const doc = document({ title: 'Test', version: '1.0.0' })
      .http('/users')
        .get('list').response(200).done()
        .post('create').body({ type: 'object' }).done()
      .done()
      .done()
      .build()

    assert.ok(doc.paths?.['/users'].get)
    assert.ok(doc.paths?.['/users'].post)
  })
})
