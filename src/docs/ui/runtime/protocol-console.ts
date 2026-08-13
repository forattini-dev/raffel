type ConsoleDeps = {
  doc: any
  spec: any
  wsSpec: any
  streamsSpec: any
  jsonrpcSpec: any
  activeProtocol: string
  endpoint: { path: string }
  data: any
  esc: (value: unknown) => string
  escapeAttr: (value: unknown) => string
}

export function appendProtocolConsole(container: any, deps: ConsoleDeps): void {
  if (deps.activeProtocol === 'http') return
  const panel = deps.doc.createElement('div')
  panel.className = `try-it-out protocol-try-it protocol-try-it-${deps.activeProtocol}`
  const live = ['websocket', 'streams', 'jsonrpc'].includes(deps.activeProtocol)
  panel.innerHTML = live ? renderLiveConsole(deps) : renderStarterPanel(deps)
  container.appendChild(panel)
  if (live) bindLiveConsole(panel, deps)
}

function renderLiveConsole(deps: ConsoleDeps): string {
  const payload = samplePayload(deps)
  return `<div class="try-it-header"><span class="try-it-title">Try ${deps.esc(deps.activeProtocol)}</span></div><div class="try-it-form protocol-console protocol-console-${deps.activeProtocol}"><div class="try-it-section-title">Live console</div><label class="try-it-label">Endpoint</label><input class="try-it-input protocol-console-url" value="${deps.escapeAttr(defaultEndpoint(deps))}"><label class="try-it-label">Payload</label><textarea class="try-it-body protocol-console-payload">${deps.esc(payload)}</textarea><div class="try-it-actions"><button type="button" class="try-it-send protocol-console-run">${deps.activeProtocol === 'jsonrpc' ? 'Send request' : 'Connect'}</button><button type="button" class="try-it-send protocol-console-send"${deps.activeProtocol === 'jsonrpc' ? ' hidden' : ''}>Send payload</button></div><pre class="try-it-response-headers-pre protocol-console-log">Ready.</pre></div>`
}

function renderStarterPanel(deps: ConsoleDeps): string {
  const sample = samplePayload(deps)
  return `<div class="try-it-header"><span class="try-it-title">Try ${deps.esc(deps.activeProtocol)}</span></div><div class="try-it-form"><div class="try-it-section-title">Starter request</div><div class="md-code-wrap"><button type="button" class="copy-code-btn">Copy</button><pre class="md-code-block"><code>${deps.esc(sample)}</code></pre></div></div>`
}

function defaultEndpoint({ activeProtocol, spec, wsSpec, streamsSpec, jsonrpcSpec, endpoint }: ConsoleDeps): string {
  const base = String(spec.servers?.[0]?.url ?? 'http://localhost:3000').replace(/\/$/, '')
  if (activeProtocol === 'websocket') return `${base.replace(/^http/, 'ws')}${wsSpec.path ?? '/ws'}`
  if (activeProtocol === 'streams') return `${base}/${streamsSpec.pathPrefix ?? 'streams'}/${endpoint.path}`.replace(/([^:]\/)\/+/g, '$1')
  if (activeProtocol === 'jsonrpc') return `${base}${jsonrpcSpec.endpoint ?? '/rpc'}`
  return base
}

function samplePayload({ activeProtocol, endpoint, data }: ConsoleDeps): string {
  if (activeProtocol === 'websocket') return JSON.stringify({ type: 'subscribe', channel: endpoint.path, id: '1' }, null, 2)
  if (activeProtocol === 'streams') return 'EventSource connection; no request body is sent.'
  if (activeProtocol === 'jsonrpc') return JSON.stringify({ jsonrpc: '2.0', method: endpoint.path, params: data.params ?? {}, id: 1 }, null, 2)
  if (activeProtocol === 'grpc') return `grpcurl ${data.serviceName}/${data.methodName}`
  if (activeProtocol === 'tcp') return `nc ${data.host ?? 'localhost'} ${data.port ?? ''}`
  return `printf '{}' | nc -u ${data.host ?? '127.0.0.1'} ${data.port ?? ''}`
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
      if (deps.activeProtocol === 'jsonrpc') {
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
        events = new EventSource(url.value)
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
