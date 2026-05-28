/**
 * Schema Sync Guard
 *
 * `src/middleware/policy/schema.json` (the declarative source) and
 * `src/middleware/policy/schema.ts` (the runtime import) must encode the
 * same JSON Schema. This test fails if they ever drift.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { policySchema } from '../../src/middleware/policy/schema.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCHEMA_JSON_PATH = join(
  __dirname,
  '..',
  '..',
  'src',
  'middleware',
  'policy',
  'schema.json',
)

describe('policy schema: schema.json ↔ schema.ts', () => {
  it('both files encode the same JSON Schema', () => {
    const fromJson = JSON.parse(readFileSync(SCHEMA_JSON_PATH, 'utf-8'))
    // `policySchema` is `as const`, so the structural compare needs JSON
    // round-trip to strip readonly markers TypeScript adds.
    const fromTs = JSON.parse(JSON.stringify(policySchema))
    expect(fromTs).toEqual(fromJson)
  })
})
