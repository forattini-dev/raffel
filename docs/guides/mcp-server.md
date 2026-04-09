# Building MCP Servers

> **This guide shows how to build your own MCP servers** using Raffel as a library.
>
> Raffel ships two MCP capabilities:
> 1. **Raffel AI Assistant** (`raffel mcp`) — a pre-built MCP server with tools for Raffel documentation, code generation, and debugging. See [Raffel AI Assistant](/reference/mcp.md).
> 2. **MCP Library** (`createMcpServer` / `mcp: true`) — a toolkit to build your own MCP servers for your projects. **This guide covers this.**

Create Model Context Protocol servers with Raffel — standalone or integrated into an existing multi-protocol server.

---

## Standalone: minimal example

```typescript
import { createMcpServer, mcpText } from 'raffel'

const server = createMcpServer({ name: 'my-tools', version: '1.0.0' })

server.tool({
  name: 'greet',
  description: 'Greet someone by name',
  input: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  handler: async ({ name }) => mcpText(`Hello, ${name}!`),
})

await server.startStdio()
```

That's it. This server works with Claude Code, Cursor, Windsurf, and any MCP client that uses stdio.

---

## Standalone with Zod (type-safe)

```typescript
import { createMcpServer, mcpText, mcpJson, mcpError } from 'raffel'
import { z } from 'zod'

const server = createMcpServer({
  name: 'deploy-tools',
  version: '1.0.0',
  instructions: 'Tools for managing deployments. Use deploy_service to push code.',
})

server
  .tool({
    name: 'deploy_service',
    description: 'Deploy a service to a target environment',
    input: z.object({
      service: z.string().describe('Service name'),
      version: z.string().describe('Semver version tag'),
      env: z.enum(['dev', 'staging', 'production']).describe('Target environment'),
      dryRun: z.boolean().default(false).describe('Preview without applying'),
    }),
    annotations: { destructiveHint: true },
    handler: async ({ service, version, env, dryRun }, ctx) => {
      ctx.log.info(`Deploying ${service}@${version} to ${env}`)
      ctx.progress(0, 3)

      if (dryRun) {
        return mcpText(`[dry-run] Would deploy ${service}@${version} to ${env}`)
      }

      // Simulate deploy steps
      ctx.progress(1, 3)
      await new Promise((r) => setTimeout(r, 500))
      ctx.progress(2, 3)
      await new Promise((r) => setTimeout(r, 500))
      ctx.progress(3, 3)

      return mcpJson({ deployed: true, service, version, env })
    },
  })
  .tool({
    name: 'list_services',
    description: 'List all running services',
    annotations: { readOnlyHint: true },
    handler: async () => {
      const services = [
        { name: 'api', version: '2.1.0', env: 'production', healthy: true },
        { name: 'worker', version: '2.0.5', env: 'production', healthy: true },
        { name: 'api', version: '2.2.0-rc.1', env: 'staging', healthy: false },
      ]
      return mcpJson(services)
    },
  })

await server.startStdio()
```

TypeScript infers the handler args from the Zod schema — `service` is `string`, `env` is `'dev' | 'staging' | 'production'`, `dryRun` is `boolean`.

---

## Resources and Prompts

MCP isn't just tools. Resources expose read-only data, and prompts are reusable templates.

