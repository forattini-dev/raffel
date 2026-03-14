# WebSocket Channels

Raffel supports Pusher-like real-time channels for pub/sub messaging over WebSocket.

## Overview

Channels provide:
- **Public Channels**: Anyone can subscribe
- **Private Channels**: Require authentication
- **Presence Channels**: Track online members
- **Rooms**: 1:1 private communication between two clients
- **Groups**: Server-managed N-client collections
- **Message History**: Catchup on reconnect with sequence tracking
- **Connection Recovery**: Seamless reconnect without re-subscribing
- **Authentication**: Ticket-based, bearer, and custom auth
- **Rate Limiting**: Per-connection subscribe/publish limits
- **Backpressure**: Slow consumer protection
- **REST API**: Server-side publishing via HTTP
- **Webhooks**: Lifecycle hooks for all events
- **Transformers**: Server-side message transformation

## Quick Start

```typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  websocket: {
    channels: {
      authorize: async (socketId, channel, ctx) => {
        // Allow all public channels
        if (!channel.startsWith('private-') && !channel.startsWith('presence-')) {
          return true
        }
        // Require auth for private/presence
        return ctx.auth?.authenticated ?? false
      },
      presenceData: (socketId, channel, ctx) => ({
        userId: ctx.auth?.principalId,
        name: typeof ctx.auth?.principal === 'object' ? ctx.auth.principal.claims?.name : undefined,
      }),
    },
  },
})

await server.start()
```

If you provide `authorize`, it runs for every channel (including public). Return
`true` for public channels you want to allow.

Use `raffel playground src/server.ts` to test subscribe/publish flows and
inspect channel events from the same runtime graph used by `inspect` and
`doctor`.

## Channel Types

| Prefix | Type | Auth Required | Member Tracking |
|--------|------|---------------|-----------------|
| (none) | Public | No | No |
| `private-` | Private | Yes | No |
| `presence-` | Presence | Yes | Yes |

## Channel Parameters (USD)

Use templated channel names to expose parameters in USD docs:

```ts
// Example channel names:
// rooms.{roomId}
// private-:userId
```

USD will infer parameters for templated segments and surface them under
`x-usd.websocket.channels.<name>.parameters`.

## Content Types (USD)

USD defaults to JSON for channel messages. You can document operation-specific
content types under each channel:

```json
{
  "x-usd": {
    "websocket": {
      "channels": {
        "chat-room": {
          "subscribe": { "contentTypes": { "default": "application/json" } },
          "publish": { "contentTypes": { "default": "application/octet-stream" } }
        }
      }
    }
  }
}
```

## Server Configuration

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    path: '/ws',
    channels: {
      // Authorization callback
      authorize: async (socketId, channel, ctx) => {
        if (channel.startsWith('private-user-')) {
          const userId = channel.replace('private-user-', '')
          return ctx.auth?.principal === userId
        }
        if (channel.startsWith('presence-')) {
          return ctx.auth?.authenticated ?? false
        }
        return true
      },

      // Presence data generator (for presence channels)
      presenceData: (socketId, channel, ctx) => ({
        userId: ctx.auth?.principalId,
        name: typeof ctx.auth?.principal === 'object' ? ctx.auth.principal.claims?.name : undefined,
        avatar: typeof ctx.auth?.principal === 'object' ? ctx.auth.principal.claims?.avatar : undefined,
        status: 'online',
      }),

      // Optional: publish authorization
      onPublish: async (socketId, channel, event, data, ctx) => {
        // Return true to allow, false to deny
        return true
      },
    },
  },
})
```

---

## Authentication

WebSocket connections in browsers cannot set custom headers. Raffel provides three auth modes to solve this.

### Ticket-Based Auth (Recommended for Browsers)

Generate a short-lived, single-use ticket via HTTP, then pass it on the WebSocket URL. The ticket encodes user identity and is consumed on connect.

**Server setup:**

```typescript
import { createServer, createMemoryTicketStore, generateTicket } from 'raffel'

const ticketStore = createMemoryTicketStore()

const server = createServer({
  port: 3000,
  websocket: {
    auth: {
      mode: 'ticket',
      ticketStore,
      ticketTTL: 30000,  // 30 seconds
    },
    channels: {
      authorize: (socketId, channel, ctx) => ctx.auth?.authenticated ?? false,
    },
  },
})

// HTTP endpoint to generate tickets
server.procedure('auth.ticket')
  .handler(async (input, ctx) => {
    ctx.auth.require()  // Must be authenticated via HTTP

    const ticket = generateTicket(ctx.auth.principalId!, {
      ttl: 30000,
      permissions: ['private-*', 'presence-*'],
      metadata: { role: ctx.auth.claims?.role },
    })

    await ticketStore.create(ticket)
    return { ticketId: ticket.id }
  })
