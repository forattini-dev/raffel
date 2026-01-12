/**
 * JSON-RPC Generator Tests
 *
 * Tests for converting procedures to USD JSON-RPC specification (x-usd.jsonrpc).
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { createRegistry } from '../../../src/core/registry.js'
import { createSchemaRegistry, registerValidator, resetValidation, createZodAdapter } from '../../../src/validation/index.js'
import { generateJsonRpc } from '../../../src/docs/generators/jsonrpc-generator.js'

describe('JSON-RPC Generator', () => {
  beforeEach(() => {
    registerValidator(createZodAdapter(z))
  })

  afterEach(() => {
    resetValidation()
  })

  it('generates methods and schemas from procedures', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    registry.procedure('users.list', async () => [], { description: 'List users' })
    schemaRegistry.register('users.list', {
      input: z.object({ page: z.number().optional() }),
      output: z.array(z.object({ id: z.string() })),
    })

    const result = generateJsonRpc({ registry, schemaRegistry }, { endpoint: '/rpc' })

    assert.equal(result.jsonrpc.endpoint, '/rpc')
    assert.ok(result.jsonrpc.methods?.['users.list'])
    assert.ok(result.schemas.UsersListInput)
    assert.ok(result.schemas.UsersListOutput)
  })

  it('adds namespace tags when enabled', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    registry.procedure('billing.invoice.create', async () => ({}))
    schemaRegistry.register('billing.invoice.create', {
      input: z.object({ total: z.number() }),
      output: z.object({ id: z.string() }),
    })

    const result = generateJsonRpc({ registry, schemaRegistry }, { groupByNamespace: true })

    assert.ok(result.tags.has('billing'))
  })

  it('emits protocol and method content types', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    registry.procedure('reports.export', async () => ({}), { contentType: 'text/csv' })

    const result = generateJsonRpc({ registry, schemaRegistry })

    assert.equal(result.jsonrpc.contentTypes?.default, 'application/json')
    assert.equal(result.jsonrpc.methods?.['reports.export']?.contentTypes?.default, 'text/csv')
  })

  it('includes JSON-RPC error metadata when provided', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    registry.procedure('users.get', async () => ({}), {
      jsonrpc: {
        notification: true,
        errors: [
          {
            code: -32602,
            message: 'Invalid params',
            dataSchema: z.object({ field: z.string() }),
          },
        ],
      },
    })

    const result = generateJsonRpc({ registry, schemaRegistry })
    const method = result.jsonrpc.methods?.['users.get']

    assert.ok(method?.errors?.length)
    assert.equal(method?.errors?.[0].code, -32602)
    assert.equal(method?.['x-usd-notification'], true)
    assert.ok(result.schemas.UsersGetError1Data)
  })
})