```typescript
import { createMcpServer, mcpText } from 'raffel'

const server = createMcpServer({ name: 'docs', version: '1.0.0' })

// Static resource
server.resource({
  uri: 'config://app',
  name: 'App Configuration',
  mimeType: 'application/json',
  handler: async () => ({
    contents: [{
      uri: 'config://app',
      mimeType: 'application/json',
      text: JSON.stringify({ env: 'production', debug: false }),
    }],
  }),
})

// Dynamic resource template
server.resourceTemplate({
  uriTemplate: 'file://{path}',
  name: 'Project Files',
  description: 'Read any file from the project',
  handler: async (uri, params) => ({
    contents: [{
      uri,
      mimeType: 'text/plain',
      text: await Bun.file(params.path).text(),
    }],
  }),
  // Auto-complete the {path} parameter
  completions: {
    path: async (prefix) => {
      const glob = new Bun.Glob(`${prefix}*`)
      return Array.from(glob.scanSync('.')).slice(0, 10)
    },
  },
})

// Prompt template
server.prompt({
  name: 'code_review',
  description: 'Generate a code review prompt for a given file',
  arguments: [
    { name: 'file', description: 'File path to review', required: true },
    { name: 'focus', description: 'Review focus (security, performance, readability)' },
  ],
  handler: async ({ file, focus }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Review the file "${file}"${focus ? ` with focus on ${focus}` : ''}. Check for bugs, suggest improvements, and note any issues.`,
      },
    }],
  }),
})

await server.startStdio()
```

---

## Interceptors (middleware)

Add cross-cutting logic that runs before every tool, resource, or prompt handler.

```typescript
import { createMcpServer, mcpText, mcpError } from 'raffel'

const server = createMcpServer({ name: 'secure-tools', version: '1.0.0' })

// Logging interceptor
server.use(async (request, next) => {
  const start = Date.now()
  console.error(`[mcp] ${request.type}:${request.name} started`)
  const result = await next()
  console.error(`[mcp] ${request.type}:${request.name} completed in ${Date.now() - start}ms`)
  return result
})

// Rate limiting interceptor
const callCounts = new Map<string, number>()
server.use(async (request, next) => {
  const key = request.name
  const count = (callCounts.get(key) ?? 0) + 1
  callCounts.set(key, count)

  if (count > 100) {
    return mcpError(`Rate limit exceeded for ${key}`)
  }

  return next()
})

server.tool({
  name: 'secure_action',
  description: 'A rate-limited action',
  handler: async () => mcpText('done'),
})