```

**Client:**

```javascript
// 1. Get ticket via HTTP
const { ticketId } = await fetch('/api/auth.ticket', {
  method: 'POST',
  headers: { Authorization: `Bearer ${jwt}` },
}).then(r => r.json())

// 2. Connect WebSocket with ticket
const ws = new WebSocket(`ws://localhost:3000/?ticket=${ticketId}`)
// Ticket is consumed on connect — cannot be reused
```

### Bearer Token Auth

Pass a JWT or API key as a query parameter or Authorization header.

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    auth: {
      mode: 'bearer',
      validateToken: async (token) => {
        const payload = await verifyJWT(token)
        if (!payload) return null  // Reject connection

        return {
          auth: {
            authenticated: true,
            principal: payload.sub,
            principalId: payload.sub,
            claims: payload,
          },
        }
      },
    },
  },
})
```

Client connects with `?token=xxx` or `Authorization: Bearer xxx`.

### Custom Auth

```typescript
auth: {
  mode: 'custom',
  extractToken: (req) => {
    // Extract from cookie, custom header, etc.
    const cookies = parseCookies(req.headers.cookie)
    return cookies.session_id
  },
  validateToken: async (sessionId) => {
    const session = await sessionStore.get(sessionId)
    if (!session) return null
    return { auth: { authenticated: true, principal: session.userId } }
  },
}
```

### Token Extraction Order

When no custom `extractToken` is provided, the adapter checks in order:

1. `?ticket=xxx` query parameter
2. `?token=xxx` query parameter
3. `Authorization: Bearer xxx` header

---

## Token Refresh

Refresh auth tokens mid-connection without disconnecting. No lost subscriptions, no presence flicker.

**Server:**

```typescript
auth: {
  mode: 'bearer',
  validateToken: (token) => verifyJWT(token),
  refreshToken: async (newToken) => {
    const payload = await verifyJWT(newToken)
    if (!payload) return null
    return { auth: { authenticated: true, principal: payload.sub } }
  },
}
```

**Client:**

```javascript
// When JWT is about to expire, send refresh
ws.send(JSON.stringify({
  id: 'refresh-1',
  type: 'auth:refresh',
  token: newJWT,
}))

// Server responds:
// Success: { id: 'refresh-1', type: 'auth:refreshed' }
// Failure: { id: 'refresh-1', type: 'error', code: 'AUTH_FAILED', status: 401 }
```

---

## Rate Limiting

Per-connection rate limits protect the server from abusive or buggy clients.

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    channels: {
      rateLimits: {
        maxChannelsPerClient: 100,       // Max subscriptions per socket
        maxSubscribesPerSecond: 10,      // Subscribe operations per second
        maxPublishesPerSecond: 10,       // Publish operations per second
        onRateLimited: (socketId, operation, limit) => {
          console.log(`Rate limited: ${socketId} on ${operation} (limit: ${limit})`)
        },
      },
    },
  },
})
```

When a client exceeds a limit, the operation fails with:

```json
{
  "id": "sub-1",
  "type": "error",
  "code": "RATE_LIMITED",
  "status": 429,
  "message": "Too many subscribe operations"
}
```

| Limit | Default | Description |
|-------|---------|-------------|
| `maxChannelsPerClient` | unlimited | Max channels a single client can subscribe to |
| `maxSubscribesPerSecond` | unlimited | Subscribe operations per second per client |
| `maxPublishesPerSecond` | unlimited | Publish operations per second per client |

Rate limit state is automatically cleaned up when a client disconnects.

---

## Backpressure

Prevents server OOM when a client can't keep up with message rate (slow consumer).

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    backpressure: {
      maxBufferedAmount: 1024 * 1024,  // 1MB buffer limit
      strategy: 'drop',                // 'drop' or 'disconnect'
      onSlowConsumer: (socketId, bufferedAmount) => {
        console.warn(`Slow consumer: ${socketId} (${bufferedAmount} bytes buffered)`)
      },
    },
  },
})
```

| Strategy | Behavior |
|----------|----------|
| `drop` | Silently skip sending the message to the slow client |
| `disconnect` | Close the connection with code 1008 |

Backpressure is checked at every send point: procedure responses, stream chunks, channel broadcasts, direct messages, and room/group sends.

---

## Sequence Numbers

Every broadcast message includes a monotonically increasing sequence number and a server epoch. This enables:

- **Gap detection**: clients know if they missed messages
- **Ordering guarantees**: messages within a channel are ordered
- **Stale offset detection**: epoch changes on server restart

```json
{
  "type": "event",
  "channel": "chat-room",
  "event": "message",
  "data": { "text": "Hello!" },
  "seq": 42,
  "epoch": "abc123"
}
```

