# Route Discovery

Raffel supports two discovery workflows:

1. Router module discovery with `loadRouterModule` (route objects, dot names)
2. File-system discovery with `createServer({ discovery })` (literal path names)

For the full filesystem spec, see `file-system-discovery.md` and `discovery-cheatsheet.md`.

## Router module discovery (loadRouterModule)

File-based routing loads procedures, streams, and events from a directory tree and
maps file paths to canonical handler names.

### Mapping rules

- `routes/users/create.ts` -> `users.create`
- `routes/users/index.ts` -> `users`
- `routes/index.ts` -> `index`

### Route contract

Each file exports a `route` object (named or default) with a `kind` and `handler`.

```ts
import type { RouteDefinition } from 'raffel'

export const route: RouteDefinition = {
  kind: 'procedure',
  handler: async (input: { name: string }) => ({ id: `user-${input.name}` }),
}
```

### Load and mount

```ts
import { createServer, loadRouterModule } from 'raffel'

const server = createServer({ port: 3000 })
const routes = await loadRouterModule({ rootDir: './routes' })

server.mount('api', routes)
```

## File-system discovery (createServer discovery)

Enable discovery at server startup:

```ts
const server = createServer({
  port: 3000,
  discovery: true,
})
```

### Default layout

```
src/
  http/        # HTTP procedures
  rpc/         # JSON-RPC + gRPC procedures
  streams/     # Stream handlers
  channels/    # WebSocket channels
```

### Mapping rules

- `src/http/users/get.ts` -> `users/get`
- `src/rpc/users/create.ts` -> `users/create`
- `src/rpc/UserService.Create.ts` -> `UserService.Create` (gRPC service.method)
- `src/streams/logs/tail.ts` -> `logs/tail`
- `src/channels/presence-lobby.ts` -> `presence-lobby`

Route names are literal. The adapters do not perform parameter extraction.

### Handler contract

Each handler file exports a default function and optional schemas/meta.

```ts
import { z } from 'zod'

export const input = z.object({ id: z.string() })
export const output = z.object({ name: z.string() })

export const meta = {
  description: 'Fetch a user',
  auth: 'required',
  roles: ['admin'],
}

export default async function handler(input, ctx) {
  return { name: `user-${input.id}` }
}
```

### Stream direction

For stream handlers, set `meta.direction` to `server` (default), `client`, or `bidi`.

```ts
export const meta = {
  direction: 'client',
}
```

### Middleware and auth

- `_middleware.ts` files apply to all handlers in the same directory tree.
- `_auth.ts` files define auth verification; the closest ancestor wins.

```ts
// src/http/_auth.ts
export default {
  strategy: 'bearer',
  verify: async (token) => ({ principal: token }),
}
```

### Channels

Channel files export configuration (auth, events, hooks).

```ts
// src/channels/presence-lobby.ts
import { z } from 'zod'

export const auth = 'required'
export const events = {
  message: { input: z.object({ text: z.string() }) },
}
```

### Hot reload

Discovery watches the filesystem in development by default. You can control this:

```ts
const server = createServer({
  port: 3000,
  discovery: true,
  hotReload: true,
})

await server.discoveryWatcher?.reload()
```
