/**
 * Raffel MCP - Resources
 *
 * MCP resource definitions and handlers for raffel:// URIs.
 */

import type { MCPResource, MCPResourceTemplate, MCPResourceReadResult } from '../types.js'
import {
  interceptors,
  getInterceptor,
  adapters,
  getAdapter,
  patterns,
  getPattern,
  errors,
  getError,
  quickstartGuide,
  boilerplates,
  getBoilerplate,
} from '../docs/index.js'
import {
  AUTH_GUIDE,
  buildGuideCatalog,
  DOCS_MCP_GUIDE,
  FEATURE_MAP_GUIDE,
  findGuideContentByTopic,
  FRAMEWORK_PLUGINS_GUIDE,
  MCP_INTELLIGENCE_GUIDE,
  MCP_SERVER_GUIDE,
  MIGRATION_GUIDE,
  PROVIDERS_GUIDE,
  PROXY_CAPABILITIES_GUIDE,
  PROXY_GUIDE,
  PROXY_OBSERVABILITY_GUIDE,
  REST_API_GUIDE,
  resolveGuideTopic,
  SESSIONS_GUIDE,
  WEBHOOK_EDGE_GUIDE,
  type GuideResource,
  type GuideCatalogEntry,
} from '../../docs/corpus/index.js'

let GUIDE_RESOURCES: GuideResource[] = []
let GUIDE_CATALOG: GuideCatalogEntry[] = []

