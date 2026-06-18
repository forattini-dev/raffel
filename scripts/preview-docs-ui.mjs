#!/usr/bin/env node
/**
 * Preview the docs UI locally.
 *
 * Boots a Raffel server with USD docs enabled against the project's own
 * `./docs` folder so you can eyeball the hero, sidebar, TOC, theme
 * toggle, back-to-top, and content rendering after a CSS change.
 *
 * Usage:
 *   pnpm run build && node scripts/preview-docs-ui.mjs
 *   PORT=5500 node scripts/preview-docs-ui.mjs
 */

import { createServer } from '../dist/server/builder.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const docsDir = resolve(repoRoot, 'docs')
const port = Number.parseInt(process.env.PORT ?? '4400', 10)

const server = createServer({
  port,
  host: '127.0.0.1',
  cors: false,
})

// === Enable Multi-Protocol Support ===
server.websocket({ path: '/ws' })
server.jsonrpc({ path: '/rpc' })

// === HTTP RPC ===
server
  .procedure('greet')
  .input({ type: 'object', properties: { name: { type: 'string' } } })
  .output({ type: 'object', properties: { hello: { type: 'string' } } })
  .handler(async (input) => ({ hello: input?.name ?? 'world' }))

server
  .procedure('add')
  .input({ type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } })
  .output({ type: 'object', properties: { sum: { type: 'number' } } })
  .handler(async (input) => ({ sum: (input?.a ?? 0) + (input?.b ?? 0) }))

// === Streams (Server-Sent Events) ===
server
  .stream('countdown')
  .output({ type: 'object', properties: { count: { type: 'number' } } })
  .handler(async function* (ctx) {
    for (let i = 10; i >= 0; i--) {
      yield { count: i }
    }
  })

server
  .stream('metrics')
  .output({ type: 'object', properties: { value: { type: 'number' }, timestamp: { type: 'string' } } })
  .handler(async function* (ctx) {
    for (let i = 0; i < 50; i++) {
      yield { value: Math.random() * 100, timestamp: new Date().toISOString() }
    }
  })

server.enableUSD({
  basePath: '/docs',
  info: {
    title: 'Raffel',
    version: '1.1.10',
    description: 'One server. Every protocol. Local docs preview.',
  },
  docsDir,
  ui: {
    assets: { mode: 'inline' },
    theme: 'auto',
    sidebar: { search: true, docsPages: true, subMaxLevel: 3, docsPagesGroup: 'Pages' },
    toc: { enabled: true, minLevel: 2, maxLevel: 4 },
  },
  // === WebSocket Channels ===
  websocket: {
    path: '/ws',
    channels: {
      'notifications': {
        summary: 'Notifications channel',
        description: 'Receive real-time notifications for events',
        type: 'public',
        subscribe: {
          message: {
            payload: {
              type: 'object',
              properties: {
                type: { type: 'string' },
                message: { type: 'string' },
                timestamp: { type: 'string' },
              },
            },
          },
        },
      },
      'presence-users': {
        summary: 'Online users presence',
        description: 'Track who is currently online',
        type: 'presence',
        subscribe: {
          message: {
            payload: {
              type: 'object',
              properties: {
                userId: { type: 'string' },
                status: { type: 'string' },
                lastSeen: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  // === JSON-RPC Methods ===
  jsonrpc: {
    endpoint: '/rpc',
    methods: {
      'math.multiply': {
        summary: 'Multiply two numbers',
        params: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
        result: {
          type: 'object',
          properties: {
            product: { type: 'number' },
          },
        },
      },
    },
  },
  // === gRPC Services ===
  grpc: {
    services: {
      'UserService': {
        description: 'User management service',
        methods: {
          'GetUser': {
            summary: 'Get user by ID',
            request: {
              type: 'object',
              properties: {
                userId: { type: 'string' },
              },
            },
            response: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                email: { type: 'string' },
              },
            },
          },
          'ListUsers': {
            summary: 'List all users with server streaming',
            'x-usd-server-streaming': true,
            request: {
              type: 'object',
              properties: {
                limit: { type: 'integer', default: 10 },
              },
            },
            response: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  // === TCP ===
  tcp: {
    servers: {
      'telemetry': {
        summary: 'Telemetry ingestion',
        description: 'TCP socket for telemetry data',
        port: 9000,
        host: '127.0.0.1',
        framing: {
          type: 'length-prefixed',
          lengthBytes: 4,
          byteOrder: 'big-endian',
        },
        messages: {
          inbound: {
            payload: {
              type: 'object',
              properties: {
                metric: { type: 'string' },
                value: { type: 'number' },
                timestamp: { type: 'string' },
              },
            },
          },
          outbound: {
            payload: {
              type: 'object',
              properties: {
                ack: { type: 'boolean' },
                id: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  // === UDP ===
  udp: {
    endpoints: {
      'metrics': {
        summary: 'Metrics collection',
        description: 'UDP endpoint for lightweight metrics',
        port: 5000,
        host: '0.0.0.0',
        maxPacketSize: 65507,
        messages: {
          inbound: {
            payload: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                value: { type: 'number' },
              },
            },
          },
        },
      },
    },
  },
})

await server.start()

const url = `http://127.0.0.1:${port}/docs`
console.log('')
console.log('  Raffel docs preview')
console.log(`  ${url}`)
console.log('')
console.log('  Surfaces to inspect:')
console.log('    Hero           ' + url + '/')
console.log('    Sidebar        left column')
console.log('    TOC            right column on a page with H2/H3 headings')
console.log('    Theme toggle   top-right (auto / light / dark)')
console.log('    Back-to-top    bottom-right after scroll > 400px')
console.log('')
console.log('  Press Ctrl+C to stop.')

const stop = async () => {
  console.log('\n  stopping…')
  await server.stop()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
