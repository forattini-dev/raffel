# WebSocket Adapter

Raffel's WebSocket adapter serves three use cases from the same server:

1. **RPC + Streams** -- procedures and server streams over JSON envelopes (like gRPC, but WebSocket)
2. **Channels** -- Pusher-like pub/sub with presence, rooms, groups, history, and recovery
3. **Custom Protocol** -- your own message types, your own rules, with full access to low-level send/receive

All three can run simultaneously on the same connection.

---

## Quick Start

### Minimal (RPC only)

```typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  websocket: true,  // enables WS on same port as HTTP
})

server.procedure('greet', async (input) => `Hello, ${input.name}!`)

await server.start()
```

### With Channels

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    channels: {
      authorize: (socketId, channel, ctx) => ctx.auth?.authenticated ?? false,
    },
  },
})
```

### With Custom Protocol

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    onConnection: (socketId, send) => {
      send({ type: 'welcome', id: socketId })
    },
    onMessage: (socketId, raw, send) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'ping') {
        send({ type: 'pong' })
        return true  // handled
      }
      return false  // let Raffel process as envelope
    },
  },
})
```

---

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | - | Port to listen on (omit to share HTTP port) |
| `path` | `string` | `'/'` | WebSocket endpoint path |
| `maxPayloadSize` | `number` | `1MB` | Max message size in bytes |
| `heartbeatInterval` | `number` | `30000` | Ping interval in ms (0 to disable) |
| `channels` | `ChannelOptions` | - | Enable Pusher-like channels |
| `contextFactory` | `function` | - | Build auth context from upgrade request |
| `auth` | `WebSocketAuthConfig` | - | Connection authentication (ticket, bearer, custom) |
| `backpressure` | `BackpressureConfig` | - | Slow consumer handling |
| `compression` | `boolean \| object` | `false` | Per-message compression (RFC 7692) |
| `filter` | `WebSocketConnectionFilter` | - | IP/origin allow/deny lists |
| `recovery` | `object` | - | Connection state recovery on reconnect |
| `onMessage` | `function` | - | Custom protocol: intercept raw messages |
| `onConnection` | `function` | - | Custom protocol: handle new connections |
| `onClose` | `function` | - | Custom protocol: handle disconnections |

---

## Envelope Protocol

The default protocol uses JSON-encoded envelopes for RPC and streams:

### Request / Response

```json
// Client → Server
{ "id": "r1", "procedure": "users.create", "type": "request", "payload": { "name": "Kai" } }

// Server → Client
{ "id": "r1:response", "procedure": "users.create", "type": "response", "payload": { "id": "u_123" } }
```

### Streams

```json
// Client → Server (initiate)
{ "id": "s1", "procedure": "logs.tail", "type": "stream:start", "payload": {} }

// Server → Client (chunks)
{ "id": "s1:stream:data:1", "type": "stream:data", "payload": { "line": "..." } }
{ "id": "s1:stream:data:2", "type": "stream:data", "payload": { "line": "..." } }
{ "id": "s1:stream:end", "type": "stream:end", "payload": null }
```

### Cancellation

```json
// Client → Server
{ "id": "r1", "type": "cancel" }
```

### Metadata

Connection headers (`authorization`, `x-request-id`, `traceparent`, `tracestate`) are merged into every envelope's metadata. Per-message `metadata` fields are also supported.

---

## Authentication

