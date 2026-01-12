# Discovery Cheatsheet

Quick reference for Raffel file-system discovery.

## Directory defaults

```
src/http/      -> HTTP procedures
src/rpc/       -> JSON-RPC + gRPC procedures
src/streams/   -> Stream handlers
src/channels/  -> WebSocket channel configs
src/rest/      -> REST resources
src/resources/ -> Resource handlers
src/tcp/       -> TCP handlers
src/udp/       -> UDP handlers
```

## Route naming

Names are literal. The adapter uses the same string.

```
src/http/users/get.ts          -> users/get
src/rpc/UserService.Create.ts  -> UserService.Create
src/streams/logs/tail.ts       -> logs/tail
src/http/users/[id]/get.ts     -> users/:id/get
src/http/posts/[...slug].ts    -> posts/:slug*
src/http/posts/[[slug]].ts     -> posts/:slug?
```

## Handler template

```ts
import { z } from 'zod'

export const input = z.object({ id: z.string() })
export const output = z.object({ name: z.string() })

export const meta = {
  description: 'Get item by ID',
  auth: 'required',
  roles: ['user'],
  direction: 'server',
}

export default async function handler(input, ctx) {
  return { name: 'Example' }
}
```

## Special files

| File | Purpose |
|------|---------|
| `_middleware.ts` | Directory middleware |
| `_auth.ts` | Auth configuration |

`matcher`/`exclude` configs are applied with simple `*` wildcard matching.

## Stream directions

| Direction | Meaning |
|-----------|---------|
| `server` | Server -> client stream |
| `client` | Client -> server stream |
| `bidi` | Bidirectional |

## Server config

```ts
createServer({
  port: 3000,
  discovery: true,
  hotReload: true,
})
```

## Manual loaders

```ts
const result = await loadDiscovery({ discovery: true })
server.addDiscovery(result)

const rest = await loadRestResources({ restDir: './src/rest' })
for (const resource of rest.resources) server.addRest(resource)

const resources = await loadResources({ resourcesDir: './src/resources' })
for (const resource of resources.resources) server.addResource(resource)

const tcp = await loadTcpHandlers({ tcpDir: './src/tcp' })
for (const handler of tcp.handlers) server.addTcpHandler(handler)

const udp = await loadUdpHandlers({ udpDir: './src/udp' })
for (const handler of udp.handlers) server.addUdpHandler(handler)
```
