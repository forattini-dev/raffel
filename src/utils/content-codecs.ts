export interface Codec {
  name: string
  contentTypes: string[]
  encode: (value: unknown) => string
  decode: (body: string) => unknown
}

function normalizeMediaType(value: string): string {
  return value.split(';')[0].trim().toLowerCase()
}

function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === '*/*') return true
  if (!pattern.includes('*')) return pattern === value
  const [start, end] = pattern.split('*')
  return value.startsWith(start) && value.endsWith(end)
}

export function selectCodecForContentType(
  contentType: string | undefined,
  codecs: Codec[]
): Codec | null {
  if (!contentType) return null
  const mediaType = normalizeMediaType(contentType)
  for (const codec of codecs) {
    if (codec.contentTypes.some((type) => matchesPattern(type, mediaType))) {
      return codec
    }
  }
  return null
}

export function selectCodecForAccept(
  accept: string | undefined,
  codecs: Codec[],
  fallback: Codec
): Codec | null {
  if (!accept) return fallback
  const ranges = accept.split(',').map((part) => normalizeMediaType(part))
  for (const range of ranges) {
    for (const codec of codecs) {
      if (codec.contentTypes.some((type) => matchesPattern(range, type) || matchesPattern(type, range))) {
        return codec
      }
    }
  }
  return null
}

function parseCsvRow(row: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < row.length; i += 1) {
    const char = row[i]

    if (char === '"') {
      const next = row[i + 1]
      if (inQuotes && next === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }

    current += char
  }

  values.push(current)
  return values
}

function parseCsv(body: string): Array<Record<string, string>> {
  const rows = body
    .split(/\r?\n/)
    .map((row) => row.trim())
    .filter((row) => row.length > 0)

  if (rows.length === 0) return []

  const headers = parseCsvRow(rows[0]).map((header) => header.trim())
  const hasHeader = headers.some((header) => header.length > 0)
  if (!hasHeader) {
    throw new Error('CSV header row is required')
  }

  const records: Array<Record<string, string>> = []
  for (const row of rows.slice(1)) {
    const values = parseCsvRow(row)
    const record: Record<string, string> = {}
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i]
      if (!key) continue
      record[key] = values[i] ?? ''
    }
    records.push(record)
  }

  return records
}

function escapeCsvValue(value: string): string {
  if (value.includes('"')) {
    value = value.replace(/"/g, '""')
  }
  if (value.includes(',') || value.includes('\n') || value.includes('\r') || value.includes('"')) {
    return `"${value}"`
  }
  return value
}

function stringifyCsv(value: unknown): string {
  if (value === null || value === undefined) return ''

  const rows: Array<Record<string, unknown>> = []
  const headers: string[] = []

  const addHeader = (key: string) => {
    if (!headers.includes(key)) {
      headers.push(key)
    }
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return ''
    if (value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
      for (const item of value as Array<Record<string, unknown>>) {
        for (const key of Object.keys(item)) {
          addHeader(key)
        }
        rows.push(item)
      }
    } else {
      addHeader('value')
      for (const item of value) {
        rows.push({ value: item })
      }
    }
  } else if (typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      addHeader(key)
    }
    rows.push(value as Record<string, unknown>)
  } else {
    addHeader('value')
    rows.push({ value })
  }

  if (headers.length === 0) return ''

  const lines: string[] = []
  lines.push(headers.map(escapeCsvValue).join(','))

  for (const row of rows) {
    const line = headers.map((header) => {
      const cell = row[header]
      if (cell === null || cell === undefined) return ''
      if (typeof cell === 'string') return escapeCsvValue(cell)
      if (typeof cell === 'number' || typeof cell === 'boolean' || typeof cell === 'bigint') {
        return escapeCsvValue(String(cell))
      }
      return escapeCsvValue(JSON.stringify(cell))
    })
    lines.push(line.join(','))
  }

  return lines.join('\n')
}

export const jsonCodec: Codec = {
  name: 'json',
  contentTypes: ['application/json', 'application/*+json'],
  encode: (value: unknown) => JSON.stringify(value),
  decode: (body: string) => JSON.parse(body),
}

export const csvCodec: Codec = {
  name: 'csv',
  contentTypes: ['text/csv'],
  encode: (value: unknown) => stringifyCsv(value),
  decode: (body: string) => parseCsv(body),
}

export const textCodec: Codec = {
  name: 'text',
  contentTypes: ['text/plain', 'application/graphql'],
  encode: (value: unknown) => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    return JSON.stringify(value)
  },
  decode: (body: string) => body,
}

export const defaultCodecs: Codec[] = [jsonCodec, textCodec, csvCodec]

export function resolveCodecs(codecs?: Codec[], fallback: Codec[] = defaultCodecs): Codec[] {
  if (!codecs || codecs.length === 0) return fallback

  const resolved: Codec[] = []
  const seen = new Set<string>()

  const add = (codec: Codec) => {
    const key = codec.name.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    resolved.push(codec)
  }

  for (const codec of codecs) {
    add(codec)
  }
  for (const codec of fallback) {
    add(codec)
  }

  return resolved
}
