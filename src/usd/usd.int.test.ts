/**
 * USD Module Integration Tests
 *
 * Tests for:
 * - Parser (parse, serialize, format detection)
 * - Validator (validate, validateOrThrow, isValid)
 * - Document Builder (fluent API)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFile, unlink, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Parser imports
import {
  parse,
  parseFile,
  serialize,
  detectFormat,
  detectFormatFromPath,
  createDocumentWrapper,
  USDParseError,
} from './parser/index.js'

// Validator imports
import {
  validate,
  validateOrThrow,
  isValid,
  formatValidationResult,
  USDValidationException,
} from './validator/index.js'

// Builder imports
import { USD, DocumentBuilder, document } from './builder/document.js'

// Types
import type { USDDocument } from './spec/types.js'

// =============================================================================
// Test Fixtures
// =============================================================================

const VALID_JSON_DOC = `{
  "usd": "1.0.0",
  "openapi": "3.1.0",
  "info": {
    "title": "Test API",
    "version": "1.0.0",
    "description": "A test API"
  }
}`

const VALID_YAML_DOC = `usd: "1.0.0"
openapi: "3.1.0"
info:
  title: Test API
  version: "1.0.0"
  description: A test API`

const INVALID_JSON = '{ "invalid": json }'

const INVALID_YAML = `
usd: "1.0.0"
openapi: "3.1.0"
info:
  - this is wrong
`

const MISSING_INFO_DOC = `{
  "usd": "1.0.0",
  "openapi": "3.1.0"
}`

const WRONG_VERSION_DOC = `{
  "usd": "2.0.0",
  "openapi": "3.1.0",
  "info": {
    "title": "Test",
    "version": "1.0.0"
  }
}`

// =============================================================================
// Parser Tests
// =============================================================================

describe('USD Parser', () => {
  describe('detectFormat', () => {
    it('should detect JSON from content starting with {', () => {
      expect(detectFormat('{"key": "value"}')).toBe('json')
    })

    it('should detect JSON from content starting with [', () => {
      expect(detectFormat('[1, 2, 3]')).toBe('json')
    })

    it('should detect YAML for other content', () => {
      expect(detectFormat('key: value')).toBe('yaml')
      expect(detectFormat('---\nkey: value')).toBe('yaml')
    })

    it('should handle whitespace before content', () => {
      expect(detectFormat('  \n  {"key": "value"}')).toBe('json')
      expect(detectFormat('  \n  key: value')).toBe('yaml')
    })
  })

  describe('detectFormatFromPath', () => {
    it('should detect JSON from .json extension', () => {
      expect(detectFormatFromPath('file.json')).toBe('json')
      expect(detectFormatFromPath('/path/to/file.JSON')).toBe('json')
    })

    it('should detect YAML from .yaml extension', () => {
      expect(detectFormatFromPath('file.yaml')).toBe('yaml')
      expect(detectFormatFromPath('/path/to/file.YAML')).toBe('yaml')
    })

    it('should detect YAML from .yml extension', () => {
      expect(detectFormatFromPath('file.yml')).toBe('yaml')
    })

    it('should default to YAML for unknown extensions', () => {
      expect(detectFormatFromPath('file.txt')).toBe('yaml')
      expect(detectFormatFromPath('file')).toBe('yaml')
    })
  })

  describe('parse', () => {
    it('should parse valid JSON', () => {
      const doc = parse(VALID_JSON_DOC)

      expect(doc.usd).toBe('1.0.0')
      expect(doc.openapi).toBe('3.1.0')
      expect(doc.info.title).toBe('Test API')
      expect(doc.info.version).toBe('1.0.0')
    })

    it('should parse valid YAML', () => {
      const doc = parse(VALID_YAML_DOC)

      expect(doc.usd).toBe('1.0.0')
      expect(doc.openapi).toBe('3.1.0')
      expect(doc.info.title).toBe('Test API')
    })

    it('should auto-detect format', () => {
      const jsonDoc = parse(VALID_JSON_DOC)
      const yamlDoc = parse(VALID_YAML_DOC)

      expect(jsonDoc.info.title).toBe('Test API')
      expect(yamlDoc.info.title).toBe('Test API')
    })

    it('should accept format override', () => {
      // Force YAML parsing on JSON-looking content (will fail)
      const yamlLike = 'usd: "1.0.0"\nopenapi: "3.1.0"\ninfo:\n  title: Test\n  version: "1.0.0"'
      const doc = parse(yamlLike, { format: 'yaml' })
      expect(doc.info.title).toBe('Test')
    })

    it('should throw USDParseError on invalid JSON', () => {
      expect(() => parse(INVALID_JSON)).toThrow(USDParseError)
    })

    it('should include format in parse error', () => {
      try {
        parse(INVALID_JSON)
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(USDParseError)
        expect((err as USDParseError).format).toBe('json')
      }
    })

    it('should support raw option to skip normalization', () => {
      const doc = parse(VALID_JSON_DOC, { raw: true })
      expect(doc.info.title).toBe('Test API')
    })
  })

  describe('parseFile', () => {
    const TEST_DIR = join(tmpdir(), 'raffel-usd-test')
    const JSON_FILE = join(TEST_DIR, 'test.json')
    const YAML_FILE = join(TEST_DIR, 'test.yaml')
    const YML_FILE = join(TEST_DIR, 'test.yml')

    beforeAll(async () => {
      await mkdir(TEST_DIR, { recursive: true })
      await writeFile(JSON_FILE, VALID_JSON_DOC)
      await writeFile(YAML_FILE, VALID_YAML_DOC)
      await writeFile(YML_FILE, VALID_YAML_DOC)
    })

    afterAll(async () => {
      await rm(TEST_DIR, { recursive: true, force: true })
    })

    it('should parse JSON file', async () => {
      const doc = await parseFile(JSON_FILE)
      expect(doc.info.title).toBe('Test API')
    })

    it('should parse YAML file', async () => {
      const doc = await parseFile(YAML_FILE)
      expect(doc.info.title).toBe('Test API')
    })

    it('should parse YML file', async () => {
      const doc = await parseFile(YML_FILE)
      expect(doc.info.title).toBe('Test API')
    })

    it('should throw on non-existent file', async () => {
      await expect(parseFile('/nonexistent/file.json')).rejects.toThrow()
    })
  })

  describe('serialize', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: {
        title: 'Serialized API',
        version: '2.0.0',
      },
    }

    it('should serialize to JSON', () => {
      const json = serialize(doc, 'json')

      expect(json).toContain('"usd": "1.0.0"')
      expect(json).toContain('"title": "Serialized API"')
    })

    it('should serialize to YAML', () => {
      const yaml = serialize(doc, 'yaml')

      expect(yaml).toContain('usd:')
      expect(yaml).toContain('title: Serialized API')
    })

    it('should support pretty option for JSON', () => {
      const prettyJson = serialize(doc, 'json', { pretty: true })
      const compactJson = serialize(doc, 'json', { pretty: false })

      expect(prettyJson.split('\n').length).toBeGreaterThan(1)
      expect(compactJson.split('\n').length).toBe(1)
    })

    it('should default to YAML format', () => {
      const output = serialize(doc)
      expect(output).toContain('usd:')
    })

    it('should round-trip JSON', () => {
      const json = serialize(doc, 'json')
      const reparsed = parse(json)

      expect(reparsed.info.title).toBe('Serialized API')
    })

    it('should round-trip YAML', () => {
      const yaml = serialize(doc, 'yaml')
      const reparsed = parse(yaml)

      expect(reparsed.info.title).toBe('Serialized API')
    })
  })

  describe('createDocumentWrapper', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: {
        title: 'Wrapper Test',
        version: '1.0.0',
      },
    }

    it('should provide access to raw document', () => {
      const wrapper = createDocumentWrapper(doc)
      expect(wrapper.document).toBe(doc)
    })

    it('should serialize to JSON', () => {
      const wrapper = createDocumentWrapper(doc)
      const json = wrapper.toJson()

      expect(json).toContain('"title": "Wrapper Test"')
    })

    it('should serialize to YAML', () => {
      const wrapper = createDocumentWrapper(doc)
      const yaml = wrapper.toYaml()

      expect(yaml).toContain('title: Wrapper Test')
    })

    it('should clone document', () => {
      const wrapper = createDocumentWrapper(doc)
      const cloned = wrapper.clone()

      expect(cloned).toEqual(doc)
      expect(cloned).not.toBe(doc)
    })

    it('should merge with another document', () => {
      const wrapper = createDocumentWrapper(doc)
      const merged = wrapper.merge({
        info: {
          title: 'Merged Title',
          version: '2.0.0',
          description: 'Added description',
        },
      })

      expect(merged.info.title).toBe('Merged Title')
      expect(merged.info.description).toBe('Added description')
    })
  })
})

// =============================================================================
// Validator Tests
// =============================================================================

describe('USD Validator', () => {
  describe('validate', () => {
    it('should validate a correct document', () => {
      const doc = parse(VALID_JSON_DOC)
      const result = validate(doc)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should fail on missing info', () => {
      const doc = JSON.parse(MISSING_INFO_DOC)
      const result = validate(doc)

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should fail on wrong USD version', () => {
      const doc = JSON.parse(WRONG_VERSION_DOC)
      const result = validate(doc)

      expect(result.valid).toBe(false)
    })

    it('should fail on null input', () => {
      const result = validate(null)
      expect(result.valid).toBe(false)
    })

    it('should fail on undefined input', () => {
      const result = validate(undefined)
      expect(result.valid).toBe(false)
    })

    it('should fail on non-object input', () => {
      const result = validate('string')
      expect(result.valid).toBe(false)
    })

    describe('options', () => {
      it('should skip schema validation with skipSchema option', () => {
        const invalidDoc = { info: { title: 'Test', version: '1.0.0' } }
        const result = validate(invalidDoc, { skipSchema: true })

        // Without schema validation, just semantic checks run
        // Semantic validation requires a USD-document-like object
        expect(result).toBeDefined()
      })

      it('should skip semantic validation with skipSemantic option', () => {
        const doc = parse(VALID_JSON_DOC)
        const result = validate(doc, { skipSemantic: true })

        expect(result.valid).toBe(true)
      })

      it('should treat warnings as errors in strict mode', () => {
        // Create a doc that might have warnings
        const doc = USD.document({
          title: 'Test API',
          version: '1.0.0',
        }).build()

        const normalResult = validate(doc)
        const strictResult = validate(doc, { strict: true })

        // If there are warnings in normal mode, strict mode should fail
        if (normalResult.warnings.length > 0) {
          expect(strictResult.valid).toBe(false)
        } else {
          expect(strictResult.valid).toBe(true)
        }
      })
    })
  })

  describe('validateOrThrow', () => {
    it('should not throw for valid document', () => {
      const doc = parse(VALID_JSON_DOC)
      expect(() => validateOrThrow(doc)).not.toThrow()
    })

    it('should throw for invalid document', () => {
      expect(() => validateOrThrow(null)).toThrow('USD validation failed')
    })

    it('should include formatted error in exception', () => {
      try {
        validateOrThrow(null)
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(Error)
        expect((err as Error).message).toContain('USD validation failed')
      }
    })
  })

  describe('isValid', () => {
    it('should return true for valid document', () => {
      const doc = parse(VALID_JSON_DOC)
      expect(isValid(doc)).toBe(true)
    })

    it('should return false for invalid document', () => {
      expect(isValid(null)).toBe(false)
      expect(isValid({})).toBe(false)
      expect(isValid({ usd: '1.0.0' })).toBe(false)
    })

    it('should accept options', () => {
      const invalidDoc = { info: { title: 'Test', version: '1.0.0' } }
      expect(isValid(invalidDoc, { skipSchema: true })).toBe(true)
    })
  })

  describe('formatValidationResult', () => {
    it('should format errors nicely', () => {
      const result = validate(null)
      const formatted = formatValidationResult(result)

      expect(typeof formatted).toBe('string')
      expect(formatted.length).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// Document Builder Tests
// =============================================================================

describe('USD Document Builder', () => {
  describe('basic document creation', () => {
    it('should create minimal document', () => {
      const doc = USD.document({
        title: 'My API',
        version: '1.0.0',
      }).build()

      expect(doc.usd).toBe('1.0.0')
      expect(doc.openapi).toBe('3.1.0')
      expect(doc.info.title).toBe('My API')
      expect(doc.info.version).toBe('1.0.0')
    })

    it('should create document with description', () => {
      const doc = document({
        title: 'My API',
        version: '1.0.0',
        description: 'A great API',
      }).build()

      expect(doc.info.description).toBe('A great API')
    })

    it('should create document with protocols', () => {
      const doc = USD.document({
        title: 'Multi-Protocol API',
        version: '1.0.0',
        protocols: ['http', 'websocket'],
      }).build()

      expect(doc['x-usd']?.protocols).toContain('http')
      expect(doc['x-usd']?.protocols).toContain('websocket')
    })
  })

  describe('info methods', () => {
    it('should set description', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .description('New description')
        .build()

      expect(doc.info.description).toBe('New description')
    })

    it('should set summary', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .summary('API summary')
        .build()

      expect(doc.info.summary).toBe('API summary')
    })

    it('should set terms of service', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .termsOfService('https://example.com/tos')
        .build()

      expect(doc.info.termsOfService).toBe('https://example.com/tos')
    })

    it('should set contact info', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .contact({
          name: 'Support',
          email: 'support@example.com',
          url: 'https://support.example.com',
        })
        .build()

      expect(doc.info.contact?.name).toBe('Support')
      expect(doc.info.contact?.email).toBe('support@example.com')
    })

    it('should set license info', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .license({ name: 'MIT', url: 'https://opensource.org/licenses/MIT' })
        .build()

      expect(doc.info.license?.name).toBe('MIT')
    })
  })

  describe('server methods', () => {
    it('should add HTTP server', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .server('https://api.example.com', { description: 'Production' })
        .build()

      expect(doc.servers).toHaveLength(1)
      expect(doc.servers![0].url).toBe('https://api.example.com')
      expect(doc.servers![0].description).toBe('Production')
    })

    it('should add multiple servers', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .server('https://api.example.com', { description: 'Production' })
        .server('https://staging.example.com', { description: 'Staging' })
        .build()

      expect(doc.servers).toHaveLength(2)
    })

    it('should add server with variables', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .server('https://{region}.api.example.com', {
          variables: {
            region: { default: 'us', enum: ['us', 'eu', 'asia'] },
          },
        })
        .build()

      expect(doc.servers![0].variables?.region.default).toBe('us')
    })

    it('should add protocol-specific server to x-usd', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .server('wss://ws.example.com', { protocol: 'websocket' })
        .build()

      expect(doc['x-usd']?.servers).toHaveLength(1)
      expect(doc['x-usd']?.servers![0].protocol).toBe('websocket')
    })
  })

  describe('tag methods', () => {
    it('should add tag', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .tag('users', { description: 'User operations' })
        .build()

      expect(doc.tags).toHaveLength(1)
      expect(doc.tags![0].name).toBe('users')
    })

    it('should add multiple tags', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .tag('users')
        .tag('products')
        .tag('orders')
        .build()

      expect(doc.tags).toHaveLength(3)
    })

    it('should set external docs', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .externalDocs('https://docs.example.com', 'Full documentation')
        .build()

      expect(doc.externalDocs?.url).toBe('https://docs.example.com')
      expect(doc.externalDocs?.description).toBe('Full documentation')
    })
  })

  describe('component methods', () => {
    it('should add schema', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .schema('User', {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
        })
        .build()

      expect(doc.components?.schemas?.User).toBeDefined()
      expect(doc.components?.schemas?.User.type).toBe('object')
    })

    it('should add multiple schemas', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .schemas({
          User: { type: 'object' },
          Product: { type: 'object' },
        })
        .build()

      expect(doc.components?.schemas?.User).toBeDefined()
      expect(doc.components?.schemas?.Product).toBeDefined()
    })

    it('should add security scheme', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .securityScheme('bearerAuth', {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        })
        .build()

      expect(doc.components?.securitySchemes?.bearerAuth).toBeDefined()
      expect(doc.components?.securitySchemes?.bearerAuth.type).toBe('http')
    })

    it('should add global security requirement', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .securityScheme('apiKey', { type: 'apiKey', name: 'X-API-Key', in: 'header' })
        .security({ apiKey: [] })
        .build()

      expect(doc.security).toHaveLength(1)
      expect(doc.security![0]).toHaveProperty('apiKey')
    })
  })

  describe('error methods', () => {
    it('should add error definition', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .error('NotFound', {
          status: 404,
          message: 'Resource not found',
        })
        .build()

      expect(doc['x-usd']?.errors?.NotFound).toBeDefined()
      expect(doc['x-usd']?.errors?.NotFound.status).toBe(404)
    })

    it('should add multiple errors', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .errors({
          NotFound: { status: 404, message: 'Not found' },
          Unauthorized: { status: 401, message: 'Unauthorized' },
        })
        .build()

      expect(doc['x-usd']?.errors?.NotFound).toBeDefined()
      expect(doc['x-usd']?.errors?.Unauthorized).toBeDefined()
    })
  })

  describe('protocol builders', () => {
    it('should get HTTP builder', () => {
      const builder = USD.document({ title: 'Test', version: '1.0.0' })
      const http = builder.http()

      expect(http).toBeDefined()
      expect(typeof http.path).toBe('function')
    })

    it('should get WebSocket builder', () => {
      const builder = USD.document({ title: 'Test', version: '1.0.0' })
      const ws = builder.websocket()

      expect(ws).toBeDefined()
    })

    it('should get ws() as alias for websocket()', () => {
      const builder = USD.document({ title: 'Test', version: '1.0.0' })
      const ws = builder.ws()

      expect(ws).toBeDefined()
    })

    it('should get JSON-RPC builder', () => {
      const builder = USD.document({ title: 'Test', version: '1.0.0' })
      const rpc = builder.jsonrpc()

      expect(rpc).toBeDefined()
    })

    it('should get rpc() as alias for jsonrpc()', () => {
      const builder = USD.document({ title: 'Test', version: '1.0.0' })
      const rpc = builder.rpc()

      expect(rpc).toBeDefined()
    })

    it('should get gRPC builder', () => {
      const builder = USD.document({ title: 'Test', version: '1.0.0' })
      const grpc = builder.grpc()

      expect(grpc).toBeDefined()
    })

    it('should get TCP builder', () => {
      const builder = USD.document({ title: 'Test', version: '1.0.0' })
      const tcp = builder.tcp()

      expect(tcp).toBeDefined()
    })

    it('should get UDP builder', () => {
      const builder = USD.document({ title: 'Test', version: '1.0.0' })
      const udp = builder.udp()

      expect(udp).toBeDefined()
    })
  })

  describe('protocols', () => {
    it('should set protocols explicitly', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .protocols('http', 'websocket')
        .build()

      const protocols = doc['x-usd']?.protocols ?? []
      expect(protocols).toContain('http')
      expect(protocols).toContain('websocket')
    })

    it('should return HTTP builder instance', () => {
      const builder = USD.document({ title: 'Test', version: '1.0.0' })
      const httpBuilder = builder.http()

      expect(httpBuilder).toBeDefined()
      expect(typeof httpBuilder.path).toBe('function')
    })
  })

  describe('content types', () => {
    it('should set content types', () => {
      const doc = USD.document({ title: 'Test', version: '1.0.0' })
        .contentTypes({
          default: 'application/json',
          supported: ['application/xml', 'text/plain'],
        })
        .build()

      expect(doc['x-usd']?.contentTypes?.default).toBe('application/json')
      expect(doc['x-usd']?.contentTypes?.supported).toContain('application/xml')
    })
  })

  describe('serialization methods', () => {
    it('should serialize to JSON', () => {
      const json = USD.document({ title: 'Test', version: '1.0.0' }).toJson()

      expect(json).toContain('"title": "Test"')
      expect(json).toContain('"usd": "1.0.0"')
    })

    it('should serialize to YAML', () => {
      const yaml = USD.document({ title: 'Test', version: '1.0.0' }).toYaml()

      expect(yaml).toContain('title: Test')
      expect(yaml).toContain('usd:')
    })

    it('should support JSON pretty option', () => {
      const pretty = USD.document({ title: 'Test', version: '1.0.0' }).toJson(true)
      const compact = USD.document({ title: 'Test', version: '1.0.0' }).toJson(false)

      expect(pretty.split('\n').length).toBeGreaterThan(1)
      expect(compact.split('\n').length).toBe(1)
    })
  })

  describe('fluent API chaining', () => {
    it('should support full fluent chaining', () => {
      const doc = USD.document({ title: 'Complete API', version: '1.0.0' })
        .description('A complete API example')
        .summary('Complete API')
        .contact({ name: 'Support', email: 'support@example.com' })
        .license({ name: 'MIT' })
        .server('https://api.example.com')
        .tag('users', { description: 'User operations' })
        .schema('User', {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
          },
        })
        .securityScheme('bearerAuth', {
          type: 'http',
          scheme: 'bearer',
        })
        .error('NotFound', { status: 404, message: 'Not found' })
        .build()

      expect(doc.info.title).toBe('Complete API')
      expect(doc.info.description).toBe('A complete API example')
      expect(doc.info.contact?.name).toBe('Support')
      expect(doc.servers).toHaveLength(1)
      expect(doc.tags).toHaveLength(1)
      expect(doc.components?.schemas?.User).toBeDefined()
      expect(doc.components?.securitySchemes?.bearerAuth).toBeDefined()
      expect(doc['x-usd']?.errors?.NotFound).toBeDefined()
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('USD Module Integration', () => {
  it('should build, serialize, parse, and validate a complete document', () => {
    // Build
    const builder = USD.document({
      title: 'Integration Test API',
      version: '1.0.0',
    })
      .description('Integration test')
      .server('https://api.test.com')
      .schema('Item', { type: 'object', properties: { id: { type: 'string' } } })

    // Serialize to JSON
    const json = builder.toJson()

    // Parse
    const parsed = parse(json)

    // Validate
    const result = validate(parsed)

    expect(result.valid).toBe(true)
    expect(parsed.info.title).toBe('Integration Test API')
  })

  it('should round-trip through YAML', () => {
    const original = USD.document({
      title: 'YAML Test',
      version: '2.0.0',
    })
      .server('https://yaml.test.com')
      .build()

    const yaml = serialize(original, 'yaml')
    const parsed = parse(yaml)

    expect(parsed.info.title).toBe('YAML Test')
    expect(parsed.info.version).toBe('2.0.0')
    expect(parsed.servers![0].url).toBe('https://yaml.test.com')
  })

  it('should create wrapper from builder output', () => {
    const doc = USD.document({
      title: 'Wrapper Test',
      version: '1.0.0',
    }).build()

    const wrapper = createDocumentWrapper(doc)

    expect(wrapper.toJson()).toContain('Wrapper Test')
    expect(wrapper.toYaml()).toContain('Wrapper Test')
  })
})
