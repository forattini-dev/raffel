/**
 * Inspect — Schema Samples (delegates to shared schema-examples)
 *
 * Provides example generation for contract tests and playground.
 * Uses the unified generator with inspect defaults:
 * - maxDepth: 4
 * - maxOptionalProperties: 3
 * - uniqueValues: false (static, deterministic values)
 */

import type { SchemaDescriptor } from '../validation/descriptor.js'
import type { RuntimeInspectionOperation, RuntimeInspectionSchema } from './types.js'
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

type JsonSchemaObject = Record<string, unknown>

function getSchemaDescriptor(
  schema: RuntimeInspectionSchema | SchemaDescriptor | undefined,
): SchemaDescriptor | undefined {
  if (!schema) return undefined
  if ('jsonSchema' in schema && schema.jsonSchema) return schema as SchemaDescriptor
  return 'descriptor' in schema ? schema.descriptor : undefined
}

function getRootJsonSchema(
  schema: RuntimeInspectionSchema | SchemaDescriptor | undefined,
): JsonSchemaObject | null {
  const descriptor = getSchemaDescriptor(schema)
  if (!descriptor?.jsonSchema) return null
  const js = descriptor.jsonSchema
  return js && typeof js === 'object' && !Array.isArray(js) ? js as JsonSchemaObject : null
}

function asJsonSchemaObject(value: unknown): JsonSchemaObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonSchemaObject
    : null
}

function getSchemaType(schema: JsonSchemaObject): string | null {
  const type = schema.type
  if (typeof type === 'string') return type
  if (Array.isArray(type)) {
    return type.find((entry): entry is string => typeof entry === 'string' && entry !== 'null') ?? null
  }
  if (schema.properties && typeof schema.properties === 'object') return 'object'
  if (schema.items) return 'array'
  return null
}

function getObjectProperties(schema: JsonSchemaObject): Record<string, JsonSchemaObject> {
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

// ── GraphQL document builder ─────────────────────────────────────────────────

function renderGraphQLLiteral(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return `[${value.map((entry) => renderGraphQLLiteral(entry)).join(', ')}]`
  }
  if (value && typeof value === 'object') {
    return `{ ${Object.entries(value)
      .map(([key, entry]) => `${key}: ${renderGraphQLLiteral(entry)}`)
      .join(', ')} }`
  }
  return 'null'
}

function buildSelectionFromJsonSchema(schema: JsonSchemaObject, depth = 0): string {
  if (depth > 2) return ''
  const schemaType = getSchemaType(schema)

  if (schemaType === 'array') {
    const itemSchema = asJsonSchemaObject(schema.items)
    return itemSchema ? buildSelectionFromJsonSchema(itemSchema, depth + 1) : ''
  }
  if (schemaType !== 'object') return ''

  const properties = Object.entries(getObjectProperties(schema)).slice(0, 6)
  if (properties.length === 0) return ''

  const fields = properties.map(([key, propertySchema]) => {
    const nested = buildSelectionFromJsonSchema(propertySchema, depth + 1)
    return nested ? `${key} ${nested}` : key
  })
  return `{ ${fields.join(' ')} }`
}

export function buildGraphQLDocument(
  operation: RuntimeInspectionOperation,
  fieldName: string,
  mode: 'query' | 'mutation',
): string {
  const inputExample = createSchemaExample(operation.schema.input)
  const args = inputExample && typeof inputExample === 'object' && !Array.isArray(inputExample)
    ? Object.entries(inputExample as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${renderGraphQLLiteral(value)}`)
      .join(', ')
    : operation.schema.input.present
      ? `input: ${renderGraphQLLiteral(inputExample)}`
      : ''

  const outputSchema = getRootJsonSchema(operation.schema.output)
  const selection = outputSchema ? buildSelectionFromJsonSchema(outputSchema) : ''
  const renderedField = `${fieldName}${args ? `(${args})` : ''}${selection ? ` ${selection}` : ''}`
  return `${mode} Playground {\n  ${renderedField}\n}`
}

// ── Path parameter extraction ────────────────────────────────────────────────

export function extractPathParameters(pathname: string | undefined): string[] {
  if (!pathname) return []
  return pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1).replace(/[?*]+$/, ''))
}
