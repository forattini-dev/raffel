# Single-Port Protocol Detection

Raffel includes a **single-port detection** subsystem that automatically identifies the protocol of a TCP connection from the first bytes received — without requiring dedicated ports per protocol.

This is useful for:
- Servers that need to accept multiple protocols on the same port
- Environments with firewall restrictions (only one port exposed)
- Proxies and load balancers that forward mixed traffic

---

## How it works

When a new connection is received, the system reads the first bytes (`sniffMaxBytes`, default 4096) and applies detectors in priority order:

| Order | Detector | Detected protocol |
|:------|:---------|:------------------|
| 1 | TLS ClientHello (`0x16 0x03...`) | `tls` |
| 2 | HTTP/2 preface (`PRI * HTTP/2.0...`) | `http2` |
| 3 | TCP length-prefix frame (uint32 BE) | `tcp` |
| 4 | HTTP method prefix (`GET`, `POST`, etc.) | `http` |
| 5 | Text protocol (printable + line break) | `tcp` |
| 6 | Custom sniffers (pluggable) | any |

If no detector matches, returns `unknown`.

---

## Configuration via `createServer`

```typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  singlePort: {
    enabled: true,
    // Restrict accepted protocols (allowlist)
    protocols: ['http', 'websocket', 'tls'],
    // Maximum bytes for sniffing (default: 4096)
    sniffMaxBytes: 2048,
    // Timeout to read the first chunk (default: 75ms)
    sniffTimeoutMs: 100,
    // Maximum concurrent detections (default: 256)
    maxConcurrentDetections: 128,
  },
})
```

### `singlePort` options

| Option | Type | Default | Description |
|:-------|:-----|:--------|:------------|
| `enabled` | boolean | `false` | Enables single-port detection |
| `protocolFusion` | boolean | same as `enabled` | Legacy alias for `enabled` |
| `protocols` | string[] | (all) | Allowlist of accepted protocols |
| `sniffMaxBytes` | number | `4096` | Bytes consumed for detection |
| `sniffTimeoutMs` | number | `75` | Timeout (ms) to read the first chunk |
| `maxConcurrentDetections` | number | `256` | Maximum simultaneous detections |
| `sniffers` | ProtocolSniffer[] | `[]` | Additional custom sniffers |
| `cert` | string/Buffer | — | TLS certificate (for termination) |
| `key` | string/Buffer | — | TLS private key |
| `alpn` | string[] | `[]` | ALPN protocols for TLS |

---

## Low-level API

The detection functions can be used directly, outside the builder:

```typescript
import {
  detectSinglePortProtocolFromChunk,
  detectSinglePortProtocolFromStream,
  SinglePortRegistry,
} from 'raffel'

// Detect from an already available Buffer
const result = detectSinglePortProtocolFromChunk({
  chunk: Buffer.from('GET / HTTP/1.1\r\n...'),
  // Filter accepted protocols (optional)
  protocols: ['http', 'tls'],
  sniffMaxBytes: 4096,
})

console.log(result.protocol)   // 'http'
console.log(result.detector)   // 'http-method'
console.log(result.reason)     // 'matched'
console.log(result.elapsedMs)  // time spent
console.log(result.bytesRead)  // bytes inspected
```

```typescript
// Detect from an async stream (with timeout)
const result = await detectSinglePortProtocolFromStream({
  readChunk: () => socket.once('data'),
  sniffTimeoutMs: 75,
  sniffMaxBytes: 4096,
})

if (result.timedOut) {
  console.log('Timeout reading the first chunk')
}
```

### `ProtocolDecisionPayload`

```typescript
interface ProtocolDecisionPayload {
  protocol: SinglePortProtocolKind   // 'http' | 'tls' | 'http2' | 'tcp' | 'websocket' | 'jsonrpc' | 'unknown'
  detector: string                   // name of the detector that identified it
  reason: 'matched' | 'unsupported' | 'unknown' | 'timeout' | 'concurrency_limit'
  elapsedMs: number
  bytesRead: number
  timedOut: boolean
}
```

---

## SinglePortRegistry

To create a custom protocol dispatcher, use `SinglePortRegistry`:

```typescript
import { SinglePortRegistry } from 'raffel'

const registry = new SinglePortRegistry()

// Register handlers by protocol
registry.register('http', async (socket) => {
  // pass socket to the HTTP server
})

registry.register('tls', async (socket) => {
  // start TLS handshake
})

// Look up a handler
const handler = registry.get('http')
if (handler) {
  await handler(socket)
}

// List registered protocols
const { protocols } = registry.snapshot()
// ['http', 'tls']
```

---

## Protocol Aliases

To simplify configuration, single-port accepts protocol aliases:

### `standard` mode (default)

| Alias | Final protocol |
|:------|:---------------|
| `https` | `tls` |
| `h2` | `http2` |
| `ws`, `wss` | `websocket` |
| `jrpc`, `rpc` | `jsonrpc` |

### `extended` mode

Includes all standard mode aliases, plus:

| Alias | Final protocol |
|:------|:---------------|
| `ping`, `icmp` | `http` |
| `ftp`, `whois`, `telnet` | `tcp` |

```typescript
const server = createServer({
  port: 3000,
  singlePort: {
    enabled: true,
    protocols: ['https', 'ws', 'rpc'], // aliases are expanded
  },
  protocolAliasMode: 'extended', // enables extra aliases
})
```

---

## Monitor concurrency

```typescript
import { getSinglePortConcurrencyState } from 'raffel'

const state = getSinglePortConcurrencyState()
console.log(state.activeDetections)   // detections in progress
console.log(state.concurrencyLimit)   // configured limit
```

---

## Custom Sniffers

For custom protocols, implement the `ProtocolSniffer` interface:

```typescript
import { createServer } from 'raffel'
import type { ProtocolSniffer } from 'raffel'

const mqttSniffer: ProtocolSniffer = {
  name: 'mqtt',
  detect({ chunk }) {
    // MQTT CONNECT: byte 0 = 0x10
    if (chunk.length >= 2 && chunk[0] === 0x10) {
      return 'tcp' // route to the TCP adapter
    }
    return null
  },
}

const server = createServer({
  port: 3000,
  singlePort: {
    enabled: true,
    sniffers: [mqttSniffer],
  },
})
```

---

## Relationship with Front-Door

Single-port and Front-Door are complementary:

| Feature | Layer | Purpose |
|:--------|:------|:--------|
| **Single-Port** | Transport (TCP) | Detects protocol from the initial bytes of the socket |
| **Front-Door** | Application (HTTP) | Routes already-parsed HTTP requests by application protocol |

Use single-port when you want to multiplex protocols on a single TCP listener.
Use front-door when you want to control which application protocols (WebSocket, JSON-RPC, GraphQL) share the HTTP port.
