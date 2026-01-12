/**
 * S3DB Adapter Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createS3DBAdapter,
  createS3DBContextInterceptor,
  generateS3DBHttpPaths,
} from './adapter.js'
import type { S3DBResourceLike } from './types.js'
import { createServer } from '../../server/index.js'
import { createContext, type Envelope } from '../../types/index.js'

/**
 * Create a mock s3db resource
 */
function createMockResource(name: string, data: Record<string, unknown>[] = []): S3DBResourceLike {
  const store = new Map<string, Record<string, unknown>>()

  // Initialize with data
  data.forEach((item) => {
    if (item.id) {
      store.set(item.id as string, item)
    }
  })

  return {
    name,
    version: 'v1',
    config: {
      currentVersion: 'v1',
      attributes: { name: 'string', email: 'string' },
    },
    $schema: {
      api: {
        protected: ['password'],
      },
    },

    async list(options = {}) {
      const { limit = 100, offset = 0 } = options
      const items = Array.from(store.values())
      return items.slice(offset, offset + limit)
    },

    async listPartition(options) {
      return this.list(options)
    },

    async query(filters, options = {}) {
      const { limit = 100, offset = 0 } = options
      const items = Array.from(store.values()).filter((item) => {
        return Object.entries(filters).every(([key, value]) => item[key] === value)
      })
      return items.slice(offset, offset + limit)
    },

    async get(id) {
      return store.get(id) || null
    },

    async getFromPartition(options) {
      return this.get(options.id)
    },

    async insert(data) {
      const id = data.id || `id-${Date.now()}`
      const record = { ...data, id, _createdAt: new Date().toISOString() }
      store.set(id as string, record)
      return record
    },

    async update(id, data) {
      const existing = store.get(id)
      if (!existing) throw new Error(`Not found: ${id}`)
      const updated = { ...existing, ...data, id, _updatedAt: new Date().toISOString() }
      store.set(id, updated)
      return updated
    },

    async delete(id) {
      if (!store.has(id)) throw new Error(`Not found: ${id}`)
      store.delete(id)
    },

    async count() {
      return store.size
    },
  }
}

/**
 * Create test envelope
 */
function createTestEnvelope(procedure: string, payload: unknown = {}, options?: { noAuth?: boolean }): Envelope {
  const ctx = createContext('test-id')
  if (!options?.noAuth) {
    ;(ctx as any).auth = {
      authenticated: true,
      principal: 'user-1',
      credentials: 'token',
      roles: ['user'],
    }
  }

  return {
    id: 'test-id',
    type: 'request',
    procedure,
    payload,
    metadata: {},
    context: ctx,
  }
}

/**
 * Helper to call router and get typed result
 */
async function callProcedure(
  server: ReturnType<typeof createServer>,
  procedure: string,
  payload?: unknown,
  options?: { noAuth?: boolean }
): Promise<Envelope> {
  return (await server.router.handle(createTestEnvelope(procedure, payload, options))) as Envelope
}

