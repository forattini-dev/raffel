import type { RuntimePlaygroundEntry, RuntimePlaygroundInvokeRequest } from './playground.js'

export function normalizeConnectHost(host: string | undefined): string {
  if (!host || host === '0.0.0.0' || host === '::') {
    return '127.0.0.1'
  }
  return host
}

export function toStringRecord(input: Record<string, unknown> | undefined): Record<string, string> {
  if (!input) {
    return {}
  }

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    result[key] = String(value)
  }
  return result
}

function sanitizeQueryRecord(input: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item))
      }
      continue
    }
    params.set(key, String(value))
  }
  const rendered = params.toString()
  return rendered ? `?${rendered}` : ''
}

function interpolatePath(pathname: string, params: Record<string, unknown>): string {
  let rendered = pathname
  for (const [key, value] of Object.entries(params)) {
    rendered = rendered.replaceAll(`:${key}`, encodeURIComponent(String(value)))
    rendered = rendered.replaceAll(`:${key}?`, encodeURIComponent(String(value)))
  }
  return rendered.replace(/\/:\w+\?/g, '')
}

function buildTargetUrl(
  entry: RuntimePlaygroundEntry,
  payload: RuntimePlaygroundInvokeRequest,
  options: {
    protocol?: 'http' | 'ws'
    path?: string
  } = {}
): string {
  const protocol = options.protocol ?? (entry.protocol === 'websocket' ? 'ws' : 'http')
  const host = normalizeConnectHost(entry.target.host)
  const port = entry.target.port
  const pathname = interpolatePath(options.path ?? entry.target.path ?? '/', payload.params ?? {})
  const query = sanitizeQueryRecord(toStringRecord(payload.query))
  return `${protocol}://${host}:${port}${pathname}${query}`
}

export function buildHttpUrl(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): string {
  return buildTargetUrl(entry, payload)
}

export function buildWebSocketCandidates(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): string[] {
  const candidates = [buildTargetUrl(entry, payload, { protocol: 'ws' })]
  const path = entry.target.path
  if (path) {
    const segments = path.split('/').filter(Boolean)
    if (segments.length > 1) {
      const fallbackPath = `/${segments[segments.length - 1]}`
      const fallbackUrl = buildTargetUrl(entry, payload, { protocol: 'ws', path: fallbackPath })
      if (!candidates.includes(fallbackUrl)) {
        candidates.push(fallbackUrl)
      }
    }
  }
  return candidates
}