function refreshGuideResources(): void {
  GUIDE_RESOURCES = [
    {
      topic: 'quickstart',
      name: 'Quickstart Guide',
      description: 'Getting started with Raffel',
      content: quickstartGuide,
    },
    {
      topic: 'auth',
      name: 'Authentication Guide',
      description: 'Complete guide: Bearer JWT, API Key, OAuth2, OIDC, Sessions',
      content: AUTH_GUIDE,
    },
    {
      topic: 'sessions',
      name: 'Session Store Guide',
      description: 'Session management with memory and custom drivers (including Redis adapters)',
      content: SESSIONS_GUIDE,
    },
    {
      topic: 'providers',
      name: 'Providers (Dependency Injection)',
      description: 'Inject db/cache/config via provider factories resolved at server.start(); avoids the ESM module-load init-order footgun. Imperative server.provide() and onShutdown cleanup.',
      content: PROVIDERS_GUIDE,
    },
    {
      topic: 'rest-api',
      name: 'REST API Guide',
      description: 'Building production-ready REST APIs with CRUD, validation, and auth',
      content: REST_API_GUIDE,
    },
    {
      topic: 'migration',
      name: 'Migration Guide',
      description: 'Migrating from Express, Fastify, Fetch-first routers, ws, or Socket.IO to Raffel',
      content: MIGRATION_GUIDE,
    },
    {
      topic: 'proxy',
      name: 'Reverse Proxy Guide',
      description:
        'Run HTTP/HTTPS ingress + CONNECT/WebSocket flows and discover related explicit/SOCKS5/transparent/service mesh modes with shared observability.',
      content: PROXY_GUIDE,
    },
    {
      topic: 'proxy-capabilities',
      name: 'Proxy Capabilities Matrix',
      description: 'Mode × protocol coverage, opt-in telemetry, and shared collectors across reverse, explicit, socks5, and transparent flows.',
      content: PROXY_CAPABILITIES_GUIDE,
    },
    {
      topic: 'proxy-observability',
      name: 'Proxy Observability',
      description:
        'Edge labels, source→destination→protocol graphing, p50/p90/p95 guidance, error rates, and exported metric families.',
      content: PROXY_OBSERVABILITY_GUIDE,
    },
    {
      topic: 'mcp-server',
      name: 'Building MCP Servers',
      description:
        'Standalone createMcpServer(), integrated mcp: true mode, auth, transports, and protocol features for custom MCP servers.',
      content: MCP_SERVER_GUIDE,
    },
    {
      topic: 'framework-plugins',
      name: 'Framework Plugins',
      description:
        'Build higher-level frameworks on Raffel with ServerPlugin, lifecycle hooks, runtime inspection extensions, and a clear split between DI and runtime extension.',
      content: FRAMEWORK_PLUGINS_GUIDE,
    },
    {
      topic: 'docs-mcp',
      name: 'Documentation MCP Server',
      description:
        'Turn a Markdown docs tree or git repo into an MCP server with search, section reads, code extraction, and docs:// resources.',
      content: DOCS_MCP_GUIDE,
    },
    {
      topic: 'feature-map',
      name: 'Feature Map',
      description:
        'Raffel feature surface by area: protocols, proxy, observability, security, and production DX workflow.',
      content: FEATURE_MAP_GUIDE,
    },
    {
      topic: 'mcp-intelligence',
      name: 'MCP Intelligence Layer',
      description:
        'Use Raffel MCP to discover capabilities across docs, protocols, interceptors, codegen, and proxy telemetry before generating implementation.',
      content: MCP_INTELLIGENCE_GUIDE,
    },
    {
      topic: 'webhook-edge',
      name: 'Webhook Edge Guide',
      description:
        'Public webhook edge with createReverseProxy, TLS termination, optional token/HMAC verification, and anti-replay nonce checks.',
      content: WEBHOOK_EDGE_GUIDE,
    },
    {
      topic: 'mock-server',
      name: 'Mock Server Guide',
      description: 'Spec-driven mock server from OpenAPI/USD, JSON data server, and CLI usage',
      content: `# Mock Server

Raffel ships with two mock server modes accessible via CLI and programmatic API.

## CLI

\`\`\`bash
# From OpenAPI spec (local or remote URL)
raffel mock petstore.yaml
raffel mock https://petstore3.swagger.io/api/v3/openapi.json -p 4000

# From JSON data file (full CRUD json-server)
raffel mock db.json
raffel mock db.json --readonly --ws --jsonrpc
raffel mock db.json --watch
\`\`\`

Auto-detection: files with \`openapi\`/\`paths\` keys → spec mock; plain JSON with arrays → json-server.

## Programmatic: OpenAPI Mock

\`\`\`typescript
import { createMockServer } from 'raffel'

const { server, routes } = await createMockServer({
  spec: './openapi.yaml',
  port: 4000,
  validateRequests: true,
  protocols: { ws: true, jsonrpc: true },
})
\`\`\`

Responses resolved: example → named examples → schema.example → generated fake data.
Mutations (POST/PUT/PATCH) merge request body over template.

## Programmatic: JSON Server

\`\`\`typescript
import { createJsonServer } from 'raffel'

const { server, store } = await createJsonServer({
  db: {
    posts: [{ id: 1, title: 'Hello' }],
    users: [{ id: 1, name: 'Alice' }],
  },
  port: 3000,
})
// GET/POST/PUT/PATCH/DELETE /posts[/:id]
// WebSocket: posts.list, posts.get, posts.create, posts.$watch
\`\`\`

## Mountable Modules

Both modes support mounting into existing servers:

\`\`\`typescript
import { createServer, createMockModule, createJsonModule } from 'raffel'

const mock = createMockModule(openapiSpec)
const json = createJsonModule({ posts: [{ id: 1, title: 'Test' }] })

const server = createServer({
  port: 3000,
  http: { middleware: [mock.middleware, json.middleware] },
})
  .mount('mock', mock.module)
  .mount('data', json.module)
\`\`\`
`,
    },
    {
      topic: 'usd',
      name: 'Universal Service Documentation (USD)',
      description:
        'Unified/Universal Service Documentation for multi-protocol metadata (HTTP, WebSocket, gRPC, JSON-RPC, streams, TCP, UDP), with JSON/YAML exports.',
      content: `# Universal Service Documentation (USD)

USD (Universal Service Documentation) is Raffel's protocol-agnostic API documentation format.

It extends OpenAPI 3.1 with the \`x-usd\` namespace and is designed to expose:

- HTTP routes generated from procedures and resources
- WebSocket channels and channel authorization
- Streams metadata (direction, lifecycle, message contracts)
- JSON-RPC method definitions
- gRPC services and method descriptors
- TCP/UDP protocol-specific configuration

Enable in your server:

\`\`\`typescript
server.enableUSD({ 
  info: { title: 'My API', version: '1.0.0' },
  protocols: ['http', 'websocket'],
  contentTypes: { default: 'application/json' },
})
\`\`\`

Useful endpoints:

- \`GET /docs\` - UI
- \`GET /docs/usd.json\` - Raw USD document
- \`GET /docs/usd.yaml\` - YAML USD document

Use USD docs to make your API discoverable across HTTP/WebSocket/gRPC/JSON-RPC/streams from a single canonical format.
`,
    },
  ]

  GUIDE_CATALOG = buildGuideCatalog(GUIDE_RESOURCES)
}

