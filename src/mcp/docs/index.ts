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
  type: 'interceptor' | 'adapter' | 'pattern' | 'error'
  name: string
  description: string
  category?: string
}

export function searchAll(query: string): SearchResult[] {
  const lowerQuery = query.toLowerCase()
  const results: SearchResult[] = []

  // Search interceptors
  for (const i of interceptors) {
    if (
      i.name.toLowerCase().includes(lowerQuery) ||
      i.description.toLowerCase().includes(lowerQuery)
    ) {
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
    if (
      a.name.toLowerCase().includes(lowerQuery) ||
      a.description.toLowerCase().includes(lowerQuery) ||
      a.protocol.toLowerCase().includes(lowerQuery)
    ) {
      results.push({
        type: 'adapter',
        name: a.name,
        description: a.description,
      })
    }
  }

  // Search patterns
  for (const p of patterns) {
    if (
      p.name.toLowerCase().includes(lowerQuery) ||
      p.description.toLowerCase().includes(lowerQuery) ||
      p.components.some((c) => c.toLowerCase().includes(lowerQuery))
    ) {
      results.push({
        type: 'pattern',
        name: p.name,
        description: p.description,
      })
    }
  }

  // Search errors
  for (const e of errors) {
    if (
      e.code.toLowerCase().includes(lowerQuery) ||
      e.message.toLowerCase().includes(lowerQuery) ||
      e.description.toLowerCase().includes(lowerQuery)
    ) {
      results.push({
        type: 'error',
        name: e.code,
        description: e.message,
      })
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
    s3db: 'S3DB Resource Adapter',
  },
}