Sequences are independent per channel. The epoch is generated once when the channel manager is created.

---

## Message History

Store recent channel messages and replay them to clients that reconnect. Eliminates the "missed messages" problem that plagues every WebSocket app.

### Configuration

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    channels: {
      history: {
        enabled: true,
        maxSize: 100,       // entries per channel (default: 100)
        ttl: 300000,        // 5 minutes (default)
      },
    },
  },
})
```

### Catchup on Subscribe

Clients include `since` when subscribing to receive missed messages:

```json
{
  "id": "sub-1",
  "type": "subscribe",
  "channel": "chat-room",
  "since": { "seq": 42, "epoch": "abc123" }
}
```

The server sends the `subscribed` response followed by all messages with `seq > 42` and matching `epoch`. If the epoch doesn't match (server restarted), a full replay from the start of history is sent.

### How It Works

1. Every `broadcast()` appends to an in-memory circular buffer
2. Old entries are evicted by `maxSize` and `ttl`
3. On subscribe with `since`, the server replays entries after the given sequence
4. Sequence numbers are per-channel and monotonically increasing

### Server-Side Replay

```typescript
// Replay history manually
server.channels?.replayHistory('socket-123', 'chat-room', sinceSeq, epoch)

// Get current sequence for a channel
const seq = server.channels?.getSequence('chat-room')

// Get server epoch
const epoch = server.channels?.getEpoch()
```

---

## Connection Recovery

When a client disconnects briefly (network blip, page navigation), it can recover its entire session without re-subscribing to every channel. No visible disruption.

### Configuration

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    channels: {
      history: { enabled: true },  // Required for replay
    },
    recovery: {
      enabled: true,
      ttl: 120000,    // 2 minutes (default)
    },
  },
})
```

### How It Works

1. **On connect**: Server sends `connection:established` with a `recoveryToken`
2. **On disconnect**: Server saves session (subscriptions, groups, metadata) for `ttl` ms
3. **On reconnect**: Client sends `{ type: 'recover', recoveryToken: 'xxx' }` as first message
4. **Server restores**: Re-subscribes to all channels, re-joins groups, replays missed messages

### Client Protocol

**Initial connection** — server sends:

```json
{
  "type": "connection:established",
  "socketId": "abc123",
  "recoveryToken": "rec_xyz789"
}
```

**Reconnect** — client sends as first message:

```json
{ "type": "recover", "recoveryToken": "rec_xyz789" }
```

**Recovery success** — server responds:

```json
{
  "type": "connection:recovered",
  "socketId": "new456",
  "recoveryToken": "rec_newtoken",
  "channels": ["chat-room", "presence-lobby"],
  "groups": ["team-alpha"]
}
```

After this, missed messages from each channel are replayed automatically (using history).

**Recovery failure** (token expired or invalid):

```json
{
  "type": "error",
  "code": "RECOVERY_FAILED",
  "status": 404,
  "message": "Recovery token not found or expired"
}
```

### What Gets Recovered

| State | Recovered |
|-------|-----------|
| Channel subscriptions | Yes |
| Group memberships | Yes |
| Missed messages | Yes (if history enabled) |
| Presence membership | No (re-join needed) |
| Room memberships | No (rooms close on disconnect) |
| Auth context | Yes (from saved session) |

---

## Channel Transformers

Transform messages server-side before they reach subscribers. Use cases: strip PII, sanitize HTML, add timestamps, enforce schemas.

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    channels: {
      transform: async (channel, event, data, ctx) => {
        // Strip sensitive fields
        if (event === 'user:profile') {
          const { email, phone, ...safe } = data as Record<string, unknown>
          return safe
        }

        // Add server timestamp
        return { ...(data as Record<string, unknown>), serverTime: Date.now() }
      },
    },
  },
})
```

Return `null` to drop the message silently:

```typescript
transform: (channel, event, data, ctx) => {
  // Block messages containing banned words
  const text = (data as { text?: string }).text ?? ''
  if (bannedWords.some(w => text.includes(w))) return null
  return data
}
```

The transform receives `ctx.socketId` and `ctx.userId` for access control decisions.

---

## REST API for Publishing

HTTP endpoints for server-side channel operations. Lets backend services, cron jobs, and webhooks publish to channels without a WebSocket connection.

### Configuration

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    channels: {
      restApi: {
        enabled: true,
        path: '/channels',       // default
        apiKey: 'my-secret-key', // simple auth
      },
    },
  },
})
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/channels` | List active channels with subscriber counts |
| `GET` | `/channels/:channel` | Channel info (subscribers, members for presence) |
| `POST` | `/channels/:channel/events` | Broadcast event to channel |
| `POST` | `/channels/clients/:socketId/events` | Send event to specific client |
| `POST` | `/channels/broadcast` | Broadcast to ALL connected clients |

