# Auth + Policies — end-to-end

> **How authentication and authorization work together in one request.**
> Auth answers *who are you*. Policies answer *what may you do*. This guide wires
> a Bearer-authenticated request all the way through to a granular authz decision.

If you have only read the two systems in isolation — [Authentication](/auth/overview.md)
and [Policies](/policies/README.md) — this is the missing middle: the exact point
where `ctx.auth` (produced by an auth strategy) becomes the `Principal` the policy
engine evaluates.

---

## Two layers, one pipeline

The two systems are independent and each is opt-in, but they sit on the same
request pipeline in a fixed order:

```
HTTP request
    ↓
Session attach        → ctx.session
    ↓
Auth (Bearer/OAuth2)  → ctx.auth      ★ authentication: WHO you are
    ↓
Rate limit
    ↓
Validation (Zod)
    ↓
Policy engine         → Decision      ★ authorization: WHAT you may do
    ↓
Handler
```

| Layer | Question | Produces | Configured by |
|---|---|---|---|
| **Auth** | Who is this request? | `ctx.auth` (`AuthContext`) | `createAuthMiddleware({ strategies })` — see [Authentication](/auth/overview.md) |
| **Policy** | May this principal do this action to this resource? | `Decision` | `createServer({ policy: {...} })` + `.authz()` — see [Policies](/policies/README.md) |

Auth runs first and never denies on *authorization* grounds — it only decides
whether the caller is authenticated and populates `ctx.auth`. The policy engine
runs later and reads `ctx.auth` (through a principal adapter) to make the actual
allow/deny call.

---

## The bridge: `ctx.auth` → `Principal`

This is the part neither the auth docs nor the policy docs spell out end-to-end.

After a strategy authenticates a request, Raffel populates `ctx.auth` with the
`AuthContext` shape (`src/types/context.ts`):

```ts
interface AuthContext {
  authenticated: boolean
  principal?: AuthPrincipal          // user/service identifier
  principalId?: string               // stable id independent of principal shape
  roles?: readonly string[]          // authorization roles
  scopes?: readonly string[]         // authorization scopes
  tenantId?: string
  claims?: Record<string, unknown>   // raw JWT payload, etc.
  require(requirement?): AuthPrincipal
  hasRole(role: string): boolean
  hasScope(scope: string): boolean
}
```

When you configure `policy: { principal: { from: 'oauth2' } }`, the policy engine
reads `ctx.auth` on every request and maps it into the flat `Principal` the engine
understands. `from: 'oauth2'` (and `from: 'oidc'`) read `ctx.auth` regardless of
which token strategy filled it — Bearer/JWT, OAuth2, or OIDC all land in `ctx.auth`.

The default mapping (`src/middleware/policy/principal/oauth2.ts`):

| `Principal` field | Sourced from `ctx.auth` |
|---|---|
| `id` | `principalId` ?? `principal` (when string) ?? `claims.sub` |
| `tenantId` | `tenantId` ?? `claims.tid` ?? `null` |
| `scopes` | `scopes` ?? `split(claims.scope, ' ')` |
| `groups` | **`roles`** ?? `claims.groups` |
| `attrs` | `claims` (full payload) |

The load-bearing line: **`ctx.auth.roles` becomes `Principal.groups`.** So a role
`admin` on the auth side is matched by a policy pattern `group:admins`-style —
i.e. `principals: ['group:admin']`. Scopes stay scopes (`scope:<name>`). Keep this
table in mind when writing policies against a Bearer-authenticated principal.

---

## End-to-end example

A single procedure, authenticated by Bearer JWT, authorized by policy. Follow the
`u_123` value as it flows from token → `ctx.auth` → `Principal` → decision.

### 1. Auth middleware — populate `ctx.auth`

```ts
import { createServer, createAuthMiddleware, createBearerStrategy } from 'raffel'

const auth = createAuthMiddleware({
  strategies: [
    createBearerStrategy({
      verify: async (token) => {
        const payload = await verifyJwt(token)   // your JWT verifier
        if (!payload) return null
        return {
          authenticated: true,
          principal: payload.sub,                 // → Principal.id
          roles: payload.roles,                   // → Principal.groups
          scopes: payload.scope?.split(' '),      // → Principal.scopes
          tenantId: payload.tid,                  // → Principal.tenantId
          claims: payload,                        // → Principal.attrs
        }
      },
    }),
  ],
})
```

