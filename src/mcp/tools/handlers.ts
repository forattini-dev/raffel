/**
 * Raffel MCP - Tool Handlers
 *
 * Implementation of all MCP tool handlers.
 */

import type { MCPToolHandler } from '../types.js'
import {
  searchAll,
  listInterceptors,
  getInterceptor,
  listAdapters,
  getAdapter,
  listPatterns,
  searchPatterns,
  getError,
  listErrors,
  quickstartGuide,
} from '../docs/index.js'
import { getGuideCatalog, getGuideContentByTopic } from '../resources/index.js'
import { authToolHandlers } from './auth-tool-handlers.js'
import { miscToolHandlers } from './misc-tool-handlers.js'
import { projectCodegenHandlers } from './project-codegen-handlers.js'
import { serverCodegenHandlers } from './server-codegen-handlers.js'
import { error, text, toTitleCase } from './tool-helpers.js'
import {
  findFeatureCatalogAreas,
  formatAdapter as renderAdapter,
  formatError as renderError,
  formatFeatureCatalog,
  formatInterceptor as renderInterceptor,
  formatPattern as renderPattern,
  GUIDE_GROUP_ORDER,
  listFeatureCatalogScopes,
  normalizeGuideTopic,
  resolveGuideGroup,
} from '../../docs/corpus/index.js'

// === Helper Functions ===

const SEARCH_TYPES = ['interceptor', 'adapter', 'pattern', 'error', 'guide']
const SEARCH_LIMIT_MAX = 30

function normalizeSearchLimit(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return 0
  return Math.min(parsed, SEARCH_LIMIT_MAX)
}


function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name))
}

// === Tool Handlers ===

