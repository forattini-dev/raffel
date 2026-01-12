# UDP Handlers

Raffel supports custom UDP handlers for raw datagram workloads. UDP handlers
are not envelope-based; you receive raw `Buffer` payloads and decide how to
parse/respond.

## File-System Handlers

When discovery is enabled, UDP handlers live in `src/udp`:

```ts
// src/udp/metrics.ts
import type { RemoteInfo } from 'node:dgram'
import type { UdpContext } from 'raffel'

export const config = {
  port: 9001,
  host: '0.0.0.0',
  type: 'udp4',
}

export async function onMessage(data: Buffer, rinfo: RemoteInfo, ctx: UdpContext) {
  const payload = JSON.parse(data.toString('utf-8'))
  const response = { ok: true, received: payload }

  return Buffer.from(JSON.stringify(response))
  // Returning a Buffer automatically replies to the sender.
}
```

`ctx.reply`, `ctx.send`, and `ctx.broadcast` are available for explicit sends.

## USD Documentation Metadata

Add `docs` metadata to describe inbound/outbound message schemas:

```ts
// src/udp/metrics.ts
import { z } from 'zod'

export const docs = {
  summary: 'Metrics receiver',
  inboundSchema: z.object({ metric: z.string(), value: z.number() }),
  outboundSchema: z.object({ status: z.string() }),
  maxPacketSize: 65507,
}
```

`inboundSchema` and `outboundSchema` map to `messages.inbound`/`messages.outbound`
in USD. `messageSchema` is treated as a legacy inbound alias.

## USD Content Types

USD defaults to `application/octet-stream` for UDP. Use `contentType` or
`contentTypes` in UDP handler docs to override:

```ts
export const docs = {
  contentTypes: {
    default: 'application/octet-stream',
    supported: ['application/octet-stream', 'application/json'],
  },
}
```

## Manual Registration

You can also load handlers yourself and register them:

```ts
import { createServer, loadUdpHandlers } from 'raffel'

const server = createServer({ port: 3000 })
const udp = await loadUdpHandlers({ udpDir: './src/udp' })

for (const handler of udp.handlers) {
  server.addUdpHandler(handler)
}
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | number | required | Port to listen on |
| `host` | string | `'0.0.0.0'` | Host to bind to |
| `type` | `'udp4' \| 'udp6'` | `'udp4'` | Socket type |
| `reuseAddr` | boolean | `true` | Allow address reuse |
| `reusePort` | boolean | `false` | Allow port reuse |
| `recvBufferSize` | number | `65536` | Receive buffer size |
| `sendBufferSize` | number | `65536` | Send buffer size |
| `ipv6Only` | boolean | `false` | IPv6 only (udp6) |
| `multicast` | object | `null` | Multicast configuration |

### Multicast

```ts
export const config = {
  port: 9001,
  multicast: {
    group: '239.0.0.1',
    ttl: 1,
    loopback: false,
  },
}
```

## When to Use UDP

- Metrics aggregation and telemetry
- Service discovery broadcasts
- IoT device communication
- Low-latency, lossy workloads