### 2. Server — declare the principal source and the policy catalog

```ts
const server = createServer({
  port: 3000,
  policy: {
    principal: { from: 'oauth2' },   // reads ctx.auth (works for Bearer too)
    policies: [
      {
        id: 'leads-read-own',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
        match: { 'resource.assignedTo': '@principal.id' },
      },
      {
        id: 'admins-read-any',
        effect: 'allow',
        principals: ['group:admin'],   // ← from ctx.auth.roles === ['admin']
        actions: ['lead.**'],
        resources: ['lead:*'],
      },
    ],
  },
})
```

### 3. Procedure — auth, then the `.authz()` gate

```ts
server
  .procedure('lead.read')
  .use(auth)                                   // fills ctx.auth
  .authz({
    // action defaults to 'lead.read'.
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
  .handler(async ({ id }) => db.leads.get(id))  // pure: no authz code here
```

For request `POST /lead.read {"id":"l1"}` from a seller `u_123` whose token carries
`scope:lead.read`, the engine receives:

```ts
{
  principal: { id: 'u_123', tenantId: 'tenant_acme', scopes: ['lead.read'], groups: ['seller'] },
  action:    'lead.read',
  resource:  { type: 'lead', id: 'l1', tenantId: 'tenant_acme', attrs: { assignedTo: 'u_123', status: 'active' } },
}
```

`leads-read-own` matches (`resource.assignedTo === principal.id`) → `allow`. If the
lead were assigned to someone else, no allow policy fully matches → `implicit_deny`
→ HTTP 403. If the token carried role `admin`, `admins-read-any` matches instead.

