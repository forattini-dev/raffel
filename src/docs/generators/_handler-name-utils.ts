/**
 * Handler Name Utilities
 *
 * Shared helpers for the generator modules — sanitise a handler name
 * for use as a code identifier, extract a default tag list. Used by
 * tcp-generator and udp-generator (and ready for any future generator
 * with the same conventions).
 */

/**
 * Convert a dotted/dashed handler name into PascalCase suitable for use
 * as a generated type or schema name.
 */
export function sanitizeName(name: string): string {
  return name
    .replace(/\./g, '_')
    .replace(/-/g, '_')
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('')
}

/**
 * Extract a default-tag list from a handler name. Uses the segment
 * before the first `.` (or `-`/`_`) as the tag; returns an empty array
 * if the name has no separators.
 */
export function extractTags(name: string): string[] {
  const parts = name.split('.')
  if (parts.length > 1) {
    return [parts[0]]
  }
  const segments = name.split(/[-_]/)
  if (segments.length > 1) {
    return [segments[0]]
  }
  return []
}
