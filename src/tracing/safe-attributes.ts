import type { SpanAttributes } from './types.js'

const SENSITIVE_ATTRIBUTE_KEY_PATTERN = /(?:^|[._-])(?:authorization|cookie|document|documento|cpf|cnpj|oid|password|secret|token|cache[._-]?key|api[._-]?key)(?:$|[._-])/i
const SAFE_STRING_ATTRIBUTE_KEYS = new Set([
  'cache.system',
  'db.operation.name',
  'db.system',
  'deployment.environment',
  'deployment.environment.name',
  'http.request.method',
  'http.route',
  'messaging.system',
  'network.protocol.name',
  'network.protocol.version',
  'raffel.handler.kind',
  'raffel.interceptor',
  'raffel.procedure',
  'rpc.method',
  'rpc.system',
  'service.name',
  'url.path',
  'url.scheme',
])
const SENSITIVE_ATTRIBUTE_VALUE_PATTERNS = [
  /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/,
  /(?:^|[^a-z0-9])(?:bearer|oid|token)[._:=/-]?[a-z0-9]/i,
  /^[a-f0-9]{24}$/i,
  /^[a-z0-9._-]+(?::[a-z0-9._-]+)+$/i,
  /^eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+$/i,
]

function hasSensitiveValue(value: string | number | boolean): boolean {
  if (typeof value === 'boolean') return false
  const text = String(value)
  if (text.length > 256 || /[\u0000-\u001f\u007f]/.test(text)) return true
  return SENSITIVE_ATTRIBUTE_VALUE_PATTERNS.some((pattern) => pattern.test(text))
}

/**
 * Drop attribute categories that commonly carry credentials, personal
 * identifiers, or high-cardinality cache keys. Tracing must never make the
 * application fail, so unsafe attributes are omitted rather than rejected.
 */
export function filterSensitiveSpanAttributes(attributes: SpanAttributes): SpanAttributes {
  const safe: SpanAttributes = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (SENSITIVE_ATTRIBUTE_KEY_PATTERN.test(key) || hasSensitiveValue(value)) continue
    if (typeof value === 'string' && !SAFE_STRING_ATTRIBUTE_KEYS.has(key)) continue
    safe[key] = value
  }
  return safe
}
