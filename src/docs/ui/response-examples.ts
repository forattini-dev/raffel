import { encode as encodeToon, encodeRecords as encodeToonl } from '@reddb-io/toon'

export interface SerializedResponseExample {
  name: string
  summary?: string
  language: string
  value: string
  error?: boolean
}

export type SerializedResponseExamples = Record<
  string,
  Record<string, Record<string, SerializedResponseExample[]>>
>

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'])

export function buildSerializedResponseExamples(doc: Record<string, any>): SerializedResponseExamples {
  const result: SerializedResponseExamples = {}
  for (const [path, pathItem] of Object.entries(doc.paths ?? {}) as Array<[string, any]>) {
    if (!pathItem || typeof pathItem !== 'object') continue
    for (const [method, operation] of Object.entries(pathItem) as Array<[string, any]>) {
      if (!HTTP_METHODS.has(method) || !operation || typeof operation !== 'object') continue
      const operationKey = `${method.toUpperCase()} ${path}`
      for (const [status, response] of Object.entries(operation.responses ?? {}) as Array<[string, any]>) {
        for (const [mediaType, media] of Object.entries(response?.content ?? {}) as Array<[string, any]>) {
          const examples = collectExplicitExamples(media)
          if (examples.length === 0) continue
          result[operationKey] ??= {}
          result[operationKey][status] ??= {}
          result[operationKey][status][mediaType] = examples.map(example => {
            try {
              return {
                name: example.name,
                summary: example.summary,
                language: languageForMediaType(mediaType),
                value: serializeResponseExample(mediaType, example.value),
              }
            } catch (error) {
              return {
                name: example.name,
                summary: example.summary,
                language: 'text',
                value: error instanceof Error ? error.message : String(error),
                error: true,
              }
            }
          })
        }
      }
    }
  }
  return result
}

function collectExplicitExamples(media: any): Array<{ name: string; summary?: string; value: unknown }> {
  const named = Object.entries(media?.examples ?? {}).flatMap(([name, definition]: [string, any]) => {
    if (!definition || typeof definition !== 'object' || !('value' in definition)) return []
    return [{ name, summary: definition.summary, value: definition.value }]
  })
  if (named.length > 0) return named
  if (media && 'example' in media) return [{ name: 'example', value: media.example }]
  return []
}

function serializeResponseExample(mediaType: string, value: unknown): string {
  const normalized = mediaType.toLowerCase().split(';', 1)[0].trim()
  if (normalized.includes('toonl')) {
    if (!isFlatRecordArray(value)) {
      throw new Error('TOONL examples require an explicit array of flat object records.')
    }
    return encodeToonl(value)
  }
  if (normalized.includes('toon')) return encodeToon(value as never)
  if (normalized.includes('csv')) return encodeCsv(value)
  if (normalized.includes('jsonl') || normalized.includes('ndjson')) return encodeJsonLines(value)
  if (normalized.includes('json')) return JSON.stringify(value, null, 2)
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

function languageForMediaType(mediaType: string): string {
  const normalized = mediaType.toLowerCase()
  if (normalized.includes('toon')) return 'toon'
  if (normalized.includes('csv')) return 'csv'
  if (normalized.includes('json')) return 'json'
  return 'text'
}

function encodeJsonLines(value: unknown): string {
  const records = Array.isArray(value) ? value : [value]
  return records.map(record => JSON.stringify(record)).join('\n')
}

function encodeCsv(value: unknown): string {
  const records = Array.isArray(value) ? value : [value]
  if (records.length === 0) return ''
  if (!records.every(record => record && typeof record === 'object' && !Array.isArray(record))) {
    return records.map(csvCell).join('\n')
  }
  const headers = [...new Set(records.flatMap(record => Object.keys(record as Record<string, unknown>)))]
  const rows = records.map(record => headers.map(header => csvCell((record as Record<string, unknown>)[header])).join(','))
  return [headers.map(csvCell).join(','), ...rows].join('\n')
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function isFlatRecordArray(value: unknown): value is Array<Record<string, string | number | boolean | null>> {
  return Array.isArray(value) && value.every(record =>
    record !== null &&
    typeof record === 'object' &&
    !Array.isArray(record) &&
    Object.values(record).every(field => field === null || ['string', 'number', 'boolean'].includes(typeof field))
  )
}
