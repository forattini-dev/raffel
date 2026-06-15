# GraphQL Resource Discovery

> Status: draft
> Scope: GraphQL schema generation, file-system discovery, resource relations, and field-level authorization

---

## Summary

Raffel already exposes GraphQL from the registry:

- procedures become Query or Mutation fields
- streams become Subscriptions
- `meta.graphql.type` can force Query vs Mutation
- discovered procedures can carry co-located policies as interceptors

That is enough for operation-first GraphQL, but not enough for resource-shaped
GraphQL APIs. Resource GraphQL needs a first-class catalog of object types,
root fields, relations, computed fields, batching, and field-level policy checks.

This proposal adds a GraphQL Resource Discovery layer without replacing the
existing procedure-based GraphQL adapter.

---

## Goals

- Support file-system discovery for GraphQL resources across multiple roots.
- Keep REST Resource Files and GraphQL Resource Files independent.
- Let a GraphQL resource define object fields, root queries, mutations, and
  relations in one maintainable module.
- Prevent N+1 relation loading by making batching/data loaders part of the
  resource contract.
- Reuse Raffel policies for GraphQL root resolvers and schema field resolvers.
- Keep authorization separate from authentication. Authentication still populates
  `ctx.auth`; authorization is evaluated by policies/authz.

## Non-Goals

- Replacing the current registry-to-GraphQL auto-generation path.
- Treating REST `.rest.ts` files as GraphQL resources by default.
- Implementing a full ORM or database relationship mapper in Raffel core.
- Making GraphQL field-level auth depend on REST route auth config.

---

## Discovery Layout

Default top-level layout:

```txt
src/
  graphql/
    leads.graphql.ts
    users.graphql.ts
```

Domain-owned layout:

```txt
src/
  domains/
    leads/
      graphql/
        leads.graphql.ts
        notifications.graphql.ts
    users/
      graphql/
        users.graphql.ts
```

Configuration should mirror the multi-source discovery model:

```ts
createServer({
  discovery: {
    graphql: [
      { dir: './src/domains/leads/graphql', namespace: 'crm' },
      { dir: './src/domains/users/graphql', namespace: 'identity' },
    ],
  },
  graphql: {
    path: '/graphql',
    generateSchema: true,
  },
})
```

Unlike HTTP Routes Roots, GraphQL discovery does not need a public path prefix.
It needs a namespace for operation/type collision handling and for diagnostics.

---

## Resource File Shape

```ts
import { z } from 'zod'
import { graphqlResource } from 'raffel/graphql'

const LeadSchema = z.object({
  id: z.string(),
  title: z.string(),
  ownerId: z.string(),
  tenantId: z.string(),
})

export default graphqlResource({
  name: 'Lead',
  pluralName: 'Leads',
  schema: LeadSchema,
  id: 'id',

  queries: {
    list: {
      field: 'leads',
      pagination: { style: 'cursor', defaultLimit: 25, maxLimit: 100 },
      resolver: (_parent, args, ctx) => ctx.services.leads.list(args),
      authz: {
        action: 'lead.read',
        resource: (_parent, _args, ctx) => ({
          type: 'lead',
          id: '*',
          tenantId: ctx.auth?.tenantId,
        }),
      },
    },
    get: {
      field: 'lead',
      args: { id: z.string() },
      resolver: (_parent, { id }, ctx) => ctx.services.leads.get(id),
      authz: {
        action: 'lead.read',
        resource: (_parent, args) => ({ type: 'lead', id: args.id }),
      },
    },
  },

  mutations: {
    create: {
      field: 'createLead',
      input: LeadSchema.omit({ id: true }),
      resolver: (_parent, args, ctx) => ctx.services.leads.create(args.input),
      authz: { action: 'lead.create', resource: () => ({ type: 'lead', id: '*' }) },
    },
  },

  relations: {
    owner: {
      type: 'User',
      many: false,
      nullable: false,
      batchKey: (lead) => lead.ownerId,
      loader: 'users.byId',
      authz: {
        action: 'user.read',
        resource: (user) => ({ type: 'user', id: user.id, tenantId: user.tenantId }),
        onDeny: 'null',
      },
    },
    notifications: {
      type: 'Notification',
      many: true,
      resolver: (lead, args, ctx) => ctx.services.notifications.byLead(lead.id, args),
      authz: {
        action: 'notification.read',
        resource: (notification) => ({
          type: 'notification',
          id: notification.id,
          tenantId: notification.tenantId,
        }),
        onDeny: 'filter',
      },
    },
  },
})
```

