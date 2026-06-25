/**
 * Docs root overview (the `/docs` landing).
 *
 * The docs root (`/`) is ours to define — it must render an OpenAPI-driven
 * overview (title, version, servers, description), never a "Page not found".
 * Only a genuine non-root path with no matching page is a 404.
 */

import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { generateUIHTML } from '../../src/docs/ui/html-builder.js'

function buildDocs(spec: Record<string, unknown>, url = 'https://docs.example.com/'): {
  win: any
  mainHtml: string
  sidebarHtml: string
  tabsHtml: string
} {
  const html = generateUIHTML({
    basePath: '/docs',
    doc: spec as never,
    ui: {},
  } as never)
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url })
  const win = dom.window as any
  const runtime = win.document.querySelector('script[data-raffel-runtime="inline"]')
  if (runtime?.textContent) win.eval(runtime.textContent)
  const main = win.document.getElementById('mainContent')
  const sidebar = win.document.getElementById('sidebarNav')
  const tabs = win.document.getElementById('protocolTabs')
  return {
    win,
    mainHtml: main?.innerHTML ?? '',
    sidebarHtml: sidebar?.innerHTML ?? '',
    tabsHtml: tabs?.innerHTML ?? '',
  }
}

const SPEC = {
  openapi: '3.0.0',
  info: {
    title: 'Closer API',
    version: '1.2.3',
    description: '# Bem-vindo\n\nDocs do **Closer**.',
    contact: { name: 'Closer Team', email: 'closer@stone.com.br' },
    license: { name: 'MIT' },
  },
  servers: [
    { url: 'https://closer-api.stg.aws.karavela.run', description: 'Staging' },
    { url: 'https://closer-api.prod.aws.karavela.run', description: 'Production' },
  ],
  paths: {},
}

describe('docs root overview', () => {
  it('renders the OpenAPI overview at the docs root', () => {
    const { mainHtml } = buildDocs(SPEC)
    expect(mainHtml).not.toContain('Page not found')
    expect(mainHtml).toContain('docs-overview')
    expect(mainHtml).toContain('Closer API')
    expect(mainHtml).toContain('1.2.3') // version badge
    expect(mainHtml).toContain('closer-api.stg.aws.karavela.run')
    expect(mainHtml).toContain('closer-api.prod.aws.karavela.run')
    expect(mainHtml).toContain('Staging')
    expect(mainHtml).toContain('Bem-vindo') // markdown description
    expect(mainHtml).toContain('closer@stone.com.br') // contact
  })

  it('degrades gracefully when info/servers are absent (just a title)', () => {
    const { mainHtml } = buildDocs({ openapi: '3.0.0', info: { title: 'Bare API' }, paths: {} })
    expect(mainHtml).not.toContain('Page not found')
    expect(mainHtml).toContain('docs-overview')
    expect(mainHtml).toContain('Bare API')
  })

  it('still shows "Page not found" for a genuine non-root missing path', () => {
    const { mainHtml } = buildDocs(SPEC, 'https://docs.example.com/#/does-not-exist')
    expect(mainHtml).toContain('Page not found')
  })
})

const MULTI_PROTOCOL_SPEC = {
  openapi: '3.0.0',
  info: { title: 'Multi API', version: '2.0.0' },
  // GraphQL + raw sockets present alongside HTTP — HTTP must win the default.
  'x-usd': {
    graphql: { queries: { listLeads: {} } },
    udp: { endpoints: { ping: {} } },
  },
  paths: {
    '/leads': { get: { summary: 'List leads', tags: ['Leads'] } },
    '/leads/{id}': { get: { summary: 'Get lead', tags: ['Leads'] } },
  },
}

describe('docs root — protocol defaults & open menus', () => {
  it('opens on HTTP and lists its endpoints in the sidebar (not collapsed) at root', () => {
    const { sidebarHtml, tabsHtml } = buildDocs(MULTI_PROTOCOL_SPEC)
    // Endpoints are listed (sidebar not empty at root)
    expect(sidebarHtml).toContain('/leads')
    expect(sidebarHtml).toContain('tag-group-items')
    // Group is NOT collapsed (appendSidebarGroup renders expanded by default)
    expect(sidebarHtml).not.toContain('tag-group collapsed')
    // HTTP tab is the active one
    expect(tabsHtml).toContain('protocol-tab active')
    const activeMatch = tabsHtml.match(/protocol-tab active[^>]*>([A-Za-z]+)/)
    expect(activeMatch?.[1]).toBe('Http')
  })

  it('orders protocol tabs by logical priority (http → graphql → …)', () => {
    const { tabsHtml } = buildDocs(MULTI_PROTOCOL_SPEC)
    const order = [...tabsHtml.matchAll(/protocol-tab[^>]*>([A-Za-z]+)/g)].map((m) => m[1])
    expect(order[0]).toBe('Http')
    // graphql comes before udp in the priority list
    expect(order.indexOf('Graphql')).toBeLessThan(order.indexOf('Udp'))
  })
})
