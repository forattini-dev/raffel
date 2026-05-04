/**
 * Server Path Utilities
 *
 * Pure path/string helpers shared across the server layer. Extracted from
 * channel-utils.ts (which previously bundled this generic utility together
 * with channel-specific logic) to give path-only consumers a focused
 * import target.
 */

/**
 * Join a base path with a relative path. Handles trailing/leading slash
 * normalization and treats `'/'` and the empty string as no-op prefixes.
 */
export function joinBasePath(prefix: string, path: string): string {
  if (!prefix || prefix === '/') {
    return path
  }

  const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}
