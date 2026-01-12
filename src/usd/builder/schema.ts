/**
 * Schema Builder for USD
 *
 * Provides helpers for building JSON Schema objects
 */

import type { USDSchema } from '../spec/types.js'

/**
 * Create a string schema
 */
export function string(options?: {
  description?: string
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  enum?: string[]
  default?: string
}): USDSchema {
  const schema: USDSchema = { type: 'string' }
  if (options?.description) schema.description = options.description
  if (options?.minLength !== undefined) schema.minLength = options.minLength
  if (options?.maxLength !== undefined) schema.maxLength = options.maxLength
  if (options?.pattern) schema.pattern = options.pattern
  if (options?.format) schema.format = options.format
  if (options?.enum) schema.enum = options.enum
  if (options?.default !== undefined) schema.default = options.default
  return schema
}

/**
 * Create a number schema
 */
export function number(options?: {
  description?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  multipleOf?: number
  default?: number
}): USDSchema {
  const schema: USDSchema = { type: 'number' }
  if (options?.description) schema.description = options.description
  if (options?.minimum !== undefined) schema.minimum = options.minimum
  if (options?.maximum !== undefined) schema.maximum = options.maximum
  if (options?.exclusiveMinimum !== undefined) schema.exclusiveMinimum = options.exclusiveMinimum
  if (options?.exclusiveMaximum !== undefined) schema.exclusiveMaximum = options.exclusiveMaximum
  if (options?.multipleOf !== undefined) schema.multipleOf = options.multipleOf
  if (options?.default !== undefined) schema.default = options.default
  return schema
}

/**
 * Create an integer schema
 */
export function integer(options?: {
  description?: string
  minimum?: number
  maximum?: number
  default?: number
}): USDSchema {
  return { ...number(options), type: 'integer' }
}

/**
 * Create a boolean schema
 */
export function boolean(options?: {
  description?: string
  default?: boolean
}): USDSchema {
  const schema: USDSchema = { type: 'boolean' }
  if (options?.description) schema.description = options.description
  if (options?.default !== undefined) schema.default = options.default
  return schema
}

/**
 * Create an array schema
 */
export function array(items: USDSchema | { $ref: string }, options?: {
  description?: string
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
}): USDSchema {
  const schema: USDSchema = { type: 'array', items }
  if (options?.description) schema.description = options.description
  if (options?.minItems !== undefined) schema.minItems = options.minItems
  if (options?.maxItems !== undefined) schema.maxItems = options.maxItems
  if (options?.uniqueItems !== undefined) schema.uniqueItems = options.uniqueItems
  return schema
}

/**
 * Create an object schema
 */
export function object(
  properties: Record<string, USDSchema | { $ref: string }>,
  options?: {
    description?: string
    required?: string[]
    additionalProperties?: boolean | USDSchema
  }
): USDSchema {
  const schema: USDSchema = { type: 'object', properties }
  if (options?.description) schema.description = options.description
  if (options?.required) schema.required = options.required
  if (options?.additionalProperties !== undefined) {
    schema.additionalProperties = options.additionalProperties
  }
  return schema
}

/**
 * Create a reference to another schema
 */
export function ref(path: string): { $ref: string } {
  // Normalize path
  if (!path.startsWith('#/')) {
    path = `#/components/schemas/${path}`
  }
  return { $ref: path }
}

/**
 * Create an enum schema
 */
export function enumeration<T extends string | number>(
  values: T[],
  options?: {
    description?: string
    default?: T
  }
): USDSchema {
  const schema: USDSchema = { enum: values }
  if (options?.description) schema.description = options.description
  if (options?.default !== undefined) schema.default = options.default
  return schema
}

/**
 * Create a oneOf schema
 */
export function oneOf(schemas: (USDSchema | { $ref: string })[]): USDSchema {
  return { oneOf: schemas }
}

/**
 * Create an anyOf schema
 */
export function anyOf(schemas: (USDSchema | { $ref: string })[]): USDSchema {
  return { anyOf: schemas }
}

/**
 * Create an allOf schema
 */
export function allOf(schemas: (USDSchema | { $ref: string })[]): USDSchema {
  return { allOf: schemas }
}

/**
 * Create a nullable version of a schema
 */
export function nullable(schema: USDSchema): USDSchema {
  return { oneOf: [schema, { type: 'null' }] }
}

/**
 * Common format helpers
 */
export const formats = {
  email: () => string({ format: 'email' }),
  uri: () => string({ format: 'uri' }),
  uuid: () => string({ format: 'uuid' }),
  datetime: () => string({ format: 'date-time' }),
  date: () => string({ format: 'date' }),
  time: () => string({ format: 'time' }),
  ipv4: () => string({ format: 'ipv4' }),
  ipv6: () => string({ format: 'ipv6' }),
  hostname: () => string({ format: 'hostname' }),
}

/**
 * Schema namespace for convenient imports
 */
export const Schema = {
  string,
  number,
  integer,
  boolean,
  array,
  object,
  ref,
  enum: enumeration,
  oneOf,
  anyOf,
  allOf,
  nullable,
  ...formats,
}
