# GraphQL Resource Discovery

> Status: baseline implemented; advanced inspection and connection helpers remain planned
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

This design adds a GraphQL Resource Discovery layer without replacing the
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
`namespace` is stored with the resource for diagnostics and future inspection;
GraphQL type and root field names still come from the resource file itself.

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
        resource: (lead) => ({
          type: 'lead',
          id: lead.id,
          tenantId: lead.tenantId,
        }),
        onDeny: 'filter',
      },
    },
    get: {
      field: 'lead',
      args: { id: z.string() },
      resolver: (_parent, { id }, ctx) => ctx.services.leads.get(id),
      authz: {
        action: 'lead.read',
        resource: (lead) => ({ type: 'lead', id: lead.id, tenantId: lead.tenantId }),
      },
    },
  },

  mutations: {
    create: {
      field: 'createLead',
      input: LeadSchema.omit({ id: true }),
      authorize: {
        action: 'lead.create',
        resource: (_parent, args) => ({
          type: 'lead',
          id: '*',
          tenantId: args.input.tenantId,
        }),
      },
      resolver: (_parent, args, ctx) => ctx.services.leads.create(args.input),
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

GraphQL resources describe GraphQL shape. They may import schemas/adapters
shared with REST resources, but they are not automatically inferred from
`.rest.ts`.

---

## Relation Contract

Relations are explicit. Raffel supports these resolver modes:

| Mode | Use case |
| --- | --- |
| `resolver` | Custom relation logic. |
| `loader` + `batchKey` | DataLoader-style batching for one-to-one/many-to-one relations. |
| parent property fallback | Omit both and Raffel reads `parent[relationName]`. |

`connection` helpers for cursor-paginated one-to-many relations are still a
planned extension. Current relation resolvers receive:

- `parent`
- `args`
- `ctx`
- `info`

`loader` resolves against `ctx.services`: `loader: 'users.byId'` accepts either
`ctx.services['users.byId']` or `ctx.services.users.byId`. The resolved loader
may be a function `(key, args, ctx, info) => value` or a DataLoader-like object
with `.load(key)` / `.loadMany(keys)`.

---

## Policy Integration

There are two authorization levels:

1. Root field authorization: Query/Mutation/Subscription fields.
2. Schema resolver authorization: object fields, relations, and computed fields.

Root fields that call Raffel procedures can continue using existing procedure
interceptors and `.authz()` metadata.

Field-level resolvers need policy access even when no procedure interceptor ran.
The GraphQL adapter attaches a policy bridge at request creation when the server
has policy configured. Resource files declare the action/resource tuple; the
policy engine decides.

```ts
authorize: {
  action: 'lead.create',
  resource: (_parent, args) => ({ type: 'lead', id: '*', tenantId: args.input.tenantId }),
}
```

`authz` runs after the resolver and supports:

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

`authorize` is separate from `authz`: use `authorize` for pre-resolver gates,
especially mutations; use `authz` for resolved objects, relations, and list
filtering.

When a GraphQL resource is discovered from the filesystem, sibling
`<resource>.graphql.policy.{yaml,yml,json}` files and ancestor `_policy.*`
files are loaded through the same co-located policy resolver used by REST
resources and procedures. The policies are registered into the policy engine
after route loading and before resolver evaluation, and are protocol-scoped to
GraphQL unless the policy declares its own `scope.protocols`.

---

## Interaction With Existing GraphQL Generation

Raffel should keep both paths:

- operation-first: registry procedures/streams/events generate fields
- resource-first: GraphQL Resource Discovery contributes object types, root
  fields, relations, and field-level resolvers

When both paths define the same field name, startup should fail with a clear
diagnostic unless the resource field explicitly declares an override.

---

## Implementation Status

Implemented:

- `discovery.graphql` source normalization, including multiple roots.
- `loadGraphQLResources` for `*.graphql.ts/js` files.
- `graphqlResource` helper and resource/relation/authz types.
- Resource object type, Query, Mutation, relation, and pagination arg composition.
- Co-located policy loading for GraphQL resources.
- Operation-first generation and resource-first generation in the same schema.
- Duplicate GraphQL type/root field startup errors.
- Policy bridge for HTTP GraphQL and subscriptions.
- Resolver-level `authorize` / `authz` with `throw`, `null`, and `filter`.
- `loader + batchKey` relation resolution through `ctx.services`.

Planned:

- Expose GraphQL resources in runtime preview/inspect.
- Surface resource fields and policy metadata in USD.
- Add connection helpers for cursor-paginated one-to-many relations.

---

## Open Questions

- Should `.rest.ts` support an optional `graphql` export as a convenience, or
  should GraphQL always live in dedicated `.graphql.ts` files?
- Should `namespace` eventually participate in generated type names, or remain
  diagnostics-only?
- Should connection helpers return Relay-style edges/nodes, or a Raffel-native
  lightweight page shape?
