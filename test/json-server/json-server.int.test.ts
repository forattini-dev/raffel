import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJsonServer, createJsonModule } from '../../src/json-server/index.js'
import { createServer } from '../../src/server/builder.js'

// ── Port plan (24100–24108) ────────────────────────────────────────────────
// 24100: HTTP REST (ws: false)
// 24101: HTTP REST readonly (ws: false)
// 24102: WebSocket procedures
// 24103: $watch real-time stream
// 24104: file persistence
// 24105: onListen callback
// 24106: delay option
// 24107: JSON-RPC
// 24108: createJsonModule manual mount

const BASE = 24100

// ── Helpers ────────────────────────────────────────────────────────────────

function http(port: number, path: string, opts: { method?: string; body?: unknown } = {}) {
  const { method = 'GET', body } = opts
  return fetch(`http://localhost:${port}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function wsConnect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function sendAndReceive(ws: WebSocket, msg: object): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS timeout')), 5000)
    ws.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()))
    })
    ws.send(JSON.stringify(msg))
  })
}

function collectWsMessages(ws: WebSocket, count: number, ms = 6000): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const msgs: Record<string, unknown>[] = []
    const timer = setTimeout(
      () => reject(new Error(`WS timeout: got ${msgs.length}/${count} messages`)),
      ms
    )
    const handler = (data: Buffer) => {
      msgs.push(JSON.parse(data.toString()))
      if (msgs.length >= count) {
        clearTimeout(timer)
        ws.off('message', handler)
        resolve(msgs)
      }
    }
    ws.on('message', handler)
  })
}

// ── HTTP REST ──────────────────────────────────────────────────────────────

describe('createJsonServer — HTTP REST', () => {
  let server: Awaited<ReturnType<typeof createJsonServer>>['server']

  beforeAll(async () => {
    ({ server } = await createJsonServer({
      port: BASE,
      db: {
        posts: [
          { id: 1, title: 'Alpha', tag: 'news' },
          { id: 2, title: 'Beta', tag: 'tech' },
          { id: 3, title: 'Gamma', tag: 'news' },
        ],
        users: [{ id: 1, name: 'Alice' }],
      },
      protocols: { ws: false },
    }))
  })

  afterAll(async () => { await server.stop() })

  it('GET /posts → 200 with {data, total}', async () => {
    const res = await http(BASE, '/posts')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.total).toBe(3)
    expect(body.data).toHaveLength(3)
  })

  it('GET /posts?tag=news → field filter', async () => {
    const res = await http(BASE, '/posts?tag=news')
    const body = await res.json() as any
    expect(body.total).toBe(2)
    expect(body.data.every((p: any) => p.tag === 'news')).toBe(true)
  })

  it('GET /posts?_q=beta → full-text search', async () => {
    const res = await http(BASE, '/posts?_q=beta')
    const body = await res.json() as any
    expect(body.data).toHaveLength(1)
    expect(body.data[0].title).toBe('Beta')
  })

  it('GET /posts?_sort=title&_order=asc → sorted ascending', async () => {
    const res = await http(BASE, '/posts?_sort=title&_order=asc')
    const body = await res.json() as any
    expect(body.data[0].title).toBe('Alpha')
    expect(body.data[2].title).toBe('Gamma')
  })

  it('GET /posts?_sort=title&_order=desc → sorted descending', async () => {
    const res = await http(BASE, '/posts?_sort=title&_order=desc')
    const body = await res.json() as any
    expect(body.data[0].title).toBe('Gamma')
  })

  it('GET /posts?_page=1&_limit=2 → paginated page 1', async () => {
    const res = await http(BASE, '/posts?_page=1&_limit=2')
    const body = await res.json() as any
    expect(body.total).toBe(3)
    expect(body.data).toHaveLength(2)
  })

  it('GET /posts?_page=2&_limit=2 → paginated page 2', async () => {
    const res = await http(BASE, '/posts?_page=2&_limit=2')
    const body = await res.json() as any
    expect(body.data).toHaveLength(1)
  })

  it('GET /posts/1 → 200 single item', async () => {
    const res = await http(BASE, '/posts/1')
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.id).toBe(1)
    expect(body.title).toBe('Alpha')
  })

  it('GET /posts/999 → 404 NOT_FOUND', async () => {
    const res = await http(BASE, '/posts/999')
    expect(res.status).toBe(404)
    const body = await res.json() as any
    expect(body.code).toBe('NOT_FOUND')
  })

  it('POST /posts → 201 created with auto id', async () => {
    const res = await http(BASE, '/posts', { method: 'POST', body: { title: 'Delta', tag: 'new' } })
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.id).toBeDefined()
    expect(body.title).toBe('Delta')
  })

  it('PUT /posts/1 → 200 replaced (old fields removed)', async () => {
    const res = await http(BASE, '/posts/1', { method: 'PUT', body: { title: 'Replaced' } })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.title).toBe('Replaced')
    expect(body).not.toHaveProperty('tag')
  })

  it('PUT /posts/9999 → 404', async () => {
    const res = await http(BASE, '/posts/9999', { method: 'PUT', body: { title: 'x' } })
    expect(res.status).toBe(404)
  })

  it('PATCH /posts/2 → 200 patched (other fields preserved)', async () => {
    const res = await http(BASE, '/posts/2', { method: 'PATCH', body: { title: 'Patched' } })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.title).toBe('Patched')
    expect(body.tag).toBe('tech')
  })

  it('PATCH /posts/9999 → 404', async () => {
    const res = await http(BASE, '/posts/9999', { method: 'PATCH', body: {} })
    expect(res.status).toBe(404)
  })

  it('DELETE /posts/3 → 200 deleted record', async () => {
    const res = await http(BASE, '/posts/3', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.id).toBe(3)
  })

  it('DELETE /posts/9999 → 404', async () => {
    const res = await http(BASE, '/posts/9999', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })

  it('unknown method on collection → 405', async () => {
    const res = await http(BASE, '/posts', { method: 'HEAD' })
    expect(res.status).toBe(405)
  })

  it('unknown method on item → 405', async () => {
    const res = await http(BASE, '/posts/1', { method: 'HEAD' })
    expect(res.status).toBe(405)
  })

  it('unknown resource → not handled by middleware', async () => {
    // >0 and <=2 segments, but resource not in store → returns false → Raffel 405
    const res = await http(BASE, '/unknown-resource')
    expect(res.status).toBe(405)
  })

  it('deeply nested path → not intercepted (>2 segments)', async () => {
    // 3+ segments → middleware returns false → Raffel handles with 405
    const res = await http(BASE, '/posts/1/comments')
    expect(res.status).toBe(405)
  })

  it('root path → not intercepted (0 segments)', async () => {
    // "/" → 0 segments → middleware returns false
    const res = await http(BASE, '/')
    expect(res.status).not.toBe(200)
  })

  it('POST with invalid JSON body → treated as empty body (resolves {})', async () => {
    // Triggers the catch { resolve({}) } branch in readBody
    const res = await fetch(`http://localhost:${BASE}/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json{{{',
    })
    // Store receives {} as body, creates a record with only auto-assigned id
    expect(res.status).toBe(201)
    const body = await res.json() as any
    expect(body.id).toBeDefined()
  })
})

