# Plan: Policy Engine Implementation

**Spec**: [policy-engine.md](./policy-engine.md)
**Strategy**: Vertical tracer-bullet first (Phase 1), then expand horizontally. Each task is independently mergeable and verifiable.
**Total**: 11 phases, 32 tasks. Estimated 5–8 working days for one engineer.

---

## Dependency graph (high level)

```
Phase 0 (Foundation) ─┬─► Phase 1 (Tracer bullet, HTTP allow/deny only)
                      │
                      ├─► Phase 2 (Engine completeness — DSL, wildcards, tenant, audit)
                      │       │
                      │       └─► Phase 5 (ctx helpers)
                      │
                      ├─► Phase 3 (Principal adapters)
                      │
                      ├─► Phase 4 (Module inheritance + multi-protocol)
                      │       │
                      │       └─► Phase 9 (Streams per-message)
                      │
                      ├─► Phase 6 (JSON loader + customConditions) ← needs Phase 2
                      │
                      ├─► Phase 7 (DX: error/log/explain) ← needs Phases 1–4
                      │
                      └─► Phase 8 (Discovery: runtime-preview + MCP) ← needs Phase 7

Phase 10 (Docs) ← any time after Phase 7
Phase 11 (Release prep) ← last
```

---

## Phase 0 — Foundation (no behavior yet)

### T0.1 — Define core types
**Files**: `src/middleware/policy/types.ts`
**Deps**: none
**Out**:
- `Policy`, `JsonPolicy`, `Decision`, `MatchNode`, `MatchOperator`, `MatchValue`, `AuthzInput`, `Principal`, `Resource`, `EvalContext`, `CandidatePolicy`, `PolicyEffect`, `PolicyCondition`, `PolicyConfig`, `RouteCheck` types.
- All exports JSDoc'd.
**AC**: `pnpm tsc --noEmit` passes. Types match upstream policy-engine field-by-field except `condition`/`match` are mutually exclusive in `JsonPolicy`.
**Verify**: `pnpm tsc --noEmit && grep -c 'export type' src/middleware/policy/types.ts` ≥ 12.

### T0.2 — Define `PolicyEnginePort`
**Files**: `src/ports/outbound/policy-engine.ts`
**Deps**: T0.1
**Out**:
```ts
export interface PolicyEnginePort {
  evaluate(input: AuthzInput): Decision | Promise<Decision>
  list(): readonly Policy[]
}
```
**AC**: Exported from `src/ports/outbound/index.ts` (or equivalent). Types from T0.1.
**Verify**: `pnpm tsc --noEmit`.

### T0.3 — Empty module skeleton + index
**Files**: `src/middleware/policy/index.ts`, `src/middleware/policy/engine/index.ts`
**Deps**: T0.1, T0.2
**Out**: Stub re-exports. `createDefaultEngine()` factory that returns `PolicyEnginePort` with empty policies list returning `{ allowed: false, reason: 'implicit_deny', ... }` always.
**AC**: `import { createDefaultEngine } from 'raffel/policy'` (or equivalent path) returns an engine that denies all.
**Verify**: tiny smoke test.

**✅ Checkpoint 0**: Types compile, port defined, stub engine returns deny. No runtime behavior in server.

---

## Phase 1 — Tracer bullet (HTTP allow/deny end-to-end)

Goal: smallest possible vertical slice that proves the architecture. One HTTP procedure with one `.authz()` call, one inline policy, one principal source. No DSL — only `condition` function. No tenant. No audit. No streams. No JSON loader.

### T1.1 — Vendor minimal engine: `evaluate` + `match` (basic glob)
**Files**: `src/middleware/policy/engine/evaluate.ts`, `src/middleware/policy/engine/match.ts`, `src/middleware/policy/engine/createAuthz.ts`, `src/middleware/policy/engine/compile.ts`
**Deps**: T0.1
**Out**:
- `match.ts`: glob → regex. Supports `*` and `**` only in this task.
- `evaluate.ts`: tenant_mismatch (always run) → explicit_deny → allow → implicit_deny. Returns `Decision`. Calls `condition` if present. Skips `match` (added in Phase 2).
- `compile.ts`: pre-compile patterns at startup, attach to policy as `_compiled`.
- `createAuthz.ts`: factory that takes `policies`, returns `PolicyEnginePort`.
**AC**: Unit tests pass for `*` / `**` patterns and the 4 precedence reasons.
**Verify**: `pnpm vitest run test/policy/engine/evaluate.unit.test.ts test/policy/engine/match.unit.test.ts`.

