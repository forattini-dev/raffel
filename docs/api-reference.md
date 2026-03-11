# API Reference (Cheat Sheet)

This page is a compact index of the main Raffel exports. For full details, follow
links to the dedicated docs sections.

---

## Server

```typescript
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })
```

Key builder APIs:

- `server.procedure(name)` → [Procedures](handlers/procedures.md)
- `server.stream(name)` → [Streams](streams.md)
- `server.event(name)` → [Events](events.md)
- `server.use(interceptor)` → [Interceptors](interceptors.md)
- `server.mount(prefix, module)` → [Router Modules](router-modules.md)
- `server.preview()` → canonical runtime inspection graph
- `server.previewConfig()` → resolved runtime config before start
- `server.getProtocolFusionState()` → runtime protocol-fusion diagnostics

Protocol configuration:

- `server.enableWebSocket(path)`
- `server.enableJsonRpc(path)`
- `server.enableGraphQL(path)`
- `server.grpc(options)`
- `server.tcp(options)`
- `server.udp(options)`
- `frontDoor` option on `createServer(...)` for HTTP protocol fusion
- `sharedPort` option on `createServer(...)` for transport-layer protocol fusion
- `singlePort` option on `createServer(...)` as the legacy alias for `sharedPort`

```typescript
createServer({
  port: 3000,
  frontDoor: {
    enabled: true,
    port: 443,
    protocols: ['http', 'websocket', 'jsonrpc', 'graphql', 'tcp'],
    strategy: {
      tcp: 'offload',
    },
  },
  sharedPort: {
    enabled: true,
    protocols: ['http', 'tls', 'websocket'],
    sniffMaxBytes: 4096,
    sniffTimeoutMs: 75,
  },
  websocket: '/ws',
  jsonrpc: '/rpc',
  graphql: '/graphql',
  tcp: { port: 9000 },
  protocolAliasMode: 'standard', // 'standard' | 'extended'
})
```

---

## Validation

```typescript
import { registerValidator, createZodAdapter } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))
```

---

## Runtime Inspection

```typescript
import {
  loadRuntimeInspectionPreview,
  buildRuntimeContractTestSuite,
  startRuntimePlayground,
} from 'raffel'
```

Programmatic helpers:

- `server.preview()`
- `loadRuntimeInspectionPreview(entry)`
- `buildRuntimeContractTestSuite(graph)`
- `startRuntimePlayground({ graph })`

See [Developer Experience](dx.md).

---

## Interceptors

Common interceptors:

- `createRateLimitInterceptor`
- `createRetryInterceptor`
- `createTimeoutInterceptor`
- `createBulkheadInterceptor`
- `createFallbackInterceptor`
- `createLoggingInterceptor`
- `createCacheInterceptor`
- `createEnvelopeInterceptor`

---

## Auth

Core auth helpers:

- `createAuthMiddleware`
- `createBearerStrategy`
- `createApiKeyStrategy`
- `createCookieSessionStrategy`
- `createAuthzMiddleware`

See [Auth Overview](auth/overview.md).

---

## HTTP Module

```typescript
import { HttpApp, serve } from 'raffel/http'
```

Middleware and helpers live under:

- `cors`, `compress`, `secureHeaders`, `bodyLimit`
- `basicAuth`, `bearerAuth`, `cookieSession`, `oauth2`, `oidc`
- `rateLimitMiddleware`, `validate`
- `serveStatic`, `serveStaticS3`
- `success`, `error`, `list`, `created`, `validationError`

---

## Shared-Port Protocol Fusion

```typescript
import {
  detectSinglePortProtocolFromChunk,
  detectSinglePortProtocolFromStream,
  SinglePortRegistry,
  normalizeSinglePortDefaults,
  getSinglePortConcurrencyState,
} from 'raffel'
```

- `detectSinglePortProtocolFromChunk(input)` — detect from `Buffer` synchronously
- `detectSinglePortProtocolFromStream(input)` — detect from async stream with timeout
- `SinglePortRegistry` — register per-protocol socket handlers
- `normalizeSinglePortDefaults(options?)` — apply defaults to detector options
- `getSinglePortConcurrencyState()` — `{ activeDetections, concurrencyLimit }`
- `server.previewConfig().protocolFusion` — inspect resolved runtime mode before start
- `server.getProtocolFusionState()` — inspect recent routing and rejection decisions after start

See [Shared-Port Protocol Fusion](single-port.md).

---

## MCP

```typescript
import { runMCPServer, createMCPServer } from 'raffel/mcp'
```

See [MCP Server](mcp.md).

---

## Mock Server

```typescript
import {
  createMockServer,
  createMockModule,
  extractRoutes,
  resolveResponse,
  toExpressPath,
  generateFromSchema,
} from 'raffel'
```

Main APIs:

- `createMockServer({ spec, port, validateRequests, protocols })`
- `createMockModule(spec, options)`
- `extractRoutes(document)`
- `resolveResponse(operation)`
- `toExpressPath(path)`
- `generateFromSchema(schema)`

See [Mock Server](mock-server.md).
