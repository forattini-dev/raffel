# Discovery Cheatsheet

Quick reference for Raffel file-system discovery.

## Directory defaults

```
src/http/      -> HTTP procedures
src/rpc/       -> JSON-RPC + gRPC procedures
src/streams/   -> Stream handlers
src/channels/  -> WebSocket channel configs
```

## Route naming

Names are literal. The adapter uses the same string.

```
src/http/users/get.ts          -> users/get
src/rpc/UserService.Create.ts  -> UserService.Create
src/streams/logs/tail.ts       -> logs/tail
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

Note: `matcher`/`exclude` configs are defined but not applied yet.

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
```
