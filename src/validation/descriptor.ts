/**
 * Canonical schema descriptor used by GraphQL, OpenAPI, USD, and related tooling.
 *
 * This is an internal platform contract. Bump `SCHEMA_DESCRIPTOR_VERSION` when
 * the normalized shape or compatibility expectations change.
 */

import { zodToJsonSchema } from 'zod-to-json-schema'
import type { ValidatorType } from './types.js'
import { getValidator, hasValidator, listValidators } from './schema.js'
import { cleanJsonSchema } from './schema-utils.js'

export const SCHEMA_DESCRIPTOR_VERSION = 1

export interface SchemaDescriptorDiagnostic {
  level: 'warning'
  code: string
  message: string
}

export interface SchemaDescriptor {
  version: typeof SCHEMA_DESCRIPTOR_VERSION
  validator?: ValidatorType
  source: 'empty' | 'json-schema' | 'validator-to-json-schema' | 'zod-to-json-schema' | 'opaque'
  jsonSchema: Record<string, unknown>
  diagnostics: SchemaDescriptorDiagnostic[]
}

export interface NormalizeSchemaDescriptorOptions {
  validator?: ValidatorType
  target?: 'openApi3' | 'jsonSchema2020'
}

function isJsonSchemaLike(schema: unknown): schema is Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false
  const object = schema as Record<string, unknown>

  if (typeof object.toJSONSchema === 'function') return false
  if ('def' in object || '_def' in object) return false

  return (
    'type' in object ||
    '$ref' in object ||
    'enum' in object ||
    'const' in object ||
    'properties' in object ||
    'items' in object ||
    'oneOf' in object ||
    'anyOf' in object ||
    'allOf' in object ||
    'additionalProperties' in object
  )
}

function isZodLikeSchema(schema: unknown): boolean {
  if (!schema || typeof schema !== 'object') return false
  const object = schema as Record<string, unknown>
  return typeof object.toJSONSchema === 'function' || 'def' in object || '_def' in object
}

function isZod4Schema(schema: unknown): schema is { toJSONSchema: () => Record<string, unknown> } {
  return (
    schema !== null &&
    typeof schema === 'object' &&
    typeof (schema as Record<string, unknown>).toJSONSchema === 'function'
  )
}

// cleanJsonSchema imported from ./schema-utils.js

function withDiagnostics(
  baseSchema: Record<string, unknown>,
  diagnostics: SchemaDescriptorDiagnostic[],
  opaque = false
): Record<string, unknown> {
  if (diagnostics.length === 0 && !opaque) {
    return baseSchema
  }

  return {
    ...baseSchema,
    ...(opaque ? { 'x-raffel-opaque': true } : {}),
    ...(diagnostics.length > 0 ? { 'x-raffel-diagnostics': diagnostics } : {}),
  }
}

function createDescriptor(
  source: SchemaDescriptor['source'],
  jsonSchema: Record<string, unknown>,
  diagnostics: SchemaDescriptorDiagnostic[] = [],
  validator?: ValidatorType
): SchemaDescriptor {
  const opaque = source === 'opaque'
  return {
    version: SCHEMA_DESCRIPTOR_VERSION,
    validator,
    source,
    diagnostics,
    jsonSchema: withDiagnostics(cleanJsonSchema(jsonSchema), diagnostics, opaque),
  }
}

function createOpaqueDescriptor(
  message: string,
  validator?: ValidatorType,
  code: string = 'UNSUPPORTED_SCHEMA'
): SchemaDescriptor {
  return createDescriptor(
    'opaque',
    {
      type: 'object',
      additionalProperties: true,
      description: 'Opaque Raffel schema fallback',
    },
    [{ level: 'warning', code, message }],
    validator
  )
}

function tryValidatorToJsonSchema(schema: unknown, validatorType: ValidatorType): SchemaDescriptor | null {
  if (!hasValidator(validatorType)) {
    return null
  }

  const validator = getValidator(validatorType)
  if (!validator.toJsonSchema || !validator.isValidSchema(schema)) {
    return null
  }

  try {
    const result = validator.toJsonSchema(schema)
    if (result && Object.keys(result).length > 0) {
      return createDescriptor('validator-to-json-schema', result, [], validatorType)
    }
    return null
  } catch {
    return null
  }
}

function tryRegisteredValidators(schema: unknown): SchemaDescriptor | null {
  for (const validatorType of listValidators()) {
    const descriptor = tryValidatorToJsonSchema(schema, validatorType)
    if (descriptor) {
      return descriptor
    }
  }

  return null
}

function tryZodToJsonSchema(
  schema: unknown,
  options: NormalizeSchemaDescriptorOptions
): SchemaDescriptor | null {
  if (!isZodLikeSchema(schema)) {
    return null
  }

  try {
    const zodTarget = options.target === 'jsonSchema2020' ? 'jsonSchema7' : 'openApi3'
    const jsonSchema = isZod4Schema(schema)
      ? schema.toJSONSchema()
      : zodToJsonSchema(schema as any, {
          $refStrategy: 'none',
          target: zodTarget,
        }) as Record<string, unknown>

    return createDescriptor('zod-to-json-schema', jsonSchema, [], options.validator)
  } catch (error) {
    return createOpaqueDescriptor(
      `Zod schema normalization failed: ${error instanceof Error ? error.message : String(error)}`,
      options.validator,
      'ZOD_TO_JSON_SCHEMA_FAILED'
    )
  }
}

export function normalizeSchemaDescriptor(
  schema: unknown,
  options: NormalizeSchemaDescriptorOptions = {}
): SchemaDescriptor {
  if (!schema) {
    return createDescriptor('empty', { type: 'object' }, [], options.validator)
  }

  if (isJsonSchemaLike(schema)) {
    return createDescriptor('json-schema', schema, [], options.validator)
  }

  if (options.validator) {
    const descriptor = tryValidatorToJsonSchema(schema, options.validator)
    if (descriptor) {
      return descriptor
    }
  }

  const validatorDescriptor = tryRegisteredValidators(schema)
  if (validatorDescriptor) {
    return validatorDescriptor
  }

  const zodDescriptor = tryZodToJsonSchema(schema, options)
  if (zodDescriptor) {
    return zodDescriptor
  }

  return createOpaqueDescriptor('Schema could not be normalized into Raffel descriptor', options.validator)
}
