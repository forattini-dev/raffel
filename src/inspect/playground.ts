import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { WebSocket } from 'ws'
import { loadRuntimeInspectionPreview, type RuntimeInspectionLoadOptions } from './loader.js'
import {
  buildGraphQLDocument,
  createSchemaExample,
  extractPathParameters,
  getSchemaObjectExample,
} from './schema-samples.js'
import { formatBindingLabel } from './format-utils.js'
import type {
  RuntimeInspectionChannel,
  RuntimeInspectionGraph,
  RuntimeInspectionOperation,
  RuntimeInspectionTransport,
  RuntimeInspectionTransportBinding,
} from './types.js'

export interface RuntimePlaygroundEntry {
  key: string
  kind: 'operation' | 'channel'
  protocol: RuntimeInspectionTransportBinding['protocol']
  mode: RuntimeInspectionTransportBinding['mode']
  label: string
  description?: string
  operationId?: string
  channelId?: string
  transportId: string
  bindingId: string
  session: boolean
  target: {
    host?: string
    port?: number
    path?: string
    service?: string
    method?: string
  }
  defaults: {
    headers?: Record<string, string>
    metadata?: Record<string, string>
    params?: Record<string, string>
    query?: Record<string, unknown>
    body?: unknown
    document?: string
    message?: unknown
  }
}

export interface RuntimePlaygroundSnapshot {
  generatedAt: string
  graph: RuntimeInspectionGraph
  entries: RuntimePlaygroundEntry[]
}

export interface RuntimePlaygroundInvokeRequest {
  entry: string
  headers?: Record<string, unknown>
  metadata?: Record<string, unknown>
  params?: Record<string, unknown>
  query?: Record<string, unknown>
  body?: unknown
  document?: string
}

export interface RuntimePlaygroundSessionView {
  id: string
  entry: string
  state: 'connecting' | 'open' | 'closed' | 'error'
  protocol: RuntimeInspectionTransportBinding['protocol']
  mode: RuntimeInspectionTransportBinding['mode']
  target: string
  sent: Array<{ at: string; payload: unknown }>
  received: Array<{ at: string; payload: unknown }>
  errors: string[]
}

export interface RuntimePlaygroundServerOptions {
  graph?: RuntimeInspectionGraph
  entry?: string
  cwd?: string
  host?: string
  port?: number
}

export interface RuntimePlaygroundServer {
  readonly entrypoint: string
  readonly snapshot: RuntimePlaygroundSnapshot
  readonly url: string
  readonly address: { host: string; port: number }
  start(): Promise<void>
  stop(): Promise<void>
}

interface SessionRecord {
  id: string
  entry: RuntimePlaygroundEntry
  state: RuntimePlaygroundSessionView['state']
  protocol: RuntimeInspectionTransportBinding['protocol']
  mode: RuntimeInspectionTransportBinding['mode']
  target: string
  sent: RuntimePlaygroundSessionView['sent']
  received: RuntimePlaygroundSessionView['received']
  errors: string[]
  send?: (payload: unknown) => void
  close: () => Promise<void>
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
}

function normalizeConnectHost(host: string | undefined): string {
  if (!host || host === '0.0.0.0' || host === '::') {
    return '127.0.0.1'
  }
  return host
}

function findTransport(
  graph: RuntimeInspectionGraph,
  binding: RuntimeInspectionTransportBinding
): RuntimeInspectionTransport | undefined {
  return graph.transports.find((transport) => transport.protocol === binding.protocol)
}



