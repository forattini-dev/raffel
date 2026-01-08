# Quickstart

## Install

```bash
pnpm add raffel
```

## Create a server

```ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

server
  .procedure('users.create')
  .handler(async (input: { name: string }) => {
    return { id: `user-${input.name}` }
  })

server
  .event('audit.write')
  .delivery('best-effort')
  .handler(async (payload: { action: string }) => {
    console.log('audit', payload.action)
  })

await server.start()
```

## Call a procedure (HTTP)

```bash
curl -X POST http://localhost:3000/users.create \
  -H 'content-type: application/json' \
  -d '{"name":"Ana"}'
```

## Send an event (HTTP)

```bash
curl -X POST http://localhost:3000/events/audit.write \
  -H 'content-type: application/json' \
  -d '{"action":"user.create"}'
```

## Enable WebSocket or JSON-RPC

```ts
const server = createServer({ port: 3000 })
  .enableWebSocket('/ws')
  .enableJsonRpc('/rpc')
```

## Enable gRPC

```ts
const server = createServer({ port: 3000 }).grpc({
  port: 50051,
  protoPath: './proto/app.proto',
  serviceNames: ['UserService'],
})
```

## Enable GraphQL

```ts
const server = createServer({ port: 3000 }).enableGraphQL('/graphql')
```

## Enable filesystem discovery

```ts
const server = createServer({
  port: 3000,
  discovery: true,
})
```

Example layout:

```
src/
  http/users/get.ts        -> users/get
  rpc/UserService.Create.ts -> UserService.Create
  streams/logs/tail.ts     -> logs/tail
  channels/presence-lobby.ts
```
