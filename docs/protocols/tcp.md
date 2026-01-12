# TCP Adapter

Raw TCP adapter using length-prefixed framing. Ideal for high-performance
service-to-service communication where HTTP overhead is not needed.

## Protocol

Messages use a simple length-prefixed framing:

```
[4 bytes: length (big-endian uint32)] [N bytes: JSON payload]
```

The JSON payload follows the same envelope format as WebSocket.

## Enable TCP

```ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })
  .tcp({ port: 4000 })

await server.start()
// HTTP on 3000, TCP on 4000
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | number | required | Port to listen on |
| `host` | string | `'0.0.0.0'` | Host to bind to |
| `maxMessageSize` | number | `16MB` | Maximum message size in bytes |
| `keepAliveInterval` | number | `30000` | TCP keep-alive interval in ms (0 to disable) |
| `contextFactory` | function | - | Custom context factory per socket |

## USD Documentation Metadata

Provide `docs` metadata on handlers to generate TCP sections in USD:

```ts
// src/tcp/command.ts
import { z } from 'zod'

export const config = { port: 9000 }

export const docs = {
  summary: 'Command server',
  requestSchema: z.object({ cmd: z.string() }),
  responseSchema: z.object({ ok: z.boolean() }),
  framing: { type: 'length-prefixed', lengthBytes: 4, byteOrder: 'big-endian' },
}
```

`requestSchema` maps to inbound messages and `responseSchema` maps to outbound
messages in USD.

## USD Content Types

USD defaults to `application/octet-stream` for TCP. Use `contentType` or
`contentTypes` in TCP handler docs to override:

```ts
export const docs = {
  contentTypes: {
    default: 'application/octet-stream',
    supported: ['application/octet-stream', 'application/json'],
  },
}
```

## Message Format

### Request

```json
{
  "id": "req_123",
  "procedure": "users.create",
  "type": "request",
  "payload": { "name": "Maya" },
  "metadata": {}
}
```

### Response

```json
{
  "id": "req_123",
  "procedure": "users.create",
  "type": "response",
  "payload": { "id": "usr_456", "name": "Maya" }
}
```

### Error

```json
{
  "id": "req_123",
  "type": "error",
  "payload": {
    "code": "NOT_FOUND",
    "message": "User not found"
  }
}
```

## Streaming

TCP supports bidirectional streaming using the same envelope format:

```json
{
  "id": "stream_789",
  "procedure": "logs.tail",
  "type": "stream:start",
  "payload": { "limit": 100 }
}
```

Stream chunks:

```json
{ "id": "stream_789", "type": "stream:data", "payload": { "line": "..." } }
{ "id": "stream_789", "type": "stream:data", "payload": { "line": "..." } }
{ "id": "stream_789", "type": "stream:end" }
```

Stream errors use `stream:error` with a standard error payload.

## Metadata

TCP envelopes may include a `metadata` object. Non-string values are coerced
to strings before being attached to the context.

## Client Example

```ts
import { connect } from 'node:net'

const client = connect({ port: 4000 })

function send(message: object) {
  const json = JSON.stringify(message)
  const data = Buffer.from(json, 'utf-8')
  const frame = Buffer.allocUnsafe(4 + data.length)
  frame.writeUInt32BE(data.length, 0)
  data.copy(frame, 4)
  client.write(frame)
}

// Send request
send({
  id: 'req_1',
  procedure: 'health.check',
  type: 'request',
  payload: {}
})

// Read response (simplified - need proper framing in production)
client.on('data', (data) => {
  const length = data.readUInt32BE(0)
  const json = data.slice(4, 4 + length).toString('utf-8')
  console.log(JSON.parse(json))
})
```

## Cancellation

Clients can cancel in-flight requests or streams:

```json
{
  "id": "req_123",
  "type": "cancel"
}
```

The server will abort the request and send:

```json
{
  "id": "req_123",
  "type": "error",
  "payload": { "code": "CANCELLED", "message": "Request cancelled" }
}
```

For streams, the server responds with `type: "stream:error"` and code `CANCELLED`.

## Use Cases

- Internal microservices communication
- High-throughput data pipelines
- Real-time gaming servers
- IoT device communication
- When you need lower latency than HTTP
