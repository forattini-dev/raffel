# Policies — Patterns & Recipes

Curated solutions for common authorization problems. Each section is self-contained — copy, adapt, ship.

## Table of contents

1. [RBAC — role-based access control](#rbac--role-based-access-control)
2. [ABAC — attribute-based access control](#abac--attribute-based-access-control)
3. [Multi-tenant SaaS](#multi-tenant-saas)
4. [Owner-or-admin](#owner-or-admin)
5. [Channel / team membership](#channel--team-membership)
6. [Time-windowed access](#time-windowed-access)
7. [IP / network restriction](#ip--network-restriction)
8. [Sensitive-field filtering](#sensitive-field-filtering)
9. [Listing with filter](#listing-with-filter)
10. [Shadow rollout (audit → deny)](#shadow-rollout-audit--deny)
11. [Emergency revocation](#emergency-revocation)
12. [Approval workflow](#approval-workflow)
13. [Service-to-service authz](#service-to-service-authz)
14. [Public + protected on same procedure](#public--protected-on-same-procedure)
15. [Hot-swapping policies via config](#hot-swapping-policies-via-config)

---

## RBAC — role-based access control

Map roles to `principal.groups`. Policies reference `group:<role>`.

### Principal mapping

```ts
policy: {
  principal: {
    from: 'session',
    map: (raw, ctx) => ({
      id: raw.id,
      tenantId: raw.tenantId,
      scopes: [],
      groups: raw.roles.map(r => r), // 'admin', 'manager', 'agent'
      attrs: { ... },
    }),
  },
}
```

### Policies

```ts
[
  {
    id: 'admin-everything',
    effect: 'allow',
    principals: ['group:admin'],
    actions: ['**'],
    resources: ['**'],
  },
  {
    id: 'manager-leads-everything',
    effect: 'allow',
    principals: ['group:manager'],
    actions: ['lead.**'],
    resources: ['lead:*'],
  },
  {
    id: 'agent-leads-read',
    effect: 'allow',
    principals: ['group:agent'],
    actions: ['lead.read'],
    resources: ['lead:*'],
  },
]
```

When a user has multiple roles, they get the union of allows.

---

## ABAC — attribute-based access control

Decide based on attributes of principal + resource, not just identity.

```ts
{
  id: 'managers-read-own-dept',
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

A manager in `dept-9` reads only leads with `deptId: 'dept-9'`. No code in handlers.

---

## Multi-tenant SaaS

Set `tenantId` on every principal AND resource. The engine handles cross-tenant isolation automatically (precedence #1: `tenant_mismatch`).

### Resolver

```ts
.authz({
  resource: async ({ id }, ctx) => {
    const lead = await db.leads.get(id)
    return {
      type: 'lead',
      id: lead.id,
      tenantId: lead.tenantId,        // ← critical
      attrs: { status: lead.status },
    }
  },
})
```

### Platform principals (cross-tenant ops, e.g. internal admin tools)

Set `tenantId: null` on the principal — they bypass tenant checks but still hit normal allow/deny rules.

```ts
policy: {
  principal: {
    from: 'session',
    map: (raw) => ({
      id: raw.id,
      tenantId: raw.kind === 'platform-admin' ? null : raw.tenantId,
      scopes: raw.scopes,
      groups: raw.groups,
    }),
  },
}
```

### Global resources (catalog, public docs)

Set `tenantId: null` on the resource → any tenant may access.

---

## Owner-or-admin

Most common UI pattern: "you can edit your own thing OR if you're an admin."

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
    ],
  },
}
```

---

## Channel / team membership

Resource is visible to members of a specific channel/team.

```ts
{
  id: 'team-channel-read',
  effect: 'allow',
  principals: ['scope:lead.read'],
  actions: ['lead.read'],
  resources: ['lead:*'],
  match: {
    'resource.channelId': '@principal.groups',
  },
}
```

`principal.groups` includes things like `channel:c1`. The resource has `channelId: 'channel:c1'`. Match passes if `principal.groups.includes(resource.attrs.channelId)`.

---

## Time-windowed access

Block writes outside business hours.

```ts
{
  id: 'business-hours-only',
  effect: 'deny',
  principals: ['**'],
  actions: ['lead.{create,update,delete}'],
  resources: ['lead:*'],
  customCondition: 'outsideBusinessHours',
}
```

```ts
policy: {
  customConditions: {
    outsideBusinessHours: ({ context }) => {
      const hour = (context?.hour as number) ?? new Date().getHours()
      return hour < 9 || hour >= 18
    },
  },
}
```

Pass `context` via `ctx.policy.evaluate(action, resource, context)` or direct `engine.evaluate({ ...input, context })`. The engine doesn't auto-set time — keep policies pure-data and inject volatile state via `context`.

---

## IP / network restriction

Restrict admin endpoints to corporate IP ranges.

```ts
{
  id: 'admin-corp-network-only',
  effect: 'deny',
  principals: ['**'],
  actions: ['admin.**'],
  resources: ['**'],
  customCondition: 'notFromCorpNetwork',
}
```

```ts
policy: {
  customConditions: {
    notFromCorpNetwork: ({ context }) => {
      const ip = context?.clientIp as string | undefined
      if (!ip) return true                                     // unknown → deny
      return !(ip.startsWith('10.') || ip.startsWith('192.168.'))
    },
  },
}
```

Set `context.clientIp` from a custom interceptor that reads `ctx.http.clientIp` and stores it for the policy.

> **Note**: For broad transport-level IP blocking (DoS protection), prefer `ConnectionFilter` on TCP/UDP/WS adapters — it runs before the application layer.

---

## Sensitive-field filtering

Two approaches.

### Approach A — separate procedures

```ts
server
  .procedure('lead.read.summary')
  .authz({ resource: ({ id }) => loadLead(id) })
  .handler(...)

server
  .procedure('lead.read.full')
  .authz({ resource: ({ id }) => loadLead(id) })          // tighter policy applies
  .handler(...)
```

### Approach B — one procedure, ad-hoc check

```ts
server
  .procedure('lead.read')
  .authz({ resource: ({ id }) => loadLead(id) })
  .handler(async ({ id }, ctx) => {
    const lead = await db.leads.get(id)
    const sensitive = await ctx.policy.evaluate('lead.read.sensitive', {
      type: 'lead',
      id: lead.id,
      tenantId: lead.tenantId,
    })
    if (!sensitive.allowed) {
      lead.financials = undefined
      lead.notes = undefined
    }
    return lead
  })
```

Add a separate policy for `lead.read.sensitive`:

```ts
{
  id: 'sensitive-managers-only',
  effect: 'allow',
  principals: ['**'],
  actions: ['lead.read.sensitive'],
  resources: ['lead:*'],
  match: { 'principal.attrs.role': 'manager' },
}
```

---

## Listing with filter

Return only resources the principal can read. Dedup'd resolver per request.

```ts
server
  .procedure('leads.list')
  .authz({ resource: (_input, ctx) => ({ type: 'leadbag', id: 'all', tenantId: ctx.principal?.tenantId ?? null }) })
  .handler(async (_, ctx) => {
    const all = await db.leads.list()
    return ctx.policy.filterResources('lead.read', all.map(l => ({
      type: 'lead', id: l.id, tenantId: l.tenantId, attrs: l,
    })))
  })
```

The outer `.authz()` gates the *list operation itself* (e.g. you must be authenticated). The inner `filterResources` removes individual leads the principal can't read.

---

## Shadow rollout (audit → deny)

Test a stricter rule against production traffic without breaking anyone.

### Step 1 — deploy as audit

```ts
{
  id: 'rule-under-test',
  effect: 'audit',                                          // ← shadow
  principals: ['scope:lead.read'],
  actions: ['lead.read'],
  resources: ['lead:*'],
  match: { 'resource.deptId': '@principal.attrs.deptId' },
}
```

### Step 2 — observe

For a week, every request that *would* have been blocked under this rule logs:

```
[raffel:policy] action=lead.read principal=s1 allowed=true reason=allow
                audited=['rule-under-test']
```

If `audited` shows entries that surprise you (legitimate users being affected), iterate the rule before promoting.

### Step 3 — promote

Change `effect` to `'deny'`:

```diff
- effect: 'audit',
+ effect: 'deny',
```

Same population that fired in audit will now be blocked.

---

## Emergency revocation

Block a specific user/principal immediately, without rebuilding.

```jsonc
// policies/emergency.json
{
  "id": "block-suspended-user-s99",
  "effect": "deny",
  "principals": ["user:s99"],
  "actions": ["**"],
  "resources": ["**"]
}
```

Push this file to your `loadFromDir` policy directory; restart. The `deny` wins over any allow.

For org-wide kill switches:

```jsonc
{
  "id": "freeze-tenant-tX",
  "effect": "deny",
  "principals": ["**"],
  "actions": ["**"],
  "resources": ["**"],
  "customCondition": "tenantIsFrozen"
}
```

```ts
policy: {
  customConditions: {
    tenantIsFrozen: ({ principal }) =>
      FROZEN_TENANTS.has(principal.tenantId ?? ''),
  },
}
```

---

## Approval workflow

Some actions require state to be approved before they can be executed.

```ts
[
  {
    id: 'transfer-needs-approval',
    effect: 'deny',
    principals: ['**'],
    actions: ['transfer.execute'],
    resources: ['transfer:*'],
    match: { 'resource.approvalStatus': '!approved' },
  },
  {
    id: 'cannot-self-approve',
    effect: 'deny',
    principals: ['**'],
    actions: ['transfer.approve'],
    resources: ['transfer:*'],
    match: { 'resource.requestedBy': '@principal.id' },
  },
]
```

Two policies, two clear rules: cannot execute unless approved; cannot approve own transfers.

---

## Service-to-service authz

For internal service calls (e.g. service A calling service B), use principal-typed identifiers:

```ts
policy: {
  principal: {
    from: 'oauth2',
    map: (_raw, ctx) => {
      const claims = ctx.auth.claims as Record<string, unknown>
      const isService = claims.client_credentials === true
      return {
        id: isService ? `svc:${claims.client_id}` : (claims.sub as string),
        tenantId: null,                          // services are platform principals
        scopes: ((claims.scope as string)?.split(' ')) ?? [],
        groups: isService ? ['svc'] : (claims.groups as string[]) ?? [],
      }
    },
  },
}
```

Then policies:

```ts
{
  id: 'svc-orders-can-read-leads',
  effect: 'allow',
  principals: ['svc:orders-service'],
  actions: ['lead.read'],
  resources: ['lead:*'],
}
```

The principal id `svc:orders-service` is a literal — patterns can match `svc:*` for "any service" or `svc:orders-*` for a family.

---

## Public + protected on same procedure

You can't have a procedure be both public and protected — but you can split read/write.

### Public read (anyone, even unauthenticated)

```ts
server
  .procedure('article.read')
  .authz({ public: true })                       // bypass policy
  .handler(...)
```

(With `defaultMode: 'deny'`, this is required to keep the endpoint open.)

### Protected write

```ts
server
  .procedure('article.update')
  .authz({ resource: ({ id }) => loadArticle(id) })
  .handler(...)
```

For "logged-in vs anonymous show different data" use a single procedure that runs the policy and branches inside the handler:

```ts
server
  .procedure('article.read')
  .authz({
    resource: ({ id }) => loadArticle(id),
  })
  .handler(async ({ id }, ctx) => {
    const article = await loadArticle(id)
    const editable = await ctx.policy.evaluate('article.edit', { type: 'article', id, tenantId: null })
    return { ...article, editable: editable.allowed }
  })
```

---

## Hot-swapping policies via config

Although v1 doesn't auto-reload, you can:

### A. Restart the server

```bash
# After updating ./policies/*.json
pkill -SIGTERM raffel-server  # supervisor restarts
```

### B. Build your own reloader (out of scope for v1)

Recreate the engine and replace it via a custom `policy.engine`:

```ts
import { createDefaultEngine } from 'raffel/policy'

let engine = createDefaultEngine({ policies: initialPolicies })

const server = createServer({
  policy: {
    principal: { from: 'session' },
    engine: {
      evaluate: (input) => engine.evaluate(input),  // delegates dynamically
      list: () => engine.list(),
    },
  },
})

// Later:
fileWatcher.on('change', () => {
  const fresh = loadPoliciesFromDir({ dir: './policies' })
  engine = createDefaultEngine({ policies: fresh.policies })
})
```

> **Caveat**: in-flight requests use whichever engine they captured at evaluate time. There is no transactional swap. For most apps, scheduled deploys are simpler and safer than live reloads.

---

## See also

- [Policies guide](../guides/policies.md) — concepts, lifecycle, debugging
- [Match DSL reference](./match-dsl.md) — every operator
- [API reference](../reference/policies-api.md) — types & config
