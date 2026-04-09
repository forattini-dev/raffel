/**
 * Shared JSON Schema utilities.
 *
 * Used by both the validation descriptor pipeline and the MCP protocol engine.
 */

/**
 * Strip `$schema` and recursively clean nested objects/arrays.
 */
export function cleanJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue
    if (Array.isArray(value)) {
      result[key] = value.map((entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? cleanJsonSchema(entry as Record<string, unknown>)
          : entry
      )
    } else if (value && typeof value === 'object') {
      result[key] = cleanJsonSchema(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}
