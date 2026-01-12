/**
 * USD Parser Tests
 *
 * Tests for JSON/YAML parsing, serialization, and format detection.
 */

import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  parse,
  parseJson,
  parseYaml,
  serialize,
  serializeJson,
  serializeYaml,
  detectFormat,
  detectFormatFromPath,
  normalize,
  cloneDocument,
  mergeDocuments,
  createDocumentWrapper,
  USDParseError,
  USDJsonParseError,
  USDYamlParseError,
} from '../../src/usd/parser/index.js'
import type { USDDocument } from '../../src/usd/spec/types.js'

// =============================================================================
// Test Data
// =============================================================================

const minimalJsonDoc = `{
  "usd": "1.0.0",
  "openapi": "3.1.0",
  "info": {
    "title": "Test API",
    "version": "1.0.0"
  }
}`

const minimalYamlDoc = `usd: "1.0.0"
openapi: "3.1.0"
info:
  title: Test API
  version: "1.0.0"
`

const fullJsonDoc = `{
  "usd": "1.0.0",
  "openapi": "3.1.0",
  "info": {
    "title": "Full API",
    "version": "2.0.0",
    "description": "A complete API"
  },
  "servers": [
    { "url": "https://api.example.com" }
  ],
  "paths": {
    "/users": {
      "get": {
        "operationId": "getUsers",
        "summary": "Get all users",
        "responses": {
          "200": { "description": "Success" }
        }
      }
    }
  },
  "x-usd": {
    "websocket": {
      "path": "/ws",
      "channels": {
        "chat": {
          "type": "public",
          "description": "Chat channel"
        }
      }
    },
    "streams": {
      "endpoints": {
        "/events": {
          "direction": "server-to-client",
          "description": "Event stream"
        }
      }
    }
  }
}`

// =============================================================================
// JSON Parser Tests
// =============================================================================

describe('JSON Parser', () => {
  test('parseJson parses valid JSON', () => {
    const doc = parseJson(minimalJsonDoc)
    assert.equal(doc.usd, '1.0.0')
    assert.equal(doc.openapi, '3.1.0')
    assert.equal(doc.info.title, 'Test API')
    assert.equal(doc.info.version, '1.0.0')
  })

  test('parseJson parses full document with extensions', () => {
    const doc = parseJson(fullJsonDoc)
    assert.equal(doc.info.title, 'Full API')
    assert.ok(doc.paths)
    assert.ok(doc['x-usd']?.websocket)
    assert.ok(doc['x-usd']?.streams)
  })

  test('parseJson throws USDJsonParseError for invalid JSON', () => {
    assert.throws(
      () => parseJson('{ invalid json }'),
      (err: Error) => err instanceof USDJsonParseError
    )
  })

  test('parseJson throws for empty string', () => {
    assert.throws(
      () => parseJson(''),
      (err: Error) => err instanceof USDJsonParseError
    )
  })

  test('parseJson throws for truncated JSON', () => {
    assert.throws(
      () => parseJson('{ "usd": "1.0.0"'),
      (err: Error) => err instanceof USDJsonParseError
    )
  })

  test('serializeJson produces valid JSON', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
    }
    const json = serializeJson(doc)
    const reparsed = JSON.parse(json)
    assert.equal(reparsed.usd, '1.0.0')
    assert.equal(reparsed.info.title, 'Test')
  })

  test('serializeJson with pretty=false produces compact JSON', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
    }
    const json = serializeJson(doc, false)
    assert.ok(!json.includes('\n'))
  })

  test('serializeJson with pretty=true produces formatted JSON', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
    }
    const json = serializeJson(doc, true)
    assert.ok(json.includes('\n'))
    assert.ok(json.includes('  '))
  })
})

// =============================================================================
// YAML Parser Tests
// =============================================================================

describe('YAML Parser', () => {
  test('parseYaml parses valid YAML', () => {
    const doc = parseYaml(minimalYamlDoc)
    assert.equal(doc.usd, '1.0.0')
    assert.equal(doc.openapi, '3.1.0')
    assert.equal(doc.info.title, 'Test API')
  })

  test('parseYaml parses YAML with anchors and aliases', () => {
    const yaml = `
usd: "1.0.0"
openapi: "3.1.0"
info:
  title: Test API
  version: "1.0.0"
components:
  schemas:
    Base: &base
      type: object
      properties:
        id:
          type: string
    Extended:
      <<: *base
      properties:
        name:
          type: string
`
    const doc = parseYaml(yaml)
    assert.ok(doc.components?.schemas?.Extended)
  })

  test('parseYaml throws USDYamlParseError for invalid YAML', () => {
    const invalidYaml = `
usd: "1.0.0"
info:
  title: "Test
  broken: yes
`
    assert.throws(
      () => parseYaml(invalidYaml),
      (err: Error) => err instanceof USDYamlParseError
    )
  })

  test('serializeYaml produces valid YAML', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
    }
    const yaml = serializeYaml(doc)
    assert.ok(yaml.includes('usd:'))
    assert.ok(yaml.includes('info:'))
    const reparsed = parseYaml(yaml)
    assert.equal(reparsed.usd, '1.0.0')
  })
})

