# WebSocket Channels

Raffel supports Pusher-like real-time channels for pub/sub messaging over WebSocket.

## Overview

Channels provide:
- **Public Channels**: Anyone can subscribe
- **Private Channels**: Require authentication
- **Presence Channels**: Track online members

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
        userId: ctx.auth?.principal,
        name: ctx.auth?.claims?.name,
      }),
    },
  },
})

await server.start()
```

## Channel Types

| Prefix | Type | Auth Required | Member Tracking |
|--------|------|---------------|-----------------|
| (none) | Public | No | No |
| `private-` | Private | Yes | No |
| `presence-` | Presence | Yes | Yes |

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
        userId: ctx.auth?.principal,
        name: ctx.auth?.claims?.name,
        avatar: ctx.auth?.claims?.avatar,
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
      from: ctx.auth?.principal,
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