function ensureGuideResourcesInitialized(): void {
  if (GUIDE_RESOURCES.length === 0) {
    refreshGuideResources()
  }
}

export function listGuides(): GuideResource[] {
  ensureGuideResourcesInitialized()
  return GUIDE_RESOURCES.map((guide) => ({ ...guide }))
}

export function getGuideCatalog(): { topic: string; name: string; description: string }[] {
  ensureGuideResourcesInitialized()
  return GUIDE_CATALOG.map((guide) => ({ ...guide }))
}

export function getGuideContentByTopic(topic: string): string | null {
  ensureGuideResourcesInitialized()
  return findGuideContentByTopic(GUIDE_RESOURCES, topic)
}

// === Static Resources ===

export function getStaticResources(): MCPResource[] {
  const resources: MCPResource[] = []
  ensureGuideResourcesInitialized()

  // Guides
  for (const guide of GUIDE_RESOURCES) {
    resources.push({
      uri: `raffel://guide/${guide.topic}`,
      name: guide.name,
      description: guide.description,
      mimeType: 'text/markdown',
    })
  }

  // Interceptors
  for (const i of interceptors) {
    resources.push({
      uri: `raffel://interceptor/${i.name}`,
      name: i.name,
      description: i.description.slice(0, 100),
      mimeType: 'text/markdown',
    })
  }

  // Adapters
  for (const a of adapters) {
    resources.push({
      uri: `raffel://adapter/${a.name.toLowerCase()}`,
      name: `${a.name} Adapter`,
      description: a.description.slice(0, 100),
      mimeType: 'text/markdown',
    })
  }

  // Patterns
  for (const p of patterns) {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    resources.push({
      uri: `raffel://pattern/${slug}`,
      name: p.name,
      description: p.description.slice(0, 100),
      mimeType: 'text/markdown',
    })
  }

  // Errors
  for (const e of errors) {
    resources.push({
      uri: `raffel://error/${e.code}`,
      name: e.code,
      description: e.message,
      mimeType: 'text/markdown',
    })
  }

  // Boilerplates
  for (const [name, bp] of Object.entries(boilerplates)) {
    resources.push({
      uri: `raffel://boilerplate/${name}`,
      name: bp.title,
      description: bp.description,
      mimeType: 'text/markdown',
    })
  }

  // Policies (server-scoped — populated by createServer when policy is configured)
  const policySnapshot = policyProvider?.()
  if (policySnapshot && policySnapshot.length > 0) {
    resources.push({
      uri: 'raffel://policies',
      name: 'Authorization Policies',
      description: `${policySnapshot.length} loaded authorization policies`,
      mimeType: 'application/json',
    })
    for (const p of policySnapshot) {
      resources.push({
        uri: `raffel://policy/${encodeURIComponent(p.id)}`,
        name: `Policy: ${p.id}`,
        description: p.description ?? `${p.effect} ${p.actions.join(',')}`,
        mimeType: 'application/json',
      })
    }
  }

  return resources
}

