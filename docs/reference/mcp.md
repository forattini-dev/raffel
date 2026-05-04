# Raffel AI Assistant (Built-in MCP)

> **This is Raffel's own MCP server** — a pre-built AI assistant with tools for documentation, code generation, and debugging of Raffel projects.
>
> Want to build your own MCP server? See [MCP Protocol — Build Your Own](/protocols/mcp.md) and [Building MCP Servers (Guide)](/guides/mcp-server.md).

Raffel ships a built-in MCP server that acts as an AI-native control plane for the whole runtime: protocols, proxy modes, observability, security, and scaffolding.

It exposes **tools**, **resources**, and **prompts** so an assistant can discover the right Raffel feature first and generate code after the design is clear.

---

## What is this?

When you run `raffel mcp` or add Raffel as an MCP server in Claude Code, you get an AI assistant that knows everything about the Raffel framework. It can:

- **Discovery first**: map a need (proxy mode, telemetry, auth, migration) before codegen.
- **Canonical references**: responses always map to guides, patterns, and examples.
- **Execution-ready output**: generated code follows real project APIs (`createServer`, interceptors, runtime config).

---

## One-Line Capability Surface

`protocols` · `proxy` · `observability` · `security` · `dx`

- `protocols`: HTTP/WebSocket/gRPC/JSON-RPC/GraphQL/TCP/UDP
- `proxy`: reverse, explicit, SOCKS5/SOCKS5h, transparent, suite
- `observability`: source→destination graph + edge metrics + p50/p90/p95 + error rates
- `security`: auth/session, TLS, filters, policy checks, programmable proxy middleware
- `dx`: migration, scaffolding, templates, and runtime config

Use `raffel_feature_catalog` first, then jump to the right guide with `raffel_get_guide`.

---

## Quick Start

### Add to Claude Code

```bash
claude mcp add raffel npx raffel-mcp
```

### Run directly

```bash
# Full toolset (default)
npx raffel-mcp

# Guided first-run profile
npx raffel-mcp --quickstart

# Minimal + docs-first mode
npx raffel-mcp --category minimal
npx raffel-mcp --category docs
npx raffel-mcp --category docs,codegen
```

- `--category full`: all tools (bigger context)
- `--category quickstart`: guided first run (smallest, curated set)
- `--category minimal`: small context for Q&A and quick lookups
- `--category docs`: deep discovery and references
- `--category codegen`: scaffolding and generator helpers
- `--category architecture`: high-level project shape and ops decisions

### Run by transport

```bash
npx raffel-mcp --transport stdio
npx raffel-mcp --transport http --port 3200
npx raffel-mcp --transport sse --port 3200
npx raffel-mcp --list-categories
```

`npx raffel mcp` and `npx raffel-mcp` are equivalent binaries.

### Docs mode for any Markdown repo

```bash
raffel mcp --docs ./docs
raffel mcp --docs https://github.com/org/repo --path docs/ --branch main
```

This starts a documentation-focused MCP server instead of the built-in Raffel knowledge server. It indexes Markdown files and exposes search, file reads, section reads, code example extraction, and summary prompts. See [Docs MCP Server](/guides/docs-mcp.md).

---

## Tool Families

### 1) Discovery

- `raffel_feature_catalog`: map by scope (`protocols`, `proxy`, `observability`, `security`, `devx`).
- `raffel_get_guide` + `raffel_list_guides`: open the implementation guide by topic.
- `raffel_search`: find exact option names, flags, and examples with phrase search support.
- `raffel_proxy_capabilities`: get the matrix for reverse/explicit/SOCKS5/transparent/suite, telemetry defaults, and middleware coverage.

### 2) Design & Planning

- `raffel_project_blueprint`: architecture and folder strategy.
- `raffel_api_endpoint_blueprint`: CRUD/search/bulk/stream endpoint scaffold.
- `raffel_runtime_config`: opinionated runtime defaults per environment.

