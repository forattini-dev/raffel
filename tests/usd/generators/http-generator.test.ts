/**
 * HTTP Generator Tests
 *
 * Tests for converting Raffel procedures and REST resources to USD paths.
 */

import { describe, it, beforeEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { generateHttpPaths, type HttpGeneratorContext, type HttpGeneratorOptions } from '../../../src/docs/generators/http-generator.js'
import { createRegistry, type Registry } from '../../../src/core/registry.js'
import type { LoadedRestResource } from '../../../src/server/fs-routes/index.js'
import type { SchemaRegistry } from '../../../src/validation/index.js'

// Helper to create mock schema registry
function createMockSchemaRegistry(): SchemaRegistry {
  const schemas = new Map<string, { input?: unknown; output?: unknown }>()
  return {
    set(name: string, handler: { input?: unknown; output?: unknown }) {
      schemas.set(name, handler)
    },
    get(name: string) {
      return schemas.get(name)
    },
    has(name: string) {
      return schemas.has(name)
    },
    entries() {
      return schemas.entries()
    },
  } as unknown as SchemaRegistry
}

// Helper to create mock REST resource
function createMockRestResource(overrides: Partial<LoadedRestResource> = {}): LoadedRestResource {
  return {
    name: 'users',
    filePath: '/api/users.ts',
    schema: z.object({ id: z.string(), name: z.string() }),
    config: {} as any,
    handlers: new Map(),
    actions: new Map(),
    routes: [],
    ...overrides,
  } as LoadedRestResource
}

describe('HTTP Generator', () => {
  let registry: Registry
  let ctx: HttpGeneratorContext

  beforeEach(() => {
    registry = createRegistry()
    ctx = { registry }
  })

  describe('generateHttpPaths', () => {
    describe('with empty registry', () => {
      it('should return empty paths', () => {
        const result = generateHttpPaths(ctx)

        assert.deepEqual(result.paths, {})
        assert.equal(result.tags.size, 0)
      })

      it('should include ApiError schema when includeErrorResponses is true', () => {
        const result = generateHttpPaths(ctx, { includeErrorResponses: true })

        assert.ok(result.schemas['ApiError'])
        assert.equal(result.schemas['ApiError'].type, 'object')
        assert.ok(result.schemas['ApiError'].properties?.code)
        assert.ok(result.schemas['ApiError'].properties?.message)
      })

      it('should not include ApiError schema when includeErrorResponses is false', () => {
        const result = generateHttpPaths(ctx, { includeErrorResponses: false })

        assert.equal(result.schemas['ApiError'], undefined)
      })
    })

    describe('with procedures', () => {
      it('should convert procedure name to path', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateHttpPaths(ctx)

        assert.ok(result.paths['/health'])
        assert.ok(result.paths['/health'].post)
        assert.equal(result.paths['/health'].post?.operationId, 'health')
      })

      it('should use namespace-based path for dotted names', () => {
        registry.procedure('users.list', async () => [])
        registry.procedure('users.get', async () => ({}))

        const result = generateHttpPaths(ctx)

        assert.ok(result.paths['/users/list'])
        assert.ok(result.paths['/users/get'])
      })

      it('should use custom httpPath when provided', () => {
        registry.procedure('getUser', async () => ({}), {
          httpPath: '/api/users/:id',
          httpMethod: 'GET',
        })

        const result = generateHttpPaths(ctx)

        assert.ok(result.paths['/api/users/:id'])
        assert.ok(result.paths['/api/users/:id'].get)
      })

      it('should use custom httpMethod when provided', () => {
        registry.procedure('deleteUser', async () => ({}), {
          httpPath: '/users/:id',
          httpMethod: 'DELETE',
        })

        const result = generateHttpPaths(ctx)

        assert.ok(result.paths['/users/:id'].delete)
      })

      it('should default to POST method when httpMethod is not specified', () => {
        registry.procedure('createTask', async () => ({}), {
          httpPath: '/tasks',
        })

        const result = generateHttpPaths(ctx)

        assert.ok(result.paths['/tasks'].post)
      })

      it('should add description to operation summary', () => {
        registry.procedure('health', async () => ({ status: 'ok' }), {
          description: 'Check service health',
        })

        const result = generateHttpPaths(ctx)

        assert.equal(result.paths['/health'].post?.summary, 'Check service health')
      })

      it('should use default summary when no description', () => {
        registry.procedure('users.list', async () => [])

        const result = generateHttpPaths(ctx)

        assert.equal(result.paths['/users/list'].post?.summary, 'Call users.list')
      })

      it('should respect basePath option', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateHttpPaths(ctx, { basePath: '/api/v1' })

        assert.ok(result.paths['/api/v1/health'])
      })

      it('should handle basePath with trailing slash', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateHttpPaths(ctx, { basePath: '/api/' })

        assert.ok(result.paths['/api/health'])
      })
    })

    describe('with namespace grouping', () => {
      it('should extract tags from namespaced procedures', () => {
        registry.procedure('users.list', async () => [])
        registry.procedure('users.get', async () => ({}))
        registry.procedure('tasks.list', async () => [])

        const result = generateHttpPaths(ctx, { groupByNamespace: true })

        assert.ok(result.tags.has('users'))
        assert.ok(result.tags.has('tasks'))
      })

      it('should add tags to operations', () => {
        registry.procedure('users.list', async () => [])

        const result = generateHttpPaths(ctx, { groupByNamespace: true })

        assert.deepEqual(result.paths['/users/list'].post?.tags, ['users'])
      })

      it('should not add tags when groupByNamespace is false', () => {
        registry.procedure('users.list', async () => [])

        const result = generateHttpPaths(ctx, { groupByNamespace: false })

        assert.equal(result.paths['/users/list'].post?.tags, undefined)
        assert.equal(result.tags.size, 0)
      })

      it('should not extract namespace from non-dotted names', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateHttpPaths(ctx, { groupByNamespace: true })

        assert.equal(result.paths['/health'].post?.tags, undefined)
      })
    })

    describe('with schema registry', () => {
      it('should generate input schema reference for procedures with input', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('users.create', {
          input: z.object({ name: z.string() }),
        })

        registry.procedure('users.create', async () => ({}))
        ctx.schemaRegistry = schemaRegistry

        const result = generateHttpPaths(ctx)

        assert.ok(result.paths['/users/create'].post?.requestBody)
        assert.equal(result.paths['/users/create'].post?.requestBody?.required, true)
        const content = result.paths['/users/create'].post?.requestBody?.content?.['application/json']
        assert.ok(content?.schema?.$ref?.includes('UsersCreateInput'))
      })

      it('should generate output schema reference for procedures with output', () => {
        const schemaRegistry = createMockSchemaRegistry()
        schemaRegistry.set('users.list', {
          output: z.array(z.object({ id: z.string(), name: z.string() })),
        })

        registry.procedure('users.list', async () => [])
        ctx.schemaRegistry = schemaRegistry

        const result = generateHttpPaths(ctx)

        const response200 = result.paths['/users/list'].post?.responses?.['200']
        assert.ok(response200)
        const content = response200.content?.['application/json']
        assert.ok(content?.schema?.$ref?.includes('UsersListOutput'))
      })

      it('should use generic object schema when no input schema', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateHttpPaths(ctx)

        const requestBody = result.paths['/health'].post?.requestBody
        assert.equal(requestBody?.required, false)
        const content = requestBody?.content?.['application/json']
        assert.deepEqual(content?.schema, { type: 'object' })
      })

      it('should use generic object schema when no output schema', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateHttpPaths(ctx)

        const response200 = result.paths['/health'].post?.responses?.['200']
        const content = response200?.content?.['application/json']
        assert.deepEqual(content?.schema, { type: 'object' })
      })
    })

    describe('with error responses', () => {
      it('should include all standard error responses', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateHttpPaths(ctx, { includeErrorResponses: true })

        const responses = result.paths['/health'].post?.responses
        assert.ok(responses?.['400'])
        assert.ok(responses?.['401'])
        assert.ok(responses?.['403'])
        assert.ok(responses?.['404'])
        assert.ok(responses?.['500'])
      })

      it('should reference ApiError schema in error responses', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateHttpPaths(ctx, { includeErrorResponses: true })

        const response400 = result.paths['/health'].post?.responses?.['400']
        const content = response400?.content?.['application/json']
        assert.ok(content?.schema?.$ref?.includes('ApiError'))
      })

      it('should not include error responses when disabled', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateHttpPaths(ctx, { includeErrorResponses: false })

        const responses = result.paths['/health'].post?.responses
        assert.ok(responses?.['200'])
        assert.equal(responses?.['400'], undefined)
        assert.equal(responses?.['500'], undefined)
      })
    })

    describe('with security', () => {
      it('should add default security to all procedures', () => {
        registry.procedure('users.list', async () => [])

        const result = generateHttpPaths(ctx, {
          defaultSecurity: [{ bearerAuth: [] }],
        })

        assert.deepEqual(result.paths['/users/list'].post?.security, [{ bearerAuth: [] }])
      })

      it('should not add security when not specified', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateHttpPaths(ctx)

        assert.equal(result.paths['/health'].post?.security, undefined)
      })
    })

    describe('with REST resources', () => {
      it('should convert REST resource routes to paths', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users',
              operation: 'list',
              handler: async () => [],
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        assert.ok(result.paths['/users'])
        assert.ok(result.paths['/users'].get)
      })

      it('should convert path params from :id to {id}', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users/:id',
              operation: 'get',
              handler: async () => ({}),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        assert.ok(result.paths['/users/{id}'])
        assert.ok(result.paths['/users/{id}'].get)
      })

      it('should generate operation ID from resource name and operation', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users',
              operation: 'list',
              handler: async () => [],
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        assert.equal(result.paths['/users'].get?.operationId, 'users_list')
      })

      it('should add resource name as tag', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users',
              operation: 'list',
              handler: async () => [],
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        assert.ok(result.tags.has('users'))
        assert.deepEqual(result.paths['/users'].get?.tags, ['users'])
      })

      it('should add resource schema to components', () => {
        const resource = createMockRestResource({
          routes: [],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        // Schema name is capitalized
        assert.ok(result.schemas['Users'])
      })

      it('should add path parameters for routes with :id', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users/:id',
              operation: 'get',
              handler: async () => ({}),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const params = result.paths['/users/{id}'].get?.parameters
        assert.ok(params)
        assert.equal(params.length, 1)
        assert.equal(params[0].name, 'id')
        assert.equal(params[0].in, 'path')
        assert.equal(params[0].required, true)
      })

      it('should handle multiple path parameters', () => {
        const resource = createMockRestResource({
          name: 'comments',
          routes: [
            {
              method: 'GET',
              path: '/posts/:postId/comments/:commentId',
              operation: 'get',
              handler: async () => ({}),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const params = result.paths['/posts/{postId}/comments/{commentId}'].get?.parameters
        assert.ok(params)
        assert.equal(params.length, 2)
        assert.equal(params[0].name, 'postId')
        assert.equal(params[1].name, 'commentId')
      })

      it('should skip REST operations when processing duplicate procedures', () => {
        // Register a procedure that matches a REST operation
        registry.procedure('users.list', async () => [])

        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users',
              operation: 'list',
              handler: async () => [],
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        // Should have REST route at /users (GET)
        assert.ok(result.paths['/users'].get)
        // Should NOT have procedure route at /users/list (POST)
        assert.equal(result.paths['/users/list'], undefined)
      })
    })

    describe('REST operation responses', () => {
      it('should generate paginated response for list operation', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users',
              operation: 'list',
              handler: async () => [],
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const response200 = result.paths['/users'].get?.responses?.['200']
        const schema = response200?.content?.['application/json']?.schema
        assert.equal(schema?.type, 'object')
        assert.ok(schema?.properties?.data)
        assert.ok(schema?.properties?.total)
      })

      it('should add pagination query params for list operation', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users',
              operation: 'list',
              handler: async () => [],
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const params = result.paths['/users'].get?.parameters
        const paramNames = params?.map((p) => p.name)
        assert.ok(paramNames?.includes('page'))
        assert.ok(paramNames?.includes('limit'))
        assert.ok(paramNames?.includes('sort'))
        assert.ok(paramNames?.includes('order'))
      })

      it('should reference resource schema for get operation', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users/:id',
              operation: 'get',
              handler: async () => ({}),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const response200 = result.paths['/users/{id}'].get?.responses?.['200']
        const schema = response200?.content?.['application/json']?.schema
        assert.ok(schema?.$ref?.includes('Users'))
      })

      it('should return 201 for create operation', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'POST',
              path: '/users',
              operation: 'create',
              handler: async () => ({}),
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const response201 = result.paths['/users'].post?.responses?.['201']
        assert.ok(response201)
        assert.equal(response201.description, 'Created resource')
      })

      it('should generate delete confirmation response', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'DELETE',
              path: '/users/:id',
              operation: 'delete',
              handler: async () => ({}),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const response200 = result.paths['/users/{id}'].delete?.responses?.['200']
        const schema = response200?.content?.['application/json']?.schema
        assert.ok(schema?.properties?.success)
        assert.ok(schema?.properties?.id)
      })

      it('should generate minimal response for head operation', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'HEAD',
              path: '/users/:id',
              operation: 'head',
              handler: async () => ({}),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const responses = result.paths['/users/{id}'].head?.responses
        assert.ok(responses?.['200'])
        assert.ok(responses?.['404'])
        // Should not have content
        assert.equal(responses?.['200']?.content, undefined)
      })

      it('should include Allow header for options operation', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'OPTIONS',
              path: '/users',
              operation: 'options',
              handler: async () => ({}),
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const response200 = result.paths['/users'].options?.responses?.['200']
        assert.ok(response200?.headers?.Allow)
      })

      it('should add request body for POST/PUT/PATCH methods', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'POST',
              path: '/users',
              operation: 'create',
              handler: async () => ({}),
              inputSchema: z.object({ name: z.string() }),
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const requestBody = result.paths['/users'].post?.requestBody
        assert.ok(requestBody)
        assert.equal(requestBody.required, true)
      })

      it('should set request body as optional for PATCH', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'PATCH',
              path: '/users/:id',
              operation: 'patch',
              handler: async () => ({}),
              inputSchema: z.object({ name: z.string().optional() }),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const requestBody = result.paths['/users/{id}'].patch?.requestBody
        assert.ok(requestBody)
        assert.equal(requestBody.required, false)
        assert.equal(requestBody.description, 'Partial update data')
      })

      it('should add 404 response for get/update/patch/delete', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users/:id',
              operation: 'get',
              handler: async () => ({}),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx, { includeErrorResponses: true })

        const responses = result.paths['/users/{id}'].get?.responses
        assert.ok(responses?.['404'])
        assert.equal(responses?.['404']?.description, 'Resource not found')
      })

      it('should add 409 response for create/update/patch', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'POST',
              path: '/users',
              operation: 'create',
              handler: async () => ({}),
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx, { includeErrorResponses: true })

        const responses = result.paths['/users'].post?.responses
        assert.ok(responses?.['409'])
        assert.equal(responses?.['409']?.description, 'Conflict')
      })
    })

    describe('REST custom actions', () => {
      it('should handle custom action with output schema', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'POST',
              path: '/users/:id/activate',
              operation: 'activate',
              handler: async () => ({ activated: true }),
              outputSchema: z.object({ activated: z.boolean() }),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const response200 = result.paths['/users/{id}/activate'].post?.responses?.['200']
        const schema = response200?.content?.['application/json']?.schema
        assert.ok(schema?.$ref?.includes('UsersActivateOutput'))
      })

      it('should handle custom action without output schema', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'POST',
              path: '/users/:id/verify',
              operation: 'verify',
              handler: async () => ({}),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const response200 = result.paths['/users/{id}/verify'].post?.responses?.['200']
        const schema = response200?.content?.['application/json']?.schema
        assert.deepEqual(schema, { type: 'object' })
      })
    })

    describe('REST authentication', () => {
      it('should add security for authenticated routes', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'DELETE',
              path: '/users/:id',
              operation: 'delete',
              handler: async () => ({}),
              auth: 'required',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx, {
          defaultSecurity: [{ bearerAuth: [] }],
        })

        const security = result.paths['/users/{id}'].delete?.security
        assert.deepEqual(security, [{ bearerAuth: [] }])
      })

      it('should not add security for public routes', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users',
              operation: 'list',
              handler: async () => [],
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx, {
          defaultSecurity: [{ bearerAuth: [] }],
        })

        const security = result.paths['/users'].get?.security
        assert.equal(security, undefined)
      })

      it('should add empty security object when auth required but no default security', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'DELETE',
              path: '/users/:id',
              operation: 'delete',
              handler: async () => ({}),
              auth: 'required',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const security = result.paths['/users/{id}'].delete?.security
        assert.deepEqual(security, [{}])
      })
    })

    describe('REST operation summaries and descriptions', () => {
      it('should generate proper summary for list operation', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users',
              operation: 'list',
              handler: async () => [],
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const operation = result.paths['/users'].get
        assert.equal(operation?.summary, 'List all users')
        assert.ok(operation?.description?.includes('paginated'))
      })

      it('should generate proper summary for get operation', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users/:id',
              operation: 'get',
              handler: async () => ({}),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const operation = result.paths['/users/{id}'].get
        // 'users' -> 'user' (singular)
        assert.equal(operation?.summary, 'Get a user by ID')
      })

      it('should generate proper summary for create operation', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'POST',
              path: '/users',
              operation: 'create',
              handler: async () => ({}),
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const operation = result.paths['/users'].post
        assert.equal(operation?.summary, 'Create a new user')
      })

      it('should handle resource names without trailing s', () => {
        const resource = createMockRestResource({
          name: 'person',
          routes: [
            {
              method: 'GET',
              path: '/person/:id',
              operation: 'get',
              handler: async () => ({}),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        // 'person' stays as 'person'
        assert.equal(result.paths['/person/{id}'].get?.summary, 'Get a person by ID')
      })

      it('should generate summary for custom actions', () => {
        const resource = createMockRestResource({
          routes: [
            {
              method: 'POST',
              path: '/users/:id/promote',
              operation: 'promote',
              handler: async () => ({}),
              auth: 'none',
              isCollection: false,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        const operation = result.paths['/users/{id}/promote'].post
        assert.equal(operation?.summary, 'Promote user')
      })
    })

    describe('multiple REST resources', () => {
      it('should handle multiple resources', () => {
        const usersResource = createMockRestResource({
          name: 'users',
          routes: [
            {
              method: 'GET',
              path: '/users',
              operation: 'list',
              handler: async () => [],
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        const tasksResource = createMockRestResource({
          name: 'tasks',
          schema: z.object({ id: z.string(), title: z.string() }),
          routes: [
            {
              method: 'GET',
              path: '/tasks',
              operation: 'list',
              handler: async () => [],
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [usersResource, tasksResource]
        const result = generateHttpPaths(ctx)

        assert.ok(result.paths['/users'])
        assert.ok(result.paths['/tasks'])
        assert.ok(result.tags.has('users'))
        assert.ok(result.tags.has('tasks'))
        assert.ok(result.schemas['Users'])
        assert.ok(result.schemas['Tasks'])
      })
    })

    describe('mixed procedures and REST resources', () => {
      it('should combine procedures and REST resources', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const resource = createMockRestResource({
          routes: [
            {
              method: 'GET',
              path: '/users',
              operation: 'list',
              handler: async () => [],
              auth: 'none',
              isCollection: true,
            },
          ],
        })

        ctx.restResources = [resource]
        const result = generateHttpPaths(ctx)

        assert.ok(result.paths['/health'])
        assert.ok(result.paths['/users'])
      })
    })

    describe('operationId generation', () => {
      it('should convert dotted names to camelCase operationId', () => {
        registry.procedure('users.getById', async () => ({}))

        const result = generateHttpPaths(ctx)

        assert.equal(result.paths['/users/getById'].post?.operationId, 'usersGetById')
      })

      it('should preserve single-part names as operationId', () => {
        registry.procedure('health', async () => ({ status: 'ok' }))

        const result = generateHttpPaths(ctx)

        assert.equal(result.paths['/health'].post?.operationId, 'health')
      })
    })
  })
})
