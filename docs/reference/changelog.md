# Changelog

Raffel evolves quickly. For official release history, see GitHub Releases. This
page highlights notable updates in the docs.

---

## Unreleased

### Complete response contracts in generated docs

The HTTP reference now expands `anyOf`, `oneOf`, and `allOf` response schemas
instead of collapsing them to `any`. Filesystem TypeScript inference also
recovers response shapes from handlers typed as `HandlerFunction` and from
`Response.json(...)` payloads. Programmatic `server.http.*` routes can use the
new `documentationOutput` option when they need an OpenAPI response contract
without enabling runtime output validation.

### Semantic HTTP method colors in the sidebar

HTTP method badges in the endpoint sidebar now use the same GET, POST, PUT,
PATCH, and DELETE palette as the endpoint content, making long route lists
faster to scan without increasing their compact footprint.

### Decoded HTTP path parameters

REST resources and `server.http.*` routes now receive decoded path parameters,
consistent with the core HTTP route table. Percent-encoded e-mail addresses,
spaces, slashes, and Unicode are decoded after route matching; malformed escape
sequences are preserved verbatim instead of throwing `URIError`.

### TypeScript response inference for filesystem routes

TypeScript HTTP/RPC procedure files discovered from the filesystem now get a
structural USD/OpenAPI response schema from the default handler's inferred
return type when they omit `export const output`. Explicit output schemas remain
authoritative and continue to own runtime validation and richer constraints;
inferred schemas are documentation-only. See
[File-system routing](/routing/file-system.md#automatic-typescript-response-inference).

### Docs root overview + logical protocol default (1.1.60)

The docs root (`/docs`) now renders an OpenAPI-driven landing instead of
"Page not found": title + version, contact/license, the `servers` list,
and `info.description` as Markdown, followed by the endpoint list. The
reference also **opens on the most relevant protocol** (priority
`http` → `graphql` → `websocket` → `jsonrpc` → `grpc` → `streams` →
`tcp` → `udp`) with that protocol's endpoints listed **expanded** in the
sidebar and its tab active. A genuine non-root missing path still shows
"Page not found". See [Docs UI](/tooling/docs-ui.md).

### Co-located policy `_meta` — cascade mode + audit (1.1.59)

Co-located policy files accept a top-level `_meta` block (wrapper form
`{ _meta, policies: [...] }`):

- **`mode: scope`** makes a folder file the authoritative reset point for
  its subtree — ancestor policies don't flow through, children still
  inherit from it. `mode: cascade` (default) is the classic behaviour.
- **Audit fields** (`owner`, `ticket`, `description`, `deprecation`)
  surface through `server.policy.list()[]._meta`; file-level values
  cascade to each policy, per-policy `_meta` overrides field-by-field.

See [Co-located policies](/policies/co-located.md#file-level-metadata).

### Co-located cascade dedup + hot-reload re-registration (1.1.60)

- A cascade `_policy.yaml` shared by N routes now produces **one** engine
  entry (with `scope.routes` = union) instead of N copies; per-route
  nearest-wins is resolved before the engine, and unrelated files sharing
  an `id` stay separate.
- File-system discovery **hot reload** now actually re-registers changed
  handlers — it drops routes whose file was removed, re-registers the
  rest, and preserves programmatic registrations. (Previously the watcher
  fired but the registry kept the boot-time handler.)

### Host logger injection

`createServer({ logger })` now accepts a `pino.Logger` or a `LoggerFactory`,
routing **all** of Raffel's logs through the host's logger for a single,
consistent format (e.g. one JSON stream in Datadog):

- **`ctx.logger`** (request-scoped, carries `requestId`) and, when a logger is
  injected, the new built-in **`ctx.log`** provider (app-scoped child, carries
  `component: 'app'`) both flow through the injected logger. Servers that don't
  inject a logger are left untouched. Override `ctx.log` with your own `log`
  provider.
- **Memory-safe** — component loggers are process-scoped singletons (one per
  module). `ctx.logger` stays a plain data property (one child per request, as
  before) — not an accessor — so the router's per-dispatch context spread stays
  on its fast path.
- **Zero-config convergence** — without injecting, the built-in pino still
  respects `LOG_LEVEL` and `LOG_FORMAT=json`.

See [Logging](/observability/logging.md).

---

## 1.1.0

### Authorization Policies (opt-in)

Raffel now ships a declarative authorization engine, inspired by AWS IAM (allow / deny / audit, principal + action + resource + condition):

- **Fully opt-in** — omit `policy: { ... }` and zero engine code is loaded; existing apps unaffected
- **`PolicyEnginePort` + default driver** — replace with OPA/Cedar/Casbin via the port
- **Match DSL** — declarative JSON conditions: `==`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `notIn`, `regex`, `startsWith`, `endsWith`, `contains`, `exists`, `@ref`, `!`, `anyOf`, `allOf`, `not`
- **Wildcards** — `*`, `**`, `?`, `{a,b}`, `[abc]`, `[a-z]`
- **Effects** — `allow`, `deny`, `audit` (shadow rollout), with tenant_mismatch precedence #1
- **Principal adapters** — `'session'`, `'oauth2'`, `'oidc'`, `'custom'` with sensible default mappings
- **JSON loader** — `loadFromDir`, schema-validated via Ajv, customCondition registry, fail-fast at boot
- **Per-procedure builder** — `.authz({ action?, resource, mode?, public? })` on `ProcedureBuilder`
- **Module-level inheritance** — `createRouterModule(prefix, { authz })` defaults applied at mount time
- **Multi-protocol** — same `.authz()` works for HTTP, JSON-RPC, WS-RPC, gRPC, server-stream
- **Ctx helpers** — `ctx.policy.evaluate(action, resource)` and `ctx.policy.filterResources(action, resources)` for ad-hoc checks and listings, with per-request dedup
- **`defaultMode: 'allow' | 'deny'`** — global default with `.authz({ public: true })` escape
- **Structured logging** via `LoggerPort` on every decision (info allow / warn deny / debug audit-only)
- **Production-safe error body** — verbose in dev, minimal `{ error, code }` in `NODE_ENV=production`
- **Discovery** — `runtime-preview` includes per-procedure authz metadata; MCP `raffel://policies` and `raffel://policy/<id>` resources expose the catalog (with `condition` functions sanitised to `hasCondition: boolean`)
- **`server.policy.explain(input)` / `server.policy.list()`** — side-effect-free introspection
- **Test harness** — `createPolicyHarness({ policies })` for unit testing without booting a server
- **Failure safety** — a `condition` that throws becomes implicit_deny + logged error, never a 500

171 tests cover the new module. See:

- [Policies overview](/policies/README.md) — when to use it and how it fits
- [Guide](/guides/policies.md) — full narrative tour
- [Match DSL reference](/policies/match-dsl.md) — every operator
- [Patterns & recipes](/policies/patterns.md) — RBAC, ABAC, multi-tenant, shadow rollout, owner-or-admin, time-windowed, sensitive fields, listings, emergency revocation, approval workflow, service-to-service
- [API reference](/reference/policies-api.md) — types, config, helpers

The engine is vendored from `github.com/filipeforattini/policy-engine` and adapted for Raffel.

### Compatibility

Backwards-compatible with 1.0.x. New surface is additive and only active when configured. The existing `.policy(policies: ContractPolicies)` builder method (timeout / rate-limit / auth-required) is unchanged — authorization uses the new `.authz()` method to keep concerns separated.

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

- Expanded docs home page and quickstart
- MCP docs aligned with tools, prompts, resources, docs mode, and guide discovery
- Added reference pages for auth, interceptors, HTTP module, and REST Auto-CRUD