### 3) Execution

- `raffel_create_server`
- `raffel_create_procedure`
- `raffel_create_stream`
- `raffel_create_event`
- `raffel_create_module`
- `raffel_add_middleware`
- `raffel_boilerplate`

### 4) Diagnostics & Safety

- `raffel_explain_error`: explain and fix error behavior.
- `raffel_get_interceptor`, `raffel_get_adapter`, `raffel_list_*`: introspect behavior before wiring.
- `raffel_version`: compatibility and environment checks.
- Prompts for guided migrations / performance / security hardening.

### 5) Observability & Mesh

- `raffel_get_guide topic=proxy-observability`: edge labels and duration/error taxonomies.
- `raffel_search query="error_rate failure_ratio p95"`: find telemetry terms and flags before alerting.
- `raffel_proxy_capabilities includeMetrics=true`: confirm metric families and protocol labels.

---

## Discovery Workflows (Practical)

### A) Proxy design in 60 seconds

```text
Need: Local HTTPS edge + source→destination telemetry

1) raffel_feature_catalog scope=proxy
2) raffel_get_guide topic=proxy
3) raffel_proxy_capabilities includeMetrics=true includeRawConfig=true
4) raffel_get_guide topic=proxy-observability
```

### B) Service mesh visibility in 60 seconds

```text
Need: real-time flow metrics and rate/error reports

1) raffel_get_guide topic=proxy-observability
2) raffel_search query="source destination protocol percentiles"
3) raffel_get_guide topic=proxy-capabilities
```

```text
Need: failure-rate and error-rate alerts only

1) raffel_get_guide topic=proxy-observability
2) raffel_search query="failure_ratio error_rate"
3) raffel_proxy_capabilities includeMetrics=true includeRawConfig=true
```

### C) Policy engine / request rewrite in 60 seconds

```text
Need: block, mutate, or reroute traffic inside reverse/explicit/MITM/SOCKS5 flows

1) raffel_feature_catalog scope=proxy
2) raffel_proxy_capabilities includeRawConfig=true
3) raffel_search query="proxy middleware mitm-request socks5-connect target rewrite"
4) raffel_get_guide topic=proxy
```

### D) Protocol migration in 60 seconds

```text
Need: from Express/Fastify to Raffel quickly

1) raffel_feature_catalog scope=devx
2) raffel_get_guide topic=migration
3) raffel_get_guide topic=proxy (if ingress migration is involved)
4) raffel_create_server with needed features
```

Tip: when in doubt, use `scope=all` first and then narrow down.

---

## Prompts

- `create_rest_api`
- `create_realtime_server`
- `create_grpc_service`
- `create_microservice`
- `add_authentication`
- `add_caching`
- `add_rate_limiting`
- `add_observability`
- `migrate_from_express`
- `migrate_from_fastify`
- `migrate_from_trpc`
- `debug_middleware`
- `optimize_performance`

Use in Claude with `/prompt <name>` and let the toolchain follow up with MCP calls.

---

## Resources & Templates

The MCP resource model mirrors the same guide/topic map:

| Resource | What it gives you |
|:---------|:------------------|
| `raffel://guide/framework-plugins` | Build higher-level frameworks on Raffel with plugins, lifecycle hooks, and runtime inspection extensions |
| `raffel://guide/proxy` | Full proxy family guide (reverse/explicit/SOCKS5h/udp/websocket/TLS) |
| `raffel://guide/proxy-capabilities` | Feature matrix with protocol-by-mode coverage |
| `raffel://guide/proxy-observability` | Source→destination graph and duration/error semantics |
| `raffel://guide/mcp-server` | Build your own MCP servers with standalone and integrated modes |
| `raffel://guide/docs-mcp` | Expose Markdown docs or a git repo as a docs-first MCP server |
| `raffel://guide/mcp-intelligence` | MCP operating model and recommended call order |
| `raffel://guide/feature-map` | Team-level capability map |
| `raffel://guide/webhook-edge` | Public webhook edge with TLS, token/HMAC checks, and anti-replay guidance |
| `raffel://guide/quickstart` | Fast onboarding reference |
| `raffel://interceptor/{name}` | Middleware docs |
| `raffel://adapter/{name}` | Adapter mappings |
| `raffel://pattern/{name}` | API patterns |
| `raffel://error/{code}` | Error explanations |
| `raffel://boilerplate/{template}` | Multi-file project templates |

