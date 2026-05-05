# Spec: Policy Engine Module

**Status**: Draft v1 — locked via grill-me session
**Target release**: Raffel 1.1.0
**Upstream design**: [filipeforattini/policy-engine](https://github.com/filipeforattini/policy-engine) (vendored, adapted)

---

## 1. Objective

Add an opt-in authorization module to Raffel that lets developers declare *who can do what to which resource under which conditions* via declarative policies — without writing imperative auth code in handlers.

### Target users

- Raffel users building multi-tenant SaaS, internal admin tools, or APIs with non-trivial access rules
- Teams that want RBAC, ABAC, or hybrid patterns without bolting on Casbin / OPA / Cedar
- Operators who want to ship policies as JSON files (auditable, reviewable, hot-swappable across deploys)

### Non-objectives

- Replace OAuth2/OIDC/Session — policy is **authorization**, not authentication. Builds on top.
- Compete with full policy engines (OPA, Cedar) — Raffel ships a *good-enough* default driver behind a port; users who outgrow it swap drivers.
- Cover transport-level access control (use existing `ConnectionFilter` for IP/origin allow/deny on TCP/UDP/WS).

---

## 2. Core Features & Acceptance Criteria

### F1 — Policy engine port + default driver

- `PolicyEnginePort { evaluate(input: AuthzInput): Decision | Promise<Decision> }` in `src/ports/outbound/policy-engine.ts`.
- Default driver in `src/middleware/policy/engine/` (vendored from upstream policy-engine).
- Users can pass a custom `PolicyEnginePort` implementation via `policy.engine` config.
- **AC**: Replacing the engine with a stub that always returns `{ allowed: false, reason: 'implicit_deny' }` denies all requests, no other change needed.

### F2 — Declarative policies (TS + JSON)

- `Policy` type with `condition?: (input) => boolean` (TS, inline).
- `JsonPolicy` type with `match?: MatchNode` (declarative DSL) and `customCondition?: string` (named TS function).
- Match DSL operators: literal equality, `null`, `*` (passes), `@ref` (path comparison), `!` prefix (negate), `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `notIn`, `regex`, `startsWith`, `endsWith`, `contains`, `exists`, `anyOf`, `allOf`, `not`.
- Wildcard pattern matchers: `*` (single segment), `**` (globstar), `?` (single char), `{a,b}` (alternation), `[abc]` (char class).
- **AC**: All upstream policy-engine examples in its README evaluate identically when run through Raffel's vendored engine.

### F3 — Effects: allow / deny / audit

- Precedence: `tenant_mismatch` > `explicit_deny` > `allow` > `implicit_deny` (default-closed).
- `audit` effect matches but never changes `allowed` — accumulates in `Decision.auditedPolicyIds`.
- **AC**: Shadow rollout pattern works — deploy as `audit`, observe `auditedPolicyIds` in logs, flip to `deny` with no behavior change for matching cases.

### F4 — Tenant isolation

- `Principal.tenantId` and `Resource.tenantId` non-null and unequal → automatic `tenant_mismatch` deny, before any policy evaluates.
- `tenantId: null` on principal = platform principal (crosses tenants); on resource = global resource.
- **AC**: Cross-tenant request is denied with `reason: 'tenant_mismatch'` even with an explicit `allow` policy that would otherwise match.

### F5 — Inline + JSON loader

- `policy.policies: Policy[]` — TS policies inline.
- `policy.loadFromDir: string` — loads `*.json` from dir, validates against schema, merges with inline.
- Merge order: inline first, JSON overrides inline by `id` (warning logged on collision).
- `policy.customConditions: Record<string, PolicyCondition>` — registry for named TS conditions referenced from JSON via `customCondition: "name"`.
- **No hot-reload in v1**. Policies are immutable after `server.start()`.
- **AC**: Server boots, validates all JSON against schema, fails fast (non-zero exit equivalent / start() rejects) on schema error or missing customCondition; passes when valid.

### F6 — Principal extraction adapters

- `policy.principal: { from: 'session' | 'oauth2' | 'oidc' | 'custom', map?: (raw, ctx) => Principal | Promise<Principal> }`
- Adapters know how to read each source's standard payload; `map` overrides shape.
- Cached in `ctx.principal` once per request (per WS connection for streams).
- **AC**: With `from: 'session'`, principal extraction reads `ctx.session.data.user`; with `from: 'oauth2'`, reads JWT claims; both yield a valid `Principal` without user-supplied mapper for default shapes.
- **Request-time error** if `from: 'session'` is configured but a protected request has no `ctx.session.data.user.id`.

### F7 — Per-procedure declaration

- Builder method: `procedure.authz({ action?, resource, mode?, public? })`.
- `action` defaults to procedure name.
- `resource: (input, ctx) => Resource | Resource[] | Promise<...> | null` — async-allowed; `null` skips resource match (action+principal only).
- `mode: 'enforce' | 'any'` — `enforce` (default): all resources must pass; `any`: at least one.
- `public: true` — explicit no-auth (required when `defaultMode: 'deny'`).
- Module-level inheritance: `routerModule({ policy: { action, resource } })` defaults for all procedures, override per procedure.
- **AC**: Procedure with `.authz({ resource: r => r })` evaluates correctly for HTTP, gRPC, JSON-RPC, WS-RPC, server stream.

### F8 — Stream support

- HTTP/gRPC/JSON-RPC/WS-RPC/server stream: policy runs once before handler.
- Client stream + WS continuous: use explicit `ctx.policy.evaluate()` calls inside the handler loop for per-message checks.
- TCP/UDP raw transports: **out of scope** — use `ConnectionFilter`.
- **AC**: Stream handlers can evaluate each inbound frame explicitly with `ctx.policy.evaluate(action, resource, context?)`.

### F9 — Filter mode + ad-hoc checks (DX)

- `ctx.policy.evaluate(action, resource, context?): Decision` — synchronous-ish check inside handler.
- `ctx.policy.filterResources(action, resources: Resource[], context?): Promise<Resource[]>` — returns only allowed.
- Helper decision dedup by `(action, resource.type, resource.id)` within a single request when no explicit evaluation context is supplied.
- Calls with explicit `EvalContext` evaluate directly instead of using the request-local decision cache.
- **AC**: Handler that lists 100 leads and calls `ctx.policy.filterResources('lead.read', leads)` twice without explicit context returns only those the principal can read and reuses the helper decision cache.

### F10 — Default mode + escape hatch

- `policy.defaultMode: 'allow' | 'deny'` (default: `'allow'`).
- `'allow'`: procedures without `.authz()` pass through unauthorized.
- `'deny'`: procedures without `.authz()` return 403 with `reason: 'no_policy_declared'`. `.authz({ public: true })` opts out.
- **AC**: Switching `defaultMode` from `'allow'` to `'deny'` causes all undecorated procedures to deny; adding `.authz({ public: true })` to one re-allows it.

### F11 — Pipeline placement

- Order: `ConnectionFilter → Session → Auth → Rate-limit → Validation → Policy → Custom interceptors → Handler`.
- Decision attached to `ctx.policyDecision` (always set when policy interceptor runs; `undefined` otherwise).
- Not configurable in v1.
- **AC**: Custom interceptor placed after policy reads `ctx.policyDecision` populated correctly for both allow and deny.

### F12 — Error & log shape

- **Client error response**:
  - `NODE_ENV !== 'production'`: `{ error: 'forbidden', code, reason, action, principal: { id, tenantId }, matchedPolicyIds, candidatePolicies: [{ id, missing }] }`.
  - `NODE_ENV === 'production'`: `{ error: 'forbidden', code: 'POLICY_DENIED' }` only.
- **Structured log via `LoggerPort`** on every decision (allow + deny + audit-only-match):
  - `info` allow, `warn` deny, `debug` audit-only-match.
  - Fields: `action`, `principal.id`, `principal.tenantId`, `resource.type/id`, `allowed`, `reason`, `matchedPolicyIds`, `auditedPolicyIds`, `candidatePolicies`, `durationMs`.
- **AC**: With `LOG_LEVEL=debug` in dev, full decision is logged for every request; in prod with `NODE_ENV=production`, deny response body contains zero policy ids.

### F13 — Discovery & introspection

- `runtime-preview` includes `policy: { action, mode, public, hasResolver }` per procedure.
- MCP resource `raffel://policies` lists all policies (only `match` DSL exposed; `condition` functions shown as `{ opaque: true, name?: string }`).
- `server.policy.explain(input: AuthzInput): Decision` — runs eval without side effects (no log, no metric).
- `server.policy.list(): Policy[]` — read-only snapshot.
- **AC**: MCP client connecting to a Raffel server with policies sees them in `raffel://policies`; `server.policy.explain({ ... })` returns a `Decision` matching what the interceptor would compute.

### F14 — Performance

- All glob patterns pre-compiled to `RegExp` at startup, attached to compiled policy as `_compiled`.
- Compiled principal set cached in `ctx.principal._compiledSet` per request.
- Helper decisions dedup'd by `(action, resource.type, resource.id)` per request when no explicit evaluation context is supplied.
- **No decision cache, no action index, no short-circuit eval** in v1.
- **AC**: 1000 policies × 100 evaluates in a single request completes in <100ms on a modern dev machine (sanity check, not a benchmark).

### F15 — Test harness

- `createPolicyHarness({ policies, customConditions })` in `src/testing/`.
- Returns `{ evaluate, principal, fixtures }` for unit testing policies without booting a server.
- **AC**: A new policy can be unit-tested with the harness, verifying allow/deny precedence, `matchedPolicyIds`, and `candidatePolicies` shape.

### F16 — Failure safety

- A `condition` function that throws → `Decision { allowed: false, reason: 'implicit_deny' }` + `error`-level log with stack trace.
- A resource resolver that throws → request fails with 500 (not a policy concern).
- A `match` DSL with invalid path → caught at startup validation; no runtime path can produce DSL eval throw.
- **AC**: A policy with `condition: () => { throw new Error('boom') }` causes deny + logged error, never a 500 response from the policy interceptor.

---

## 3. Tech Stack & Constraints

- **Language**: TypeScript strict, ESM (Raffel convention).
- **Runtime**: Node.js ≥ 20.
- **Test framework**: Vitest (existing).
- **Package manager**: pnpm (workspace rule).
- **Dependencies**: zero new runtime deps. Engine is vendored. JSON schema validation reuses Raffel's existing `ValidatorAdapter` port (Zod or Ajv depending on config).
- **Logger**: existing `LoggerPort` (no direct console / pino imports).
- **Coverage targets**: 100% on pure functions (match, dsl, evaluate); >90% on interceptor + builder.

---

## 4. Project Structure

```
src/
├── ports/outbound/
│   └── policy-engine.ts                  # PolicyEnginePort interface
├── middleware/policy/
│   ├── index.ts                          # public exports
│   ├── types.ts                          # Policy, JsonPolicy, Decision, PolicyConfig, MatchNode, AuthzInput, Principal, Resource, EvalContext
│   ├── interceptor.ts                    # createPolicyInterceptor()
│   ├── builder.ts                        # .authz() builder method extension
│   ├── ctx-helpers.ts                    # ctx.policy.evaluate / filterResources
│   ├── principal/
│   │   ├── index.ts
│   │   ├── session.ts                    # adapter for from: 'session'
│   │   ├── oauth2.ts                     # adapter for from: 'oauth2'
│   │   ├── oidc.ts                       # adapter for from: 'oidc'
│   │   └── custom.ts                     # adapter for from: 'custom'
│   ├── loader.ts                         # loadPoliciesFromDir + JSON schema validation
│   ├── schema.json                       # JSON schema for JsonPolicy
│   └── engine/                           # vendored default driver
│       ├── index.ts                      # createDefaultEngine
│       ├── createAuthz.ts
│       ├── evaluate.ts
│       ├── match.ts                      # glob pattern compiler
│       ├── dsl.ts                        # MatchNode → predicate compiler
│       └── compile.ts                    # pre-compile patterns at startup
├── testing/
│   └── policy-harness.ts                 # createPolicyHarness()
├── inspect/
│   └── runtime-graph.ts                  # extend with policy nodes
└── mcp/
    ├── docs/policies.ts                  # NEW — push policy patterns docs to MCP
    └── resources/index.ts                # extend with raffel://policies

test/policy/
├── engine/
│   ├── match.unit.test.ts
│   ├── dsl.unit.test.ts
│   ├── evaluate.unit.test.ts
│   └── principal-set.unit.test.ts
├── loader.unit.test.ts
├── interceptor.int.test.ts               # multi-protocol coverage
├── builder.int.test.ts
├── ctx-helpers.int.test.ts
├── streams.int.test.ts
├── dx.int.test.ts                        # error shape, log shape, explain
├── discovery.int.test.ts                 # runtime-preview, MCP
└── perf.int.test.ts                      # 1000-policy sanity

docs/
├── _sidebar.md                           # add Policies section
├── guides/
│   ├── policies.md                       # NEW — narrative guide
│   ├── auth.md                           # cross-link section added
│   └── migration.md                      # add "from Express auth middleware" section
├── policies/                             # NEW directory
│   ├── README.md
│   ├── match-dsl.md                      # full DSL ref
│   └── patterns.md                       # recipes (RBAC, ABAC, multi-tenant, shadow, etc.)
├── reference/
│   └── policies-api.md                   # API ref
└── auth/
    └── sessions.md                       # cross-link section added
```

---

## 5. Code Style & Conventions

- Match existing Raffel style (already enforced by tooling).
- All exported types have JSDoc.
- Comments only when *why* is non-obvious (per project CLAUDE.md).
- No new `console.*` calls — use `LoggerPort`.
- Adapter modules (`principal/session.ts`, etc.) are tiny, single-purpose; default exports prohibited (named exports).
- Engine code is `internal` — re-exported only via `src/middleware/policy/index.ts` and `src/index.ts`.

---

## 6. Testing Strategy

### Unit (engine, pure)
- `match.unit.test.ts` — every wildcard, edge cases.
- `dsl.unit.test.ts` — every operator, `@ref`, `!`, composition, deep nesting.
- `evaluate.unit.test.ts` — full precedence matrix, audit non-interference, `matchedPolicyIds` and `candidatePolicies` correctness.
- `principal-set.unit.test.ts` — flat compile, scope bidirectionality.
- `loader.unit.test.ts` — schema valid + invalid, customCondition resolution, merge order, override warnings, dead-policy warnings.

### Integration
- `interceptor.int.test.ts` — coverage across HTTP, WS-RPC, JSON-RPC, gRPC. enforce + any modes. defaultMode allow + deny + public escape. principal extraction from session, oauth2, oidc, custom.
- `builder.int.test.ts` — `.authz()` builder shape, default action inference, module inheritance + override, async resolver, null resolver.
- `ctx-helpers.int.test.ts` — `ctx.policy.evaluate/filterResources`, dedup proof.
- `streams.int.test.ts` — server stream open checks and explicit per-message checks through `ctx.policy.evaluate`.
- `dx.int.test.ts` — error shape per NODE_ENV, log structure via fake LoggerPort, `server.policy.explain()` returns Decision without side effects.
- `discovery.int.test.ts` — runtime-preview shape, MCP `raffel://policies` shape.
- `perf.int.test.ts` — 1000 policies × 100 evaluates < threshold.

### Hard requirements
- Zero `condition` exception path produces a 500 — always implicit_deny + log.
- Zero policy ids leak in production error responses (check via NODE_ENV=production fixture).
- Tenant_mismatch precedes explicit_deny precedes allow precedes implicit_deny — verified directly.

### Excluded from v1
- Fuzz testing, mutation testing, continuous benchmarks, e2e with real app.

---

## 7. Boundaries

### Always do
- Pre-compile all glob patterns at startup; never compile on hot path.
- Cache principal compiled set per-request (`ctx.principal._compiledSet`).
- Dedup helper decisions by `(action, resource.type, resource.id)` per request when no explicit evaluation context is supplied.
- Log every decision via `LoggerPort` — never directly to stdout.
- Validate all JSON policies + customCondition refs at startup; fail fast.
- Treat `condition` throw as `implicit_deny`, log with stack.
- Strip policy ids from production error response bodies.

### Ask first about
- Adding a new operator to the DSL (additive, but extends the API surface forever).
- Hot-reload of policies (explicitly out of v1; revisit after real demand).
- Decision caching (security-sensitive — wrong cache invalidation = silent privilege escalation).
- Action indexing / short-circuit eval (only with profiling proof from real workload).
- Removing or renaming `Policy` / `JsonPolicy` / `Decision` / `MatchNode` / `PolicyEnginePort` fields (breaking, requires major bump).

### Never do
- Run policy engine on TCP/UDP raw transports (use `ConnectionFilter`).
- Change `defaultMode` default from `'allow'` (breaks every existing Raffel app on upgrade).
- Allow customConditions to be loaded from JSON (only TS registry — serializability is a feature).
- Skip startup validation in any mode (no `skipValidation: true` flag).
- Mutate `ctx.principal` or `ctx.policyDecision` after the policy interceptor runs.
- Make policy a hard dependency — entire module must be tree-shakeable for users who don't opt in.

---

## 8. Out of Scope (v1)

Explicitly deferred to a future minor:
- Hot-reload watcher for policy files
- Decision result caching
- Action prefix indexing for >500 policies
- TCP/UDP policy support
- Automatic per-message policy on raw streams.
- Multi-policy-per-procedure (`.authz().authz()` chaining)
- OPA / Cedar / Casbin reference drivers (port allows them; we don't ship them)
- Policy versioning / staged rollout via flags (use `audit` effect for shadow testing instead)

---

## 9. Release & Versioning

- **Target**: Raffel 1.1.0 (minor bump, no flag).
- **Stability commitment** (frozen until 2.0.0):
  - `PolicyConfig`, `Policy`, `JsonPolicy`, `Decision`, `MatchNode`, `AuthzInput`, `Principal`, `Resource`, `PolicyEnginePort` — frozen.
  - `.authz({ ... })` builder shape — frozen.
  - `ctx.policy.*` helpers — frozen.
  - `server.policy.explain` / `server.policy.list` — frozen.
- **Free to evolve** in minors:
  - Default driver internals (perf, additional pre-compile passes).
  - Additive DSL operators.
  - Additional optional fields on existing types.
- **Attribution**: README + `docs/guides/policies.md` credits `filipeforattini/policy-engine` as the upstream design.

---

## 10. Open Questions

None at spec time. All 14 design decisions locked via grill-me session 2026-05-02.