// === Server-scoped policy provider ===

type PolicySnapshot = ReadonlyArray<{
  id: string
  description?: string
  effect: 'allow' | 'deny' | 'audit'
  principals: string[]
  actions: string[]
  resources: string[]
  hasCondition: boolean
  match?: unknown
}>

let policyProvider: (() => PolicySnapshot) | undefined

/**
 * Register a server-scoped policy provider so MCP discovery can list
 * `raffel://policies` and `raffel://policy/<id>` resources.
 *
 * Called by `createServer` when `policy: { ... }` is configured.
 * Pass `null` to clear (e.g. on server.stop / replacement).
 */
export function setPolicyProvider(provider: (() => PolicySnapshot) | null): void {
  policyProvider = provider ?? undefined
}

// === Resource Templates ===

export function getResourceTemplates(): MCPResourceTemplate[] {
  return [
    {
      uriTemplate: 'raffel://interceptor/{name}',
      name: 'Interceptor Documentation',
      description: 'Get documentation for a specific interceptor',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://adapter/{name}',
      name: 'Adapter Documentation',
      description: 'Get documentation for a specific protocol adapter',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://pattern/{name}',
      name: 'API Pattern',
      description: 'Get documentation for a specific API pattern',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://error/{code}',
      name: 'Error Explanation',
      description: 'Get explanation for a specific error code',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://guide/{topic}',
      name: 'Guide',
      description: 'Get a specific guide',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://boilerplate/{template}',
      name: 'Boilerplate Code',
      description: 'Get boilerplate code for a specific template',
      mimeType: 'text/markdown',
    },
  ]
}

function getGuideContent(name: string): string | null {
  const resolvedTopic = resolveGuideTopic(name)

  switch (resolvedTopic) {
    case 'quickstart':
      return quickstartGuide
    case 'auth':
      return AUTH_GUIDE
    case 'sessions':
      return SESSIONS_GUIDE
    case 'rest-api':
      return REST_API_GUIDE
    case 'migration':
      return MIGRATION_GUIDE
    case 'proxy':
      return PROXY_GUIDE
    default: {
      ensureGuideResourcesInitialized()
      return findGuideContentByTopic(GUIDE_RESOURCES, resolvedTopic)
    }
  }
}

function parseResourceUri(uri: string): { type: string; name: string } | null {
  if (!uri.startsWith('raffel://')) return null
  const path = uri.slice('raffel://'.length).replace(/^\/+/, '')
  const [type, ...parts] = path.split('/')
  if (!type) return null
  const name = parts.join('/').trim()
  // Some resource types are listings (no name segment) — `policies` is one.
  if (!name && !LISTING_RESOURCE_TYPES.has(type.toLowerCase())) return null
  return { type: type.toLowerCase(), name }
}

const LISTING_RESOURCE_TYPES = new Set(['policies'])

// === Resource Reader ===

