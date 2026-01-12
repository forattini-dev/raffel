/**
 * HTTP Validation Middleware
 *
 * Provides request validation middleware that works with any validator adapter
 * (zod, fastest-validator, joi, yup, ajv).
 *
 * @example
 * import { createValidator, validateBody, validateQuery } from 'raffel/http/validate'
 * import { zodAdapter } from 'raffel/validation/zod'
 * import { z } from 'zod'
 *
 * // Register validator
 * const validator = createValidator(zodAdapter())
 *
 * // Define schemas
 * const createUserSchema = z.object({
 *   name: z.string().min(1),
 *   email: z.string().email(),
 * })
 *
 * // Use as middleware
 * app.post('/users',
 *   validateBody(validator, createUserSchema),
 *   async (c) => {
 *     const data = c.get('validatedBody')
 *     // data is typed and validated
 *   }
 * )
 */

import type { HttpContextInterface } from './context.js'
import type { HttpMiddleware } from './app.js'
import type { ValidatorAdapter, ValidationResult, ValidationErrorDetails } from '../validation/types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validation target (where to get data from)
 */
export type ValidationTarget = 'body' | 'query' | 'params' | 'headers'

/**
 * Validator wrapper with caching support
 */
export interface Validator {
  /** Underlying adapter */
  readonly adapter: ValidatorAdapter

  /**
   * Validate data against a schema
   */
  validate<T = unknown>(schema: unknown, data: unknown): ValidationResult<T>

  /**
   * Compile schema for better performance (if supported)
   */
  compile<T = unknown>(schema: unknown): CompiledSchema<T>
}

/**
 * Compiled schema for better performance
 */
export interface CompiledSchema<T = unknown> {
  /**
   * Validate data using pre-compiled schema
   */
  validate(data: unknown): ValidationResult<T>

  /**
   * Get JSON Schema representation (if available)
   */
  toJsonSchema?(): Record<string, unknown>
}

/**
 * Validation middleware options
 */
export interface ValidationMiddlewareOptions {
  /**
   * Key to store validated data in context
   * @default 'validatedBody' | 'validatedQuery' | etc.
   */
  contextKey?: string

  /**
   * Custom error response generator
   */
  onError?: (errors: ValidationErrorDetails[], c: HttpContextInterface) => Response | Promise<Response>

  /**
   * HTTP status code for validation errors
   * @default 400
   */
  statusCode?: number

  /**
   * Strip unknown fields from validated data
   * @default false
   */
  stripUnknown?: boolean

  /**
   * Allow partial data (for PATCH requests)
   * @default false
   */
  partial?: boolean
}

/**
 * Combined validation options for validating multiple targets
 */
export interface CombinedValidationOptions {
  /** Body schema */
  body?: unknown

  /** Query schema */
  query?: unknown

  /** Params schema */
  params?: unknown

  /** Headers schema */
  headers?: unknown

  /** Options for each target */
  options?: Partial<Record<ValidationTarget, ValidationMiddlewareOptions>>

