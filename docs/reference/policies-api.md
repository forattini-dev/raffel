# Policies — API Reference

Types, configuration, builder methods, helpers, and ports.

## Imports

```ts
import { createServer } from 'raffel'
// Types and helpers are re-exported from raffel/policy:
import {
  createDefaultEngine,
  loadPoliciesFromDir,
  mergePolicies,
} from 'raffel/policy'
import type {
  Policy,
  JsonPolicy,
  Decision,
  MatchNode,
  AuthzInput,
  Principal,
  Resource,
  PolicyConfig,
  PrincipalConfig,
  ProcedurePolicyConfig,
  PolicyCtxHelpers,
} from 'raffel/policy'
import type { PolicyEnginePort } from 'raffel/ports/outbound/policy-engine'
```

> Subject to your bundler's path resolution; flat re-exports from `raffel` work too in v1.1+.

---

## ServerOptions extension

```ts
createServer({
  policy?: PolicyConfig
})
```

Omit `policy` and zero engine code is loaded.

### `PolicyConfig`

```ts
interface PolicyConfig {
  /** Where to read the principal from on every request. Required. */
  principal: PrincipalConfig

  /** Inline (TS) policies. */
  policies?: readonly Policy[]

  /** Filesystem dir to scan for `*.json` policies (recursive). */
  loadFromDir?: string

  /** Named TS conditions referenced from JSON via `customCondition: "name"`. */
  customConditions?: Record<string, PolicyCondition>

  /**
   * What to do when a procedure has no `.authz()` declared.
   *  - 'allow' (default): pass through.
   *  - 'deny': return 403 with `code: 'NO_POLICY_DECLARED'`.
   *    Procedures may opt out via `.authz({ public: true })`.
   */
  defaultMode?: 'allow' | 'deny'

  /** Override the default in-process engine driver (e.g. OPA, Cedar). */
  engine?: PolicyEnginePort

  /** Logger override (defaults to the server's LoggerPort). */
  logger?: LoggerPort
}
```

### `PrincipalConfig`

```ts
type PrincipalSource = 'session' | 'oauth2' | 'oidc' | 'custom'

interface PrincipalConfig {
  from: PrincipalSource

  /**
   * Required for `from: 'custom'`.
   * Optional override for the other sources — replaces the default mapping.
   */
  map?: (raw: unknown, ctx: Context) => Principal | Promise<Principal>
}
```

### Default principal mappings

| Source | Reads | Default mapping |
|---|---|---|
| `'session'` | `ctx.session.data.user` | direct copy of `{ id, tenantId, scopes, groups, attrs }`, defaulting `tenantId: null`, empty arrays |
| `'oauth2'` | `ctx.auth` | `id ← principalId / claims.sub`; `tenantId ← auth.tenantId / claims.tid`; `scopes ← auth.scopes / claims.scope (split)`; `groups ← auth.roles / claims.groups / claims.roles` |
| `'oidc'` | `ctx.auth` | Same as OAuth2 + `claims.org_id` fallback for `tenantId`; prefers `claims.groups` over `claims.roles` |
| `'custom'` | (anything) | requires `map` |

Throws at startup if `from: 'session'` but the session module is not enabled (or at request-time, depending on detection — currently a runtime error on first denied call).

---

## ProcedureBuilder extension

### `.authz(config)`

Declares an authorization policy for the procedure.

```ts
server.procedure('lead.read')
  .input(z.object({ id: z.string() }))
  .authz({
    resource: ({ id }, ctx) => ({
      type: 'lead',
      id,
      tenantId: ctx.auth.tenantId ?? null,
    }),
  })
  .handler(async ({ id }) => loadLead(id))
```

