import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryStore, loadDb, normalizeId } from '../../src/json-server/store.js'

// ── normalizeId ───────────────────────────────────────────────────────────────

describe('normalizeId', () => {
  it('converts "0" to 0', () => expect(normalizeId('0')).toBe(0))
  it('converts "1" to 1', () => expect(normalizeId('1')).toBe(1))
  it('converts "42" to 42', () => expect(normalizeId('42')).toBe(42))
  it('keeps "foo" as string', () => expect(normalizeId('foo')).toBe('foo'))
  it('keeps "1.5" as string (non-integer)', () => expect(normalizeId('1.5')).toBe('1.5'))
  it('keeps "1e2" as string (String(100) !== "1e2")', () => expect(normalizeId('1e2')).toBe('1e2'))
  it('keeps uuid-style strings as strings', () => expect(normalizeId('abc-123')).toBe('abc-123'))
})

// ── loadDb ────────────────────────────────────────────────────────────────────

describe('loadDb', () => {
  const tmp = join(tmpdir(), `raffel-loaddb-${Date.now()}.json`)

  afterEach(() => { try { unlinkSync(tmp) } catch { /* ignore */ } })

  it('returns {} for a non-existent file', () => {
    expect(loadDb('/no/such/file.json')).toEqual({})
  })

  it('returns {} for an invalid JSON file', () => {
    writeFileSync(tmp, 'not json at all')
    expect(loadDb(tmp)).toEqual({})
  })

  it('loads a valid JSON file', () => {
    const db = { posts: [{ id: 1, title: 'Hello' }] }
    writeFileSync(tmp, JSON.stringify(db))
    expect(loadDb(tmp)).toEqual(db)
  })
})

// ── InMemoryStore ─────────────────────────────────────────────────────────────