### T1.2 — Policy interceptor (HTTP only, enforce mode)
**Files**: `src/middleware/policy/interceptor.ts`
**Deps**: T1.1
**Out**: `createPolicyInterceptor({ engine, action, resource, principalFrom })` returns Raffel `Interceptor`. Enforce mode only. Reads `ctx.principal` (set externally for now). Resolves resource(s). Calls `engine.evaluate`. On deny: throws Raffel forbidden error with verbose body. On allow: passes through, sets `ctx.policyDecision`.
**AC**: Integration test with a hand-wired procedure passes when policy allows; receives 403 when policy denies.
**Verify**: `pnpm vitest run test/policy/interceptor.int.test.ts -t "tracer"`.

### T1.3 — `.authz()` builder method
**Files**: `src/server/handler-builders.ts` (extend `ProcedureBuilder`), `src/middleware/policy/builder.ts`
**Deps**: T1.2
**Out**: New builder method on `ProcedureBuilder`: `.authz({ action?, resource, mode? })`. Stores config on registration meta. Default `action = procedure name`. Adds policy interceptor automatically when `.authz()` is called.
**AC**: Procedure declared with `.authz()` runs interceptor; without `.authz()` does not.
**Verify**: integration test for both branches.

### T1.4 — Wire policy into `createServer` config (manual principal)
**Files**: `src/server/types.ts` (add `policy?: PolicyConfig`), `src/server/builder.ts` (boot the engine, register on procedures)
**Deps**: T1.3
**Out**: `createServer({ policy: { policies: [...], principal: { from: 'custom', map: (ctx) => ({...}) } } })` boots the engine, walks all registered procedures with `.authz()`, attaches interceptor.
**AC**: End-to-end test — full server boot, HTTP POST to procedure with policy, returns 200 (allow) or 403 (deny) per inline policy.
**Verify**: `pnpm vitest run test/policy/interceptor.int.test.ts -t "end-to-end"`.

**✅ Checkpoint 1**: One HTTP procedure with `.authz()` + inline TS policy + custom principal mapper works end-to-end. F1 (port+driver), F7 (per-procedure), part of F11 (pipeline) verified.

---

## Phase 2 — Engine completeness

### T2.1 — Full glob support
**Files**: `src/middleware/policy/engine/match.ts`
**Deps**: T1.1
**Out**: Add `?`, `{a,b}`, `[abc]` and `[a-z]` to pattern compiler. Update tests.
**AC**: All wildcard rows in spec §F2 pass.
**Verify**: `pnpm vitest run test/policy/engine/match.unit.test.ts` covers all wildcards.