await server.startStdio()
```

---

## Integrated mode: `mcp: true`

The killer feature. Add MCP to an existing Raffel server and all procedures become tools automatically.

```typescript
import { createServer, createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({
  port: 3000,
  mcp: true, // all procedures become MCP tools on POST /mcp
})

server
  .procedure('users.list')
  .description('List all users')
  .handler(async () => {
    return [
      { id: '1', name: 'Alice', email: 'alice@example.com' },
      { id: '2', name: 'Bob', email: 'bob@example.com' },
    ]
  })

server
  .procedure('users.create')
  .input(z.object({ name: z.string(), email: z.string().email() }))
  .description('Create a new user')
  .handler(async (input) => {
    return { id: crypto.randomUUID(), ...input }
  })

server
  .procedure('users.delete')
  .input(z.object({ id: z.string() }))
  .description('Delete a user by ID')
  .http('/users/:id', 'DELETE')
  .handler(async ({ id }) => {
    return { deleted: true, id }
  })

await server.start()
// HTTP API on http://localhost:3000
// MCP endpoint on http://localhost:3000/mcp
```

MCP clients see:

| Tool | Description | Annotations |
|------|-------------|-------------|
| `users_list` | List all users | `readOnlyHint: true` |
| `users_create` | Create a new user | — |
| `users_delete` | Delete a user by ID | `destructiveHint: true`, `idempotentHint: true` |

Annotations are derived automatically from procedure names and HTTP methods. Tool calls flow through the full interceptor chain — auth, rate-limiting, logging, validation all apply.

---

## Integrated mode: filtering and customization

```typescript
const server = createServer({
  port: 3000,
  mcp: {
    path: '/api/mcp',
    name: 'my-api',
    version: '2.0.0',
    instructions: 'API for managing users and orders. Use users_list before creating.',

    // Only expose procedures tagged as 'public'
    filter: (meta) => meta.tags?.includes('public') ?? false,

    // Custom tool naming
    toolName: (name) => `api_${name.replace(/\./g, '_')}`,

    // Add extra MCP-only tools alongside auto-discovered ones
    tools: [{
      name: 'api_health',
      description: 'Check API health status',
      handler: async () => mcpJson({ status: 'ok', uptime: process.uptime() }),
    }],
  },
})

server
  .procedure('users.list')
  .tags('public')
  .description('List all users')
  .handler(async () => [])

server
  .procedure('internal.metrics')
  .tags('internal') // filtered out — not exposed as MCP tool
  .description('Internal metrics')
  .handler(async () => ({}))
```

---

## Transports

### stdio (default for CLI tools)

```typescript
await server.startStdio()
```

Works with Claude Code, Cursor, Windsurf, and any client that spawns a subprocess.

### Streamable HTTP (remote servers)

```typescript
await server.startHttp({ port: 8080, path: '/mcp' })
```

Modern MCP transport with:
- `POST /mcp` — JSON-RPC requests
- `GET /mcp` — SSE stream for server notifications
- `DELETE /mcp` — session teardown
- `Mcp-Session-Id` header for stateful sessions

### SSE (legacy)

```typescript
await server.startSse({ port: 8080 })
```

For older MCP clients. Use Streamable HTTP for new implementations.

---

## Documentation server from Markdown

If your main goal is to expose an existing docs tree instead of building custom tools by hand, use `createDocsMcpServer()`.

```typescript
import { createDocsMcpServer } from 'raffel'

const server = createDocsMcpServer({
  name: 'internal-docs',
  version: '1.0.0',
  dir: './docs',
  watchInterval: 30_000,
})

await server.startHttp({ port: 8080, path: '/mcp' })
```

Built-in tools include:

- `search`
- `list_files`
- `read_file`
- `read_section`
- `list_headings`
- `code_examples`
- `file_outline`
- `stats`

It also exposes `docs://file/{path}` resources and `explain` / `summarize` prompts.

Git repo mode is built in:

```typescript
const repoDocs = createDocsMcpServer({
  repo: 'https://github.com/org/repo',
  branch: 'main',
  path: 'docs/',
  name: 'repo-docs',
})

await repoDocs.startStdio()
```

The returned server also supports `await server.reindex()` if you need an immediate refresh after doc updates.

For CLI usage, Raffel ships the same feature as:

```bash
raffel mcp --docs ./docs
raffel mcp --docs https://github.com/org/repo --path docs/
```

See [Docs MCP Server](/guides/docs-mcp.md) for the dedicated guide.

---

## Response helpers

```typescript
import {
  mcpText,     // plain text
  mcpJson,     // pretty-printed JSON
  mcpTable,    // markdown table
  mcpImage,    // base64 image
  mcpResource, // embedded resource
  mcpError,    // error with isError flag
  mcpMulti,    // multiple content blocks
} from 'raffel'

// Text
return mcpText('Hello!')

// JSON
return mcpJson({ users: [{ id: '1', name: 'Alice' }] })

// Markdown table
return mcpTable(
  ['Name', 'Role', 'Active'],
  [
    ['Alice', 'Admin', 'Yes'],
    ['Bob', 'Editor', 'No'],
  ]
)

// Image
const screenshot = await takeScreenshot()
return mcpImage(screenshot, 'image/png')

// Error
return mcpError('User not found', { id: 'usr_404' })

// Multiple blocks
return mcpMulti(
  { type: 'text', text: '## Report Summary' },
  { type: 'text', text: 'Generated 3 charts:' },
  { type: 'image', data: chart1Base64, mimeType: 'image/png' },
  { type: 'image', data: chart2Base64, mimeType: 'image/png' },
  { type: 'image', data: chart3Base64, mimeType: 'image/png' },
)
```

---

## Dynamic tools (listChanged)

Register and unregister tools at runtime. Connected clients are notified automatically.

```typescript
import { createMcpServer, mcpText } from 'raffel'

const server = createMcpServer({ name: 'dynamic', version: '1.0.0' })
const protocol = server.getProtocolHandler()

// Initial tool
protocol.registerTool({
  name: 'status',
  description: 'Server status',
  handler: async () => mcpText('running'),
})

// Later: add a new tool — client receives notifications/tools/list_changed
setTimeout(() => {
  protocol.registerTool({
    name: 'new_feature',
    description: 'A feature added at runtime',
    handler: async () => mcpText('feature works'),
  })
}, 30_000)

// Or remove one
setTimeout(() => {
  protocol.unregisterTool('status')
}, 60_000)

await server.startStdio()
```

---

## Resource subscriptions

Clients can subscribe to resource changes and receive notifications when data updates.

```typescript
import { createMcpServer } from 'raffel'

const server = createMcpServer({ name: 'live-data', version: '1.0.0' })
const protocol = server.getProtocolHandler()

let currentData = { count: 0, lastUpdated: new Date().toISOString() }

server.resource({
  uri: 'data://counter',
  name: 'Live Counter',
  mimeType: 'application/json',
  handler: async () => ({
    contents: [{
      uri: 'data://counter',
      mimeType: 'application/json',
      text: JSON.stringify(currentData),
    }],
  }),
})

// Simulate data changes — subscribed clients get notified
setInterval(() => {
  currentData = { count: currentData.count + 1, lastUpdated: new Date().toISOString() }
  protocol.notifyResourceUpdated('data://counter')
}, 5000)

await server.startHttp({ port: 8080 })
```

---

## Multi-protocol: HTTP + gRPC + WebSocket + MCP

One server, one contract, every transport.

```typescript
import { createServer, createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({
  port: 3000,
  websocket: { path: '/ws' },
  jsonrpc: { path: '/rpc' },
  graphql: { path: '/graphql' },
  mcp: true,
})

server
  .procedure('math.add')
  .input(z.object({ a: z.number(), b: z.number() }))
  .output(z.object({ result: z.number() }))
  .description('Add two numbers')
  .graphql({ type: 'query' })
  .handler(async ({ a, b }) => ({ result: a + b }))

await server.start()
```

`math.add` is now accessible via:

```bash
# HTTP
curl -X POST http://localhost:3000/math.add \
  -H 'Content-Type: application/json' \
  -d '{"a": 2, "b": 3}'

# JSON-RPC
curl http://localhost:3000/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"math.add","params":{"a":2,"b":3}}'

# GraphQL
curl http://localhost:3000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ mathAdd(a:2, b:3) { result } }"}'

# MCP
curl http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"math_add","arguments":{"a":2,"b":3}}}'
```

---

## Claude Code configuration

### stdio server

```json
{
  "mcpServers": {
    "my-tools": {
      "command": "node",
      "args": ["dist/mcp-server.js"]
    }
  }
}
```

### HTTP server (remote)

```json
{
  "mcpServers": {
    "my-api": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

---

## Error handling

```typescript
import { createMcpServer, mcpText, mcpError, McpError } from 'raffel'

const server = createMcpServer({ name: 'safe', version: '1.0.0' })

server.tool({
  name: 'divide',
  description: 'Divide two numbers',
  input: z.object({ a: z.number(), b: z.number() }),
  handler: async ({ a, b }) => {
    if (b === 0) {
      // Soft error — returned as tool result with isError flag
      return mcpError('Division by zero')
    }
    return mcpText(String(a / b))
  },
})

server.tool({
  name: 'restricted',
  description: 'Admin-only action',
  handler: async () => {
    // Hard error — returned as JSON-RPC error (not tool result)
    throw new McpError(-32602, 'Insufficient permissions', { required: 'admin' })
  },
})

await server.startStdio()
```

Two error modes:
- `mcpError(message)` — soft error. Returned as tool result with `isError: true`. The AI sees the error and can retry.
- `throw new McpError(code, message)` — hard error. Returned as JSON-RPC error. The client shows it as a protocol failure.

---

## Authentication

Auth is enforced at the HTTP transport layer. stdio has no auth (process boundary is the security boundary).

### Bearer token (JWT)

```typescript
import { createMcpServer, mcpText, createBearerAuth } from 'raffel'
import jwt from 'jsonwebtoken'

const server = createMcpServer({
  name: 'secure-api',
  version: '1.0.0',
  auth: createBearerAuth({
    verify: (token) => {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
          sub: string; scopes: string[]; exp: number
        }
        return {
          token,
          clientId: decoded.sub,
          scopes: decoded.scopes,
          expiresAt: decoded.exp,
        }
      } catch {
        return null // invalid token → 401
      }
    },
  }),
})

