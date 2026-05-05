import { generateSchemaExample, type SchemaExampleOptions } from '../../utils/schema-examples.js'
import type { USDSchema } from '../../usd/index.js'

const DOCS_EXAMPLE_DEFAULTS: SchemaExampleOptions = {
  maxOptionalProperties: 3,
  uniqueValues: false,
}

export function generateExampleFromSchema(
  schema: USDSchema | Record<string, unknown> | undefined,
  options: SchemaExampleOptions = DOCS_EXAMPLE_DEFAULTS
): unknown {
  if (!schema) return {}
  return generateSchemaExample(schema as Record<string, unknown>, options)
}