### T2.2 — Match DSL compiler
**Files**: `src/middleware/policy/engine/dsl.ts`
**Deps**: T0.1
**Out**: `compileMatch(node: MatchNode) → predicate(input) → boolean`. All operators: literal, `null`, `*`, `@ref`, `!` prefix, `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `notIn`, `regex`, `startsWith`, `endsWith`, `contains`, `exists`, `anyOf`, `allOf`, `not`. Path resolver: `principal.*`, `resource.*`, `resource.attrs.*`, `context.*`. **At-startup validation** — `compileMatch` rejects unknown paths/operators with helpful error.
**AC**: Every operator from spec has a passing unit test.
**Verify**: `pnpm vitest run test/policy/engine/dsl.unit.test.ts`.

### T2.3 — Engine integrates DSL
**Files**: `src/middleware/policy/engine/evaluate.ts`, `createAuthz.ts`
**Deps**: T2.2
**Out**: `evaluate` calls compiled DSL when policy has `match`. Both `condition` and `match` work.
**AC**: A `JsonPolicy` with `match: { "resource.status": "active" }` evaluates identically to `Policy` with `condition: ({ resource }) => resource.attrs?.status === 'active'`.
**Verify**: parity test in `evaluate.unit.test.ts`.

### T2.4 — Tenant isolation precedence
**Files**: `src/middleware/policy/engine/evaluate.ts`
**Deps**: T2.3
**Out**: Before any policy matches, if `principal.tenantId != null && resource.tenantId != null && principal.tenantId !== resource.tenantId` → return `{ allowed: false, reason: 'tenant_mismatch' }`. `null` on either side = pass-through (platform / global).
**AC**: F4 acceptance criteria — explicit allow can't override tenant_mismatch.
**Verify**: dedicated tenant test in `evaluate.unit.test.ts`.

### T2.5 — Audit effect
**Files**: `src/middleware/policy/engine/evaluate.ts`
**Deps**: T2.3
**Out**: Policies with `effect: 'audit'` match like others but never set `allowed`. IDs accumulated in `auditedPolicyIds`. Coexist with allow/deny.
**AC**: Shadow rollout pattern verified — same input flips from `allowed: true` (audit only) to `allowed: false` (deny) when effect changes.
**Verify**: parametrized test.

### T2.6 — Compiled principal set + scope bidirectionality
**Files**: `src/middleware/policy/engine/compile.ts`, `evaluate.ts`
**Deps**: T2.3
**Out**: Principal → flat string set with `id`, `user:id`, `scope:*`, `group:*`, `*`. Bidirectional match: principal scope `lead.**` satisfies policy principal `scope:lead.read`. Cache compiled set in `ctx.principal._compiledSet` (interceptor attaches it lazily).
**AC**: Bidirectionality test from spec §4 of upstream README.
**Verify**: `pnpm vitest run test/policy/engine/principal-set.unit.test.ts`.

**✅ Checkpoint 2**: Engine reaches feature parity with upstream policy-engine. F2, F3, F4 fully verified.

---

## Phase 3 — Principal extraction adapters

### T3.1 — Adapter dispatcher + `from: 'custom'`
**Files**: `src/middleware/policy/principal/index.ts`, `principal/custom.ts`
**Deps**: T1.4
**Out**: `resolvePrincipal(config, ctx) → Principal | Promise<Principal>`. Dispatches to adapter. Custom always available.
**AC**: Existing tracer test still passes (uses `from: 'custom'`).
**Verify**: rerun tracer test from T1.4.

### T3.2 — Session adapter
**Files**: `src/middleware/policy/principal/session.ts`
**Deps**: T3.1
**Out**: Reads `ctx.session.data.user` with default shape `{ id, tenantId, scopes, groups, attrs }`. Optional `map` overrides. **Startup error** if session module not enabled.
**AC**: Server with session module + `from: 'session'` boots; without session + `from: 'session'` fails fast at start.
**Verify**: int test.

### T3.3 — OAuth2 adapter
**Files**: `src/middleware/policy/principal/oauth2.ts`
**Deps**: T3.1
**Out**: Reads JWT claims from existing `src/middleware/auth/oauth2.ts` output (likely `ctx.user` or similar — confirm at impl). Default mapping: `sub → id`, `tid → tenantId`, `scope → scopes` (space-split), `groups → groups`. Override via `map`.
**AC**: int test with mock OAuth.
**Verify**: int test.

### T3.4 — OIDC adapter
**Files**: `src/middleware/policy/principal/oidc.ts`
**Deps**: T3.3
**Out**: Same as OAuth2 with OIDC-standard claims (`sub`, `tid`, `roles`, etc.). Confirm against existing `src/middleware/auth/` conventions at impl.
**AC**: int test with mock OIDC.
**Verify**: int test.

### T3.5 — Per-request principal cache
**Files**: `src/middleware/policy/interceptor.ts`
**Deps**: T3.1
**Out**: Resolve once per request, store in `ctx.principal`. Subsequent `.authz()` interceptors and `ctx.policy.evaluate` reuse without re-resolving.
**AC**: Spy on adapter — invoked once for a request that hits 3 procedures (e.g. via batch).
**Verify**: int test.

**✅ Checkpoint 3**: F6 fully verified across all 4 sources.

---

## Phase 4 — Module inheritance + multi-protocol

### T4.1 — Module-level policy config
**Files**: `src/server/router-module.ts`
**Deps**: T1.3
**Out**: `routerModule({ policy: { action?, resource? } })` defaults — applied to every procedure unless overridden by `.authz()` on the procedure itself. Inheritance respects existing `moduleInterceptors` ordering rules from MEMORY (no duplication).
**AC**: Procedures in module inherit defaults; explicit `.authz()` overrides.
**Verify**: int test.

### T4.2 — gRPC adapter coverage
**Files**: integration test only
**Deps**: T1.4
**Out**: Verify policy interceptor runs identically for gRPC procedures (no transport-specific code in policy module).
**AC**: gRPC procedure with `.authz()` enforces policy.
**Verify**: int test.

### T4.3 — JSON-RPC adapter coverage
**Files**: integration test only
**Deps**: T1.4
**Out**: Same as T4.2 for JSON-RPC.
**AC**: JSON-RPC procedure with `.authz()` enforces policy.
**Verify**: int test.

### T4.4 — WebSocket RPC + server stream coverage
**Files**: integration test only
**Deps**: T1.4
**Out**: Verify WS-RPC and server stream (server-sent stream) — policy runs once at call open. Principal cached per connection in WS.
**AC**: WS RPC enforces policy; server stream policy decision logged once per call, not per outbound message.
**Verify**: int test.

### T4.5 — `defaultMode` config + `public: true` escape
**Files**: `src/middleware/policy/builder.ts`, `interceptor.ts`, `src/server/builder.ts`
**Deps**: T1.4
**Out**: `policy.defaultMode: 'allow' | 'deny'` (default `'allow'`). In `'deny'` mode, procedures without `.authz()` fail with `reason: 'no_policy_declared'`. `.authz({ public: true })` is the explicit opt-out — does not register engine eval.
**AC**: F10 acceptance — flip mode, observe expected behavior.
**Verify**: int test.

**✅ Checkpoint 4**: Multi-protocol parity confirmed; F7, F8 (open mode), F10 verified.

---

## Phase 5 — ctx helpers

### T5.1 — `ctx.policy.evaluate`
**Files**: `src/middleware/policy/ctx-helpers.ts`, `interceptor.ts` (attach helpers to ctx)
**Deps**: T2.6
**Out**: `ctx.policy.evaluate(action, resource): Decision`. Synchronous if engine is sync (default driver is sync). Uses cached principal from `ctx.principal`.
**AC**: Handler calls `ctx.policy.evaluate('lead.read.sensitive', resource)` and gets a Decision.
**Verify**: int test.

### T5.2 — `ctx.policy.filterResources` with dedup
**Files**: `src/middleware/policy/ctx-helpers.ts`
**Deps**: T5.1
**Out**: `filterResources(action, resources): Promise<Resource[]>`. Deduplicates by `resource.id` per request — resolver invoked at most once per id even across multiple `evaluate`/`filterResources` calls. Cache scoped to request.
**AC**: F9 acceptance — 100 leads filtered, resolver hit ≤100 times even with two filter calls.
**Verify**: int test with spy on resolver.

**✅ Checkpoint 5**: F9 verified.

---

## Phase 6 — JSON loader + customConditions

### T6.1 — JSON schema for `JsonPolicy`
**Files**: `src/middleware/policy/schema.json`
**Deps**: T2.2
**Out**: Full JSON schema for `JsonPolicy` including all DSL operators. Validated via existing `ValidatorAdapter` port (Zod or Ajv per server config).
**AC**: Sample valid + invalid JSON files validate as expected.
**Verify**: `pnpm vitest run test/policy/loader.unit.test.ts`.

### T6.2 — `loadPoliciesFromDir`
**Files**: `src/middleware/policy/loader.ts`
**Deps**: T6.1
**Out**: Walks dir, loads `*.json`, validates each, resolves `customCondition: "name"` against `customConditions` registry. Returns merged policy array. Path errors include `file:line` in message.
**AC**: Loader rejects invalid JSON with helpful error; resolves customConditions; merges with inline (JSON overrides by id) with warning log.
**Verify**: unit test.

### T6.3 — Wire loader into config + dead-policy validation
**Files**: `src/server/builder.ts`, `src/middleware/policy/loader.ts`
**Deps**: T6.2
**Out**: `policy.loadFromDir` reads at server boot, merges with `policy.policies`. Startup validates: customCondition refs exist, no empty `principals/actions/resources` arrays (warn), no duplicate ids across sources (warn, JSON wins).
**AC**: F5 acceptance.
**Verify**: int test.

**✅ Checkpoint 6**: F5 + F2 (JSON path) verified.

---

## Phase 7 — DX (error/log/explain)

### T7.1 — Production-vs-dev error response shape
**Files**: `src/middleware/policy/interceptor.ts`
**Deps**: T1.2
**Out**: Determine `NODE_ENV === 'production'` at config time (not per request). Verbose body in dev/test, `{ error: 'forbidden', code: 'POLICY_DENIED' }` only in prod. F12 acceptance — zero policy ids in prod body (test asserts).
**AC**: F12.
**Verify**: int test parametrized on NODE_ENV.

### T7.2 — Structured decision log via `LoggerPort`
**Files**: `src/middleware/policy/interceptor.ts`
**Deps**: T7.1
**Out**: After every evaluate (allow + deny + audit-only-match), emit structured log via existing `LoggerPort`. Levels: `info` allow, `warn` deny, `debug` audit-only-match. Fields per spec F12.
**AC**: Fake LoggerPort captures expected fields.
**Verify**: int test with fake logger.

### T7.3 — `condition` throw → implicit_deny + error log
**Files**: `src/middleware/policy/engine/evaluate.ts`
**Deps**: T7.2
**Out**: Try/catch around `condition()` call. On throw: log error with stack, treat policy as non-match (skip), proceed. Final reason is whatever the rest computes (often implicit_deny).
**AC**: F16 acceptance — never a 500 from policy.
**Verify**: dedicated test.

### T7.4 — `server.policy.explain` + `server.policy.list`
**Files**: `src/server/builder.ts`, `src/middleware/policy/index.ts`
**Deps**: T7.2
**Out**: `server.policy.explain(input): Decision` runs the engine without logging or side effects. `server.policy.list()` returns frozen snapshot.
**AC**: F13 partial — explain returns same Decision interceptor would compute, list returns all loaded policies.
**Verify**: int test.

**✅ Checkpoint 7**: F12, F13 partial, F16 verified.

---

## Phase 8 — Discovery (runtime-preview + MCP)

### T8.1 — runtime-preview includes policy info
**Files**: `src/inspect/runtime-graph.ts`, `src/inspect/types.ts`, `src/server/orchestration/runtime-preview.ts`
**Deps**: T7.4
**Out**: Each procedure node gains `policy?: { action, mode, public, hasResolver }`. No DSL details — just metadata.
**AC**: Calling runtime-preview on a server with policies shows the metadata.
**Verify**: int test.

### T8.2 — MCP `raffel://policies` resource
**Files**: `src/mcp/resources/index.ts`, `src/mcp/docs/policies.ts` (new)
**Deps**: T7.4
**Out**: New MCP resource lists all policies. `condition` functions shown as `{ opaque: true, name?: string }`. `match` DSL shown verbatim. Patterns docs (`src/mcp/docs/policies.ts`) pushed for agent discovery — RBAC, ABAC, multi-tenant, shadow patterns.
**AC**: F13 full.
**Verify**: int test reading from MCP.

