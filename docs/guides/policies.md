# Authorization Policies

> **Declarative authorization for Raffel servers.**
> Define *who* can do *what* to *which resource* under *which conditions* — without imperative auth code in handlers.

## ✅ Fully opt-in

Policies are **completely optional**. Raffel runs perfectly without them:

```ts
// No policy config? No engine. No overhead. Server works exactly as before.
const server = createServer({ port: 3000 })
server.procedure('hello').handler(async () => ({ ok: true }))
await server.start()
```

When you don't pass `policy: { ... }` to `createServer`:

- `server.policy` is `undefined`
- No engine code is initialised
- No interceptors are added to your procedures
- MCP discovery shows zero policy resources
- Calling `.authz()` on a procedure throws a clear configuration-required error

You opt in by adding `policy: { ... }` to `createServer({})`. Everything in this guide assumes you've made that choice.

Inspired by the AWS IAM model (allow / deny / audit, principal + action + resource + condition), adapted for an in-process Node.js engine.

## Table of contents

1. [Why policies?](#why-policies)
2. [Mental model](#mental-model)
3. [Quickstart](#quickstart)
4. [Concepts](#concepts)
   - [Principal](#principal)
   - [Action](#action)
   - [Resource](#resource)
   - [Effect](#effect)
   - [Decision](#decision)
   - [Tenant isolation](#tenant-isolation)
5. [Wildcards](#wildcards)
6. [Match DSL — declarative conditions](#match-dsl--declarative-conditions)
7. [TS `condition` functions](#ts-condition-functions)
8. [JSON loader & customConditions](#json-loader--customconditions)
9. [Ctx helpers](#ctx-helpers)
10. [Default mode + public escape](#default-mode--public-escape)
11. [Module-level inheritance](#module-level-inheritance)
12. [Pipeline placement](#pipeline-placement)
13. [Error responses](#error-responses)
14. [Multi-protocol behaviour](#multi-protocol-behaviour)
15. [Common patterns](#common-patterns)
16. [Troubleshooting](#troubleshooting)
17. [Performance notes](#performance-notes)

---

## Why policies?

Without a policy engine, authorization gets scattered across handlers:

```ts
// Before — repeated in every handler that touches a lead
server.procedure('lead.read').handler(async ({ id }, ctx) => {
  const lead = await db.leads.get(id)
  if (lead.tenantId !== ctx.auth.tenantId) throw forbidden()
  if (lead.status === 'archived') throw forbidden()
  if (lead.assignedTo !== ctx.auth.principal && !ctx.auth.roles.includes('admin')) {
    throw forbidden()
  }
  return lead
})
```

With policies, the gate is declarative and centralised:

```ts
// After
server.procedure('lead.read')
  .authz({ resource: ({ id }) => loadLead(id) })
  .handler(async ({ id }) => loadLead(id))
```

Policies live elsewhere (TS or JSON):

```ts
{
  id: 'leads-read-own',
  effect: 'allow',
  principals: ['scope:lead.read'],
  actions: ['lead.read'],
  resources: ['lead:*'],
  match: { 'resource.assignedTo': '@principal.id' },
}
```

The handler becomes about *what to return*, not *who is allowed*.

---

## Mental model

```
┌──────────────────────────────────────────────────────────────┐
│   Request                                                    │
│   ────────                                                   │
│   1. Connection filter        ◄── (allowlist/denylist IPs)   │
│   2. Session attach           ◄── (ctx.session)              │
│   3. Auth (OAuth2/OIDC/...)   ◄── (ctx.auth)                 │
│   4. Rate limit                                              │
│   5. Validation (Zod input)                                  │
│   6. Policy interceptor      ◄── ★ this guide                │
│      ├── Resolve principal (cached per request)              │
│      ├── Resolve resource (your fn, async ok)                │
│      ├── engine.evaluate(input)  → Decision                  │
│      └── Allow → next() │ Deny → throw 403                   │
│   7. Custom interceptors                                     │
│   8. Handler                                                 │
└──────────────────────────────────────────────────────────────┘
```

A policy fully matches when **all four** match:

| Field | Matches against |
|---|---|
| `principals` | The compiled principal set: `id`, `user:id`, each `scope:*`, each `group:*`, plus `*` |
| `actions` | The action string (defaults to procedure name) |
| `resources` | The resource tag `<type>:<id>` |
| `condition` / `match` | Free-form predicate or declarative DSL |

**Precedence** (top wins):

1. `tenant_mismatch` — principal and resource have different non-null `tenantId`
2. `explicit_deny` — at least one `deny` matched
3. `allow` — at least one `allow` matched
4. `implicit_deny` — nothing matched (default-closed)

`audit` policies match independently and never change `allowed` — their ids accumulate in `auditedPolicyIds` for shadow-testing.

---

## Quickstart

Install — no extra packages needed; the policy module ships with Raffel.

```ts
import { createServer } from 'raffel'
import type { Principal } from 'raffel/policy'

const server = createServer({
  port: 3000,
  policy: {
    // Where to read the principal from on every request.
    principal: { from: 'session' },

    // Inline policies (TS).
    policies: [
      {
        id: 'leads-read-own',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
        condition: ({ principal, resource }) =>
          resource.attrs?.assignedTo === principal.id,
      },
      {
        id: 'leads-deny-archived',
        effect: 'deny',
        principals: ['**'],
        actions: ['lead.read'],
        resources: ['lead:*'],
        match: { 'resource.status': 'archived' },
      },
    ],
  },
})

server
  .procedure('lead.read')
  .authz({
    resource: async ({ id }) => {
      const lead = await db.leads.get(id)
      return {
        type: 'lead',
        id: lead.id,
        tenantId: lead.tenantId,
        attrs: { assignedTo: lead.assignedTo, status: lead.status },
      }
    },
  })
  .handler(async ({ id }) => db.leads.get(id))
```

Try it:

```bash
# Logged-in seller reading their own active lead → 200
curl -X POST http://localhost:3000/lead.read -d '{"id":"l1"}'

# Same lead, but archived → 403 (deny beats allow)
# Different lead they don't own → 403 (no allow matched)
```

---

## Concepts

### Principal

The actor making the request — flat shape:

```ts
type Principal = {
  id: string                        // unique user id
  tenantId: string | null           // null = platform principal
  scopes: string[]                  // capability tokens
  groups: string[]                  // membership tokens
  attrs?: Record<string, unknown>   // arbitrary, e.g. role, deptId
}
```

Sources (configured via `policy.principal.from`):

| Source | Reads | Default mapping |
|---|---|---|
| `'session'` | `ctx.session.data.user` | Direct copy of `{id, tenantId, scopes, groups, attrs}` |
| `'oauth2'` | `ctx.auth` (OAuth2 interceptor output) | `claims.sub → id`, `claims.tid → tenantId`, `claims.scope` (split) → `scopes`, `claims.groups → groups` |
| `'oidc'` | `ctx.auth` with OIDC claims | Same as OAuth2 + `claims.org_id` fallback for tenant, prefers `claims.groups` over `claims.roles` |
| `'custom'` | Whatever you want | You pass `map: (raw, ctx) => Principal` |

Override mappings with `map`:

```ts
policy: {
  principal: {
    from: 'oauth2',
    map: (raw, ctx) => ({
      id: ctx.auth.claims.sub as string,
      tenantId: ctx.auth.claims.tenant as string ?? null,
      scopes: (ctx.auth.claims.permissions as string[]) ?? [],
      groups: (ctx.auth.claims['cognito:groups'] as string[]) ?? [],
      attrs: { plan: ctx.auth.claims.plan },
    }),
  },
}
```

The principal is **resolved once per request** and cached on ctx. Subsequent procedure invocations within the same request reuse it.

#### The compiled principal set

Before pattern matching, the engine expands the principal into a flat string set:

```
principal = { id: 's1', scopes: ['lead.read'], groups: ['channel:c1', 'admins'] }

→ ['s1', 'user:s1', 'scope:lead.read', 'group:channel:c1', 'group:admins', '*']
```

A policy's `principals` array is matched against this set. So a policy with `principals: ['group:admins']` matches any principal whose `groups` include `admins`.

**Bidirectionality** — a principal carrying a wildcard scope satisfies a narrower policy pattern:

```
principal scope:  'lead.**'
policy:           principals: ['scope:lead.read']
→ matches: lead.** is a superset of lead.read ✓
```

### Action

An action is a string. Defaults to the procedure name. Dot-namespaced by convention:

```
'lead.read'  'lead.update'  'lead.move.funnel'
'admin.users.delete'
```

Override on `.authz()`:

```ts
.authz({ action: 'lead.read.sensitive', resource: ... })
```

### Resource

The thing being acted upon:

```ts
type Resource = {
  type: string                      // dot-namespaced ('lead', 'order.draft')
  id: string                        // resource identifier
  tenantId: string | null           // null = global
  attrs?: Record<string, unknown>   // runtime data for match conditions
}
```

You provide a resolver per procedure:

```ts
.authz({
  resource: async (input, ctx) => ({
    type: 'lead',
    id: input.id,
    tenantId: ctx.auth.tenantId,
    attrs: { status: lead.status, assignedTo: lead.assignedTo },
  }),
})
```

The resolver may be **async** (DB hit), return an **array** (e.g. for `mode: 'any'`), or return **null** (skip resource matching, action+principal only — useful for `health.ping`).

### Effect

Three effects:

| Effect | Behaviour |
|---|---|
| `allow` | Grants access when the policy fully matches |
| `deny` | Blocks access when matched — wins over `allow` regardless of order |
| `audit` | Matches like the others but never changes `allowed`. IDs accumulate in `Decision.auditedPolicyIds` |

`audit` is for **shadow rollout**:

```
1. Deploy a new restrictive rule as `effect: 'audit'`
2. Watch `auditedPolicyIds` in logs for a week
3. Confirm no false positives
4. Flip to `effect: 'deny'` — zero surprises on day one
```

### Decision

Every evaluation returns:

```ts
type Decision = {
  allowed: boolean
  reason: 'allow' | 'explicit_deny' | 'implicit_deny' | 'tenant_mismatch'
  matchedPolicyIds: string[]      // ids of matching allow/deny policies
  auditedPolicyIds: string[]      // audit policies that matched (gate unaffected)
  candidatePolicies: {            // policies that almost matched (diagnostics)
    id: string
    effect: PolicyEffect
    missing: string[]             // which patterns failed: 'principals'|'actions'|'resources'
  }[]
  durationMs?: number
}
```

`candidatePolicies` is gold for debugging "implicit_deny" — it shows you which policies *almost* applied and what the principal lacked.

### Tenant isolation

Cross-tenant access is denied **before any policy runs**:

```
principal.tenantId = 'tA'
resource.tenantId  = 'tB'  // different
→ Decision: { allowed: false, reason: 'tenant_mismatch' }
```

Even an `allow` policy with `principals: ['**']` cannot override this. Use `tenantId: null` to opt out:

- **Principal** with `tenantId: null` — *platform principal*, crosses all tenants (e.g. internal admin)
- **Resource** with `tenantId: null` — *global resource*, any tenant may access (e.g. public catalog)

---

## Wildcards

Glob-style patterns in `principals`, `actions`, and `resources`. Segments are split by `.` and `:`.

| Token | Meaning | Example | Matches | Does NOT match |
|---|---|---|---|---|
| `*` | Any single segment | `*.read` | `lead.read`, `channel.read` | `lead.move.read` (crosses dots) |
| `**` | Globstar — crosses dots/colons | `lead.**` | `lead.read`, `lead.move.funnel` | `channel.read` |
| `?` | Exactly one character | `lead:l?` | `lead:l1`, `lead:la` | `lead:l12`, `lead:l` |
| `{a,b}` | Alternation | `lead.{create,update}` | `lead.create`, `lead.update` | `lead.delete` |
| `[abc]` | Character class | `lead:l[12]` | `lead:l1`, `lead:l2` | `lead:l3` |
| `[a-z]` | Range | `lead:l[a-c]` | `lead:la`, `lead:lc` | `lead:ld` |

Combine freely:

```ts
{ actions: ['lead.{create,update,delete}'] }
{ resources: ['lead:l[0-9]??'] }       // lead:l1ab, etc.
{ principals: ['scope:lead.{read,claim}', 'group:admins'] }
```

---

## Match DSL — declarative conditions

The `match` field is a JSON-friendly tree compiled to a predicate at startup. Use it instead of `condition` functions when you need policies to live in `.json` files.

### Path resolution

| Path | Resolves to |
|---|---|
| `action` | `input.action` |
| `principal.id` | `input.principal.id` |
| `principal.tenantId` | `input.principal.tenantId` |
| `principal.scopes` | array |
| `principal.groups` | array |
| `principal.attrs.<key>` | `input.principal.attrs?.[key]` |
| `resource.id` | `input.resource.id` |
| `resource.type` | `input.resource.type` |
| `resource.tenantId` | `input.resource.tenantId` |
| `resource.attrs.<key>` | `input.resource.attrs?.[key]` (explicit) |
| `resource.<key>` | `input.resource.attrs?.[key]` (shorthand) |
| `context.<key>` | `input.context?.[key]` |

### Literal equality

```ts
match: { 'resource.status': 'active' }                  // ===
match: { 'resource.assignedTo': null }                  // strict null
match: { 'resource.type': '*' }                         // always passes (documents intent)
```

Multiple keys at the root = implicit `allOf`:

```ts
match: {
  'resource.status': 'active',
  'principal.attrs.role': 'manager',
}
```

### `@ref` — compare paths

```ts
match: { 'resource.assignedTo': '@principal.id' }
// → resource.attrs.assignedTo === principal.id

match: { 'resource.channelId': '@principal.groups' }
// → channelId is in principal.groups (scalar-vs-array → includes)

match: { 'principal.scopes': '@resource.allowedScopes' }
// → array-vs-array → intersection
```

### `!` — negation

```ts
match: { 'resource.status': '!archived' }               // !==
match: { 'resource.assignedTo': '!@principal.id' }      // not the owner
```

### Operators

```ts
// Equality (explicit form)
match: { 'resource.status': { '==': 'active' } }
match: { 'resource.status': { '!=': 'archived' } }

// Numeric / lexicographic
match: { 'resource.amount': { '<': 10000 } }
match: { 'resource.score': { '<=': 99 } }
match: { 'resource.priority': { '>': 3 } }
match: { 'resource.rank': { '>=': 1 } }

// Membership
match: { 'resource.status': { in: ['active', 'pending'] } }
match: { 'resource.status': { notIn: ['archived', 'deleted'] } }
match: { 'resource.channelId': { in: '@principal.groups' } }   // resolve from input

// String / array
match: { 'resource.id': { regex: '^lead-\\d+$' } }
match: { 'resource.id': { startsWith: 'lead-' } }
match: { 'resource.slug': { endsWith: '-draft' } }
match: { 'resource.tags': { contains: 'vip' } }      // array.includes or string.includes

// Existence
match: { 'resource.assignedTo': { exists: true } }   // present (even if null)
match: { 'resource.deletedAt': { exists: false } }   // absent
```

### Composition

```ts
// OR
match: {
  anyOf: [
    { 'resource.assignedTo': '@principal.id' },     // own
    { 'resource.sharedWith': '@principal.id' },     // shared
  ]
}

// AND (explicit; same as root-level multi-key)
match: {
  allOf: [
    { 'resource.channelId': '@principal.groups' },
    { 'resource.status': 'active' },
  ]
}

// NOT
match: {
  not: { 'resource.assignedTo': '@principal.id' }    // peer review (not the owner)
}

// Nesting works:
match: {
  anyOf: [
    {
      allOf: [
        { 'resource.channelId': '@principal.groups' },
        { 'principal.attrs.role': 'manager' },
      ]
    },
    { 'principal.groups': { contains: 'admins' } },
  ]
}
```

> **Tip**: deep nesting often signals "this should be two separate policies." Prefer flat policy lists.

---

## TS `condition` functions

When the DSL doesn't fit (e.g. you need to call out to an external service or do complex logic), use a TS `condition`:

```ts
{
  id: 'biz-hours-only',
  effect: 'deny',
  principals: ['**'],
  actions: ['lead.update'],
  resources: ['lead:*'],
  condition: ({ principal, resource, context, action }) => {
    const hour = new Date().getHours()
    return hour < 9 || hour >= 18
  },
}
```

**Both `condition` AND `match` may be present** — both must pass (implicit AND).

**If a `condition` throws**, the engine treats the policy as a non-match (NOT a server crash) and the error is logged. Your handler never sees a 500 from a policy bug.

---

## JSON loader & customConditions

For ops-friendly policy management, store policies as JSON and load them at boot:

```
policies/
├── leads.json
├── orders.json
└── admin/
    └── users.json
```

```jsonc
// policies/leads.json
[
  {
    "id": "leads-read-own",
    "effect": "allow",
    "principals": ["scope:lead.read"],
    "actions": ["lead.read"],
    "resources": ["lead:*"],
    "match": { "resource.assignedTo": "@principal.id" }
  }
]
```

Wire it up:

```ts
const server = createServer({
  policy: {
    principal: { from: 'session' },
    loadFromDir: './policies',
    customConditions: {
      // Named TS condition referenced from JSON via "customCondition": "name"
      isBusinessHours: () => {
        const h = new Date().getHours()
        return h >= 9 && h < 18
      },
    },
  },
})
```

```jsonc
// policies/admin/biz-hours.json
{
  "id": "block-non-biz-hours",
  "effect": "deny",
  "principals": ["**"],
  "actions": ["lead.update"],
  "resources": ["lead:*"],
  "customCondition": "isBusinessHours"
}
```

### Validation behaviour

The loader is **strict and eager**:

- JSON parse errors → throw at boot (file path included)
- Schema validation (Ajv against `policy/schema.json`) → throw with JSON-pointer location
- `customCondition` referenced but not registered → throw with policy id + name
- Empty `principals`/`actions`/`resources` arrays → warning logged ("dead policy — never matches")
- Duplicate `id` between inline and JSON → JSON wins, warning logged

### Merge order

```
inline policies (passed via policy.policies)
    ↓
JSON-loaded policies (from loadFromDir)
    ↓
JSON wins on duplicate id (warning emitted)
```

### What JSON CAN'T do

JSON policies cannot contain `condition` functions (they aren't serializable). Use `customCondition: "name"` to point at a registered TS function instead. The condition lives in your code; the JSON only references it by name.

---

## Ctx helpers

Inside a handler, you can run ad-hoc policy checks via `ctx.policy`:

```ts
server
  .procedure('lead.read.full')
  .authz({ resource: ({ id }) => loadLead(id) })
  .handler(async ({ id }, ctx) => {
    const lead = await db.leads.get(id)

    // Check a derived permission, e.g. for sensitive fields
    const decision = await ctx.policy.evaluate('lead.read.sensitive', {
      type: 'lead',
      id: lead.id,
      tenantId: lead.tenantId,
      attrs: { sensitivity: lead.sensitivity },
    })

    if (!decision.allowed) {
      lead.financials = undefined
      lead.notes = undefined
    }

    return lead
  })
```

For listings, `filterResources` keeps only allowed resources:

```ts
.handler(async (_, ctx) => {
  const allLeads = await db.leads.list()
  const visibleLeads = await ctx.policy.filterResources('lead.read', allLeads)
  return visibleLeads
})
```

**Dedup**: within one request, `evaluate` and `filterResources` cache decisions by `(action, resource.type:resource.id)`. Calling them multiple times with overlapping resources is cheap.

---

## Default mode + public escape

By default, procedures **without** `.authz()` pass through unauthorized:

```ts
policy: {
  principal: { from: 'session' },
  defaultMode: 'allow',  // default
}

server.procedure('health.ping').handler(async () => ({ ok: true }))
// → 200, no policy check, fine for public endpoints
```

For maximum safety, flip to `'deny'`. Now any procedure without `.authz()` returns 403:

```ts
policy: {
  principal: { from: 'session' },
  defaultMode: 'deny',
}

server.procedure('health.ping').handler(async () => ({ ok: true }))
// → 403 'NO_POLICY_DECLARED'

// Opt out explicitly:
server
  .procedure('health.ping')
  .authz({ public: true })       // ← intentional no-auth
  .handler(async () => ({ ok: true }))
// → 200
```

Recommendation: **start with `'allow'`**, ship features, then flip to `'deny'` once your policy catalog is mature. The flip is one line.

---

## Module-level inheritance

Router modules can declare authz defaults applied to all their procedures:

```ts
import { createRouterModule } from 'raffel'

const leads = createRouterModule('leads', {
  authz: {
    resource: async ({ id }) => loadLead(id),
  },
})

leads.procedure('read').handler(async ({ id }) => loadLead(id))
leads.procedure('update').handler(async (input) => updateLead(input))

server.mount('', leads)
```

Both `leads.read` and `leads.update` use the module's default resource resolver. Per-procedure `.authz()` always wins:

```ts
leads
  .procedure('special')
  .authz({
    action: 'leads.special.read',                    // override
    resource: () => ({ type: 'special', id: 's1', tenantId: 't1' }),
    mode: 'any',
  })
  .handler(...)
```

---

## Pipeline placement

Order is fixed:

```
ConnectionFilter → Session → Auth → Rate-limit → Validation
  → Policy   ← ★
  → Custom interceptors
  → Handler
```

**Why**:
- Validation first → resolver receives typed input
- Rate-limit before policy → anti-DoS protects auth-failed retries
- Policy before custom interceptors → custom interceptors can read `ctx.policyDecision` for telemetry/auditing

`ctx.policyDecision` is populated whenever the policy interceptor runs (even on allow). Use it from custom interceptors for logging or metrics:

```ts
server.use(async (envelope, ctx, next) => {
  const result = await next()
  const decision = (ctx as any).policyDecision
  if (decision?.auditedPolicyIds.length > 0) {
    logger.info({ audited: decision.auditedPolicyIds }, 'audit policies fired')
  }
  return result
})
```

---

## Error responses

When a policy denies, the interceptor throws `RaffelError('PERMISSION_DENIED', ...)` which becomes HTTP 403 (or the protocol-equivalent error).

**Body shape depends on `NODE_ENV`**:

### Development / test

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Policy denied",
    "details": {
      "error": "forbidden",
      "code": "POLICY_DENIED",
      "reason": "explicit_deny",
      "action": "lead.read",
      "principal": { "id": "s1", "tenantId": "t1" },
      "matchedPolicyIds": ["leads-deny-archived"],
      "candidatePolicies": [
        { "id": "leads-read-own", "missing": [] }
      ]
    }
  }
}
```

`candidatePolicies` shows you which policies *almost* matched — invaluable for debugging.

### Production (`NODE_ENV=production`)

```json
{
  "error": {
    "code": "PERMISSION_DENIED",
    "message": "Policy denied",
    "details": {
      "error": "forbidden",
      "code": "POLICY_DENIED"
    }
  }
}
```

Zero policy ids leak. Production responses are intentionally opaque.

---

## Multi-protocol behaviour

The policy interceptor is **transport-agnostic**. The same `.authz()` declaration works across:

| Protocol | Notes |
|---|---|
| HTTP RPC | Default — POST `/<procedure>` |
| JSON-RPC | Body method matches procedure name |
| WebSocket RPC | One eval per request frame |
| gRPC | Same as HTTP RPC |
| Server stream | One eval at stream open |
| Streams (server / client / bidi) | Use `ctx.policy.evaluate()` inside the handler loop — see *Per-message authz in streams* below. The declarative `streamMode: 'per-message'` field is reserved for v1.x |
| TCP / UDP raw | Out of scope — use `ConnectionFilter` for IP/origin gating |

The principal is cached **per request** (HTTP, JSON-RPC, gRPC) or **per connection** (WS). Resource resolvers may be async — they are invoked once per resolved resource id within a single request.

### Per-message authz in streams

For server streams (one open call → many outbound frames), policy evaluates **once at stream open**. That's usually what you want — the principal and the stream's "subject" don't change.

For client / bidi streams (many inbound frames per call), where each frame may target a different resource, declare a stream that opens with a coarse gate, then re-check inside the handler with `ctx.policy.evaluate`:

```ts
server
  .stream('chat.send')
  .handler(async function* (input, ctx) {
    // ctx.principal is already populated by the outer authz check
    // (handled by your gate procedure or an explicit principal interceptor)

    for await (const msg of input.messages) {
      const decision = await ctx.policy.evaluate('chat.send', {
        type: 'channel',
        id: msg.channelId,
        tenantId: ctx.principal.tenantId,
      })

      if (!decision.allowed) {
        // Skip, drop, or close — your call.
        continue
      }

      yield processMessage(msg)
    }
  })
```

The `evaluate` is dedup'd per `(action, resource.id)` within a single request, so re-evaluating the same channel many times is cheap. The declarative `streamMode: 'per-message'` field is reserved on `ProcedurePolicyConfig` for v1.x — when it lands, the engine will run this exact pattern automatically.

---

## Common patterns

### RBAC (role-based)

```ts
{
  id: 'admins-can-everything',
  effect: 'allow',
  principals: ['group:admins'],
  actions: ['**'],
  resources: ['**'],
}
```

Where the principal mapper sets `groups` from the user's roles.

### ABAC (attribute-based)

```ts
{
  id: 'managers-read-dept',
  effect: 'allow',
  principals: ['scope:lead.read'],
  actions: ['lead.read'],
  resources: ['lead:*'],
  match: {
    'principal.attrs.role': 'manager',
    'resource.deptId': '@principal.attrs.deptId',
  },
}
```

### Multi-tenant SaaS

Set `tenantId` on every principal and resource. The engine handles isolation automatically. Add explicit `allow` policies on top.

### Owner-or-admin

```ts
{
  id: 'lead-edit',
  effect: 'allow',
  principals: ['**'],
  actions: ['lead.update'],
  resources: ['lead:*'],
  match: {
    anyOf: [
      { 'resource.assignedTo': '@principal.id' },
      { 'principal.groups': { contains: 'admins' } },
    ]
  },
}
```

### Time-windowed access

```ts
{
  id: 'no-writes-off-hours',
  effect: 'deny',
  principals: ['**'],
  actions: ['lead.{create,update,delete}'],
  resources: ['lead:*'],
  customCondition: 'outsideBusinessHours',
}
```

### Sensitive-field filter

Two procedures: outer for the "summary" (allowed broadly), inner for "full" (gated). Or: one procedure with `ctx.policy.evaluate('lead.read.sensitive', resource)` inside the handler.

### Shadow rollout

```ts
// Step 1: deploy as audit
{
  id: 'new-strict-rule',
  effect: 'audit',                          // ← shadow
  principals: ['scope:lead.read'],
  actions: ['lead.read'],
  resources: ['lead:*'],
  match: { 'resource.deptId': '@principal.attrs.deptId' },
}
```

Watch logs for `auditedPolicyIds: ['new-strict-rule']`. Once happy, change `effect` to `'deny'` (or `'allow'`).

### Emergency revocation

```ts
{
  id: 'block-suspended-user',
  effect: 'deny',
  principals: ['user:s99'],
  actions: ['**'],
  resources: ['**'],
}
```

Deploy this single policy via JSON without rebuilding the app.

---

## Troubleshooting

### "implicit_deny" but I expected an allow

Check `Decision.candidatePolicies` — it lists policies that *almost* matched and which pattern array (`principals`/`actions`/`resources`) failed. In dev, this is in the error response body.

Common causes:

- Single `*` doesn't cross dots — `actions: ['*']` won't match `lead.read`. Use `**`.
- Resource pattern is matched against `<type>:<id>`. `resources: ['*']` doesn't match `lead:l1` (the colon is a segment separator). Use `**` or `lead:*`.
- Scope pattern is `scope:<scope>`. A principal scope `lead.read` becomes `scope:lead.read` in the compiled set.

### "tenant_mismatch" — policies aren't firing

Check the principal and resource `tenantId`s. Set both to `null` to bypass tenant isolation, or use the same value.

### Adapter throws "ctx.session.data.user.id missing"

You configured `principal: { from: 'session' }` but the session doesn't have a `user` field. Either:

- Set the user on login: `ctx.session.data.user = { id, tenantId, scopes, groups }`
- Or supply a custom mapping: `principal: { from: 'session', map: (raw, ctx) => ... }`

### Policy works in dev but breaks in prod

Set `NODE_ENV=production` locally — production error bodies don't include policy ids, so a test that asserts `matchedPolicyIds` will fail. Check `Decision.allowed` directly via `server.policy.explain()` (Phase 7) for unit tests.

### `.authz()` throws at registration

Two cases:

- **`requires \`policy: { ... }\` on createServer`** — you forgot to set the `policy` field on `createServer({})`.
- **`may only be called once per procedure`** — you called `.authz()` twice. Multi-policy chaining is not supported in v1.

---

## Performance notes

- All glob patterns are **pre-compiled to regex at startup**. The hot path is regex tests + a single `condition` / DSL predicate call.
- The compiled principal set is **cached per request** on `ctx.principal._compiledSet`.
- Resource resolvers are **deduplicated by `resource.id`** within one request when called through `ctx.policy.evaluate` / `ctx.policy.filterResources`.
- **No decision caching** — security-sensitive (a stale decision could grant access after a permission change). The engine is fast enough without it.
- **No short-circuit eval** — all matching policies are visited so `matchedPolicyIds` and `auditedPolicyIds` are complete.

For >1000 policies, consider organising your catalog (one file per domain, action prefix discipline). The engine handles a few thousand policies without sweat; if you push past that, contact us — bucket-by-action indexing is a planned optimisation.

---

## Next steps

- [Match DSL reference](../policies/match-dsl.md) — exhaustive operator table
- [Patterns & recipes](../policies/patterns.md) — curated solutions to common authz problems
- [Policies API reference](../reference/policies-api.md) — types, config, helpers
- [Sessions](../auth/sessions.md) — pair with session storage for stateful auth
- [OAuth2 / OIDC](../auth/oauth2.md) — pair with token-based auth
