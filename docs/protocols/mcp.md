# MCP Protocol — Build Your Own MCP Server

> **This page documents Raffel's MCP library** — the toolkit you use to build your own MCP servers for your projects.
>
> Looking for Raffel's built-in AI assistant MCP? See [Raffel AI Assistant](/reference/mcp.md).

Use Raffel to create MCP (Model Context Protocol) servers that AI clients — Claude Code, Cursor, Windsurf — can connect to. Expose your application's capabilities as tools, resources, and prompts.

---

## Quick start

### Integrated (one line)

```typescript
const server = createServer({ port: 3000, mcp: true })
```

All registered procedures become MCP tools. Endpoint: `POST /mcp`.

### Standalone

```typescript
import { createMcpServer, mcpText } from 'raffel'

const server = createMcpServer({ name: 'tools', version: '1.0.0' })
  .tool({ name: 'ping', description: 'Ping', handler: async () => mcpText('pong') })

await server.startStdio()
```

---

## Integrated mode

Add `mcp` to your server options. Procedures are converted to tools automatically.

```typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  mcp: {
    path: '/mcp',                    // default: '/mcp'
    name: 'my-api',                  // reported in initialize
    version: '2.0.0',
    instructions: 'Use users_list first',
    filter: (meta) => !meta.tags?.includes('internal'),
    toolName: (name) => name.replace(/\./g, '_'),
  },
})
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `path` | `string` | `'/mcp'` | HTTP endpoint path |
| `name` | `string` | `'raffel'` | Server name in initialize response |
| `version` | `string` | `'1.0.0'` | Server version |
| `instructions` | `string` | — | Instructions for AI clients |
| `filter` | `(meta) => boolean` | — | Filter which procedures become tools |
| `toolName` | `(name) => string` | dots → underscores | Transform procedure names |
| `tools` | `McpToolRegistration[]` | — | Extra manually-defined tools |
| `resources` | `McpResourceRegistration[]` | — | Extra resources |
| `prompts` | `McpPromptRegistration[]` | — | Extra prompts |

### Auto-derived annotations

| Procedure pattern | Annotation |
|-------------------|------------|
| Name starts with `get`, `list`, `find`, `search` or `httpMethod: 'GET'` | `readOnlyHint: true` |
| Name starts with `delete`, `remove`, `destroy` or `httpMethod: 'DELETE'` | `destructiveHint: true` |
| `httpMethod` is GET, PUT, or DELETE | `idempotentHint: true` |

### Interceptor chain

Tool calls go through the full Raffel interceptor chain. If your server has auth, rate-limiting, or logging interceptors, they apply to MCP tool calls too.

---

## Standalone mode

```typescript
import { createMcpServer } from 'raffel'

const server = createMcpServer({
  name: 'my-tools',
  version: '1.0.0',
  instructions: 'Use search before create.',
  requestTimeout: 30_000,    // per-request timeout (default: 60s)
  maxTotalTimeout: 300_000,  // absolute max (default: 600s)
})
```

### `.tool(registration)`

```typescript
server.tool({
  name: 'search',
  description: 'Search the database',
  input: z.object({ query: z.string(), limit: z.number().default(10) }),
  annotations: { readOnlyHint: true },
  handler: async ({ query, limit }, ctx) => {
    ctx.log.info(`Searching: ${query}`)
    ctx.progress(0, 2)
    const results = await db.search(query, limit)
    ctx.progress(2, 2)
    return mcpJson(results)
  },
})
```

### `.resource(registration)`

```typescript
server.resource({
  uri: 'schema://users',
  name: 'Users Schema',
  mimeType: 'application/json',
  handler: async () => ({
    contents: [{ uri: 'schema://users', mimeType: 'application/json', text: schemaJson }],
  }),
})
```

### `.resourceTemplate(registration)`

```typescript
server.resourceTemplate({
  uriTemplate: 'db://{table}/{id}',
  name: 'Database Record',
  handler: async (uri, { table, id }) => ({
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(await db.get(table, id)) }],
  }),
  completions: {
    table: async (prefix) => tables.filter((t) => t.startsWith(prefix)),
  },
})
```

### `.prompt(registration)`

```typescript
server.prompt({
  name: 'explain_error',
  description: 'Explain an error code',
  arguments: [{ name: 'code', required: true }],
  handler: async ({ code }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: `Explain error ${code}` } }],
  }),
})
```

### `.use(interceptor)`

```typescript
server.use(async (request, next) => {
  console.error(`[${request.type}] ${request.name}`)
  return next()
})
```

---

## Transports

| Transport | Method | Use case |
|-----------|--------|----------|
| `startStdio()` | stdin/stdout | Claude Code, Cursor, CLI tools |
| `startHttp({ port })` | Streamable HTTP | Remote servers, web clients |
| `startSse({ port })` | Server-Sent Events | Legacy MCP clients |

### Streamable HTTP details

- `POST /mcp` — JSON-RPC request/response
- `GET /mcp` — SSE stream for server-initiated notifications
- `DELETE /mcp` — session teardown
- `Mcp-Session-Id` header for stateful sessions (30min TTL)

---

## Protocol support

| Feature | Supported |
|---------|-----------|
| Protocol versions | `2025-03-26`, `2024-11-05` |
| Tools (list, call) | Yes |
| Resources (list, read, templates) | Yes |
| Prompts (list, get) | Yes |
| Completion | Yes (enum + template) |
| Progress reporting | Yes (`ctx.progress()`) |
| Request cancellation | Yes (AbortSignal) |
| Logging notifications | Yes (`ctx.log.*`) |
| `logging/setLevel` | Yes |
| Cursor pagination | Yes (page size 50) |
| `listChanged` notifications | Yes (tools, resources, prompts) |
| Resource subscriptions | Yes (subscribe, unsubscribe, updated) |
| Sampling (`sampling/createMessage`) | Yes (when transport supports it) |
| Tool annotations | Yes (5 hints + auto-derived) |
| Audio content | Yes |
| Session management | Yes (Streamable HTTP) |

---

## See also

- [Building MCP Servers (Guide)](/guides/mcp-server.md) — step-by-step examples
- [Raffel AI Assistant (built-in MCP)](/reference/mcp.md) — the pre-built MCP for Raffel documentation and code generation
- [Procedures](/core/procedures.md) — how procedures work
- [Interceptors](/core/interceptors/overview.md) — middleware reference