**✅ Checkpoint 8**: F13 verified.

---

## Phase 9 — Streams (per-message)

### T9.1 — `mode: 'open' | 'per-message'` on `.authz()`
**Files**: `src/middleware/policy/builder.ts`, `interceptor.ts`
**Deps**: T4.4
**Out**: For client streams + WS continuous procedures, `mode: 'per-message'` re-evaluates policy on each inbound frame. `mode: 'open'` (default) only at open. RPC and server stream ignore the field.
**AC**: F8 acceptance — per-message branch verified.
**Verify**: int test on WS continuous procedure.

**✅ Checkpoint 9**: F8 fully verified.

---

## Phase 10 — Documentation

### T10.1 — Guide + DSL ref + patterns
**Files**:
- `docs/guides/policies.md`
- `docs/policies/README.md`
- `docs/policies/match-dsl.md`
- `docs/policies/patterns.md`
- `docs/_sidebar.md`
**Deps**: Phases 1–9 complete (so examples are real)
**Out**: Per spec §10 of policy-engine.md. All examples runnable against actual API. Sidebar updated.
**AC**: `pnpm docs:dev` (or equivalent) renders the new section without errors.
**Verify**: manual review + Docsify lint if available.

### T10.2 — API reference + cross-links
**Files**:
- `docs/reference/policies-api.md`
- `docs/auth/sessions.md` (cross-link section)
- `docs/guides/auth.md` (cross-link section)
- `docs/guides/migration.md` (Express → Raffel section)
- `README.md` (paragraph + link)
**Deps**: T10.1
**Out**: Per spec §10.
**AC**: All public exports from `src/middleware/policy/index.ts` documented.
**Verify**: `grep -c export src/middleware/policy/index.ts` matches API doc surface.

