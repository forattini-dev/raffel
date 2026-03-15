# JSON Server

Raffel-native multi-protocol mock server. Turns plain JSON data into a fully functional API with zero boilerplate.

## What You Get

| Protocol | Routes | Default |
|----------|--------|---------|
| **HTTP REST** | `GET/POST/PUT/PATCH/DELETE /resource[/:id]` | Always on |
| **WebSocket** | `resource.list`, `resource.get`, `resource.$watch` (real-time) | On |
| **JSON-RPC** | Same procedures on `/rpc` | Opt-in |

## Quick Start

### Standalone Server

```typescript
import { createJsonServer } from 'raffel'

const { server, store } = await createJsonServer({
  port: 3000,
  db: {
    posts: [{ id: 1, title: 'Hello', userId: 1 }],
    users: [{ id: 1, name: 'John' }],
  },
})

// HTTP:
//   GET    /posts              → list with ?_sort=title&_order=asc&_page=1&_limit=10&_q=text
//   GET    /posts/1            → get by id
//   POST   /posts              → create
//   PUT    /posts/1            → replace
//   PATCH  /posts/1            → update
//   DELETE /posts/1            → delete
//
// WebSocket (ws://localhost:3000/ws):
//   { procedure: 'posts.list', payload: {} }
//   { procedure: 'posts.$watch' }  → real-time stream of changes
```

### From a JSON File

```typescript
const { server, store } = await createJsonServer({
  port: 3000,
  db: './data/db.json', // loaded at startup, auto-saved on mutations
})
```

### Mount on Existing Server

Use `createJsonModule()` to add JSON Server routes to your own Raffel server — alongside your real procedures, auth, interceptors, etc.

```typescript
import { createServer } from 'raffel'
import { createJsonModule } from 'raffel'

const { module, middleware, store } = createJsonModule({
  posts: [{ id: 1, title: 'Hello' }],
  users: [{ id: 1, name: 'John' }],
})

const server = createServer({
  port: 3000,
  http: { middleware: [middleware] },
})

server.mount('', module)

await server.start()
```

## Options

### `createJsonServer(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `db` | `JsonDb \| string` | required | Initial data object or path to `.json` file |
| `port` | `number` | `3000` | HTTP port |
| `hostname` | `string` | `'0.0.0.0'` | Bind address |
| `readonly` | `boolean` | `false` | Disable all write operations |
| `delay` | `number` | — | Simulate network latency (ms) |
| `idKey` | `string` | `'id'` | Field name used as record ID |
| `protocols.ws` | `boolean` | `true` | Enable WebSocket |
| `protocols.jsonrpc` | `boolean` | `false` | Enable JSON-RPC on `/rpc` |
| `onListen` | `() => void` | — | Called when server is ready |

### `createJsonModule(db, options?)`

Same options as above minus `db`, `port`, `hostname`, `protocols`, and `onListen`.

Returns `{ module, middleware, store }`.

## Query Parameters

The `GET /resource` endpoint supports filtering, sorting, and pagination:

| Parameter | Example | Description |
|-----------|---------|-------------|
| `_sort` | `?_sort=title` | Sort by field |
| `_order` | `?_order=desc` | Sort direction (`asc` or `desc`) |
| `_page` | `?_page=2` | Page number |
| `_limit` | `?_limit=10` | Items per page |
| `_q` | `?_q=hello` | Full-text search across all string fields |
| Any field | `?userId=1` | Filter by exact field value |

## Real-Time Streams

The `$watch` stream yields `StoreEvent` objects whenever the resource changes:

```typescript
// Over WebSocket
ws.send(JSON.stringify({ procedure: 'posts.$watch' }))

// Each event:
{
  op: 'create' | 'update' | 'replace' | 'delete',
  resource: 'posts',
  id: 1,
  data: { /* new record */ },
  prev: { /* previous record, on update/replace/delete */ }
}
```

## Architecture

Two layers share one `InMemoryStore`:

1. **REST middleware** — `HttpMiddleware` that intercepts `GET/POST/PUT/PATCH/DELETE` before the Raffel RPC router
2. **Router module** — `RouterModule` with procedures (`resource.list`, `resource.get`, `resource.create`, `resource.replace`, `resource.update`, `resource.delete`) + `resource.$watch` server stream

This means the same data is accessible via HTTP REST, WebSocket, and JSON-RPC simultaneously.
