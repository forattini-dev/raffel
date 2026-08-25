type ConsoleDeps = {
  doc: any
  spec: any
  wsSpec: any
  graphqlSpec: any
  streamsSpec: any
  jsonrpcSpec: any
  activeProtocol: string
  endpoint: { path: string }
  data: any
  esc: (value: unknown) => string
  escapeAttr: (value: unknown) => string
  /** Try-it config `{ enabled, mode, proxyUrl, streamProxyUrl }`; when `mode === 'proxy'` SSE routes through the same-origin stream proxy. */
  tryItConfig?: any
}

/**
 * Resolve the URL an EventSource should open: the raw upstream in `direct`
 * mode, or the same-origin `-/stream` proxy (with the upstream passed as a
 * `url` query param) when the docs are configured for `proxy` mode. Routing
 * through the proxy avoids CORS and keeps the stream on the declared origin.
 */
function resolveStreamUrl(tryItConfig: any, target: string): string {
  if (tryItConfig?.mode === 'proxy' && tryItConfig.streamProxyUrl) {
    return `${tryItConfig.streamProxyUrl}?url=${encodeURIComponent(target)}`
  }
  return target
}

export function appendProtocolConsole(container: any, deps: ConsoleDeps): void {
  if (deps.activeProtocol === 'http') return
  const panel = deps.doc.createElement('div')
  panel.className = `try-it-out protocol-try-it protocol-try-it-${deps.activeProtocol}`
  const live = ['websocket', 'streams', 'jsonrpc'].includes(deps.activeProtocol)
    || (deps.activeProtocol === 'graphql' && deps.data?.kind !== 'subscription')
  panel.innerHTML = live ? renderLiveConsole(deps) : renderStarterPanel(deps)
  container.appendChild(panel)
  if (live) bindLiveConsole(panel, deps)
}

function renderLiveConsole(deps: ConsoleDeps): string {
  const payload = samplePayload(deps)
  const requestResponse = deps.activeProtocol === 'jsonrpc' || deps.activeProtocol === 'graphql'
  return `<div class="try-it-header"><span class="try-it-title">Try ${deps.esc(deps.activeProtocol)}</span></div><div class="try-it-form protocol-console protocol-console-${deps.activeProtocol}"><div class="try-it-section-title">Live console</div><label class="try-it-label">Endpoint</label><input class="try-it-input protocol-console-url" value="${deps.escapeAttr(defaultEndpoint(deps))}"><label class="try-it-label">Payload</label><textarea class="try-it-body protocol-console-payload">${deps.esc(payload)}</textarea><div class="try-it-actions"><button type="button" class="try-it-send protocol-console-run">${requestResponse ? 'Send request' : 'Connect'}</button><button type="button" class="try-it-send protocol-console-send"${requestResponse ? ' hidden' : ''}>Send payload</button></div><pre class="try-it-response-headers-pre protocol-console-log">Ready.</pre></div>`
}

function renderStarterPanel(deps: ConsoleDeps): string {
  const sample = samplePayload(deps)
  return `<div class="try-it-header"><span class="try-it-title">Try ${deps.esc(deps.activeProtocol)}</span></div><div class="try-it-form"><div class="try-it-section-title">Starter request</div><div class="md-code-wrap"><button type="button" class="copy-code-btn">Copy</button><pre class="md-code-block"><code>${deps.esc(sample)}</code></pre></div></div>`
}

function defaultEndpoint({ activeProtocol, doc, spec, wsSpec, graphqlSpec, streamsSpec, jsonrpcSpec, endpoint }: ConsoleDeps): string {
  const pageOrigin = doc?.defaultView?.location?.origin
  const base = String(spec.servers?.[0]?.url ?? pageOrigin ?? 'http://localhost:3000').replace(/\/$/, '')
  if (activeProtocol === 'websocket') return `${base.replace(/^http/, 'ws')}${wsSpec.path ?? '/ws'}`
  if (activeProtocol === 'graphql') return `${base}${graphqlSpec.endpoint ?? '/graphql'}`
  if (activeProtocol === 'streams') return `${base}/${streamsSpec.pathPrefix ?? 'streams'}/${endpoint.path}`.replace(/([^:]\/)\/+/g, '$1')
  if (activeProtocol === 'jsonrpc') return `${base}${jsonrpcSpec.endpoint ?? '/rpc'}`
  return base
}

function samplePayload({ activeProtocol, endpoint, data, spec }: ConsoleDeps): string {
  if (activeProtocol === 'websocket') return JSON.stringify({ type: 'subscribe', channel: endpoint.path, id: '1' }, null, 2)
  if (activeProtocol === 'streams') return 'EventSource connection; no request body is sent.'
  if (activeProtocol === 'jsonrpc') return JSON.stringify({ jsonrpc: '2.0', method: endpoint.path, params: data.params ?? {}, id: 1 }, null, 2)
  if (activeProtocol === 'graphql') return JSON.stringify({ query: buildGraphQLDocument(endpoint.path, data, spec) }, null, 2)
  if (activeProtocol === 'grpc') return `grpcurl ${data.serviceName}/${data.methodName}`
  if (activeProtocol === 'tcp') return `nc ${data.host ?? 'localhost'} ${data.port ?? ''}`
  return `printf '{}' | nc -u ${data.host ?? '127.0.0.1'} ${data.port ?? ''}`
}