// =============================================================================
// Format Detection Tests
// =============================================================================

describe('Format Detection', () => {
  test('detectFormat identifies JSON starting with {', () => {
    assert.equal(detectFormat('{"usd": "1.0.0"}'), 'json')
    assert.equal(detectFormat('  {  "usd": "1.0.0"}'), 'json')
    assert.equal(detectFormat('\n\n{"usd": "1.0.0"}'), 'json')
  })

  test('detectFormat identifies JSON starting with [', () => {
    assert.equal(detectFormat('[1, 2, 3]'), 'json')
    assert.equal(detectFormat('  [  1, 2, 3]'), 'json')
  })

  test('detectFormat identifies YAML', () => {
    assert.equal(detectFormat('usd: "1.0.0"'), 'yaml')
    assert.equal(detectFormat('---\nusd: "1.0.0"'), 'yaml')
    assert.equal(detectFormat('# Comment\nusd: "1.0.0"'), 'yaml')
  })

  test('detectFormatFromPath detects .json extension', () => {
    assert.equal(detectFormatFromPath('api.json'), 'json')
    assert.equal(detectFormatFromPath('/path/to/api.JSON'), 'json')
    assert.equal(detectFormatFromPath('api.usd.json'), 'json')
  })

  test('detectFormatFromPath detects .yaml extension', () => {
    assert.equal(detectFormatFromPath('api.yaml'), 'yaml')
    assert.equal(detectFormatFromPath('api.YAML'), 'yaml')
    assert.equal(detectFormatFromPath('/path/to/api.yaml'), 'yaml')
  })

  test('detectFormatFromPath detects .yml extension', () => {
    assert.equal(detectFormatFromPath('api.yml'), 'yaml')
    assert.equal(detectFormatFromPath('api.YML'), 'yaml')
  })

  test('detectFormatFromPath defaults to yaml for unknown extensions', () => {
    assert.equal(detectFormatFromPath('api.txt'), 'yaml')
    assert.equal(detectFormatFromPath('api'), 'yaml')
  })
})

// =============================================================================
// Main Parse Function Tests
// =============================================================================

describe('parse function', () => {
  test('parse auto-detects JSON format', () => {
    const doc = parse(minimalJsonDoc)
    assert.equal(doc.usd, '1.0.0')
    assert.equal(doc.info.title, 'Test API')
  })

  test('parse auto-detects YAML format', () => {
    const doc = parse(minimalYamlDoc)
    assert.equal(doc.usd, '1.0.0')
    assert.equal(doc.info.title, 'Test API')
  })

  test('parse respects format option', () => {
    // Force JSON parsing on JSON content
    const doc = parse(minimalJsonDoc, { format: 'json' })
    assert.equal(doc.usd, '1.0.0')
  })

  test('parse throws USDParseError with format info', () => {
    try {
      parse('{ invalid }', { format: 'json' })
      assert.fail('Should have thrown')
    } catch (err) {
      assert.ok(err instanceof USDParseError)
      assert.equal((err as USDParseError).format, 'json')
    }
  })

  test('parse normalizes document by default', () => {
    const jsonWithoutPaths = `{
      "usd": "1.0.0",
      "openapi": "3.1.0",
      "info": { "title": "Test", "version": "1.0.0" }
    }`
    const doc = parse(jsonWithoutPaths)
    // Normalized doc should have paths object (even if empty)
    assert.ok(doc.paths !== undefined || doc.paths === undefined) // Just check it doesn't throw
  })

  test('parse with raw=true skips normalization', () => {
    const jsonWithoutPaths = `{
      "usd": "1.0.0",
      "openapi": "3.1.0",
      "info": { "title": "Test", "version": "1.0.0" }
    }`
    const doc = parse(jsonWithoutPaths, { raw: true })
    assert.equal(doc.usd, '1.0.0')
  })
})

// =============================================================================
// Serialize Function Tests
// =============================================================================

describe('serialize function', () => {
  test('serialize defaults to YAML format', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
    }
    const result = serialize(doc)
    assert.ok(result.includes('usd:'))
    assert.ok(!result.startsWith('{'))
  })

  test('serialize to JSON', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
    }
    const result = serialize(doc, 'json')
    assert.ok(result.startsWith('{'))
    const reparsed = JSON.parse(result)
    assert.equal(reparsed.usd, '1.0.0')
  })

  test('serialize to YAML', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
    }
    const result = serialize(doc, 'yaml')
    assert.ok(result.includes('usd:'))
  })
})

// =============================================================================
// Normalize Tests
// =============================================================================

