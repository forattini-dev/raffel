import type { MCPToolHandler } from '../types.js'
import { text } from './tool-helpers.js'

export const miscToolHandlers: Record<string, MCPToolHandler> = {
  raffel_version: async (args) => {
    const checkCompatibility = Boolean(args.checkCompatibility)

    let md = `# Raffel Version Information\n\n`
    md += `**Current Version:** 0.1.0\n`
    md += `**Node.js:** >= 18.0.0\n`
    md += `**TypeScript:** >= 5.0.0\n\n`

    if (checkCompatibility) {
      md += `## Compatible Packages\n\n`
      md += `| Package | Version | Notes |\n`
      md += `|---------|---------|-------|\n`
      md += `| zod | ^3.22.0 | Recommended validator |\n`
      md += `| yup | ^1.0.0 | Alternative validator |\n`
      md += `| joi | ^17.0.0 | Alternative validator |\n`
      md += `| @prisma/client | ^5.0.0 | Database ORM |\n`
      md += `| ioredis | ^5.0.0 | Redis client |\n`
      md += `| s3db.js | ^1.0.0 | S3-based database |\n`
      md += `| jsonwebtoken | ^9.0.0 | JWT handling |\n`
    }

    md += `\n## Features\n\n`
    md += `- Multi-protocol: HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP\n`
    md += `- Fluent builder API\n`
    md += `- Multi-validator support (Zod, Yup, Joi, Ajv, fastest-validator)\n`
    md += `- Dependency injection (Providers)\n`
    md += `- Interceptors (middleware) with composition\n`
    md += `- Streaming with backpressure\n`
    md += `- Events with delivery guarantees\n`
    md += `- Metrics (Prometheus) and Tracing (OpenTelemetry)\n`
    md += `- Pusher-like pub/sub channels\n`

    return text(md)
  },

  raffel_mock_server: async (args) => {
    const mode = String(args.mode || 'cli')
    const source = String(args.source || 'openapi.yaml')
    const standalone = args.standalone !== false
    const protocols = (args.protocols as string[]) || []
    const port = Number(args.port) || 3000

    let md = `# Raffel Mock Server\n\n`

    if (mode === 'cli') {
      md += `## CLI Usage\n\n`
      md += `The \`raffel mock\` command auto-detects the source type and starts the appropriate server.\n\n`
      md += `### From OpenAPI spec\n\n`
      md += '```bash\n'
      md += `raffel mock ${source} -p ${port}\n`
      md += '```\n\n'
      md += `### From remote URL\n\n`
      md += '```bash\n'
      md += `raffel mock https://petstore3.swagger.io/api/v3/openapi.json -p ${port}\n`
      md += '```\n\n'
      md += `### From JSON data file (json-server mode)\n\n`
      md += '```bash\n'
      md += `raffel mock db.json -p ${port}\n`
      md += '```\n\n'
      md += `### All options\n\n`
      md += '```\n'
      md += `raffel mock <source> [options]\n\n`
      md += `  -p, --port <port>       Server port (default: 3000)\n`
      md += `  --host <host>           Bind address (default: 127.0.0.1)\n`
      md += `  -d, --delay <ms>        Simulate network latency\n`
      md += `  --readonly              Disable writes (data mode)\n`
      md += `  --no-validate           Skip request validation (spec mode)\n`
      md += `  --ws                    Enable WebSocket\n`
      md += `  --jsonrpc               Enable JSON-RPC on /rpc\n`
      md += `  --id-key <field>        Record ID field (default: id)\n`
      md += `  -w, --watch             Watch file for changes\n`
      md += '```\n\n'
      md += `### Auto-detection rules\n\n`
      md += `| Content | Mode |\n`
      md += `|---------|------|\n`
      md += `| Has \`openapi\`/\`swagger\`/\`paths\` key | OpenAPI → mock responses |\n`
      md += `| Has \`operations\` key | USD → multi-protocol mock |\n`
      md += `| Object with array values | JSON data → CRUD json-server |\n`
      md += `| URL (\`http://\`/\`https://\`) | Remote fetch → spec mode |\n`
      return text(md)
    }

    if (mode === 'data') {
      md += `## JSON Server (Data Mode)\n\n`
      if (standalone) {
        md += '```typescript\n'
        md += `import { createJsonServer } from 'raffel'\n\n`
        md += `const { server, store } = await createJsonServer({\n`
        md += `  db: {\n`
        md += `    posts: [\n`
        md += `      { id: 1, title: 'Hello World', userId: 1 },\n`
        md += `    ],\n`
        md += `    users: [\n`
        md += `      { id: 1, name: 'Alice' },\n`
        md += `    ],\n`
        md += `  },\n`
        md += `  port: ${port},\n`
        if (protocols.includes('jsonrpc')) md += `  protocols: { ws: true, jsonrpc: true },\n`
        md += `})\n\n`
        md += `// HTTP REST:\n`
        md += `// GET    /posts         → list with ?_sort=&_order=&_page=&_limit=&_q=\n`
        md += `// GET    /posts/:id     → get by id\n`
        md += `// POST   /posts         → create\n`
        md += `// PUT    /posts/:id     → replace\n`
        md += `// PATCH  /posts/:id     → update\n`
        md += `// DELETE /posts/:id     → delete\n`
        md += `//\n`
        md += `// WebSocket: posts.list, posts.get, posts.create, posts.$watch (real-time)\n`
        md += '```\n'
      } else {
        md += '```typescript\n'
        md += `import { createServer, createJsonModule } from 'raffel'\n\n`
        md += `const { module, middleware, store } = createJsonModule({\n`
        md += `  posts: [{ id: 1, title: 'Hello' }],\n`
        md += `})\n\n`
        md += `const server = createServer({\n`
        md += `  port: ${port},\n`
        md += `  http: { middleware: [middleware] },\n`
        md += `})\n`
        md += `  .enableWebSocket('/ws')\n`
        md += `  .mount('', module)\n\n`
        md += `await server.start()\n`
        md += '```\n'
      }
      return text(md)
    }

    // mode === 'spec'
    md += `## OpenAPI/USD Mock Server\n\n`
    if (standalone) {
      md += '```typescript\n'
      md += `import { createMockServer } from 'raffel'\n\n`
      md += `const { server, routes } = await createMockServer({\n`
      md += `  spec: '${source}',\n`
      md += `  port: ${port},\n`
      md += `  validateRequests: true,\n`
      if (protocols.length > 0) {
        md += `  protocols: { ${protocols.map((p) => `${p}: true`).join(', ')} },\n`
      }
      md += `})\n\n`
      md += `console.log(\`Mock server with \${routes.length} routes\`)\n`
      md += '```\n'
    } else {
      md += '```typescript\n'
      md += `import { createServer, createMockModule } from 'raffel'\n\n`
      md += `const mock = createMockModule(openapiSpec)\n\n`
      md += `const server = createServer({\n`
      md += `  port: ${port},\n`
      md += `  http: { middleware: [mock.middleware] },\n`
      md += `})\n`
      if (protocols.includes('ws')) md += `  .enableWebSocket('/ws')\n`
      if (protocols.includes('jsonrpc')) md += `  .enableJsonRpc('/rpc')\n`
      md += `  .mount('', mock.module)\n\n`
      md += `await server.start()\n`
      md += '```\n'
    }

    md += `\n### Response Resolution Order\n\n`
    md += `1. \`content[application/json].example\`\n`
    md += `2. First named example under \`examples\`\n`
    md += `3. \`schema.example\`\n`
    md += `4. Generated fake data from schema\n`
    md += `\nFor mutations (POST/PUT/PATCH), request body is merged over the template.\n`

    return text(md)
  },
}
