# WebSocket Adapter

WebSocket uses JSON-encoded Envelopes for procedures, streams, and events.

## Envelope shape

```json
{
  "id": "req-1",
  "procedure": "users.create",
  "type": "request",
  "payload": { "name": "Kai" },
  "metadata": {}
}
```

## Stream responses

For streams, the server sends a sequence of envelopes with `stream:start`,
`stream:data`, and `stream:end` types. Errors use `stream:error`.

## Enable WebSocket

```ts
createServer({ port: 3000 }).enableWebSocket('/ws')
```

## Front-Door support

When front-door is enabled and `websocket` is included in
`frontDoor.protocols` (or omitted, since it is included by default), the
socket upgrade is handled on the shared front-door listener using the configured
`path`.

```ts
createServer({
  port: 3000,
  frontDoor: { enabled: true, port: 3001, protocols: ['websocket', 'http'] },
  websocket: '/ws',
})
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | number | - | Port to listen on (omit to share HTTP) |
| `path` | string | `'/'` | WebSocket path |
| `maxPayloadSize` | number | `1MB` | Max payload size in bytes |
| `heartbeatInterval` | number | `30000` | Ping interval in ms (0 to disable) |
| `channels` | object | - | Enable channels/presence configuration |
| `contextFactory` | function | - | Build connection context from upgrade request |
| `auth` | object | - | Authentication config (ticket, bearer, or custom) |
| `backpressure` | object | - | Slow consumer handling (drop or disconnect) |

## Authentication

Raffel supports three auth modes for WebSocket connections:

| Mode | How it works | Best for |
|------|-------------|----------|
| `ticket` | Single-use token from HTTP, passed as `?ticket=xxx` | Browsers (recommended) |
| `bearer` | JWT/API key as `?token=xxx` or `Authorization` header | Server-to-server, mobile |
| `custom` | Your own `extractToken` + `validateToken` logic | Cookies, custom protocols |

```typescript
const server = createServer({
  port: 3000,
  websocket: {
    auth: {
      mode: 'ticket',
      ticketStore: createMemoryTicketStore(),
    },
  },
})
```

Clients can also refresh tokens mid-connection without reconnecting:

```json
{ "id": "r1", "type": "auth:refresh", "token": "new-jwt-here" }
```

See [Channels > Authentication](/protocols/channels.md#authentication) for full details and examples.

## Backpressure

Protect the server from slow consumers that can't keep up with message rate:

```typescript
websocket: {
  backpressure: {
    maxBufferedAmount: 1024 * 1024,  // 1MB
    strategy: 'drop',                // or 'disconnect'
  },
}
```

See [Channels > Backpressure](/protocols/channels.md#backpressure) for details.

## USD Content Types

USD defaults to JSON for WebSocket messages. Set protocol defaults via USD config:

```ts
server.enableUSD({
  contentTypes: {
    default: 'application/json',
    supported: ['application/json', 'application/octet-stream'],
  },
  websocket: {
    contentTypes: {
      default: 'application/json',
      supported: ['application/json', 'application/octet-stream'],
    },
  },
})
```

For hand-authored USD, you can override per channel operation:

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

## Channels (optional)

WebSocket can enable Pusher-like channels for pub/sub and presence.

```ts
const server = createServer({
  port: 3000,
  websocket: {
    path: '/ws',
    channels: {
      authorize: async (_socketId, channel, ctx) => {
        if (channel.startsWith('private-') || channel.startsWith('presence-')) {
          return ctx.auth?.authenticated ?? false
        }
        return true
      },
      presenceData: (_socketId, _channel, ctx) => ({
        userId: ctx.auth?.principal,
      }),
    },
  },
})

server.channels?.broadcast('chat-room', 'message', { text: 'hello' })
```

`authorize` runs for every channel when provided; return `true` for public
channels you want to allow.

For the full channel protocol, see `protocols/channels.md`.

## Cancellation

Clients can cancel in-flight requests or streams:

```json
{ "id": "req_123", "type": "cancel" }
```

The server aborts the request and responds with `type: "error"` (or
`type: "stream:error"` for streams) and code `CANCELLED`.

## Metadata

Connection headers are merged into envelope metadata, along with any
per-message `metadata` fields. Standard headers such as `authorization`,
`x-request-id`, `traceparent`, and `tracestate` are preserved as metadata
entries.
