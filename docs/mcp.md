# MCP Server

Raffel includes an MCP (Model Context Protocol) server for AI-powered development.
It exposes **tools**, **resources**, and **prompts** that map directly to Raffel
best practices and documentation.

---

## What is MCP?

MCP is a protocol that lets AI assistants call tools and read structured resources.
With Raffel MCP you get:

- **Tools** — code generation, search, debugging
- **Resources** — docs, patterns, adapters, interceptors, boilerplates
- **Prompts** — guided flows for common tasks

---

## Quick Start

### Add to Claude Code

```bash
claude mcp add raffel npx raffel-mcp
```

### Run Directly

```bash
# All tools (default)
npx raffel-mcp

# Minimal set (getting started + errors)
npx raffel-mcp --category minimal

# Docs + codegen
npx raffel-mcp --category docs,codegen

# HTTP transport
npx raffel-mcp --transport http --port 3200
```

---

## Categories

| Category | Description | Tokens |
|:---------|:------------|:-------|
| `minimal` | Essential tools only | ~2.5K |
| `docs` | Documentation + patterns | ~3K |
| `codegen` | Code generation helpers | ~4K |
| `full` | All tools | ~8K |

See full category contents:

```bash
npx raffel-mcp --list-categories
```

---

## Tools

### Documentation & Reference

| Tool | Description |
|:-----|:------------|
| `raffel_getting_started` | Quickstart guide |
| `raffel_search` | Search across Raffel docs |
| `raffel_list_interceptors` | List interceptors by category |
| `raffel_get_interceptor` | Interceptor docs + examples |
| `raffel_list_adapters` | List protocol adapters |
| `raffel_get_adapter` | Adapter docs + mappings |
| `raffel_api_patterns` | **Critical** API usage patterns |
| `raffel_explain_error` | Error code explanations |

### Code Generation

| Tool | Description |
|:-----|:------------|
| `raffel_create_server` | Generate server boilerplate |
| `raffel_create_procedure` | Generate RPC endpoints |
| `raffel_create_stream` | Generate streaming handlers |
| `raffel_create_event` | Generate event handlers |
| `raffel_add_middleware` | Add interceptors |
| `raffel_create_module` | Create router modules |
| `raffel_boilerplate` | Multi-file project templates |

### Meta

| Tool | Description |
|:-----|:------------|
| `raffel_version` | Version + compatibility info |

**Example:**

```
User: Add rate limiting to my Raffel API

Assistant: [Uses raffel_search]
Assistant: [Uses raffel_get_interceptor]
```

---

## Prompts

| Prompt | Description |
|:-------|:------------|
| `create_rest_api` | Build complete REST API |
| `create_realtime_server` | WebSocket + channels |
| `create_grpc_service` | gRPC service scaffolding |
| `create_microservice` | Production-ready service |
| `add_authentication` | Add JWT/API key auth |
| `add_caching` | Add caching drivers |
| `add_rate_limiting` | Add per-route limits |
| `add_observability` | Metrics + tracing |
| `migrate_from_express` | Convert from Express |
| `migrate_from_fastify` | Convert from Fastify |
| `migrate_from_trpc` | Convert from tRPC |
| `debug_middleware` | Diagnose interceptor issues |
| `optimize_performance` | Perf review + tuning |

**Usage in Claude:**

```
User: /prompt create_rest_api
```

---

## Resources & Templates

The MCP server exposes docs and boilerplates as resources:

| Resource | Description |
|:---------|:------------|
| `raffel://guide/quickstart` | Quickstart guide |
| `raffel://interceptor/{name}` | Interceptor documentation |
| `raffel://adapter/{name}` | Adapter documentation |
| `raffel://pattern/{name}` | API patterns |
| `raffel://error/{code}` | Error explanations |
| `raffel://boilerplate/{template}` | Project boilerplates |

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

### With Custom Client

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

## Custom Server Options

You can start your own MCP server instance programmatically:

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

---

## Troubleshooting

### Tools Not Showing

```bash
npx raffel-mcp --list-categories
npx raffel-mcp --category full
```

### Connection Issues

```bash
npx raffel-mcp --debug
```

---

## Next Steps

- **[Quickstart](quickstart.md)** — Run your first server
- **[MCP Tools](mcp.md#tools)** — Full tool list
- **[Patterns](interceptors.md)** — Middleware + composition
- **[USD](usd.md)** — Auto-generated docs
