# GraphQL Adapter

GraphQL is exposed over HTTP with optional subscriptions. Schemas can be
auto-generated from the registry + handler schemas.

## Enable GraphQL

```ts
createServer({ port: 3000 }).enableGraphQL('/graphql')
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
