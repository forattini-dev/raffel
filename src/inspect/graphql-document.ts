/**
 * Inspect — GraphQL Document Builder
 *
 * Builds a runnable GraphQL operation string (query/mutation) for a
 * runtime inspection operation, with sample arguments and a selection
 * set inferred from the operation's input/output schemas.
 *
 * Extracted from schema-samples.ts (fallow split target) — GraphQL
 * document concerns are distinct from generic schema sample APIs.
 */

import type { RuntimeInspectionOperation } from './types.js'
import {
  createSchemaExample,
  asJsonSchemaObject,
  getRootJsonSchema,
  getSchemaType,
  getObjectProperties,
  type JsonSchemaObject,
} from './schema-samples.js'

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