describe('createS3DBAdapter', () => {
  let mockUsers: S3DBResourceLike

  beforeEach(() => {
    mockUsers = createMockResource('users', [
      { id: 'user-1', name: 'Alice', email: 'alice@test.com', password: 'secret' },
      { id: 'user-2', name: 'Bob', email: 'bob@test.com', password: 'secret' },
    ])
  })

  describe('procedure generation', () => {
    it('should generate all CRUD procedures for a resource', () => {
      const server = createServer({ port: 0 })
      const module = createS3DBAdapter(mockUsers)

      server.mount('api', module)

      expect(server.registry.getProcedure('api.users.list')).toBeDefined()
      expect(server.registry.getProcedure('api.users.get')).toBeDefined()
      expect(server.registry.getProcedure('api.users.count')).toBeDefined()
      expect(server.registry.getProcedure('api.users.create')).toBeDefined()
      expect(server.registry.getProcedure('api.users.update')).toBeDefined()
      expect(server.registry.getProcedure('api.users.patch')).toBeDefined()
      expect(server.registry.getProcedure('api.users.delete')).toBeDefined()
    })

    it('should respect methods option', () => {
      const server = createServer({ port: 0 })
      const module = createS3DBAdapter(mockUsers, { methods: ['GET'] })

      server.mount('api', module)

      expect(server.registry.getProcedure('api.users.list')).toBeDefined()
      expect(server.registry.getProcedure('api.users.get')).toBeDefined()
      expect(server.registry.getProcedure('api.users.count')).toBeDefined()
      expect(server.registry.getProcedure('api.users.create')).toBeUndefined()
      expect(server.registry.getProcedure('api.users.update')).toBeUndefined()
      expect(server.registry.getProcedure('api.users.delete')).toBeUndefined()
    })

    it('should handle multiple resources', () => {
      const mockPosts = createMockResource('posts')
      const server = createServer({ port: 0 })
      const module = createS3DBAdapter([mockUsers, mockPosts])

      server.mount('api', module)

      expect(server.registry.getProcedure('api.users.list')).toBeDefined()
      expect(server.registry.getProcedure('api.posts.list')).toBeDefined()
    })
  })

  describe('list procedure', () => {
    it('should list all records', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.list')

      expect(result.type).toBe('response')
      expect((result.payload as any).data).toHaveLength(2)
      expect((result.payload as any).pagination).toEqual({
        total: 2,
        page: 1,
        pageSize: 100,
        pageCount: 1,
      })
    })

    it('should support pagination', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.list', { limit: 1, offset: 0 })

      expect((result.payload as any).data).toHaveLength(1)
      expect((result.payload as any).pagination.pageSize).toBe(1)
    })

    it('should support filters', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.list', { filters: { name: 'Alice' } })

      expect((result.payload as any).data).toHaveLength(1)
      expect((result.payload as any).data[0].name).toBe('Alice')
    })

    it('should filter protected fields', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.list')

      // Password should be filtered out
      expect((result.payload as any).data[0]).not.toHaveProperty('password')
      expect((result.payload as any).data[0]).toHaveProperty('name')
    })
  })

  describe('get procedure', () => {
    it('should get a single record by id', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.get', { id: 'user-1' })

      expect((result.payload as any).data.id).toBe('user-1')
      expect((result.payload as any).data.name).toBe('Alice')
    })

    it('should throw NOT_FOUND for non-existent record', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.get', { id: 'non-existent' })

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('NOT_FOUND')
    })

    it('should filter protected fields', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.get', { id: 'user-1' })

      expect((result.payload as any).data).not.toHaveProperty('password')
    })
  })

  describe('count procedure', () => {
    it('should return total count', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.count')

      expect((result.payload as any).count).toBe(2)
    })
  })

  describe('create procedure', () => {
    it('should create a new record', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.create', {
        data: { id: 'user-3', name: 'Charlie', email: 'charlie@test.com' },
      })

      expect((result.payload as any).data.id).toBe('user-3')
      expect((result.payload as any).data.name).toBe('Charlie')

      // Verify it was actually created
      const countResult = await callProcedure(server, 'api.users.count')
      expect((countResult.payload as any).count).toBe(3)
    })
  })

  describe('update procedure', () => {
    it('should update an existing record (full replacement)', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.update', {
        id: 'user-1',
        data: { name: 'Alice Updated', email: 'alice.new@test.com' },
      })

      expect((result.payload as any).data.name).toBe('Alice Updated')
      expect((result.payload as any).data.email).toBe('alice.new@test.com')
    })

    it('should throw NOT_FOUND for non-existent record', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.update', {
        id: 'non-existent',
        data: { name: 'Test' },
      })

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('NOT_FOUND')
    })
  })

  describe('patch procedure', () => {
    it('should partially update an existing record', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.patch', {
        id: 'user-1',
        data: { name: 'Alice Patched' },
      })

      expect((result.payload as any).data.name).toBe('Alice Patched')
      // Email should be preserved from original
      expect((result.payload as any).data.email).toBe('alice@test.com')
    })
  })

  describe('delete procedure', () => {
    it('should delete an existing record', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.delete', { id: 'user-1' })

      expect((result.payload as any).success).toBe(true)

      // Verify it was deleted
      const countResult = await callProcedure(server, 'api.users.count')
      expect((countResult.payload as any).count).toBe(1)
    })

    it('should throw NOT_FOUND for non-existent record', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers))

      const result = await callProcedure(server, 'api.users.delete', { id: 'non-existent' })

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('NOT_FOUND')
    })
  })

  describe('authorization', () => {
    it('should allow operations when guards pass', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers, {
        guards: {
          read: true,
          write: true,
          delete: true,
        },
      }))

      // Test list
      const listResult = await callProcedure(server, 'api.users.list')
      expect(listResult.type).toBe('response')

      // Test get
      const getResult = await callProcedure(server, 'api.users.get', { id: 'user-1' })
      expect(getResult.type).toBe('response')

      // Test create
      const createResult = await callProcedure(server, 'api.users.create', { data: { name: 'Test' } })
      expect(createResult.type).toBe('response')
    })

    it('should throw PERMISSION_DENIED when not authorized', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers, {
        guards: {
          read: false,
          write: false,
        },
      }))

      const result = await callProcedure(server, 'api.users.list')

      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('PERMISSION_DENIED')
    })

    it('should support custom guard functions', async () => {
      const server = createServer({ port: 0 })
      server.mount('api', createS3DBAdapter(mockUsers, {
        guards: {
          read: (ctx) => ctx.auth?.authenticated === true,
          write: false,
        },
      }))

      // Without auth, should be denied
      const result = await callProcedure(server, 'api.users.list', undefined, { noAuth: true })
      expect(result.type).toBe('error')
      expect((result.payload as any).code).toBe('PERMISSION_DENIED')
    })
  })

  describe('custom protected fields', () => {
    it('should merge custom protected fields with schema protected fields', async () => {
      const server = createServer({ port: 0 })
      server.mount(
        'api',
        createS3DBAdapter(mockUsers, {
          protectedFields: ['email'],
        })
      )

      const result = await callProcedure(server, 'api.users.list')

      // Both password (from schema) and email (from options) should be filtered
      expect((result.payload as any).data[0]).not.toHaveProperty('password')
      expect((result.payload as any).data[0]).not.toHaveProperty('email')
      expect((result.payload as any).data[0]).toHaveProperty('name')
    })
  })
})

