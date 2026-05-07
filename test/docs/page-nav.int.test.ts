/**
 * Integration test for page-nav cards (issue #123).
 *
 * Verifies:
 *  - CSS exposes the new `.page-nav-grid` / `.page-nav-card` rules.
 *  - Runtime bundle wires the new resolver (`flattenReadingOrder` /
 *    `prevNext`) into `renderDocsPagination`.
 *  - End-to-end neighbour resolution against a realistic nested sidebar:
 *      - middle pages render both prev and next
 *      - first page renders only next
 *      - last page renders only prev
 *      - opted-out pages (`pageNav: false`) are skipped over
 */

import { describe, expect, it } from 'vitest'
import { generateUICSS, generateUIHTML, generateUIRuntimeJS } from '../../src/docs/ui/html-builder.js'
import { flattenReadingOrder, prevNext } from '../../src/docs/ui/page-nav.js'
import type { DocsSidebarItem } from '../../src/docs/ui/types.js'

const fixtureSidebar: DocsSidebarItem[] = [
  { title: 'Home', path: '/' },
  {
    title: 'Guides',
    children: [
      { title: 'Quickstart', path: '/guides/quickstart' },
      { title: 'Concepts', path: '/guides/concepts' },
      { title: 'Deploy', path: '/guides/deploy' },
    ],
  },
  {
    title: 'Reference',
    children: [
      { title: 'API', path: '/reference/api' },
      { title: 'GitHub', href: 'https://github.com/forattini-dev/raffel' },
    ],
  },
]

const minimalDoc = {
  info: { title: 'Docs', version: '1.0.0' },
  paths: {},
}

describe('page-nav cards (integration)', () => {
  it('CSS exposes the new page-nav grid + card rules using only allowed tokens', () => {
    const css = generateUICSS({ basePath: '/docs', doc: minimalDoc })
    expect(css).toContain('.page-nav-grid')
    expect(css).toContain('.page-nav-card')
    expect(css).toContain('.page-nav-card-prev')
    expect(css).toContain('.page-nav-card-next')
    expect(css).toContain('.page-nav-eyebrow')
    expect(css).toContain('.page-nav-title')
    // Mobile single-column collapse at 720px.
    expect(css).toContain('@media (max-width: 720px)')
    // No shadows in the new card rules.
    const startIndex = css.indexOf('Issue #123')
    expect(startIndex).toBeGreaterThan(-1)
    const block = css.slice(startIndex, startIndex + 2000)
    expect(block).not.toMatch(/box-shadow/)
    // No pill radius (50px+ or 999px). border-radius if present must be modest.
    expect(block).not.toMatch(/border-radius:\s*(?:9999|999|50%|50px|100px)/)
  })

  it('runtime bundle wires flattenReadingOrder + prevNext into renderDocsPagination', () => {
    const runtime = generateUIRuntimeJS()
    expect(runtime).toContain('function flattenReadingOrder')
    expect(runtime).toContain('function prevNext')
    expect(runtime).toContain('function renderDocsPagination')
    expect(runtime).toContain('page-nav-grid')
    // Card class is built via template literal `page-nav-card-${direction}`.
    expect(runtime).toContain('page-nav-card')
    expect(runtime).toMatch(/page-nav-card-\$\{direction\}|page-nav-card-prev|page-nav-card-next/)
    // pageNavConfig consumed inside the runtime.
    expect(runtime).toContain('pageNavConfig')
  })

  it('embeds the pageNavConfig payload into generated HTML', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: minimalDoc,
      ui: { pageNav: { hide: ['/guides/concepts'] } },
    })
    expect(html).toContain('pageNavConfig')
    expect(html).toContain('/guides/concepts')
  })

  it('disabling page-nav globally still emits a default-shaped payload', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: minimalDoc,
      ui: { pageNav: false },
    })
    expect(html).toContain('"enabled":false')
  })

  it('middle page renders both prev and next neighbours', () => {
    const order = flattenReadingOrder(fixtureSidebar)
    expect(order.map(p => p.path)).toEqual([
      '/',
      '/guides/quickstart',
      '/guides/concepts',
      '/guides/deploy',
      '/reference/api',
    ])
    expect(prevNext('/guides/concepts', order)).toEqual({
      prev: { title: 'Quickstart', path: '/guides/quickstart' },
      next: { title: 'Deploy', path: '/guides/deploy' },
    })
  })

  it('first sidebar page renders only the next card', () => {
    const order = flattenReadingOrder(fixtureSidebar)
    expect(prevNext('/', order)).toEqual({
      next: { title: 'Quickstart', path: '/guides/quickstart' },
    })
  })

  it('last sidebar page renders only the prev card', () => {
    const order = flattenReadingOrder(fixtureSidebar)
    expect(prevNext('/reference/api', order)).toEqual({
      prev: { title: 'Deploy', path: '/guides/deploy' },
    })
  })

  it('opted-out pages are skipped over so adjacent pages see the right neighbour', () => {
    const order = flattenReadingOrder(fixtureSidebar)
    // Concepts is opted-out (e.g. via frontmatter pageNav: false).
    const optedOut = new Set(['/guides/concepts'])
    expect(prevNext('/guides/quickstart', order, optedOut)).toEqual({
      prev: { title: 'Home', path: '/' },
      next: { title: 'Deploy', path: '/guides/deploy' },
    })
    expect(prevNext('/guides/deploy', order, optedOut)).toEqual({
      prev: { title: 'Quickstart', path: '/guides/quickstart' },
      next: { title: 'API', path: '/reference/api' },
    })
  })

  it('external links (href without path) never participate in the chain', () => {
    const order = flattenReadingOrder(fixtureSidebar)
    expect(order.find(entry => entry.path?.startsWith('http'))).toBeUndefined()
  })
})
