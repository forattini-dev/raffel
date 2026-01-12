<div class="lightning">⚡</div>

# Raffel

> **One handler. Seven protocols. Zero duplication.**

<div class="protocol-list">
  <span class="protocol-badge">HTTP</span>
  <span class="protocol-badge">WebSocket</span>
  <span class="protocol-badge">gRPC</span>
  <span class="protocol-badge">JSON-RPC</span>
  <span class="protocol-badge">GraphQL</span>
  <span class="protocol-badge">TCP</span>
  <span class="protocol-badge">UDP</span>
</div>

```typescript
server.procedure('users.create')
  .input(z.object({ name: z.string() }))
  .handler(async (input) => db.users.create({ data: input }))
// → HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, UDP
```

- 🚀 **Procedures, Streams, Events** — All handler types
- 🛡️ **20+ Interceptors** — Rate limit, circuit breaker, retry, cache
- 🔐 **Full Auth Stack** — JWT, API Key, OAuth2, OIDC, Sessions
- 📂 **File-System Routing** — Drop files, get endpoints
- 📊 **Observability** — Prometheus, OpenTelemetry, Structured Logging

[Get Started](quickstart.md)
[GitHub](https://github.com/forattini-dev/raffel)
