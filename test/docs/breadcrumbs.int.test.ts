/**
 * Breadcrumb integration test (issue #121).
 *
 * Boots the USD docs middleware over a real HTTP listener, fetches the SPA
 * HTML for both the home page and a deep Markdown page, then asserts the
 * runtime + config + CSS necessary for the breadcrumb trail are wired end to
 * end. We do not spin up a headless browser — the runtime is exercised by the
 * unit tests; here we prove the wiring up to the HTML shell.
 */

import { afterEach, describe, expect, it } from 'vitest'
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

describe('Docs UI breadcrumbs (issue #121)', () => {
  it('ships breadcrumb runtime, config, and CSS in the served HTML', async () => {
    const app = new HttpApp()
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    mountUSDDocs(app, { registry, schemaRegistry }, {
      basePath: '/docs',
      info: { title: 'Test Docs', version: '1.0.0' },
      documentation: {
        pages: [
          { title: 'Sessions', path: '/guides/advanced/sessions', markdown: '# Sessions\nDeep page.' },
          { title: 'Auth', path: '/guides/auth', markdown: '# Auth' },
        ],
        sidebar: [
          {
            title: 'Guides',
            children: [
              { title: 'Auth', path: '/guides/auth' },
              {
                title: 'Advanced',
                path: '/guides/advanced',
                children: [
                  { title: 'Sessions', path: '/guides/advanced/sessions' },
                ],
              },
            ],
          },
        ],
      },
    })

    const port = await getFreePort()
    const server = serve({ fetch: app.fetch.bind(app), port, hostname: '127.0.0.1' })
    stop = () => new Promise<void>((resolve) => server.close(() => resolve()))

    const base = `http://127.0.0.1:${port}`

    // Home / SPA shell — same HTML for any client-rendered route.
    const home = await fetch(`${base}/docs`)
    expect(home.status).toBe(200)
    const homeHtml = await home.text()

    // Deep page — same shell, route is resolved client-side from the hash.
    // We probe the same shell to confirm the breadcrumb rendering pipeline is
    // present and would activate when the client sets `activePagePath`.
    const deep = await fetch(`${base}/docs#/guides/advanced/sessions`)
    expect(deep.status).toBe(200)
    const deepHtml = await deep.text()

    for (const html of [homeHtml, deepHtml]) {
      // Config object reaches the client.
      expect(html).toContain('breadcrumbsConfig: {"enabled":true,"hideOnHome":true}')
      // Sidebar tree includes the deep page as the leaf — required for the
      // resolver to walk to it.
      expect(html).toContain('"path":"/guides/advanced/sessions"')
      // Runtime resolver and renderer.
      expect(html).toContain('function resolveDocsBreadcrumbs(')
      expect(html).toContain('function renderDocsBreadcrumb(')
      // aria-label is wired into the runtime via setAttribute (not literal HTML).
      expect(html).toContain("'aria-label', 'Breadcrumb'")
      // CSS class wired into the served stylesheet.
      expect(html).toContain('.docs-breadcrumb')
    }
  })

  it('disabling ui.breadcrumbs strips runtime activation', async () => {
    const app = new HttpApp()
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()

    mountUSDDocs(app, { registry, schemaRegistry }, {
      basePath: '/docs',
      info: { title: 'Test Docs', version: '1.0.0' },
      ui: { breadcrumbs: false },
      documentation: {
        pages: [
          { title: 'Auth', path: '/guides/auth', markdown: '# Auth' },
        ],
      },
    })

    const port = await getFreePort()
    const server = serve({ fetch: app.fetch.bind(app), port, hostname: '127.0.0.1' })
    stop = () => new Promise<void>((resolve) => server.close(() => resolve()))

    const html = await fetch(`http://127.0.0.1:${port}/docs`).then((r) => r.text())
    expect(html).toContain('breadcrumbsConfig: {"enabled":false,"hideOnHome":true}')
  })
})