### Framework authors

If you are wrapping Raffel inside another framework, use the assistant to keep
the runtime model unified:

1. `raffel_get_guide topic=framework-plugins`
2. `raffel_get_guide topic=mcp-server`
3. `raffel_search query="ServerPlugin preview extensions mcp resources prompts"`

That workflow pushes framework authors toward one server, one runtime graph,
and one MCP exposure layer.

Resource templates:

- `raffel://interceptor/{name}`
- `raffel://adapter/{name}`
- `raffel://pattern/{name}`
- `raffel://error/{code}`
- `raffel://guide/{topic}`
- `raffel://boilerplate/{template}`

---

## Transports

### stdio (default)

```bash
npx raffel-mcp --transport stdio
```

### HTTP

```bash
npx raffel-mcp --transport http --port 3200
```

### SSE

```bash
npx raffel-mcp --transport sse --port 3200
```

---

## Integration Examples

### With Claude Code

```bash
claude mcp add raffel npx raffel-mcp
```

### With a Custom MCP Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio'

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['raffel-mcp'],
})

const client = new Client({ name: 'my-app', version: '1.0.0' })
await client.connect(transport)

const result = await client.callTool({
  name: 'raffel_search',
  arguments: { query: 'rate limiting' },
})

console.log(result)
```

---

## Programmatic Start

```typescript
import { createMCPServer } from 'raffel/mcp'

const server = createMCPServer({
  transport: 'http',
  port: 3200,
  category: ['docs', 'codegen'],
  toolsFilter: ['raffel_*', '!raffel_version'],
  debug: true,
})

await server.start()
```

`toolsFilter` accepts shell-style patterns and supports exclusions:

```text
['raffel_*', '!raffel_version']
```

`category` only accepts known categories (`quickstart`, `minimal`, `docs`, `codegen`, `architecture`, `full`), and unknown values fail fast.

### Programmatic docs server

```typescript
import { createDocsMcpServer } from 'raffel'

const server = createDocsMcpServer({
  dir: './docs',
  name: 'project-docs',
  watchInterval: 30_000,
})

await server.startHttp({ port: 3200, path: '/mcp' })
```

This variant indexes a docs tree or a git repo and exposes `search`, `read_section`, `code_examples`, `docs://file/{path}`, plus `explain` and `summarize` prompts.

---

## Troubleshooting

- Categories and toolsets:
  - `npx raffel-mcp --list-categories`
  - `npx raffel-mcp --category docs`
- Connection/debug:
  - `npx raffel-mcp --debug`

---

## Build Your Own MCP Server

This page documents Raffel's **built-in** AI assistant. If you want to build your own MCP server for your project — exposing your own tools, resources, and prompts to AI clients — see:

- [MCP Protocol Reference](/protocols/mcp.md) — the `createMcpServer()` API and `mcp: true` integrated mode
- [Building MCP Servers (Guide)](/guides/mcp-server.md) — step-by-step examples with code
- [Docs MCP Server](/guides/docs-mcp.md) — turn any Markdown docs tree into a searchable MCP server

---

## Next Steps

- [Quickstart](/learn/quickstart.md)
- [Tools families above](/reference/mcp.md#tool-families)
- [Interceptors and composition](/core/interceptors/overview.md)
- [Proxy modes](/proxy/modes.md)
- [Flow metrics](/proxy/flow-metrics.md)
- [OpenAPI & docs](/tooling/openapi.md)