### T10.3 — JSDoc audit
**Files**: all `src/middleware/policy/**/*.ts`, `src/ports/outbound/policy-engine.ts`
**Deps**: Phases 1–9 complete
**Out**: Every exported type / function has JSDoc with at least description and `@example` where useful.
**AC**: No exported symbol is undocumented.
**Verify**: TypeDoc or grep-based audit script.

**✅ Checkpoint 10**: Docs complete.

---

## Phase 11 — Release prep

### T11.1 — Test harness in `src/testing/`
**Files**: `src/testing/policy-harness.ts`
**Deps**: T2.6
**Out**: `createPolicyHarness({ policies, customConditions })` returns `{ evaluate, principal: (override) => evaluate, fixtures }`. Smoke-tested.
**AC**: F15.
**Verify**: dedicated test.

### T11.2 — Perf sanity check
**Files**: `test/policy/perf.int.test.ts`
**Deps**: Phase 9
**Out**: 1000 policies × 100 evaluates < 100ms on dev machine. Captures baseline.
**AC**: F14.
**Verify**: `pnpm vitest run test/policy/perf.int.test.ts`.

### T11.3 — Top-level exports + tree-shake check
**Files**: `src/index.ts`
**Deps**: Phases 1–10
**Out**: Re-export from `src/middleware/policy/index.ts` and `src/ports/outbound/policy-engine.ts`. Verify with bundler analysis (or simple tsc-resolved imports) that an app NOT using policy doesn't pull in engine code.
**AC**: F1 invariant — module tree-shakeable.
**Verify**: build size diff before/after on a sample app.