  /** Global options (applied to all targets) */
  globalOptions?: ValidationMiddlewareOptions
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema Cache
// ─────────────────────────────────────────────────────────────────────────────

const schemaCache = new WeakMap<object, CompiledSchema<unknown>>()

// ─────────────────────────────────────────────────────────────────────────────
// Validator Wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a validator wrapper with caching support
 *
 * @param adapter - Validator adapter (zod, fastest-validator, etc.)
 * @returns Validator instance
 *
 * @example
 * import { zodAdapter } from 'raffel/validation/zod'
 * const validator = createValidator(zodAdapter())
 */
export function createValidator(adapter: ValidatorAdapter): Validator {
  return {
    adapter,

    validate<T = unknown>(schema: unknown, data: unknown): ValidationResult<T> {
      return adapter.validate<T>(schema, data)
    },

    compile<T = unknown>(schema: unknown): CompiledSchema<T> {
      // Check cache first (for object schemas)
      if (typeof schema === 'object' && schema !== null) {
        const cached = schemaCache.get(schema as object)
        if (cached) {
          return cached as CompiledSchema<T>
        }
      }

      // Create compiled schema
      const compiled: CompiledSchema<T> = {
        validate: (data: unknown) => adapter.validate<T>(schema, data),
        toJsonSchema: adapter.toJsonSchema
          ? () => adapter.toJsonSchema!(schema)
          : undefined,
      }

      // Cache for object schemas
      if (typeof schema === 'object' && schema !== null) {
        schemaCache.set(schema as object, compiled as CompiledSchema<unknown>)
      }

      return compiled
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Response
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default validation error response generator
 */
function defaultErrorResponse(
  errors: ValidationErrorDetails[],
  statusCode: number
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.map((e) => ({
          field: e.field,
          message: e.message,
          code: e.code,
        })),
      },
    }),
    {
      status: statusCode,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create body validation middleware
 *
 * @param validator - Validator instance
 * @param schema - Validation schema
 * @param options - Middleware options
 * @returns Middleware function
 *
 * @example
 * app.post('/users', validateBody(validator, userSchema), handler)
 */
export function validateBody<T = unknown, E extends Record<string, unknown> = Record<string, unknown>>(
  validator: Validator,
  schema: unknown,
  options: ValidationMiddlewareOptions = {}
): HttpMiddleware<E> {
  const {
    contextKey = 'validatedBody',
    onError,
    statusCode = 400,
  } = options

  const compiled = validator.compile<T>(schema)

  return async (c, next) => {
    let body: unknown

    // Parse body based on content type
    const contentType = (c.req.header('content-type') as string | undefined) || ''

    try {
      if (contentType.includes('application/json')) {
        body = await c.req.json()
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const text = await c.req.text()
        body = Object.fromEntries(new URLSearchParams(text))
      } else if (contentType.includes('multipart/form-data')) {
        // For multipart, just get the raw body - schema validation might not apply
        body = await c.req.json().catch(() => ({}))
      } else {
        // Try JSON as default
        body = await c.req.json().catch(() => ({}))
      }
    } catch {
      const errors: ValidationErrorDetails[] = [{
        field: 'body',
        message: 'Invalid request body',
        code: 'INVALID_BODY',
      }]

      if (onError) {
        c.res = await onError(errors, c)
        return
      }

      c.res = defaultErrorResponse(errors, statusCode)
      return
    }

    const result = compiled.validate(body)

    if (!result.success) {
      if (onError) {
        c.res = await onError(result.errors || [], c)
        return
      }

      c.res = defaultErrorResponse(result.errors || [], statusCode)
      return
    }

    // Store validated data in context
    ;(c as HttpContextInterface<Record<string, unknown>>).set(contextKey, result.data)

    await next()
  }
}

/**
 * Create query parameter validation middleware
 *
 * @param validator - Validator instance
 * @param schema - Validation schema
 * @param options - Middleware options
 * @returns Middleware function
 *
 * @example
 * app.get('/search', validateQuery(validator, searchSchema), handler)
 */
export function validateQuery<T = unknown, E extends Record<string, unknown> = Record<string, unknown>>(
  validator: Validator,
  schema: unknown,
  options: ValidationMiddlewareOptions = {}
): HttpMiddleware<E> {
  const {
    contextKey = 'validatedQuery',
    onError,
    statusCode = 400,
  } = options

  const compiled = validator.compile<T>(schema)

  return async (c, next) => {
    // Parse query string
    const url = new URL(c.req.url)
    const query: Record<string, string | string[]> = {}

    for (const [key, value] of url.searchParams) {
      if (key in query) {
        const existing = query[key]
        if (Array.isArray(existing)) {
          existing.push(value)
        } else {
          query[key] = [existing, value]
        }
      } else {
        query[key] = value
      }
    }

    const result = compiled.validate(query)

    if (!result.success) {
      if (onError) {
        c.res = await onError(result.errors || [], c)
        return
      }

      c.res = defaultErrorResponse(result.errors || [], statusCode)
      return
    }

    ;(c as HttpContextInterface<Record<string, unknown>>).set(contextKey, result.data)

    await next()
  }
}

/**
 * Create URL params validation middleware
 *
 * @param validator - Validator instance
 * @param schema - Validation schema
 * @param options - Middleware options
 * @returns Middleware function
 *
 * @example
 * app.get('/users/:id', validateParams(validator, paramsSchema), handler)
 */
export function validateParams<T = unknown, E extends Record<string, unknown> = Record<string, unknown>>(
  validator: Validator,
  schema: unknown,
  options: ValidationMiddlewareOptions = {}
): HttpMiddleware<E> {
  const {
    contextKey = 'validatedParams',
    onError,
    statusCode = 400,
  } = options

  const compiled = validator.compile<T>(schema)

  return async (c, next) => {
    const params = c.req.param()

    const result = compiled.validate(params)

    if (!result.success) {
      if (onError) {
        c.res = await onError(result.errors || [], c)
        return
      }

      c.res = defaultErrorResponse(result.errors || [], statusCode)
      return
    }

    ;(c as HttpContextInterface<Record<string, unknown>>).set(contextKey, result.data)

    await next()
  }
}

/**
 * Create headers validation middleware
 *
 * @param validator - Validator instance
 * @param schema - Validation schema
 * @param options - Middleware options
 * @returns Middleware function
 *
 * @example
 * app.use('*', validateHeaders(validator, headersSchema))
 */
export function validateHeaders<T = unknown, E extends Record<string, unknown> = Record<string, unknown>>(
  validator: Validator,
  schema: unknown,
  options: ValidationMiddlewareOptions = {}
): HttpMiddleware<E> {
  const {
    contextKey = 'validatedHeaders',
    onError,
    statusCode = 400,
  } = options

  const compiled = validator.compile<T>(schema)

  return async (c, next) => {
    // Get all headers as object (lowercase keys)
    const headers: Record<string, string> = {}
    const reqHeaders = c.req.header()

    if (typeof reqHeaders === 'object') {
      for (const [key, value] of Object.entries(reqHeaders)) {
        if (typeof value === 'string') {
          headers[key.toLowerCase()] = value
        }
      }
    }

    const result = compiled.validate(headers)

    if (!result.success) {
      if (onError) {
        c.res = await onError(result.errors || [], c)
        return
      }

      c.res = defaultErrorResponse(result.errors || [], statusCode)
      return
    }

    ;(c as HttpContextInterface<Record<string, unknown>>).set(contextKey, result.data)

    await next()
  }
}

/**
 * Create combined validation middleware for multiple targets
 *
 * @param validator - Validator instance
 * @param schemas - Schemas for each target
 * @returns Middleware function
 *
 * @example
 * app.post('/users/:id',
 *   validate(validator, {
 *     params: paramsSchema,
 *     body: bodySchema,
 *     query: querySchema,
 *   }),
 *   handler
 * )
 */
export function validate<E extends Record<string, unknown> = Record<string, unknown>>(
  validator: Validator,
  schemas: CombinedValidationOptions
): HttpMiddleware<E> {
  const { body, query, params, headers, options = {}, globalOptions = {} } = schemas

  // Pre-compile all schemas
  const compiledBody = body ? validator.compile(body) : undefined
  const compiledQuery = query ? validator.compile(query) : undefined
  const compiledParams = params ? validator.compile(params) : undefined
  const compiledHeaders = headers ? validator.compile(headers) : undefined

  return async (c, next) => {
    const allErrors: ValidationErrorDetails[] = []

    // Validate params
    if (compiledParams) {
      const paramsData = c.req.param()
      const result = compiledParams.validate(paramsData)

      if (!result.success) {
        allErrors.push(...(result.errors || []).map((e) => ({
          ...e,
          field: `params.${e.field}`,
        })))
      } else {
        const key = options.params?.contextKey || globalOptions.contextKey || 'validatedParams'
        ;(c as HttpContextInterface<Record<string, unknown>>).set(key, result.data)
      }
    }

    // Validate query
    if (compiledQuery) {
      const url = new URL(c.req.url)
      const queryData: Record<string, string | string[]> = {}

      for (const [key, value] of url.searchParams) {
        if (key in queryData) {
          const existing = queryData[key]
          if (Array.isArray(existing)) {
            existing.push(value)
          } else {
            queryData[key] = [existing, value]
          }
        } else {
          queryData[key] = value
        }
      }

      const result = compiledQuery.validate(queryData)

      if (!result.success) {
        allErrors.push(...(result.errors || []).map((e) => ({
          ...e,
          field: `query.${e.field}`,
        })))
      } else {
        const key = options.query?.contextKey || globalOptions.contextKey || 'validatedQuery'
        ;(c as HttpContextInterface<Record<string, unknown>>).set(key, result.data)
      }
    }

    // Validate headers
    if (compiledHeaders) {
      const headersData: Record<string, string> = {}
      const reqHeaders = c.req.header()

      if (typeof reqHeaders === 'object') {
        for (const [key, value] of Object.entries(reqHeaders)) {
          if (typeof value === 'string') {
            headersData[key.toLowerCase()] = value
          }
        }
      }

      const result = compiledHeaders.validate(headersData)

      if (!result.success) {
        allErrors.push(...(result.errors || []).map((e) => ({
          ...e,
          field: `headers.${e.field}`,
        })))
      } else {
        const key = options.headers?.contextKey || globalOptions.contextKey || 'validatedHeaders'
        ;(c as HttpContextInterface<Record<string, unknown>>).set(key, result.data)
      }
    }

    // Validate body
    if (compiledBody) {
      let bodyData: unknown

      try {
        const contentType = (c.req.header('content-type') as string | undefined) || ''

        if (contentType.includes('application/json')) {
          bodyData = await c.req.json()
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
          const text = await c.req.text()
          bodyData = Object.fromEntries(new URLSearchParams(text))
        } else {
          bodyData = await c.req.json().catch(() => ({}))
        }
      } catch {
        allErrors.push({
          field: 'body',
          message: 'Invalid request body',
          code: 'INVALID_BODY',
        })
      }

      if (bodyData !== undefined) {
        const result = compiledBody.validate(bodyData)

        if (!result.success) {
          allErrors.push(...(result.errors || []).map((e) => ({
            ...e,
            field: `body.${e.field}`,
          })))
        } else {
          const key = options.body?.contextKey || globalOptions.contextKey || 'validatedBody'
          ;(c as HttpContextInterface<Record<string, unknown>>).set(key, result.data)
        }
      }
    }

    // Return errors if any
    if (allErrors.length > 0) {
      const statusCode = globalOptions.statusCode || 400

      if (globalOptions.onError) {
        c.res = await globalOptions.onError(allErrors, c)
        return
      }

      c.res = defaultErrorResponse(allErrors, statusCode)
      return
    }

    await next()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  createValidator,
  validateBody,
  validateQuery,
  validateParams,
  validateHeaders,
  validate,
}
