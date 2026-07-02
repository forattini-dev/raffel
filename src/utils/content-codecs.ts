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

// ─────────────────────────────────────────────────────────────────────────────
// XML Codec
// ─────────────────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function unescapeXmlText(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim()
}

function xmlLeafToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  return JSON.stringify(value)
}

/**
 * Serializes a JS value into an XML element.
 *
 * Arrays are expanded as repeated `<item>` children so decode can tell a
 * single-key object apart from a single-element array. This is lossy for
 * empty arrays (indistinguishable from null/undefined) and for objects that
 * happen to have a property literally named "item".
 */
function encodeXmlElement(tag: string, value: unknown): string {
  if (value === null || value === undefined) {
    return `<${tag}/>`
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return `<${tag}/>`
    const items = value.map((item) => encodeXmlElement('item', item)).join('')
    return `<${tag}>${items}</${tag}>`
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) return `<${tag}/>`
    const inner = keys.map((key) => encodeXmlElement(key, value[key])).join('')
    return `<${tag}>${inner}</${tag}>`
  }

  const text = xmlLeafToString(value)
  if (text === '') return `<${tag}/>`
  return `<${tag}>${escapeXmlText(text)}</${tag}>`
}

function stringifyXml(value: unknown): string {
  return encodeXmlElement('root', value)
}

interface XmlNode {
  tag: string
  children: XmlNode[]
  text: string
}

function parseXmlElement(input: string, start: number): { node: XmlNode; pos: number } {
  let pos = start + 1 // consume '<'
  const tagStart = pos
  while (pos < input.length && !/[\s/>]/.test(input[pos]!)) pos += 1
  const tag = input.slice(tagStart, pos)

  while (pos < input.length && input[pos] !== '>' && !(input[pos] === '/' && input[pos + 1] === '>')) {
    pos += 1
  }

  if (input[pos] === '/' && input[pos + 1] === '>') {
    return { node: { tag, children: [], text: '' }, pos: pos + 2 }
  }

  pos += 1 // consume '>'
  const node: XmlNode = { tag, children: [], text: '' }
  let textBuffer = ''

  while (pos < input.length) {
    if (input.startsWith('</', pos)) {
      const end = input.indexOf('>', pos)
      pos = end === -1 ? input.length : end + 1
      break
    }
    if (input[pos] === '<') {
      if (input.startsWith('<!--', pos)) {
        const end = input.indexOf('-->', pos)
        pos = end === -1 ? input.length : end + 3
        continue
      }
      const parsed = parseXmlElement(input, pos)
      node.children.push(parsed.node)
      pos = parsed.pos
      continue
    }
    textBuffer += input[pos]
    pos += 1
  }

  node.text = unescapeXmlText(textBuffer)
  return { node, pos }
}

function xmlNodeToValue(node: XmlNode): unknown {
  if (node.children.length === 0) {
    return node.text === '' ? null : node.text
  }

  if (node.children.length > 1) {
    const tags = new Set(node.children.map((child) => child.tag))
    if (tags.size === 1) {
      return node.children.map(xmlNodeToValue)
    }
  } else if (node.children[0]!.tag === 'item') {
    return [xmlNodeToValue(node.children[0]!)]
  }

  const obj: Record<string, unknown> = {}
  for (const child of node.children) {
    const value = xmlNodeToValue(child)
    if (Object.prototype.hasOwnProperty.call(obj, child.tag)) {
      const existing = obj[child.tag]
      obj[child.tag] = Array.isArray(existing) ? [...existing, value] : [existing, value]
    } else {
      obj[child.tag] = value
    }
  }
  return obj
}

function parseXml(body: string): unknown {
  let pos = 0
  const skipWhitespace = () => {
    while (pos < body.length && /\s/.test(body[pos]!)) pos += 1
  }

  skipWhitespace()
  while (body.startsWith('<?', pos) || body.startsWith('<!', pos)) {
    const end = body.indexOf('>', pos)
    pos = end === -1 ? body.length : end + 1
    skipWhitespace()
  }

  if (body[pos] !== '<') {
    throw new SyntaxError('Invalid XML: expected an element')
  }

  const { node } = parseXmlElement(body, pos)
  return xmlNodeToValue(node)
}

export const xmlCodec: Codec = {
  name: 'xml',
  contentTypes: ['application/xml', 'text/xml'],
  encode: (value: unknown) => stringifyXml(value),
  decode: (body: string) => parseXml(body),
}

// ─────────────────────────────────────────────────────────────────────────────
// TOON Codec (opt-in adapter for @toon-format/toon)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal shape of the `@toon-format/toon` package's `encode`/`decode`
 * exports. Raffel never imports `@toon-format/toon` itself — the caller
 * installs it and passes it in, same pattern as the zod/yup/joi validation
 * adapters.
 */
export interface ToonEncoder {
  encode: (value: unknown, options?: Record<string, unknown>) => string
  decode: (input: string, options?: Record<string, unknown>) => unknown
}

export interface ToonCodecOptions {
  /** Content types this codec should match on the Accept/Content-Type headers. */
  contentTypes?: string[]
  /** Options forwarded to `toon.encode()`. */
  encodeOptions?: Record<string, unknown>
  /** Options forwarded to `toon.decode()`. */
  decodeOptions?: Record<string, unknown>
}

/**
 * Creates a TOON (Token-Oriented Object Notation) codec for use with
 * `resolveCodecs()`. Requires the optional peer dependency `@toon-format/toon`.
 *
 * @example
 * ```ts
 * import { encode, decode } from '@toon-format/toon'
 * import { createToonCodec, resolveCodecs } from 'raffel'
 *
 * const codecs = resolveCodecs([createToonCodec({ encode, decode })])
 * ```
 */
export function createToonCodec(toon: ToonEncoder, options: ToonCodecOptions = {}): Codec {
  const contentTypes = options.contentTypes ?? ['application/toon', 'text/toon']
  return {
    name: 'toon',
    contentTypes,
    encode: (value: unknown) => toon.encode(value, options.encodeOptions),
    decode: (body: string) => toon.decode(body, options.decodeOptions),
  }
}

export const defaultCodecs: Codec[] = [jsonCodec, textCodec, csvCodec, xmlCodec]

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