### Examples

**Broadcast to channel:**

```bash
curl -X POST http://localhost:3000/channels/chat-room/events \
  -H "Authorization: Bearer my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{ "event": "message", "data": { "text": "Hello from API!" } }'
```

**Send to specific client:**

```bash
curl -X POST http://localhost:3000/channels/clients/socket-123/events \
  -H "Authorization: Bearer my-secret-key" \
  -d '{ "event": "notification", "data": { "title": "New order" } }'
```

**List channels:**

```bash
curl http://localhost:3000/channels \
  -H "Authorization: Bearer my-secret-key"

# Response:
# {
#   "channels": [
#     { "name": "chat-room", "subscribers": 5 },
#     { "name": "presence-lobby", "subscribers": 3 }
#   ]
# }
```

### Custom Auth

```typescript
restApi: {
  enabled: true,
  auth: async (req) => {
    const token = req.headers.authorization?.slice(7)
    return token ? await verifyServiceToken(token) : false
  },
}
```

---

## Extended Webhooks

Beyond the basic lifecycle hooks, the channel manager emits events for publish, channel creation, and channel destruction.

```typescript
channels: {
  hooks: {
    // Basic lifecycle
    onConnect: (e) => webhook('ws.connect', e),
    onDisconnect: (e) => webhook('ws.disconnect', e),
    onSubscribe: (sid, ch) => webhook('channel.subscribe', { sid, ch }),
    onUnsubscribe: (sid, ch) => webhook('channel.unsubscribe', { sid, ch }),

    // Presence
    onMemberAdded: (ch, m) => webhook('presence.join', { ch, member: m }),
    onMemberRemoved: (ch, m) => webhook('presence.leave', { ch, member: m }),

    // Extended (Phase 2+3)
    onPublish: (sid, ch, event, data) => webhook('channel.publish', { sid, ch, event, data }),
    onChannelCreated: (ch, type) => webhook('channel.created', { ch, type }),
    onChannelDestroyed: (ch, type) => webhook('channel.destroyed', { ch, type }),
  },
}
```

### Complete Webhook Event Reference

| Hook | Fires when | Arguments |
|------|-----------|-----------|
| `onConnect` | Client connects | `{ socketId, remoteAddress, headers }` |
| `onDisconnect` | Client disconnects | `{ socketId, code, reason }` |
| `onSubscribe` | Subscribes to channel | `(socketId, channel)` |
| `onUnsubscribe` | Unsubscribes | `(socketId, channel)` |
| `onMemberAdded` | Joins presence channel | `(channel, member)` |
| `onMemberRemoved` | Leaves presence channel | `(channel, member)` |
| `onPublish` | Publishes to channel | `(socketId, channel, event, data)` |
| `onChannelCreated` | First subscriber creates channel | `(channel, type)` |
| `onChannelDestroyed` | Last subscriber leaves | `(channel, type)` |

---

## Server-Side API

### Broadcasting

```typescript
// Broadcast to all subscribers
server.channels?.broadcast('chat-room', 'message', {
  from: 'system',
  text: 'Hello everyone!',
})

// Broadcast to all except sender
server.channels?.broadcast('chat-room', 'message', { text: 'Hi' }, senderSocketId)

// Send to specific socket
server.channels?.sendToSocket(socketId, 'chat-room', 'private-message', { text: 'Hello' })
```

### Presence Management

```typescript
// Get all members in a presence channel
const members = server.channels?.getMembers('presence-lobby')
// [{ id: 'socket-1', userId: 'user-1', info: { name: 'Alice' }, joinedAt: 1234567890 }]

// Get specific member
const member = server.channels?.getMember('presence-lobby', socketId)

// Kick a user from a channel
server.channels?.kick('presence-lobby', socketId)
```

### Channel Info

```typescript
// List all active channels
const channels = server.channels?.getChannels()
// ['chat-room', 'presence-lobby', 'private-user-123']

// Get subscribers of a channel
const subscribers = server.channels?.getSubscribers('chat-room')
// ['socket-1', 'socket-2', 'socket-3']
```

## Using Channels in Handlers

Use the channel manager from the server instance:

```typescript
import { z } from 'zod'

server.procedure('chat.send')
  .input(z.object({
    channel: z.string(),
    text: z.string(),
  }))
  .handler(async (input, ctx) => {
    server.channels?.broadcast(input.channel, 'message', {
      from: ctx.auth?.principalId,
      text: input.text,
      timestamp: Date.now(),
    })
    return { sent: true }
  })
```

## Client Protocol

### Subscribe

