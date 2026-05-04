/**
 * Policy Engine Types
 *
 * Core types for the opt-in authorization module.
 * Inspired by github.com/filipeforattini/policy-engine — vendored, adapted to Raffel.
 *
 * Naming: avoid collision with `src/types/policies.ts` (`Contract*Policy` — runtime
 * metadata: timeout, rate-limit, auth-required). These types describe *authorization*
 * decisions ("is this principal allowed to do X to Y?").
 */

import type { LoggerPort } from '../../ports/outbound/logger.js'

// ============================================================================
// Domain
// ============================================================================

/**
 * The actor whose request is being authorized.
 *
 * `tenantId: null` denotes a *platform* principal that crosses tenants.
 */
export interface Principal {
  id: string
  tenantId: string | null
  scopes: string[]
  groups: string[]
  attrs?: Record<string, unknown>
  /** @internal Cached compiled string set (set lazily by the engine). */
  _compiledSet?: readonly string[]
}

/**
 * The thing the principal wants to act on.
 *
 * `tenantId: null` denotes a *global* resource (any tenant may access).
 */
export interface Resource {
  type: string
  id: string
  tenantId: string | null
  attrs?: Record<string, unknown>
}

/**
 * Per-request data the engine can read via `match` paths (`context.<key>`)
 * or that handler-side `condition` functions may use.
 */
export type EvalContext = Record<string, unknown>

/**
 * Input passed to `engine.evaluate`.
 */
export interface AuthzInput {
  principal: Principal
  action: string
  resource: Resource
  context?: EvalContext
}

// ============================================================================
// Policy
// ============================================================================

export type PolicyEffect = 'allow' | 'deny' | 'audit'

/**
 * A `condition` function is the imperative escape hatch — receives the full
 * input and returns whether the policy matches.
 *
 * If a `condition` throws, the engine treats the policy as a non-match and
 * logs the error. It NEVER produces a 500 response.
 */
export type PolicyCondition = (input: AuthzInput) => boolean

/**
 * Inline (TS) policy. Either `condition` or `match` (from `JsonPolicy`) may be
 * present, not both. A policy with neither relies solely on the pattern arrays.
 */
export interface Policy {
  id: string
  description?: string
  effect: PolicyEffect
  /** Glob patterns matched against the compiled principal set. */
  principals: string[]
  /** Glob patterns matched against the action string. */
  actions: string[]
  /** Glob patterns matched against `${resource.type}:${resource.id}`. */
  resources: string[]
  condition?: PolicyCondition
  /**
   * Declarative match DSL — alternative to `condition`. When both are present,
   * BOTH must pass (implicit AND).
   */
  match?: MatchNode
  /** @internal Source path — populated by the loader for diagnostics. */
  _source?: string
  /** @internal Index within source — populated by the loader. */
  _index?: number
  /** @internal Pre-compiled patterns (populated at startup). */
  _compiled?: CompiledPolicyPatterns
  /** @internal Pre-compiled match DSL predicate. */
  _compiledMatch?: (input: AuthzInput) => boolean
}

/**
 * Pre-compiled regex form of a policy's pattern arrays. Built once at startup.
 */
export interface CompiledPolicyPatterns {
  principals: readonly RegExp[]
  actions: readonly RegExp[]
  resources: readonly RegExp[]
}

/**
 * JSON-loadable policy. Same as `Policy` but `condition` is replaced by
 * `customCondition: string` (lookup into a TS-side registry).
 */
export type JsonPolicy = Omit<Policy, 'condition' | '_compiled' | '_compiledMatch'> & {
  customCondition?: string
}

// ============================================================================
// Match DSL
// ============================================================================

/**
 * Literal value comparison. `null` means strict null check. `'*'` is a no-op
 * placeholder used to document intent ("any value passes").
 *
 * Strings prefixed `@` are *path references* — resolved at eval time against
 * the input (e.g. `@principal.id`).
 *
 * Strings prefixed `!` negate the comparison (`!archived`, `!@principal.id`).
 */
export type MatchLiteral = string | number | boolean | null

/**
 * Operator object. Use when richer comparison than equality is needed.
 */
export interface MatchOperator {
  '=='?: MatchLiteral
  '!='?: MatchLiteral
  '<'?: number | string
  '<='?: number | string
  '>'?: number | string
  '>='?: number | string
  in?: readonly MatchLiteral[] | string
  notIn?: readonly MatchLiteral[] | string
  regex?: string
  startsWith?: string
  endsWith?: string
  contains?: MatchLiteral
  exists?: boolean
}

export type MatchValue = MatchLiteral | MatchOperator

/**
 * A match node is either:
 *  - a path → value map (implicit `allOf`),
 *  - an `anyOf` / `allOf` / `not` boolean composition.
 *
 * Reserved keys on the path map: `anyOf`, `allOf`, `not` cannot be paths.
 */
