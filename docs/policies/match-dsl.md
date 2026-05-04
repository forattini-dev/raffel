# Match DSL Reference

Complete reference for the `match` field on policies — a JSON-friendly tree compiled to a predicate at server startup.

## When to use match vs `condition`

| Use `match` (DSL) when | Use `condition` (TS function) when |
|---|---|
| Policy lives in JSON | Logic is too complex for the DSL |
| Logic is data, not code | You need to call out to a service |
| You want introspection / MCP discovery | You don't care about JSON serializability |

Both can be present on the same policy — both must pass (implicit AND).

---

## Path resolution

All paths are dot-namespaced strings resolved at evaluation time:

| Path | Resolves to |
|---|---|
| `action` | `input.action` (the procedure action string) |
| `principal.id` | `input.principal.id` |
| `principal.tenantId` | `input.principal.tenantId` |
| `principal.scopes` | `input.principal.scopes` (array) |
| `principal.groups` | `input.principal.groups` (array) |
| `principal.attrs.<key>` | `input.principal.attrs?.[key]` |
| `resource.id` | `input.resource.id` |
| `resource.type` | `input.resource.type` |
| `resource.tenantId` | `input.resource.tenantId` |
| `resource.attrs.<key>` | `input.resource.attrs?.[key]` (explicit) |
| `resource.<key>` | `input.resource.attrs?.[key]` (shorthand for non-id/type/tenantId) |
| `context.<key>` | `input.context?.[key]` |

Unknown root prefixes resolve to `undefined`.

---

## Value forms

A path's value is one of:

```ts
type MatchValue = MatchLiteral | MatchOperator
type MatchLiteral = string | number | boolean | null
```

### Literal equality

```ts
match: { 'resource.status': 'active' }      // strict ===
match: { 'resource.amount': 100 }
match: { 'resource.archived': true }
match: { 'resource.assignedTo': null }      // strict null
```

### Wildcard literal — always passes

`'*'` as a string value documents intent without imposing a check:

```ts
match: { 'resource.type': '*' }              // always true; for self-documentation
```

### `@ref` — path comparison

A string starting with `@` is a *path reference*. The path is resolved against the same input.

```ts
// Scalar vs scalar
match: { 'resource.assignedTo': '@principal.id' }
// → resource.attrs.assignedTo === principal.id

// Scalar vs array → membership
match: { 'resource.channelId': '@principal.groups' }
// → principal.groups.includes(resource.attrs.channelId)

// Array vs array → intersection (any element common)
match: { 'principal.scopes': '@resource.allowedScopes' }
// → at least one element in common
```

### `!` — negation prefix

A leading `!` negates the comparison. Works with literals and refs.

```ts
match: { 'resource.status': '!archived' }            // !==
match: { 'resource.assignedTo': '!@principal.id' }   // not the owner
```

---

## Operators

Use an object form when you need richer comparisons than equality.

```ts
match: { 'path.to.field': { '<operator>': <argument> } }
```

Multiple operators on the same path = implicit AND:

```ts
match: {
  'resource.amount': { '>': 100, '<': 9999 },        // range
}
```

### Equality operators

```ts
{ '==': value }     // explicit ===
{ '!=': value }     // explicit !==
{ '==': '@path' }   // ref form
```

### Numeric / lexicographic comparisons

Operators expect `number` or `string`. Mismatched types compare as `false`.

```ts
{ '<':  10000 }
{ '<=': 99 }
{ '>':  3 }
{ '>=': 1 }
```

### Membership

```ts
// Literal array
{ in:    ['active', 'pending', 'review'] }
{ notIn: ['archived', 'deleted'] }

// Resolve from input via @ref
{ in: '@principal.groups' }
```

`in` matches when the path value equals at least one item. `notIn` matches when it equals none.

### Regex

```ts
{ regex: '^lead-\\d+$' }     // remember to escape backslashes in JSON
{ regex: '@acme\\.com$' }
```

Compiled with no flags. Use `(?i)` inline flag for case-insensitive (engine-supported subset of ECMAScript regex).

### String / array operators

```ts
{ startsWith: 'lead-' }      // resource.id.startsWith('lead-')
{ endsWith:   '-draft' }
{ contains:   'vip' }        // string.includes (string field) OR array.includes (array field)
```

`contains` is overloaded:

| Field type | Behaviour |
|---|---|
| `string` | `field.includes(needle)` |
| `array` | `field.some(x => x === needle)` |
| anything else | `false` |

### Existence

```ts
{ exists: true }    // path resolves to anything other than undefined (null counts as exists)
{ exists: false }   // path resolves to undefined
```

---

## Composition

Boolean trees with `anyOf`, `allOf`, `not`. These keys cannot be mixed with path keys at the same level.

### `anyOf` — OR

