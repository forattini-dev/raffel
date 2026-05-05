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
    expect(html).toContain('<a class="skip-link" href="#mainContent">Skip to main content</a>')
    expect(html).toContain('<title>Telemetry &lt;API&gt;</title>')
    expect(html).toContain('<header class="hero">')
    expect(html).toContain('<section class="introduction" id="introduction">')
    expect(html).toContain('<div class="app-container" id="docs" data-sidebar-hidden="false">')
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
      escapeJsonForScript({ '/old': '/new' }),
      escapeJsonForScript([]),
      escapeJsonForScript('/docs/-/assets'),
      escapeJsonForScript(null),
      escapeJsonForScript({}),
      escapeJsonForScript({})
    )

    expect(script).toContain('window.__RAFFEL_DOCS__ = {')
    expect(script).toContain('spec: {"info":{"title":"API","version":"1.0.0"},"paths":{}},')
    expect(script).toContain('const spec = docsData.spec')
    expect(script).toContain('function installDocsPluginApi()')
    expect(script).toContain('function applyStringHook(hookName, value, context)')
    expect(script).toContain('function applySearchResultsHook(results, context)')
    expect(script).toContain('function unmountDocsComponents(root = document)')
    expect(script).toContain('function parseMarkdownAttributes(text)')
    expect(script).toContain('function parseMarkdownDestination(value)')
    expect(script).toContain('function parseComponentFence(lang, body)')
    expect(script).toContain('function parseHeadingTitle(value)')
    expect(script).toContain('function renderEmojiShorthand(value)')
    expect(script).toContain('function getExternalLinkTarget()')
    expect(script).toContain('function isNoCompileLink(href)')
    expect(script).toContain('function resolveDocsAlias(path)')
    expect(script).toContain('function parseMarkdown(md)')
    expect(script).toContain('docsAliases: {"/old":"/new"},')
    expect(script).toContain('searchIndex: [],')
    expect(script).toContain('docsAssetBasePath: "/docs/-/assets",')
    expect(script).toContain('markdownConfig: {}')
    expect(script).toContain('function getEndpointsForProtocol(protocol)')
    expect(script).toContain('function renderSidebar()')
    expect(script).toContain('function parsePageFrontmatter(markdown)')
    expect(script).toContain('function renderDocsPagination(main, page)')
    expect(script).toContain('function renderTryItOut(ep)')
    expect(script).toContain('function renderSchemaType(schema, showFormat)')
    expect(script).toContain('function renderEndpointDetails(ep)')
    expect(script).toContain('wantsCommandSearch')
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
            aliases: { '/start': '/quickstart', '/legacy/(.*)': '/$1' },
            footer: 'Made with **Raffel**',
          },
        },
      },
      ui: {
        assets: { mode: 'external' },
        navbar: [
          { title: 'Guide', href: '#/quickstart' },
          { title: 'More', children: [{ title: 'API', href: '#/api' }] },
        ],
      },
    })

    expect(html).toContain('<link rel="stylesheet" href="/docs/-/raffel-docs.css">')
    expect(html).toContain('<script src="/docs/-/marked.umd.js"></script>')
    expect(html).toContain('<script type="module" src="/docs/-/raffel-docs.js"></script>')
    expect(html).toContain('<details class="top-nav-menu"')
    expect(html).toContain('<div class="top-nav-submenu"><a class="top-nav-link" href="#/api">API</a></div>')
    expect(html).toContain('window.__RAFFEL_DOCS__')
    expect(html).toContain('"path":"/quickstart"')
    expect(html).toContain('searchIndex:')
    expect(html).toContain('docsAliases: {"/start":"/quickstart","/legacy/(.*)":"/$1"}')
    expect(html).toContain('"excerpt":"Quickstart Run raffel ."')
    expect(html).toContain('docsAssetBasePath: "/docs/-/assets"')
    expect(html).toContain('markdownConfig: {}')
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
    expect(runtime).toContain('function getDocsPageMarkdown(page)')
    expect(runtime).toContain('function getEndpointsForProtocol(protocol')
    expect(runtime).toContain("protocol === 'websocket'")
    expect(runtime).toContain("protocol === 'udp'")
    expect(runtime).toContain('function getGrpcMethodType(method')
    expect(runtime).toContain('function renderEndpointDetails(ep')
    expect(runtime).toContain('function renderDocsPageSearchResults(main)')
    expect(runtime).toContain('function renderDocsPagination(main, page)')
    expect(runtime).toContain('function extractSidebarHeadings(markdown)')
    expect(runtime).toContain('function renderMermaidDiagrams(root = document)')
    expect(runtime).toContain('function installDocsPluginApi()')
    expect(runtime).toContain('window.RaffelDocs')
    expect(runtime).toContain('navigator.clipboard')
    expect(runtime).toContain('image-zoom-overlay')
    expect(css).toContain('.docs-pagination')
    expect(css).toContain('.md-tabs')
    expect(css).toContain('.md-alert')
    expect(css).toContain('.markdown-disabled')
    expect(css).toContain('.emoji')
    expect(css).toContain('.docs-component-mount')
    expect(css).toContain('.mermaid-fallback')
    expect(css).toContain('.md-image')
    expect(css).toContain('.image-zoom-overlay')
    expect(css).toContain('--primary-color: #336699;')
    expect(css).toContain('--text-primary: #1f2937;')
    expect(css).toContain('[data-theme="dark"]')
    expect(css).toContain('--bg-tertiary: #1e293b;')
    expect(css).toContain('.skip-link')
    expect(css).toContain('.top-nav-submenu')
    expect(css).toContain('.app-container-no-sidebar')
    expect(css).toContain('.nav-subitem')
  })

  it('can hide the sidebar for file-backed Markdown hideSidebar behavior', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: {
        info: { title: 'API', version: '1.0.0' },
        paths: {},
      },
      ui: { sidebar: { hide: true } },
    })

    expect(html).toContain('class="app-container app-container-no-sidebar"')
    expect(html).toContain('data-sidebar-hidden="true"')
    expect(html).toContain('class="sidebar sidebar-hidden" hidden')
  })

  it('can customize or hide the file-backed Markdown skip link', () => {
    const withCustomLabel = generateUIHTML({
      basePath: '/docs',
      doc: {
        info: { title: 'API', version: '1.0.0' },
        paths: {},
      },
      ui: { skipLink: 'Jump to content' },
    })
    const hidden = generateUIHTML({
      basePath: '/docs',
      doc: {
        info: { title: 'API', version: '1.0.0' },
        paths: {},
      },
      ui: { skipLink: false },
    })

    expect(withCustomLabel).toContain('<a class="skip-link" href="#mainContent">Jump to content</a>')
    expect(hidden).not.toContain('class="skip-link"')
  })

  it('keeps the external runtime aligned with file-backed Markdown markdown features', () => {
    const runtimeSource = readFileSync(
      new URL('../../../src/docs/ui/runtime/index.ts', import.meta.url),
      'utf8'
    )
    const protocolConsoleSource = readFileSync(
      new URL('../../../src/docs/ui/runtime/protocol-console.ts', import.meta.url),
      'utf8'
    )

    expect(runtimeSource).toContain('function renderTable()')
    expect(runtimeSource).toContain('function renderTabs()')
    expect(runtimeSource).toContain('function getDocsSearchResults()')
    expect(runtimeSource).toContain('highlightSearchExcerpt')
    expect(runtimeSource).toContain("import { renderMarkedMarkdown } from './marked-renderer.js'")
    expect(runtimeSource).toContain("import { appendProtocolConsole } from './protocol-console.js'")
    expect(protocolConsoleSource).toContain('protocol-try-it')
    expect(protocolConsoleSource).toContain('Live console')
    expect(runtimeSource).toContain('function renderMissingDocsPage')
    expect(runtimeSource).toContain('function resolveDocsAlias')
    expect(runtimeSource).toContain('function resolveDocsAliasTarget')
    expect(runtimeSource).toContain('new RegExp(pattern.startsWith')
    expect(runtimeSource).toContain('type DocsRuntimePlugin')
    expect(runtimeSource).toContain('apiVersion: 1')
    expect(runtimeSource).toContain('function applySearchResultsHook')
    expect(runtimeSource).toContain('function openImageZoom')
    expect(runtimeSource).toContain('function renderMermaidDiagrams')
    expect(runtimeSource).toContain('mountComponent?')
    expect(runtimeSource).toContain('function mountDocsComponents')
    expect(runtimeSource).toContain('onCopyCode?')
    expect(runtimeSource).toContain('onTabChange?')
    expect(runtimeSource).toContain('onImageZoom?')
    expect(runtimeSource).toContain('function parseComponentFence')
    expect(runtimeSource).toContain('svelte-component')
    expect(runtimeSource).toContain('function parseMarkdownAttributes')
    expect(runtimeSource).toContain('function parseHeadingTitle')
    expect(runtimeSource).toContain('function extractSidebarHeadings')
    expect(runtimeSource).toContain('sidebarConfig.subMaxLevel')
    expect(runtimeSource).toContain('COMMON_EMOJI_ENTITIES')
    expect(runtimeSource).toContain('function renderEmojiShorthand')
    expect(runtimeSource).toContain('markdownConfig.noEmoji')
    expect(runtimeSource).toContain("markdownConfig.html === 'raw'")
    expect(runtimeSource).toContain('markdownConfig.autoHeader')
    expect(runtimeSource).toContain('themeStorageKey')
    expect(runtimeSource).toContain("win.localStorage?.setItem?.(themeStorageKey, next)")
    expect(runtimeSource).toContain('function getExternalLinkTarget')
    expect(runtimeSource).toContain('function isNoCompileLink')
    expect(runtimeSource).toContain('IMPORTANT|CAUTION')
    expect(runtimeSource).toContain('data-no-zoom="true"')
    expect(runtimeSource).toContain('data-mermaid-source')
    expect(runtimeSource).toContain('function resolveMarkdownHref')
    expect(runtimeSource).toContain('function resolveMarkdownAssetHref')
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
