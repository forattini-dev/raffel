/**
 * Resource Module — Integration Tests
 *
 * Tests CRUD procedures + $watch stream via WebSocket against a real Raffel server.
 *
 * Port range: 24200–24209
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import { createResourceModule } from '../../src/resource-module/index.js'
import { createGuardInterceptor } from '../../src/middleware/interceptors/guard.js'
import { createServer } from '../../src/server/builder.js'
import type { ResourceAdapter, ResourceChangeEvent } from '../../src/resource-module/types.js'

const BASE = 24200

// ── In-memory mock adapter ──────────────────────────────────────────────────

interface Record {
  id: string
  name: string
  status?: string
  password?: string
}

function createMockAdapter(): ResourceAdapter<Record> & { data: Map<string, Record>; listeners: Set<(e: ResourceChangeEvent<Record>) => void> } {
  const data = new Map<string, Record>()
  const listeners = new Set<(e: ResourceChangeEvent<Record>) => void>()
  let idCounter = 0

  return {
    data,
    listeners,
    get: (id) => data.get(String(id)) ?? null,
    list: (query) => {
      let items = [...data.values()]
      // Simple status filter
      if (query.status) {
        items = items.filter((r) => r.status === query.status)
      }
      return { data: items, total: items.length }
    },
    create: (input) => {
      const record = { id: String(++idCounter), ...input as Partial<Record>, name: (input as Partial<Record>).name ?? 'unnamed' }
      data.set(record.id, record)
      const event: ResourceChangeEvent<Record> = { op: 'create', id: record.id, data: record }
      for (const cb of listeners) cb(event)
      return record
    },
    update: (id, patch) => {
      const existing = data.get(String(id))
      if (!existing) return null
      const updated = { ...existing, ...(patch as Partial<Record>) }
      data.set(String(id), updated)
      const event: ResourceChangeEvent<Record> = { op: 'update', id: updated.id, data: updated, previous: existing }
      for (const cb of listeners) cb(event)
      return updated
    },
    delete: (id) => {
      const existing = data.get(String(id))
      if (!existing) return null
      data.delete(String(id))
      const event: ResourceChangeEvent<Record> = { op: 'delete', id: existing.id, data: null, previous: existing }
      for (const cb of listeners) cb(event)
      return existing
    },
    subscribe: (cb) => {
      listeners.add(cb)
      return () => { listeners.delete(cb) }
    },
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function wsConnect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

function sendAndReceive(ws: WebSocket, msg: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WS timeout')), 5000)
    ws.once('message', (data) => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()))
    })
    ws.send(JSON.stringify(msg))
  })
}

function collectStreamData(ws: WebSocket, count: number, timeout = 5000): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const messages: any[] = []
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${count} stream:data messages, got ${messages.length}`)), timeout)
    const handler = (data: Buffer) => {
      const parsed = JSON.parse(data.toString())
      // Only collect stream:data messages (skip stream:start, etc.)
      if (parsed.type === 'stream:data') {
        messages.push(parsed)
        if (messages.length >= count) {
          clearTimeout(timer)
          ws.off('message', handler)
          resolve(messages)
        }
      }
    }
    ws.on('message', handler)
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Resource Module — CRUD via WebSocket', () => {
  const port = BASE
  const adapter = createMockAdapter()
  let server: ReturnType<typeof createServer>

  beforeAll(async () => {
    const module = createResourceModule({
      name: 'items',
      adapter,
      fields: { protectedFields: ['password'] },
    })

    server = createServer({ port, host: '127.0.0.1' })
    server.enableWebSocket('/ws')
    server.mount('', module)
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  it('creates a record', async () => {
    const ws = await wsConnect(port)
    const res = await sendAndReceive(ws, {
      id: 'req-1',
      procedure: 'items.create',
      type: 'request',
      payload: { name: 'Widget', status: 'active' },
    })
    expect(res.type).toBe('response')
    expect(res.payload).toMatchObject({ name: 'Widget', status: 'active' })
    expect(res.payload.id).toBeDefined()
    ws.close()
  })

  it('gets a record by id', async () => {
    const ws = await wsConnect(port)
    const res = await sendAndReceive(ws, {
      id: 'req-2',
      procedure: 'items.get',
      type: 'request',
      payload: { id: '1' },
    })
    expect(res.type).toBe('response')
    expect(res.payload.name).toBe('Widget')
    ws.close()
  })

  it('lists records', async () => {
    const ws = await wsConnect(port)
    const res = await sendAndReceive(ws, {
      id: 'req-3',
      procedure: 'items.list',
      type: 'request',
      payload: {},
    })
    expect(res.type).toBe('response')
    expect(res.payload.data).toBeInstanceOf(Array)
    expect(res.payload.data.length).toBeGreaterThanOrEqual(1)
    ws.close()
  })

  it('updates a record', async () => {
    const ws = await wsConnect(port)
    const res = await sendAndReceive(ws, {
      id: 'req-4',
      procedure: 'items.update',
      type: 'request',
      payload: { id: '1', status: 'inactive' },
    })
    expect(res.type).toBe('response')
    expect(res.payload.status).toBe('inactive')
    ws.close()
  })

  it('deletes a record', async () => {
    // First create one to delete
    adapter.data.set('99', { id: '99', name: 'ToDelete' })

    const ws = await wsConnect(port)
    const res = await sendAndReceive(ws, {
      id: 'req-5',
      procedure: 'items.delete',
      type: 'request',
      payload: { id: '99' },
    })
    expect(res.type).toBe('response')
    expect(res.payload.name).toBe('ToDelete')
    expect(adapter.data.has('99')).toBe(false)
    ws.close()
  })

  it('returns NOT_FOUND for missing record', async () => {
    const ws = await wsConnect(port)
    const res = await sendAndReceive(ws, {
      id: 'req-6',
      procedure: 'items.get',
      type: 'request',
      payload: { id: 'nonexistent' },
    })
    expect(res.payload.code).toBe('NOT_FOUND')
    ws.close()
  })

  it('strips protected fields from responses', async () => {
    adapter.data.set('pw-1', { id: 'pw-1', name: 'Secure', password: 'secret123' })

    const ws = await wsConnect(port)
    const res = await sendAndReceive(ws, {
      id: 'req-7',
      procedure: 'items.get',
      type: 'request',
      payload: { id: 'pw-1' },
    })
    expect(res.type).toBe('response')
    expect(res.payload.name).toBe('Secure')
    expect(res.payload.password).toBeUndefined()
    ws.close()
  })
})

describe('Resource Module — $watch stream', () => {
  const port = BASE + 1
  const adapter = createMockAdapter()
  let server: ReturnType<typeof createServer>

  beforeAll(async () => {
    const module = createResourceModule({
      name: 'orders',
      adapter,
    })

    server = createServer({ port, host: '127.0.0.1' })
    server.enableWebSocket('/ws')
    server.mount('', module)
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  it('receives real-time events via $watch', async () => {
    const ws = await wsConnect(port)

    // Start watch stream
    ws.send(JSON.stringify({
      id: 'watch-1',
      procedure: 'orders.$watch',
      type: 'stream:start',
      payload: {},
    }))

    // Wait a bit for stream to be set up
    await new Promise((r) => setTimeout(r, 50))

    // Trigger a change
    const collecting = collectStreamData(ws, 1, 3000)
    adapter.create!({ name: 'Order A', status: 'pending' }, {} as any)

    const messages = await collecting
    expect(messages[0].payload.op).toBe('create')
    expect(messages[0].payload.data.name).toBe('Order A')

    // Cancel stream
    ws.send(JSON.stringify({ id: 'watch-1', type: 'cancel' }))
    await new Promise((r) => setTimeout(r, 50))
    ws.close()
  })
})

describe('Resource Module — Guards', () => {
  const port = BASE + 2
  const adapter = createMockAdapter()
  let server: ReturnType<typeof createServer>

  beforeAll(async () => {
    const requireAdmin = createGuardInterceptor(
      (_input, ctx) => (ctx as any).auth?.hasRole?.('admin') ?? false,
      { code: 'FORBIDDEN', message: 'Admin only' }
    )

    const module = createResourceModule({
      name: 'users',
      adapter,
      guards: {
        delete: requireAdmin,
      },
    })

    server = createServer({ port, host: '127.0.0.1' })
    server.enableWebSocket('/ws')
    server.mount('', module)
    await server.start()
  })

  afterAll(async () => {
    await server.stop()
  })

  it('blocks guarded operations when guard fails', async () => {
    adapter.data.set('u1', { id: 'u1', name: 'Bob' })

    const ws = await wsConnect(port)
    const res = await sendAndReceive(ws, {
      id: 'req-guard-1',
      procedure: 'users.delete',
      type: 'request',
      payload: { id: 'u1' },
    })
    // Should get a FORBIDDEN error
    expect(res.payload.code).toBe('FORBIDDEN')
    expect(res.payload.message).toBe('Admin only')
    // Record should still exist
    expect(adapter.data.has('u1')).toBe(true)
    ws.close()
  })

  it('allows non-guarded operations', async () => {
    const ws = await wsConnect(port)
    const res = await sendAndReceive(ws, {
      id: 'req-guard-2',
      procedure: 'users.get',
      type: 'request',
      payload: { id: 'u1' },
    })
    expect(res.type).toBe('response')
    expect(res.payload.name).toBe('Bob')
    ws.close()
  })
})
