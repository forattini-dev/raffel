/**
 * Inspect — Path Parameter Extraction
 *
 * Extracted from schema-samples.ts (slice of fallow split target):
 * URL path concerns are unrelated to schema sampling and don't need
 * the same dependency footprint.
 */

/**
 * Extract `:param` placeholders from a path. Strips trailing `?` and `*`
 * modifiers (optional / wildcard) so the returned array contains plain
 * parameter names.
 *
 * @example
 * ```ts
 * extractPathParameters('/users/:id/posts/:slug?')
 * // → ['id', 'slug']
 * ```
 */
export function extractPathParameters(pathname: string | undefined): string[] {
  if (!pathname) return []
  return pathname
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => {
      let end = segment.length
      while (end > 1 && (segment[end - 1] === '?' || segment[end - 1] === '*')) end -= 1
      return segment.slice(1, end)
    })
}
