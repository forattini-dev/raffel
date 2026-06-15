# Co-located Policies

> **Drop a policy file next to the code it protects. Raffel wires it up automatically.**

Co-location replaces the "centralised policy directory + manual `.authz()` glue" pattern with file-system convention. A `*.policy.{yaml,yml,json}` file living next to a discovered handler — or a `_policy.{yaml,yml,json}` cascading from any folder — is auto-loaded, attached to the engine, and bound to every operation it covers. No `policy.policies` array entry. No builder code on the procedure. The code *is* in one place; the rules *are* in one place; they happen to be the same place.

This guide covers the full convention shipped across issues **#92–#97**:

| Slice | What it gives you |
|---|---|
| [#92](#sibling-files-92) | Sibling `<handler>.policy.yaml` for procedure-style handlers |
| [#93](#folder-cascade-93) | `_policy.yaml` cascading down a discovery tree |
| [#94](#resource-scope-94) | Same conventions covering REST/resource CRUD surfaces |
| [#95](#channel-scope-95) | Sibling and folder rules for WebSocket channels |
| [#96](#scope-filter-96) | `scope.protocols` / `scope.routes` / `scope.channels` to narrow applicability |
| [#97](#coverage-report-97) | `server.policyCoverage()` to surface un-policied surfaces |

---

## TL;DR

```text
src/
  http/
    _policy.yaml              ← cascade applies to every handler under http/
    leads/
      get.ts
      get.policy.yaml         ← sibling, applies only to leads/get
  channels/
    chat.ts
    chat.policy.yaml          ← sibling, applies to subscribes on `chat`
  resources/
    users.ts
    _policy.yaml              ← cascade covers every operation users.* exposes
```

```ts
const server = createServer({
  port: 3000,
  discovery: true,
  policy: {
    principal: { from: 'session' },
    defaultMode: 'deny',
    policies: [],            // root list stays empty — discovery fills it
  },
})
await server.start()

// Audit what made it through
const report = server.policyCoverage()
if (report?.gaps.length) throw new Error(`Un-policied: ${report.gaps.map(g => g.name).join(', ')}`)
```

That's the whole convention. Discovery walks the tree, the resolver pairs files with handlers, the bridge attaches policies to the engine, and coverage tells you what slipped through.

---

## How it works

1. **FS discovery** loads handlers from each enabled directory (`./src/http`, `./src/rpc`, `./src/streams`, `./src/rest`, `./src/resources`, `./src/channels`).
2. **The resolver** walks every loaded handler and pairs it with:
   - a sibling `<handler>.policy.{yaml,yml,json}` file (highest precedence within file sources), and
   - every ancestor `_policy.{yaml,yml,json}` between the handler's directory and the discovery root (broader → closer).
3. **The loader** parses each file, validates against the published JSON schema, and resolves `customCondition` strings to TS functions.
4. **The bridge** appends the discovered policies to the engine via `addPolicies()` and synthesises an `.authz({ action: '<name>' })` interceptor for the underlying registry entry. Channel registrations bind through a dedicated enforcer that runs at subscribe time.
5. **Programmatic registrations win.** If `server.procedure('x')` is called for the same name, discovery's bridge skips it — the explicit `.authz()` (or absence of one) is what survives.

Validation is eager and fail-fast: malformed YAML, schema violations, unknown `customCondition` references — all surface at boot, never at request time.

---

## Sibling files (#92)

A `<handler>.policy.{yaml,yml,json}` next to a handler covers that one operation.

```text
src/http/leads/get.ts
src/http/leads/get.policy.yaml
```

```yaml
# src/http/leads/get.policy.yaml
id: leads-read-allow
effect: allow
principals:
  - scope:lead.read
actions:
  - leads/get
resources:
  - "**"
```

The `actions` field is matched against the discovered route name (e.g. `leads/get`). The bridge uses that same name as `defaultAction` when synthesising the interceptor, so the action pattern in the policy and the action passed to the engine line up by default.

A single file may contain a single document or an array:

```yaml
# Multiple rules in one sibling file
- id: leads-read
  effect: allow
  principals: [scope:lead.read]
  actions: [leads/get]
  resources: ["**"]
- id: leads-read-deny-archived
  effect: deny
  principals: ["*"]
  actions: [leads/get]
  resources: ["**"]
  match:
    'resource.archived': true
```

Both YAML and JSON are accepted (`.yaml`, `.yml`, `.json`). YAML is recommended for human-authored policies because of comments and multi-line strings.

---

## Folder cascade (#93)

A `_policy.{yaml,yml,json}` in any directory under the discovery tree applies to every handler at or below that directory. Cascade walks broader → closer:

```text
src/http/_policy.yaml             ← applies to everything under src/http
src/http/admin/_policy.yaml       ← applies only under src/http/admin
src/http/admin/users/get.ts       ← gets BOTH cascade rules + any sibling
```

Apply order at evaluation time: broadest cascade first → narrower cascades → sibling. The default in-process engine dedupes by `id` when `addPolicies()` is called twice with the same id, so:

- A nearer `_policy.yaml` re-declaring the same `id` **replaces** the broader one (nearest-wins for conflicting ids).
- Different ids accumulate. Deny precedence in the engine still bites — a broader `deny` is not silenced by a closer `allow` at a different id.

The cascade is bounded to the discovery tree. A `_policy.yaml` placed *above* the configured discovery root is never read.

```yaml
# src/http/_policy.yaml — baseline for every HTTP handler
id: tenant-isolation
effect: deny
principals: ["*"]
actions: ["**"]
resources: ["**"]
match:
  'resource.tenantId': '!@principal.tenantId'
```

---

## Resource scope (#94)

REST resources (`./src/rest/users.ts`) and the resources tree (`./src/resources/users.ts`) participate in the same convention. A sibling `<resource>.policy.yaml` or a `_policy.yaml` higher in the tree covers every CRUD operation the resource exposes.

```text
src/resources/users.ts
src/resources/users.policy.yaml   ← covers users.list, users.get, users.create, users.update, …
```

```yaml
# src/resources/users.policy.yaml
- id: users-readers
  effect: allow
  principals: [scope:users.read]
  actions: [users.list, users.get]
  resources: ["**"]
- id: users-writers
  effect: allow
  principals: [scope:users.write]
  actions: [users.create, users.update, users.patch, users.delete]
  resources: ["**"]
```

Operation names follow the standard registry convention: `<resource>.<operation>` (e.g. `users.list`, `users.get`, `users.create`). Use `actions: ["users.*"]` to cover every CRUD verb in one rule.

Folder cascade applies the same way: a `_policy.yaml` directly inside `src/resources/` covers every resource folder beneath it.

The synthesized authz bridge now resolves a real policy resource instead of the
old action-only placeholder:

- Collection routes (`list`, `create`, collection `head/options`) use
  `{ type: '<resource>', id: '*', tenantId: principal.tenantId }`.
- Item routes (`get`, `update`, `patch`, `delete`, item `head/options`, item
  actions) use `{ type: '<resource>', id: '<route id>', tenantId: ... }`.
- `attrs` includes the operation plus available input, params, and query data.

For domain rules that need loaded-record fields such as owner, assignee, or a
tenant resolved from storage, export `config.policyResource` from the resource
file:

```ts
export const config = {
  policyResource: async (input, ctx) => {
    const lead = await ctx.services.leads.get(input.id)
    return {
      type: 'lead',
      id: lead.id,
      tenantId: lead.tenantId,
      attrs: { ownerId: lead.ownerId },
    }
  },
}
```

---

## GraphQL resource scope

GraphQL resource files participate in the same convention:

```text
src/graphql/leads.graphql.ts
src/graphql/leads.graphql.policy.yaml
src/graphql/_policy.yaml
```

Co-located GraphQL policies are registered into the same policy engine after
FS discovery and before GraphQL resolvers evaluate field authorization. The
resource file still declares *where* to enforce policy through `authorize` and
`authz`; the policy file supplies the rules:

```ts
export default graphqlResource({
  name: 'Lead',
  schema,
  queries: {
    list: {
      field: 'leads',
      many: true,
      resolver: (_parent, args, ctx) => ctx.services.leads.list(args),
      authz: {
        action: 'lead.read',
        resource: (lead) => ({ type: 'lead', id: lead.id, tenantId: lead.tenantId }),
        onDeny: 'filter',
      },
    },
  },
})
```

```yaml
# src/graphql/leads.graphql.policy.yaml
id: lead-read
effect: allow
principals: [scope:lead.read]
actions: [lead.read]
resources: [lead:*]
```

GraphQL co-located policies are automatically scoped to the `graphql` protocol
unless the policy already declares `scope.protocols`.

---

## Channel scope (#95)

WebSocket channels follow the same conventions. The bridge enforces co-located rules at **subscribe time** — unauthorised principals cannot join the channel; the channel handler never runs for them.

```text
src/channels/chat.ts
src/channels/chat.policy.yaml     ← sibling, covers `chat`
src/channels/_policy.yaml         ← cascade, covers every channel under src/channels
```

```yaml
# src/channels/chat.policy.yaml
id: chat-allow-members
effect: allow
principals:
  - scope:chat.read
actions:
  - chat               # action == channel name
resources:
  - "**"
```

The synthetic action passed to the engine is the channel name. Resources are emitted as `{ type: 'channel', id: '<name>', tenantId: principal.tenantId }`, so policies that need finer scoping can do `resources: ['channel:chat']` or match by `match.'resource.id'`.

> **Subscribe vs publish/connect:** the current bridge enforces at subscribe time. Per-message publish authorization remains the channel handler's responsibility (the policy engine is still callable via `ctx.policy` from the handler).

---

## Scope filter (#96)

A policy can declare a `scope` block to limit when it even *considers* matching:

```yaml
id: chat-readonly-on-ws
effect: allow
principals: ["*"]
actions: ["**"]
resources: ["**"]
scope:
  protocols: [websocket]   # only when the request arrived over WS
  channels:  [chat-*]      # only for channels matching this glob
```

Scope facets:

| Facet | Matched against |
|---|---|
| `scope.protocols` | `AuthzInput.protocol` — populated from `ctx.protocol` by every adapter (`http`, `websocket`, `grpc`, `jsonrpc`, `tcp`, `udp`). |
| `scope.routes` | `AuthzInput.action` — same value the procedure's action pattern matches. Use this when you want a "this rule applies only to admin/* routes" baseline without modifying `actions`. |
| `scope.channels` | `AuthzInput.action` — same as `routes` but named for the channel use case. They're equivalent at the engine level; pick the name that documents intent. |

Behaviour:

- Every facet is **optional**. Omitting a facet means "do not filter on this dimension". A policy with no `scope` at all applies everywhere — same as before #96.
- Within a facet, patterns OR together (`['admin/*', 'super/*']` matches either prefix).
- Across facets, AND (every declared facet must match).
- A policy filtered out by scope is short-circuited entirely — it does not contribute to `candidatePolicies` diagnostics, keeping reports quiet.

Pattern syntax is the same glob form used by `principals`/`actions`/`resources`:

| Glob | Matches |
|---|---|
| `*` | One segment (no `:` or `.`) |
| `**` | Anything, across separators |
| `?` | One character (not `:` or `.`) |
| `{a,b,c}` | Alternation |

Common recipes:

```yaml
# Apply only to HTTP requests:
scope: { protocols: [http] }

# Apply to anything under /admin/:
scope: { routes: [admin/**] }

# Apply to chat-* channels but only over WS:
scope: { protocols: [websocket], channels: [chat-*] }

# A WS-only public health channel:
scope: { protocols: [websocket], channels: [health] }
```

---

## Coverage report (#97)

`server.policyCoverage()` returns a structured snapshot of what's covered and what isn't. Returns `null` when no policy bootstrap is configured.

```ts
const report = server.policyCoverage()
// {
//   defaultMode: 'deny',
//   total:    14,
//   covered:  10,
//   public:    1,        // explicit `.authz({ public: true })`
//   gaps: [
//     { name: 'orders/list', kind: 'procedure', location: '/abs/src/http/orders/list.ts' },
//     { name: 'metrics',     kind: 'channel',   location: '/abs/src/channels/metrics.ts' },
//   ],
// }
```

Pipe it through CI to fail builds that ship un-policied surfaces:

```ts
// scripts/audit-policies.ts
import { createServer } from 'raffel'
import config from '../src/server.js'

const server = createServer(config)
await server.start()

const report = server.policyCoverage()
await server.stop()

if (report && report.defaultMode === 'deny' && report.gaps.length > 0) {
  console.error('Un-policied surfaces detected under defaultMode: deny:')
  for (const gap of report.gaps) {
    console.error(`  ${gap.kind.padEnd(12)} ${gap.name}  (${gap.location ?? 'programmatic'})`)
  }
  process.exit(1)
}
```

How "covered" is determined:

- A name is **covered** if any policy interceptor was synthesised for it during boot — through the co-located bridge, REST/resource registration, channel enforcer, or explicit `.authz({...})`.
- A name is **public** if it was registered with `.authz({ public: true })` — explicit sign-off that no policy is intentional.
- A name is a **gap** otherwise. Under `defaultMode: 'deny'` gaps result in 403 at request time, so the report should be empty before shipping.

The total set of names walked includes every `registry.listProcedures()` entry plus every channel in `channelRegistry`. TCP/UDP handlers are not yet covered (different lifecycle — see [Out of scope](#out-of-scope)).

---

## Precedence — the full picture

Five sources of policy can converge on a single registered name. Apply order, top to bottom:

| # | Source | Notes |
|---|---|---|
| 1 | Programmatic `server.procedure(...).authz({...})` | Explicit code wins. Discovery never overwrites it. |
| 2 | Sibling `<handler>.policy.*` | Highest file-based precedence for that one handler/resource/channel. |
| 3 | Nearest ancestor `_policy.*` | Nearer cascade wins over broader cascade for conflicting ids. |
| 4 | Broader ancestor `_policy.*` | Up to the discovery root (never above). |
| 5 | Root `policy.policies` / `policy.loadFromDir` | Centralised baseline that applies regardless of co-location. |

At evaluation time, the engine treats every applicable policy independently — `deny` always wins over `allow` (engine semantics, not file source). The co-location ordering controls *which* policies are loaded, *not* the engine's allow/deny resolution.

---

## File naming reference

| File pattern | Where | Covers |
|---|---|---|
| `<name>.policy.yaml` | next to a handler | the operation registered from that file |
| `<name>.policy.yml` | next to a handler | same as `.yaml` |
| `<name>.policy.json` | next to a handler | same as `.yaml`, JSON syntax |
| `_policy.yaml` | any directory | every handler at or below |
| `_policy.yml` | any directory | same |
| `_policy.json` | any directory | same |

The `_policy` prefix follows the same convention Raffel uses for `_middleware`, `_auth`, and `_meta` — leading underscore signals "this configures the surrounding folder, not a route".

---

## Schema

The loader validates each parsed document against the same JSON schema used for centralised policies, with one extension — the optional `scope` block. Field-by-field:

```yaml
id:           string             # required, unique within the engine
description:  string             # optional, surfaces in MCP discovery
effect:       allow | deny | audit
principals:   string[]           # globs against the principal set
actions:      string[]           # globs against AuthzInput.action
resources:    string[]           # globs against `${resource.type}:${resource.id}`
match:        MatchNode          # optional declarative match DSL (see match-dsl.md)
customCondition: string          # optional named condition (registered TS-side)
scope:                           # optional applicability filter (see #96)
  protocols: string[]            # globs against AuthzInput.protocol
  routes:    string[]            # globs against AuthzInput.action
  channels:  string[]            # globs against AuthzInput.action
```

`match` and `customCondition` are still mutually exclusive (existing rule).

---

## Opting out

Pass `policy.coLocated: false` to disable bridge-loading entirely while keeping FS discovery active:

```ts
createServer({
  port: 3000,
  discovery: true,
  policy: {
    principal: { from: 'session' },
    policies: [...],
    coLocated: false,
  },
})
```

Useful when migrating off a co-located convention to a centralised policy directory, or when running ad-hoc fixtures in tests without policies you don't want to declare files for.

---

## Engine driver requirements

The bridge calls `engine.addPolicies(policies)` to register discovered rules after engine construction. The default in-process engine implements it. Custom drivers may omit `addPolicies` from their `PolicyEnginePort` — the bridge logs a structured warning per route and skips co-located bridging for that surface (the engine continues to evaluate any policies it was constructed with).

Co-located policy ids are materialized before they enter the global engine:
the author-facing `id` is preserved in the suffix, but Raffel prefixes it with
a stable source/scope key. This keeps `id: read` in two sibling files from
overwriting each other while preserving local cascade semantics where a closer
policy with the same id replaces a broader one for that operation.

If you implement a custom driver and want co-location to work end-to-end:

```ts
const customEngine: PolicyEnginePort = {
  evaluate(input) { /* ... */ },
  list() { /* ... */ },
  addPolicies(policies) {
    // append to whatever backing store; dedupe by id if the bridge replays
  },
}
```

---

## Validation and error surfaces

| Failure | Where it surfaces |
|---|---|
| YAML / JSON parse error | Boot — error includes file path and parser message |
| Schema violation | Boot — error cites file path, array index (when applicable), and AJV path |
| Unknown `customCondition` name | Boot — error names the policy id and the missing condition |
| Engine missing `addPolicies` | Boot — structured warning; bridge silently skips |
| Sibling file references nonexistent handler | Boot — file is loaded but unused (no enforcement); coverage report still flags the handler-less file via [#97](#coverage-report-97) gap analysis when applicable |

The principle: misconfiguration fails the boot, not the request.

---

## Hot reload

When FS discovery hot reload is enabled, co-located policy files are watched
alongside handler files. Changes to `_policy.yaml`, `_policy.yml`,
`_policy.json`, `<handler>.policy.yaml`, `<handler>.policy.yml`, and
`<handler>.policy.json` trigger a discovery reload and re-register the API
policy surface. Markdown documentation files have their own reload rules and
are not coupled to policy reloads.

---

## Out of scope

Things this convention deliberately doesn't try to do (see the linked issues for context):

- **TCP/UDP** — connection-based protocols. Co-location semantics for raw sockets need a different model (per-connection IP allow/deny vs. per-request principal/action). Not in #92–#97.
- **Per-message publish authorization on channels** — the bridge enforces at subscribe time. Per-message rules belong in the channel handler, which can call the engine via `ctx.policy.evaluate(...)` directly.
- **Auto-generated CRUD policies** — there's no codegen that produces a baseline `_policy.yaml` for a resource. Author it once, deploy.
- **TypeScript inference for `.authz({ resource: ... })`** — separate work; today the resource callback is `any`.

---

## Related

- [Policies overview](./README.md) — the centralised model and `.authz()` API.
- [Match DSL](./match-dsl.md) — the `match` field's full reference.
- [Patterns & recipes](./patterns.md) — RBAC, multi-tenant, owner-or-admin, etc.
- [API reference](../reference/policies-api.md) — type signatures for policy config and bootstrap.
