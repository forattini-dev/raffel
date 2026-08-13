import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createRegistry } from '../../src/core/registry.js'
import { generateStreams } from '../../src/docs/generators/streams-generator.js'
import { generateOpenAPI } from '../../src/docs/openapi/generator.js'
import { generateUIHTML } from '../../src/docs/ui/html-builder.js'
import { createSourceBackedStreamHandler } from '../../src/stream/resumable.js'
import type { ResumableStreamConfig } from '../../src/types/index.js'
import { createSchemaRegistry } from '../../src/validation/schema.js'

const config = {
  provider: 'orderChanges',
  delivery: 'at-least-once',
  cursor: { header: 'Last-Event-ID', query: 'cursor' },
  expiredCursor: { event: 'snapshot' },
} satisfies ResumableStreamConfig

function contractFixture() {
  const registry = createRegistry()
  registry.stream('orders.watch', createSourceBackedStreamHandler(config), {
    resumable: config,
  })
  const schemaRegistry = createSchemaRegistry()
  schemaRegistry.register('orders.watch', {
    output: z.object({ status: z.string() }),
    snapshot: z.object({ orderId: z.string(), status: z.string() }),
  })
  return { registry, schemaRegistry }
}

describe('Resumable Stream projections', () => {
  it('retains replay, cursor, delivery, and Stream Snapshot metadata in USD', () => {
    const { registry, schemaRegistry } = contractFixture()

    const generated = generateStreams({ registry, schemaRegistry })
    const contract = generated.streams.endpoints?.['orders.watch']?.['x-usd-resumable']

    expect(contract).toMatchObject({
      provider: 'orderChanges',
      delivery: 'at-least-once',
      cursor: { header: 'Last-Event-ID', query: 'cursor' },
      replay: { owner: 'application', provider: 'orderChanges' },
      snapshot: {
        owner: 'application',
        event: 'snapshot',
        cursor: 'application',
        schema: { $ref: '#/components/schemas/OrdersWatch_Snapshot' },
      },
      projections: {
        httpSse: { status: 'preserved' },
        websocket: { status: 'adapted' },
        grpc: { status: 'unsupported' },
      },
    })
    expect(generated.schemas).toHaveProperty('OrdersWatch_Snapshot')
  })

  it('exposes stable HTTP/SSE projection metadata in OpenAPI', () => {
    const { registry, schemaRegistry } = contractFixture()

    const generated = generateOpenAPI(registry, schemaRegistry, {
      info: { title: 'Orders', version: '1.0.0' },
    })
    const contract = generated.paths['/streams/orders/watch']
      ?.get?.['x-raffel-resumable-stream']

    expect(contract).toMatchObject({
      delivery: 'at-least-once',
      snapshot: {
        event: 'snapshot',
        schema: { $ref: '#/components/schemas/orders.watchStreamSnapshot' },
      },
      projections: {
        httpSse: {
          status: 'preserved',
          recordCursor: 'sse-id',
        },
        websocket: { status: 'adapted' },
        grpc: { status: 'unsupported' },
      },
    })
    expect(generated.components?.schemas)
      .toHaveProperty('orders.watchStreamSnapshot')
  })

  it('renders projection diagnostics beside the affected stream capability', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: {
        openapi: '3.1.0',
        info: { title: 'Orders', version: '1.0.0' },
        paths: {},
        'x-usd': {
          streams: {
            endpoints: {
              'orders.watch': {
                direction: 'server-to-client',
                message: { payload: { type: 'object' } },
                'x-usd-resumable': {
                  ...config,
                  projections: {
                    httpSse: { status: 'preserved', transport: 'SSE' },
                    websocket: {
                      status: 'adapted',
                      transport: 'Envelope metadata',
                    },
                    grpc: {
                      status: 'unsupported',
                      transport: 'gRPC',
                      reason: 'The current adapter does not carry Resume Cursor metadata.',
                    },
                  },
                },
              },
            },
          },
        },
      } as never,
      ui: {},
    })
    const dom = new JSDOM(html, {
      runScripts: 'dangerously',
      pretendToBeVisual: true,
      url: 'https://docs.example.com/',
    })
    const runtime = dom.window.document
      .querySelector('script[data-raffel-runtime="inline"]')
    if (runtime?.textContent) dom.window.eval(runtime.textContent)
    const diagnostics = dom.window.document
      .querySelector('.stream-projection-diagnostics')

    expect(diagnostics?.textContent).toContain('Projection diagnostics')
    expect(diagnostics?.textContent).toContain('HTTP / SSE')
    expect(diagnostics?.textContent).toContain('preserved')
    expect(diagnostics?.textContent).toContain('WebSocket')
    expect(diagnostics?.textContent).toContain('adapted')
    expect(diagnostics?.textContent).toContain('gRPC')
    expect(diagnostics?.textContent).toContain('unsupported')
    expect(diagnostics?.textContent).toContain('does not carry Resume Cursor metadata')
  })
})
