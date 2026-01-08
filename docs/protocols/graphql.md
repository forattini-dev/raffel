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

## Naming

Field names are derived from handler names, splitting on `.`, `-`, and `_`.
For example, `users.get-by-id` becomes `usersGetById`.
