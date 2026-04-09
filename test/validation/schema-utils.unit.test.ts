import { describe, it, expect } from 'vitest'
import { cleanJsonSchema } from '../../src/validation/schema-utils.js'

describe('Schema Utils', () => {
  describe('cleanJsonSchema()', () => {
    it('strips $schema key from top level', () => {
      const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {},
      }
      const result = cleanJsonSchema(schema)
      expect(result).not.toHaveProperty('$schema')
      expect(result).toEqual({
        type: 'object',
        properties: {},
      })
    })

    it('recursively strips $schema from nested objects', () => {
      const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          name: {
            $schema: 'should-be-stripped',
            type: 'string',
          },
        },
      }
      const result = cleanJsonSchema(schema)
      expect(result).not.toHaveProperty('$schema')
      const props = result.properties as Record<string, unknown>
      const name = props.name as Record<string, unknown>
      expect(name).not.toHaveProperty('$schema')
      expect(name.type).toBe('string')
    })

    it('recursively cleans deeply nested objects', () => {
      const schema = {
        $schema: 'top',
        level1: {
          $schema: 'l1',
          level2: {
            $schema: 'l2',
            level3: {
              $schema: 'l3',
              type: 'string',
            },
          },
        },
      }
      const result = cleanJsonSchema(schema)
      expect(result).not.toHaveProperty('$schema')
      const l1 = result.level1 as Record<string, unknown>
      expect(l1).not.toHaveProperty('$schema')
      const l2 = l1.level2 as Record<string, unknown>
      expect(l2).not.toHaveProperty('$schema')
      const l3 = l2.level3 as Record<string, unknown>
      expect(l3).not.toHaveProperty('$schema')
      expect(l3.type).toBe('string')
    })

    it('handles arrays with object entries', () => {
      const schema = {
        anyOf: [
          { $schema: 'strip-me', type: 'string' },
          { $schema: 'strip-me-too', type: 'number' },
        ],
      }
      const result = cleanJsonSchema(schema)
      const anyOf = result.anyOf as Array<Record<string, unknown>>
      expect(anyOf).toHaveLength(2)
      expect(anyOf[0]).not.toHaveProperty('$schema')
      expect(anyOf[0]!.type).toBe('string')
      expect(anyOf[1]).not.toHaveProperty('$schema')
      expect(anyOf[1]!.type).toBe('number')
    })

    it('handles arrays with mixed types (objects and primitives)', () => {
      const schema = {
        examples: [
          'a string',
          42,
          null,
          { $schema: 'strip', value: true },
          true,
        ],
      }
      const result = cleanJsonSchema(schema)
      const examples = result.examples as unknown[]
      expect(examples).toHaveLength(5)
      expect(examples[0]).toBe('a string')
      expect(examples[1]).toBe(42)
      expect(examples[2]).toBeNull()
      expect(examples[3]).toEqual({ value: true })
      expect(examples[4]).toBe(true)
    })

    it('handles arrays within arrays (nested arrays preserved, not recursed into)', () => {
      const schema = {
        items: [
          [1, 2, 3],
          { $schema: 'strip', type: 'object' },
        ],
      }
      const result = cleanJsonSchema(schema)
      const items = result.items as unknown[]
      // Inner array is not an object, so it's preserved as-is
      expect(items[0]).toEqual([1, 2, 3])
      // Object entry gets cleaned
      expect(items[1]).toEqual({ type: 'object' })
    })

    it('preserves normal keys', () => {
      const schema = {
        type: 'object',
        title: 'Test Schema',
        description: 'A test',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          age: { type: 'number', minimum: 0 },
        },
        additionalProperties: false,
      }
      const result = cleanJsonSchema(schema)
      expect(result).toEqual(schema) // No $schema to strip, should be identical
    })

    it('preserves primitive values', () => {
      const schema = {
        type: 'string',
        minLength: 1,
        maxLength: 255,
        pattern: '^[a-z]+$',
        default: 'hello',
        const: 42,
        enum: ['a', 'b', 'c'],
      }
      const result = cleanJsonSchema(schema)
      expect(result.type).toBe('string')
      expect(result.minLength).toBe(1)
      expect(result.maxLength).toBe(255)
      expect(result.pattern).toBe('^[a-z]+$')
      expect(result.default).toBe('hello')
      expect(result.const).toBe(42)
      expect(result.enum).toEqual(['a', 'b', 'c'])
    })

    it('returns a new object (does not mutate input)', () => {
      const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
      }
      const result = cleanJsonSchema(schema)
      expect(result).not.toBe(schema)
      expect(schema).toHaveProperty('$schema')
    })

    it('handles empty object', () => {
      expect(cleanJsonSchema({})).toEqual({})
    })

    it('handles object with only $schema', () => {
      expect(cleanJsonSchema({ $schema: 'http://example.com' })).toEqual({})
    })

    it('handles typical JSON Schema with definitions/$defs', () => {
      const schema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          address: { $ref: '#/$defs/Address' },
        },
        $defs: {
          Address: {
            $schema: 'should-strip',
            type: 'object',
            properties: {
              street: { type: 'string' },
              city: { type: 'string' },
            },
          },
        },
      }
      const result = cleanJsonSchema(schema)
      expect(result).not.toHaveProperty('$schema')
      const defs = result.$defs as Record<string, Record<string, unknown>>
      expect(defs.Address).not.toHaveProperty('$schema')
      expect(defs.Address.type).toBe('object')
      // $ref preserved
      const props = result.properties as Record<string, Record<string, unknown>>
      expect(props.address.$ref).toBe('#/$defs/Address')
    })

    it('preserves boolean values in schema', () => {
      const schema = {
        additionalProperties: false,
        readOnly: true,
        writeOnly: false,
      }
      const result = cleanJsonSchema(schema)
      expect(result.additionalProperties).toBe(false)
      expect(result.readOnly).toBe(true)
      expect(result.writeOnly).toBe(false)
    })
  })
})
