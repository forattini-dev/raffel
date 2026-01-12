/**
 * gRPC Generator Tests
 *
 * Tests for converting procedures to USD gRPC specification (x-usd.grpc).
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'

import { createRegistry } from '../../../src/core/registry.js'
import { createSchemaRegistry, registerValidator, resetValidation, createZodAdapter } from '../../../src/validation/index.js'
import { generateGrpc } from '../../../src/docs/generators/grpc-generator.js'

describe('gRPC Generator', () => {
  beforeEach(() => {
    registerValidator(createZodAdapter(z))
  })

  afterEach(() => {
    resetValidation()
  })

  it('groups procedures by service name', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    registry.procedure('users.get', async () => ({}))
    registry.procedure('orders.process', async () => ({}))
    registry.procedure('health', async () => ({}))

    schemaRegistry.register('users.get', {
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
    })
    schemaRegistry.register('orders.process', {
      input: z.object({ orderId: z.string() }),
      output: z.object({ ok: z.boolean() }),
    })
    schemaRegistry.register('health', {
      input: z.object({}),
      output: z.object({ status: z.string() }),
    })

    const result = generateGrpc({ registry, schemaRegistry }, { defaultServiceName: 'CoreService' })

    assert.ok(result.grpc.services?.Users?.methods?.Get)
    assert.ok(result.grpc.services?.Orders?.methods?.Process)
    assert.ok(result.grpc.services?.CoreService?.methods?.Health)
    assert.ok(result.schemas.UsersGetInput)
    assert.ok(result.schemas.OrdersProcessOutput)
  })

  it('applies service name overrides', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    registry.procedure('users.get', async () => ({}))
    schemaRegistry.register('users.get', {
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
    })

    const result = generateGrpc(
      { registry, schemaRegistry },
      {
        serviceNameOverrides: {
          'users.get': { service: 'UserService', method: 'Fetch' },
        },
      }
    )

    assert.ok(result.grpc.services?.UserService?.methods?.Fetch)
  })

  it('emits protocol and method content types', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    registry.procedure('reports.export', async () => ({}), { contentType: 'application/x-protobuf' })

    const result = generateGrpc({ registry, schemaRegistry })

    assert.equal(result.grpc.contentTypes?.default, 'application/x-protobuf')
    assert.equal(result.grpc.services?.Reports?.methods?.Export?.contentTypes?.default, 'application/x-protobuf')
  })

  it('includes streaming metadata when provided', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    registry.procedure('chat.stream', async () => ({}), {
      grpc: { clientStreaming: true, serverStreaming: true },
    })

    const result = generateGrpc({ registry, schemaRegistry })
    const method = result.grpc.services?.Chat?.methods?.Stream

    assert.equal(method?.['x-usd-client-streaming'], true)
    assert.equal(method?.['x-usd-server-streaming'], true)
  })
})
