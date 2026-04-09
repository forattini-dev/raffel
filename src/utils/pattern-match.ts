/**
 * Procedure pattern matching utility.
 * Converts glob patterns to regex for matching dot-separated procedure names.
 * Supports `*` (single segment) and `**` (any segments).
 */

const regexCache = new Map<string, RegExp>()

/**
 * Convert a procedure glob pattern to a RegExp.
 */
export function procedurePatternToRegex(pattern: string): RegExp {
  const cached = regexCache.get(pattern)
  if (cached) return cached

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '{{DOUBLE_STAR}}')
    .replace(/\*/g, '[^.]*')
    .replace(/{{DOUBLE_STAR}}/g, '.*')

  const regex = new RegExp(`^${escaped}$`)
  regexCache.set(pattern, regex)
  return regex
}

/**
 * Test whether a procedure name matches a glob pattern.
 */
export function matchProcedurePattern(pattern: string, procedure: string): boolean {
  return procedurePatternToRegex(pattern).test(procedure)
}
