/**
 * Raffel MCP - API Patterns Documentation
 *
 * API patterns with correct and incorrect examples for valid Raffel construction.
 */

import type { PatternDoc } from '../types.js'
import { patterns } from './patterns-data.js'

export { patterns } from './patterns-data.js'

export function getPattern(name: string): PatternDoc | undefined {
  return patterns.find((p) => p.name.toLowerCase().includes(name.toLowerCase()))
}

export function listPatterns(): PatternDoc[] {
  return patterns
}

export function searchPatterns(query: string): PatternDoc[] {
  const lowerQuery = query.toLowerCase()
  return patterns.filter(
    (p) =>
      p.name.toLowerCase().includes(lowerQuery) ||
      p.description.toLowerCase().includes(lowerQuery) ||
      p.components.some((c) => c.toLowerCase().includes(lowerQuery))
  )
}
