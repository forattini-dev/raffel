# Co-located Policies

Co-locate authorization rules with the handler they protect. Drop a
`<handler>.policy.{yaml,yml,json}` file next to a discovered handler and
Raffel attaches the rules at boot — no `policy.policies` array, no `.authz()`
call needed.

> Tracer-bullet scope (issue #92): only **sibling** files are loaded.
> Folder cascades, channel/resource scopes, and `match` patterns are
> tracked separately under issues #93–#96 and reuse the same descriptor
> shape.

## Quick start

```
src/
  http/
    leads/
      get.ts            # handler
      get.policy.yaml   # ← sibling policy, auto-loaded
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

```ts
const server = createServer({
  port: 3000,
  discovery: true,
  policy: {
    principal: { from: 'session' },
    policies: [],
  },
})
```

That's it. No explicit `.authz()` on the procedure, no entry in
`policy.policies` — discovery picks up the sibling file, the bridge appends
its rules to the engine, and the handler is gated by them.

## How it works

1. FS discovery walks the configured directories (`src/http`, `src/rpc`,
   `src/streams`, …).
2. For each handler it finds, the loader checks for sibling files matching
   `<handler>.policy.{yaml,yml,json}`.
3. Each file is parsed and validated against the same JSON schema used by
   the root `loadFromDir` loader, so error messages are consistent.
4. At handler registration the bridge:
   - Appends the parsed policies to the engine via `addPolicies()`.
   - Synthesises an `.authz({ action: '<route.name>' })` interceptor for
     the handler so the engine actually evaluates on every call.

The default action passed to the engine is the discovered route name — the
same string the registry uses (e.g. `leads/get`, `users/:id/get`).

## Precedence

Explicit programmatic registration always wins. If
`server.procedure('leads/get')` is called before discovery completes (or
before the bridge runs), the discovered route is **skipped** — the
explicit registration including any `.authz()` config is what survives.

## Resource patterns

Co-located policies use the same glob conventions as inline policies. The
common pitfall is `*` versus `**`:

| Pattern | Meaning |
|---|---|
| `*` | Single segment — does **not** match the synthetic resource tag (`type:id`) the bridge passes when no `resource` resolver is wired. |
| `**` | Globstar — matches anything, including across colons. Use this for "any resource". |

Use `resources: ['**']` for unconstrained allows. Once you start scoping
to a real resource resolver, use specific globs (`lead:*`, `org:tenant-1`,
etc.) like any other policy.

## Opting out

Pass `policy.coLocated: false` to disable bridge-loading entirely:

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

This keeps FS discovery working (handlers, channels, REST resources, …)
but ignores any sibling `*.policy.*` files. Useful when migrating from a
co-located convention to a centralised policy directory.

## Engine driver requirements

The bridge calls `engine.addPolicies(policies)` to register discovered
rules after engine construction. The default in-process engine supports
this. Custom engine implementations that cannot accept new policies after
construction may omit `addPolicies` from their `PolicyEnginePort` — the
bridge logs a warning and skips co-located bridging for that route.

## Validation

Each policy file is parsed and validated eagerly at startup:

- YAML or JSON syntax errors are surfaced with the file path.
- Schema violations cite the `id` (or array index) and the failing field.
- Unknown `customCondition` references throw immediately.

Misconfigured files fail the boot — no half-broken policy ever reaches
production traffic.
