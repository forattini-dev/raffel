export interface GuideResource {
  topic: string
  name: string
  description: string
  content: string
}

export interface GuideCatalogEntry {
  topic: string
  name: string
  description: string
}

const GUIDE_TOPIC_ALIASES: Record<string, string> = {
  'quick-start': 'quickstart',
  'quick-start-guide': 'quickstart',
  'quick-start-doc': 'quickstart',
  mock: 'mock-server',
  'json-server': 'mock-server',
  jsonserver: 'mock-server',
  'universal-service-documentation': 'usd',
  'unified-service-documentation': 'usd',
  'unified-service-doc': 'usd',
  'universal-service-doc': 'usd',
  unified: 'usd',
  'usd-docs': 'usd',
  uds: 'usd',
  'x-usd': 'usd',
  universal: 'usd',
  proxy: 'proxy',
  'reverse-proxy': 'proxy',
  reverseproxy: 'proxy',
  'reverse-proxy-guide': 'proxy',
  'proxy-toolkit': 'proxy',
  'proxy-reverse': 'proxy',
  'reverse-proxy-toolkit': 'proxy',
  'proxy-doc': 'proxy',
  'proxy-docs': 'proxy',
  'proxy-guide': 'proxy',
  traefik: 'proxy',
  'proxy-modes': 'proxy',
  'proxy-suite': 'proxy',
  'proxy-mesh': 'proxy',
  'proxy-service-mesh': 'proxy',
  'service-mesh': 'proxy',
  'proxy-flow-metrics': 'proxy',
  'flow-metrics': 'proxy',
  'mitm-capture': 'proxy',
  'capture-replay': 'proxy',
  'proxy-capture': 'proxy',
  'proxy-replay': 'proxy',
  'proxy-telemetry': 'proxy',
  'proxy-graph': 'proxy',
  'proxy-capabilities': 'proxy-capabilities',
  'proxy-capability': 'proxy-capabilities',
  'proxy-matrix': 'proxy-capabilities',
  matrix: 'proxy-capabilities',
  'capability-matrix': 'proxy-capabilities',
  'proxy-observability': 'proxy-observability',
  'proxy-metrics': 'proxy-observability',
  'proxy-metrics-graph': 'proxy-observability',
  'graph-metrics': 'proxy-observability',
  'feature-map': 'feature-map',
  'feature-matrix': 'feature-map',
  'feature-maps': 'feature-map',
  'framework-plugin': 'framework-plugins',
  'framework-plugins': 'framework-plugins',
  'framework-runtime': 'framework-plugins',
  'runtime-plugin': 'framework-plugins',
  plugins: 'framework-plugins',
  'mcp-server': 'mcp-server',
  'build-mcp': 'mcp-server',
  'mcp-library': 'mcp-server',
  'docs-mcp': 'docs-mcp',
  'docs-server': 'docs-mcp',
  'documentation-mcp': 'docs-mcp',
  'markdown-mcp': 'docs-mcp',
  'mcp-intelligence': 'mcp-intelligence',
  'mcp-surface': 'mcp-intelligence',
  'mcp-guide': 'mcp-intelligence',
  'webhook-edge': 'webhook-edge',
  webhook: 'webhook-edge',
  'webhook-proxy': 'webhook-edge',
  mitm: 'proxy',
  socks5: 'proxy',
  socks5h: 'proxy',
  'socks5-proxy': 'proxy',
  'explicit-proxy': 'proxy',
  'transparent-proxy': 'proxy',
  'http-proxy': 'proxy',
  'https-proxy': 'proxy',
}

export function normalizeGuideTopic(topic: string): string {
  return topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function resolveGuideTopic(topic: string): string {
  const normalized = normalizeGuideTopic(topic)
  return GUIDE_TOPIC_ALIASES[normalized] || normalized
}

export function buildGuideCatalog(guides: readonly GuideResource[]): GuideCatalogEntry[] {
  return guides.map((guide) => ({
    topic: guide.topic,
    name: guide.name,
    description: guide.description,
  }))
}

export function findGuideContentByTopic(guides: readonly GuideResource[], topic: string): string | null {
  const resolvedTopic = resolveGuideTopic(topic)
  const guide = guides.find((item) => resolveGuideTopic(item.topic) === resolvedTopic)
  return guide?.content || null
}
