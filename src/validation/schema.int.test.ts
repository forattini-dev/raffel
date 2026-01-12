/**
 * Schema Validation Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import {
  validate,
  createValidationInterceptor,
  createSchemaRegistry,
  createSchemaValidationInterceptor,
  registerValidator,
  resetValidation,
  createZodAdapter,
  zodErrorToDetails,
} from './index.js'
import { createRegistry } from '../core/registry.js'
import { createRouter, RaffelError } from '../core/router.js'
import { createContext } from '../types/context.js'
import type { Envelope } from '../types/index.js'

// Register Zod adapter for all tests
beforeEach(() => {
  resetValidation()
  registerValidator(createZodAdapter(z))
})

describe('Schema Validation', () => {
  describe('validate', () => {
    it('should return validated data when valid', () => {
      const schema = z.object({ name: z.string() })
      const result = validate(schema, { name: 'World' })

      expect(result).toEqual({ name: 'World' })
    })

    it('should throw RaffelError when invalid', () => {
      const schema = z.object({ name: z.string().min(1) })

      expect(() => validate(schema, { name: '' })).toThrow(RaffelError)

      try {
        validate(schema, { name: '' })
      } catch (error) {
        expect(error).toBeInstanceOf(RaffelError)
        const raffelError = error as RaffelError
        expect(raffelError.code).toBe('VALIDATION_ERROR')
        expect((raffelError.details as { errors: unknown[] })?.errors).toBeDefined()
      }
    })

    it('should coerce types when schema allows', () => {
      const schema = z.object({ age: z.coerce.number() })
      const result = validate(schema, { age: '25' })

      expect(result).toEqual({ age: 25 })
    })

    it('should strip unknown fields with strict', () => {
      const schema = z.object({ name: z.string() }).strict()

      expect(() => validate(schema, { name: 'Test', extra: true })).toThrow(RaffelError)
    })
  })

  describe('zodErrorToDetails', () => {
    it('should convert Zod errors to details array', () => {
      const schema = z.object({
        name: z.string().min(1, 'Name is required'),
        age: z.number().positive('Age must be positive'),
      })

      const result = schema.safeParse({ name: '', age: -5 })

      if (!result.success) {
        const details = zodErrorToDetails(result.error)

        expect(details.length).toBe(2)
        expect(details[0].field).toBe('name')
        expect(details[0].message).toBe('Name is required')
        expect(details[1].field).toBe('age')
        expect(details[1].message).toBe('Age must be positive')
      }
    })

    it('should handle nested field paths', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            email: z.string().email(),
          }),
        }),
      })

      const result = schema.safeParse({ user: { profile: { email: 'invalid' } } })

      if (!result.success) {
        const details = zodErrorToDetails(result.error)

        expect(details[0].field).toBe('user.profile.email')
      }
    })
  })

  describe('createValidationInterceptor', () => {
    it('should validate input and output', async () => {
      const schema = {
        input: z.object({ name: z.string() }),
        output: z.object({ greeting: z.string() }),
      }

      const interceptor = createValidationInterceptor(schema)

      const envelope: Envelope = {
        id: 'test',
        procedure: 'greet',
        type: 'request',
        payload: { name: 'World' },
        metadata: {},
        context: createContext('test-id'),
      }

      const result = await interceptor(envelope, envelope.context, async () => ({
        greeting: 'Hello, World!',
      }))

      expect(result).toEqual({ greeting: 'Hello, World!' })
    })

    it('should reject invalid input', async () => {
      const schema = {
        input: z.object({ name: z.string().min(1) }),
      }

      const interceptor = createValidationInterceptor(schema)

      const envelope: Envelope = {
        id: 'test',
        procedure: 'greet',
        type: 'request',
        payload: { name: '' },
        metadata: {},
        context: createContext('test-id'),
      }

      await expect(interceptor(envelope, envelope.context, async () => 'ok')).rejects.toThrow(
        'Input validation failed'
      )
    })

    it('should reject invalid output', async () => {
      const schema = {
        output: z.object({ greeting: z.string() }),
      }

      const interceptor = createValidationInterceptor(schema)

      const envelope: Envelope = {
        id: 'test',
        procedure: 'greet',
        type: 'request',
        payload: {},
        metadata: {},
        context: createContext('test-id'),
      }

      await expect(
        interceptor(envelope, envelope.context, async () => ({ greeting: 123 }))
      ).rejects.toThrow('Output validation failed')
    })

    it('should only validate input when output schema not provided', async () => {
      const schema = {
        input: z.object({ name: z.string() }),
      }

      const interceptor = createValidationInterceptor(schema)

      const envelope: Envelope = {
        id: 'test',
        procedure: 'greet',
        type: 'request',
        payload: { name: 'Test' },
        metadata: {},
        context: createContext('test-id'),
      }

      // Should pass without output validation
      const result = await interceptor(envelope, envelope.context, async () => ({
        anything: 'goes',
      }))

      expect(result).toEqual({ anything: 'goes' })
    })
  })

  describe('SchemaRegistry', () => {
    it('should register and retrieve schemas', () => {
      const schemaRegistry = createSchemaRegistry()

      const schema = {
        input: z.object({ name: z.string() }),
        output: z.object({ message: z.string() }),
      }

      schemaRegistry.register('greet', schema)

      expect(schemaRegistry.has('greet')).toBe(true)
      expect(schemaRegistry.get('greet')).toBe(schema)
    })

    it('should return undefined for unknown handlers', () => {
      const schemaRegistry = createSchemaRegistry()

      expect(schemaRegistry.has('unknown')).toBe(false)
      expect(schemaRegistry.get('unknown')).toBeUndefined()
    })

    it('should list all registered schemas', () => {
      const schemaRegistry = createSchemaRegistry()

      schemaRegistry.register('a', { input: z.string() })
      schemaRegistry.register('b', { output: z.number() })

      const list = schemaRegistry.list()

      expect(list.length).toBe(2)
      expect(list.map((s) => s.name)).toContain('a')
      expect(list.map((s) => s.name)).toContain('b')
    })
  })

  describe('createSchemaValidationInterceptor', () => {
    it('should validate using schema from registry', async () => {
      const schemaRegistry = createSchemaRegistry()
      schemaRegistry.register('greet', {
        input: z.object({ name: z.string().min(1) }),
      })

      const interceptor = createSchemaValidationInterceptor(schemaRegistry)

      const envelope: Envelope = {
        id: 'test',
        procedure: 'greet',
        type: 'request',
        payload: { name: '' },
        metadata: {},
        context: createContext('test-id'),
      }

      await expect(interceptor(envelope, envelope.context, async () => 'ok')).rejects.toThrow(
        'Input validation failed'
      )
    })

    it('should skip validation for handlers without schemas', async () => {
      const schemaRegistry = createSchemaRegistry()
      const interceptor = createSchemaValidationInterceptor(schemaRegistry)

      const envelope: Envelope = {
        id: 'test',
        procedure: 'unregistered',
        type: 'request',
        payload: { anything: 'goes' },
        metadata: {},
        context: createContext('test-id'),
      }

      const result = await interceptor(envelope, envelope.context, async () => 'passed')

      expect(result).toBe('passed')
    })
  })

  describe('Integration with Router', () => {
    it('should validate via handler-level interceptor', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)

      const greetSchema = {
        input: z.object({ name: z.string().min(1) }),
        output: z.object({ message: z.string() }),
      }

      registry.procedure(
        'greet',
        async (input: { name: string }) => ({ message: `Hello, ${input.name}!` }),
        { interceptors: [createValidationInterceptor(greetSchema)] }
      )

      // Valid input
      const validEnvelope: Envelope = {
        id: 'test',
        procedure: 'greet',
        type: 'request',
        payload: { name: 'World' },
        metadata: {},
        context: createContext('test-id'),
      }

      const validResult = (await router.handle(validEnvelope)) as Envelope
      expect(validResult.type).toBe('response')
      expect(validResult.payload).toEqual({ message: 'Hello, World!' })

      // Invalid input
      const invalidEnvelope: Envelope = {
        id: 'test',
        procedure: 'greet',
        type: 'request',
        payload: { name: '' },
        metadata: {},
        context: createContext('test-id'),
      }

      const invalidResult = (await router.handle(invalidEnvelope)) as Envelope
      expect(invalidResult.type).toBe('error')
      expect((invalidResult.payload as { code: string }).code).toBe('VALIDATION_ERROR')
    })

    it('should validate via global interceptor with schema registry', async () => {
      const registry = createRegistry()
      const router = createRouter(registry)
      const schemaRegistry = createSchemaRegistry()

      // Register schema separately
      schemaRegistry.register('echo', {
        input: z.object({ text: z.string().max(100) }),
      })

      // Add global validation interceptor
      router.use(createSchemaValidationInterceptor(schemaRegistry))

      // Register handler without schema
      registry.procedure('echo', async (input: { text: string }) => input)

      // Valid input
      const validEnvelope: Envelope = {
        id: 'test',
        procedure: 'echo',
        type: 'request',
        payload: { text: 'Hello' },
        metadata: {},
        context: createContext('test-id'),
      }

      const validResult = (await router.handle(validEnvelope)) as Envelope
      expect(validResult.type).toBe('response')

      // Invalid input (too long)
      const invalidEnvelope: Envelope = {
        id: 'test',
        procedure: 'echo',
        type: 'request',
        payload: { text: 'x'.repeat(200) },
        metadata: {},
        context: createContext('test-id'),
      }

      const invalidResult = (await router.handle(invalidEnvelope)) as Envelope
      expect(invalidResult.type).toBe('error')
      expect((invalidResult.payload as { code: string }).code).toBe('VALIDATION_ERROR')
    })
  })

  describe('Complex schema patterns', () => {
    it('should handle union types', () => {
      const schema = z.union([z.object({ type: z.literal('a'), value: z.string() }), z.object({ type: z.literal('b'), count: z.number() })])

      expect(validate(schema, { type: 'a', value: 'test' })).toEqual({
        type: 'a',
        value: 'test',
      })
      expect(validate(schema, { type: 'b', count: 42 })).toEqual({ type: 'b', count: 42 })
    })

    it('should handle optional fields', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.string().optional(),
        nullish: z.string().nullish(), // optional AND nullable
        defaulted: z.string().default('default'),
      })

      const result = validate(schema, { required: 'test' })

      expect(result).toEqual({
        required: 'test',
        optional: undefined,
        nullish: undefined,
        defaulted: 'default',
      })
    })

    it('should handle nullable fields with explicit null', () => {
      const schema = z.object({
        name: z.string(),
        nickname: z.string().nullable(),
      })

      const result = validate(schema, { name: 'John', nickname: null })

      expect(result).toEqual({ name: 'John', nickname: null })
    })

    it('should handle arrays', () => {
      const schema = z.object({
        items: z.array(z.object({ id: z.number(), name: z.string() })),
      })

      const result = validate<{ items: Array<{ id: number; name: string }> }>(schema, {
        items: [
          { id: 1, name: 'First' },
          { id: 2, name: 'Second' },
        ],
      })

      expect(result.items.length).toBe(2)
    })

    it('should handle enums', () => {
      const schema = z.object({
        status: z.enum(['pending', 'active', 'completed']),
      })

      expect(validate(schema, { status: 'active' })).toEqual({ status: 'active' })
      expect(() => validate(schema, { status: 'invalid' })).toThrow(RaffelError)
    })

    it('should handle transformations', () => {
      const schema = z.object({
        email: z.string().email().toLowerCase(),
        date: z.coerce.date(),
      })

      const result = validate<{ email: string; date: Date }>(schema, {
        email: 'TEST@EXAMPLE.COM',
        date: '2025-01-01',
      })

      expect(result.email).toBe('test@example.com')
      expect(result.date).toBeInstanceOf(Date)
    })
  })
})
