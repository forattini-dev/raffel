export type FeatureCatalogArea = {
  id: string
  title: string
  description: string
  topics: string[]
  tools: string[]
  docUrls: string[]
  prompts: string[]
  operationalNotes: string[]
}

export const FEATURE_CATALOG: FeatureCatalogArea[] = [
  {
    id: 'protocols',
    title: 'Protocol Layer',
    description:
      'HTTP, WebSocket, gRPC, JSON-RPC, GraphQL, TCP, and UDP all share a single runtime/contract model.',
    topics: ['quickstart', 'rest-api', 'mcp-server', 'docs-mcp', 'proxy', 'usd', 'migration'],
    tools: [
      'raffel_getting_started',
      'raffel_get_adapter',
      'raffel_api_patterns',
      'raffel_list_adapters',
      'raffel_create_server',
      'raffel_get_guide',
    ],
    docUrls: ['/protocols/http', '/protocols/websocket', '/protocols/tcp', '/protocols/udp'],
    prompts: ['create_realtime_server', 'create_grpc_service'],
    operationalNotes: [
      'One procedure model can expose multiple protocols via adapters.',
      'Use USD for single source-of-truth contracts across protocols.',
    ],
  },
  {
    id: 'proxy',
    title: 'Proxy & Edge',
    description:
      'Edge/egress/infrastructure proxies with reverse HTTP/HTTPS, explicit proxy, SOCKS5/SOCKS5h, transparent TCP, unified suite collection, and programmable middleware.',
    topics: ['proxy', 'webhook-edge', 'proxy-capabilities', 'proxy-observability', 'feature-map'],
    tools: ['raffel_get_guide', 'raffel_search', 'raffel_feature_catalog'],
    docUrls: ['/proxy/overview', '/proxy/modes', '/proxy/architecture', '/proxy/service-mesh'],
    prompts: ['add_observability', 'debug_middleware'],
    operationalNotes: [
      'Telemetry is opt-in; without telemetry, proxy overhead stays low.',
      'Middleware is also opt-in; enable it only where policy or mutation is required.',
      'For service mesh-like visibility, unify collectors across proxy modes.',
    ],
  },
  {
    id: 'observability',
    title: 'Observability & Mesh Telemetry',
    description:
      'Prometheus metrics, tracing, logs, flow snapshots, edge labels, latency percentiles, and failure rates.',
    topics: ['proxy-observability', 'proxy-capabilities', 'proxy'],
    tools: ['raffel_feature_catalog', 'raffel_proxy_capabilities', 'raffel_search'],
    docUrls: ['/observability/metrics', '/observability/tracing', '/proxy/flow-metrics'],
    prompts: ['add_observability'],
    operationalNotes: [
      'Flow-level metrics can be aggregated from createProxySuite or explicit collectors.',
      'For dashboards, use protocol/source/destination edge labels in percentiles and error-rate queries.',
    ],
  },
  {
    id: 'security',
    title: 'Security & Identity',
    description:
      'Authentication, sessioning, authorization, TLS, filters, and gateway hardening.',
    topics: ['auth', 'proxy', 'migration'],
    tools: ['raffel_get_guide', 'raffel_list_interceptors', 'raffel_get_interceptor'],
    docUrls: ['/auth/overview', '/proxy/tls', '/proxy/overview'],
    prompts: ['add_authentication', 'add_observability'],
    operationalNotes: [
      'Prefer short credential lifetimes on proxies and explicit allow-lists where possible.',
      'Keep secrets in env/secret manager; never in source control.',
    ],
  },
  {
    id: 'devx',
    title: 'DX & Production Scaffolding',
    description:
      'Scaffold, mock-first development, testability, contracts, docs, and MCP-assisted agent workflows.',
    topics: ['quickstart', 'mcp-server', 'docs-mcp', 'mock-server', 'usd'],
    tools: [
      'raffel_create_server',
      'raffel_create_module',
      'raffel_project_blueprint',
      'raffel_create_event',
      'raffel_runtime_config',
    ],
    docUrls: ['/tooling/mock-server', '/reference/mcp', '/observability', '/core/interceptors/overview'],
    prompts: ['create_rest_api', 'create_microservice', 'migrate_from_express'],
    operationalNotes: [
      'Use MCP to keep one shared vocabulary between agent prompts and production implementation.',
      'Prefer codegen tools for reproducible boilerplates; avoid hand-authored boilerplate drift.',
    ],
  },
]

export function findFeatureCatalogAreas(scope: string): FeatureCatalogArea[] {
  const normalizedScope = scope.toLowerCase()
  return normalizedScope === 'all'
    ? FEATURE_CATALOG
    : FEATURE_CATALOG.filter((item) => item.id === normalizedScope || item.title.toLowerCase().includes(normalizedScope))
}

export function listFeatureCatalogScopes(): string {
  return FEATURE_CATALOG.map((item) => item.id).join(', ')
}

export function formatFeatureCatalog(areas: readonly FeatureCatalogArea[], includePrompts: boolean): string {
  let md = '# Raffel Feature Catalog\n\n'
  md += 'Agent-first map to get from question to implementation in 3 steps.\n\n'

  for (const area of areas) {
    md += `## ${area.title}\n\n`
    md += `- **Focus:** ${area.description}\n`
    md += `- **Guides:** ${area.topics.map((topic) => `\`${topic}\``).join(', ')}\n`
    md += `- **First tools:** ${area.tools.slice(0, 3).join(', ')}\n`
    if (includePrompts) {
      md += `- **Relevant prompts:** ${area.prompts.join(', ')}\n`
    }
    md += '- **Operational note:** '
    if (area.operationalNotes[0]) {
      md += `${area.operationalNotes[0]}\n`
    }
    else {
      md += 'Check the area guide and confirm assumptions before enabling defaults.\n'
    }
    md += '\n'
  }

  md += '## How agents should use this\n\n'
  md += '- Start with `scope=all` for onboarding and architecture discovery.\n'
  md += '- Use a narrow scope (`proxy`, `observability`, `security`, etc.) and then call `raffel_get_guide`.\n'
  md += '- Pair with `raffel_search` for exact feature fragments and parameter names.\n'

  return md
}
