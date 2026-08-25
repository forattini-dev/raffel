import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createRegistry } from '../../src/core/registry.js'
import { generateUSD } from '../../src/docs/generators/usd-generator.js'
import { generateOpenAPI } from '../../src/docs/openapi/generator.js'
import { createProcedureBuilder } from '../../src/server/handler-builders.js'
import { createSchemaRegistry } from '../../src/validation/index.js'

describe('hidden documentation requests', () => {
  it('keeps a fluent handler executable while marking it hidden from docs', async () => {
    const registry = createRegistry()
    const schemas = createSchemaRegistry()

    createProcedureBuilder(registry, schemas, 'internal.health')
      .docs({ hidden: true })
      .handler(async () => ({ status: 'ok' }))

    const registered = registry.getProcedure('internal.health')
    expect(registered?.meta.docs).toEqual({ hidden: true })
    await expect(registered?.handler({}, {} as never)).resolves.toEqual({ status: 'ok' })
  })

  it('omits hidden procedures and streams from every USD protocol projection', () => {
    const registry = createRegistry()
    const schemas = createSchemaRegistry()
    const schema = { input: z.object({ id: z.string() }), output: z.object({ id: z.string() }) }

    registry.procedure('public.lookup', async input => input, {
      graphql: { type: 'query' }, jsonrpc: {}, grpc: { serviceName: 'Public', methodName: 'Lookup' },
    })
    registry.procedure('internal.hidden', async input => input, {
      docs: { hidden: true }, graphql: { type: 'query' }, jsonrpc: {}, grpc: { serviceName: 'Internal', methodName: 'Hidden' },
    })
    registry.stream('public.feed', async function* () { yield { id: '1' } })
    registry.stream('internal.feed', async function* () { yield { id: '1' } }, {
      docs: { hidden: true }, graphql: { type: 'subscription' },
    })
    schemas.register('public.lookup', schema)
    schemas.register('internal.hidden', schema)
    schemas.register('public.feed', { output: schema.output })
    schemas.register('internal.feed', { output: schema.output })

    const result = generateUSD(
      { registry, schemaRegistry: schemas },
      {
        info: { title: 'Visibility API', version: '1.0.0' },
        protocols: ['http', 'graphql', 'jsonrpc', 'grpc', 'streams'],
      },
    )
    const serialized = JSON.stringify(result.document)

    expect(serialized).toContain('public.lookup')
    expect(serialized).toContain('public.feed')
    expect(serialized).not.toContain('internal.hidden')
    expect(serialized).not.toContain('internalHidden')
    expect(serialized).not.toContain('internal.feed')
    expect(serialized).not.toContain('internalFeed')
  })

  it('omits hidden procedures, streams, and events from legacy OpenAPI extensions', () => {
    const registry = createRegistry()
    registry.procedure('visible.call', async () => ({}))
    registry.procedure('hidden.call', async () => ({}), { docs: { hidden: true } })
    registry.stream('visible.stream', async function* () {})
    registry.stream('hidden.stream', async function* () {}, { docs: { hidden: true } })
    registry.event('visible.event', async () => undefined)
    registry.event('hidden.event', async () => undefined, { docs: { hidden: true } })

    const serialized = JSON.stringify(generateOpenAPI(registry, undefined, {
      info: { title: 'Visibility API', version: '1.0.0' },
    }))

    expect(serialized).toContain('visible.call')
    expect(serialized).toContain('visible.stream')
    expect(serialized).toContain('visible.event')
    expect(serialized).not.toContain('hidden.call')
    expect(serialized).not.toContain('hidden.stream')
    expect(serialized).not.toContain('hidden.event')
  })
})
