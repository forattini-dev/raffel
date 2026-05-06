/**
 * USD Assembly Context Tests
 *
 * Tests document-level USD accumulation and merge behaviour through final output.
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createUSDAssemblyContext } from '../../../src/docs/generators/usd-assembly-context.js'

describe('USD Assembly Context', () => {
  it('accumulates schemas and tags with local collision behaviour', () => {
    const assembly = createUSDAssemblyContext({
      info: { title: 'Test API', version: '1.0.0' },
      protocols: ['http'],
    })

    assembly.addSchemas({
      User: {
        type: 'object',
        description: 'Original user schema',
      },
      ApiError: {
        type: 'object',
      },
    })
    assembly.addSchema('User', {
      type: 'object',
      description: 'Replacement user schema',
    })
    assembly.addTags([
      { name: 'users', description: 'User management operations' },
      'tasks',
      'alpha',
      'users',
    ])

    const { document, tags } = assembly.build()

    assert.equal(document.components?.schemas?.User.description, 'Replacement user schema')
    assert.ok(document.components?.schemas?.ApiError)
    assert.deepEqual(tags, ['alpha', 'tasks', 'users'])
    assert.deepEqual(document.tags, [
      { name: 'alpha' },
      { name: 'tasks' },
      { name: 'users', description: 'User management operations' },
    ])
  })

  it('assembles paths, protocol blocks, security, content types, and docs metadata', () => {
    const assembly = createUSDAssemblyContext({
      info: { title: 'Test API', version: '1.0.0' },
      protocols: ['http', 'websocket'],
      documentation: {
        introduction: 'Generated docs',
      },
    })

    assembly.addPaths({
      '/health': {
        get: {
          operationId: 'getHealth',
          responses: {
            '200': { description: 'OK' },
          },
        },
      },
    })
    assembly.addPaths({
      '/health': {
        post: {
          operationId: 'checkHealth',
          responses: {
            '200': { description: 'OK' },
          },
        },
      },
    })
    assembly.setProtocolBlock('websocket', {
      path: '/ws',
      channels: {},
      contentTypes: {
        default: 'application/json',
      },
    })
    assembly.addSecuritySchemes({
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
      },
    })
    assembly.setDefaultSecurity([{ bearerAuth: [] }])
    assembly.setContentTypes({
      default: 'application/json',
      supported: ['application/json'],
    })
    assembly.setTagGroups([{ name: 'Core', tags: ['health'] }])
    assembly.setExternalDocs({ url: 'https://docs.example.com' })
    assembly.addSchemas({
      External: {
        type: 'object',
        description: 'Generated schema',
      },
    })
    assembly.mergeComponents({
      schemas: {
        External: {
          type: 'object',
          description: 'External schema',
        },
      },
      responses: {
        Ok: { description: 'OK' },
      },
    })

    const { document } = assembly.build()

    assert.equal(document.paths?.['/health'].get, undefined)
    assert.equal(document.paths?.['/health'].post?.operationId, 'checkHealth')
    assert.equal(document['x-usd']?.websocket?.path, '/ws')
    assert.equal(document['x-usd']?.contentTypes?.default, 'application/json')
    assert.equal(document['x-usd']?.documentation?.introduction, 'Generated docs')
    assert.deepEqual(document.security, [{ bearerAuth: [] }])
    assert.ok(document.components?.securitySchemes?.bearerAuth)
    assert.equal(document.components?.schemas?.External.description, 'External schema')
    assert.ok(document.components?.responses?.Ok)
    assert.deepEqual(document['x-tagGroups'], [{ name: 'Core', tags: ['health'] }])
    assert.equal(document.externalDocs?.url, 'https://docs.example.com')
  })
})
