# MCP Server

Raffel includes an MCP (Model Context Protocol) server for AI-powered development.

---

## What is MCP?

MCP is a protocol that allows AI assistants like Claude to interact with external tools and resources. The Raffel MCP server provides:

- **Tools** — Code generation and debugging helpers
- **Resources** — Documentation access
- **Prompts** — Pre-built templates for common tasks

---

## Installation

### Add to Claude Code

```bash
claude mcp add raffel npx raffel-mcp
```

### Run Directly

```bash
# All tools
npx raffel-mcp

# Minimal set (getting started only)
npx raffel-mcp --category minimal

# Specific categories
npx raffel-mcp --category docs,codegen
```

---

## Available Categories

| Category | Description |
|:---------|:------------|
| `minimal` | Essential getting started tools |
| `docs` | Documentation search and access |
| `codegen` | Code generation tools |
| `debug` | Debugging and error analysis |
| `all` | All available tools (default) |

---

## Tools

### Documentation Tools

| Tool | Description |
|:-----|:------------|
| `raffel_getting_started` | Quick start guide |
| `raffel_search` | Search all documentation |
| `raffel_api_patterns` | Correct code patterns |

**Example:**

```
User: How do I add rate limiting in Raffel?

Claude: [Uses raffel_search tool]
Here's how to add rate limiting...
```

### Code Generation Tools

| Tool | Description |
|:-----|:------------|
| `raffel_create_server` | Generate server boilerplate |
| `raffel_create_procedure` | Generate RPC endpoints |
| `raffel_create_stream` | Generate streaming handlers |
| `raffel_add_middleware` | Add interceptors |

**Example:**

```
User: Create a new Raffel server with user CRUD

Claude: [Uses raffel_create_server tool]
[Uses raffel_create_procedure tool x4]
Here's your complete server...
```

### Debugging Tools

| Tool | Description |
|:-----|:------------|
| `raffel_explain_error` | Debug error codes |
| `raffel_diagnose` | Analyze common issues |

**Example:**

```
User: I'm getting RATE_LIMITED error

Claude: [Uses raffel_explain_error tool]
The RATE_LIMITED error means...
```

---

## Prompts

Pre-built templates for common scenarios:

| Prompt | Description |
|:-------|:------------|
| `create_rest_api` | Build complete REST API |
| `create_realtime_server` | WebSocket + channels |
| `create_microservice` | Production-ready service |
| `migrate_from_express` | Convert from Express |
| `add_authentication` | Add JWT/API key auth |
| `add_observability` | Metrics + tracing |

### Using Prompts

In Claude:

```
User: /prompt create_rest_api

Claude: I'll help you create a REST API with Raffel.
What entities do you want to manage?
```

---

## Resources

The MCP server exposes documentation as resources:

| Resource | Description |
|:---------|:------------|
| `raffel://docs/quickstart` | Quickstart guide |
| `raffel://docs/core-model` | Core concepts |
| `raffel://docs/protocols/*` | Protocol-specific docs |
| `raffel://docs/interceptors/*` | Interceptor docs |
| `raffel://examples/*` | Code examples |

---

## Configuration

### Environment Variables

```bash
# Set documentation path (defaults to npm package)
RAFFEL_DOCS_PATH=/path/to/docs

# Set log level
RAFFEL_MCP_LOG_LEVEL=debug

# Enable specific categories
RAFFEL_MCP_CATEGORIES=docs,codegen
```

### Config File

Create `.raffel-mcp.json`:

```json
{
  "categories": ["docs", "codegen"],
  "logLevel": "info",
  "customDocs": "./docs"
}
```

---

## Custom MCP Server

Extend the Raffel MCP server with your own tools:

```typescript
import { createRaffelMcpServer } from 'raffel/mcp'

const server = createRaffelMcpServer({
  categories: ['all'],
})

// Add custom tool
server.addTool({
  name: 'my_custom_tool',
  description: 'Does something custom',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string' },
    },
  },
  handler: async (input) => {
    return { result: `Processed: ${input}` }
  },
})

// Add custom resource
server.addResource({
  uri: 'my-app://config',
  name: 'App Configuration',
  mimeType: 'application/json',
  handler: async () => {
    return JSON.stringify(appConfig)
  },
})

server.start()
```

---

## Transport Modes

### stdio (Default)

For local CLI tools like Claude Code:

```bash
npx raffel-mcp --transport=stdio
```

### SSE

For HTTP-based connections:

```bash
npx raffel-mcp --transport=sse --port=8080
```

---

## Integration Examples

### With Claude Code

```bash
# Add the MCP server
claude mcp add raffel npx raffel-mcp

# Now in conversations:
# "Create a Raffel server with WebSocket support"
# "Add rate limiting to my API"
# "Explain this Raffel error"
```

### With Custom Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio'

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['raffel-mcp'],
})

const client = new Client({
  name: 'my-app',
  version: '1.0.0',
})

await client.connect(transport)

// Use tools
const result = await client.callTool({
  name: 'raffel_search',
  arguments: { query: 'rate limiting' },
})

console.log(result)
```

---

## Troubleshooting

### MCP Server Not Found

```bash
# Ensure raffel is installed
pnpm add raffel

# Or run directly
npx raffel-mcp
```

### Tools Not Showing

```bash
# Check available tools
npx raffel-mcp --list-tools

# Enable all categories
npx raffel-mcp --category all
```

### Connection Issues

```bash
# Enable debug logging
RAFFEL_MCP_LOG_LEVEL=debug npx raffel-mcp
```

---

## Next Steps

- **[DX](dx.md)** — Developer experience features
- **[Hot Reload](hot-reload.md)** — Development server
- **[Quickstart](quickstart.md)** — Get started with Raffel
