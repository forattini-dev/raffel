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
`stream:data`, and `stream:end` types.

## Enable WebSocket

```ts
createServer({ port: 3000 }).enableWebSocket('/ws')
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

For the full channel protocol, see `protocols/channels.md`.