function resolveGraphQLSchema(spec: any, schema: any): any {
  if (!schema?.$ref || typeof schema.$ref !== 'string' || !schema.$ref.startsWith('#/')) return schema
  return schema.$ref.slice(2).split('/').reduce((value: any, segment: string) => value?.[segment.replace(/~1/g, '/').replace(/~0/g, '~')], spec)
}

function graphQLExample(schema: any, spec: any): unknown {
  const resolved = resolveGraphQLSchema(spec, schema) ?? {}
  if (resolved.example !== undefined) return resolved.example
  if (resolved.default !== undefined) return resolved.default
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) return resolved.enum[0]
  if (resolved.type === 'boolean') return false
  if (resolved.type === 'integer' || resolved.type === 'number') return 0
  if (resolved.type === 'array') return [graphQLExample(resolved.items, spec)]
  if (resolved.type === 'object' || resolved.properties) {
    return Object.fromEntries(Object.entries(resolved.properties ?? {}).map(([name, value]) => [name, graphQLExample(value, spec)]))
  }
  return 'string'
}

function graphQLLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(graphQLLiteral).join(', ')}]`
  if (typeof value === 'object') return `{ ${Object.entries(value).map(([name, item]) => `${name}: ${graphQLLiteral(item)}`).join(', ')} }`
  return 'null'
}

function graphQLSelection(schema: any, spec: any, depth = 0): string[] {
  const resolved = resolveGraphQLSchema(spec, schema) ?? {}
  if (resolved.type === 'array') return graphQLSelection(resolved.items, spec, depth)
  if ((!resolved.properties || typeof resolved.properties !== 'object') && resolved.type !== 'object') return []
  if (depth >= 3) return ['__typename']
  return Object.entries(resolved.properties ?? {}).slice(0, 12).map(([name, child]) => {
    const nested = graphQLSelection(child, spec, depth + 1)
    return nested.length > 0 ? `${name} { ${nested.join(' ')} }` : name
  })
}

function buildGraphQLDocument(fieldName: string, data: any, spec: any): string {
  const kind = data.kind === 'mutation' || data.kind === 'subscription' ? data.kind : 'query'
  const safeField = String(data.field ?? fieldName).replace(/[^_0-9A-Za-z]/g, '_')
  const operationName = safeField
    .split('_')
    .filter(Boolean)
    .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') || 'Operation'
  const args: Array<[string, any]> = []
  const declaredArgs = resolveGraphQLSchema(spec, data.args)
  for (const [name, schema] of Object.entries(declaredArgs?.properties ?? {})) args.push([name, schema])
  const input = resolveGraphQLSchema(spec, data.input)
  if (input) {
    if (data.source === 'resource') args.push(['input', input])
    else for (const [name, schema] of Object.entries(input.properties ?? {})) args.push([name, schema])
  }
  if (data.pagination?.style === 'cursor') args.push(['first', { type: 'integer', default: data.pagination.defaultLimit ?? 20 }])
  if (data.pagination?.style === 'offset') {
    args.push(['limit', { type: 'integer', default: data.pagination.defaultLimit ?? 20 }])
    args.push(['offset', { type: 'integer', default: 0 }])
  }
  const uniqueArgs = [...new Map(args.map(([name, schema]) => [name, schema])).entries()]
  const argumentsText = uniqueArgs.length > 0
    ? `(${uniqueArgs.map(([name, schema]) => `${name}: ${graphQLLiteral(graphQLExample(schema, spec))}`).join(', ')})`
    : ''
  const selection = graphQLSelection(data.output, spec)
  return `${kind} ${operationName} {\n  ${safeField}${argumentsText}${selection.length > 0 ? ` {\n    ${selection.join('\n    ')}\n  }` : ''}\n}`
}

function bindLiveConsole(panel: any, deps: ConsoleDeps): void {
  const url = panel.querySelector('.protocol-console-url')
  const payload = panel.querySelector('.protocol-console-payload')
  const run = panel.querySelector('.protocol-console-run')
  const send = panel.querySelector('.protocol-console-send')
  const log = panel.querySelector('.protocol-console-log')
  let socket: any = null
  let events: any = null
  const write = (line: string) => { log.textContent = `${log.textContent === 'Ready.' ? '' : `${log.textContent}\n`}${line}` }
  run.onclick = async () => {
    try {
      if (deps.activeProtocol === 'jsonrpc' || deps.activeProtocol === 'graphql') {
        const started = Date.now()
        const response = await fetch(url.value, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload.value })
        write(`${response.status} ${response.statusText} (${Date.now() - started}ms)\n${await response.text()}`)
      } else if (deps.activeProtocol === 'websocket') {
        if (socket) { socket.close(); socket = null; run.textContent = 'Connect'; return }
        socket = new WebSocket(url.value)
        socket.onopen = () => { run.textContent = 'Disconnect'; write('connected') }
        socket.onmessage = (event: any) => write(`received ${event.data}`)
        socket.onerror = () => write('socket error')
        socket.onclose = () => { run.textContent = 'Connect'; write('closed') }
      } else {
        if (events) { events.close(); events = null; run.textContent = 'Connect'; return }
        events = new EventSource(resolveStreamUrl(deps.tryItConfig, url.value))
        events.onopen = () => { run.textContent = 'Close'; write('connected') }
        events.onmessage = (event: any) => write(`event ${event.data}`)
        events.onerror = () => write('stream error')
      }
    } catch (error) { write(String((error as Error)?.message ?? error)) }
  }
  send.onclick = () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) { write('socket is not connected'); return }
    socket.send(payload.value)
    write(`sent ${payload.value}`)
  }
}