server.tool({
  name: 'admin_action',
  description: 'Admin-only action',
  handler: async (_args, ctx) => {
    // ctx.auth is set by the auth provider
    if (!ctx.auth?.scopes.includes('admin')) {
      return mcpError('Insufficient permissions')
    }
    return mcpText(`Action performed by ${ctx.auth.clientId}`)
  },
})

await server.startHttp({ port: 8080 })
```

Clients send: `Authorization: Bearer <jwt-token>`

### API key

```typescript
import { createMcpServer, createApiKeyAuth } from 'raffel'

const server = createMcpServer({
  name: 'my-tools',
  version: '1.0.0',
  auth: createApiKeyAuth({
    // Static key map
    keys: {
      'sk-prod-abc123': { clientId: 'production-app', scopes: ['read', 'write'] },
      'sk-readonly-xyz': { clientId: 'monitoring', scopes: ['read'] },
    },
  }),
})
```

Clients send: `X-Api-Key: sk-prod-abc123`

### API key with database lookup

```typescript
import { createApiKeyAuth } from 'raffel'

const auth = createApiKeyAuth({
  verify: async (key) => {
    const record = await db.apiKeys.findByKey(key)
    if (!record || record.revoked) return null
    return { token: key, clientId: record.owner, scopes: record.scopes }
  },
})
```

### Multiple auth methods (composite)

```typescript
import { createCompositeAuth, createBearerAuth, createApiKeyAuth } from 'raffel'

