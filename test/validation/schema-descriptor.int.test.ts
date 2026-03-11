import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  SCHEMA_DESCRIPTOR_VERSION,
  normalizeSchemaDescriptor,
} from '../../src/validation/index.js'

describe('normalizeSchemaDescriptor', () => {
  it('normalizes zod schemas into the canonical descriptor', () => {
    const descriptor = normalizeSchemaDescriptor(
      z.object({
        id: z.string(),
        active: z.boolean().optional(),
      })
    )

    expect(descriptor.version).toBe(SCHEMA_DESCRIPTOR_VERSION)
    expect(descriptor.source).toBe('zod-to-json-schema')
    expect(descriptor.diagnostics).toEqual([])
    expect(descriptor.jsonSchema.type).toBe('object')
  })

  it('returns an opaque fallback with explicit diagnostics when normalization fails', () => {
    const descriptor = normalizeSchemaDescriptor({ unsupported: true })

    expect(descriptor.version).toBe(SCHEMA_DESCRIPTOR_VERSION)
    expect(descriptor.source).toBe('opaque')
    expect(descriptor.jsonSchema['x-raffel-opaque']).toBe(true)
    expect(Array.isArray(descriptor.jsonSchema['x-raffel-diagnostics'])).toBe(true)
    expect(descriptor.diagnostics[0]?.code).toBe('UNSUPPORTED_SCHEMA')
  })
})