describe('createS3DBContextInterceptor', () => {
  it('should add resources to context extensions', async () => {
    const mockUsers = createMockResource('users')
    const mockPosts = createMockResource('posts')

    const interceptor = createS3DBContextInterceptor({
      users: mockUsers,
      posts: mockPosts,
    })

    const ctx = createContext('test-ctx')
    const envelope: Envelope = {
      id: 'test-id',
      type: 'request',
      procedure: 'test.procedure',
      payload: {},
      metadata: {},
      context: ctx,
    }

    const next = vi.fn().mockResolvedValue({ type: 'response', payload: 'ok' })

    await interceptor(envelope, ctx, next)

    expect(next).toHaveBeenCalled()
    const s3dbKey = Symbol.for('raffel.s3db')
    expect(envelope.context.extensions.get(s3dbKey)).toHaveProperty('users')
    expect(envelope.context.extensions.get(s3dbKey)).toHaveProperty('posts')
  })
})

describe('generateS3DBHttpPaths', () => {
  it('should generate correct HTTP path mappings', () => {
    const paths = generateS3DBHttpPaths('users', '/api/v1')

    expect(paths['/api/v1.users.list']).toEqual({
      method: 'GET',
      path: '/api/v1/users',
    })
    expect(paths['/api/v1.users.get']).toEqual({
      method: 'GET',
      path: '/api/v1/users/:id',
    })
    expect(paths['/api/v1.users.create']).toEqual({
      method: 'POST',
      path: '/api/v1/users',
    })
    expect(paths['/api/v1.users.update']).toEqual({
      method: 'PUT',
      path: '/api/v1/users/:id',
    })
    expect(paths['/api/v1.users.patch']).toEqual({
      method: 'PATCH',
      path: '/api/v1/users/:id',
    })
    expect(paths['/api/v1.users.delete']).toEqual({
      method: 'DELETE',
      path: '/api/v1/users/:id',
    })
    expect(paths['/api/v1.users.options']).toEqual({
      method: 'OPTIONS',
      path: '/api/v1/users',
    })
    expect(paths['/api/v1.users.head']).toEqual({
      method: 'HEAD',
      path: '/api/v1/users',
    })
  })

  it('should work without basePath', () => {
    const paths = generateS3DBHttpPaths('users')

    expect(paths['users.list']).toEqual({
      method: 'GET',
      path: '/users',
    })
  })
})

