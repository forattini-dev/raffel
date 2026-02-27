export type MockEchoParser = 'text' | 'json' | 'urlencoded' | 'base64' | 'hex'

export interface MockEchoOptions {
  enabled?: boolean
  parser?: MockEchoParser
  maxPayloadBytes?: number
  maxJsonDepth?: number
  maxObjectKeys?: number
  stripControlChars?: boolean
  stripNullByte?: boolean
  allowPrototypeKeys?: boolean
  fallbackOnError?: string
}

export interface MockEchoResolvedPayload {
  body: string
  contentType: string
}

export interface NormalizedMockEchoOptions {
  enabled: boolean
  parser: MockEchoParser
  maxPayloadBytes: number
  maxJsonDepth: number
  maxObjectKeys: number
  stripControlChars: boolean
  stripNullByte: boolean
  allowPrototypeKeys: boolean
  fallbackOnError: string
}

const FORBIDDEN_KEYS = new Set<string>(['__proto__', 'prototype', 'constructor'])
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g
const MAX_KEY_LENGTH = 128
const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$/
const HEX_RE = /^(?:[0-9A-Fa-f]{2})*$/

const DEFAULT_MOCK_ECHO_OPTIONS: NormalizedMockEchoOptions = {
  enabled: false,
  parser: 'text',
  maxPayloadBytes: 4 * 1024,
  maxJsonDepth: 12,
  maxObjectKeys: 128,
  stripControlChars: true,
  stripNullByte: true,
  allowPrototypeKeys: false,
  fallbackOnError: 'ERR_INVALID_ECHO_PAYLOAD',
}

function sanitizeControlChars(value: string, options: NormalizedMockEchoOptions): string {
  let sanitized = value
  if (options.stripNullByte) {
    sanitized = sanitized.replace(/\u0000/g, '')
  }

  if (options.stripControlChars) {
    sanitized = sanitized.replace(CONTROL_CHARS_RE, '')
  }

  return sanitized
}

function ensurePayloadBudget(payload: string | Buffer, options: NormalizedMockEchoOptions): void {
  const size = Buffer.isBuffer(payload) ? payload.length : Buffer.byteLength(payload, 'utf8')
  if (size > options.maxPayloadBytes) {
    throw new Error(
      `Echo payload size ${size} exceeds maximum ${options.maxPayloadBytes} bytes`
    )
  }
}

function sanitizeObjectKeys(key: string, options: NormalizedMockEchoOptions): string {
  const trimmed = key.trim()
  if (trimmed.length > MAX_KEY_LENGTH) {
    return trimmed.slice(0, MAX_KEY_LENGTH)
  }

  if (!options.allowPrototypeKeys && FORBIDDEN_KEYS.has(trimmed)) {
    return ''
  }

  return sanitizeControlChars(trimmed, options)
}

function sanitizeValue(
  value: unknown,
  depth: number,
  options: NormalizedMockEchoOptions
): unknown {
  if (depth >= options.maxJsonDepth) {
    throw new Error('Echo payload depth exceeded')
  }

  if (value == null || typeof value === 'boolean' || typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    return sanitizeControlChars(value, options)
  }

  if (Array.isArray(value)) {
    const sanitizedArray = []
    const max = Math.min(value.length, options.maxObjectKeys)
    for (let index = 0; index < max; index += 1) {
      sanitizedArray.push(sanitizeValue(value[index], depth + 1, options))
    }
    return sanitizedArray
  }

  if (typeof value === 'object') {
    const sanitizedObject: Record<string, unknown> = {}
    let count = 0
    for (const [key, item] of Object.entries(value)) {
      if (count >= options.maxObjectKeys) {
        break
      }

      const sanitizedKey = sanitizeObjectKeys(key, options)
      if (!sanitizedKey) {
        continue
      }

      sanitizedObject[sanitizedKey] = sanitizeValue(item, depth + 1, options)
      count += 1
    }
    return sanitizedObject
  }

  return String(value)
}

function parseUrlEncoded(payload: string, options: NormalizedMockEchoOptions): string {
  const params = new URLSearchParams(payload)
  const data: Record<string, string> = {}
  for (const [key, value] of params.entries()) {
    const sanitizedKey = sanitizeObjectKeys(key, options)
    if (!sanitizedKey) {
      continue
    }
    data[sanitizedKey] = sanitizeControlChars(value, options)
  }

  return JSON.stringify(data)
}

export function normalizeMockEchoOptions(
  input: MockEchoOptions | boolean = false
): NormalizedMockEchoOptions {
  const raw = typeof input === 'boolean' ? { enabled: input } : input
  return {
    ...DEFAULT_MOCK_ECHO_OPTIONS,
    ...raw,
    enabled: raw.enabled ?? DEFAULT_MOCK_ECHO_OPTIONS.enabled,
    parser: raw.parser ?? DEFAULT_MOCK_ECHO_OPTIONS.parser,
    maxPayloadBytes: raw.maxPayloadBytes ?? DEFAULT_MOCK_ECHO_OPTIONS.maxPayloadBytes,
    maxJsonDepth: raw.maxJsonDepth ?? DEFAULT_MOCK_ECHO_OPTIONS.maxJsonDepth,
    maxObjectKeys: raw.maxObjectKeys ?? DEFAULT_MOCK_ECHO_OPTIONS.maxObjectKeys,
    stripControlChars: raw.stripControlChars ?? DEFAULT_MOCK_ECHO_OPTIONS.stripControlChars,
    stripNullByte: raw.stripNullByte ?? DEFAULT_MOCK_ECHO_OPTIONS.stripNullByte,
    allowPrototypeKeys: raw.allowPrototypeKeys ?? DEFAULT_MOCK_ECHO_OPTIONS.allowPrototypeKeys,
    fallbackOnError: raw.fallbackOnError ?? DEFAULT_MOCK_ECHO_OPTIONS.fallbackOnError,
  }
}

export function resolveMockEchoPayload(
  payload: string | Buffer,
  inputOptions: MockEchoOptions | boolean = false
): MockEchoResolvedPayload {
  const options = normalizeMockEchoOptions(inputOptions)
  if (!options.enabled) {
    const output = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload
    return { body: output, contentType: 'text/plain' }
  }

  const input = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
  ensurePayloadBudget(input, options)

  const text = input.toString('utf8')
  switch (options.parser) {
    case 'text': {
      return { body: sanitizeControlChars(text, options), contentType: 'text/plain' }
    }
    case 'json': {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('Invalid JSON echo payload')
      }

      return { body: JSON.stringify(sanitizeValue(parsed, 0, options)), contentType: 'application/json' }
    }
    case 'urlencoded': {
      return { body: parseUrlEncoded(text, options), contentType: 'application/json' }
    }
    case 'base64': {
      const trimmed = text.trim()
      if (!BASE64_RE.test(trimmed)) {
        throw new Error('Invalid base64 echo payload')
      }
      const decoded = Buffer.from(trimmed, 'base64')
      if (!decoded.length && trimmed.length > 0) {
        throw new Error('Invalid base64 echo payload')
      }
      return { body: sanitizeControlChars(decoded.toString('utf8'), options), contentType: 'text/plain' }
    }
    case 'hex': {
      const trimmed = text.trim()
      if (!HEX_RE.test(trimmed) || trimmed.length % 2 === 1) {
        throw new Error('Invalid hex echo payload')
      }
      return {
        body: sanitizeControlChars(Buffer.from(trimmed, 'hex').toString('utf8'), options),
        contentType: 'text/plain',
      }
    }
    default:
      throw new Error(`Unsupported echo parser "${options.parser}"`)
  }
}