```json
{
  "id": "sub-1",
  "type": "subscribe",
  "channel": "chat-room"
}
```

**Success Response:**
```json
{
  "id": "sub-1",
  "type": "subscribed",
  "channel": "chat-room"
}
```

**Presence Channel Response:**
```json
{
  "id": "sub-1",
  "type": "subscribed",
  "channel": "presence-lobby",
  "members": [
    { "id": "socket-1", "userId": "user-1", "info": { "name": "Alice" }, "joinedAt": 1234567890 }
  ]
}
```

**Error Response:**
```json
{
  "id": "sub-1",
  "type": "error",
  "code": "PERMISSION_DENIED",
  "status": 403,
  "message": "Not authorized to subscribe to private-user-456"
}
```

### Unsubscribe

```json
{
  "id": "unsub-1",
  "type": "unsubscribe",
  "channel": "chat-room"
}
```

### Publish (Client → Server → All Subscribers)

```json
{
  "id": "pub-1",
  "type": "publish",
  "channel": "chat-room",
  "event": "message",
  "data": { "text": "Hello!" }
}
```

### Receiving Events

```json
{
  "type": "event",
  "channel": "chat-room",
  "event": "message",
  "data": { "from": "user-1", "text": "Hello!" }
}
```

### Presence Events

**Member Joined:**
```json
{
  "type": "event",
  "channel": "presence-lobby",
  "event": "member_added",
  "data": {
    "id": "socket-123",
    "userId": "user-1",
    "info": { "name": "Alice", "avatar": "..." }
  }
}
```

**Member Left:**
```json
{
  "type": "event",
  "channel": "presence-lobby",
  "event": "member_removed",
  "data": {
    "id": "socket-123",
    "userId": "user-1"
  }
}
```

## File-System Discovery

Define channels in `src/channels/`:

```typescript
// src/channels/chat-room.ts
import { z } from 'zod'
import type { Context, ChannelMember } from 'raffel'

// Auth requirement
export const auth = 'none'  // Public channel

// Event definitions
export const events = {
  message: {
    input: z.object({
      text: z.string().min(1).max(1000),
    }),
  },
  typing: {
    input: z.object({
      isTyping: z.boolean(),
    }),
  },
}
```

## Complete Example: Chat Application

### Server

```typescript
import { createServer } from 'raffel'
import { z } from 'zod'

const server = createServer({
  port: 3000,
  websocket: {
    channels: {
      authorize: async (socketId, channel, ctx) => {
        if (channel.startsWith('presence-room-')) {
          return ctx.auth?.authenticated ?? false
        }
        return true
      },
      presenceData: (socketId, channel, ctx) => ({
        userId: ctx.auth?.principal,
        name: ctx.auth?.claims?.name,
        color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
      }),
    },
  },
})

// Get room history
server.procedure('chat.history')
  .input(z.object({ roomId: z.string() }))
  .handler(async (input) => {
    return await db.messages.findMany({
      where: { roomId: input.roomId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  })

// Send message
server.procedure('chat.send')
  .input(z.object({
    roomId: z.string(),
    text: z.string().min(1).max(1000),
  }))
  .handler(async (input, ctx) => {
    const message = await db.messages.create({
      roomId: input.roomId,
      userId: ctx.auth?.principal,
      text: input.text,
    })

    // Broadcast to room
    ctx.channels?.broadcast(`presence-room-${input.roomId}`, 'message', {
      id: message.id,
      userId: message.userId,
      text: message.text,
      createdAt: message.createdAt,
    })

    return message
  })

await server.start()
```

### Client (JavaScript)

```javascript
const ws = new WebSocket('ws://localhost:3000')

// Subscribe to room
ws.send(JSON.stringify({
  id: '1',
  type: 'subscribe',
  channel: 'presence-room-general',
}))

// Handle messages
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data)

  if (msg.type === 'subscribed') {
    console.log('Joined room, members:', msg.members)
  }

  if (msg.type === 'event') {
    switch (msg.event) {
      case 'message':
        console.log('New message:', msg.data)
        break
      case 'member_added':
        console.log('User joined:', msg.data.info.name)
        break
      case 'member_removed':
        console.log('User left:', msg.data.userId)
        break
    }
  }
}

// Send message via RPC
ws.send(JSON.stringify({
  id: '2',
  type: 'request',
  procedure: 'chat.send',
  payload: {
    roomId: 'general',
    text: 'Hello everyone!',
  },
}))
```

## Channel Member Type

```typescript
interface ChannelMember {
  id: string           // Socket/connection ID
  userId?: string      // From auth context (ctx.auth.principal)
  info: Record<string, unknown>  // Presence data
  joinedAt: number     // Unix timestamp
}
```

