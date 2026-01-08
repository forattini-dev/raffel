/**
 * Multi-Validator Tests
 *
 * Tests for the multi-validator support (Zod, Yup, Joi, Ajv, fastest-validator)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import * as yup from 'yup'
import Joi from 'joi'
import AjvModule from 'ajv'
import ValidatorModule from 'fastest-validator'

// Handle CJS/ESM interop for Ajv and fastest-validator
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv = ((AjvModule as any).default ?? AjvModule) as new (options?: object) => any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Validator = ((ValidatorModule as any).default ?? ValidatorModule) as new () => any
import {
  configureValidation,
  getValidationConfig,
  getValidator,
  validate,
  registerValidator,
  resetValidation,
  hasValidator,
  listValidators,
  createValidationInterceptor,
  createSchemaRegistry,
  createSchemaValidationInterceptor,
  createZodAdapter,
  createYupAdapter,
  createJoiAdapter,
  createAjvAdapter,
  createFastestValidatorAdapter,
} from './index.js'
import type { ValidatorType, HandlerSchema } from './types.js'
import { createContext } from '../types/context.js'
import type { Envelope } from '../types/index.js'
import { RaffelError } from '../core/router.js'

// Create adapter instances for tests
const zodAdapter = createZodAdapter(z)
const yupAdapter = createYupAdapter(yup)
const joiAdapter = createJoiAdapter(Joi)
const ajvAdapter = createAjvAdapter(new Ajv({ allErrors: true }))
const fvAdapter = createFastestValidatorAdapter(new Validator())

describe('Multi-Validator Support', () => {
  beforeEach(() => {
    // Reset and register validators fresh for each test
    resetValidation()
    registerValidator(zodAdapter)
    registerValidator(fvAdapter)
  })

  describe('Validator Registration', () => {
    it('should register a validator', () => {
      resetValidation()
      expect(hasValidator('zod')).toBe(false)

      registerValidator(zodAdapter)

      expect(hasValidator('zod')).toBe(true)
    })

    it('should auto-set first registered validator as default', () => {
      resetValidation()
      expect(getValidationConfig().defaultValidator).toBeUndefined()

      registerValidator(zodAdapter)

      expect(getValidationConfig().defaultValidator).toBe('zod')
    })

    it('should list all registered validators', () => {
      resetValidation()
      registerValidator(zodAdapter)
      registerValidator(fvAdapter)
      registerValidator(yupAdapter)

      const validators = listValidators()

      expect(validators).toContain('zod')
      expect(validators).toContain('fastest-validator')
      expect(validators).toContain('yup')
    })

    it('should throw when getting unregistered validator', () => {
      resetValidation()
      expect(() => getValidator('zod')).toThrow()
    })
  })

  describe('configureValidation', () => {
    it('should set default validator', () => {
      configureValidation({ defaultValidator: 'fastest-validator' })
      const config = getValidationConfig()
      expect(config.defaultValidator).toBe('fastest-validator')
    })

    it('should default to first registered validator', () => {
      resetValidation()
      registerValidator(zodAdapter)
      const config = getValidationConfig()
      expect(config.defaultValidator).toBe('zod')
    })
  })

  describe('getValidator', () => {
    it('should return zod adapter', () => {
      const validator = getValidator('zod')
      expect(validator.name).toBe('zod')
    })

    it('should return fastest-validator adapter', () => {
      const validator = getValidator('fastest-validator')
      expect(validator.name).toBe('fastest-validator')
    })

    it('should use default when type not specified', () => {
      configureValidation({ defaultValidator: 'fastest-validator' })
      const validator = getValidator()
      expect(validator.name).toBe('fastest-validator')
    })

    it('should throw for unknown validator type', () => {
      expect(() => getValidator('unknown' as ValidatorType)).toThrow()
    })
  })

  describe('Zod Adapter', () => {
    it('should validate valid data', () => {
      const schema = z.object({ name: z.string(), age: z.number() })
      const result = zodAdapter.validate(schema, { name: 'John', age: 30 })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ name: 'John', age: 30 })
    })

    it('should return errors for invalid data', () => {
      const schema = z.object({ name: z.string().min(1), age: z.number().positive() })
      const result = zodAdapter.validate(schema, { name: '', age: -5 })

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBe(2)
    })

    it('should identify valid Zod schemas', () => {
      const zodSchema = z.object({ name: z.string() })
      const fvSchema = { name: { type: 'string' } }

      expect(zodAdapter.isValidSchema(zodSchema)).toBe(true)
      expect(zodAdapter.isValidSchema(fvSchema)).toBe(false)
    })

    it('should convert to JSON Schema', () => {
      const schema = z.object({ name: z.string(), age: z.number() })
      const jsonSchema = zodAdapter.toJsonSchema!(schema)

      expect(jsonSchema).toBeDefined()
      expect(typeof jsonSchema).toBe('object')
    })
  })

  describe('Yup Adapter', () => {
    beforeEach(() => {
      registerValidator(yupAdapter)
    })

    it('should validate valid data', () => {
      const schema = yup.object({ name: yup.string().required(), age: yup.number().required() })
      const result = yupAdapter.validate(schema, { name: 'John', age: 30 })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ name: 'John', age: 30 })
    })

    it('should return errors for invalid data', () => {
      const schema = yup.object({
        name: yup.string().min(1, 'Name is required').required(),
        age: yup.number().positive('Age must be positive').required(),
      })
      const result = yupAdapter.validate(schema, { name: '', age: -5 })

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })

    it('should identify valid Yup schemas', () => {
      const yupSchema = yup.object({ name: yup.string() })
      const fvSchema = { name: { type: 'string' } }

      expect(yupAdapter.isValidSchema(yupSchema)).toBe(true)
      expect(yupAdapter.isValidSchema(fvSchema)).toBe(false)
    })
  })

  describe('Joi Adapter', () => {
    beforeEach(() => {
      registerValidator(joiAdapter)
    })

    it('should validate valid data', () => {
      const schema = Joi.object({ name: Joi.string().required(), age: Joi.number().required() })
      const result = joiAdapter.validate(schema, { name: 'John', age: 30 })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ name: 'John', age: 30 })
    })

    it('should return errors for invalid data', () => {
      const schema = Joi.object({
        name: Joi.string().min(1).required(),
        age: Joi.number().positive().required(),
      })
      const result = joiAdapter.validate(schema, { name: '', age: -5 })

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })

    it('should identify valid Joi schemas', () => {
      const joiSchema = Joi.object({ name: Joi.string() })
      const fvSchema = { name: { type: 'string' } }

      expect(joiAdapter.isValidSchema(joiSchema)).toBe(true)
      expect(joiAdapter.isValidSchema(fvSchema)).toBe(false)
    })
  })

  describe('Ajv Adapter', () => {
    beforeEach(() => {
      registerValidator(ajvAdapter)
    })

    it('should validate valid data', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name', 'age'],
      }
      const result = ajvAdapter.validate(schema, { name: 'John', age: 30 })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ name: 'John', age: 30 })
    })

    it('should return errors for invalid data', () => {
      // JSON Schema Draft 7+ uses exclusiveMinimum as a number, not boolean
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          age: { type: 'number', exclusiveMinimum: 0 },
        },
        required: ['name', 'age'],
      }
      const result = ajvAdapter.validate(schema, { name: '', age: -5 })

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })

    it('should identify valid JSON schemas', () => {
      const jsonSchema = { type: 'object', properties: { name: { type: 'string' } } }
      // Plain objects that look like schemas but aren't JSON Schema
      const notJsonSchema = { name: 'John', age: 30 }

      expect(ajvAdapter.isValidSchema(jsonSchema)).toBe(true)
      expect(ajvAdapter.isValidSchema(notJsonSchema)).toBe(false)
    })

    it('should return schema as-is for toJsonSchema', () => {
      const schema = { type: 'object', properties: { name: { type: 'string' } } }
      const jsonSchema = ajvAdapter.toJsonSchema!(schema)

      expect(jsonSchema).toEqual(schema)
    })
  })

  describe('Fastest-Validator Adapter', () => {
    it('should validate valid data', () => {
      const schema = { name: { type: 'string' }, age: { type: 'number' } }
      const result = fvAdapter.validate(schema, { name: 'John', age: 30 })

      expect(result.success).toBe(true)
      expect(result.data).toEqual({ name: 'John', age: 30 })
    })

    it('should return errors for invalid data', () => {
      const schema = {
        name: { type: 'string', min: 1 },
        age: { type: 'number', positive: true },
      }
      const result = fvAdapter.validate(schema, { name: '', age: -5 })

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })

    it('should identify valid fastest-validator schemas', () => {
      const zodSchema = z.object({ name: z.string() })
      const fvSchema = { name: { type: 'string' } }

      expect(fvAdapter.isValidSchema(fvSchema)).toBe(true)
      expect(fvAdapter.isValidSchema(zodSchema)).toBe(false)
    })

    it('should support shorthand notation', () => {
      const schema = { name: 'string', age: 'number' }
      const result = fvAdapter.validate(schema, { name: 'John', age: 30 })

      expect(result.success).toBe(true)
    })

    it('should convert to JSON Schema', () => {
      const schema = { name: { type: 'string' }, age: { type: 'number' } }
      const jsonSchema = fvAdapter.toJsonSchema!(schema)

      expect(jsonSchema.type).toBe('object')
      expect((jsonSchema as { properties: Record<string, unknown> }).properties).toBeDefined()
    })
  })

  describe('validate function', () => {
    it('should validate with Zod when specified', () => {
      const schema = z.object({ name: z.string() })
      const result = validate(schema, { name: 'Test' }, 'zod')

      expect(result).toEqual({ name: 'Test' })
    })

    it('should validate with fastest-validator when specified', () => {
      const schema = { name: { type: 'string' } }
      const result = validate(schema, { name: 'Test' }, 'fastest-validator')

      expect(result).toEqual({ name: 'Test' })
    })

    it('should throw RaffelError on validation failure', () => {
      const schema = z.object({ name: z.string().min(1) })

      expect(() => validate(schema, { name: '' }, 'zod')).toThrow(RaffelError)
    })
  })

  describe('createValidationInterceptor with validator choice', () => {
    it('should use Zod by default', async () => {
      const schema: HandlerSchema = {
        input: z.object({ name: z.string().min(1) }),
      }

      const interceptor = createValidationInterceptor(schema)

      const envelope: Envelope = {
        id: 'test',
        procedure: 'test',
        type: 'request',
        payload: { name: '' },
        metadata: {},
        context: createContext('test-id'),
      }

      await expect(interceptor(envelope, envelope.context, async () => 'ok')).rejects.toThrow(
        'Input validation failed'
      )
    })

    it('should use fastest-validator when specified', async () => {
      const schema: HandlerSchema = {
        validator: 'fastest-validator',
        input: { name: { type: 'string', min: 1 } },
      }

      const interceptor = createValidationInterceptor(schema)

      const envelope: Envelope = {
        id: 'test',
        procedure: 'test',
        type: 'request',
        payload: { name: '' },
        metadata: {},
        context: createContext('test-id'),
      }

      await expect(interceptor(envelope, envelope.context, async () => 'ok')).rejects.toThrow(
        'Input validation failed'
      )
    })

    it('should validate output with chosen validator', async () => {
      const schema: HandlerSchema = {
        validator: 'fastest-validator',
        output: { result: { type: 'number' } },
      }

      const interceptor = createValidationInterceptor(schema)

      const envelope: Envelope = {
        id: 'test',
        procedure: 'test',
        type: 'request',
        payload: {},
        metadata: {},
        context: createContext('test-id'),
      }

      // Valid output
      const validResult = await interceptor(envelope, envelope.context, async () => ({ result: 42 }))
      expect(validResult).toEqual({ result: 42 })

      // Invalid output
      await expect(
        interceptor(envelope, envelope.context, async () => ({ result: 'not a number' }))
      ).rejects.toThrow('Output validation failed')
    })

    it('should use default validator from config', async () => {
      configureValidation({ defaultValidator: 'fastest-validator' })

      const schema: HandlerSchema = {
        // No validator specified - should use default
        input: { name: { type: 'string', min: 1 } },
      }

      const interceptor = createValidationInterceptor(schema)

      const envelope: Envelope = {
        id: 'test',
        procedure: 'test',
        type: 'request',
        payload: { name: 'Valid' },
        metadata: {},
        context: createContext('test-id'),
      }

      const result = await interceptor(envelope, envelope.context, async () => 'ok')
      expect(result).toBe('ok')
    })
  })

  describe('Schema Registry with mixed validators', () => {
    it('should support different validators per handler', async () => {
      const schemaRegistry = createSchemaRegistry()

      // Register Zod schema
      schemaRegistry.register('zodHandler', {
        validator: 'zod',
        input: z.object({ name: z.string().min(1) }),
      })

      // Register fastest-validator schema
      schemaRegistry.register('fvHandler', {
        validator: 'fastest-validator',
        input: { name: { type: 'string', min: 1 } },
      })

      const interceptor = createSchemaValidationInterceptor(schemaRegistry)

      // Test Zod handler
      const zodEnvelope: Envelope = {
        id: 'test',
        procedure: 'zodHandler',
        type: 'request',
        payload: { name: '' },
        metadata: {},
        context: createContext('test-id'),
      }

      await expect(interceptor(zodEnvelope, zodEnvelope.context, async () => 'ok')).rejects.toThrow(
        'Input validation failed'
      )

      // Test fastest-validator handler
      const fvEnvelope: Envelope = {
        id: 'test',
        procedure: 'fvHandler',
        type: 'request',
        payload: { name: '' },
        metadata: {},
        context: createContext('test-id'),
      }

      await expect(interceptor(fvEnvelope, fvEnvelope.context, async () => 'ok')).rejects.toThrow(
        'Input validation failed'
      )
    })

    it('should list schemas with validator info', () => {
      const schemaRegistry = createSchemaRegistry()

      schemaRegistry.register('zodHandler', {
        validator: 'zod',
        input: z.string(),
      })

      schemaRegistry.register('fvHandler', {
        validator: 'fastest-validator',
        input: { name: 'string' },
      })

      const list = schemaRegistry.list()

      expect(list.length).toBe(2)
      expect(list.find((s) => s.name === 'zodHandler')?.schema.validator).toBe('zod')
      expect(list.find((s) => s.name === 'fvHandler')?.schema.validator).toBe('fastest-validator')
    })
  })

  describe('Complex fastest-validator schemas', () => {
    it('should validate nested objects', () => {
      const schema = {
        user: {
          type: 'object',
          properties: {
            name: { type: 'string', min: 1 },
            email: { type: 'email' },
          },
        },
      }

      const result = fvAdapter.validate(schema, {
        user: { name: 'John', email: 'john@example.com' },
      })

      expect(result.success).toBe(true)
    })

    it('should validate arrays', () => {
      const schema = {
        items: {
          type: 'array',
          items: { type: 'number' },
        },
      }

      const validResult = fvAdapter.validate(schema, { items: [1, 2, 3] })
      expect(validResult.success).toBe(true)

      const invalidResult = fvAdapter.validate(schema, { items: [1, 'two', 3] })
      expect(invalidResult.success).toBe(false)
    })

    it('should validate enums', () => {
      const schema = {
        status: {
          type: 'enum',
          values: ['pending', 'active', 'completed'],
        },
      }

      const validResult = fvAdapter.validate(schema, { status: 'active' })
      expect(validResult.success).toBe(true)

      const invalidResult = fvAdapter.validate(schema, { status: 'invalid' })
      expect(invalidResult.success).toBe(false)
    })

    it('should handle optional fields', () => {
      const schema = {
        required: { type: 'string' },
        optional: { type: 'string', optional: true },
      }

      const result = fvAdapter.validate(schema, { required: 'test' })
      expect(result.success).toBe(true)
    })
  })

  describe('Complex Yup Schemas', () => {
    beforeEach(() => {
      registerValidator(yupAdapter)
    })

    it('should validate nested objects', () => {
      const schema = yup.object({
        user: yup.object({
          profile: yup.object({
            name: yup.string().required(),
            email: yup.string().email().required(),
          }),
        }),
      })

      const result = yupAdapter.validate(schema, {
        user: { profile: { name: 'John', email: 'john@example.com' } },
      })

      expect(result.success).toBe(true)
    })

    it('should validate arrays with object items', () => {
      const schema = yup.object({
        items: yup.array().of(
          yup.object({
            id: yup.number().required(),
            name: yup.string().required(),
          })
        ),
      })

      const validResult = yupAdapter.validate(schema, {
        items: [
          { id: 1, name: 'First' },
          { id: 2, name: 'Second' },
        ],
      })
      expect(validResult.success).toBe(true)

      const invalidResult = yupAdapter.validate(schema, {
        items: [{ id: 'not-a-number', name: 'Test' }],
      })
      expect(invalidResult.success).toBe(false)
    })

    it('should handle transformations', () => {
      const schema = yup.object({
        email: yup.string().email().lowercase().required(),
      })

      const result = yupAdapter.validate(schema, { email: 'TEST@EXAMPLE.COM' })

      expect(result.success).toBe(true)
      expect((result.data as { email: string }).email).toBe('test@example.com')
    })

    it('should handle nullable fields', () => {
      const schema = yup.object({
        name: yup.string().required(),
        nickname: yup.string().nullable(),
      })

      const result = yupAdapter.validate(schema, { name: 'John', nickname: null })
      expect(result.success).toBe(true)
    })

    it('should handle default values', () => {
      const schema = yup.object({
        name: yup.string().required(),
        role: yup.string().default('user'),
      })

      const result = yupAdapter.validate(schema, { name: 'John' })

      expect(result.success).toBe(true)
      expect((result.data as { role: string }).role).toBe('user')
    })

    it('should convert to JSON Schema', () => {
      const schema = yup.object({
        name: yup.string(),
        age: yup.number(),
        active: yup.boolean(),
      })

      const jsonSchema = yupAdapter.toJsonSchema!(schema)

      expect(jsonSchema.type).toBe('object')
      expect((jsonSchema as { properties: Record<string, { type: string }> }).properties.name.type).toBe('string')
      expect((jsonSchema as { properties: Record<string, { type: string }> }).properties.age.type).toBe('number')
    })
  })

  describe('Complex Joi Schemas', () => {
    beforeEach(() => {
      registerValidator(joiAdapter)
    })

    it('should validate nested objects', () => {
      const schema = Joi.object({
        user: Joi.object({
          profile: Joi.object({
            name: Joi.string().required(),
            email: Joi.string().email().required(),
          }),
        }),
      })

      const result = joiAdapter.validate(schema, {
        user: { profile: { name: 'John', email: 'john@example.com' } },
      })

      expect(result.success).toBe(true)
    })

    it('should validate arrays with object items', () => {
      const schema = Joi.object({
        items: Joi.array().items(
          Joi.object({
            id: Joi.number().required(),
            name: Joi.string().required(),
          })
        ),
      })

      const validResult = joiAdapter.validate(schema, {
        items: [
          { id: 1, name: 'First' },
          { id: 2, name: 'Second' },
        ],
      })
      expect(validResult.success).toBe(true)

      const invalidResult = joiAdapter.validate(schema, {
        items: [{ id: 'not-a-number', name: 'Test' }],
      })
      expect(invalidResult.success).toBe(false)
    })

    it('should handle alternatives (oneOf)', () => {
      const schema = Joi.object({
        value: Joi.alternatives().try(Joi.string(), Joi.number()),
      })

      const stringResult = joiAdapter.validate(schema, { value: 'text' })
      expect(stringResult.success).toBe(true)

      const numberResult = joiAdapter.validate(schema, { value: 42 })
      expect(numberResult.success).toBe(true)

      const invalidResult = joiAdapter.validate(schema, { value: [] })
      expect(invalidResult.success).toBe(false)
    })

    it('should handle conditional validation (when)', () => {
      const schema = Joi.object({
        type: Joi.string().valid('personal', 'business').required(),
        companyName: Joi.when('type', {
          is: 'business',
          then: Joi.string().required(),
          otherwise: Joi.string().optional(),
        }),
      })

      const businessValid = joiAdapter.validate(schema, {
        type: 'business',
        companyName: 'Acme Corp',
      })
      expect(businessValid.success).toBe(true)

      const businessInvalid = joiAdapter.validate(schema, {
        type: 'business',
        // missing companyName
      })
      expect(businessInvalid.success).toBe(false)

      const personalValid = joiAdapter.validate(schema, {
        type: 'personal',
        // companyName not required
      })
      expect(personalValid.success).toBe(true)
    })

    it('should convert to JSON Schema', () => {
      const schema = Joi.object({
        name: Joi.string(),
        age: Joi.number(),
        active: Joi.boolean(),
      })

      const jsonSchema = joiAdapter.toJsonSchema!(schema)

      expect(jsonSchema.type).toBe('object')
      expect((jsonSchema as { properties: Record<string, { type: string }> }).properties).toBeDefined()
    })
  })

  describe('Complex Ajv Schemas', () => {
    beforeEach(() => {
      registerValidator(ajvAdapter)
    })

    it('should validate nested objects', () => {
      const schema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              profile: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                },
                required: ['name', 'email'],
              },
            },
            required: ['profile'],
          },
        },
        required: ['user'],
      }

      const result = ajvAdapter.validate(schema, {
        user: { profile: { name: 'John', email: 'john@example.com' } },
      })

      expect(result.success).toBe(true)
    })

    it('should validate with additionalProperties: false', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        additionalProperties: false,
      }

      const validResult = ajvAdapter.validate(schema, { name: 'John' })
      expect(validResult.success).toBe(true)

      const invalidResult = ajvAdapter.validate(schema, { name: 'John', extra: 'field' })
      expect(invalidResult.success).toBe(false)
    })

    it('should validate oneOf schemas', () => {
      const schema = {
        oneOf: [
          {
            type: 'object',
            properties: { type: { const: 'text' }, content: { type: 'string' } },
            required: ['type', 'content'],
          },
          {
            type: 'object',
            properties: { type: { const: 'number' }, value: { type: 'number' } },
            required: ['type', 'value'],
          },
        ],
      }

      const textResult = ajvAdapter.validate(schema, { type: 'text', content: 'hello' })
      expect(textResult.success).toBe(true)

      const numberResult = ajvAdapter.validate(schema, { type: 'number', value: 42 })
      expect(numberResult.success).toBe(true)
    })

    it('should validate pattern strings', () => {
      const schema = {
        type: 'object',
        properties: {
          phone: { type: 'string', pattern: '^\\d{3}-\\d{3}-\\d{4}$' },
        },
      }

      const validResult = ajvAdapter.validate(schema, { phone: '123-456-7890' })
      expect(validResult.success).toBe(true)

      const invalidResult = ajvAdapter.validate(schema, { phone: '1234567890' })
      expect(invalidResult.success).toBe(false)
    })

    it('should validate array constraints', () => {
      const schema = {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 5,
            uniqueItems: true,
          },
        },
      }

      const validResult = ajvAdapter.validate(schema, { tags: ['a', 'b', 'c'] })
      expect(validResult.success).toBe(true)

      const emptyResult = ajvAdapter.validate(schema, { tags: [] })
      expect(emptyResult.success).toBe(false)

      const duplicateResult = ajvAdapter.validate(schema, { tags: ['a', 'a'] })
      expect(duplicateResult.success).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    it('should handle empty objects', () => {
      const zodSchema = z.object({})
      const zodResult = zodAdapter.validate(zodSchema, {})
      expect(zodResult.success).toBe(true)

      const fvSchema = {}
      const fvResult = fvAdapter.validate(fvSchema, {})
      expect(fvResult.success).toBe(true)
    })

    it('should handle null values correctly', () => {
      const zodSchema = z.object({ value: z.string().nullable() })
      const zodResult = zodAdapter.validate(zodSchema, { value: null })
      expect(zodResult.success).toBe(true)

      registerValidator(joiAdapter)
      const joiSchema = Joi.object({ value: Joi.string().allow(null) })
      const joiResult = joiAdapter.validate(joiSchema, { value: null })
      expect(joiResult.success).toBe(true)
    })

    it('should handle undefined values correctly', () => {
      const zodSchema = z.object({
        required: z.string(),
        optional: z.string().optional(),
      })
      const zodResult = zodAdapter.validate(zodSchema, { required: 'test' })
      expect(zodResult.success).toBe(true)
    })

    it('should return proper field paths in errors', () => {
      const zodSchema = z.object({
        user: z.object({
          profile: z.object({
            email: z.string().email(),
          }),
        }),
      })

      const zodResult = zodAdapter.validate(zodSchema, {
        user: { profile: { email: 'invalid' } },
      })

      expect(zodResult.success).toBe(false)
      expect(zodResult.errors![0].field).toContain('email')
    })

    it('should handle invalid schema gracefully', () => {
      // Pass non-schema to Zod adapter
      const zodResult = zodAdapter.validate('not a schema', { data: 'test' })
      expect(zodResult.success).toBe(false)
      expect(zodResult.errors![0].code).toBe('invalid_schema')

      // Pass non-schema to Ajv adapter
      const ajvResult = ajvAdapter.validate('not a schema', { data: 'test' })
      expect(ajvResult.success).toBe(false)
      expect(ajvResult.errors![0].code).toBe('invalid_schema')
    })
  })

  describe('Error Message Consistency', () => {
    it('should return errors with field, message, and code', () => {
      // Test all adapters return consistent error structure
      const zodSchema = z.object({ name: z.string().min(1) })
      const zodResult = zodAdapter.validate(zodSchema, { name: '' })
      expect(zodResult.errors![0]).toHaveProperty('field')
      expect(zodResult.errors![0]).toHaveProperty('message')
      expect(zodResult.errors![0]).toHaveProperty('code')

      const fvSchema = { name: { type: 'string', min: 1 } }
      const fvResult = fvAdapter.validate(fvSchema, { name: '' })
      expect(fvResult.errors![0]).toHaveProperty('field')
      expect(fvResult.errors![0]).toHaveProperty('message')
      expect(fvResult.errors![0]).toHaveProperty('code')

      registerValidator(yupAdapter)
      const yupSchema = yup.object({ name: yup.string().min(1).required() })
      const yupResult = yupAdapter.validate(yupSchema, { name: '' })
      expect(yupResult.errors![0]).toHaveProperty('field')
      expect(yupResult.errors![0]).toHaveProperty('message')
      expect(yupResult.errors![0]).toHaveProperty('code')

      registerValidator(joiAdapter)
      const joiSchema = Joi.object({ name: Joi.string().min(1).required() })
      const joiResult = joiAdapter.validate(joiSchema, { name: '' })
      expect(joiResult.errors![0]).toHaveProperty('field')
      expect(joiResult.errors![0]).toHaveProperty('message')
      expect(joiResult.errors![0]).toHaveProperty('code')

      registerValidator(ajvAdapter)
      const ajvSchema = { type: 'object', properties: { name: { type: 'string', minLength: 1 } }, required: ['name'] }
      const ajvResult = ajvAdapter.validate(ajvSchema, { name: '' })
      expect(ajvResult.errors![0]).toHaveProperty('field')
      expect(ajvResult.errors![0]).toHaveProperty('message')
      expect(ajvResult.errors![0]).toHaveProperty('code')
    })
  })

  describe('JSON Schema Conversion', () => {
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
})