export const handlers: Record<string, MCPToolHandler> = {
  // === Documentation Tools ===

  raffel_getting_started: async () => {
    return text(quickstartGuide)
  },

  raffel_search: async (args) => {
    const query = String(args.query || '')
    if (!query) return error('Query is required')
    const typeFilter = String(args.type || '').trim().toLowerCase()
    const limit = normalizeSearchLimit(args.limit)

    if (typeFilter && !SEARCH_TYPES.includes(typeFilter)) {
      return error(`Invalid type "${typeFilter}". Valid types: ${SEARCH_TYPES.join(', ')}`)
    }

    const results = searchAll(query).filter((r) => (typeFilter ? r.type === typeFilter : true))
    const limitedResults = limit ? results.slice(0, limit) : results

    if (limitedResults.length === 0) {
      const suggestions = [
        'Broaden the query (for example: `proxy`, `socks5h`, `flow metrics`, `error rates`).',
        'Use quotes for exact phrase search: `"Universal Service Documentation"`, `"reverse proxy"`.',
      ]
      const guideCatalog = getGuideCatalog()
      const topTopics = guideCatalog.map((guide) => guide.topic).slice(0, 6).join(', ')
      suggestions.push(`Try guides: ${topTopics}.`)
      if (typeFilter) {
        suggestions.push(`Try removing the type filter and searching for "${query}"`)
      }

      return text(
        [
          `No results found for "${query}".`,
          '',
          'Search usage tips:',
          '- **Keyword mode (default):** space-separated terms are AND-matched.',
          '- **Phrase mode:** quote exact terms with spaces.',
          '- **Type filter:** interceptor | adapter | pattern | error | guide',
          '- **Limit:** default all, max 30',
          '',
          ...suggestions.map((s) => `- ${s}`),
        ].join('\n'),
      )
    }

    let md = '# Search Results\n\n'
    md += `**Query:** ${query}\n`
    md += `**Scope:** ${typeFilter || 'all types'}\n`
    md += `**Found:** ${results.length}\n`
    if (limit) md += `**Returned:** ${limitedResults.length}\n`
    md += '\n'

    for (const type of SEARCH_TYPES) {
      const byType = limitedResults.filter((result) => result.type === type)
      if (byType.length === 0) continue
      md += `## ${toTitleCase(type)}\n`
      for (const result of byType) {
        md += `- **${result.name}**${result.category ? ` (${result.category})` : ''}\n`
        md += `  ${result.description}\n`
      }
      md += '\n'
    }

    md += '## Next calls\n'
    md += '- Open details with: `raffel_get_interceptor`, `raffel_get_adapter`, `raffel_get_guide`, `raffel_explain_error`.\n'
    md += '- Route decisions with `raffel_feature_catalog` before coding.\n'

    return text(md)
  },

  raffel_list_guides: async () => {
    const guides = getGuideCatalog()
    let md = '# Raffel Documentation Guides\n\n'
    const grouped: Record<string, typeof guides> = {}
    for (const guide of guides) {
      const group = resolveGuideGroup(guide.topic)
      if (!grouped[group]) grouped[group] = []
      grouped[group].push(guide)
    }

    for (const group of GUIDE_GROUP_ORDER) {
      const items = sortByName(grouped[group] ?? [])
      if (!items || items.length === 0) continue
      md += `## ${group}\n`
      for (const guide of items) {
        md += `- \`${guide.topic}\`: ${guide.name} — ${guide.description}\n`
      }
      md += '\n'
    }

    md += 'Use `raffel_get_guide` with the topic slug for full content.\n'
    return text(md)
  },

  raffel_get_guide: async (args) => {
    const topic = normalizeGuideTopic(String(args.topic || ''))
    if (!topic) return error('Guide topic is required')

    const guideCatalog = getGuideCatalog()
    const guideEntry = guideCatalog.find((guide) => normalizeGuideTopic(guide.topic) === topic)
    const content = getGuideContentByTopic(topic)
    if (!content) {
      const validTopics = guideCatalog.map((guide) => guide.topic).join(', ')
      return error(
        `Guide "${topic}" not found. Use raffel_list_guides for valid topics. Available: ${validTopics}`,
      )
    }

    const title = guideEntry?.name || `Guide: ${topic}`
    const description = guideEntry?.description ? `${guideEntry.description}\n\n` : ''
    const body = content.replace(/^# .+\n+/, '')
    let md = `# ${title}\n\n`
    if (description) md += `${description}\n`
    md += '## Guide body\n\n'
    md += `${body.trim()}\n`
    md += '\n## Next actions\n'
    md += '- If you need implementation details, use `raffel_search` for target terms.\n'
    md += `- If this is a proxy topic, call ` +
      '`raffel_proxy_capabilities` and `raffel_search` for follow-up details.\n'

    return text(md)
  },

  raffel_feature_catalog: async (args) => {
    const scope = String(args.scope || 'all').toLowerCase()
    const includePrompts = args.includePrompts !== false

    const allScopes = findFeatureCatalogAreas(scope)

    if (allScopes.length === 0) {
      const availableScopes = listFeatureCatalogScopes()
      return error(
        `Unknown scope "${scope}". Available: all, ${availableScopes}. Use scope "all" for every feature area.`,
      )
    }

    return text(formatFeatureCatalog(allScopes, includePrompts))
  },

  raffel_proxy_capabilities: async (args) => {
    const includeRawConfig = Boolean(args.includeRawConfig)
    const includeMetrics = args.includeMetrics !== false

    let md = '# Raffel Proxy Capability Matrix\n\n'
    md += 'Telemetry is opt-in and mode behavior is explicit.\n\n'
    md += '## Mode × Protocol Matrix\n\n'
    md += '| Capability | Reverse | Explicit | SOCKS5(SOCKS5h) | Transparent | Suite |\n'
    md += '|---|:---:|:---:|:---:|:---:|:---:|\n'
    md += '| HTTP/HTTPS ingress | ✅ | ✅ | ❌ | ❌ | ✅ |\n'
    md += '| CONNECT tunneling | ✅ | ✅ | ❌ | ❌ | ✅ |\n'
    md += '| WebSocket upgrade | ✅ | ✅ | ❌ | ❌ | ✅ |\n'
    md += '| SOCKS5 + UDP ASSOCIATE | ❌ | ❌ | ✅ | ❌ | ✅ |\n'
    md += '| TCP transparent capture | ❌ | ❌ | ❌ | ✅ | ❌ |\n'
    md += '| Shared collector/graph | optional | optional | optional | optional | ✅ |\n\n'

    md += '## Middleware surface\n\n'
    md += '- Reverse and Explicit: `http-request`, `http-response`, `connect`, `upgrade-request`, `mitm-request`, `mitm-response`\n'
    md += '- SOCKS5: `socks5-connect`, `socks5-bind`, `socks5-udp-associate`\n'
    md += '- Transparent: `transparent`\n'
    md += '- Suite: combines explicit + socks5 middleware coverage in one deployment\n\n'
    md += 'Middleware is opt-in and intended for policy engines, traffic blocking, destination rewrites, and HTTP/MITM request-response shaping.\n\n'

    md += '## Edge model used for graph analytics\n\n'
    md += 'Each edge is normalized as `source -> destination -> protocol`.\n\n'
    md += '- `source`: service, client id, tenant id, or derived identity\n'
    md += '- `destination`: upstream host/port or node name\n'
    md += '- `protocol`: one of `http`, `https`, `connect`, `ws`, `wss`, `socks5`, `socks5h`, `socks5-udp`, `socks5h-udp`, `tcp`\n\n'

    md += '## Telemetry defaults and guarantees\n\n'
    md +=
      'Nothing is emitted by default. Enable `graphEndpoint`/`metricsEndpoint` only where visibility is required.\n\n'
    md +=
      '- For realtime traffic rates and failures, enable `graphEndpoint` and/or `metricsEndpoint` where your process supports HTTP exposure.\n'
    md += '- `percentiles` can use strings (`p50`, `p90`, `p95`) or fractions (`0.5`, `0.9`, `0.95`).\n'
    md += '- Labels include source/destination/protocol by default.\n'

    if (includeMetrics) {
      md += '\n### Key exported metric families\n\n'
      md += '- `raffel_proxy_edge_requests_total`\n'
      md += '- `raffel_proxy_edge_active_flows`\n'
      md += '- `raffel_proxy_edge_errors_total`\n'
      md += '- `raffel_proxy_edge_bytes_from_source_total`\n'
      md += '- `raffel_proxy_edge_bytes_to_source_total`\n'
      md += '- `raffel_proxy_edge_request_duration_seconds` (+ `_bucket`, `_sum`, `_count`)\n'
      md += '- `raffel_proxy_edge_flow_duration_seconds` (+ `_bucket`, `_sum`, `_count`)\n'
      md += '- `raffel_proxy_edge_request_rate_per_second`\n'
      md += '- `raffel_proxy_edge_flow_rate_per_second`\n'
      md += '- `raffel_proxy_edge_error_rate_per_second`\n'
      md += '- `raffel_proxy_edge_bytes_from_source_rate_per_second`\n'
      md += '- `raffel_proxy_edge_bytes_to_source_rate_per_second`\n'
      md += '- `raffel_proxy_edge_flow_duration_quantile_seconds`\n'
      md += '- `raffel_proxy_edge_failure_ratio`\n'
    }

    md += '\n### Edge analytics examples by default field set\n\n'
    md += '- `source`, `destination`, `protocol` labels on most counters and durations.\n'
    md += '- Method and status labels are included for request counters/latencies in HTTP-like flows.\n'
    md += '- `error` label is included for sampled error counters.\n\n'

    md += '### Quick PromQL examples\n\n'
    md += '```promql\n'
    md += 'sum(rate(raffel_proxy_edge_requests_total[1m])) by (protocol, source, destination)\n'
    md += '```\n\n'
    md += '```promql\n'
    md += 'histogram_quantile(0.95, sum(rate(raffel_proxy_edge_request_duration_seconds_bucket[5m])) by (le, protocol, source, destination))\n'
    md += '```\n\n'

    if (includeRawConfig) {
      md += '## Representative snippets\n\n'
      md += '### Reverse (HTTP/HTTPS) bootstrap\n\n'
      md += '```ts\n'
      md += "const reverse = await createReverseProxy({\n"
      md += "  server: { host: '0.0.0.0', port: 8443, tls: {} },\n"
      md += "  routes: [{ match: { host: 'api.internal.local', pathPrefix: '/' }, target: 'http://127.0.0.1:4100' }],\n"
      md += '  proxy: {\n'
      md += "    telemetry: { sourceHeader: 'x-service-name', percentiles: ['p50', 'p90', 'p95'] },\n"
      md += '  },\n'
      md += '})\n```\n\n'
      md += '### Explicit + SOCKS5 suite\n\n'
      md += '```ts\n'
      md += "const suite = createProxySuite({\n"
      md += "  explicit: { host: '127.0.0.1', port: 3128 },\n"
      md += "  socks5: { host: '127.0.0.1', port: 1080 },\n"
      md += "  telemetry: { sourceHeader: 'x-service-name', percentiles: [0.5, 0.9, 0.95] },\n"
      md += '})\n```\n\n'
      md += '### Transparent capture\n\n'
      md += '```ts\n'
      md += "const transparent = createTransparentProxy({\n"
      md += "  host: '0.0.0.0',\n"
      md += '  port: 15006,\n'
      md += "  mode: 'tproxy',\n"
      md += '  telemetry: { sourceHeader: "x-service-name" },\n'
      md += '})\n```\n'
    }

    md += '\nUse `raffel_get_guide` with `proxy`, `proxy-observability`, or `proxy-capabilities` for deeper production tuning guides.\n'
    return text(md)
  },

  raffel_list_interceptors: async (args) => {
    const category = args.category as string | undefined
    const interceptors = listInterceptors(category)

    let md = `# Raffel Interceptors`
    if (category) md += ` (${category})`
    md += '\n\n'

    const byCategory = new Map<string, typeof interceptors>()
    const categoryOrder = ['auth', 'resilience', 'observability', 'validation', 'caching', 'composition']
    for (const i of interceptors) {
      const cat = i.category
      if (!byCategory.has(cat)) byCategory.set(cat, [])
      byCategory.get(cat)!.push(i)
    }

    const categories = [
      ...categoryOrder.filter((cat) => byCategory.has(cat)),
      ...[...byCategory.keys()].filter((cat) => !categoryOrder.includes(cat)).sort(),
    ]

    for (const cat of categories) {
      const items = byCategory.get(cat)!
      md += `## ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n\n`
      for (const i of sortByName(items)) {
        md += `- **${i.name}**: ${i.description.slice(0, 100)}...\n`
      }
      md += '\n'
    }

    md += `\n---\nUse \`raffel_get_interceptor\` with the name to get detailed documentation.`

    return text(md)
  },

  raffel_get_interceptor: async (args) => {
    const name = String(args.name || '')
    if (!name) return error('Interceptor name is required')

    const interceptor = getInterceptor(name)
    if (!interceptor) {
      const all = listInterceptors()
      const names = all.map((i) => i.name).join(', ')
      return error(`Interceptor "${name}" not found. Available: ${names}`)
    }

    return text(renderInterceptor(interceptor))
  },

  raffel_list_adapters: async () => {
    const adapters = listAdapters()

    let md = `# Raffel Protocol Adapters\n\n`
    md += `Adapters translate between protocols and the Raffel envelope format.\n\n`

    for (const a of adapters) {
      md += `## ${a.name}\n`
      md += `**Protocol:** ${a.protocol}\n\n`
      md += `${a.description}\n\n`
      md += `**Features:** ${a.features.slice(0, 3).join(', ')}...\n\n`
    }

    md += `\n---\nUse \`raffel_get_adapter\` with the name to get detailed documentation.`

    return text(md)
  },

  raffel_get_adapter: async (args) => {
    const name = String(args.name || '')
    if (!name) return error('Adapter name is required')

    const adapter = getAdapter(name)
    if (!adapter) {
      const all = listAdapters()
      const names = all.map((a) => a.name).join(', ')
      return error(`Adapter "${name}" not found. Available: ${names}`)
    }

    return text(renderAdapter(adapter))
  },

  raffel_api_patterns: async (args) => {
    const pattern = args.pattern as string | undefined
    const patterns = pattern ? searchPatterns(pattern) : listPatterns()

    if (patterns.length === 0) {
      return error(`No patterns found for "${pattern}". Try: server, handler, stream, middleware`)
    }

    if (patterns.length === 1 || pattern) {
      // Return detailed view
      return text(patterns.map(renderPattern).join('\n\n---\n\n'))
    }

    // Return list
    let md = `# Raffel API Patterns\n\n`
    md += `These patterns show the canonical way to construct Raffel code.\n\n`

    for (const p of patterns) {
      md += `## ${p.name}\n`
      md += `${p.description.slice(0, 150)}...\n\n`
      md += `**Components:** ${p.components.join(', ')}\n\n`
    }

    md += `\n---\nUse \`raffel_api_patterns\` with pattern name to get detailed documentation with examples.`

    return text(md)
  },

  raffel_explain_error: async (args) => {
    const code = String(args.code || '').toUpperCase()
    if (!code) return error('Error code is required')

    const err = getError(code)
    if (!err) {
      const all = listErrors()
      const codes = all.map((e) => e.code).join(', ')
      return error(`Error code "${code}" not found. Available: ${codes}`)
    }

    return text(renderError(err))
  },

  // === Code Generation Tools ===

  ...serverCodegenHandlers,
  ...projectCodegenHandlers,
  ...authToolHandlers,
  ...miscToolHandlers,

}