## Best Practices

1. **Use presence channels for real-time collaboration**
   ```typescript
   // Good: Track who's editing a document
   channel: 'presence-doc-123'
   ```

2. **Use private channels for user-specific data**
   ```typescript
   // Good: User notifications
   channel: 'private-user-456'
   ```

3. **Validate publish permissions**
   ```typescript
   onPublish: async (socketId, channel, event, data, ctx) => {
     // Only allow authenticated users to send messages
     return ctx.auth?.authenticated && event === 'message'
   }
   ```

4. **Clean up on disconnect**
   - Members are automatically removed from presence channels
   - Subscriptions are automatically cleaned up

5. **Rate limit publishing**
   ```typescript
   // Use middleware for rate limiting
   server.use(createRateLimitMiddleware({ limit: 100, window: 60000 }))
   ```

---

## Client Inventory

The channel manager tracks all connected clients, allowing you to inspect, message, and broadcast to them independently of channel subscriptions.

### Registering Clients

Clients are automatically registered by the WebSocket adapter when `channels` is configured. You can also register them manually:

```typescript
// Automatic (WebSocket adapter does this on connect)
// Manual usage:
server.channels?.registerClient('socket-123', {
  userId: 'user-alice',
  data: { role: 'admin', department: 'engineering' },
})
```

### Querying Clients

```typescript
// Get a specific client
const client = server.channels?.getClient('socket-123')
// {
//   id: 'socket-123',
//   userId: 'user-alice',
//   data: { role: 'admin' },
//   channels: ['chat-room', 'presence-lobby'],
//   connectedAt: 1710000000000,
// }

// List all connected clients
const clients = server.channels?.getClients()

// Count
const count = server.channels?.getClientCount()
```

### Direct Messaging (No Channel)

Send events to a specific client without requiring channel membership:

```typescript
// Send a notification directly to a client
server.channels?.sendToClient('socket-123', 'notification', {
  title: 'New message',
  body: 'You have a new message from Alice',
})
```

The client receives:

```json
{
  "type": "event",
  "event": "notification",
  "data": { "title": "New message", "body": "..." }
}
```

### Broadcast to All

Broadcast an event to every connected client, regardless of channel subscriptions:

```typescript
// System-wide announcement
server.channels?.broadcastAll('system:announcement', {
  message: 'Server restart in 5 minutes',
  severity: 'warning',
})

// Broadcast excluding sender
server.channels?.broadcastAll('user:typing', { userId: 'alice' }, senderSocketId)
```

### ClientInfo Type

```typescript
interface ClientInfo {
  id: string                        // Socket/connection ID
  userId?: string                   // User ID from auth context
  data: Record<string, unknown>     // Custom data set on connect
  channels: string[]                // Subscribed channel names
  connectedAt: number               // Unix timestamp
}
```

---

## Rooms (1:1 Private Channels)

Rooms provide a lightweight way to create private communication between exactly two clients. They are automatically managed — created on demand, cleaned up on disconnect.

### Creating a Room

```typescript
const room = server.channels?.createRoom('socket-alice', 'socket-bob')
// {
//   name: 'room:socket-alice:socket-bob',  (deterministic, sorted)
//   participants: ['socket-alice', 'socket-bob'],
//   createdAt: 1710000000000,
// }
```

Room names are deterministic: `createRoom('a', 'b')` and `createRoom('b', 'a')` return the same room.

Both participants receive a `room:created` event:

```json
{
  "type": "event",
  "event": "room:created",
  "data": {
    "room": "room:socket-alice:socket-bob",
    "participants": ["socket-alice", "socket-bob"]
  }
}
```

### Sending Messages

```typescript
// Send to both participants
server.channels?.sendToRoom(room.name, 'message', {
  from: 'alice',
  text: 'Hey Bob!',
})

// Send to the other participant only (exclude sender)
server.channels?.sendToRoom(room.name, 'message', {
  from: 'alice',
  text: 'Hey Bob!',
}, 'socket-alice')
```

### Querying Rooms

```typescript
// Get room details
const room = server.channels?.getRoom('room:socket-alice:socket-bob')

// Get all rooms for a client
const aliceRooms = server.channels?.getClientRooms('socket-alice')
```

### Closing Rooms

```typescript
server.channels?.closeRoom(room.name)
```

Both participants receive a `room:closed` event. Rooms are also **automatically closed** when either participant disconnects.

### Use Cases

- **Direct messaging** between two users
- **Support chat** between agent and customer
- **Game matches** between two players
- **Peer-to-peer negotiation** (WebRTC signaling)

---

## Groups (N-Client Collections)

Groups are named collections of clients for targeted messaging. Unlike channels (which are client-driven via subscribe/unsubscribe), groups are **server-managed** — your application code decides who joins and leaves.