The API name `graphqlResource` is illustrative. The important boundary is that
GraphQL resources describe GraphQL shape. They may import schemas/adapters shared
with REST resources, but they are not automatically inferred from `.rest.ts`.

---

## Relation Contract

Relations should be explicit. Raffel should support these resolver modes:

| Mode | Use case |
| --- | --- |
| `resolver` | Custom relation logic. |
| `loader` + `batchKey` | DataLoader-style batching for one-to-one/many-to-one relations. |
| `connection` | Cursor-paginated one-to-many relations. |

Generated relation resolvers must receive:

- `parent`
- `args`
- `ctx`
- `info`
- request-scoped loaders

Request-scoped loaders prevent N+1 queries and keep batching tied to the
GraphQL request lifecycle.

---

## Policy Integration

There are two authorization levels:

1. Root field authorization: Query/Mutation/Subscription fields.
2. Schema resolver authorization: object fields, relations, and computed fields.

Root fields that call Raffel procedures can continue using existing procedure
interceptors and `.authz()` metadata.

Field-level resolvers need policy helpers even when no procedure interceptor ran.
The GraphQL adapter should attach policy helpers at request creation when the
server has policy configured:

```ts
ctx.policy.evaluate(action, resource)
ctx.policy.filterResources(action, resources)
```

Resolver `authz` should support:

```ts
authz: {
  action: 'lead.read.sensitive',
  resource: (value, args, ctx) => ({ type: 'lead', id: value.id }),
  onDeny: 'throw' | 'null' | 'filter'
}
```

Recommended behavior:

- `throw`: GraphQL error with Raffel `PERMISSION_DENIED` extension.
- `null`: return `null` for nullable fields; throw for non-null fields.
- `filter`: remove unauthorized items from lists.

Policies remain the source of authorization. GraphQL resource files only declare
which action/resource a resolver asks the policy engine to evaluate.

---

## Interaction With Existing GraphQL Generation

Raffel should keep both paths:

- operation-first: registry procedures/streams/events generate fields
- resource-first: GraphQL Resource Discovery contributes object types, root
  fields, relations, and field-level resolvers

When both paths define the same field name, startup should fail with a clear
diagnostic unless the resource field explicitly declares an override.

---

## Implementation Phases

### Phase 1: Catalog And Discovery

- Add `discovery.graphql` source normalization.
- Add `loadGraphQLResources`.
- Define `GraphQLResource`, `GraphQLRelation`, `GraphQLFieldAuthz` types.
- Add diagnostics for duplicate type names and duplicate root fields.

### Phase 2: Schema Composition

- Extend `generateGraphQLSchema` to accept resource catalog contributions.
- Generate object types from resource schemas.
- Generate Query/Mutation fields from resource root field configs.
- Keep procedure-based generation working unchanged.

### Phase 3: Resolver Runtime

- Add request-scoped loader registry to GraphQL execution context.
- Execute resource resolvers directly for fields that do not route through
  procedures.
- Normalize resolver errors into GraphQL errors with Raffel error extensions.

### Phase 4: Policy Bridge

- Pass policy bootstrap into GraphQL middleware/adapter.
- Attach `ctx.policy` helpers for GraphQL requests when policy is configured.
- Enforce resolver-level `authz` with `throw`, `null`, and `filter` modes.
- Add tests for root policy, relation policy, sensitive field policy, and list
  filtering.

### Phase 5: Docs And Inspection

- Expose GraphQL resources in runtime preview/inspect.
- Surface resource fields and policy metadata in USD.
- Document FS layouts, relation resolvers, batching, and policy behavior.

---

## Open Questions

- Should `.rest.ts` support an optional `graphql` export as a convenience, or
  should GraphQL always live in dedicated `.graphql.ts` files?
- Should GraphQL resources be exported from `raffel/graphql` only, or from the
  main package entrypoint as well?
- Should relationship loaders be string keys into `ctx.services`, or should
  they be functions registered directly on the resource?
- Should field-level denies default to `throw` globally, with explicit `null` or
  `filter` per field?