describe('options procedure', () => {
  it('should return available methods and operations', async () => {
    const mockUsers = createMockResource('users')
    const server = createServer({ port: 0 })
    server.mount('api', createS3DBAdapter(mockUsers))

    const result = await callProcedure(server, 'api.users.options')

    expect(result.type).toBe('response')
    expect((result.payload as any).resource).toBe('users')
    expect((result.payload as any).methods).toContain('GET')
    expect((result.payload as any).methods).toContain('POST')
    expect((result.payload as any).methods).toContain('OPTIONS')
    expect((result.payload as any).methods).toContain('HEAD')
    expect((result.payload as any).operations.list).toBe(true)
    expect((result.payload as any).operations.create).toBe(true)
    expect((result.payload as any).operations.options).toBe(true)
    expect((result.payload as any).operations.head).toBe(true)
  })

  it('should respect methods option in options response', async () => {
    const mockUsers = createMockResource('users')
    const server = createServer({ port: 0 })
    server.mount('api', createS3DBAdapter(mockUsers, { methods: ['GET', 'OPTIONS'] }))

    const result = await callProcedure(server, 'api.users.options')

    expect((result.payload as any).methods).toContain('GET')
    expect((result.payload as any).methods).toContain('OPTIONS')
    expect((result.payload as any).methods).not.toContain('POST')
    expect((result.payload as any).methods).not.toContain('DELETE')
    expect((result.payload as any).operations.list).toBe(true)
    expect((result.payload as any).operations.create).toBe(false)
    expect((result.payload as any).operations.delete).toBe(false)
  })
})

describe('head procedure', () => {
  it('should return pagination metadata without data', async () => {
    const mockUsers = createMockResource('users', [
      { id: 'user-1', name: 'Alice' },
      { id: 'user-2', name: 'Bob' },
    ])
    const server = createServer({ port: 0 })
    server.mount('api', createS3DBAdapter(mockUsers))

    const result = await callProcedure(server, 'api.users.head')

    expect(result.type).toBe('response')
    expect((result.payload as any).total).toBe(2)
    expect((result.payload as any).page).toBe(1)
    expect((result.payload as any).pageSize).toBe(100)
    expect((result.payload as any).pageCount).toBe(1)
    // Should NOT include data
    expect((result.payload as any).data).toBeUndefined()
  })

  it('should respect pagination parameters', async () => {
    const mockUsers = createMockResource('users', [
      { id: 'user-1', name: 'Alice' },
      { id: 'user-2', name: 'Bob' },
      { id: 'user-3', name: 'Charlie' },
    ])
    const server = createServer({ port: 0 })
    server.mount('api', createS3DBAdapter(mockUsers))

    const result = await callProcedure(server, 'api.users.head', { limit: 1, offset: 1 })

    expect((result.payload as any).total).toBe(3)
    expect((result.payload as any).page).toBe(2)
    expect((result.payload as any).pageSize).toBe(1)
    expect((result.payload as any).pageCount).toBe(3)
  })
})