### Creating Groups

```typescript
// Create a named group with optional metadata
const group = server.channels?.createGroup('team-engineering', {
  project: 'tetis',
  lead: 'alice',
})
```

### Adding and Removing Members

```typescript
// Add clients to the group
server.channels?.joinGroup('team-engineering', 'socket-alice')
server.channels?.joinGroup('team-engineering', 'socket-bob')
server.channels?.joinGroup('team-engineering', 'socket-charlie')

// Remove from group
server.channels?.leaveGroup('team-engineering', 'socket-charlie')
```

When a member joins, existing members receive a notification:

```json
{
  "type": "event",
  "channel": "group:team-engineering",
  "event": "group:member_added",
  "data": { "group": "team-engineering", "socketId": "socket-bob" }
}
```

When a member leaves:

```json
{
  "type": "event",
  "channel": "group:team-engineering",
  "event": "group:member_removed",
  "data": { "group": "team-engineering", "socketId": "socket-charlie" }
}
```

### Sending to Groups

```typescript
// Deploy notification to all engineers
server.channels?.sendToGroup('team-engineering', 'deploy', {
  env: 'production',
  version: '2.1.0',
  deployedBy: 'alice',
})

// Typing indicator (exclude sender)
server.channels?.sendToGroup('team-engineering', 'typing', {
  user: 'alice',
}, 'socket-alice')
```

### Querying Groups

```typescript
// Get group info
const group = server.channels?.getGroup('team-engineering')
// { name: 'team-engineering', members: Set(3), data: { project: 'tetis' }, createdAt: ... }

// List all groups
const groups = server.channels?.getGroups()

// Get all groups a client belongs to
const aliceGroups = server.channels?.getClientGroups('socket-alice')
```

### Deleting Groups

```typescript
server.channels?.deleteGroup('team-engineering')
```

All members receive a `group:deleted` event. Groups are also **automatically cleaned up** when the last member leaves (via `leaveGroup` or disconnect).

### Auto-Create on Join

You don't need to call `createGroup` before `joinGroup`. Joining a non-existent group creates it automatically:

```typescript
// This creates the group AND adds the member
server.channels?.joinGroup('ad-hoc-room', 'socket-alice')
```

### Groups vs Channels

| Feature | Channels | Groups |
|---------|----------|--------|
| **Who controls membership** | Client (subscribe/unsubscribe) | Server (joinGroup/leaveGroup) |
| **Authorization** | authorize callback | Application logic |
| **Prefix convention** | `private-`, `presence-` | Any name |
| **Presence tracking** | Presence channels only | N/A (member list via getGroup) |
| **Client protocol** | JSON messages over WS | Transparent to client |
| **Ideal for** | Client-driven pub/sub | Server-driven targeting |

### Use Cases

- **Team notifications** -- send deploy/CI events to specific teams
- **Multi-tenant routing** -- group sockets by tenant/org
- **Game lobbies** -- manage players in game rooms
- **Webhook fan-out** -- route incoming webhooks to interested clients
- **Role-based messaging** -- group by role (admin, support, user)

---

## Lifecycle Hooks

Lifecycle hooks let you react to connection and channel events. They are designed to feed **webhook systems**, **audit logs**, **analytics**, and **external integrations**.

All hooks are **fire-and-forget** -- they run asynchronously and never block the WebSocket event loop. Errors in hooks are caught and logged.

### Configuration

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    channels: {
      authorize: (socketId, channel, ctx) => ctx.auth?.authenticated ?? false,

      hooks: {
        onConnect: async (event) => {
          console.log(`Client connected: ${event.socketId} from ${event.remoteAddress}`)
          await webhookService.send('client.connected', event)
        },

        onDisconnect: async (event) => {
          console.log(`Client disconnected: ${event.socketId} (code: ${event.code})`)
          await webhookService.send('client.disconnected', event)
        },

        onSubscribe: async (socketId, channel) => {
          await analytics.track('channel.subscribe', { socketId, channel })
        },

        onUnsubscribe: async (socketId, channel) => {
          await analytics.track('channel.unsubscribe', { socketId, channel })
        },

        onMemberAdded: async (channel, member) => {
          await webhookService.send('presence.member_added', {
            channel,
            memberId: member.id,
            userId: member.userId,
            info: member.info,
          })
        },

        onMemberRemoved: async (channel, member) => {
          await webhookService.send('presence.member_removed', {
            channel,
            memberId: member.id,
            userId: member.userId,
          })
        },
      },
    },
  },
})
```

### Hook Reference

| Hook | When it fires | Event data |
|------|---------------|------------|
| `onConnect` | Client connects (after auth/filter) | `{ socketId, remoteAddress, headers }` |
| `onDisconnect` | Client disconnects | `{ socketId, code, reason }` |
| `onSubscribe` | Client subscribes to a channel | `(socketId, channel)` |
| `onUnsubscribe` | Client unsubscribes from a channel | `(socketId, channel)` |
| `onMemberAdded` | Member joins a presence channel | `(channel, member: ChannelMember)` |
| `onMemberRemoved` | Member leaves a presence channel | `(channel, member: ChannelMember)` |

### Event Types

```typescript
interface ClientConnectEvent {
  socketId: string
  remoteAddress?: string
  headers: Record<string, string>
}

