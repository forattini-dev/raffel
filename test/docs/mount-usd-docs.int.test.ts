/**
 * mountUSDDocs convenience helper (issue #111 item 1).
 *
 * Verifies that calling mountUSDDocs(app, ctx, config) wires every internal
 * asset under <basePath>/-/<asset> with the correct Content-Type, the spec
 * endpoints, and the SPA wildcard last so a missed asset never falls back
 * to the HTML shell.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createServer as createNodeHttpServer } from 'node:http'
import { HttpApp } from '../../src/http/app.js'
import { serve } from '../../src/http/serve.js'
import { mountUSDDocs } from '../../src/docs/usd-middleware.js'
import { createRegistry } from '../../src/core/registry.js'
import { createSchemaRegistry } from '../../src/validation/schema.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createNodeHttpServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const address = s.address()
      if (!address || typeof address === 'string') {
        s.close(() => reject(new Error('no port')))
        return
      }
      const { port } = address
      s.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

let stop: (() => Promise<void>) | null = null

afterEach(async () => {
  if (stop) {
    await stop().catch(() => {})
    stop = null
  }
})

describe('mountUSDDocs (issue #111)', () => {
  it('wires every internal asset, spec endpoints, and the SPA wildcard at the right precedence', async () => {
    const app = new HttpApp()
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()
    registry.procedure('users.list', async () => [], { httpPath: '/users', httpMethod: 'GET' })

    mountUSDDocs(app, { registry, schemaRegistry }, {
      basePath: '/coding',
      info: { title: 'Test', version: '1.0.0' },
    })

    const port = await getFreePort()
    const server = serve({ fetch: app.fetch.bind(app), port, hostname: '127.0.0.1' })
    stop = () => new Promise<void>((resolve) => server.close(() => resolve()))

    const base = `http://127.0.0.1:${port}`

    // Internal assets must have JS / CSS content types — never HTML.
    const css = await fetch(`${base}/coding/-/raffel-docs.css`)
    expect(css.status).toBe(200)
    expect(css.headers.get('content-type')).toMatch(/text\/css/)

    for (const asset of [
      'raffel-docs.js',
      'marked.umd.js',
      'prism.js',
      'marked-renderer.js',
      'protocol-console.js',
      'sidebar-tree.js',
    ]) {
      const res = await fetch(`${base}/coding/-/${asset}`)
      expect(res.status).toBe(200)
      const ct = res.headers.get('content-type') ?? ''
      expect(ct).toMatch(/javascript/)
      expect(ct).not.toMatch(/html/)
    }

    // Spec endpoints.
    const openapi = await fetch(`${base}/coding/openapi.json`)
    expect(openapi.status).toBe(200)
    expect(openapi.headers.get('content-type')).toMatch(/json/)
    const usd = await fetch(`${base}/coding/usd.json`)
    expect(usd.status).toBe(200)

    // SPA wildcard catches everything else and returns the UI shell.
    const spa = await fetch(`${base}/coding/anything-else`)
    expect(spa.status).toBe(200)
    expect(spa.headers.get('content-type')).toMatch(/html/)
  })
})
