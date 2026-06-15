# GraphQL Adapter

GraphQL is exposed over HTTP with optional subscriptions. Schemas can be
auto-generated from the registry + handler schemas.

## Enable GraphQL

```ts
createServer({ port: 3000 }).enableGraphQL('/graphql')
```

## Front-Door support

GraphQL is supported as a shared front-door protocol and is served from the same
listener as HTTP when included in `frontDoor.protocols` (or when omitted from
the protocol list).

```ts
createServer({
  port: 3000,
  frontDoor: { enabled: true, port: 3001, protocols: ['http', 'graphql'] },
  graphql: '/graphql',
})
```

Or with options:

```ts
createServer({
  port: 3000,
  graphql: {
    path: '/graphql',
    playground: true,
    introspection: true,
    generateSchema: true,
    subscriptions: true,
  },
})
```

If `port` is omitted, GraphQL shares the HTTP server. Provide `port` to run it on
its own socket.

## Request limits and timeouts

GraphQL enforces request size and timeout settings:

- `maxBodySize` limits the raw request body size (default: 1MB). Oversized
  requests return `413` with `errors[0].extensions.code = 'PAYLOAD_TOO_LARGE'`.
- `timeout` sets a hard deadline for parsing, validation, and execution.
  Timeouts return `504` with `errors[0].extensions.code = 'DEADLINE_EXCEEDED'`.

## Content Negotiation

GraphQL accepts `application/json` payloads or raw query strings with
`text/plain` / `application/graphql`. Unsupported `Content-Type` values (or
missing `Content-Type` with a body) return `415`. Responses are encoded based on
`Accept`, defaulting to JSON when `Accept` is missing or `*/*`. Unsupported
`Accept` values return `406`.

Additional codecs can be registered via `graphql.codecs`.

## Subscriptions keep-alive

When subscriptions are enabled, you can send periodic keep-alive pings by
setting `subscriptions.keepAliveInterval` (ms). The server sends `ping`
messages at the configured interval.

Clients can pass `connection_init` payloads to seed auth/context. The payload
is exposed in resolver context under `raffel.connection_init`, and any
`headers`/`metadata` fields are merged into envelope metadata.

## Error extensions

When resolvers fail with a Raffel error, GraphQL errors include
`extensions.code` with the Raffel error code. Non-Raffel errors omit the
extension.

## Metadata

Standard headers (`authorization`, `x-request-id`, `traceparent`, `tracestate`,
`content-type`, `accept`, and `x-*`) are copied into envelope metadata for
queries and mutations.

## Schema generation

- Procedures become Query or Mutation fields.
- Streams become Subscriptions.
- Events can be included as mutations with `includeEvents: true`.

Schema generation uses registered handler schemas. If a handler has no schema,
its output defaults to a JSON scalar and it has no typed input arguments.

```ts
createServer({
  port: 3000,
  graphql: {
    schemaOptions: {
      procedureMapping: 'prefix',
      includeEvents: false,
    },
  },
})
```

### Procedure mapping with metadata

If you set `procedureMapping: 'meta'`, Raffel uses `meta.graphql.type` to decide
whether a procedure is a Query or Mutation.

```ts
// File-based
export const meta = {
  graphql: { type: 'query' },
}

// Programmatic
server.procedure('users.get').graphql('query')
```

## Naming

Field names are derived from handler names, splitting on `.`, `-`, and `_`.
For example, `users.get-by-id` becomes `usersGetById`.

## Resource Discovery

GraphQL can also be resource-first. Files named `*.graphql.ts` /
`*.graphql.js` are loaded from `discovery.graphql` and contribute object types,
root fields, relations, and resolver-level policy checks to the generated
schema.

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

The default directory for `discovery: true` is `./src/graphql`.

```ts
// src/domains/leads/graphql/leads.graphql.ts
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
  schema: LeadSchema,

  queries: {
    list: {
      field: 'leads',
      many: true,
      pagination: { style: 'offset', defaultLimit: 25, maxLimit: 100 },
      resolver: (_parent, args, ctx) => ctx.services.leads.list(args),
      authz: {
        action: 'lead.read',
        resource: (lead) => ({ type: 'lead', id: lead.id, tenantId: lead.tenantId }),
        onDeny: 'filter',
      },
    },
  },

  mutations: {
    create: {
      field: 'createLead',
      input: LeadSchema.omit({ id: true }),
      authorize: {
        action: 'lead.create',
        resource: (_parent, args) => ({ type: 'lead', id: '*', tenantId: args.input.tenantId }),
      },
      resolver: (_parent, args, ctx) => ctx.services.leads.create(args.input),
    },
  },

  relations: {
    owner: {
      type: 'User',
      nullable: false,
      loader: 'users.byId',
      batchKey: (lead) => lead.ownerId,
      authz: {
        action: 'user.read',
        resource: (user) => ({ type: 'user', id: user.id, tenantId: user.tenantId }),
        onDeny: 'null',
      },
    },
  },
})
```

`pagination` is opt-in. Offset pagination adds `limit` and `offset` arguments;
cursor pagination adds `first` and `after`. Raffel applies `defaultLimit` and
caps requests at `maxLimit` before calling the resolver.

GraphQL authorization uses the policy module. `authorize` runs before a root
resolver and is suited to mutation guards. `authz` runs against the resolved
value; lists can use `onDeny: 'filter'`, nullable fields can use
`onDeny: 'null'`, and the default behavior is to throw `PERMISSION_DENIED`.

When the resource is loaded through FS discovery, co-located policy files are
loaded too. Use `leads.graphql.policy.yaml` next to `leads.graphql.ts`, or an
ancestor `_policy.yaml`, to provide the rules evaluated by `authorize`/`authz`.
Those policies are registered after route loading and scoped to the GraphQL
protocol unless they declare their own `scope.protocols`.

When USD docs are enabled, resource-first GraphQL metadata appears under
`x-usd.graphql` in `/docs/usd.json` and in the GraphQL tab of the docs UI.
The document includes the GraphQL endpoint, discovered resources, root fields,
relations, pagination settings, and sanitized `authorize`/`authz` metadata.

Relations are explicit. Use `resolver` for custom logic, or `loader` +
`batchKey` to resolve a DataLoader-like service from `ctx.services`:
`loader: 'users.byId'` accepts either `ctx.services['users.byId']` or
`ctx.services.users.byId`.

See [GraphQL Resource Discovery](/spec/graphql-resource-discovery.md) for the
full architecture notes.
