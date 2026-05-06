# Authorization Policies — Overview

> **Declarative authz for Raffel servers. Fully opt-in.**

## TL;DR

```ts
// 1. Without policies — nothing changes.
const server = createServer({ port: 3000 })

// 2. Opt in — add `policy: { ... }`.
const server = createServer({
  port: 3000,
  policy: {
    principal: { from: 'session' },
    policies: [
      {
        id: 'allow-active-leads',
        effect: 'allow',
        principals: ['scope:lead.read'],
        actions: ['lead.read'],
        resources: ['lead:*'],
        match: { 'resource.status': 'active' },
      },
    ],
  },
})

// 3. Gate a procedure with `.authz()`.
server
  .procedure('lead.read')
  .authz({
    resource: ({ id }, ctx) => ({ type: 'lead', id, tenantId: ctx.principal?.tenantId ?? null }),
  })
  .handler(async ({ id }) => loadLead(id))
```

That's it. Three lines of declarative authz that replace dozens of imperative checks scattered across handlers.

## Why opt-in?

Raffel is a multi-protocol server framework. Some apps need authz; some don't. The policy module:

- Adds zero bytes to your bundle when not configured
- Adds zero runtime cost when not configured
- Doesn't shadow or override any existing auth (OAuth2, OIDC, sessions) — it builds on them
- Can be enabled per-environment (e.g. strict in prod, lenient in dev)

## Mental model

A policy answers: *can this principal do this action to this resource right now?*

```
Principal (who)  ──┐
Action (what)    ──┼──► engine.evaluate ──► Decision: allow | deny | audit
Resource (which) ──┤
Context (when)   ──┘
```

Four primitives, four effects, one decision.

## Where policies fit

```
HTTP request
    ↓
ConnectionFilter   (network-level allow/deny by IP — separate from policies)
    ↓
Session attach     (ctx.session)
    ↓
Auth (OAuth2/OIDC) (ctx.auth — authentication: who you are)
    ↓
Rate limit
    ↓
Validation (Zod)
    ↓
★ POLICY engine    (authorization: what you may do)
    ↓
Custom interceptors
    ↓
Handler
```

Authentication says *who* the request is. Policies say *what* they're allowed to do. Different layers, complementary roles.

## In this section

| Page | When to read |
|---|---|
| **[Guide](../guides/policies.md)** | First read. Concepts, lifecycle, quickstart, policy anatomy, examples, debugging — everything you need to ship. |
| **[Match DSL Reference](./match-dsl.md)** | When writing complex `match` conditions. Every operator, every path form. |
| **[Patterns & Recipes](./patterns.md)** | Looking for a solution to a specific problem (RBAC, multi-tenant, owner-or-admin, shadow rollout, emergency revocation, etc.). |
| **[Co-located policies](./co-located.md)** | Drop policy files next to handlers, channels, resources. Sibling and folder cascade conventions, `scope` filter, coverage report. |
| **[API Reference](../reference/policies-api.md)** | Type signatures, config options, builder methods. |
| **[ADR 0001 — Co-located policies](../adr/0001-co-located-policies.md)** | The decision record behind the co-located convention: context, alternatives, trade-offs. |

## Related

| Topic | How it relates to policies |
|---|---|
| **[Sessions](../auth/sessions.md)** | Provides `ctx.session.data.user` — the default source for `principal: { from: 'session' }`. |
| **[OAuth2](../auth/oauth2.md)** | Provides `ctx.auth.claims` — read by `principal: { from: 'oauth2' }`. |
| **[OIDC](../auth/oidc.md)** | Same as OAuth2 with `groups`/`org_id` claim conventions. |
| **[Connection Filter](../core/interceptors/overview.md)** | IP-level allow/deny — runs *before* policies. Use for DoS protection, not application authz. |
| **[Router Modules](../core/router-modules.md)** | Module-level `authz` defaults inherited by procedures. |
| **[MCP Discovery](../protocols/mcp.md)** | Policies are exposed at `raffel://policies` for AI agents to read. |

## Three primitives

### Principal — who

Flat shape: `{ id, tenantId, scopes, groups, attrs? }`. Sourced from session/OAuth2/OIDC/custom adapter.

### Action — what

A string. Defaults to the procedure name. Glob-friendly: `lead.**` matches `lead.read`, `lead.move.funnel`, etc.

### Resource — which

`{ type, id, tenantId, attrs? }`. You provide a resolver per procedure that converts the input into a resource. Async OK.

## Four effects

| Effect | Behaviour |
|---|---|
| `allow` | Grants access when the policy fully matches. |
| `deny` | Blocks access when matched. **Always wins** over `allow`. |
| `audit` | Matches but never changes the gate. Logs which audit policies fired — perfect for shadow rollout. |
| *(implicit)* | When nothing matches, request is denied (default-closed). `candidatePolicies` shows what *almost* matched. |

Plus a precedence #1 hard rule: `tenant_mismatch` (cross-tenant access denied before any policy runs).

## When NOT to use policies

- **Authentication** — use OAuth2 / OIDC / Session interceptors.
- **Rate limiting** — use the rate-limit interceptor.
- **Network ACLs** — use `ConnectionFilter` on TCP/UDP/WS.
- **Per-field redaction in responses** — handle inside the handler (use `ctx.policy.evaluate` for the gate decision, then mutate the response).
- **Trivial one-off checks** — for a single boolean check inside a handler, `if (ctx.auth.principalId !== input.userId) throw forbidden()` is fine. Policies pay off when you have ≥ 5 rules or want them in JSON.

## Migration path from imperative auth

1. Configure `policy: { principal: { from: 'session' } }` on your server.
2. Pick one procedure with hand-rolled auth checks.
3. Move the checks into a policy with `effect: 'audit'` first — verify it fires for the same population by watching `auditedPolicyIds` in logs.
4. Once confirmed, change `effect` to `'allow'` (or `'deny'`) and remove the imperative checks.
5. Repeat per procedure. No big-bang migration needed.

The audit-then-promote workflow makes this safe — you can ship the new authz model in parallel with the old one.