```ts
match: {
  anyOf: [
    { 'resource.assignedTo': '@principal.id' },     // own
    { 'resource.sharedWith': '@principal.id' },     // shared
    { 'principal.groups': { contains: 'admins' } }, // admin
  ],
}
```

Empty `anyOf: []` always evaluates to `false`.

### `allOf` — AND (explicit)

Equivalent to multiple keys at the root level, but explicit:

```ts
match: {
  allOf: [
    { 'resource.channelId': '@principal.groups' },
    { 'resource.status': 'active' },
    { 'resource.assignedTo': null },
  ],
}
```

Empty `allOf: []` always evaluates to `true`.

### `not` — negation

```ts
match: {
  not: { 'resource.assignedTo': '@principal.id' }   // peer-review: NOT the owner
}
```

### Nesting

```ts
match: {
  anyOf: [
    {
      allOf: [
        { 'resource.channelId': '@principal.groups' },
        { 'principal.attrs.role': 'manager' },
      ]
    },
    {
      not: { 'resource.status': 'archived' },
    },
  ],
}
```

> **Style tip**: deep nesting often signals "this should be split into multiple policies." A flat catalog of single-purpose policies is easier to audit, document, and revoke individually.

---

## Implicit `allOf` at the root

Multiple path keys at the root act as `allOf`:

```ts
// These are equivalent:
match: {
  'resource.status': 'active',
  'principal.attrs.role': 'manager',
}

match: {
  allOf: [
    { 'resource.status': 'active' },
    { 'principal.attrs.role': 'manager' },
  ],
}
```

Mixing path keys with composition keys at the same level **throws at compile time**:

```ts
// ✗ INVALID — throws at startup
match: {
  anyOf: [...],
  'resource.status': 'active',
}
```

Wrap the path predicate in `allOf` to combine it:

```ts
// ✓ Valid
match: {
  allOf: [
    { anyOf: [...] },
    { 'resource.status': 'active' },
  ],
}
```

---

## Type & error semantics

| Situation | Result |
|---|---|
| Path resolves to `undefined` | Equality returns `false`; `exists: false` returns `true` |
| Comparison between mismatched types (`<`, `<=`, `>`, `>=`) | `false` |
| Regex compile error | Throws at startup (eager validation) |
| Unknown operator | Throws at startup (`additionalProperties: false` in schema) |
| Invalid composition shape | Throws at startup |
| `condition` function throws at runtime | Treated as non-match; engine logs error; never produces a 500 |

---

## Examples — full policies

### Pool lead — unowned, in user's channel, not archived

```ts
{
  id: 'leads-read-pool',
  effect: 'allow',
  principals: ['scope:lead.read'],
  actions: ['lead.read'],
  resources: ['lead:*'],
  match: {
    'resource.channelId': '@principal.groups',
    'resource.assignedTo': null,
    'resource.status': '!archived',
  },
}
```

### High-value writes need approval

```ts
{
  id: 'high-value-needs-approval',
  effect: 'deny',
  principals: ['**'],
  actions: ['lead.update'],
  resources: ['lead:*'],
  match: {
    'resource.amount': { '>': 50000 },
    'resource.approvalStatus': { '!=': 'approved' },
  },
}
```

### Region restriction via context

```ts
{
  id: 'us-only-during-eu-hours',
  effect: 'deny',
  principals: ['**'],
  actions: ['order.create'],
  resources: ['order:*'],
  match: {
    'context.region': { in: ['us-east', 'us-west'] },
    'context.hour': { '>=': 9, '<': 18 },
  },
}
```

`context` is the `EvalContext` (`AuthzInput.context`) — populate it however you like (e.g. via a custom interceptor that sets `ctx.policy.context = { region, hour, ... }` before the policy evaluates, or pass via `engine.evaluate({ ...input, context })` from `ctx.policy.evaluate`).

### Email domain whitelist

```ts
{
  id: 'corporate-email-only',
  effect: 'allow',
  principals: ['**'],
  actions: ['admin.invite'],
  resources: ['team:*'],
  match: {
    'principal.attrs.email': { regex: '^[^@]+@acme\\.com$' },
  },
}
```

### Composite — manager OR owner, not archived

```ts
{
  id: 'lead-edit-extended',
  effect: 'allow',
  principals: ['scope:lead.update'],
  actions: ['lead.update'],
  resources: ['lead:*'],
  match: {
    allOf: [
      { 'resource.status': '!archived' },
      {
        anyOf: [
          { 'principal.attrs.role': 'manager' },
          { 'resource.assignedTo': '@principal.id' },
        ],
      },
    ],
  },
}
```

---

## See also

- [Policies guide](../guides/policies.md) — narrative tour
- [Patterns](./patterns.md) — curated recipes
- [API reference](../reference/policies-api.md) — types, config, helpers