// ── HTTP REST readonly ─────────────────────────────────────────────────────

describe('createJsonServer — HTTP REST readonly', () => {
  let server: Awaited<ReturnType<typeof createJsonServer>>['server']

  beforeAll(async () => {
    ({ server } = await createJsonServer({
      port: BASE + 1,
      db: { posts: [{ id: 1, title: 'Existing' }] },
      protocols: { ws: false },
      readonly: true,
    }))
  })

  afterAll(async () => { await server.stop() })

  it('GET /posts → 200 (reads allowed)', async () => {
    const res = await http(BASE + 1, '/posts')
    expect(res.status).toBe(200)
  })

  it('POST /posts → 405 METHOD_NOT_ALLOWED', async () => {
    const res = await http(BASE + 1, '/posts', { method: 'POST', body: { title: 'x' } })
    expect(res.status).toBe(405)
    const body = await res.json() as any
    expect(body.code).toBe('METHOD_NOT_ALLOWED')
  })

  it('PUT /posts/1 → 405', async () => {
    const res = await http(BASE + 1, '/posts/1', { method: 'PUT', body: {} })
    expect(res.status).toBe(405)
  })

  it('PATCH /posts/1 → 405', async () => {
    const res = await http(BASE + 1, '/posts/1', { method: 'PATCH', body: {} })
    expect(res.status).toBe(405)
  })

  it('DELETE /posts/1 → 405', async () => {
    const res = await http(BASE + 1, '/posts/1', { method: 'DELETE' })
    expect(res.status).toBe(405)
  })
})

// ── WebSocket procedures ───────────────────────────────────────────────────