export type MatchNode =
  | { anyOf: MatchNode[] }
  | { allOf: MatchNode[] }
  | { not: MatchNode }
  | { [path: string]: MatchValue | MatchNode | MatchNode[] }

// ============================================================================
// Decision
// ============================================================================

export type DecisionReason =
  | 'allow'
  | 'explicit_deny'
  | 'implicit_deny'
  | 'tenant_mismatch'

export interface CandidatePolicy {
  id: string
  description?: string
  effect: PolicyEffect
  /** Patterns that *would* have matched (the partial match prefix). */
  requiredPrincipals: string[]
  /** What the principal lacks for this policy to fully match. */
  missing: string[]
}

export interface Decision {
  allowed: boolean
  reason: DecisionReason
  matchedPolicyIds: string[]
  auditedPolicyIds: string[]
  candidatePolicies: CandidatePolicy[]
  /** Wall-clock duration of this evaluation, in milliseconds. */
  durationMs?: number
}

// ============================================================================
// Configuration
// ============================================================================

/**
 * Where the engine should read the principal from.
 *
 * - `'session'`: reads `ctx.session.data.user` (requires session module enabled).
 * - `'oauth2'` / `'oidc'`: reads JWT claims set by the auth interceptor.
 * - `'custom'`: caller supplies `map` to derive from `ctx`.
 */
export type PrincipalSource = 'session' | 'oauth2' | 'oidc' | 'custom'

export interface PrincipalConfig {
  from: PrincipalSource
  /** Override / supply the mapping to `Principal`. Required for `from: 'custom'`. */
  map?: (raw: unknown, ctx: unknown) => Principal | Promise<Principal>
}

/**
 * Per-server policy configuration. Pass on `createServer({ policy: {...} })`.
 *
 * The module is fully tree-shakeable: omit this field and zero engine code is
 * loaded.
 */
export interface PolicyConfig {
  /** Inline (TS) policies. Merged with `loadFromDir` (JSON wins on id). */
  policies?: readonly Policy[]
  /** Filesystem directory to scan for `*.json` policies (Node only). */
  loadFromDir?: string
  /** Named TS conditions referenced from JSON via `customCondition: "name"`. */
  customConditions?: Record<string, PolicyCondition>
  /** Where to read the principal from. Required when policies are configured. */
  principal: PrincipalConfig
  /**
   * What to do when a procedure has no `.policy()` declared.
   * - `'allow'` (default): pass through.
   * - `'deny'`: return forbidden with `reason: 'no_policy_declared'`.
   *   Procedures may opt out via `.policy({ public: true })`.
   */
  defaultMode?: 'allow' | 'deny'
  /** Override the default engine driver. */
  engine?: PolicyEnginePortLike
  /** Logger override (defaults to the server's `LoggerPort`). */
  logger?: LoggerPort
}

/**
 * Forward-declared port shape — full interface lives in
 * `src/ports/outbound/policy-engine.ts`. Re-stated here to avoid circular
 * imports between port + types.
 */
export interface PolicyEnginePortLike {
  evaluate(input: AuthzInput): Decision | Promise<Decision>
  list(): readonly Policy[]
}

// ============================================================================
// Per-procedure builder config
// ============================================================================

/**
 * Resolves the resource(s) being acted upon for a given procedure invocation.
 *
 * Returning `null` means "no resource — check action + principal only".
 * Returning an array enables `mode: 'any'` semantics (at least one passes).
 */
export type ResourceResolver<TInput = unknown, TCtx = unknown> = (
  input: TInput,
  ctx: TCtx,
) => Resource | readonly Resource[] | null | Promise<Resource | readonly Resource[] | null>

export interface ProcedurePolicyConfig<TInput = unknown, TCtx = unknown> {
  /** Defaults to procedure name. */
  action?: string
  /** Required unless `public: true`. */
  resource?: ResourceResolver<TInput, TCtx>
  /**
   * - `'enforce'` (default): every resolved resource must pass.
   * - `'any'`: at least one must pass.
   */
  mode?: 'enforce' | 'any'
  /**
   * For client streams + WS continuous procedures only. Ignored otherwise.
   * - `'open'` (default): evaluate once at connection/stream open.
   * - `'per-message'`: re-evaluate on each inbound frame.
   */
  streamMode?: 'open' | 'per-message'
  /**
   * Explicit "this procedure intentionally needs no policy". Required when
   * server-level `defaultMode: 'deny'`.
   */
  public?: boolean
}

// ============================================================================
// Forbidden error
// ============================================================================

/**
 * Body shape returned when a policy denies. Verbose form (dev/test) includes
 * diagnostics; production form is reduced to `{ error, code }`.
 */
export interface PolicyForbiddenBody {
  error: 'forbidden'
  code: 'POLICY_DENIED' | 'NO_POLICY_DECLARED'
  reason?: DecisionReason | 'no_policy_declared'
  action?: string
  principal?: { id: string; tenantId: string | null }
  matchedPolicyIds?: string[]
  candidatePolicies?: { id: string; missing: string[] }[]
}
