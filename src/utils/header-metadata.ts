import type { IncomingHttpHeaders } from 'node:http'

const STANDARD_METADATA_HEADERS = new Set([
  'authorization',
  'x-request-id',
  'traceparent',
  'tracestate',
  'content-type',
  'accept',
  'cookie',
])

function normalizeMetadataValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => normalizeMetadataValue(item))
      .filter((item): item is string => item !== undefined)
    return parts.length ? parts.join(',') : undefined
  }
  return undefined
}

function shouldIncludeHeader(key: string): boolean {
  return key.startsWith('x-') || STANDARD_METADATA_HEADERS.has(key)
}

export function extractMetadataFromHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const metadata: Record<string, string> = {}

  for (const [key, value] of Object.entries(headers)) {
    const normalizedKey = key.toLowerCase()
    if (!shouldIncludeHeader(normalizedKey)) continue
    const normalizedValue = normalizeMetadataValue(value)
    if (normalizedValue === undefined) continue
    metadata[normalizedKey] = normalizedValue
  }

  return metadata
}

export function extractMetadataFromRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {}

  const metadata: Record<string, string> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase()
    if (!shouldIncludeHeader(normalizedKey)) continue
    const normalizedValue = normalizeMetadataValue(value)
    if (normalizedValue === undefined) continue
    metadata[normalizedKey] = normalizedValue
  }

  return metadata
}

export function sanitizeMetadataRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') return {}

  const metadata: Record<string, string> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedValue = normalizeMetadataValue(value)
    if (normalizedValue === undefined) continue
    metadata[key.toLowerCase()] = normalizedValue
  }

  return metadata
}

export function mergeMetadata(...sources: Array<Record<string, string> | undefined>): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const source of sources) {
    if (!source) continue
    for (const [key, value] of Object.entries(source)) {
      merged[key.toLowerCase()] = value
    }
  }
  return merged
}