interface ClientDisconnectEvent {
  socketId: string
  code: number        // WebSocket close code (1000 = normal, 1001 = going away, etc.)
  reason: string      // Close reason text
}
```

### Webhook Integration Example

```typescript
import { createServer } from 'raffel'

// Webhook delivery service
class WebhookService {
  private endpoints: string[] = []

  register(url: string) { this.endpoints.push(url) }

  async send(event: string, data: unknown) {
    await Promise.allSettled(
      this.endpoints.map((url) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event, data, timestamp: Date.now() }),
        })
      )
    )
  }
}

const webhooks = new WebhookService()
webhooks.register('https://api.example.com/webhooks/realtime')

const server = createServer({
  port: 3000,
  websocket: {
    channels: {
      authorize: () => true,
      hooks: {
        onConnect: (e) => webhooks.send('connection.established', e),
        onDisconnect: (e) => webhooks.send('connection.closed', e),
        onSubscribe: (sid, ch) => webhooks.send('channel.subscribed', { socketId: sid, channel: ch }),
        onUnsubscribe: (sid, ch) => webhooks.send('channel.unsubscribed', { socketId: sid, channel: ch }),
        onMemberAdded: (ch, m) => webhooks.send('presence.joined', { channel: ch, member: m }),
        onMemberRemoved: (ch, m) => webhooks.send('presence.left', { channel: ch, member: m }),
      },
    },
  },
})
```

### Webhook Payload Format

All webhook events follow a consistent structure:

```json
{
  "event": "connection.established",
  "data": {
    "socketId": "abc123",
    "remoteAddress": "192.168.1.100",
    "headers": {
      "user-agent": "Mozilla/5.0 ...",
      "authorization": "Bearer ..."
    }
  },
  "timestamp": 1710000000000
}
```

### Available Webhook Events

| Event | Trigger | Data |
|-------|---------|------|
| `connection.established` | Client connects | `{ socketId, remoteAddress, headers }` |
| `connection.closed` | Client disconnects | `{ socketId, code, reason }` |
| `channel.subscribed` | Subscribes to channel | `{ socketId, channel }` |
| `channel.unsubscribed` | Unsubscribes from channel | `{ socketId, channel }` |
| `presence.joined` | Joins presence channel | `{ channel, member: { id, userId, info } }` |
| `presence.left` | Leaves presence channel | `{ channel, member: { id, userId } }` |

### Combining Everything

A complete real-time system with rooms, groups, presence, and webhooks:

```typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  websocket: {
    channels: {
      authorize: async (socketId, channel, ctx) => {
        return ctx.auth?.authenticated ?? channel.startsWith('public-')
      },
      presenceData: (socketId, channel, ctx) => ({
        userId: ctx.auth?.principalId,
        name: ctx.auth?.claims?.name,
      }),
      hooks: {
        onConnect: async ({ socketId }) => {
          // Auto-join user to their team group
          const user = await db.users.get(socketId)
          if (user?.teamId) {
            server.channels?.joinGroup(`team-${user.teamId}`, socketId)
          }
        },
        onDisconnect: async ({ socketId }) => {
          // Notify team members that someone went offline
          const groups = server.channels?.getClientGroups(socketId) ?? []
          for (const group of groups) {
            server.channels?.sendToGroup(group.name, 'member:offline', {
              socketId,
            }, socketId)
          }
        },
      },
    },
  },
})

// API endpoint: start a DM
server.procedure('dm.start')
  .handler(async (input, ctx) => {
    const { targetSocketId } = input
    const room = server.channels?.createRoom(ctx.ws?.connectionId!, targetSocketId)
    return { room: room?.name }
  })

// API endpoint: send to team
server.procedure('team.notify')
  .handler(async (input, ctx) => {
    const { teamId, event, data } = input
    server.channels?.sendToGroup(`team-${teamId}`, event, data)
    return { sent: true }
  })

// API endpoint: broadcast system message
server.procedure('system.broadcast')
  .handler(async (input) => {
    server.channels?.broadcastAll('system:message', input)
    return { sent: true }
  })

await server.start()
```
