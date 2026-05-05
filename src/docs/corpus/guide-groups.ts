const GUIDE_GROUP_LABELS: Record<string, string> = {
  quickstart: 'Foundation',
  auth: 'Foundation',
  sessions: 'Foundation',
  'rest-api': 'Foundation',
  migration: 'Foundation',
  'mock-server': 'Foundation',
  usd: 'Foundation',
  'mcp-server': 'Operations',
  'docs-mcp': 'Operations',
  proxy: 'Proxy & Mesh',
  'webhook-edge': 'Proxy & Mesh',
  'proxy-capabilities': 'Proxy & Mesh',
  'proxy-observability': 'Proxy & Mesh',
  'feature-map': 'Operations',
  'mcp-intelligence': 'Operations',
}

export const GUIDE_GROUP_ORDER = ['Foundation', 'Proxy & Mesh', 'Operations', 'Advanced']

export function resolveGuideGroup(topic: string): string {
  return GUIDE_GROUP_LABELS[topic] || (topic.startsWith('proxy') ? 'Proxy & Mesh' : 'Advanced')
}
