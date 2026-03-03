/**
 * Raffel MCP - Documentation Index
 *
 * Central export for all documentation modules.
 */

// Interceptors
export {
  interceptors,
  interceptorsByCategory,
  getInterceptor,
  listInterceptors,
} from './interceptors.js'

// Adapters
export { adapters, getAdapter, listAdapters } from './adapters.js'

// Patterns (CRITICAL for code generation)
export { patterns, getPattern, listPatterns, searchPatterns } from './patterns.js'

// Errors
export { errors, getError, listErrors, searchErrors } from './errors.js'

// Quickstart & Boilerplates
export { quickstartGuide, boilerplates, getBoilerplate, listBoilerplates } from './quickstart.js'

// Re-export types
export type {
  ComponentDoc,
  PropDoc,
  MethodDoc,
  ExampleDoc,
  InterceptorDoc,
  AdapterDoc,
  PatternDoc,
  HookDoc,
  GuideDoc,
  RaffelErrorDoc,
} from '../types.js'

// All documentation combined for search
import { interceptors } from './interceptors.js'
import { adapters } from './adapters.js'
import { patterns } from './patterns.js'
import { errors } from './errors.js'

export interface SearchResult {
  type: 'interceptor' | 'adapter' | 'pattern' | 'error' | 'guide'
  name: string
  description: string
  category?: string
}

interface ParsedSearchQuery {
  phrases: string[]
  keywords: string[]
}

function parseSearchQuery(query: string): ParsedSearchQuery {
  const normalizedQuery = query.toLowerCase().trim()
  const phraseRegex = /"([^"]+)"/g
  const phrases = Array.from(normalizedQuery.matchAll(phraseRegex), (match) =>
    match[1].trim(),
  ).filter(Boolean)

  const withoutQuotedText = normalizedQuery.replace(phraseRegex, ' ')
  const keywords = withoutQuotedText
    .replace(/[^a-z0-9_-]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1)

  return {phrases, keywords}
}

function matchesSearchTarget(text: string, query: ParsedSearchQuery): boolean {
  const haystack = text.toLowerCase()

  if (query.phrases.length > 0 && !query.phrases.every((phrase) => haystack.includes(phrase))) {
    return false
  }

  if (query.keywords.length === 0) {
    return query.phrases.length > 0
  }

  return query.keywords.every((keyword) => haystack.includes(keyword))
}

function isMatch(itemName: string, itemDescription: string, query: ParsedSearchQuery): boolean {
  const target = `${itemName} ${itemDescription}`
  return matchesSearchTarget(target, query)
}

const docsGuideIndex = [
  {
    type: 'guide' as const,
    name: 'USD / Universal Service Documentation',
    description:
      'Universal Service Documentation (USD, also called Unified Service Documentation and USD alias) extends OpenAPI 3.1 with x-usd extensions to document HTTP, WebSocket, streams, JSON-RPC, gRPC, TCP and UDP behavior in a single output. Enable it with server.enableUSD({ ... }) and inspect /docs, /docs/usd.json and /docs/usd.yaml for schema and route descriptions.',
    category: 'documentation',
  },
  {
    type: 'guide' as const,
    name: 'USD output formats',
    description:
      'USD provides machine-readable docs plus richer protocol metadata, including schemas, content types, channels, stream directions, method signatures, and protocol-specific defaults for reuse across clients and AI-assisted development.',
    category: 'documentation',
  },
  {
    type: 'guide' as const,
    name: 'Route & Schema Documentation (OpenAPI + USD)',
    description:
      'Need better route documentation, schema descriptions, or OpenAPI output? Use Universal Service Documentation to document route metadata, input/output schemas, and protocol behavior in one place before generating OpenAPI/Swagger outputs.',
    category: 'documentation',
  },
]

export function searchAll(query: string): SearchResult[] {
  const parsedQuery = parseSearchQuery(query)
  const results: SearchResult[] = []

  // Search interceptors
  for (const i of interceptors) {
    if (isMatch(i.name, i.description, parsedQuery)) {
      results.push({
        type: 'interceptor',
        name: i.name,
        description: i.description,
        category: i.category,
      })
    }
  }

  // Search adapters
  for (const a of adapters) {
    const adapterText = `${a.name} ${a.description} ${a.protocol}`
    if (matchesSearchTarget(adapterText, parsedQuery)) {
      results.push({
        type: 'adapter',
        name: a.name,
        description: a.description,
      })
    }
  }

  // Search patterns
  for (const p of patterns) {
    const patternText = `${p.name} ${p.description} ${p.components.join(' ')}`
    if (matchesSearchTarget(patternText, parsedQuery)) {
      results.push({
        type: 'pattern',
        name: p.name,
        description: p.description,
      })
    }
  }

  // Search errors
  for (const e of errors) {
    const errorText = `${e.code} ${e.message} ${e.description}`
    if (matchesSearchTarget(errorText, parsedQuery)) {
      results.push({
        type: 'error',
        name: e.code,
        description: e.message,
      })
    }
  }

  for (const guide of docsGuideIndex) {
    if (isMatch(guide.name, guide.description, parsedQuery)) {
      results.push(guide)
    }
  }

  return results
}

// Categories for listing
export const categories = {
  interceptors: {
    auth: 'Authentication & Authorization',
    resilience: 'Resilience & Error Handling',
    observability: 'Metrics, Logging & Tracing',
    validation: 'Input/Output Validation',
    caching: 'Caching & Deduplication',
    composition: 'Middleware Composition',
  },
  adapters: {
    http: 'HTTP/REST',
    websocket: 'WebSocket',
    grpc: 'gRPC',
    jsonrpc: 'JSON-RPC',
    graphql: 'GraphQL',
    tcp: 'TCP',
  },
}
