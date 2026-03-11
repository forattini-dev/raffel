/**
 * Mock Server — Fake Data Generator
 *
 * Generates plausible data from JSON Schema. Zero external dependencies.
 * Deterministic output: uses counters and fixed values for predictable results.
 */

let counter = 0

/** Reset internal counter (for testing) */
export function resetFakeDataCounter(): void {
  counter = 0
}

/**
 * Generate fake data from a JSON Schema.
 *
 * Priority: schema.example > schema.default > enum (first value) > format-aware generation.
 */
export function generateFromSchema(schema: Record<string, unknown>): unknown {
  if (schema == null || typeof schema !== 'object') return null

  // Direct example or default
  if ('example' in schema && schema.example !== undefined) return schema.example
  if ('default' in schema && schema.default !== undefined) return schema.default

  // Const
  if ('const' in schema) return schema.const

  // Enum — pick first value
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]

  // oneOf / anyOf — use first option
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return generateFromSchema(schema.oneOf[0] as Record<string, unknown>)
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return generateFromSchema(schema.anyOf[0] as Record<string, unknown>)
  }

  // allOf — merge all schemas and generate
  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const merged: Record<string, unknown> = { type: 'object' }
    const mergedProps: Record<string, unknown> = {}
    const mergedRequired: string[] = []
    for (const sub of schema.allOf) {
      const s = sub as Record<string, unknown>
      if (s.properties) Object.assign(mergedProps, s.properties)
      if (Array.isArray(s.required)) mergedRequired.push(...(s.required as string[]))
      if (s.type) merged.type = s.type
    }
    merged.properties = mergedProps
    if (mergedRequired.length > 0) merged.required = mergedRequired
    return generateFromSchema(merged)
  }

  const type = schema.type as string | string[] | undefined

  // Handle type arrays (e.g. ["string", "null"])
  const resolvedType = Array.isArray(type)
    ? type.find(t => t !== 'null') ?? type[0]
    : type

  switch (resolvedType) {
    case 'string':
      return generateString(schema)
    case 'number':
      return generateNumber(schema)
    case 'integer':
      return generateInteger(schema)
    case 'boolean':
      return true
    case 'array':
      return generateArray(schema)
    case 'object':
      return generateObject(schema)
    case 'null':
      return null
    default:
      // No type specified — try to infer from properties
      if (schema.properties) return generateObject(schema)
      if (schema.items) return generateArray(schema)
      return null
  }
}

// ── String generation ──────────────────────────────────────────────────────────

function generateString(schema: Record<string, unknown>): string {
  const format = schema.format as string | undefined
  const n = ++counter

  switch (format) {
    case 'email':
      return `user${n}@example.com`
    case 'uuid':
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    case 'date':
      return '2024-01-15'
    case 'date-time':
      return '2024-01-15T09:30:00Z'
    case 'time':
      return '09:30:00Z'
    case 'uri':
    case 'url':
      return `https://example.com/resource/${n}`
    case 'ipv4':
      return '192.168.1.1'
    case 'ipv6':
      return '::1'
    case 'hostname':
      return 'host.example.com'
    case 'binary':
    case 'byte':
      return 'dGVzdA==' // base64 "test"
    case 'password':
      return '********'
    default: {
      // Respect minLength/maxLength
      const minLen = (schema.minLength as number) ?? 0
      const maxLen = (schema.maxLength as number) ?? 0
      if (minLen > 0 || maxLen > 0) {
        const len = maxLen > 0 ? Math.min(maxLen, Math.max(minLen, 5)) : Math.max(minLen, 5)
        return 'x'.repeat(len)
      }
      return `string`
    }
  }
}

// ── Number generation ──────────────────────────────────────────────────────────

function generateNumber(schema: Record<string, unknown>): number {
  const min = (schema.minimum as number) ?? (schema.exclusiveMinimum as number) ?? undefined
  const max = (schema.maximum as number) ?? (schema.exclusiveMaximum as number) ?? undefined
  const multipleOf = schema.multipleOf as number | undefined

  if (min !== undefined && max !== undefined) {
    const mid = (min + max) / 2
    if (multipleOf) return Math.round(mid / multipleOf) * multipleOf
    return Math.round(mid * 100) / 100
  }
  if (min !== undefined) {
    const val = min + 1
    if (multipleOf) return Math.ceil(val / multipleOf) * multipleOf
    return val
  }
  if (max !== undefined) {
    const val = max - 1
    if (multipleOf) return Math.floor(val / multipleOf) * multipleOf
    return val
  }
  if (multipleOf) return multipleOf

  return 0
}

function generateInteger(schema: Record<string, unknown>): number {
  return Math.floor(generateNumber(schema))
}

// ── Array generation ───────────────────────────────────────────────────────────

function generateArray(schema: Record<string, unknown>): unknown[] {
  const items = schema.items as Record<string, unknown> | undefined
  const minItems = (schema.minItems as number) ?? 1
  const maxItems = (schema.maxItems as number) ?? Math.max(minItems, 2)
  const count = Math.min(maxItems, Math.max(minItems, 1))

  if (!items) return Array.from({ length: count }, () => null)
  return Array.from({ length: count }, () => generateFromSchema(items))
}

// ── Object generation ──────────────────────────────────────────────────────────

function generateObject(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
  const required = schema.required as string[] | undefined
  const result: Record<string, unknown> = {}

  if (!properties) {
    // additionalProperties with schema
    const addlProps = schema.additionalProperties
    if (typeof addlProps === 'object' && addlProps !== null) {
      result['key1'] = generateFromSchema(addlProps as Record<string, unknown>)
    }
    return result
  }

  for (const [key, propSchema] of Object.entries(properties)) {
    // Generate all properties (not just required) for a complete mock
    result[key] = generateFromSchema(propSchema)
  }

  return result
}