export function readResource(uri: string): MCPResourceReadResult | null {
  const parsed = parseResourceUri(uri)
  if (!parsed) return null
  const { type, name } = parsed

  switch (type) {
    case 'guide': {
      const guideContent = getGuideContent(name)
      if (guideContent) {
        return { contents: [{ uri, mimeType: 'text/markdown', text: guideContent }] }
      }
      return null
    }

    case 'policies': {
      const snapshot = policyProvider?.()
      if (!snapshot) return null
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(snapshot, null, 2),
          },
        ],
      }
    }

    case 'policy': {
      const snapshot = policyProvider?.()
      if (!snapshot) return null
      const id = decodeURIComponent(name)
      const policy = snapshot.find((p) => p.id === id)
      if (!policy) return null
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(policy, null, 2),
          },
        ],
      }
    }

    case 'interceptor': {
      const interceptor = getInterceptor(name)
      if (!interceptor) return null

      let md = `# ${interceptor.name}\n\n`
      md += `**Category:** ${interceptor.category}\n\n`
      md += `${interceptor.description}\n\n`

      if (interceptor.options.length > 0) {
        md += `## Options\n\n`
        md += `| Name | Type | Required | Default | Description |\n`
        md += `|------|------|----------|---------|-------------|\n`
        for (const opt of interceptor.options) {
          md += `| ${opt.name} | \`${opt.type}\` | ${opt.required ? 'Yes' : 'No'} | ${opt.default || '-'} | ${opt.description} |\n`
        }
        md += '\n'
      }

      if (interceptor.examples.length > 0) {
        md += `## Examples\n\n`
        for (const ex of interceptor.examples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
        }
      }

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    case 'adapter': {
      const adapter = getAdapter(name)
      if (!adapter) return null

      let md = `# ${adapter.name} Adapter\n\n`
      md += `**Protocol:** ${adapter.protocol}\n\n`
      md += `${adapter.description}\n\n`

      if (adapter.features.length > 0) {
        md += `## Features\n\n`
        for (const f of adapter.features) {
          md += `- ${f}\n`
        }
        md += '\n'
      }

      if (adapter.options.length > 0) {
        md += `## Options\n\n`
        md += `| Name | Type | Required | Default | Description |\n`
        md += `|------|------|----------|---------|-------------|\n`
        for (const opt of adapter.options) {
          md += `| ${opt.name} | \`${opt.type}\` | ${opt.required ? 'Yes' : 'No'} | ${opt.default || '-'} | ${opt.description} |\n`
        }
        md += '\n'
      }

      if (adapter.mapping) {
        md += adapter.mapping + '\n'
      }

      if (adapter.examples.length > 0) {
        md += `## Examples\n\n`
        for (const ex of adapter.examples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
        }
      }

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    case 'pattern': {
      const pattern = getPattern(name.replace(/-/g, ' '))
      if (!pattern) return null

      let md = `# ${pattern.name}\n\n`
      md += `${pattern.description}\n\n`
      md += `**Components:** ${pattern.components.join(', ')}\n\n`
      md += `## Signature\n\n\`\`\`typescript\n${pattern.signature}\n\`\`\`\n\n`

      if (pattern.correctExamples.length > 0) {
        md += `## Correct Usage\n\n`
        for (const ex of pattern.correctExamples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
        }
      }

      if (pattern.wrongExamples.length > 0) {
        md += `## Common Mistakes (AVOID)\n\n`
        for (const ex of pattern.wrongExamples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
          if (ex.description) {
            md += `> **Why this is wrong:** ${ex.description}\n\n`
          }
        }
      }

      md += `## Why This Pattern?\n\n${pattern.why}\n`

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    case 'error': {
      const error = getError(name)
      if (!error) return null

      let md = `# ${error.code}\n\n`
      md += `**Message:** ${error.message}\n\n`
      md += `${error.description}\n\n`

      md += `## Possible Causes\n\n`
      for (const cause of error.possibleCauses) {
        md += `- ${cause}\n`
      }
      md += '\n'

      md += `## Solutions\n\n`
      for (const sol of error.solutions) {
        md += `- ${sol}\n`
      }
      md += '\n'

      if (error.examples && error.examples.length > 0) {
        md += `## Examples\n\n`
        for (const ex of error.examples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
        }
      }

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    case 'boilerplate': {
      const bp = getBoilerplate(name as 'basic-api')
      if (!bp) return null

      let md = `# ${bp.title}\n\n`
      md += `${bp.description}\n\n`

      for (const [filename, content] of Object.entries(bp.files)) {
        md += `## ${filename}\n\n`
        const ext = filename.split('.').pop()
        md += `\`\`\`${ext === 'json' ? 'json' : 'typescript'}\n${content}\n\`\`\`\n\n`
      }

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    default:
      return null
  }
}
