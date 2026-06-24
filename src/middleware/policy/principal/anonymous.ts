/**
 * Shared anonymous principal used by all default principal resolvers when the
 * request has no authenticated identity (no auth interceptor ran, or the
 * session has no logged-in user).
 *
 * Returning this instead of throwing prevents a co-located policy on a
 * `meta.auth: 'none'` route (e.g. `/health/live`) from crashing the request
 * with HTTP 500 — see the regression fixed alongside this constant.
 *
 * Authors that want to forbid anonymous access on a route must either:
 *   - set `meta.auth: 'required'` so an auth interceptor runs first, or
 *   - declare an explicit `defaultMode: 'deny'` policy that does not include
 *     `'*'` (or this principal) in its `principals` allow list.
 *
 * Note: the engine compiles every principal set with the wildcard `'*'`
 * (see `engine/compile.ts`), so any `principals: ['*']` policy — including
 * co-located folder cascades — will match anonymous requests. Use explicit
 * `principals` patterns or `public: true` on the co-located policy to opt
 * anonymous traffic out.
 *
 * The principal MUST NOT be deeply frozen — the engine caches
 * `_compiledSet` on it during evaluation, which would throw under
 * `Object.freeze`. We freeze only the inner `attrs` object so callers cannot
 * accidentally mutate the anonymous marker; the `scopes` and `groups` arrays
 * stay mutable to match the `Principal` interface and avoid TS readonly
 * friction — nothing in the engine mutates them.
 */
import type { Principal } from '../types.js'

export const ANONYMOUS_PRINCIPAL: Principal = {
  id: 'anonymous',
  tenantId: null,
  scopes: [],
  groups: [],
  attrs: Object.freeze({ anonymous: true }),
}

export function isAnonymousPrincipal(principal: Principal | undefined | null): boolean {
  return principal?.id === ANONYMOUS_PRINCIPAL.id
}