```ts
interface ProcedurePolicyConfig<TInput, TCtx> {
  /** Defaults to the procedure name. */
  action?: string

  /** Resource resolver. May be async; may return null (skip resource match). */
  resource?: (input: TInput, ctx: TCtx) =>
    | Resource | readonly Resource[] | null
    | Promise<Resource | readonly Resource[] | null>

  /**
   *  - 'enforce' (default): every resolved resource must pass.
   *  - 'any': at least one must pass.
   */
  mode?: 'enforce' | 'any'

  /**
   * For client streams + WS continuous procedures only.
   *  - 'open' (default): evaluate once at stream/connection open.
   *  - 'per-message': re-evaluate on each inbound frame.
   */
  streamMode?: 'open' | 'per-message'

  /**
   * Explicit "this procedure intentionally needs no policy".
   * Required when server-level `defaultMode: 'deny'`.
   */
  public?: boolean
}
```

**Throws** at registration if:
- `policy: { ... }` was not configured on `createServer` (and `public !== true` mode wouldn't help — neither calling `.authz()` is allowed without policy config in v1).
- `.authz()` is called twice on the same procedure (multi-policy chaining is not supported in v1).

---

## Router module extension

```ts
import { createRouterModule } from 'raffel'

createRouterModule(prefix?: string, options?: CreateRouterModuleOptions): RouterModule
```

```ts
interface CreateRouterModuleOptions {
  /**
   * Default authz config for procedures in this module that don't call
   * `.authz()` themselves. Per-procedure `.authz()` always wins.
   */
  authz?: ProcedurePolicyConfig
}
```

The default applies at `server.mount()` time using the host server's policy factory.

---

## Ctx helpers — `ctx.policy`

Attached automatically when the policy interceptor runs (idempotent — safe across nested calls).

```ts
interface PolicyCtxHelpers {
  /**
   * Evaluate (action, resource) using the cached principal.
   * Sync/async depending on engine. Cached per request by (action, resource.id).
   */
  evaluate(action: string, resource: Resource): Decision | Promise<Decision>

  /**
   * Filter resources, returning only those for which engine.evaluate
   * yields allowed:true. Same per-request cache.
   */
  filterResources(action: string, resources: readonly Resource[]): Promise<Resource[]>
}
```

Access via:

```ts
async (input, ctx) => {
  const helpers = (ctx as any).policy as PolicyCtxHelpers
  // ...
}
```

> **Type augmentation**: to get type-safe access without casts, augment the `Context` interface in your project:
> ```ts
> import 'raffel'
> import type { PolicyCtxHelpers } from 'raffel/policy'
> declare module 'raffel' {
>   interface Context { policy: PolicyCtxHelpers }
> }
> ```

---

## Domain types

### `Principal`

```ts
interface Principal {
  id: string
  tenantId: string | null              // null = platform principal
  scopes: string[]
  groups: string[]
  attrs?: Record<string, unknown>
}
```

The compiled principal set (used internally for pattern matching) contains:

```
[id, `user:${id}`, `scope:${each scope}`, `group:${each group}`, '*']
```

### `Resource`

```ts
interface Resource {
  type: string
  id: string
  tenantId: string | null              // null = global
  attrs?: Record<string, unknown>
}
```

### `Policy`

```ts
type PolicyEffect = 'allow' | 'deny' | 'audit'
type PolicyCondition = (input: AuthzInput) => boolean

interface Policy {
  id: string
  description?: string
  effect: PolicyEffect
  principals: string[]                  // glob patterns
  actions: string[]                     // glob patterns
  resources: string[]                   // glob patterns
  condition?: PolicyCondition           // TS function
  match?: MatchNode                     // declarative DSL
}
```

Both `condition` and `match` may be present — both must pass.

### `JsonPolicy`

```ts
type JsonPolicy = Omit<Policy, 'condition'> & {
  customCondition?: string              // name lookup into customConditions registry
}
```

### `AuthzInput`

```ts
interface AuthzInput {
  principal: Principal
  action: string
  resource: Resource
  context?: EvalContext
}

type EvalContext = Record<string, unknown>
```

### `Decision`

```ts
type DecisionReason = 'allow' | 'explicit_deny' | 'implicit_deny' | 'tenant_mismatch'

interface Decision {
  allowed: boolean
  reason: DecisionReason
  matchedPolicyIds: string[]
  auditedPolicyIds: string[]
  candidatePolicies: {
    id: string
    description?: string
    effect: PolicyEffect
    requiredPrincipals: string[]
    missing: string[]                   // 'principals' | 'actions' | 'resources'
  }[]
  durationMs?: number
}
```

### `MatchNode`

See the [Match DSL reference](../policies/match-dsl.md) for a full operator listing.

```ts
type MatchNode =
  | { anyOf: MatchNode[] }
  | { allOf: MatchNode[] }
  | { not: MatchNode }
  | { [path: string]: MatchValue }
```

---

## Engine port — `PolicyEnginePort`

Replace the default driver with your own (OPA, Cedar, custom):

```ts
interface PolicyEnginePort {
  evaluate(input: AuthzInput): Decision | Promise<Decision>
  list(): readonly Policy[]
}
```

Pass via `policy.engine`:

```ts
import type { PolicyEnginePort } from 'raffel/ports/outbound/policy-engine'

const myEngine: PolicyEnginePort = {
  evaluate: (input) => fetchOPA(input),
  list: () => [],
}

createServer({
  policy: {
    principal: { from: 'session' },
    engine: myEngine,
  },
})
```

`evaluate` MUST be safe to call concurrently. The default driver is sync; custom async drivers work transparently.

---

## Engine factory — `createDefaultEngine`

```ts
function createDefaultEngine(options?: {
  policies?: readonly Policy[]
  onConditionError?: (policy: Policy, error: unknown) => void
}): PolicyEnginePort
```

Pre-compiles all glob patterns + match DSL at construction. Pass `onConditionError` to wire policy errors to your `LoggerPort`.

---

## JSON loader

```ts
function loadPoliciesFromDir(options: {
  dir: string
  customConditions?: Record<string, PolicyCondition>
}): {
  policies: Policy[]
  loadedFiles: string[]
}
```

Walks `dir` recursively, loads `*.json`, validates against the schema, resolves `customCondition` references, returns the merged array. Throws on:

- I/O errors (with file path)
- JSON parse errors (with file path)
- Schema validation errors (with file path + JSON pointer)
- Missing `customCondition` references

```ts
function mergePolicies(
  inline: readonly Policy[],
  fromJson: readonly Policy[],
): {
  merged: Policy[]
  warnings: string[]
}
```

`fromJson` overrides `inline` on duplicate `id` (warning emitted). Empty `principals`/`actions`/`resources` arrays generate dead-policy warnings.

---

## Constants & error codes

The interceptor throws `RaffelError('PERMISSION_DENIED', ..., body)` which becomes HTTP 403.

The `body.code` is one of:

| Code | When |
|---|---|
| `POLICY_DENIED` | A policy denied (explicit, implicit, tenant_mismatch) |
| `NO_POLICY_DECLARED` | `defaultMode: 'deny'` and procedure has no `.authz()` |

Body fields when `NODE_ENV !== 'production'`:

```ts
interface PolicyForbiddenBody {
  error: 'forbidden'
  code: 'POLICY_DENIED' | 'NO_POLICY_DECLARED'
  reason?: DecisionReason | 'no_policy_declared'
  action?: string
  principal?: { id: string; tenantId: string | null }
  matchedPolicyIds?: string[]
  candidatePolicies?: { id: string; missing: string[] }[]
}
```

In `NODE_ENV === 'production'`, body is reduced to `{ error: 'forbidden', code }`.

---

## See also

- [Guide](../guides/policies.md) — narrative tour
- [Match DSL reference](../policies/match-dsl.md) — operators
- [Patterns](../policies/patterns.md) — recipes
