import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createServer } from '../../../src/server/index.js'
import { createRegistry } from '../../../src/core/registry.js'
import { generateStreams } from '../../../src/docs/generators/streams-generator.js'
import { generateOpenAPI } from '../../../src/docs/openapi/generator.js'
import {
  createInMemoryDiscoverySource,
  loadDiscovery,
} from '../../../src/server/fs-routes/index.js'
import { attachHttpAbortHandlers } from '../../../src/server/http-lifecycle/index.js'

describe('fs-discovered Live Stream', () => {
  it('preserves schemas and documentation metadata through registration', async () => {
    const input = z.object({ orderId: z.string().uuid() })
    const output = z.object({ status: z.enum(['pending', 'paid']) })
    const source = createInMemoryDiscoverySource({
      '/app/src/streams/orders/watch.js': {
        module: {
          input,
          output,
          meta: {
            description: 'Watch order status changes.',
            direction: 'server',
            tags: ['Orders'],
            contentType: 'application/json',
          },
          default: async function* watch() {
            yield { status: 'pending' }
          },
        },
      },
    })

    const discovery = await loadDiscovery({
      baseDir: '/app',
      discovery: { streams: true },
      extensions: ['.js'],
      source,
    })
    const server = createServer({ port: 0 })
    server.addDiscovery(discovery)

    const operation = server.preview().operations.find(({ name }) => name === 'orders/watch')
    expect(operation).toMatchObject({
      kind: 'stream',
      description: 'Watch order status changes.',
      tags: ['Orders'],
      schema: {
        input: { present: true },
        output: { present: true },
      },
    })
    expect(server.registry.getStream('orders/watch')?.meta).toMatchObject({
      contentType: 'application/json',
      tags: ['Orders'],
      streamDirection: 'server',
    })
  })

  it('projects explicit tags and content types into the USD stream contract', () => {
    const registry = createRegistry()
    registry.stream('orders/watch', async function* watch() {
      yield { status: 'pending' }
    }, {
      description: 'Watch order status changes.',
      tags: ['Orders'],
      contentTypes: {
        default: 'application/json',
        supported: ['application/json', 'application/x-ndjson'],
      },
    })

    const endpoint = generateStreams({ registry }).streams.endpoints?.['orders/watch']
    expect(endpoint).toMatchObject({
      tags: ['Orders'],
      contentTypes: {
        default: 'application/json',
        supported: ['application/json', 'application/x-ndjson'],
      },
      message: {
        contentType: 'application/json',
      },
    })

    const openapi = generateOpenAPI(registry, undefined, {
      info: { title: 'Orders API', version: '1.0.0' },
    })
    expect(openapi.paths['/streams/orders/watch']?.get?.tags).toEqual(['Orders'])
  })

  it('aborts the stream context when the HTTP client disconnects', () => {
    const req = new EventEmitter() as IncomingMessage
    const res = Object.assign(new EventEmitter(), {
      writableEnded: false,
    }) as unknown as ServerResponse
    const abortController = new AbortController()

    attachHttpAbortHandlers(req, res, abortController)
    res.emit('close')

    expect(abortController.signal.aborted).toBe(true)
    expect(abortController.signal.reason).toBe('Response closed early')
  })
})