describe('createJsonServer — WebSocket procedures', () => {
  let server: Awaited<ReturnType<typeof createJsonServer>>['server']

  beforeAll(async () => {
    ({ server } = await createJsonServer({
      port: BASE + 2,
      db: {
        posts: [
          { id: 1, title: 'First' },
          { id: 2, title: 'Second' },
        ],
      },
      protocols: { ws: true },
    }))
  })

  afterAll(async () => { await server.stop() })

  it('posts.list → returns all items', async () => {
    const ws = await wsConnect(BASE + 2)
    const res = await sendAndReceive(ws, {
      id: 'r1', procedure: 'posts.list', type: 'request', payload: {},
    })
    ws.close()
    expect(res.type).toBe('response')
    expect((res.payload as any).data).toHaveLength(2)
  })

  it('posts.list with filter payload', async () => {
    const ws = await wsConnect(BASE + 2)
    const res = await sendAndReceive(ws, {
      id: 'r1b', procedure: 'posts.list', type: 'request', payload: { _limit: '1' },
    })
    ws.close()
    expect(res.type).toBe('response')
    expect((res.payload as any).data).toHaveLength(1)
  })

  it('posts.get (found) → returns item', async () => {
    const ws = await wsConnect(BASE + 2)
    const res = await sendAndReceive(ws, {
      id: 'r2', procedure: 'posts.get', type: 'request', payload: { id: 1 },
    })
    ws.close()
    expect(res.type).toBe('response')
    expect((res.payload as any).title).toBe('First')
  })

  it('posts.get (not found) → error envelope', async () => {
    const ws = await wsConnect(BASE + 2)
    const res = await sendAndReceive(ws, {
      id: 'r3', procedure: 'posts.get', type: 'request', payload: { id: 9999 },
    })
    ws.close()
    expect(res.type).toBe('error')
    expect((res.payload as any).code).toBe('NOT_FOUND')
  })

  it('posts.create → returns new record', async () => {
    const ws = await wsConnect(BASE + 2)
    const res = await sendAndReceive(ws, {
      id: 'r4', procedure: 'posts.create', type: 'request', payload: { title: 'WS Post' },
    })
    ws.close()
    expect(res.type).toBe('response')
    expect((res.payload as any).title).toBe('WS Post')
    expect((res.payload as any).id).toBeDefined()
  })

  it('posts.replace (found) → returns replaced record', async () => {
    const ws = await wsConnect(BASE + 2)
    const res = await sendAndReceive(ws, {
      id: 'r5', procedure: 'posts.replace', type: 'request', payload: { id: 1, title: 'Replaced' },
    })
    ws.close()
    expect(res.type).toBe('response')
    expect((res.payload as any).title).toBe('Replaced')
  })

  it('posts.replace (not found) → error', async () => {
    const ws = await wsConnect(BASE + 2)
    const res = await sendAndReceive(ws, {
      id: 'r6', procedure: 'posts.replace', type: 'request', payload: { id: 9999, title: 'x' },
    })
    ws.close()
    expect(res.type).toBe('error')
  })

  it('posts.update (found) → patches record', async () => {
    const ws = await wsConnect(BASE + 2)
    const res = await sendAndReceive(ws, {
      id: 'r7', procedure: 'posts.update', type: 'request', payload: { id: 2, title: 'Patched' },
    })
    ws.close()
    expect(res.type).toBe('response')
    expect((res.payload as any).title).toBe('Patched')
  })

  it('posts.update (not found) → error', async () => {
    const ws = await wsConnect(BASE + 2)
    const res = await sendAndReceive(ws, {
      id: 'r8', procedure: 'posts.update', type: 'request', payload: { id: 9999, title: 'x' },
    })
    ws.close()
    expect(res.type).toBe('error')
  })

  it('posts.delete (found) → returns deleted record', async () => {
    const ws = await wsConnect(BASE + 2)
    const res = await sendAndReceive(ws, {
      id: 'r9', procedure: 'posts.delete', type: 'request', payload: { id: 2 },
    })
    ws.close()
    expect(res.type).toBe('response')
    expect((res.payload as any).id).toBe(2)
  })

  it('posts.delete (not found) → error', async () => {
    const ws = await wsConnect(BASE + 2)
    const res = await sendAndReceive(ws, {
      id: 'r10', procedure: 'posts.delete', type: 'request', payload: { id: 9999 },
    })
    ws.close()
    expect(res.type).toBe('error')
  })
})

// ── $watch real-time stream ────────────────────────────────────────────────

describe('createJsonServer — $watch stream', () => {
  let server: Awaited<ReturnType<typeof createJsonServer>>['server']

  beforeAll(async () => {
    ({ server } = await createJsonServer({
      port: BASE + 3,
      db: { posts: [{ id: 1, title: 'Initial' }] },
      protocols: { ws: true },
    }))
  })

  afterAll(async () => { await server.stop() })

  it('yields StoreEvents when resource changes', async () => {
    const ws = await wsConnect(BASE + 3)

    // Collect stream:start + stream:data
    const messagesPromise = collectWsMessages(ws, 2)

    ws.send(JSON.stringify({
      id: 'w1',
      procedure: 'posts.$watch',
      type: 'stream:start',
      payload: {},
    }))

    // Give generator time to reach its await point (subscription active)
    await new Promise(r => setTimeout(r, 50))

    // Trigger a mutation via HTTP
    await http(BASE + 3, '/posts', { method: 'POST', body: { title: 'Watched' } })

    const messages = await messagesPromise
    ws.close()

    const start = messages.find(m => m.type === 'stream:start')
    const data = messages.find(m => m.type === 'stream:data')

    expect(start).toBeDefined()
    expect(data).toBeDefined()
    expect((data!.payload as any).op).toBe('create')
    expect((data!.payload as any).resource).toBe('posts')
  })
})

