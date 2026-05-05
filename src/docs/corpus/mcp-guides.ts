export const MCP_SERVER_GUIDE = `# Building MCP Servers

Raffel ships two different MCP surfaces:

- the built-in Raffel AI assistant (\`raffel mcp\`)
- the MCP library for your own tools, resources, and prompts

Use the library when you want project-specific MCP behavior.

## Standalone

\`\`\`typescript
import { createMcpServer, mcpText } from 'raffel'

const server = createMcpServer({ name: 'my-tools', version: '1.0.0' })

server.tool({
  name: 'ping',
  description: 'Basic connectivity test',
  handler: async () => mcpText('pong'),
})

await server.startStdio()
\`\`\`

## Integrated mode

\`\`\`typescript
import { createServer } from 'raffel'

const server = createServer({
  port: 3000,
  mcp: {
    path: '/mcp',
    name: 'my-api',
    filter: (meta) => !meta.tags?.includes('internal'),
  },
})
\`\`\`

All eligible procedures become MCP tools automatically.

## Important options

- \`path\`, \`name\`, \`version\`, \`instructions\`
- \`filter\` and \`toolName\`
- extra \`tools\`, \`resources\`, \`resourceTemplates\`, and \`prompts\`
- \`auth\` for the HTTP MCP endpoint

## Transport support

- \`startStdio()\`
- \`startHttp({ port, path })\`
- \`startSse({ port })\`

Supported protocol features include tools, resources, prompts, completion, progress, logging notifications, listChanged notifications, resource subscriptions, and sampling where the transport/client supports it.

## Related guide

Use \`docs-mcp\` when you want to expose Markdown documentation instead of building custom tools by hand.
`

export const FRAMEWORK_PLUGINS_GUIDE = `# Framework Plugins

If you are building a higher-level framework on top of Raffel, use \`ServerPlugin\`
for runtime extension and \`server.provide()\` for dependency injection.

## What plugins are for

- register framework-owned handlers
- run startup and shutdown orchestration
- attach namespaced metadata to \`server.preview()\`

## What providers are for

- database clients
- cache or queue clients
- handler-facing services exposed through \`ctx.services\`

## Quick example

\`\`\`typescript
import { createServer, type ServerPlugin } from 'raffel'

const frameworkPlugin: ServerPlugin = {
  name: 'purple',

  register({ server }) {
    server.procedure('purple.health').handler(async () => ({ ok: true }))
  },

  async beforeStart({ providers }) {
    const services = providers as { db?: { ping(): Promise<void> } }
    await services.db?.ping()
  },

  inspect: ({ preview }) => ({
    namespace: 'purple',
    title: 'Purple Runtime',
    nodes: [
      {
        id: 'purple:summary',
        kind: 'summary',
        label: 'Purple Summary',
        data: { operationCount: preview.operations.length },
      },
    ],
  }),
}

const server = createServer({
  port: 3000,
  plugins: [frameworkPlugin],
})
\`\`\`

## Lifecycle order

1. \`register\`
2. \`beforeStart\` in declaration order
3. \`afterStart\` in declaration order
4. \`beforeStop\` in reverse order
5. \`afterStop\` in reverse order

## Runtime graph extension

Framework-specific metadata should live in \`server.preview().extensions\`.
That keeps framework DX aligned with Raffel's canonical runtime graph instead of
creating a second registry for workers, resources, schedules, or policies.

## MCP guidance

If your framework also exposes MCP, prefer Raffel's integrated \`mcp\` mode for
tools/resources/prompts and use plugins for lifecycle + inspection metadata.
`

export const DOCS_MCP_GUIDE = `# Documentation MCP Server

Use \`createDocsMcpServer()\` or \`raffel mcp --docs\` to expose Markdown docs over MCP.

## CLI

\`\`\`bash
raffel mcp --docs ./docs
raffel mcp --docs ./docs --transport http --port 3200
raffel mcp --docs https://github.com/org/repo --path docs/ --branch main
\`\`\`

## Programmatic API

\`\`\`typescript
import { createDocsMcpServer } from 'raffel'

const server = createDocsMcpServer({
  dir: './docs',
  watchInterval: 30_000,
  name: 'project-docs',
})

await server.startHttp({ port: 3200, path: '/mcp' })
\`\`\`

Git repository mode:

\`\`\`typescript
const repoDocs = createDocsMcpServer({
  repo: 'https://github.com/org/repo',
  branch: 'main',
  path: 'docs/',
  name: 'repo-docs',
})
\`\`\`

## Built-in tools

- \`search\`
- \`list_files\`
- \`read_file\`
- \`read_section\`
- \`list_headings\`
- \`code_examples\`
- \`file_outline\`
- \`stats\`

## Resources and prompts

- resources: \`docs://files\`, \`docs://file/{path}\`
- prompts: \`explain\`, \`summarize\`

## Operational notes

- indexes \`.md\` and \`.mdx\` by default
- skips \`node_modules\`, \`.git\`, and \`dist\` by default
- \`watchInterval\` auto-reindexes when set
- \`server.reindex()\` forces an immediate refresh
- HTTP/SSE transports can use \`auth\`; stdio cannot
`

export const MCP_INTELLIGENCE_GUIDE = `# MCP Intelligence Layer

MCP is the single place to discover what Raffel can do before choosing implementation details.

When you ask Raffel MCP:

- \`raffel_feature_catalog\` gives a complete feature map and points to the right paths.
- \`raffel_proxy_capabilities\` returns the protocol matrix and telemetry surface.
- \`raffel_get_guide\` resolves detailed documentation by topic.

Recommended flow:

1. Start with \`raffel_feature_catalog\` (\`scope=all\`) to map where your need sits.
2. Open implementation-specific guides with \`raffel_get_guide\`.
3. Use \`raffel_search\` for parameter-level details and examples.

This keeps users productive because discovery and execution stay aligned with the same vocabulary.

## What the MCP surface can answer

- Protocols and adapters
- Proxy modes: reverse, explicit, SOCKS5/SOCKS5h, transparent
- Flow telemetry: edges, durations, rates, and error signals
- Security and policy patterns (auth, session, filters, TLS)
- Runtime DX: bootstraps, migration patterns, testing and project scaffolding
- Documentation serving: built-in Raffel MCP, Markdown docs MCP mode, and guide routing
`

export const FEATURE_MAP_GUIDE = `# Raffel Feature Map

Raffel is one runtime with five practical surfaces:

- **Protocol Surface**: HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, UDP.
- **Proxy Surface**: edge ingress, forward proxy, SOCKS5/SOCKS5h, transparent TCP, and unified suite mode.
- **Observability Surface**: metrics, graph snapshots, tracing, and request duration/error workflows.
- **Security Surface**: authentication, sessions, TLS, access filters, and guard patterns.
- **DX Surface**: codegen, patterns, interceptors, migration helpers, and MCP-guided onboarding.

Use these entry topics:

- \`mcp-server\` for custom MCP servers over your own runtime
- \`docs-mcp\` for Markdown docs exposed as MCP
- \`proxy\` for transport and edge setup
- \`proxy-capabilities\` for matrix and capabilities
- \`proxy-observability\` for edge metrics and error rates
- \`feature-map\` for periodic team reviews
- \`mcp-intelligence\` for the MCP workflow itself
`