function toStringRecord(input: Record<string, unknown> | undefined): Record<string, string> {
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

function buildOperationDefaults(
  operation: RuntimeInspectionOperation,
  binding: RuntimeInspectionTransportBinding
): RuntimePlaygroundEntry['defaults'] {
  const inputExample = createSchemaExample(operation.schema.input)
  const inputObject = getSchemaObjectExample(operation.schema.input)

  if (binding.protocol === 'http') {
    const params = Object.fromEntries(
      extractPathParameters(binding.path).map((name) => [name, `example-${name}`])
    )
    const query = binding.method === 'GET'
      ? Object.fromEntries(Object.entries(inputObject).filter(([key]) => !(key in params)))
      : {}

    return {
      headers: binding.method === 'GET' ? {} : { 'content-type': 'application/json' },
      params,
      query,
      body: binding.method === 'GET' ? undefined : inputExample,
    }
  }

  if (binding.protocol === 'jsonrpc') {
    return {
      headers: { 'content-type': 'application/json' },
      metadata: {},
      body: inputExample,
    }
  }

  if (binding.protocol === 'graphql') {
    return {
      headers: { 'content-type': 'application/json' },
      document: buildGraphQLDocument(
        operation,
        binding.field ?? operation.name,
        binding.mode === 'query' ? 'query' : 'mutation'
      ),
    }
  }

  if (binding.protocol === 'grpc') {
    return {
      metadata: {},
      body: inputExample,
    }
  }

  if (binding.protocol === 'websocket') {
    return {
      metadata: {},
      message: {
        id: randomUUID(),
        procedure: operation.name,
        type: binding.mode === 'event' ? 'event' : 'request',
        payload: inputExample,
        metadata: {},
      },
    }
  }

  return {
    body: inputExample,
  }
}

function buildChannelDefaults(channel: RuntimeInspectionChannel): RuntimePlaygroundEntry['defaults'] {
  const firstEvent = channel.events[0]
  return {
    metadata: {},
    message: {
      id: 'channel-subscribe',
      type: 'subscribe',
      channel: channel.name,
      metadata: {},
      publishTemplate: {
        id: 'channel-publish',
        type: 'publish',
        channel: channel.name,
        event: firstEvent?.name ?? 'message',
        data: firstEvent ? createSchemaExample(firstEvent.input) : { ok: true },
        metadata: {},
      },
    },
  }
}

export function createRuntimePlaygroundSnapshot(
  graph: RuntimeInspectionGraph
): RuntimePlaygroundSnapshot {
  const entries: RuntimePlaygroundEntry[] = []

  for (const operation of graph.operations) {
    for (const binding of operation.transports) {
      const transport = findTransport(graph, binding)
      entries.push({
        key: `${operation.id}:${binding.id}`,
        kind: 'operation',
        protocol: binding.protocol,
        mode: binding.mode,
        label: formatBindingLabel(binding),
        description: operation.summary ?? operation.description,
        operationId: operation.id,
        transportId: transport?.id ?? binding.protocol,
        bindingId: binding.id,
        session: binding.mode === 'channel' || binding.mode === 'stream' || binding.protocol === 'websocket',
        target: {
          host: transport?.host,
          port: transport?.port,
          path: binding.path,
          service: binding.service,
          method: binding.operation,
        },
        defaults: buildOperationDefaults(operation, binding),
      })
    }
  }

  for (const channel of graph.channels) {
    const transport = findTransport(graph, channel.transport)
    entries.push({
      key: `channel:${channel.id}`,
      kind: 'channel',
      protocol: channel.transport.protocol,
      mode: channel.transport.mode,
      label: channel.name,
      description: channel.description,
      channelId: channel.id,
      transportId: transport?.id ?? channel.transport.protocol,
      bindingId: channel.transport.id,
      session: true,
      target: {
        host: transport?.host,
        port: transport?.port,
        path: channel.transport.path,
      },
      defaults: buildChannelDefaults(channel),
    })
  }

  return {
    generatedAt: new Date().toISOString(),
    graph,
    entries,
  }
}

function renderPlaygroundHtml(snapshot: RuntimePlaygroundSnapshot, entrypoint: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Raffel Playground</title>
  <style>
    :root {
      --bg: #f4efe6;
      --panel: #fffaf3;
      --line: #d8cdbd;
      --ink: #1f2a2e;
      --muted: #6f7c82;
      --accent: #0d6b66;
      --accent-soft: #d6efe8;
      --danger: #a5372d;
      --mono: "IBM Plex Mono", "SFMono-Regular", Menlo, monospace;
      --sans: "Space Grotesk", "Avenir Next", sans-serif;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: radial-gradient(circle at top, #fff6ea, var(--bg)); color: var(--ink); font-family: var(--sans); }
    .shell { display: grid; grid-template-columns: 320px 1fr; min-height: 100vh; }
    .sidebar { border-right: 1px solid var(--line); background: rgba(255,250,243,0.9); backdrop-filter: blur(10px); padding: 24px 20px; }
    .title { font-size: 28px; line-height: 1; margin: 0 0 8px; }
    .subtitle { color: var(--muted); margin: 0 0 18px; font-size: 14px; }
    .search { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; background: white; margin-bottom: 18px; }
    .group { margin-bottom: 18px; }
    .group h3 { margin: 0 0 8px; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
    .entry-btn { width: 100%; text-align: left; border: 1px solid transparent; background: transparent; border-radius: 12px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; }
    .entry-btn:hover, .entry-btn.active { background: var(--accent-soft); border-color: rgba(13,107,102,0.16); }
    .entry-label { display: block; font-size: 14px; font-weight: 700; }
    .entry-meta { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }
    .main { padding: 28px; }
    .hero { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
    .hero h1 { margin: 0 0 6px; font-size: 34px; }
    .hero p { margin: 0; color: var(--muted); }
    .pill { display: inline-flex; align-items: center; padding: 5px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 20px; padding: 20px; box-shadow: 0 16px 40px rgba(31,42,46,0.06); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-bottom: 16px; }
    .editor { display: flex; flex-direction: column; gap: 6px; }
    .editor.full { grid-column: 1 / -1; }
    .editor label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    textarea, pre, .target { width: 100%; border: 1px solid var(--line); border-radius: 14px; background: white; padding: 12px; font-family: var(--mono); font-size: 12px; min-height: 120px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
    .target { min-height: auto; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0; }
    button.action { appearance: none; border: 0; border-radius: 999px; padding: 10px 16px; cursor: pointer; background: var(--accent); color: white; font-weight: 700; }
    button.secondary { background: #e9dfd0; color: var(--ink); }
    button.danger { background: var(--danger); }
    .status { color: var(--muted); font-size: 13px; margin-bottom: 12px; }
    @media (max-width: 900px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar { border-right: 0; border-bottom: 1px solid var(--line); }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <h1 class="title">Raffel Playground</h1>
      <p class="subtitle">${escapeHtml(entrypoint)}</p>
      <input class="search" id="search" placeholder="Filter operations, routes, channels">
      <div id="entries"></div>
    </aside>
    <main class="main">
      <div class="hero">
        <div>
          <h1>Unified local invocation</h1>
          <p>HTTP, GraphQL, JSON-RPC, gRPC, channels, and streams from one inspection graph.</p>
        </div>
        <span class="pill">${snapshot.entries.length} subjects</span>
      </div>
      <section class="panel" id="detail"></section>
    </main>
  </div>
  <script>
    const SNAPSHOT = ${escapeJsonForScript(snapshot)};
    const entryContainer = document.getElementById('entries');
    const detail = document.getElementById('detail');
    const searchInput = document.getElementById('search');
    let activeKey = SNAPSHOT.entries[0] ? SNAPSHOT.entries[0].key : null;
    let activeSession = null;
    let sessionPollTimer = null;

    function esc(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
    }

    function pretty(value) {
      return JSON.stringify(value ?? {}, null, 2);
    }

    function groupedEntries(filter) {
      const filtered = SNAPSHOT.entries.filter((entry) => {
        if (!filter) return true;
        const haystack = [entry.label, entry.description, entry.operationId, entry.channelId, entry.protocol, entry.mode]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(filter.toLowerCase());
      });

      const groups = new Map();
      for (const entry of filtered) {
        if (!groups.has(entry.protocol)) {
          groups.set(entry.protocol, []);
        }
        groups.get(entry.protocol).push(entry);
      }
      return Array.from(groups.entries());
    }

    function parseJson(text, fallback) {
      try {
        return text ? JSON.parse(text) : fallback;
      } catch (error) {
        throw new Error('Invalid JSON: ' + error.message);
      }
    }

    function currentEntry() {
      return SNAPSHOT.entries.find((entry) => entry.key === activeKey) || null;
    }

    function stopPolling() {
      if (sessionPollTimer) {
        clearInterval(sessionPollTimer);
        sessionPollTimer = null;
      }
    }

    async function refreshSession(sessionId) {
      const response = await fetch('/__session/' + encodeURIComponent(sessionId));
      if (!response.ok) {
        throw new Error('Failed to refresh session');
      }
      activeSession = await response.json();
      const sessionView = document.getElementById('sessionView');
      if (sessionView) {
        sessionView.textContent = pretty(activeSession);
      }
    }

    async function invoke(entry, editors) {
      const payload = {
        entry: entry.key,
        headers: parseJson(editors.headers?.value || '{}', {}),
        metadata: parseJson(editors.metadata?.value || '{}', {}),
        params: parseJson(editors.params?.value || '{}', {}),
        query: parseJson(editors.query?.value || '{}', {}),
        body: editors.body ? parseJson(editors.body.value || 'null', null) : undefined,
        document: editors.document ? editors.document.value : undefined,
      };

      const response = await fetch('/__invoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      editors.output.textContent = pretty(result);
    }

    async function openSession(entry, editors) {
      const payload = {
        entry: entry.key,
        headers: parseJson(editors.headers?.value || '{}', {}),
        metadata: parseJson(editors.metadata?.value || '{}', {}),
        params: parseJson(editors.params?.value || '{}', {}),
        query: parseJson(editors.query?.value || '{}', {}),
      };

      const response = await fetch('/__session/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      activeSession = result;
      editors.output.textContent = pretty(result);
      stopPolling();
      if (result.id) {
        sessionPollTimer = setInterval(() => {
          refreshSession(result.id).catch((error) => {
            stopPolling();
            editors.output.textContent = JSON.stringify({ error: error.message }, null, 2);
          });
        }, 700);
      }
    }

    async function sendSessionMessage(editors) {
      if (!activeSession?.id) {
        throw new Error('No active session');
      }
      const response = await fetch('/__session/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSession.id,
          message: parseJson(editors.message.value || 'null', null),
        }),
      });
      const result = await response.json();
      await refreshSession(result.id || activeSession.id);
      editors.output.textContent = pretty(activeSession);
    }

    async function closeSession(editors) {
      if (!activeSession?.id) return;
      await fetch('/__session/' + encodeURIComponent(activeSession.id), { method: 'DELETE' });
      await refreshSession(activeSession.id).catch(() => {});
      stopPolling();
      editors.output.textContent = pretty(activeSession);
    }

    function addEditor(parent, label, value, id, full) {
      const wrap = document.createElement('div');
      wrap.className = 'editor' + (full ? ' full' : '');
      const title = document.createElement('label');
      title.textContent = label;
      const area = document.createElement('textarea');
      area.id = id;
      area.value = typeof value === 'string' ? value : pretty(value);
      wrap.append(title, area);
      parent.appendChild(wrap);
      return area;
    }

    function renderDetail() {
      const entry = currentEntry();
      if (!entry) {
        detail.innerHTML = '<p>No playground subjects available.</p>';
        return;
      }

      stopPolling();
      activeSession = null;
      detail.innerHTML = '';

      const heading = document.createElement('div');
      heading.innerHTML = '<h2 style="margin:0 0 6px;">' + esc(entry.label) + '</h2>'
        + '<div class="status">' + esc(entry.protocol.toUpperCase() + ' · ' + entry.mode + ' · ' + (entry.operationId || entry.channelId || entry.bindingId)) + '</div>'
        + '<div class="target">' + esc(JSON.stringify(entry.target, null, 2)) + '</div>';
      detail.appendChild(heading);

      const grid = document.createElement('div');
      grid.className = 'grid';
      const editors = {
        headers: addEditor(grid, 'Headers', entry.defaults.headers || {}, 'headers'),
        metadata: addEditor(grid, 'Metadata', entry.defaults.metadata || {}, 'metadata'),
        params: addEditor(grid, 'Params', entry.defaults.params || {}, 'params'),
        query: addEditor(grid, 'Query', entry.defaults.query || {}, 'query'),
        body: null,
        document: null,
        message: null,
        output: document.createElement('pre'),
      };

      if (entry.defaults.body !== undefined) {
        editors.body = addEditor(grid, 'Body', entry.defaults.body, 'body', true);
      }
      if (entry.defaults.document) {
        editors.document = addEditor(grid, 'GraphQL Document', entry.defaults.document, 'document', true);
      }
      if (entry.defaults.message) {
        editors.message = addEditor(grid, 'Session Message', entry.defaults.message, 'message', true);
      }

      detail.appendChild(grid);

      const actions = document.createElement('div');
      actions.className = 'actions';

      if (!entry.session) {
        const invokeBtn = document.createElement('button');
        invokeBtn.className = 'action';
        invokeBtn.textContent = 'Invoke';
        invokeBtn.onclick = () => invoke(entry, editors).catch((error) => {
          editors.output.textContent = pretty({ error: error.message });
        });
        actions.appendChild(invokeBtn);
      } else {
        const openBtn = document.createElement('button');
        openBtn.className = 'action';
        openBtn.textContent = 'Open Session';
        openBtn.onclick = () => openSession(entry, editors).catch((error) => {
          editors.output.textContent = pretty({ error: error.message });
        });
        actions.appendChild(openBtn);

        if (editors.message) {
          const sendBtn = document.createElement('button');
          sendBtn.className = 'action secondary';
          sendBtn.textContent = 'Send Message';
          sendBtn.onclick = () => sendSessionMessage(editors).catch((error) => {
            editors.output.textContent = pretty({ error: error.message });
          });
          actions.appendChild(sendBtn);
        }

        const closeBtn = document.createElement('button');
        closeBtn.className = 'action danger';
        closeBtn.textContent = 'Close Session';
        closeBtn.onclick = () => closeSession(editors).catch((error) => {
          editors.output.textContent = pretty({ error: error.message });
        });
        actions.appendChild(closeBtn);
      }

      detail.appendChild(actions);

      const outputWrap = document.createElement('div');
      outputWrap.className = 'editor full';
      const outputLabel = document.createElement('label');
      outputLabel.textContent = entry.session ? 'Session Inspector' : 'Response Inspector';
      editors.output.id = 'sessionView';
      editors.output.textContent = pretty({ ready: true });
      outputWrap.append(outputLabel, editors.output);
      detail.appendChild(outputWrap);
    }

    function renderEntries() {
      entryContainer.innerHTML = '';
      for (const [protocol, entries] of groupedEntries(searchInput.value)) {
        const group = document.createElement('section');
        group.className = 'group';
        const title = document.createElement('h3');
        title.textContent = protocol;
        group.appendChild(title);

        for (const entry of entries) {
          const button = document.createElement('button');
          button.className = 'entry-btn' + (entry.key === activeKey ? ' active' : '');
          button.innerHTML = '<span class="entry-label">' + esc(entry.label) + '</span>'
            + '<span class="entry-meta">' + esc((entry.operationId || entry.channelId || '') + ' · ' + entry.mode) + '</span>';
          button.onclick = () => {
            activeKey = entry.key;
            renderEntries();
            renderDetail();
          };
          group.appendChild(button);
        }

        entryContainer.appendChild(group);
      }
    }

    searchInput.addEventListener('input', renderEntries);
    renderEntries();
    renderDetail();
  </script>
</body>
</html>`
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
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

function buildHttpUrl(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): string {
  return buildTargetUrl(entry, payload)
}

function buildWebSocketCandidates(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): string[] {
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

function parseJsonBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolve((text ? JSON.parse(text) : {}) as T)
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function parseFetchResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    return response.json()
  }
  return response.text()
}

async function invokeHttp(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): Promise<unknown> {
  if (entry.mode === 'stream') {
    throw new Error('Use a session for HTTP stream bindings')
  }

  const url = buildHttpUrl(entry, payload)
  const headers = {
    ...toStringRecord(payload.headers),
    ...toStringRecord(payload.metadata),
  }
  const method = entry.label.split(' ')[0] || 'POST'
  const requestInit: RequestInit = {
    method,
    headers,
  }

  if (method !== 'GET' && payload.body !== undefined) {
    requestInit.body = JSON.stringify(payload.body)
    if (!headers['content-type']) {
      headers['content-type'] = 'application/json'
    }
  }

  const response = await fetch(url, requestInit)
  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await parseFetchResponse(response),
  }
}

async function invokeJsonRpc(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): Promise<unknown> {
  const url = buildHttpUrl(entry, payload)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...toStringRecord(payload.headers),
      ...toStringRecord(payload.metadata),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: entry.label,
      params: payload.body ?? {},
      id: 'playground-call',
    }),
  })

  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await parseFetchResponse(response),
  }
}

async function invokeGraphQL(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): Promise<unknown> {
  const url = buildHttpUrl(entry, payload)
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...toStringRecord(payload.headers),
      ...toStringRecord(payload.metadata),
    },
    body: JSON.stringify({
      query: payload.document,
    }),
  })

  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await parseFetchResponse(response),
  }
}

function resolveGrpcClient(root: Record<string, unknown>, fullName: string): grpc.ServiceClientConstructor {
  const parts = fullName.split('.').filter(Boolean)
  let current: unknown = root

  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) {
      throw new Error(`gRPC service "${fullName}" not found in loaded proto definition`)
    }
    current = (current as Record<string, unknown>)[part]
  }

  return current as grpc.ServiceClientConstructor
}

async function invokeGrpc(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest, graph: RuntimeInspectionGraph): Promise<unknown> {
  if (entry.mode !== 'unary') {
    throw new Error(`gRPC playground currently supports unary methods only; received ${entry.mode}`)
  }

  const transport = graph.transports.find((candidate) => candidate.id === entry.transportId)
  if (!transport?.grpc) {
    throw new Error('Missing gRPC transport metadata for playground invocation')
  }

  const definition = protoLoader.loadSync(transport.grpc.protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  })
  const proto = grpc.loadPackageDefinition(definition) as Record<string, unknown>
  const Client = resolveGrpcClient(proto, entry.target.service ?? '')
  const client = new Client(
    `${normalizeConnectHost(entry.target.host)}:${entry.target.port}`,
    grpc.credentials.createInsecure()
  ) as grpc.Client & Record<string, Function>
  const metadata = new grpc.Metadata()
  for (const [key, value] of Object.entries(toStringRecord(payload.metadata))) {
    metadata.set(key, value)
  }

  try {
    const response = await new Promise<unknown>((resolve, reject) => {
      client[entry.target.method ?? ''](payload.body ?? {}, metadata, (error: Error | null, result: unknown) => {
        if (error) {
          reject(error)
          return
        }
        resolve(result)
      })
    })

    return {
      ok: true,
      body: response,
    }
  } finally {
    client.close()
  }
}

function toSessionView(session: SessionRecord): RuntimePlaygroundSessionView {
  return {
    id: session.id,
    entry: session.entry.key,
    state: session.state,
    protocol: session.protocol,
    mode: session.mode,
    target: session.target,
    sent: [...session.sent],
    received: [...session.received],
    errors: [...session.errors],
  }
}

function parseMaybeJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function createWebSocketSession(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): Promise<SessionRecord> {
  const sent: SessionRecord['sent'] = []
  const received: SessionRecord['received'] = []
  const errors: string[] = []
  const headers = {
    ...toStringRecord(payload.headers),
    ...toStringRecord(payload.metadata),
  }
  const candidates = buildWebSocketCandidates(entry, payload)
  let socket: WebSocket | null = null
  let target = candidates[0]

  const session: SessionRecord = {
    id: randomUUID(),
    entry,
    state: 'connecting',
    protocol: entry.protocol,
    mode: entry.mode,
    target,
    sent,
    received,
    errors,
    send(message) {
      const normalized = typeof message === 'string' ? message : JSON.stringify(message)
      socket?.send(normalized)
      sent.push({ at: new Date().toISOString(), payload: parseMaybeJson(normalized) })
    },
    async close() {
      socket?.close()
    },
  }

  async function connect(candidate: string): Promise<WebSocket> {
    return await new Promise<WebSocket>((resolve, reject) => {
      const current = new WebSocket(candidate, { headers })
      const timeout = setTimeout(() => {
        current.close()
        reject(new Error(`Timed out opening WebSocket session to ${candidate}`))
      }, 2000)

      current.once('open', () => {
        clearTimeout(timeout)
        resolve(current)
      })
      current.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
    })
  }

  let lastError: Error | null = null
  for (const candidate of candidates) {
    try {
      socket = await connect(candidate)
      target = candidate
      session.target = candidate
      break
    } catch (error) {
      lastError = error as Error
      errors.push(lastError.message)
    }
  }

  if (!socket) {
    session.state = 'error'
    throw lastError ?? new Error('Failed to open WebSocket session')
  }

  socket.on('message', (message) => {
    const raw = typeof message === 'string' ? message : message.toString('utf8')
    received.push({ at: new Date().toISOString(), payload: parseMaybeJson(raw) })
  })
  socket.on('close', () => {
    session.state = 'closed'
  })
  socket.on('error', (error) => {
    session.state = 'error'
    errors.push(error.message)
  })
  session.state = 'open'

  return session
}

function parseSseBlock(block: string): unknown {
  const event: Record<string, string> = {}
  for (const line of block.split('\n')) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key === 'event') {
      event.event = value
    } else if (key === 'data') {
      event.data = value
    }
  }
  if (event.data) {
    return {
      ...event,
      parsed: parseMaybeJson(event.data),
    }
  }
  return event
}

async function createHttpStreamSession(entry: RuntimePlaygroundEntry, payload: RuntimePlaygroundInvokeRequest): Promise<SessionRecord> {
  const target = buildHttpUrl(entry, payload)
  const controller = new AbortController()
  const sent: SessionRecord['sent'] = []
  const received: SessionRecord['received'] = []
  const errors: string[] = []
  const session: SessionRecord = {
    id: randomUUID(),
    entry,
    state: 'connecting',
    protocol: entry.protocol,
    mode: entry.mode,
    target,
    sent,
    received,
    errors,
    async close() {
      controller.abort('playground-session-closed')
      session.state = 'closed'
    },
  }

  void (async () => {
    try {
      const response = await fetch(target, {
        method: 'GET',
        headers: {
          accept: 'text/event-stream',
          ...toStringRecord(payload.headers),
          ...toStringRecord(payload.metadata),
        },
        signal: controller.signal,
      })

      if (!response.ok) {
        session.state = 'error'
        errors.push(`HTTP ${response.status}`)
        received.push({
          at: new Date().toISOString(),
          payload: await parseFetchResponse(response),
        })
        return
      }

      session.state = 'open'
      const reader = response.body?.getReader()
      if (!reader) {
        session.state = 'closed'
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          if (!block.trim()) continue
          received.push({
            at: new Date().toISOString(),
            payload: parseSseBlock(block),
          })
        }
      }
      session.state = 'closed'
    } catch (error) {
      if (!controller.signal.aborted) {
        session.state = 'error'
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  })()

  return session
}

export function createRuntimePlaygroundServer(options: {
  graph: RuntimeInspectionGraph
  entrypoint?: string
  host?: string
  port?: number
}): RuntimePlaygroundServer {
  const entrypoint = options.entrypoint ?? '<programmatic>'
  const snapshot = createRuntimePlaygroundSnapshot(options.graph)
  const host = options.host ?? '127.0.0.1'
  const requestedPort = options.port ?? 0
  let server: Server | null = null
  let address = { host, port: requestedPort }
  const sessions = new Map<string, SessionRecord>()

  async function closeSessions(): Promise<void> {
    await Promise.all(Array.from(sessions.values()).map((session) => session.close().catch(() => undefined)))
    sessions.clear()
  }

  async function handleInvoke(payload: RuntimePlaygroundInvokeRequest): Promise<unknown> {
    const entry = snapshot.entries.find((candidate) => candidate.key === payload.entry)
    if (!entry) {
      throw new Error(`Unknown playground entry "${payload.entry}"`)
    }

    if (entry.protocol === 'http') {
      return invokeHttp(entry, payload)
    }
    if (entry.protocol === 'jsonrpc') {
      return invokeJsonRpc(entry, payload)
    }
    if (entry.protocol === 'graphql') {
      return invokeGraphQL(entry, payload)
    }
    if (entry.protocol === 'grpc') {
      return invokeGrpc(entry, payload, options.graph)
    }

    throw new Error(`Protocol ${entry.protocol} requires a session-oriented workflow`)
  }

  async function handleOpenSession(payload: RuntimePlaygroundInvokeRequest): Promise<RuntimePlaygroundSessionView> {
    const entry = snapshot.entries.find((candidate) => candidate.key === payload.entry)
    if (!entry) {
      throw new Error(`Unknown playground entry "${payload.entry}"`)
    }

    let session: SessionRecord
    if (entry.protocol === 'websocket') {
      session = await createWebSocketSession(entry, payload)
    } else if (entry.protocol === 'http' && entry.mode === 'stream') {
      session = await createHttpStreamSession(entry, payload)
    } else {
      throw new Error(`Sessions are not supported for ${entry.protocol}:${entry.mode}`)
    }

    sessions.set(session.id, session)
    return toSessionView(session)
  }

  async function requestListener(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host ?? '127.0.0.1'}`)

    if (req.method === 'GET' && url.pathname === '/') {
      const html = renderPlaygroundHtml(snapshot, entrypoint)
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(html),
      })
      res.end(html)
      return
    }

    if (req.method === 'GET' && url.pathname === '/__snapshot') {
      sendJson(res, 200, snapshot)
      return
    }

    if (req.method === 'POST' && url.pathname === '/__invoke') {
      try {
        sendJson(res, 200, await handleInvoke(await parseJsonBody<RuntimePlaygroundInvokeRequest>(req)))
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (req.method === 'POST' && url.pathname === '/__session/open') {
      try {
        sendJson(res, 200, await handleOpenSession(await parseJsonBody<RuntimePlaygroundInvokeRequest>(req)))
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (req.method === 'POST' && url.pathname === '/__session/send') {
      try {
        const payload = await parseJsonBody<{ sessionId: string; message: unknown }>(req)
        const session = sessions.get(payload.sessionId)
        if (!session || !session.send) {
          throw new Error(`Session ${payload.sessionId} does not accept outbound messages`)
        }
        session.send(payload.message)
        sendJson(res, 200, toSessionView(session))
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
      }
      return
    }

    if (req.method === 'GET' && url.pathname.startsWith('/__session/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/__session/'.length))
      const session = sessions.get(sessionId)
      if (!session) {
        sendJson(res, 404, { error: `Session ${sessionId} not found` })
        return
      }
      sendJson(res, 200, toSessionView(session))
      return
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/__session/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/__session/'.length))
      const session = sessions.get(sessionId)
      if (!session) {
        sendJson(res, 404, { error: `Session ${sessionId} not found` })
        return
      }
      await session.close()
      sendJson(res, 200, toSessionView(session))
      return
    }

    sendJson(res, 404, { error: `Unknown playground route ${req.method} ${url.pathname}` })
  }

  return {
    entrypoint,
    snapshot,
    get url() {
      return `http://${address.host}:${address.port}`
    },
    get address() {
      return address
    },
    async start() {
      if (server) {
        return
      }

      server = createServer((req, res) => {
        void requestListener(req, res)
      })

      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject)
        server!.listen(requestedPort, host, () => {
          const info = server!.address()
          if (!info || typeof info === 'string') {
            reject(new Error('Failed to resolve playground address'))
            return
          }
          address = {
            host: normalizeConnectHost(info.address),
            port: info.port,
          }
          resolve()
        })
      })
    },
    async stop() {
      await closeSessions()
      if (!server) {
        return
      }
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
      server = null
    },
  }
}

export async function startRuntimePlayground(
  options: RuntimePlaygroundServerOptions = {}
): Promise<RuntimePlaygroundServer> {
  const preview = options.graph
    ? { entrypoint: options.entry ?? '<programmatic>', graph: options.graph }
    : await loadRuntimeInspectionPreview(options as RuntimeInspectionLoadOptions)

  const server = createRuntimePlaygroundServer({
    graph: preview.graph,
    entrypoint: preview.entrypoint,
    host: options.host,
    port: options.port,
  })

  await server.start()
  return server
}
