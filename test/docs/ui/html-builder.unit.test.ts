import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

import { generateClientScript } from '../../../src/docs/ui/client-script/index.js'
import { generateUICSS, generateUIHTML, generateUIRuntimeJS } from '../../../src/docs/ui/html-builder.js'
import { mergeHeroConfig } from '../../../src/docs/ui/html-shell.js'
import { generateStyles } from '../../../src/docs/ui/styles.js'
import { escapeJsonForScript } from '../../../src/docs/ui/utils.js'

describe('Documentation UI HTML builder', () => {
  it('generates a standalone HTML document with escaped embedded data', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: {
        info: {
          title: 'Telemetry <API>',
          version: '1.2.3',
          description: '</script><script>alert(1)</script>',
        },
        paths: {
          '/events': {
            get: {
              operationId: 'listEvents',
              tags: ['Events'],
              responses: { '200': { description: 'OK' } },
            },
          },
        },
        'x-usd': {
          documentation: {
            introduction: '# Welcome\\nUse **events** safely.',
            hero: {
              title: 'Docs <Home>',
              tagline: 'Operational docs',
              buttons: [{ text: 'Read', href: '#docs', primary: true }],
            },
          },
        },
      },
      tagGroups: [
        {
          name: '</script><script>alert(1)</script>',
          tags: ['Events'],
        },
      ],
      ui: {
        theme: 'dark',
        primaryColor: '#336699',
        favicon: '/favicon.ico',
        logo: '/logo.svg',
        sidebar: { search: true, showCounts: true },
      },
    })

    expect(html).toMatch(/^<!DOCTYPE html>/)
    expect(html).toContain('<style>')
    expect(html).toContain('<script>')
    expect(html).toContain('data-theme="dark"')
    expect(html).toContain('<title>Telemetry &lt;API&gt;</title>')
    expect(html).toContain('<header class="hero">')
    expect(html).toContain('<section class="introduction" id="introduction">')
    expect(html).toContain('<div class="app-container" id="docs">')
    expect(html).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e')
    expect(html).not.toContain('</script><script>alert(1)</script>')
  })

  it('assembles the client script from the documentation behavior modules', () => {
    const script = generateClientScript(
      escapeJsonForScript({ info: { title: 'API', version: '1.0.0' }, paths: {} }),
      escapeJsonForScript([]),
      escapeJsonForScript(null),
      escapeJsonForScript({}),
      escapeJsonForScript('# Intro'),
      escapeJsonForScript([]),
      escapeJsonForScript([]),
      escapeJsonForScript(null),
      escapeJsonForScript({})
    )

    expect(script).toContain('window.__RAFFEL_DOCS__ = {')
    expect(script).toContain('spec: {"info":{"title":"API","version":"1.0.0"},"paths":{}},')
    expect(script).toContain('const spec = docsData.spec')
    expect(script).toContain('function parseMarkdown(md)')
    expect(script).toContain('searchIndex: [],')
    expect(script).toContain('function getEndpointsForProtocol(protocol)')
    expect(script).toContain('function renderSidebar()')
    expect(script).toContain('function parsePageFrontmatter(markdown)')
    expect(script).toContain('function renderDocsPagination(main, page)')
    expect(script).toContain('function renderTryItOut(ep)')
    expect(script).toContain('function renderSchemaType(schema, showFormat)')
    expect(script).toContain('function renderEndpointDetails(ep)')
    expect(script).toContain('renderIntroduction();')
  })

  it('can reference reusable frontend runtime and stylesheet assets', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: {
        info: { title: 'API', version: '1.0.0' },
        paths: {},
        'x-usd': {
          documentation: {
            pages: [
              {
                title: 'Fallback title',
                path: '/quickstart',
                markdown: '---\ntitle: Quickstart\nsection: Learn\norder: 1\ndescription: First steps\n---\n# Quickstart\n\nRun `raffel`.',
              },
            ],
            footer: 'Made with **Raffel**',
          },
        },
      },
      ui: {
        assets: { mode: 'external' },
        navbar: [{ title: 'Guide', href: '#/quickstart' }],
      },
    })

    expect(html).toContain('<link rel="stylesheet" href="/docs/-/raffel-docs.css">')
    expect(html).toContain('<script type="module" src="/docs/-/raffel-docs.js"></script>')
    expect(html).toContain('window.__RAFFEL_DOCS__')
    expect(html).toContain('"path":"/quickstart"')
    expect(html).toContain('searchIndex:')
    expect(html).toContain('"excerpt":"Quickstart Run raffel ."')
    expect(html).toContain('\\nsection: Learn')
    expect(html).not.toContain('function parseMarkdown(md)')
  })

  it('generates reusable runtime and per-document CSS separately', () => {
    const runtime = generateUIRuntimeJS()
    const css = generateUICSS({
      basePath: '/docs',
      doc: {
        info: { title: 'API', version: '1.0.0' },
        paths: {},
      },
      ui: { primaryColor: '#336699' },
    })

    expect(runtime).toContain('const docsData = window.__RAFFEL_DOCS__ || {};')
    expect(runtime).toContain('function getDocsPageView(page)')
    expect(runtime).toContain('function renderDocsPageSearchResults(main)')
    expect(runtime).toContain('function renderDocsPagination(main, page)')
    expect(runtime).toContain('navigator.clipboard')
    expect(css).toContain('.docs-pagination')
    expect(css).toContain('.md-tabs')
    expect(css).toContain('.md-alert')
    expect(css).toContain('.md-image')
    expect(css).toContain('--primary-color: #336699;')
  })

  it('keeps the external runtime aligned with Docsify-like markdown features', () => {
    const runtimeSource = readFileSync(
      new URL('../../../src/docs/ui/runtime/index.ts', import.meta.url),
      'utf8'
    )

    expect(runtimeSource).toContain('function renderTable()')
    expect(runtimeSource).toContain('function renderTabs()')
    expect(runtimeSource).toContain('function getDocsSearchResults()')
    expect(runtimeSource).toContain('highlightSearchExcerpt')
    expect(runtimeSource).toContain('function resolveMarkdownHref')
    expect(runtimeSource).toContain('type="checkbox" disabled')
    expect(runtimeSource).toContain('class="md-image"')
    expect(runtimeSource).toContain('.md-tab-button')
    expect(runtimeSource).toContain('routeToHash(activePagePath')
  })

  it('lets UI hero config override spec documentation hero config', () => {
    const hero = mergeHeroConfig(
      {
        hero: {
          title: 'Spec title',
          version: '1.0.0',
          tagline: 'Spec tagline',
          features: ['Spec feature'],
          background: 'gradient',
        },
      },
      {
        title: 'UI title',
        buttons: [{ text: 'Start', primary: true }],
      }
    )

    expect(hero).toEqual({
      title: 'UI title',
      version: '1.0.0',
      tagline: 'Spec tagline',
      features: ['Spec feature'],
      background: 'gradient',
      backgroundColor: undefined,
      backgroundImage: undefined,
      buttons: [{ text: 'Start', primary: true }],
      github: undefined,
      quickLinks: undefined,
    })
  })

  it('assembles style sections with theme variables and try-it styles', () => {
    const css = generateStyles({
      primaryColor: '#336699',
      heroBackgroundCSS: 'background: #336699;',
    })

    expect(css).toContain('--primary-color: #336699;')
    expect(css).toContain('--primary-hover: #24578a;')
    expect(css).toContain('background: #336699;')
    expect(css).toContain('/* ========== SIDEBAR ========== */')
    expect(css).toContain('/* ========== SCHEMA VISUALIZATION (Redoc-style) ========== */')
    expect(css).toContain('/* ========== TRY IT OUT ========== */')
  })
})
