/**
 * Tests for Schema Converter
 *
 * Tests Zod to JSON Schema conversion and schema utilities.
 *
 * NOTE: zod-to-json-schema v3.x doesn't fully support Zod v4, so direct
 * Zod conversion falls back to { type: 'object' }. Tests that need proper
 * Zod conversion must register a validator.
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import {
  createSchemaRegistry,
  isZodSchema,
  isJsonSchema,
  convertSchema,
  convertAndRegister,
  extractParameters,
  generateSchemaName,
  createRef,
  createArraySchema,
  createPaginatedSchema,
  createErrorSchema,
  type ConvertedSchemaRegistry,
  type ExtractedParameters,
  type SchemaConversionOptions,
} from '../../../src/docs/generators/schema-converter.js'
import {
  createZodAdapter,
  registerValidator,
  resetValidation,
} from '../../../src/validation/index.js'
import type { USDSchema } from '../../../src/usd/index.js'

describe('Schema Converter', () => {
  describe('isZodSchema', () => {
    it('should return true for Zod string schema', () => {
      const schema = z.string()
      assert.equal(isZodSchema(schema), true)
    })

    it('should return true for Zod object schema', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })
      assert.equal(isZodSchema(schema), true)
    })

    it('should return true for Zod array schema', () => {
      const schema = z.array(z.string())
      assert.equal(isZodSchema(schema), true)
    })

    it('should return true for Zod optional schema', () => {
      const schema = z.string().optional()
      assert.equal(isZodSchema(schema), true)
    })

    it('should return true for Zod nullable schema', () => {
      const schema = z.string().nullable()
      assert.equal(isZodSchema(schema), true)
    })

    it('should return true for Zod enum schema', () => {
      const schema = z.enum(['a', 'b', 'c'])
      assert.equal(isZodSchema(schema), true)
    })

    it('should return true for Zod union schema', () => {
      const schema = z.union([z.string(), z.number()])
      assert.equal(isZodSchema(schema), true)
    })

    it('should return false for plain object', () => {
      assert.equal(isZodSchema({ type: 'string' }), false)
    })

    it('should return false for null', () => {
      assert.equal(isZodSchema(null), false)
    })

    it('should return false for undefined', () => {
      assert.equal(isZodSchema(undefined), false)
    })

    it('should return false for string', () => {
      assert.equal(isZodSchema('hello'), false)
    })

    it('should return false for number', () => {
      assert.equal(isZodSchema(123), false)
    })

    it('should return false for array', () => {
      assert.equal(isZodSchema([1, 2, 3]), false)
    })
  })

  describe('isJsonSchema', () => {
    it('should return true for schema with type property', () => {
      assert.equal(isJsonSchema({ type: 'string' }), true)
      assert.equal(isJsonSchema({ type: 'number' }), true)
      assert.equal(isJsonSchema({ type: 'object' }), true)
      assert.equal(isJsonSchema({ type: 'array' }), true)
    })

    it('should return true for schema with $ref property', () => {
      assert.equal(isJsonSchema({ $ref: '#/components/schemas/User' }), true)
    })

    it('should return true for schema with anyOf property', () => {
      assert.equal(isJsonSchema({ anyOf: [{ type: 'string' }, { type: 'number' }] }), true)
    })

    it('should return true for schema with oneOf property', () => {
      assert.equal(isJsonSchema({ oneOf: [{ type: 'string' }, { type: 'number' }] }), true)
    })

    it('should return true for schema with allOf property', () => {
      assert.equal(isJsonSchema({ allOf: [{ type: 'string' }, { minLength: 1 }] }), true)
    })

    it('should return true for schema with properties property', () => {
      assert.equal(isJsonSchema({ properties: { name: { type: 'string' } } }), true)
    })

    it('should return true for schema with items property', () => {
      assert.equal(isJsonSchema({ items: { type: 'string' } }), true)
    })

    it('should return false for null', () => {
      assert.equal(isJsonSchema(null), false)
    })

    it('should return false for undefined', () => {
      assert.equal(isJsonSchema(undefined), false)
    })

    it('should return false for string', () => {
      assert.equal(isJsonSchema('hello'), false)
    })

    it('should return false for number', () => {
      assert.equal(isJsonSchema(123), false)
    })

    it('should return false for empty object', () => {
      assert.equal(isJsonSchema({}), false)
    })

    it('should return false for object without schema keywords', () => {
      assert.equal(isJsonSchema({ foo: 'bar' }), false)
    })
  })

  describe('convertSchema', () => {
    describe('with JSON Schema input', () => {
      it('should pass through valid JSON Schema', () => {
        const schema = { type: 'string', minLength: 1 }
        const result = convertSchema(schema)
        assert.deepEqual(result, schema)
      })

      it('should pass through $ref schemas', () => {
        const schema = { $ref: '#/components/schemas/User' }
        const result = convertSchema(schema)
        assert.deepEqual(result, schema)
      })

      it('should pass through complex JSON Schema', () => {
        const schema = {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'integer' },
          },
          required: ['name'],
        }
        const result = convertSchema(schema)
        assert.deepEqual(result, schema)
      })

      it('should remove $schema property', () => {
        const schema = {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'string',
        }
        const result = convertSchema(schema)
        assert.ok(!('$schema' in result))
        assert.equal(result.type, 'string')
      })

      it('should clean nested $schema properties', () => {
        const schema = {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          properties: {
            nested: {
              $schema: 'http://json-schema.org/draft-07/schema#',
              type: 'string',
            },
          },
        }
        const result = convertSchema(schema)
        assert.ok(!('$schema' in result))
        const nested = result.properties?.nested as USDSchema
        assert.ok(!('$schema' in nested))
      })

      it('should handle anyOf schema', () => {
        const schema = {
          anyOf: [{ type: 'string' }, { type: 'number' }],
        }
        const result = convertSchema(schema)
        assert.deepEqual(result, schema)
      })

      it('should handle oneOf schema', () => {
        const schema = {
          oneOf: [{ type: 'string' }, { type: 'number' }],
        }
        const result = convertSchema(schema)
        assert.deepEqual(result, schema)
      })

      it('should handle allOf schema', () => {
        const schema = {
          allOf: [{ type: 'object' }, { properties: { name: { type: 'string' } } }],
        }
        const result = convertSchema(schema)
        assert.deepEqual(result, schema)
      })

      it('should handle items schema', () => {
        const schema = {
          type: 'array',
          items: { type: 'string' },
        }
        const result = convertSchema(schema)
        assert.deepEqual(result, schema)
      })

      it('should recursively clean nested arrays', () => {
        const schema = {
          type: 'array',
          items: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          },
        }
        const result = convertSchema(schema)
        const items = result.items as USDSchema
        assert.ok(!('$schema' in items))
      })
    })

    describe('with null or undefined', () => {
      it('should return object type for null', () => {
        const result = convertSchema(null)
        assert.deepEqual(result, { type: 'object' })
      })

      it('should return object type for undefined', () => {
        const result = convertSchema(undefined)
        assert.deepEqual(result, { type: 'object' })
      })
    })

    describe('with Zod v4 schemas (no validator, but passes isJsonSchema)', () => {
      // Zod v4 schemas have a .type property, so they pass isJsonSchema check
      // They get cleaned but retain their internal structure
      it('should pass through Zod string schema as JSON Schema', () => {
        const result = convertSchema(z.string())
        // Zod v4 schemas have .type at top level, so they pass isJsonSchema
        assert.equal(result.type, 'string')
      })

      it('should pass through Zod array schema as JSON Schema', () => {
        const result = convertSchema(z.array(z.string()))
        // Zod v4 arrays have .type at top level
        assert.equal(result.type, 'array')
      })

      it('should pass through Zod object schema as JSON Schema', () => {
        const result = convertSchema(z.object({ name: z.string() }))
        assert.equal(result.type, 'object')
      })
    })

    describe('with unsupported types (no validator registered)', () => {
      // Non-JSON-Schema objects that also don't pass isJsonSchema trigger getValidator()
      it('should throw error for non-schema object without validator', () => {
        assert.throws(
          () => convertSchema({ foo: 'bar' }),
          { message: /No validator registered/ }
        )
      })

      it('should throw error for primitive types without validator', () => {
        assert.throws(() => convertSchema('hello'), { message: /No validator registered/ })
        assert.throws(() => convertSchema(123), { message: /No validator registered/ })
      })
    })

    describe('with registered validator', () => {
      // Note: Zod v4 schemas have a .type property, so they pass isJsonSchema()
      // and bypass the validator. The validator is only called for inputs that
      // don't pass isJsonSchema().

      // Custom validator that handles plain objects with special structure
      const mockValidator = {
        name: 'mock' as const,
        isValidSchema: (schema: unknown): boolean => {
          if (!schema || typeof schema !== 'object') return false
          // Accept objects with __mock__ marker
          return '__mock__' in (schema as Record<string, unknown>)
        },
        validate: () => ({ success: true, data: {} }),
        toJsonSchema: (schema: unknown): Record<string, unknown> => {
          const s = schema as { __mock__: string }
          return { type: s.__mock__, converted: true }
        },
      }

      beforeEach(() => {
        // Register the mock validator
        registerValidator(mockValidator as any)
      })

      afterEach(() => {
        resetValidation()
      })

      it('should use validator for schemas that match validator but not isJsonSchema', () => {
        // This schema has __mock__ but no JSON Schema keywords, so:
        // 1. isJsonSchema returns false
        // 2. validator.isValidSchema returns true
        // 3. validator.toJsonSchema is called
        const schema = { __mock__: 'string' }
        const result = convertSchema(schema)
        assert.equal(result.type, 'string')
        assert.equal(result.converted, true)
      })

      it('should return fallback for non-matching schemas', () => {
        // This schema doesn't match validator and doesn't pass isJsonSchema
        const schema = { unknown: 'value' }
        const result = convertSchema(schema)
        // Falls back to { type: 'object' }
        assert.deepEqual(result, { type: 'object' })
      })

      it('should still pass through JSON Schema first', () => {
        // JSON Schema is checked before validator
        const schema = { type: 'integer', minimum: 0 }
        const result = convertSchema(schema)
        assert.deepEqual(result, schema)
      })

      it('should pass through Zod schemas as JSON Schema', () => {
        // Zod v4 schemas have .type, so they pass isJsonSchema
        const schema = z.string()
        const result = convertSchema(schema)
        assert.equal(result.type, 'string')
      })
    })
  })

  describe('createSchemaRegistry', () => {
    it('should create empty registry', () => {
      const registry = createSchemaRegistry()
      assert.ok(registry.schemas instanceof Map)
      assert.equal(registry.schemas.size, 0)
    })

    it('should add JSON schema to registry', () => {
      const registry = createSchemaRegistry()
      const schema = { type: 'object', properties: { name: { type: 'string' } } }
      const result = registry.add('User', schema)

      assert.equal(registry.schemas.size, 1)
      assert.ok(registry.schemas.has('User'))
      assert.equal(result.type, 'object')
    })

    it('should add multiple schemas', () => {
      const registry = createSchemaRegistry()
      registry.add('User', { type: 'object', properties: { name: { type: 'string' } } })
      registry.add('Post', { type: 'object', properties: { title: { type: 'string' } } })

      assert.equal(registry.schemas.size, 2)
      assert.ok(registry.schemas.has('User'))
      assert.ok(registry.schemas.has('Post'))
    })

    it('should create $ref for named schema', () => {
      const registry = createSchemaRegistry()
      const ref = registry.ref('User')

      assert.deepEqual(ref, { $ref: '#/components/schemas/User' })
    })

    it('should convert to object', () => {
      const registry = createSchemaRegistry()
      registry.add('User', { type: 'object', properties: { name: { type: 'string' } } })
      registry.add('Post', { type: 'object', properties: { title: { type: 'string' } } })

      const obj = registry.toObject()
      assert.ok('User' in obj)
      assert.ok('Post' in obj)
      assert.equal(obj.User.type, 'object')
      assert.equal(obj.Post.type, 'object')
    })

    it('should return empty object when empty', () => {
      const registry = createSchemaRegistry()
      const obj = registry.toObject()
      assert.deepEqual(obj, {})
    })

    it('should overwrite schema with same name', () => {
      const registry = createSchemaRegistry()
      registry.add('User', { type: 'object', properties: { name: { type: 'string' } } })
      registry.add('User', { type: 'object', properties: { email: { type: 'string' } } })

      assert.equal(registry.schemas.size, 1)
      const user = registry.schemas.get('User')
      assert.ok(user?.properties?.email)
      assert.ok(!user?.properties?.name)
    })
  })

  describe('convertAndRegister', () => {
    it('should convert and add schema to registry', () => {
      const registry = createSchemaRegistry()
      const schema = { type: 'object', properties: { name: { type: 'string' } } }

      const result = convertAndRegister(registry, 'User', schema)

      assert.equal(result.type, 'object')
      assert.ok(registry.schemas.has('User'))
    })

    it('should return the converted schema', () => {
      const registry = createSchemaRegistry()
      const schema = { type: 'string', format: 'email' }

      const result = convertAndRegister(registry, 'Email', schema)

      assert.equal(result.type, 'string')
      assert.equal(result.format, 'email')
    })
  })

  describe('extractParameters', () => {
    it('should extract path parameters from template using JSON Schema', () => {
      const schema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
      }
      const result = extractParameters(schema, '/users/{id}')

      assert.equal(result.path.length, 1)
      assert.equal(result.path[0].name, 'id')
      assert.equal(result.path[0].required, true)
    })

    it('should extract multiple path parameters', () => {
      const schema = {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          postId: { type: 'string' },
        },
      }
      const result = extractParameters(schema, '/users/{userId}/posts/{postId}')

      assert.equal(result.path.length, 2)
      assert.ok(result.path.some((p) => p.name === 'userId'))
      assert.ok(result.path.some((p) => p.name === 'postId'))
    })

    it('should extract query parameters', () => {
      const schema = {
        type: 'object',
        properties: {
          page: { type: 'number' },
          limit: { type: 'number' },
        },
      }
      const result = extractParameters(schema, '/users')

      assert.equal(result.query.length, 2)
      assert.ok(result.query.some((p) => p.name === 'page'))
      assert.ok(result.query.some((p) => p.name === 'limit'))
    })

    it('should extract header parameters by naming convention', () => {
      const schema = {
        type: 'object',
        properties: {
          header_authorization: { type: 'string' },
          h_accept: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['header_authorization'],
      }
      const result = extractParameters(schema, '/users')

      assert.equal(result.header.length, 2)
      assert.ok(result.header.some((p) => p.name === 'authorization'))
      assert.ok(result.header.some((p) => p.name === 'accept'))
      assert.equal(result.query.length, 1)
    })

    it('should mark query parameters as required based on schema', () => {
      const schema = {
        type: 'object',
        properties: {
          required: { type: 'string' },
          optional: { type: 'string' },
        },
        required: ['required'],
      }
      const result = extractParameters(schema, '/users')

      const requiredParam = result.query.find((p) => p.name === 'required')
      const optionalParam = result.query.find((p) => p.name === 'optional')

      assert.equal(requiredParam?.required, true)
      assert.equal(optionalParam?.required, false)
    })

    it('should preserve descriptions', () => {
      const schema = {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'User ID' },
        },
      }
      const result = extractParameters(schema, '/users/{id}')

      assert.equal(result.path[0].description, 'User ID')
    })

    it('should handle non-object schema as body', () => {
      const schema = { type: 'array', items: { type: 'string' } }
      const result = extractParameters(schema, '/users')

      assert.equal(result.path.length, 0)
      assert.equal(result.query.length, 0)
      assert.ok(result.body)
      assert.equal(result.body.type, 'array')
    })

    it('should return empty result for null schema', () => {
      const result = extractParameters(null, '/users')

      assert.deepEqual(result, {
        path: [],
        query: [],
        header: [],
      })
    })

    it('should return empty result for undefined schema', () => {
      const result = extractParameters(undefined, '/users/{id}')

      assert.deepEqual(result, {
        path: [],
        query: [],
        header: [],
      })
    })

    it('should handle path without parameters', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      }
      const result = extractParameters(schema, '/users')

      assert.equal(result.path.length, 0)
      assert.equal(result.query.length, 1)
    })

    it('should handle complex mixed parameters', () => {
      const schema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          header_authorization: { type: 'string' },
          page: { type: 'number' },
          limit: { type: 'number' },
          sort: { type: 'string', enum: ['asc', 'desc'] },
        },
        required: ['id', 'header_authorization'],
      }
      const result = extractParameters(schema, '/users/{id}')

      assert.equal(result.path.length, 1)
      assert.equal(result.header.length, 1)
      assert.equal(result.query.length, 3)
    })

    it('should set path params always required', () => {
      const schema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        // id not in required array, but path params are always required
      }
      const result = extractParameters(schema, '/users/{id}')

      assert.equal(result.path[0].required, true)
    })
  })

  describe('generateSchemaName', () => {
    it('should generate Input suffix', () => {
      const name = generateSchemaName('users.get', 'Input')
      assert.equal(name, 'UsersGetInput')
    })

    it('should generate Output suffix', () => {
      const name = generateSchemaName('users.list', 'Output')
      assert.equal(name, 'UsersListOutput')
    })

    it('should handle single part name', () => {
      const name = generateSchemaName('health', 'Output')
      assert.equal(name, 'HealthOutput')
    })

    it('should handle multiple parts', () => {
      const name = generateSchemaName('users.posts.comments.create', 'Input')
      assert.equal(name, 'UsersPostsCommentsCreateInput')
    })

    it('should capitalize first letter of each part', () => {
      const name = generateSchemaName('myApp.getUsers', 'Output')
      assert.equal(name, 'MyAppGetUsersOutput')
    })

    it('should handle empty string', () => {
      const name = generateSchemaName('', 'Input')
      assert.equal(name, 'Input')
    })

    it('should handle single character parts', () => {
      const name = generateSchemaName('a.b.c', 'Output')
      assert.equal(name, 'ABCOutput')
    })
  })

  describe('createRef', () => {
    it('should create $ref to component schema', () => {
      const ref = createRef('User')
      assert.deepEqual(ref, { $ref: '#/components/schemas/User' })
    })

    it('should handle schema names with special characters', () => {
      const ref = createRef('UserResponse_V2')
      assert.deepEqual(ref, { $ref: '#/components/schemas/UserResponse_V2' })
    })

    it('should handle lowercase names', () => {
      const ref = createRef('user')
      assert.deepEqual(ref, { $ref: '#/components/schemas/user' })
    })
  })

  describe('createArraySchema', () => {
    it('should create array schema with item type', () => {
      const schema = createArraySchema({ type: 'string' })
      assert.deepEqual(schema, {
        type: 'array',
        items: { type: 'string' },
      })
    })

    it('should create array with object items', () => {
      const schema = createArraySchema({
        type: 'object',
        properties: { name: { type: 'string' } },
      })
      assert.equal(schema.type, 'array')
      assert.deepEqual(schema.items, {
        type: 'object',
        properties: { name: { type: 'string' } },
      })
    })

    it('should create array with $ref items', () => {
      const schema = createArraySchema({ $ref: '#/components/schemas/User' })
      assert.deepEqual(schema, {
        type: 'array',
        items: { $ref: '#/components/schemas/User' },
      })
    })

    it('should create array with integer items', () => {
      const schema = createArraySchema({ type: 'integer' })
      assert.deepEqual(schema, {
        type: 'array',
        items: { type: 'integer' },
      })
    })
  })

  describe('createPaginatedSchema', () => {
    it('should create paginated response schema', () => {
      const schema = createPaginatedSchema({ type: 'string' })

      assert.equal(schema.type, 'object')
      assert.ok(schema.properties)
      assert.ok(schema.properties.data)
      assert.ok(schema.properties.total)
      assert.ok(schema.properties.page)
      assert.ok(schema.properties.limit)
      assert.ok(schema.properties.pages)
    })

    it('should have data as array of items', () => {
      const itemSchema = { type: 'object', properties: { id: { type: 'string' } } }
      const schema = createPaginatedSchema(itemSchema)

      const data = schema.properties?.data as USDSchema
      assert.equal(data.type, 'array')
      assert.deepEqual(data.items, itemSchema)
    })

    it('should have correct required fields', () => {
      const schema = createPaginatedSchema({ type: 'string' })
      assert.deepEqual(schema.required, ['data', 'total'])
    })

    it('should have descriptions for pagination fields', () => {
      const schema = createPaginatedSchema({ type: 'string' })

      const total = schema.properties?.total as USDSchema
      const page = schema.properties?.page as USDSchema
      const limit = schema.properties?.limit as USDSchema
      const pages = schema.properties?.pages as USDSchema

      assert.ok(total.description)
      assert.ok(page.description)
      assert.ok(limit.description)
      assert.ok(pages.description)
    })

    it('should work with $ref item schema', () => {
      const schema = createPaginatedSchema({ $ref: '#/components/schemas/User' })

      const data = schema.properties?.data as USDSchema
      assert.deepEqual(data.items, { $ref: '#/components/schemas/User' })
    })

    it('should have integer type for pagination numbers', () => {
      const schema = createPaginatedSchema({ type: 'string' })

      assert.equal((schema.properties?.total as USDSchema).type, 'integer')
      assert.equal((schema.properties?.page as USDSchema).type, 'integer')
      assert.equal((schema.properties?.limit as USDSchema).type, 'integer')
      assert.equal((schema.properties?.pages as USDSchema).type, 'integer')
    })
  })

  describe('createErrorSchema', () => {
    it('should create standard error schema', () => {
      const schema = createErrorSchema()

      assert.equal(schema.type, 'object')
      assert.deepEqual(schema.required, ['code', 'message'])
    })

    it('should have all error properties', () => {
      const schema = createErrorSchema()

      assert.ok(schema.properties?.code)
      assert.ok(schema.properties?.message)
      assert.ok(schema.properties?.status)
      assert.ok(schema.properties?.details)
      assert.ok(schema.properties?.requestId)
    })

    it('should have correct property types', () => {
      const schema = createErrorSchema()

      assert.equal((schema.properties?.code as USDSchema).type, 'string')
      assert.equal((schema.properties?.message as USDSchema).type, 'string')
      assert.equal((schema.properties?.status as USDSchema).type, 'integer')
      assert.equal((schema.properties?.details as USDSchema).type, 'object')
      assert.equal((schema.properties?.requestId as USDSchema).type, 'string')
    })

    it('should have descriptions for all properties', () => {
      const schema = createErrorSchema()

      for (const [, prop] of Object.entries(schema.properties ?? {})) {
        const propSchema = prop as USDSchema
        assert.ok(propSchema.description, `Property should have description`)
      }
    })

    it('should allow additional properties in details', () => {
      const schema = createErrorSchema()
      const details = schema.properties?.details as USDSchema
      assert.equal(details.additionalProperties, true)
    })
  })

  describe('complex scenarios', () => {
    it('should handle deeply nested JSON Schema', () => {
      const schema = {
        type: 'object',
        properties: {
          level1: {
            type: 'object',
            properties: {
              level2: {
                type: 'object',
                properties: {
                  level3: {
                    type: 'object',
                    properties: {
                      value: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      }

      const result = convertSchema(schema)
      assert.equal(result.type, 'object')

      const level1 = result.properties?.level1 as USDSchema
      assert.equal(level1.type, 'object')

      const level2 = level1.properties?.level2 as USDSchema
      assert.equal(level2.type, 'object')

      const level3 = level2.properties?.level3 as USDSchema
      assert.equal(level3.type, 'object')
      assert.ok(level3.properties?.value)
    })

    it('should handle tree structures with refs', () => {
      const registry = createSchemaRegistry()

      // Add Node schema
      registry.add('Node', {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      })

      // Create tree schema referencing Node
      const treeSchema = {
        type: 'object',
        properties: {
          root: { $ref: '#/components/schemas/Node' },
          children: {
            type: 'array',
            items: { $ref: '#/components/schemas/Node' },
          },
        },
      }

      registry.add('Tree', treeSchema)

      const schemas = registry.toObject()
      assert.ok(schemas.Node)
      assert.ok(schemas.Tree)
    })

    it('should work with full workflow', () => {
      // Create registry
      const registry = createSchemaRegistry()

      // Define schemas (JSON Schema format)
      const userSchema = {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1, maxLength: 100 },
          createdAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'email', 'name'],
      }

      const createUserSchema = {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          name: { type: 'string', minLength: 1 },
          password: { type: 'string', minLength: 8 },
        },
        required: ['email', 'name', 'password'],
      }

      // Register schemas
      convertAndRegister(registry, 'User', userSchema)
      convertAndRegister(registry, 'CreateUserInput', createUserSchema)

      // Create refs
      const userRef = registry.ref('User')
      const createUserRef = registry.ref('CreateUserInput')

      // Create array and paginated schemas
      const usersArray = createArraySchema(userRef)
      const usersPaginated = createPaginatedSchema(userRef)

      // Get all schemas
      const schemas = registry.toObject()

      assert.ok(schemas.User)
      assert.ok(schemas.CreateUserInput)
      assert.deepEqual(userRef, { $ref: '#/components/schemas/User' })
      assert.deepEqual(createUserRef, { $ref: '#/components/schemas/CreateUserInput' })
      assert.equal(usersArray.type, 'array')
      assert.equal(usersPaginated.type, 'object')
    })

    it('should extract complex parameters', () => {
      const schema = {
        type: 'object',
        properties: {
          // Path params
          organizationId: { type: 'string', description: 'Organization ID' },
          projectId: { type: 'string', description: 'Project ID' },
          // Header params
          header_authorization: { type: 'string', description: 'Bearer token' },
          h_x_request_id: { type: 'string', description: 'Request ID' },
          // Query params
          page: { type: 'integer', description: 'Page number' },
          limit: { type: 'integer', description: 'Items per page' },
          search: { type: 'string', description: 'Search query' },
          status: {
            type: 'string',
            enum: ['active', 'inactive', 'pending'],
            description: 'Filter by status',
          },
        },
        required: ['organizationId', 'projectId', 'header_authorization'],
      }

      const result = extractParameters(schema, '/orgs/{organizationId}/projects/{projectId}')

      assert.equal(result.path.length, 2)
      assert.equal(result.header.length, 2)
      assert.equal(result.query.length, 4)

      // Check path params
      const orgId = result.path.find((p) => p.name === 'organizationId')
      assert.ok(orgId)
      assert.equal(orgId.required, true) // Path params always required

      // Check header params
      const authHeader = result.header.find((p) => p.name === 'authorization')
      assert.ok(authHeader)
      assert.equal(authHeader.required, true)

      // Check query params
      const statusQuery = result.query.find((p) => p.name === 'status')
      assert.ok(statusQuery)
      assert.equal(statusQuery.required, false)
      assert.deepEqual(statusQuery.schema.enum, ['active', 'inactive', 'pending'])
    })
  })
})