// ── File persistence ───────────────────────────────────────────────────────

describe('createJsonServer — file database', () => {
  const tmp = join(tmpdir(), `raffel-jsonsrv-${Date.now()}.json`)
  let server: Awaited<ReturnType<typeof createJsonServer>>['server']

  beforeAll(async () => {
    writeFileSync(tmp, JSON.stringify({ items: [{ id: 1, name: 'Widget' }] }))
    ;({ server } = await createJsonServer({
      port: BASE + 4,
      db: tmp,
      protocols: { ws: false },
    }))
  })

  afterAll(async () => {
    await server.stop()
    try { unlinkSync(tmp) } catch { /* ignore */ }
  })

  it('loads initial data from file', async () => {
    const res = await http(BASE + 4, '/items')
    const body = await res.json() as any
    expect(body.data[0].name).toBe('Widget')
  })

  it('persists mutations back to the file', async () => {
    await http(BASE + 4, '/items', { method: 'POST', body: { name: 'Gadget' } })
    await new Promise(r => setTimeout(r, 200)) // wait for 100ms debounce + buffer
    const saved = JSON.parse(readFileSync(tmp, 'utf8'))
    expect(saved.items).toHaveLength(2)
    expect(saved.items[1].name).toBe('Gadget')
  })
})

// ── Misc options ───────────────────────────────────────────────────────────

describe('createJsonServer — misc options', () => {

  it('calls onListen when server is ready', async () => {
    let called = false
    const { server } = await createJsonServer({
      port: BASE + 5,
      db: { posts: [] },
      protocols: { ws: false },
      onListen: () => { called = true },
    })
    expect(called).toBe(true)
    await server.stop()
  })

  it('simulates delay (response arrives after delay ms)', async () => {
    const { server } = await createJsonServer({
      port: BASE + 6,
      db: { posts: [{ id: 1, title: 'Slow' }] },
      protocols: { ws: false },
      delay: 80,
    })
    const start = Date.now()
    await http(BASE + 6, '/posts')
    const elapsed = Date.now() - start
    await server.stop()
    expect(elapsed).toBeGreaterThanOrEqual(70)
  })

  it('enables JSON-RPC and exposes procedures on /rpc', async () => {
    const { server } = await createJsonServer({
      port: BASE + 7,
      db: { posts: [{ id: 1, title: 'JRPC' }] },
      protocols: { ws: false, jsonrpc: true },
    })
    const res = await fetch(`http://localhost:${BASE + 7}/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'posts.list', params: {}, id: 1 }),
    })
    await server.stop()
    expect(res.status).toBe(200)
    const body = await res.json() as any
    expect(body.result.data).toHaveLength(1)
  })

  it('ws: false disables WebSocket', async () => {
    const { server } = await createJsonServer({
      port: BASE + 9,
      db: { posts: [] },
      protocols: { ws: false },
    })
    // WS connection should fail (server not upgraded)
    await expect(wsConnect(BASE + 9)).rejects.toThrow()
    await server.stop()
  })
})

// ── createJsonModule — manual mounting ────────────────────────────────────

describe('createJsonModule', () => {
  it('returns module, middleware and store', () => {
    const { module, middleware, store } = createJsonModule({
      posts: [{ id: 1, title: 'Test' }],
    })
    expect(module).toBeDefined()
    expect(typeof middleware).toBe('function')
    expect(store.resources()).toContain('posts')
  })

  it('can be mounted on an existing createServer', async () => {
    const { module, middleware, store } = createJsonModule({
      widgets: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
    })

    const server = createServer({ port: BASE + 8, http: { middleware: [middleware] } })
    server.mount('', module)
    await server.start()

    const res = await http(BASE + 8, '/widgets')
    const body = await res.json() as any

    await server.stop()

    expect(res.status).toBe(200)
    expect(body.total).toBe(2)
    expect(store.list('widgets').data).toHaveLength(2)
  })

  it('respects readonly option', async () => {
    const { middleware } = createJsonModule({ items: [{ id: 1 }] }, { readonly: true })

    const server = createServer({ port: BASE + 10, http: { middleware: [middleware] } })
    await server.start()

    const res = await http(BASE + 10, '/items', { method: 'POST', body: { name: 'x' } })
    await server.stop()

    expect(res.status).toBe(405)
  })
})