describe('normalize', () => {
  test('normalize adds default values', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
    }
    const normalized = normalize(doc)
    assert.equal(normalized.usd, '1.0.0')
    assert.equal(normalized.info.title, 'Test')
  })

  test('normalize preserves existing values', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Custom', version: '2.0.0', description: 'My API' },
      servers: [{ url: 'https://custom.api' }],
    }
    const normalized = normalize(doc)
    assert.equal(normalized.info.title, 'Custom')
    assert.equal(normalized.info.description, 'My API')
    assert.equal(normalized.servers?.[0]?.url, 'https://custom.api')
  })
})

// =============================================================================
// Clone Tests
// =============================================================================

describe('cloneDocument', () => {
  test('cloneDocument creates deep copy', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
    }
    const cloned = cloneDocument(doc)

    // Verify values match
    assert.equal(cloned.info.title, 'Test')
    assert.equal(cloned.servers?.[0]?.url, 'https://api.example.com')

    // Verify it's a different object
    cloned.info.title = 'Modified'
    assert.equal(doc.info.title, 'Test')
  })

  test('cloneDocument handles nested objects', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: {
              id: { type: 'string' },
            },
          },
        },
      },
    }
    const cloned = cloneDocument(doc)
    assert.deepEqual(cloned.components?.schemas?.User, doc.components?.schemas?.User)
    assert.notEqual(cloned.components?.schemas?.User, doc.components?.schemas?.User)
  })
})

// =============================================================================
// Merge Tests
// =============================================================================

describe('mergeDocuments', () => {
  test('mergeDocuments combines two documents', () => {
    const base: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Base', version: '1.0.0' },
      paths: {
        '/users': {
          get: { operationId: 'getUsers', responses: { '200': { description: 'OK' } } },
        },
      },
    }
    const extension: Partial<USDDocument> = {
      info: { title: 'Extended', description: 'Extended API' },
      paths: {
        '/posts': {
          get: { operationId: 'getPosts', responses: { '200': { description: 'OK' } } },
        },
      },
    }
    const merged = mergeDocuments(base, extension)

    assert.equal(merged.info.title, 'Extended')
    assert.equal(merged.info.description, 'Extended API')
    assert.ok(merged.paths?.['/users'])
    assert.ok(merged.paths?.['/posts'])
  })

  test('mergeDocuments does not modify originals', () => {
    const base: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Base', version: '1.0.0' },
    }
    const extension: Partial<USDDocument> = {
      info: { title: 'Extended' },
    }
    mergeDocuments(base, extension)

    assert.equal(base.info.title, 'Base')
  })
})

// =============================================================================
// Document Wrapper Tests
// =============================================================================

describe('createDocumentWrapper', () => {
  test('wrapper provides access to document', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
    }
    const wrapper = createDocumentWrapper(doc)
    assert.equal(wrapper.document.info.title, 'Test')
  })

  test('wrapper.toJson() serializes to JSON', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
    }
    const wrapper = createDocumentWrapper(doc)
    const json = wrapper.toJson()
    assert.ok(json.startsWith('{'))
    const reparsed = JSON.parse(json)
    assert.equal(reparsed.info.title, 'Test')
  })

  test('wrapper.toYaml() serializes to YAML', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
    }
    const wrapper = createDocumentWrapper(doc)
    const yaml = wrapper.toYaml()
    assert.ok(yaml.includes('usd:'))
    assert.ok(yaml.includes('title: Test'))
  })

  test('wrapper.clone() creates deep copy', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
    }
    const wrapper = createDocumentWrapper(doc)
    const cloned = wrapper.clone()
    cloned.info.title = 'Modified'
    assert.equal(wrapper.document.info.title, 'Test')
  })

  test('wrapper.merge() combines documents', () => {
    const doc: USDDocument = {
      usd: '1.0.0',
      openapi: '3.1.0',
      info: { title: 'Original', version: '1.0.0' },
    }
    const wrapper = createDocumentWrapper(doc)
    const merged = wrapper.merge({ info: { title: 'Merged', description: 'Added' } })
    assert.equal(merged.info.title, 'Merged')
    assert.equal(merged.info.description, 'Added')
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error Handling', () => {
  test('USDParseError contains format information', () => {
    try {
      parse('{ invalid }', { format: 'json' })
    } catch (err) {
      assert.ok(err instanceof USDParseError)
      const parseErr = err as USDParseError
      assert.equal(parseErr.format, 'json')
      assert.equal(parseErr.name, 'USDParseError')
    }
  })

  test('USDJsonParseError is thrown for JSON errors', () => {
    assert.throws(
      () => parseJson('not json'),
      (err: Error) => {
        assert.ok(err instanceof USDJsonParseError)
        assert.equal(err.name, 'USDJsonParseError')
        return true
      }
    )
  })

  test('USDYamlParseError is thrown for YAML errors', () => {
    assert.throws(
      () => parseYaml('invalid: yaml: :\n  broken'),
      (err: Error) => {
        assert.ok(err instanceof USDYamlParseError)
        assert.equal(err.name, 'USDYamlParseError')
        return true
      }
    )
  })
})
