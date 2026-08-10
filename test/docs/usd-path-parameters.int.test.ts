import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createRegistry } from '../../src/core/registry.js'
import { createUSDHandlers } from '../../src/docs/usd-middleware.js'
import type { USDOperation } from '../../src/usd/index.js'
import { createSchemaRegistry } from '../../src/validation/schema.js'

function getOperation(
  paths: Record<string, unknown> | undefined,
  path: string,
  method: 'get' | 'post',
): USDOperation | undefined {
  return (paths?.[path] as Record<string, USDOperation> | undefined)?.[method]
}

describe('USD procedure path parameters', () => {
  it('preserves parameter descriptions, examples, optionality, and constraints in USD and OpenAPI', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    registry.procedure('clients.get', async () => ({}), {
      httpMethod: 'GET',
      httpPath: '/clients/:clientId',
    })
    schemaRegistry.register('clients.get', {
      input: z.object({
        clientId: z.string().uuid().describe('Client identifier').meta({ examples: ['2f7db329-7616-4fe2-bf3b-f9600046b198'] }),
        after: z.string().min(3).optional().describe('Pagination cursor').meta({ examples: ['cursor_123'] }),
      }),
    })

    const handlers = createUSDHandlers(
      { registry, schemaRegistry },
      { info: { title: 'Clients', version: '1.0.0' } },
    )
    const usdOperation = getOperation(handlers.getUSDDocument().paths, '/clients/{clientId}', 'get')
    const openApiOperation = getOperation(handlers.getOpenAPIDocument().paths, '/clients/{clientId}', 'get')

    for (const operation of [usdOperation, openApiOperation]) {
      expect(operation?.parameters).toEqual([
        expect.objectContaining({
          name: 'clientId',
          in: 'path',
          required: true,
          description: 'Client identifier',
          schema: expect.objectContaining({
            type: 'string',
            format: 'uuid',
            examples: ['2f7db329-7616-4fe2-bf3b-f9600046b198'],
          }),
        }),
        expect.objectContaining({
          name: 'after',
          in: 'query',
          required: false,
          description: 'Pagination cursor',
          schema: expect.objectContaining({
            type: 'string',
            minLength: 3,
            examples: ['cursor_123'],
          }),
        }),
      ])
    }
  })

  it('normalizes colon segments and classifies matching input fields as path parameters', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    registry.procedure('customers.details', async () => ({}), {
      httpMethod: 'GET',
      httpPath: '/api/v1/customers/:document/details',
    })
    schemaRegistry.register('customers.details', {
      input: {
        type: 'object',
        properties: {
          document: { type: 'string' },
          includeHistory: { type: 'boolean' },
        },
        required: ['document'],
      },
    })

    const handlers = createUSDHandlers(
      { registry, schemaRegistry },
      { info: { title: 'Customers', version: '1.0.0' } },
    )
    const paths = handlers.getOpenAPIDocument().paths
    const operation = getOperation(paths, '/api/v1/customers/{document}/details', 'get')

    expect(paths?.['/api/v1/customers/:document/details']).toBeUndefined()
    expect(operation?.parameters).toEqual([
      expect.objectContaining({
        name: 'document',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }),
      expect.objectContaining({
        name: 'includeHistory',
        in: 'query',
        required: false,
        schema: { type: 'boolean' },
      }),
    ])

    const curl = operation?.['x-codeSamples']?.find((sample) => sample.lang === 'curl')
    expect(curl?.source).toContain('/api/v1/customers/string/details?includeHistory=')
    expect(curl?.source).not.toContain(':document')
    expect(curl?.source).not.toContain('document=')
  })

  it('documents path segments that are absent from the input schema', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    registry.procedure('hubs.get', async () => ({}), {
      httpMethod: 'GET',
      httpPath: '/api/v1/org/hubs/:hubId',
    })

    const handlers = createUSDHandlers(
      { registry, schemaRegistry },
      { info: { title: 'Hubs', version: '1.0.0' } },
    )
    const paths = handlers.getOpenAPIDocument().paths
    const operation = getOperation(paths, '/api/v1/org/hubs/{hubId}', 'get')

    expect(operation?.parameters).toEqual([
      expect.objectContaining({
        name: 'hubId',
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }),
    ])

    const curl = operation?.['x-codeSamples']?.find((sample) => sample.lang === 'curl')
    expect(curl?.source).toContain('/api/v1/org/hubs/string')
    expect(curl?.source).not.toContain(':hubId')
  })
})
