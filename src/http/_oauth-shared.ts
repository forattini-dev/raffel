/**
 * Shared OAuth2 / OIDC plumbing helpers.
 *
 * Internal utilities used by both `src/http/oauth2.ts` and
 * `src/http/oidc.ts`. Not exported from the public surface — these are
 * implementation details of the OAuth2/OIDC middlewares. The leading
 * underscore in the filename signals "private to http/".
 *
 * Extracted to collapse a 60-line duplication that fallow's clone
 * detector flagged as the highest-impact src-only duplication.
 */

import type { HttpContextInterface } from './context.js'

/**
 * Base64-encode a JSON-serialisable record. Used for the OAuth2 `state`
 * parameter so callers can round-trip `{ provider, returnUrl, ... }`.
 */
export function encodeStateData(data: Record<string, unknown>): string {
  return btoa(JSON.stringify(data))
}

/**
 * Decode a base64-encoded JSON state string. Returns `null` if the
 * string is malformed (so callers can reject invalid state safely).
 */
export function decodeStateData(state: string): Record<string, unknown> | null {
  try {
    return JSON.parse(atob(state))
  } catch {
    return null
  }
}

/**
 * Collapse repeated slashes and strip a trailing slash. Used when
 * composing a base path with login/callback/logout paths.
 */
export function normalizePath(path: string): string {
  return path.replace(/\/+/g, '/').replace(/\/$/, '')
}

/**
 * Build the absolute callback URL for a given provider, substituting
 * the `:provider` placeholder in the route pattern.
 */
export function buildCallbackUrl<E extends Record<string, unknown>>(
  c: HttpContextInterface<E>,
  callbackPath: string,
  providerName: string,
): string {
  const url = new URL(c.req.url)
  const path = callbackPath.replace(':provider', providerName)
  return `${url.protocol}//${url.host}${path}`
}
