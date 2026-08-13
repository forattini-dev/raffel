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
| `resourceTemplates` | `McpResourceTemplateRegistration[]` | — | Extra resource templates |
| `prompts` | `McpPromptRegistration[]` | — | Extra prompts |
| `auth` | `McpAuthProvider` | — | Auth provider for the HTTP MCP endpoint |
| `cors` | `boolean \| string \| string[]` | `false` | Explicit CORS policy for browser clients |
| `maxBodySize` | `number` | `1048576` | Maximum request body size |
| `maxSessions` | `number` | `1000` | Maximum live stateful sessions |
| `maxStreamsPerSession` | `number` | `5` | Maximum SSE streams per session |

HTTP MCP binds to `127.0.0.1` by default. A non-loopback listener requires
`auth`, unless `dangerouslyAllowUnauthenticatedNetwork` is explicitly enabled
after a risk review. CORS is disabled unless configured.

### Auto-derived annotations

| Procedure pattern | Annotation |
|-------------------|------------|
| Name starts with `get`, `list`, `find`, `search` or `httpMethod: 'GET'` | `readOnlyHint: true` |
| Name starts with `delete`, `remove`, `destroy` or `httpMethod: 'DELETE'` | `destructiveHint: true` |
| `httpMethod` is GET, PUT, or DELETE | `idempotentHint: true` |

### Interceptor chain

Tool calls go through the full Raffel interceptor chain. If your server has auth, rate-limiting, or logging interceptors, they apply to MCP tool calls too.

### Framework wrappers

If you are building a framework on top of Raffel, prefer integrated `mcp` mode
over running a separate MCP server by default.

Recommended split:

- expose tools/resources/prompts through the `mcp` server option
- expose framework runtime metadata through `ServerPlugin.inspect()`
- keep both derived from the same Raffel server instance

See [Framework Plugins](/tooling/framework-plugins.md) for the runtime
extension surface, and [Framework Runtime RFC](/reference/framework-runtime-rfc.md)
for the broader roadmap.

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

For Streamable HTTP, the same exposure defaults apply:

```typescript
await server.startHttp({
  host: '127.0.0.1',
  port: 3001,
  maxBodySize: 1024 * 1024,
  maxSessions: 500,
  maxStreamsPerSession: 3,
  cors: ['https://app.example.com'],
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

## Documentation MCP server

If you want to expose an existing Markdown docs tree over MCP, Raffel also ships `createDocsMcpServer()`.

```typescript
import { createDocsMcpServer } from 'raffel'

const server = createDocsMcpServer({
  dir: './docs',
  watchInterval: 30_000,
})

await server.startHttp({ port: 3200, path: '/mcp' })
```

It provides docs-first tools such as `search`, `read_file`, `read_section`, `code_examples`, and `file_outline`, plus `docs://file/{path}` resources and summary/explanation prompts.

For quick CLI usage, you can also run:

```bash
raffel mcp --docs ./docs
raffel mcp --docs https://github.com/org/repo --path docs/
```

See [Docs MCP Server](/guides/docs-mcp.md) for the full workflow.

---

## See also

- [Building MCP Servers (Guide)](/guides/mcp-server.md) — step-by-step examples
- [Docs MCP Server](/guides/docs-mcp.md) — Markdown docs indexed as an MCP server
- [Raffel AI Assistant (built-in MCP)](/reference/mcp.md) — the pre-built MCP for Raffel documentation and code generation
- [Procedures](/core/procedures.md) — how procedures work
- [Interceptors](/core/interceptors/overview.md) — middleware reference
