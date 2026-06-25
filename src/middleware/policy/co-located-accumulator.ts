/**
 * Co-located policy accumulator (1.1.60+, fix for the 1.1.58 N-copy
 * leak described in `coverage-gaps.int.test.ts > bug A`).
 *
 * Background: when a cascade `_policy.yaml` is shared by N routes
 * under the discovery tree, the previous implementation materialised
 * one policy copy per route and called `engine.addPolicies()` per
 * route. The engine dedupes by id (the deterministic `co:<hash>:<id>`
 * is the same across all calls), but the `scope.routes = [routeName]`
 * differed per call. The engine's `addPolicies` REPLACES in place, so
 * only the LAST route's scope survived. Other routes had no policy
 * attached at all. The fix is to never call `engine.addPolicies()`
 * from the per-route path; instead, accumulate `(source, index) →
 * Set<routeName>` across the load and flush ONCE with the union of
 * routes in `scope.routes`.
 *
 * The accumulator is stateful and per-bootstrap (per server). Hot
 * reload calls `reset()` to drop the previous load's accumulation
 * before the next flush.
 */

import { createHash } from 'node:crypto'
import type { LoggerPort } from '../../ports/outbound/logger.js'
import type { PolicyEnginePort } from '../../ports/outbound/policy-engine.js'
import type { Policy, PolicyCondition } from './types.js'

/**
 * The raw shape an accumulator entry remembers. We keep the original
 * JSON policy (post-`_meta` merge from the loader) and resolve the
 * `customCondition` string to a function once at `add()` time — that
 * way the `add()` call site doesn't need to know how to materialise
 * the function. The flush step is pure policy construction + engine
 * commit.
 */
interface AccumulatorEntry {
  /** Absolute path of the policy file (`policy._source`). */
  source: string
  /** Index of the policy within the file (`policy._index`). */
  index: number
  /** Original JSON policy after `_meta` merge; mutable during entry. */
  raw: Record<string, unknown>
  /** Resolved customCondition function if any. */
  condition?: PolicyCondition
  /** Match DSL if any. */
  match?: unknown
  /** Route names this policy was attached to during the current load. */
  routes: Set<string>
  /**
   * Whether the accumulator should fill `scope.routes` from the
   * collected route names. `false` for protocol-bound surfaces
   * (GraphQL, WebSocket channels) where the engine action is
   * independent of the route name.
   */
  applyRouteScope: boolean
}

export interface CoLocatedAccumulator {
  /**
   * Record that `routeName` is covered by `rawPolicy` (the
   * post-`_meta`-merge JSON policy, with `_source` and `_index`
   * populated by the loader). The optional `condition` is the
   * resolved `customCondition` function — the accumulator does not
   * resolve it itself because the lookup table lives on the
   * bootstrap.
   *
   * `applyRouteScope` (default `true`) controls whether the
   * accumulator fills `scope.routes` with the union of route
   * names it sees. Set `false` for protocol-bound surfaces
   * (GraphQL, WebSocket channels) where the engine action is
   * something other than the route name — for those, scope.routes
   * would be the wrong dimension to constrain on.
   */
  add(
    rawPolicy: unknown,
    routeName: string,
    condition?: PolicyCondition,
    applyRouteScope?: boolean,
  ): void
  /**
   * Commit the accumulated policies to the engine. Each
   * `(source, index)` produces ONE policy with `scope.routes` set to
   * the union of every route that referenced it (unless the entry
   * was added with `applyRouteScope: false`). Returns the number of
   * distinct policies materialised.
   */
  flush(): { materialised: number }
  /**
   * Drop the accumulated state without touching the engine. Called
   * at the top of a hot reload so the next flush reflects only the
   * routes that survived the reload.
   */
  reset(): void
}

export interface CreateCoLocatedAccumulatorOptions {
  engine: PolicyEnginePort
  flushLogger: LoggerPort
}

/**
 * Build a deterministic policy id for a co-located policy. Same
 * `(source, index)` always produces the same id, so duplicates from
 * N routes under the same cascade collapse into one engine entry.
 */
function policySourceKey(source: string, index: number): string {
  return createHash('sha1').update(`${source}:${index}`).digest('hex').slice(0, 12)
}

/**
 * Materialise the accumulated policy. Scope semantics:
 *   - `scope.routes` is an EXPLICIT user filter when the YAML sets it
 *     — kept as-is, the accumulator does NOT widen it. Otherwise the
 *     accumulator fills it in with the union of routes that referenced
 *     this (source, index) — that's the per-route gating the engine
 *     uses when there is no user scope.
 *   - `scope.channels` and `scope.protocols` are always taken from
 *     the user. The accumulator does not track channels or protocols.
 */