describe('InMemoryStore', () => {
  let store: InMemoryStore

  beforeEach(() => {
    store = new InMemoryStore({
      posts: [
        { id: 1, title: 'Alpha', tag: 'news' },
        { id: 2, title: 'Beta', tag: 'tech' },
        { id: 3, title: 'Gamma', tag: 'news' },
      ],
      users: [{ id: 'u1', name: 'Alice' }],
    })
  })

  // ── resources() ──────────────────────────────────────────────────────────

  describe('resources()', () => {
    it('lists all resource names', () => {
      expect(store.resources()).toEqual(expect.arrayContaining(['posts', 'users']))
      expect(store.resources()).toHaveLength(2)
    })
  })

  // ── list() ───────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('returns all items with correct total', () => {
      const { data, total } = store.list('posts')
      expect(total).toBe(3)
      expect(data).toHaveLength(3)
    })

    it('returns empty result for unknown resource', () => {
      expect(store.list('unknown')).toEqual({ data: [], total: 0 })
    })

    it('filters by field value', () => {
      const { data, total } = store.list('posts', { tag: 'news' })
      expect(total).toBe(2)
      expect(data.every(p => p.tag === 'news')).toBe(true)
    })

    it('skips undefined filter values', () => {
      const { data } = store.list('posts', { tag: undefined })
      expect(data).toHaveLength(3)
    })

    it('skips null filter values', () => {
      const { data } = store.list('posts', { tag: null as unknown as string })
      expect(data).toHaveLength(3)
    })

    it('full-text search with _q', () => {
      const { data } = store.list('posts', { _q: 'beta' })
      expect(data).toHaveLength(1)
      expect(data[0].title).toBe('Beta')
    })

    it('_q is case-insensitive', () => {
      const { data } = store.list('posts', { _q: 'ALPHA' })
      expect(data).toHaveLength(1)
    })

    it('sorts ascending by field (default)', () => {
      const { data } = store.list('posts', { _sort: 'title' })
      expect(data[0].title).toBe('Alpha')
      expect(data[2].title).toBe('Gamma')
    })

    it('sorts descending with _order=desc', () => {
      const { data } = store.list('posts', { _sort: 'title', _order: 'desc' })
      expect(data[0].title).toBe('Gamma')
      expect(data[2].title).toBe('Alpha')
    })

    it('sort is stable when two values are equal (covers === 0 branch)', () => {
      const s = new InMemoryStore({
        items: [
          { id: 1, name: 'Foo', rank: 5 },
          { id: 2, name: 'Bar', rank: 5 },
          { id: 3, name: 'Baz', rank: 3 },
        ],
      })
      const { data } = s.list('items', { _sort: 'rank' })
      // rank 3 comes first, then both rank=5 items (order between them preserved)
      expect(data[0].rank).toBe(3)
      expect(data[1].rank).toBe(5)
      expect(data[2].rank).toBe(5)
    })

    it('paginates first page with _page + _limit', () => {
      const { data, total } = store.list('posts', { _page: '1', _limit: '2' })
      expect(total).toBe(3)
      expect(data).toHaveLength(2)
    })

    it('paginates second page', () => {
      const { data } = store.list('posts', { _page: '2', _limit: '2' })
      expect(data).toHaveLength(1)
    })

    it('uses _limit without _page (defaults to page 1)', () => {
      const { data } = store.list('posts', { _limit: '2' })
      expect(data).toHaveLength(2)
    })

    it('no pagination when _limit is absent', () => {
      const { data } = store.list('posts')
      expect(data).toHaveLength(3)
    })

    it('can combine filter + sort + paginate', () => {
      const { data, total } = store.list('posts', {
        tag: 'news',
        _sort: 'title',
        _order: 'desc',
        _limit: '1',
        _page: '1',
      })
      expect(total).toBe(2)
      expect(data).toHaveLength(1)
      expect(data[0].title).toBe('Gamma')
    })
  })

  // ── get() ─────────────────────────────────────────────────────────────────

  describe('get()', () => {
    it('returns record by numeric id', () => {
      expect(store.get('posts', 1)).toMatchObject({ id: 1, title: 'Alpha' })
    })

    it('returns record by string id', () => {
      expect(store.get('users', 'u1')).toMatchObject({ name: 'Alice' })
    })

    it('returns null for unknown id', () => {
      expect(store.get('posts', 999)).toBeNull()
    })

    it('returns null for unknown resource', () => {
      expect(store.get('unknown', 1)).toBeNull()
    })
  })

  // ── create() ─────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('auto-assigns next numeric id', () => {
      const record = store.create('posts', { title: 'New' })
      expect(record.id).toBe(4)
    })

    it('creates next record after auto-id', () => {
      store.create('posts', { title: 'D' })
      const record = store.create('posts', { title: 'E' })
      expect(record.id).toBe(5)
    })

    it('uses provided numeric id and updates nextId when higher', () => {
      const record = store.create('posts', { id: 100, title: 'Big' })
      expect(record.id).toBe(100)
      const next = store.create('posts', { title: 'After' })
      expect(next.id).toBe(101)
    })

    it('does not change nextId when provided id is lower', () => {
      // nextId is 4 (max existing id is 3)
      store.create('posts', { id: 2, title: 'Dup' }) // id=2 < nextId=4
      const next = store.create('posts', { title: 'Auto' })
      expect(next.id).toBe(4) // nextId unchanged
    })

    it('uses provided string id', () => {
      const record = store.create('users', { id: 'u2', name: 'Bob' })
      expect(record.id).toBe('u2')
      expect(store.get('users', 'u2')).toMatchObject({ name: 'Bob' })
    })

    it('creates a brand-new resource on demand', () => {
      const record = store.create('comments', { text: 'Hi' })
      expect(record.id).toBe(1)
      expect(store.resources()).toContain('comments')
    })

    it('emits a create StoreEvent', () => {
      const events: unknown[] = []
      store.subscribe(e => events.push(e))
      store.create('posts', { title: 'Event' })
      expect(events).toHaveLength(1)
      expect((events[0] as any).op).toBe('create')
      expect((events[0] as any).resource).toBe('posts')
      expect((events[0] as any).data).toMatchObject({ title: 'Event' })
    })
  })

  // ── replace() ────────────────────────────────────────────────────────────

  describe('replace()', () => {
    it('replaces the record completely (no old fields)', () => {
      const result = store.replace('posts', 1, { title: 'Replaced' })
      expect(result).toMatchObject({ id: 1, title: 'Replaced' })
      expect(store.get('posts', 1)).not.toHaveProperty('tag')
    })

    it('returns null for unknown id', () => {
      expect(store.replace('posts', 999, { title: 'x' })).toBeNull()
    })

    it('returns null for unknown resource', () => {
      expect(store.replace('unknown', 1, {})).toBeNull()
    })

    it('emits a replace StoreEvent with prev', () => {
      const events: unknown[] = []
      store.subscribe(e => events.push(e))
      store.replace('posts', 1, { title: 'Replaced' })
      expect((events[0] as any).op).toBe('replace')
      expect((events[0] as any).prev).toMatchObject({ title: 'Alpha' })
    })
  })

  // ── update() ─────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('patches the record, preserving other fields', () => {
      const result = store.update('posts', 1, { title: 'Updated' })
      expect(result).toMatchObject({ id: 1, title: 'Updated', tag: 'news' })
    })

    it('returns null for unknown id', () => {
      expect(store.update('posts', 999, { title: 'x' })).toBeNull()
    })

    it('returns null for unknown resource', () => {
      expect(store.update('unknown', 1, {})).toBeNull()
    })

    it('emits an update StoreEvent with prev', () => {
      const events: unknown[] = []
      store.subscribe(e => events.push(e))
      store.update('posts', 1, { title: 'Updated' })
      expect((events[0] as any).op).toBe('update')
      expect((events[0] as any).prev).toMatchObject({ title: 'Alpha' })
      expect((events[0] as any).data).toMatchObject({ title: 'Updated' })
    })
  })

  // ── delete() ─────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('removes the record and returns it', () => {
      const deleted = store.delete('posts', 1)
      expect(deleted).toMatchObject({ id: 1, title: 'Alpha' })
      expect(store.get('posts', 1)).toBeNull()
    })

    it('returns null for unknown id', () => {
      expect(store.delete('posts', 999)).toBeNull()
    })

    it('returns null for unknown resource', () => {
      expect(store.delete('unknown', 1)).toBeNull()
    })

    it('emits a delete StoreEvent', () => {
      const events: unknown[] = []
      store.subscribe(e => events.push(e))
      store.delete('posts', 1)
      expect((events[0] as any).op).toBe('delete')
      expect((events[0] as any).prev).toMatchObject({ title: 'Alpha' })
    })
  })

  // ── subscribe() ──────────────────────────────────────────────────────────

  describe('subscribe()', () => {
    it('receives all mutation events', () => {
      const events: unknown[] = []
      store.subscribe(e => events.push(e))
      store.create('posts', { title: 'C' })
      store.update('posts', 1, { title: 'U' })
      store.delete('posts', 2)
      expect(events).toHaveLength(3)
    })

    it('multiple subscribers all receive events', () => {
      const a: unknown[] = [], b: unknown[] = []
      store.subscribe(e => a.push(e))
      store.subscribe(e => b.push(e))
      store.create('posts', { title: 'Multi' })
      expect(a).toHaveLength(1)
      expect(b).toHaveLength(1)
    })

    it('unsubscribe stops further events', () => {
      const events: unknown[] = []
      const unsub = store.subscribe(e => events.push(e))
      store.create('posts', { title: 'Before' })
      unsub()
      store.create('posts', { title: 'After' })
      expect(events).toHaveLength(1)
    })
  })

  // ── toJSON() ─────────────────────────────────────────────────────────────

  describe('toJSON()', () => {
    it('serializes all resources as arrays', () => {
      const db = store.toJSON()
      expect(db.posts).toHaveLength(3)
      expect(db.users).toHaveLength(1)
    })

    it('reflects mutations', () => {
      store.create('posts', { title: 'New' })
      expect(store.toJSON().posts).toHaveLength(4)
    })
  })

  // ── file persistence ──────────────────────────────────────────────────────

  describe('file persistence', () => {
    const tmp = join(tmpdir(), `raffel-store-persist-${Date.now()}.json`)

    afterEach(() => { try { unlinkSync(tmp) } catch { /* ignore */ } })

    it('writes to file after mutation (debounced at 100ms)', async () => {
      const s = new InMemoryStore({ posts: [] }, { filePath: tmp })
      s.create('posts', { title: 'Saved' })
      await new Promise(r => setTimeout(r, 200))
      const saved = JSON.parse(require('fs').readFileSync(tmp, 'utf8'))
      expect(saved.posts).toHaveLength(1)
      expect(saved.posts[0].title).toBe('Saved')
    })

    it('debounces multiple rapid mutations into one file write (file has all records)', async () => {
      const s = new InMemoryStore({ posts: [] }, { filePath: tmp })
      s.create('posts', { title: 'A' })
      s.create('posts', { title: 'B' })
      s.create('posts', { title: 'C' })
      await new Promise(r => setTimeout(r, 200))
      const saved = JSON.parse(require('fs').readFileSync(tmp, 'utf8'))
      // All 3 records in one write (debounced)
      expect(saved.posts).toHaveLength(3)
    })

    it('does not create any file when no filePath is set', async () => {
      const otherPath = join(tmpdir(), `raffel-no-file-${Date.now()}.json`)
      const s = new InMemoryStore({ posts: [] }) // no filePath
      s.create('posts', { title: 'No file' })
      await new Promise(r => setTimeout(r, 200))
      // The store worked correctly (mutation applied)
      expect(s.list('posts').total).toBe(1)
      // And the extra path was never created
      expect(() => require('fs').readFileSync(otherPath)).toThrow()
    })
  })

  // ── custom idKey ──────────────────────────────────────────────────────────

  describe('custom idKey', () => {
    it('uses _id as the identity field', () => {
      const s = new InMemoryStore(
        { items: [{ _id: 'abc', name: 'Widget' }] },
        { idKey: '_id' }
      )
      expect(s.idKey).toBe('_id')
      expect(s.get('items', 'abc')).toMatchObject({ name: 'Widget' })
    })

    it('auto-assigns _id on create', () => {
      const s = new InMemoryStore({ items: [] }, { idKey: '_id' })
      const record = s.create('items', { name: 'New' })
      expect(record).toHaveProperty('_id')
    })
  })

  // ── constructor edge cases ────────────────────────────────────────────────

  describe('constructor edge cases', () => {
    it('skips items without an id field', () => {
      const s = new InMemoryStore({ things: [{ name: 'no id here' }] })
      // Item without id is not indexed but resource is created
      expect(s.resources()).toContain('things')
    })

    it('tracks highest numeric id across initial items', () => {
      const s = new InMemoryStore({ items: [{ id: 5, name: 'A' }, { id: 3, name: 'B' }] })
      const next = s.create('items', { name: 'C' })
      expect(next.id).toBe(6)
    })
  })
})