Three auth modes for WebSocket connections. See [Channels > Authentication](/protocols/channels.md#authentication) for full details.

| Mode | How it works | Best for |
|------|-------------|----------|
| `ticket` | Single-use token from HTTP, passed as `?ticket=xxx` | Browsers (recommended) |
| `bearer` | JWT/API key as `?token=xxx` or `Authorization` header | Server-to-server, mobile |
| `custom` | Your own `extractToken` + `validateToken` logic | Cookies, custom protocols |

```typescript
websocket: {
  auth: {
    mode: 'ticket',
    ticketStore: createMemoryTicketStore(),
    refreshToken: async (newToken) => {
      const payload = await verifyJWT(newToken)
      if (!payload) return null
      return { auth: { authenticated: true, principal: payload.sub } }
    },
  },
}
```

Mid-connection token refresh:

```json
{ "id": "r1", "type": "auth:refresh", "token": "new-jwt-here" }
```

---

## Backpressure

Protect the server from slow consumers:

```typescript
websocket: {
  backpressure: {
    maxBufferedAmount: 1024 * 1024,  // 1MB
    strategy: 'drop',                // 'drop' or 'disconnect'
    onSlowConsumer: (socketId, bufferedAmount) => {
      console.warn(`Slow consumer: ${socketId}`)
    },
  },
}
```

Checked at every send point: envelopes, channel broadcasts, direct messages, raw sends.

---

## Compression

Enable per-message compression (RFC 7692) for 60-80% bandwidth savings:

```typescript
websocket: {
  compression: true,

  // Or fine-tune:
  compression: {
    threshold: 1024,  // Only compress messages > 1KB
    level: 1,         // zlib level (1=fastest, 9=best ratio)
  },
}
```

No client changes needed -- browsers and the `ws` library negotiate compression automatically.

---

## Channels (optional)

Enable Pusher-like pub/sub with presence, rooms, groups, history, recovery, rate limiting, REST API, and more.

```typescript
websocket: {
  channels: {
    authorize: (socketId, channel, ctx) => ctx.auth?.authenticated ?? false,
    presenceData: (socketId, channel, ctx) => ({
      userId: ctx.auth?.principalId,
      name: ctx.auth?.claims?.name,
    }),
    rateLimits: { maxChannelsPerClient: 100 },
    history: { enabled: true, maxSize: 100, ttl: 300000 },
    typing: { enabled: true, timeout: 5000 },
    maxSubscribersPerChannel: 10000,
    hooks: { onConnect: (e) => log(e), onDisconnect: (e) => log(e) },
    restApi: { enabled: true, apiKey: 'secret' },
  },
}
```

For the full channel feature reference, see [WebSocket Channels](/protocols/channels.md).

---

## Custom Protocol

Build your own WebSocket protocol without using Raffel's envelope format or channels. Three hooks give you full control.

### onMessage -- Intercept Raw Messages

Called **before** any Raffel processing. Return `true` to handle the message yourself, `false` to let Raffel process it.

```typescript
websocket: {
  onMessage: (socketId, raw, send) => {
    const msg = JSON.parse(raw.toString())

    switch (msg.type) {
      case 'game:move':
        processGameMove(socketId, msg.x, msg.y)
        send({ type: 'game:ack', moveId: msg.id })
        return true

      case 'game:chat':
        broadcastToRoom(msg.room, { from: socketId, text: msg.text })
        return true

      default:
        return false  // Unknown type → let Raffel handle as envelope
    }
  },
}
```

### onConnection -- Handle New Connections

Called after auth and connection filter pass. Receives a `send` function to message the client.

```typescript
websocket: {
  onConnection: (socketId, send, req) => {
    // Send welcome message
    send({ type: 'connected', socketId, serverTime: Date.now() })

    // Track the connection in your own state
    myConnections.set(socketId, { ip: req.socket.remoteAddress })
  },
}
```

### onClose -- Handle Disconnections

```typescript
websocket: {
  onClose: (socketId, code, reason) => {
    myConnections.delete(socketId)
    notifyOthers({ type: 'user_left', socketId })
  },
}
```

### Hybrid Mode (Custom + Channels + RPC)

All three modes work simultaneously. `onMessage` intercepts first; if it returns `false`, Raffel checks for channel messages, then envelope (RPC/stream) messages.

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    // Channels for pub/sub
    channels: {
      authorize: () => true,
    },

    // Custom types handled before Raffel
    onMessage: (socketId, raw, send) => {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'game:move') {
        handleGame(socketId, msg)
        return true
      }
      return false  // subscribe, publish, RPC → handled by Raffel
    },
  },
})

// RPC procedures also work on the same connection
server.procedure('leaderboard.get', async () => getLeaderboard())
```

Message processing order:

```
Client sends message
  ↓
1. onMessage hook (return true → stop)
  ↓
2. Channel messages (subscribe, unsubscribe, publish, typing, batch)
  ↓
3. Auth refresh (auth:refresh)
  ↓
4. Recovery (recover)
  ↓
5. Cancel (cancel)
  ↓
6. Envelope → Router (request, stream:start, event)
```

---

## Low-Level Adapter API

The `WebSocketAdapter` exposes methods for direct client management, regardless of whether channels are enabled.

### Send to a Specific Client

```typescript
// JSON-serialized (object → JSON string)
adapter.send(socketId, { type: 'notification', data: { title: 'New order' } })