function materialiseAccumulatedPolicy(
  entry: AccumulatorEntry,
  allRoutes: Set<string>,
  applyRouteScope: boolean,
): Policy {
  const raw = entry.raw
  const existingScope = (raw.scope as Record<string, unknown> | undefined) ?? {}
  const userRoutes = Array.isArray(existingScope.routes) ? (existingScope.routes as string[]) : null
  const userChannels = Array.isArray(existingScope.channels)
    ? (existingScope.channels as string[])
    : null
  const userProtocols = Array.isArray(existingScope.protocols)
    ? (existingScope.protocols as string[])
    : null

  const finalScope: { routes?: string[]; channels?: string[]; protocols?: string[] } = {}
  if (userRoutes) finalScope.routes = userRoutes
  else if (applyRouteScope && allRoutes.size > 0) finalScope.routes = Array.from(allRoutes).sort()
  if (userChannels) finalScope.channels = userChannels
  if (userProtocols) finalScope.protocols = userProtocols

  const {
    customCondition: _dropCustomCondition,
    match: _dropMatch,
    _source: _dropSource,
    _index: _dropIndex,
    _meta: auditMeta,
    scope: _dropScope,
    ...rest
  } = raw

  return {
    ...(rest as unknown as Omit<Policy, 'scope' | 'condition' | 'match' | '_source' | '_index' | '_meta'>),
    ...(entry.condition ? { condition: entry.condition } : {}),
    ...(entry.match ? { match: entry.match as Policy['match'] } : {}),
    ...(Object.keys(finalScope).length > 0 ? { scope: finalScope } : {}),
    // Preserve the audit metadata the loader merged onto the policy
    // (file-level `_meta` + per-policy override) so it surfaces through
    // `server.policy.list()` and `policyCoverage()`.
    ...(auditMeta && typeof auditMeta === 'object' ? { _meta: auditMeta as Policy['_meta'] } : {}),
    _source: entry.source,
    _index: entry.index,
    id: `co:${policySourceKey(entry.source, entry.index)}:${raw.id as string}`,
  } as Policy
}

export function createCoLocatedAccumulator(
  options: CreateCoLocatedAccumulatorOptions,
): CoLocatedAccumulator {
  const { engine, flushLogger } = options
  // Per-call entries are stored under a composite key of (source,
  // index) so two policies from the same file with different indices
  // don't collide. Using a Map (not a Set) because the accumulator
  // needs to mutate the existing entry on subsequent `add()` calls.
  const entries = new Map<string, AccumulatorEntry>()

  function keyFor(raw: { _source?: string; _index?: number }): string {
    return `${raw._source ?? 'inline'}:${raw._index ?? 0}`
  }

  return {
    add(
      rawPolicy: unknown,
      routeName: string,
      condition?: PolicyCondition,
      applyRouteScope: boolean = true,
    ) {
      if (rawPolicy === null || typeof rawPolicy !== 'object') return
      const raw = rawPolicy as Record<string, unknown> & {
        _source?: string
        _index?: number
      }
      const key = keyFor(raw)
      let entry = entries.get(key)
      if (!entry) {
        entry = {
          source: raw._source ?? 'inline',
          index: raw._index ?? 0,
          raw: { ...raw },
          condition,
          match: raw.match,
          routes: new Set(),
          applyRouteScope,
        }
        entries.set(key, entry)
      } else {
        // Subsequent add() calls for the same (source, index) extend
        // the route set. If the caller passes a different condition
        // function we keep the first one (it should be the same across
        // all routes by construction).
        if (condition && !entry.condition) entry.condition = condition
        // Once any caller declared `applyRouteScope: false` we keep
        // that — the protocol-bound caller wins, the procedure-bound
        // caller's `true` is a no-op.
        if (!applyRouteScope) entry.applyRouteScope = false
      }
      entry.routes.add(routeName)
    },

    flush() {
      if (entries.size === 0) return { materialised: 0 }
      // Materialise every entry. Each entry is keyed by (source,
      // index), so it maps to exactly one engine policy with a
      // deterministic `co:<hash(source,index)>:<id>` id. Two routes
      // sharing the same cascade `_policy.yaml` produce a single
      // entry — that's the N-copy fix. Nearest-wins across same-id
      // policies in different files is already resolved per route in
      // `addCoLocatedPoliciesToEngine` before `add()` is called, so
      // there's no global dedup to do here: unrelated sibling files
      // that happen to share an `id` map to distinct (source, index)
      // keys and stay separate.
      const deduped: Policy[] = []
      for (const entry of entries.values()) {
        deduped.push(
          materialiseAccumulatedPolicy(entry, entry.routes, entry.applyRouteScope),
        )
      }
      if (typeof engine.addPolicies === 'function') {
        engine.addPolicies(deduped)
      } else {
        flushLogger.warn(
          { count: deduped.length },
          'co-located policy accumulator: engine has no addPolicies(); skipping flush',
        )
      }
      return { materialised: deduped.length }
    },

    reset() {
      entries.clear()
    },
  }
}
