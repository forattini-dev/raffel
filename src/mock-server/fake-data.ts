/**
 * Mock Server — Fake Data (delegates to shared schema-examples)
 *
 * Re-exports the unified generator with mock-server defaults:
 * - uniqueValues: true (counter-based unique emails, uuids, uris)
 * - maxOptionalProperties: Infinity (generate ALL properties for complete mocks)
 */

import {
  generateSchemaExample,
  resetExampleCounter,
  type SchemaExampleOptions,
} from '../utils/schema-examples.js'

export { resetExampleCounter as resetFakeDataCounter } from '../utils/schema-examples.js'

const MOCK_SERVER_DEFAULTS: SchemaExampleOptions = {
  uniqueValues: true,
  maxOptionalProperties: Infinity,
}

/**
 * Generate fake data from a JSON Schema with mock-server defaults.
 * Counter-based unique values, all properties generated.
 */
export function generateFromSchema(schema: Record<string, unknown>): unknown {
  return generateSchemaExample(schema, MOCK_SERVER_DEFAULTS)
}