// Raw data (string or Buffer — bypasses JSON serialization)
adapter.sendRaw(socketId, Buffer.from([0x01, 0x02, 0x03]))
adapter.sendRaw(socketId, 'plain text message')
```

### Broadcast to All

```typescript
// Send to every connected client
adapter.broadcast({ type: 'system', message: 'Server restart in 5 minutes' })

// Exclude one client (e.g., the sender)
adapter.broadcast({ type: 'user:typing', userId: 'alice' }, senderSocketId)
```

### Query Clients

```typescript
// List all connected clients
const clients = adapter.getClients()
// [{ id: 'abc', remoteAddress: '192.168.1.100', metadata: {...}, connectedAt: 1710000000 }]

// Get one client
const client = adapter.getClient(socketId)
// { id, remoteAddress, metadata, authSeed, connectedAt }
```

### Disconnect a Client

```typescript
adapter.disconnect(socketId, 4001, 'Kicked by admin')
```

### WebSocketClientInfo Type

```typescript
interface WebSocketClientInfo {
  id: string                              // Socket ID
  remoteAddress?: string                  // IP address
  metadata: Record<string, string>        // Connection headers
  authSeed?: ContextSeed                  // Auth context (if authenticated)
  connectedAt: number                     // Unix timestamp
}
```

---

## Complete Example: Custom Chat Protocol

A full chat server using only the custom protocol hooks (no channels, no envelopes):

```typescript
import { createServer } from 'raffel'

const users = new Map<string, { name: string; room: string }>()

const server = createServer({
  port: 3000,
  websocket: {
    onConnection: (socketId, send) => {
      send({ type: 'connected', id: socketId })
    },

    onMessage: (socketId, raw, send) => {
      const msg = JSON.parse(raw.toString())

      switch (msg.type) {
        case 'join': {
          users.set(socketId, { name: msg.name, room: msg.room })
          send({ type: 'joined', room: msg.room })

          // Notify others in the room
          for (const [id, user] of users) {
            if (id !== socketId && user.room === msg.room) {
              server.wsAdapter?.send(id, {
                type: 'user_joined',
                name: msg.name,
              })
            }
          }
          return true
        }

        case 'message': {
          const user = users.get(socketId)
          if (!user) { send({ type: 'error', message: 'Not in a room' }); return true }

          // Broadcast to room
          for (const [id, u] of users) {
            if (u.room === user.room) {
              server.wsAdapter?.send(id, {
                type: 'message',
                from: user.name,
                text: msg.text,
                timestamp: Date.now(),
              })
            }
          }
          return true
        }

        case 'who': {
          const user = users.get(socketId)
          const roomUsers = [...users.values()]
            .filter((u) => u.room === user?.room)
            .map((u) => u.name)
          send({ type: 'members', users: roomUsers })
          return true
        }

        default:
          return false
      }
    },

    onClose: (socketId) => {
      const user = users.get(socketId)
      if (user) {
        users.delete(socketId)
        for (const [id, u] of users) {
          if (u.room === user.room) {
            server.wsAdapter?.send(id, {
              type: 'user_left',
              name: user.name,
            })
          }
        }
      }
    },
  },
})

await server.start()
```

Client:

```javascript
const ws = new WebSocket('ws://localhost:3000')

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data)
  console.log(msg)
}

// Join a room
ws.send(JSON.stringify({ type: 'join', name: 'Alice', room: 'general' }))

// Send a message
ws.send(JSON.stringify({ type: 'message', text: 'Hello everyone!' }))

// Ask who's in the room
ws.send(JSON.stringify({ type: 'who' }))
```

---

## Front-Door Support

When front-door is enabled, the WebSocket upgrade is handled on the shared front-door listener:

```typescript
createServer({
  port: 3000,
  frontDoor: { enabled: true, port: 3001, protocols: ['websocket', 'http'] },
  websocket: { path: '/ws' },
})
```

---

## USD Content Types

USD defaults to JSON for WebSocket messages:

```typescript
server.enableUSD({
  websocket: {
    contentTypes: {
      default: 'application/json',
      supported: ['application/json', 'application/octet-stream'],
    },
  },
})
```