const auth = createCompositeAuth(
  createBearerAuth({ verify: verifyJwt }),
  createApiKeyAuth({ keys: staticKeys }),
)
// Tries bearer first, then API key. First match wins.
```

### Custom auth provider

```typescript
import type { McpAuthProvider } from 'raffel'

const auth: McpAuthProvider = {
  verify: async (request) => {
    // Access any header
    const token = request.headers['x-custom-auth']
    if (typeof token !== 'string') return null

    const user = await validateCustomToken(token)
    if (!user) return null

    return {
      token,
      clientId: user.id,
      scopes: user.permissions,
      extra: { teamId: user.teamId },
    }
  },
}
```

### Auth in integrated mode

```typescript
import { createServer, createBearerAuth } from 'raffel'

const server = createServer({
  port: 3000,
  mcp: {
    auth: createBearerAuth({
      verify: (token) => token === 'secret'
        ? { token, clientId: 'admin', scopes: ['all'] }
        : null,
    }),
  },
})
```

### Accessing auth in tool handlers

```typescript
server.tool({
  name: 'whoami',
  description: 'Show authenticated client info',
  handler: async (_args, ctx) => {
    if (!ctx.auth) {
      return mcpText('Not authenticated')
    }
    return mcpJson({
      clientId: ctx.auth.clientId,
      scopes: ctx.auth.scopes,
      expiresAt: ctx.auth.expiresAt,
      extra: ctx.auth.extra,
    })
  },
})
```

---

## See also

- [MCP Protocol Reference](/protocols/mcp.md) — API reference, options, feature support table
- [Raffel AI Assistant (built-in MCP)](/reference/mcp.md) — the pre-built MCP for Raffel docs and code generation (different from building your own)
- [Procedures](/core/procedures.md) — how Raffel procedures work
- [Interceptors](/core/interceptors/overview.md) — middleware reference
- [Validation](/tooling/validation.md) — Zod and other validators
- [Authentication](/guides/auth.md) — auth strategies that apply to MCP in integrated mode
- [Multi-Protocol Service](/guides/multi-protocol-service.md) — full multi-transport example
