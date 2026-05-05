import { describe, it, expect } from 'vitest'
import ValidatorModule from 'fastest-validator'
import { createFastestValidatorAdapter } from '../../src/validation/index.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Validator = ((ValidatorModule as any).default ?? ValidatorModule) as new () => any
const fvAdapter = createFastestValidatorAdapter(new Validator())

describe('Multi-Validator JSON Schema Conversion', () => {
  it('should convert fastest-validator to JSON Schema', () => {
    const schema = {
      name: { type: 'string', min: 1, max: 100 },
      email: { type: 'email' },
      age: { type: 'number', min: 0 },
      tags: { type: 'array', items: { type: 'string' } },
      status: { type: 'enum', values: ['active', 'inactive'] },
    }

    const jsonSchema = fvAdapter.toJsonSchema!(schema)

    expect(jsonSchema.type).toBe('object')
    const props = (jsonSchema as { properties: Record<string, unknown> }).properties
    expect(props.name).toEqual({ type: 'string', minLength: 1, maxLength: 100, pattern: undefined, enum: undefined })
    expect(props.email).toEqual({ type: 'string', format: 'email' })
    expect((props.tags as { type: string }).type).toBe('array')
  })

  it('should handle special types in conversion', () => {
    const schema = {
      url: { type: 'url' },
      uuid: { type: 'uuid' },
      date: { type: 'date' },
    }

    const jsonSchema = fvAdapter.toJsonSchema!(schema)
    const props = (jsonSchema as { properties: Record<string, unknown> }).properties

    expect(props.url).toEqual({ type: 'string', format: 'uri' })
    expect(props.uuid).toEqual({ type: 'string', format: 'uuid' })
    expect(props.date).toEqual({ type: 'string', format: 'date-time' })
  })
})
