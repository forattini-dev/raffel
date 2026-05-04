/**
 * Inspect — Schema Samples (delegates to shared schema-examples)
 *
 * Provides example generation for contract tests and playground.
 * Uses the unified generator with inspect defaults:
 * - maxDepth: 4
 * - maxOptionalProperties: 3
 * - uniqueValues: false (static, deterministic values)
 *
 * GraphQL document construction lives in `./graphql-document.ts`;
 * URL path parameter extraction lives in `./path-params.ts`.
 */

import type { SchemaDescriptor } from '../validation/descriptor.js'
import type { RuntimeInspectionSchema } from './types.js'
import {
  generateSchemaExample,
  generateSchemaInvalidExample as generateInvalid,
  type SchemaExampleOptions,
} from '../utils/schema-examples.js'

const INSPECT_DEFAULTS: SchemaExampleOptions = {
  maxDepth: 4,
  maxOptionalProperties: 3,
  uniqueValues: false,
}

// ── Schema unwrapping helpers ────────────────────────────────────────────────

export type JsonSchemaObject = Record<string, unknown>

function getSchemaDescriptor(
  schema: RuntimeInspectionSchema | SchemaDescriptor | undefined,
): SchemaDescriptor | undefined {
  if (!schema) return undefined
  if ('jsonSchema' in schema && schema.jsonSchema) return schema as SchemaDescriptor
  return 'descriptor' in schema ? schema.descriptor : undefined
}

export function getRootJsonSchema(
  schema: RuntimeInspectionSchema | SchemaDescriptor | undefined,
): JsonSchemaObject | null {
  const descriptor = getSchemaDescriptor(schema)
  if (!descriptor?.jsonSchema) return null
  const js = descriptor.jsonSchema
  return js && typeof js === 'object' && !Array.isArray(js) ? js as JsonSchemaObject : null
}

export function asJsonSchemaObject(value: unknown): JsonSchemaObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonSchemaObject
    : null
}

export function getSchemaType(schema: JsonSchemaObject): string | null {
  const type = schema.type
  if (typeof type === 'string') return type
  if (Array.isArray(type)) {
    return type.find((entry): entry is string => typeof entry === 'string' && entry !== 'null') ?? null
  }
  if (schema.properties && typeof schema.properties === 'object') return 'object'
  if (schema.items) return 'array'
  return null
}

export function getObjectProperties(schema: JsonSchemaObject): Record<string, JsonSchemaObject> {
  const properties = asJsonSchemaObject(schema.properties)
  if (!properties) return {}
  return Object.fromEntries(
    Object.entries(properties)
      .map(([key, value]) => [key, asJsonSchemaObject(value)])
      .filter((entry): entry is [string, JsonSchemaObject] => entry[1] !== null),
  )
}

// ── Public API ───────────────────────────────────────────────────────────────

export function createSchemaExample(
  schema: RuntimeInspectionSchema | SchemaDescriptor | undefined,
): unknown {
  const jsonSchema = getRootJsonSchema(schema)
  return jsonSchema ? generateSchemaExample(jsonSchema, INSPECT_DEFAULTS) : {}
}

export function createSchemaInvalidExample(
  schema: RuntimeInspectionSchema | SchemaDescriptor | undefined,
): unknown {
  const jsonSchema = getRootJsonSchema(schema)
  return jsonSchema ? generateInvalid(jsonSchema) : null
}

export function getSchemaRootType(
  schema: RuntimeInspectionSchema | SchemaDescriptor | undefined,
): string | null {
  const jsonSchema = getRootJsonSchema(schema)
  return jsonSchema ? getSchemaType(jsonSchema) : null
}

export function getSchemaObjectExample(
  schema: RuntimeInspectionSchema | SchemaDescriptor | undefined,
): Record<string, unknown> {
  const example = createSchemaExample(schema)
  return example && typeof example === 'object' && !Array.isArray(example)
    ? example as Record<string, unknown>
    : {}
}

// Re-exported here for compat — `extractPathParameters` and
// `buildGraphQLDocument` were originally exported from this module.
export { extractPathParameters } from './path-params.js'
export { buildGraphQLDocument } from './graphql-document.js'
