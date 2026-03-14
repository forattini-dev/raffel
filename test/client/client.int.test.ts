/**
 * Raffel Client SDK — Integration Tests
 *
 * Tests the client against a real Raffel server with procedures and streams.
 *
 * Port range: 24210–24219
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRaffelClient } from '../../src/client/index.js'
import { createResourceModule } from '../../src/resource-module/index.js'
import { createServer } from '../../src/server/builder.js'
import type { ResourceAdapter, ResourceChangeEvent } from '../../src/resource-module/types.js'

const BASE = 24210

// ── In-memory mock adapter ──────────────────────────────────────────────────

interface MockRecord {
  id: string
  name: string
  status?: string
}

function createMockAdapter(): ResourceAdapter<MockRecord> & {
  data: Map<string, MockRecord>
  listeners: Set<(e: ResourceChangeEvent<MockRecord>) => void>
} {
  const data = new Map<string, MockRecord>()
  const listeners = new Set<(e: ResourceChangeEvent<MockRecord>) => void>()
  let idCounter = 0

  return {
    data,
    listeners,
    get: (id) => data.get(String(id)) ?? null,
    list: () => ({ data: [...data.values()], total: data.size }),
    create: (input) => {
      const record: MockRecord = { id: String(++idCounter), ...input as Partial<MockRecord>, name: (input as any).name ?? 'unnamed' }
      data.set(record.id, record)
      const event: ResourceChangeEvent<MockRecord> = { op: 'create', id: record.id, data: record }
      for (const cb of listeners) cb(event)
      return record
    },
    update: (id, patch) => {
      const existing = data.get(String(id))
      if (!existing) return null
      const updated = { ...existing, ...(patch as Partial<MockRecord>) }
      data.set(String(id), updated)
      const event: ResourceChangeEvent<MockRecord> = { op: 'update', id: updated.id, data: updated }
      for (const cb of listeners) cb(event)
      return updated
    },
    delete: (id) => {
      const existing = data.get(String(id))
      if (!existing) return null
      data.delete(String(id))
      const event: ResourceChangeEvent<MockRecord> = { op: 'delete', id: existing.id, data: null }
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

function waitForConnected(client: ReturnType<typeof createRaffelClient>, timeout = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (client.connected) { resolve(); return }
    const start = Date.now()
    const check = setInterval(() => {
      if (client.connected) { clearInterval(check); resolve(); return }
      if (Date.now() - start > timeout) { clearInterval(check); reject(new Error('Connect timeout')); return }
    }, 20)
  })
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Raffel Client SDK — RPC calls', () => {
  const port = BASE
  const adapter = createMockAdapter()
  let server: ReturnType<typeof createServer>
  let client: ReturnType<typeof createRaffelClient>

  beforeAll(async () => {
    const module = createResourceModule({ name: 'products', adapter })
    server = createServer({ port, host: '127.0.0.1' })
    server.enableWebSocket('/ws')
    server.mount('', module)
    await server.start()

    client = createRaffelClient({ url: `ws://127.0.0.1:${port}/ws`, reconnect: false })
    await waitForConnected(client)
  })

  afterAll(async () => {
    client.close()
    await server.stop()
  })

  it('calls create procedure', async () => {
    const result = await client.call<any, any>('products.create', { name: 'Laptop', status: 'available' })
    expect(result.name).toBe('Laptop')
    expect(result.id).toBeDefined()
  })

  it('calls get procedure', async () => {
    const result = await client.call<any, any>('products.get', { id: '1' })
    expect(result.name).toBe('Laptop')
  })

  it('calls list procedure', async () => {
    const result = await client.call<any, any>('products.list', {})
    expect(result.data).toBeInstanceOf(Array)
    expect(result.data.length).toBe(1)
  })

  it('calls update procedure', async () => {
    const result = await client.call<any, any>('products.update', { id: '1', status: 'sold' })
    expect(result.status).toBe('sold')
  })

  it('calls delete procedure', async () => {
    const result = await client.call<any, any>('products.delete', { id: '1' })
    expect(result.name).toBe('Laptop')
    expect(adapter.data.has('1')).toBe(false)
  })

  it('handles NOT_FOUND error', async () => {
    await expect(
      client.call('products.get', { id: 'nonexistent' })
    ).rejects.toThrow()
  })
})

describe('Raffel Client SDK — Server Streams', () => {
  const port = BASE + 1
  const adapter = createMockAdapter()
  let server: ReturnType<typeof createServer>
  let client: ReturnType<typeof createRaffelClient>

  beforeAll(async () => {
    const module = createResourceModule({ name: 'events', adapter })
    server = createServer({ port, host: '127.0.0.1' })
    server.enableWebSocket('/ws')
    server.mount('', module)
    await server.start()

    client = createRaffelClient({ url: `ws://127.0.0.1:${port}/ws`, reconnect: false })
    await waitForConnected(client)
  })

  afterAll(async () => {
    client.close()
    await server.stop()
  })

  it('receives stream events and can cancel', async () => {
    const stream = client.stream<any>('events.$watch', {})

    // Wait for stream to be set up
    await new Promise((r) => setTimeout(r, 50))

    // Trigger some changes
    adapter.create!({ name: 'Event 1' }, {} as any)
    adapter.create!({ name: 'Event 2' }, {} as any)

    const received: any[] = []
    const iterator = stream[Symbol.asyncIterator]()

    // Collect 2 events
    const r1 = await iterator.next()
    received.push(r1.value)
    const r2 = await iterator.next()
    received.push(r2.value)

    expect(received.length).toBe(2)
    expect(received[0].op).toBe('create')
    expect(received[0].data.name).toBe('Event 1')
    expect(received[1].op).toBe('create')
    expect(received[1].data.name).toBe('Event 2')

    // Cancel
    stream.cancel()
  })
})

describe('Raffel Client SDK — Integration flow', () => {
  const port = BASE + 2
  const adapter = createMockAdapter()
  let server: ReturnType<typeof createServer>

  beforeAll(async () => {
    const module = createResourceModule({
      name: 'tasks',
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

  it('full CRUD + watch flow simulating s3db usage', async () => {
    const client = createRaffelClient({ url: `ws://127.0.0.1:${port}/ws`, reconnect: false })
    await waitForConnected(client)

    // Start watching
    const stream = client.stream<any>('tasks.$watch', {})
    await new Promise((r) => setTimeout(r, 50))

    // Create
    const created = await client.call<any, any>('tasks.create', {
      name: 'Deploy app',
      status: 'pending',
      password: 'secret',
    })
    expect(created.name).toBe('Deploy app')
    // password should be stripped
    expect(created.password).toBeUndefined()

    // Get (also stripped)
    const got = await client.call<any, any>('tasks.get', { id: created.id })
    expect(got.name).toBe('Deploy app')
    expect(got.password).toBeUndefined()

    // Update
    const updated = await client.call<any, any>('tasks.update', { id: created.id, status: 'done' })
    expect(updated.status).toBe('done')

    // List
    const listed = await client.call<any, any>('tasks.list', {})
    expect(listed.data.length).toBe(1)

    // Collect watch events (should have received create + update)
    const iterator = stream[Symbol.asyncIterator]()
    const e1 = await iterator.next()
    expect(e1.value.op).toBe('create')
    const e2 = await iterator.next()
    expect(e2.value.op).toBe('update')

    // Delete
    await client.call('tasks.delete', { id: created.id })
    const e3 = await iterator.next()
    expect(e3.value.op).toBe('delete')

    stream.cancel()
    client.close()
  })
})
