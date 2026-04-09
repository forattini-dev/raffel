# Changelog

Raffel evolves quickly. For official release history, see GitHub Releases. This
page highlights notable updates in the docs.

---

## 1.0.27

### MCP Protocol Server

Raffel now ships a full MCP protocol layer for both standalone and integrated usage:

- `createMcpServer()` for standalone MCP servers
- `mcp: true` or `mcp: { ... }` on `createServer()` for integrated mode
- Streamable HTTP, SSE, and stdio transports
- auth support on HTTP MCP endpoints
- protocol coverage for tools, resources, prompts, completion, notifications, sampling, and subscriptions

### Docs MCP Mode

The CLI can now turn any Markdown docs tree or git repository into a docs-first MCP server:

- `raffel mcp --docs ./docs`
- `raffel mcp --docs https://github.com/org/repo --path docs/`

This release also exposed `createDocsMcpServer()` for programmatic usage.

### Proxy and Edge Guides

Documentation now includes:

- full MCP server guides and references
- a public webhook edge guide with TLS, HMAC signature, nonce anti-replay, and configurable reverse-proxy routing
- expanded reverse-proxy and TLS examples

### Quality Cleanup

The public docs were refreshed to match the cleanup/refactor pass from the same week, including current MCP exports and the active CLI surface.

---

## 0.2.3

### Single-Port Protocol Detection

New `single-port` subsystem for automatic protocol multiplexing over a single TCP listener:

- `detectSinglePortProtocolFromChunk()` — detect protocol from a raw `Buffer`
- `detectSinglePortProtocolFromStream()` — detect protocol from an async stream with timeout
- `SinglePortRegistry` — register and dispatch per-protocol socket handlers
- `normalizeSinglePortDefaults()` — normalize detector options with sane defaults
- `getSinglePortConcurrencyState()` — observe live detection concurrency

**Built-in detectors**: TLS ClientHello, HTTP/2 preface, HTTP/1.x method prefix, TCP length-prefix frames, text-protocol frames, plus pluggable custom `ProtocolSniffer` support.

Configure via `singlePort` in `createServer()`:

```typescript
createServer({
  port: 3000,
  singlePort: {
    enabled: true,
    protocols: ['http', 'tls', 'websocket'],
    sniffMaxBytes: 2048,
    sniffTimeoutMs: 100,
  },
})
```

See [Single-Port Detection](/protocols/single-port.md).

### Protocol Aliases

Shared alias maps for both front-door and single-port dispatchers. Two modes:

- `standard` — `https→http/tls`, `h2→http2`, `ws/wss→websocket`, `jrpc/rpc→jsonrpc`
- `extended` — adds `ping/icmp→http`, `ftp/whois/telnet→tcp`

Configure via `protocolAliasMode: 'standard' | 'extended'` on `createServer()`.

### Front-Door Bootstrap

`createFrontDoorBootstrap()` extracted from the server builder, exposing:
- `evaluateFrontDoorDecision()` — classify incoming requests by protocol
- `createDecisionMiddleware()` — reject unsupported protocols at the edge with a structured JSON error

### Telemetry Bootstrap

`configureMetrics()`, `configureTracing()`, and `initializeTelemetry()` extracted
into a dedicated module for cleaner lifecycle management. Metrics and tracing
interceptors are now registered at startup without boilerplate.

### Discovery Bootstrap

`createDiscoveryBootstrap()` encapsulates file-system route discovery lifecycle
(start, stop, hot-reload callbacks), reducing setup code in the server builder.

### Test Reorganization

All integration and unit tests moved from `src/**/*.test.ts` to `test/` directory
for a cleaner source tree separation.

---

## Unreleased

- Expanded docsify home page and quickstart
- MCP docs aligned with tools, prompts, resources, docs mode, and guide discovery
- Added reference pages for auth, interceptors, HTTP module, and REST Auto-CRUD