See the [Policies guide](/guides/policies.md#anatomy-of-a-policy) for the full
anatomy of a policy and the [Match DSL](/policies/match-dsl.md) for every operator.

---

## RBAC vs. granular policies

The auth layer ships a lightweight RBAC helper (`createAuthzMiddleware`, `hasRole`)
that gates by role alone. The policy engine adds resource-aware authorization on
top. Use the right tool for the granularity you need.

### Simple role gate (RBAC only)

For pure "does the caller hold this role?" checks with no per-resource logic, the
auth-layer RBAC middleware is enough — no policy engine required:

```ts
import { createAuthzMiddleware } from 'raffel'

const authz = createAuthzMiddleware({
  rules: [{ procedure: 'admin.*', roles: ['admin'] }],
})

server.procedure('admin.users.list').use(auth).use(authz).handler(...)
```

This is documented in [Authentication → Authorization (RBAC)](/auth/overview.md#authorization-rbac).

### Granular policy (ownership, tenant, attributes)

The moment the decision depends on the *resource* — who owns it, what tenant it
belongs to, its status — a role gate can't express it. That's the policy engine's
job. In the engine, RBAC is just a policy whose principal pattern is a group:

```ts
// RBAC expressed as a policy — role 'admin' → Principal.groups → group:admin
{ id: 'admins-all', effect: 'allow', principals: ['group:admin'], actions: ['**'], resources: ['**'] }
```

Rule of thumb (from [Policies → When NOT to use policies](/policies/README.md#when-not-to-use-policies)):
a single boolean role check inside one handler is fine imperatively; reach for the
policy engine once you have ownership/tenant/attribute rules or ≥ 5 rules to manage.

---

## Common patterns

These all rely on the `ctx.auth → Principal` bridge above. Full recipes live in
[Policies → Patterns & Recipes](/policies/patterns.md); the essentials:

### "Users can only edit their own resources" (ownership)

```ts
{
  id: 'lead-edit-own',
  effect: 'allow',
  principals: ['scope:lead.write'],
  actions: ['lead.update'],
  resources: ['lead:*'],
  match: { 'resource.assignedTo': '@principal.id' },   // @principal.id ← ctx.auth principal
}
```

### "Admins bypass everything"

```ts
{
  id: 'admins-can-everything',
  effect: 'allow',
  principals: ['group:admin'],   // ← ctx.auth.roles includes 'admin'
  actions: ['**'],
  resources: ['**'],
}
```

Note the one hard limit: even a `group:admin` allow **cannot** cross tenants — a
`tenant_mismatch` is denied before any policy runs. For a genuine platform admin
that spans tenants, map that principal to `tenantId: null` (see below).

### Multi-tenant isolation

Set `tenantId` on both principal and resource; the engine denies cross-tenant
access automatically, before policies evaluate:

```ts
// principal.tenantId comes from ctx.auth.tenantId (or claims.tid)
// resource.tenantId comes from your resolver
// principal 'tenant_a' reading resource 'tenant_b' → { allowed: false, reason: 'tenant_mismatch' }
```

`tenantId: null` opts out: a `null` **principal** is a platform actor that crosses
all tenants; a `null` **resource** is a global object any tenant may read. See
[Policies → Tenant isolation](/guides/policies.md#tenant-isolation).

---

## Co-located policies with authenticated handlers

Instead of a central `policies: [...]` array, you can drop policy files next to the
handler they protect. The `ctx.auth → Principal` bridge is identical — only *where
the rules live* changes.

```text
src/http/leads/get.ts
src/http/leads/get.policy.yaml     ← sibling, covers leads/get
src/http/_policy.yaml              ← cascade, covers every HTTP handler
```

```yaml
# src/http/leads/get.policy.yaml
id: leads-read-own
effect: allow
principals: [scope:lead.read]
actions: [leads/get]
resources: ["**"]
match:
  'resource.assignedTo': '@principal.id'
```

A cascade `_policy.yaml` is the natural home for a tenant-isolation baseline that
should reach every authenticated route:

```yaml
# src/http/_policy.yaml — deny any cross-tenant access, everywhere
id: tenant-isolation
effect: deny
principals: ["*"]
actions: ["**"]
resources: ["**"]
match:
  'resource.tenantId': '!@principal.tenantId'
```

For rules that need loaded-record fields (owner, assignee), export
`config.policyResource` from a REST/resource file so the resolver can hit storage.
Full conventions — sibling vs. cascade, `scope` filters, `mode: scope`, and the
`server.policyCoverage()` audit — are in [Co-located policies](/policies/co-located.md).

---

## What NOT to do

**Do not hand-roll authorization inside the handler when a resource decision is
involved.** This is the anti-pattern the policy engine exists to remove:

```ts
// ✗ Authorization scattered in the handler
server.procedure('lead.read').use(auth).handler(async ({ id }, ctx) => {
  const lead = await db.leads.get(id)
  if (lead.tenantId !== ctx.auth.tenantId) throw Errors.forbidden()
  if (lead.status === 'archived') throw Errors.forbidden()
  if (lead.assignedTo !== ctx.auth.principal && !ctx.auth.hasRole('admin')) {
    throw Errors.forbidden()
  }
  return lead
})
```

Every rule is invisible to tooling, duplicated across handlers, and drifts out of
sync. Move it to a declarative gate — the handler goes back to being about *what
to return*:

```ts
// ✓ Authorization declared, handler stays pure
server.procedure('lead.read')
  .use(auth)
  .authz({ resource: ({ id }) => loadLeadResource(id) })
  .handler(async ({ id }) => db.leads.get(id))
```

The migration is safe and incremental: deploy the new policy as `effect: 'audit'`
first, watch `auditedPolicyIds` in logs to confirm it fires for the same
population, then flip to `allow`/`deny` and delete the imperative checks. See the
[migration path](/policies/README.md#migration-path-from-imperative-auth).

The exceptions (where an imperative check is still correct):

- **A single trivial boolean** in one handler with no resource logic — e.g.
  `if (!ctx.auth.hasRole('user')) throw Errors.forbidden()`. Not worth a policy.
- **Per-field redaction** — gate with a policy, then mutate the response inside the
  handler using `ctx.policy.evaluate('lead.read.sensitive', resource)`.
- **Per-message stream authz** — the gate runs once at stream open; re-check each
  frame with `ctx.policy.evaluate(...)` inside the handler loop.

See [Policies → Ctx helpers](/guides/policies.md#ctx-helpers) for the last two.

---

## Related

- [Authentication Overview](/auth/overview.md) — strategies, `ctx.auth`, RBAC helpers
- [Bearer Token (JWT)](/auth/bearer.md) — the strategy used in this guide
- [Policies Overview](/policies/README.md) — the authz model and mental picture
- [Policies Guide](/guides/policies.md) — policy anatomy, `.authz()`, lifecycle
- [Co-located policies](/policies/co-located.md) — file-system policy convention
- [Patterns & Recipes](/policies/patterns.md) — RBAC, multi-tenant, owner-or-admin
