import type { USDServer } from '../usd/spec/types.js'

export interface DocsTryItRequest {
  url: string
  method: string
  headers?: Record<string, string>
  body?: unknown
}

export interface DocsTryItProxyOptions {
  servers?: USDServer[]
  allowedOrigins?: string[]
  timeoutMs?: number
  maxResponseBytes?: number
  fetchImpl?: typeof fetch
}

export async function executeDocsTryItProxy(
  payload: DocsTryItRequest,
  options: DocsTryItProxyOptions,
): Promise<Response> {
  const target = parseTarget(payload?.url)
  const allowedServers = resolveServerUrls(options.servers ?? [])
  const allowedOrigins = new Set((options.allowedOrigins ?? []).flatMap(origin => {
    const parsed = parseTarget(origin)
    return parsed ? [parsed.origin] : []
  }))
  if (!target || (!allowedOrigins.has(target.origin) && !allowedServers.some(server => isWithinServer(target, server)))) {
    return problem(403, 'Request target is not allowed', 'The documentation proxy only connects to declared API server origins.')
  }

  const method = String(payload.method ?? 'GET').toUpperCase()
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
    return problem(405, 'Request method is not allowed', `The documentation proxy does not execute ${method} requests.`)
  }
  const headers = sanitizeRequestHeaders(payload.headers ?? {})
  const body = ['GET', 'HEAD'].includes(method) || payload.body === undefined || payload.body === null
    ? undefined
    : typeof payload.body === 'string'
      ? payload.body
      : JSON.stringify(payload.body)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)
  try {
    const upstream = await (options.fetchImpl ?? fetch)(target.toString(), {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: controller.signal,
    })
    const bytes = await readBoundedBody(upstream, options.maxResponseBytes ?? 1_048_576)
    if (!bytes) return problem(413, 'Upstream response is too large', 'The response exceeded the documentation proxy limit.')
    const responseHeaders: Record<string, string> = {}
    upstream.headers.forEach((value, name) => {
      if (name.toLowerCase() !== 'set-cookie') responseHeaders[name] = value
    })
    const contentType = upstream.headers.get('content-type') ?? ''
    const textual = /(?:json|text|xml|yaml|csv|toon|javascript|x-www-form-urlencoded)/i.test(contentType)
    const response: Record<string, unknown> = {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
      body: textual ? new TextDecoder().decode(bytes) : Buffer.from(bytes).toString('base64'),
    }
    if (!textual) response.bodyEncoding = 'base64'
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    const timedOut = controller.signal.aborted
    return problem(
      timedOut ? 504 : 502,
      timedOut ? 'Upstream request timed out' : 'Upstream request failed',
      timedOut
        ? 'The declared upstream server did not respond before the configured timeout.'
        : 'The declared upstream server could not complete the request.',
    )
  } finally {
    clearTimeout(timeout)
  }
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
])

function sanitizeRequestHeaders(headers: Record<string, string>): Headers {
  const sanitized = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(normalized) || normalized.startsWith('sec-') || normalized.startsWith('proxy-')) continue
    sanitized.set(name, String(value))
  }
  return sanitized
}

async function readBoundedBody(response: Response, maximum: number): Promise<Uint8Array | null> {
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.byteLength <= maximum ? bytes : null
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maximum) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength }
  return output
}

function parseTarget(value: string): URL | null {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    return url
  } catch { return null }
}

function resolveServerUrls(servers: USDServer[]): URL[] {
  return servers.flatMap(server => {
    let urls = [server.url]
    for (const [name, variable] of Object.entries(server.variables ?? {})) {
      const values = variable.enum?.length ? variable.enum : [variable.default]
      urls = urls.flatMap(template => values.map(value => template.replaceAll(`{${name}}`, encodeURIComponent(value))))
    }
    return urls.flatMap(url => {
      const parsed = parseTarget(url)
      return parsed ? [parsed] : []
    })
  })
}

function isWithinServer(target: URL, server: URL): boolean {
  if (target.origin !== server.origin) return false
  const basePath = server.pathname.replace(/\/+$/, '') || '/'
  return basePath === '/' || target.pathname === basePath || target.pathname.startsWith(`${basePath}/`)
}

function problem(status: number, title: string, detail: string): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title, status, detail }), {
    status,
    headers: { 'Content-Type': 'application/problem+json; charset=utf-8' },
  })
}
