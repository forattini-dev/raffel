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

Protocol configuration:

- `server.enableWebSocket(path)`
- `server.enableJsonRpc(path)`
- `server.enableGraphQL(path)`
- `server.grpc(options)`
- `server.tcp(options)`
- `server.udp(options)`

---

## Validation

```typescript
import { registerValidator, createZodAdapter } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))
```

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

## MCP

```typescript
import { runMCPServer, createMCPServer } from 'raffel/mcp'
```

See [MCP Server](mcp.md).
