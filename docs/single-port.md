# Shared-Port Protocol Fusion

Raffel treats shared-port protocol fusion as a primary runtime mode.
The transport entrypoint can classify the first bytes of a TCP connection,
route supported protocols to the right handler, and reject blocked traffic
with structured diagnostics.

`sharedPort` is the canonical configuration name.
`singlePort` and `enableSinglePort()` remain available as legacy aliases.

---

## Runtime Model

When both layers are enabled, Raffel evaluates protocol fusion in two stages:

```text
TCP socket
  -> shared-port classifier
  -> HTTP parser (when protocol = http)
  -> front-door router
  -> procedure / stream / event runtime
```

- `sharedPort`: transport-layer classification from the first bytes on the socket
- `frontDoor`: HTTP-layer routing across `http`, `websocket`, `jsonrpc`, and `graphql`
- `server.getProtocolFusionState()`: inspection API for recent decisions and rejections

---

## Configure Shared-Port

```typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  sharedPort: {
    enabled: true,
    protocols: ['http', 'tcp'],
    sniffMaxBytes: 2048,
    sniffTimeoutMs: 100,
  },
  frontDoor: {
    enabled: true,
    protocols: ['http', 'websocket', 'jsonrpc', 'graphql'],
  },
  websocket: { path: '/ws' },
  jsonrpc: { path: '/rpc' },
  graphql: { path: '/graphql' },
})
```

### `sharedPort` options

| Option | Type | Default | Description |
|:-------|:-----|:--------|:------------|
| `enabled` | boolean | `false` | Enables shared-port transport fusion |
| `protocolFusion` | boolean | same as `enabled` | Legacy alias for `enabled` |
| `protocols` | string[] | (all) | Allowlist of accepted transport protocols |
| `sniffMaxBytes` | number | `4096` | Maximum bytes consumed for classification |
| `sniffTimeoutMs` | number | `75` | Timeout to read the first chunk |
| `maxConcurrentDetections` | number | `256` | Maximum concurrent classifications |
| `sniffers` | `ProtocolSniffer[]` | `[]` | Custom detectors executed after built-ins |
| `cert` | `string \| Buffer` | - | TLS certificate for terminated listeners |
| `key` | `string \| Buffer` | - | TLS private key |
| `alpn` | `string[]` | `[]` | ALPN values for TLS handshakes |

Legacy equivalent:

```typescript
createServer({
  port: 3000,
  singlePort: {
    enabled: true,
  },
})
```

---

## Inspect Mode And Decisions

Preview the resolved runtime mode before startup:

```typescript
const preview = server.previewConfig()

console.log(preview.protocolFusion.mode)
// 'disabled' | 'front-door' | 'shared-port' | 'front-door+shared-port'

console.log(preview.sharedPort.enabled)
console.log(preview.frontDoor.enabled)
console.log(preview.sharedPort.sniffers)
```

Inspect recent runtime decisions after startup:

```typescript
await server.start()

const state = server.getProtocolFusionState()

console.log(state.mode)
console.log(state.entrypoint)
console.log(state.recentDecisions)
```

Example decision payload:

```typescript
{
  timestamp: '2026-03-11T06:00:00.000Z',
  mode: 'front-door+shared-port',
  entrypoint: 'tcp',
  layer: 'shared-port',
  protocol: 'http',
  outcome: 'route',
  reason: 'matched',
  detector: 'http-method',
  bytesRead: 128,
  target: { host: '0.0.0.0', port: 3000 }
}
```

Rejected traffic keeps the detected protocol when possible. For example, HTTP
traffic blocked by `sharedPort.protocols` is reported as `protocol: 'http'`
with `outcome: 'reject'`, not as a generic unknown protocol.

The inspection graph and `raffel doctor` also surface protocol-fusion
diagnostics, including:

- the active fusion mode
- HTTP-family traffic blocked by `sharedPort.protocols`
- custom sniffer names carried by the preview
- front-door offload protocols such as `tcp`, `udp`, and `grpc`

---

## Built-In Detection Order

| Order | Detector | Protocol |
|:------|:---------|:---------|
| 1 | TLS ClientHello (`0x16 0x03...`) | `tls` |
| 2 | HTTP/2 preface (`PRI * HTTP/2.0...`) | `http2` |
| 3 | Length-prefixed binary frame | `tcp` |
| 4 | HTTP method prefix (`GET`, `POST`, etc.) | `http` |
| 5 | Printable text frame with line break | `tcp` |
| 6 | Custom sniffers | custom |

If no detector matches, Raffel records a fallback decision and rejects the
connection deterministically when no protocol can be routed.

---

## Low-Level Detector APIs

```typescript
import {
  detectSinglePortProtocolFromChunk,
  detectSinglePortProtocolFromStream,
  getSinglePortConcurrencyState,
  SinglePortRegistry,
} from 'raffel'
```

```typescript
const decision = detectSinglePortProtocolFromChunk({
  chunk: Buffer.from('GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n'),
  protocols: ['http', 'tls'],
})

console.log(decision.protocol)  // 'http'
console.log(decision.detector)  // 'http-method'
console.log(decision.reason)    // 'matched'
```

### `ProtocolDecisionPayload`

```typescript
interface ProtocolDecisionPayload {
  protocol: SinglePortProtocolKind
  detector: string
  reason: 'matched' | 'unsupported' | 'unknown' | 'timeout' | 'concurrency_limit'
  elapsedMs: number
  bytesRead: number
  timedOut: boolean
}
```

`reason: 'unsupported'` means a protocol was detected but blocked by policy or
by the current shared-port configuration.

---

## Protocol Aliases

`sharedPort` and `frontDoor` both support alias expansion:

### `standard` mode

| Alias | Final protocol |
|:------|:---------------|
| `https` | `tls` |
| `h2` | `http2` |
| `ws`, `wss` | `websocket` |
| `jrpc`, `rpc` | `jsonrpc` |

### `extended` mode

Includes `standard`, plus:

| Alias | Final protocol |
|:------|:---------------|
| `ping`, `icmp` | `http` |
| `ftp`, `whois`, `telnet` | `tcp` |

```typescript
createServer({
  port: 3000,
  protocolAliasMode: 'extended',
  sharedPort: {
    enabled: true,
    protocols: ['icmp', 'ftp'],
  },
})
```

---

## Custom Sniffers

```typescript
import type { ProtocolSniffer } from 'raffel'

const mqttSniffer: ProtocolSniffer = {
  name: 'mqtt',
  detect({ chunk }) {
    if (chunk.length >= 2 && chunk[0] === 0x10) {
      return 'tcp'
    }
    return null
  },
}

createServer({
  port: 3000,
  sharedPort: {
    enabled: true,
    sniffers: [mqttSniffer],
  },
})
```

---

## Shared-Port vs Front-Door

| Capability | Layer | Responsibility |
|:-----------|:------|:---------------|
| `sharedPort` | TCP transport | Classify the socket from the first bytes |
| `frontDoor` | HTTP application | Route parsed HTTP traffic across shared HTTP protocols |

Use `sharedPort` when one TCP listener must accept mixed transports.
Use `frontDoor` when one HTTP listener must host multiple HTTP-native protocols.
Use both when you want a single public port with inspectable protocol-fusion
diagnostics across the entire entrypoint.