### T11.4 — CHANGELOG + version bump
**Files**: `CHANGELOG.md` (if exists) or commit message, `package.json`
**Deps**: All previous
**Out**: Bump to 1.1.0. Highlight: opt-in policy engine, link to guide.
**AC**: Single commit, semver minor.
**Verify**: `pnpm pack --dry-run` succeeds.

### T11.5 — Final review pass
**Deps**: All
**Out**: Run `agent-skills:review` against the diff. Address findings.
**AC**: Five-axis review clean.
**Verify**: human sign-off.

**✅ Checkpoint 11**: Ready to merge.

---

## Task → Feature mapping

| Feature | Tasks |
|---------|-------|
| F1 (port + driver) | T0.2, T0.3, T11.3 |
| F2 (declarative policies, DSL) | T1.1, T2.1, T2.2, T2.3, T6.1 |
| F3 (effects) | T1.1, T2.5 |
| F4 (tenant) | T2.4 |
| F5 (loader) | T6.1, T6.2, T6.3 |
| F6 (principal adapters) | T3.1–T3.5 |
| F7 (per-procedure builder) | T1.3, T4.1, T4.5 |
| F8 (multi-protocol + streams) | T4.2, T4.3, T4.4, T9.1 |
| F9 (ctx helpers) | T5.1, T5.2 |
| F10 (defaultMode) | T4.5 |
| F11 (pipeline) | T1.2, T1.4 |
| F12 (error + log shape) | T7.1, T7.2 |
| F13 (discovery) | T7.4, T8.1, T8.2 |
| F14 (perf) | T1.1 (compile), T2.6 (principal cache), T5.2 (resolver dedup), T11.2 |
| F15 (harness) | T11.1 |
| F16 (failure safety) | T7.3 |

---

## Parallelization notes

After Phase 1 (tracer), the following can run **in parallel**:
- Phase 2 (engine completeness)
- Phase 3 (principal adapters)
- Phase 4 (multi-protocol coverage)

Phase 5 needs Phase 2 done. Phase 6 needs Phase 2 done. Phase 7 needs Phases 1–4. Phase 8 needs Phase 7. Phase 9 needs Phase 4.

For a one-engineer flow: linear is fine. For multi-engineer: split Phase 2 + Phase 3 + Phase 4 across people post-checkpoint 1.

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Tracer-bullet (Phase 1) takes longer than expected → drift | Hard time-box: 1 day max for Phase 1. If overrun, surface early. |
| Existing builder API too rigid for `.authz()` extension | Investigate `src/server/handler-builders.ts` in T1.3 before implementing; raise blocker if found. |
| OAuth2/OIDC interceptor output shape unknown | Read `src/middleware/auth/oauth2.ts` during T3.3; document discovered shape in code comment. |
| MCP integration surface unclear | Read existing `src/mcp/docs/*` patterns in T8.2; mirror conventions. |
| Tree-shake leak (T11.3) | Confirm with sample build before claiming F1 done. |

---

## Out-of-plan reminders (from spec §8)

These are **not** in this plan and must be rejected if asked mid-implementation:
- Hot-reload watcher
- Decision result cache
- Action prefix index
- TCP/UDP support
- Multi-policy-per-procedure chaining
- Ref drivers for OPA/Cedar/Casbin
