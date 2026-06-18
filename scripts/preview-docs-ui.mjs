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
