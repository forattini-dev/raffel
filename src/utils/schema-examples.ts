/**
 * Schema Example Generator — single source of truth
 *
 * Generates plausible data from JSON Schema. Zero external dependencies.
 * Used by: mock-server, inspect (contracts/playground), docs (code-samples).
 *
 * Options allow callers to tune behavior for their use case:
 * - mock-server: all properties, unique values (counter), constraint-aware
 * - inspect: required + 3 optional, static values, depth limit 4
 * - code-samples: required + 3 optional, static values
 */

// ── Options ──────────────────────────────────────────────────────────────────

export interface SchemaExampleOptions {
  /** Max recursion depth. Default: 10 */
  maxDepth?: number
  /**
   * Max optional properties to generate beyond required ones.
   * Use Infinity (default) to generate all properties.
   */
  maxOptionalProperties?: number
  /**
   * Use incrementing counter for unique values (emails, uuids, uris).
   * Default: false (static values).
   */
  uniqueValues?: boolean
}

// ── Counter ──────────────────────────────────────────────────────────────────

let counter = 0

/** Reset the internal counter. Useful for deterministic tests. */
export function resetExampleCounter(): void {
  counter = 0
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Generate example data from a JSON Schema.
 *
 * Priority: schema.example > schema.default > const > enum > format-aware generation.
 */
export function generateSchemaExample(
  schema: Record<string, unknown> | null | undefined,
  options: SchemaExampleOptions = {},
): unknown {
  if (schema == null || typeof schema !== 'object') return null
  return generate(schema, options, 0)
}

/**
 * Generate a type-mismatched invalid example (for contract testing).
 * Returns a value whose type is wrong for the schema.
 */
export function generateSchemaInvalidExample(
  schema: Record<string, unknown> | null | undefined,
): unknown {
  if (schema == null || typeof schema !== 'object') return null
  return generateInvalid(schema)
}

// ── Core recursive generator ─────────────────────────────────────────────────

function generate(
  schema: Record<string, unknown>,
  opts: SchemaExampleOptions,
  depth: number,
): unknown {
  const maxDepth = opts.maxDepth ?? 10
  if (depth > maxDepth) return {}

  // Direct example or default
  if ('example' in schema && schema.example !== undefined) return schema.example
  if ('default' in schema && schema.default !== undefined) return schema.default

  // Const
  if ('const' in schema) return schema.const

  // Enum — pick first value
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]

  // $ref — can't resolve without registry
  if (schema.$ref) return {}

  // oneOf / anyOf — use first option
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const variant = asObj(schema.oneOf[0])
    return variant ? generate(variant, opts, depth + 1) : {}
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const variant = asObj(schema.anyOf[0])
    return variant ? generate(variant, opts, depth + 1) : {}
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
    return generate(merged, opts, depth)
  }

  const resolvedType = resolveType(schema)

  switch (resolvedType) {
    case 'string':
      return generateString(schema, opts)
    case 'number':
      return generateNumber(schema)
    case 'integer':
      return Math.floor(generateNumber(schema))
    case 'boolean':
      return true
    case 'array':
      return generateArray(schema, opts, depth)
    case 'object':
      return generateObject(schema, opts, depth)
    case 'null':
      return null
    default:
      // Infer from structure
      if (schema.properties) return generateObject(schema, opts, depth)
      if (schema.items) return generateArray(schema, opts, depth)
      return null
  }
}

// ── Type resolution ──────────────────────────────────────────────────────────

function resolveType(schema: Record<string, unknown>): string | null {
  const type = schema.type as string | string[] | undefined
  if (Array.isArray(type)) {
    return type.find(t => t !== 'null') ?? type[0] ?? null
  }
  return type ?? null
}

function asObj(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

// ── String generation ────────────────────────────────────────────────────────

function generateString(schema: Record<string, unknown>, opts: SchemaExampleOptions): string {
  const format = schema.format as string | undefined
  const n = opts.uniqueValues ? ++counter : 1

  switch (format) {
    case 'email':
      return opts.uniqueValues ? `user${n}@example.com` : 'user@example.com'
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
      return opts.uniqueValues ? `https://example.com/resource/${n}` : 'https://example.com'
    case 'ipv4':
      return '192.168.1.1'
    case 'ipv6':
      return '::1'
    case 'hostname':
      return 'host.example.com'
    case 'binary':
    case 'byte':
      return 'dGVzdA=='
    case 'password':
      return '********'
    default: {
      const minLen = (schema.minLength as number) ?? 0
      const maxLen = (schema.maxLength as number) ?? 0
      if (minLen > 0 || maxLen > 0) {
        const len = maxLen > 0 ? Math.min(maxLen, Math.max(minLen, 5)) : Math.max(minLen, 5)
        return 'x'.repeat(len)
      }
      return 'string'
    }
  }
}

// ── Number generation ────────────────────────────────────────────────────────

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

// ── Array generation ─────────────────────────────────────────────────────────

function generateArray(
  schema: Record<string, unknown>,
  opts: SchemaExampleOptions,
  depth: number,
): unknown[] {
  const items = asObj(schema.items)
  const minItems = (schema.minItems as number) ?? 1
  const maxItems = (schema.maxItems as number) ?? Math.max(minItems, 2)
  const count = Math.min(maxItems, Math.max(minItems, 1))

  if (!items) return Array.from({ length: count }, () => null)
  return Array.from({ length: count }, () => generate(items, opts, depth + 1))
}

// ── Object generation ────────────────────────────────────────────────────────

function generateObject(
  schema: Record<string, unknown>,
  opts: SchemaExampleOptions,
  depth: number,
): Record<string, unknown> {
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
  const result: Record<string, unknown> = {}

  if (!properties) {
    const addlProps = schema.additionalProperties
    if (typeof addlProps === 'object' && addlProps !== null) {
      result['key1'] = generate(addlProps as Record<string, unknown>, opts, depth + 1)
    }
    return result
  }

  const required = new Set<string>(
    Array.isArray(schema.required)
      ? (schema.required as string[]).filter(s => typeof s === 'string')
      : [],
  )

  const maxOptional = opts.maxOptionalProperties ?? Infinity
  let optionalCount = 0

  for (const [key, propSchema] of Object.entries(properties)) {
    const isRequired = required.has(key)

    if (!isRequired) {
      if (optionalCount >= maxOptional) continue
      optionalCount++
    }

    result[key] = generate(propSchema, opts, depth + 1)
  }

  return result
}

// ── Invalid example generator ────────────────────────────────────────────────

function generateInvalid(schema: Record<string, unknown>): unknown {
  const type = resolveType(schema)
  switch (type) {
    case 'string': return 123
    case 'integer':
    case 'number': return 'not-a-number'
    case 'boolean': return 'not-a-boolean'
    case 'array': return { invalid: true }
    case 'object': return '__invalid__'
    default: return null
  }
}
