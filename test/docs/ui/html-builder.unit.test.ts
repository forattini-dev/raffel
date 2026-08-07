import { describe, expect, it } from 'vitest'
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
    expect(html).toContain('<link rel="icon" type="image/x-icon" href="/favicon.ico">')
    expect(html).toContain('<header class="hero">')
    expect(html).toContain('<section class="introduction" id="introduction">')
    expect(html).toContain('<div class="app-container" id="docs" data-sidebar-hidden="false">')
    expect(html).toContain('id="docsStateSummary"')
    expect(html).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e')
    expect(html).not.toContain('</script><script>alert(1)</script>')
  })

  it('declares the ICO MIME type when the favicon URL has a query or hash', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: {
        info: { title: 'Default API', version: '1.0.0' },
        paths: {},
      },
      ui: { favicon: '/favicon.ico?v=2#brand' },
    })

    expect(html).toContain('<link rel="icon" type="image/x-icon" href="/favicon.ico?v=2#brand">')
  })

  it('renders global Open Graph tags with field-level precedence, defaults, omission, and escaping', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: {
        info: {
          title: 'Info <Title>',
          version: '1.0.0',
          description: 'Info "description"',
        },
        paths: {},
        'x-usd': {
          documentation: {
            openGraph: {
              title: 'USD Title',
              description: 'USD Description',
              image: 'https://cdn.example.com/social.png',
              imageAlt: 'Preview "card"',
              siteName: 'Docs & API',
              locale: 'pt_BR',
              url: '',
            },
          },
        },
      },
      ui: {
        openGraph: {
          description: 'UI <Description>',
        },
      },
    })

    expect(html).toContain('<meta property="og:title" content="USD Title">')
    expect(html).toContain('<meta property="og:description" content="UI &lt;Description&gt;">')
    expect(html).toContain('<meta property="og:type" content="website">')
    expect(html).toContain('<meta property="og:image" content="https://cdn.example.com/social.png">')
    expect(html).toContain('<meta property="og:image:alt" content="Preview &quot;card&quot;">')
    expect(html).toContain('<meta property="og:site_name" content="Docs &amp; API">')
    expect(html).toContain('<meta property="og:locale" content="pt_BR">')
    expect(html).not.toContain('property="og:url"')
    expect(html).not.toContain('Info &quot;description&quot;')
  })

  it('defaults Open Graph title and description from info', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: {
        info: {
          title: 'Default API',
          version: '1.0.0',
          description: 'Default API docs',
        },
        paths: {},
      },
    })

    expect(html).toContain('<meta property="og:title" content="Default API">')
    expect(html).toContain('<meta property="og:description" content="Default API docs">')
    expect(html).toContain('<meta property="og:type" content="website">')
    expect(html).not.toContain('property="og:image"')
  })

  it('omits Open Graph image alt text when no image is configured', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: {
        info: { title: 'Default API', version: '1.0.0' },
        paths: {},
        'x-usd': {
          documentation: {
            openGraph: { imageAlt: 'Orphan preview text' },
          },
        },
      },
    })

    expect(html).not.toContain('property="og:image"')
    expect(html).not.toContain('property="og:image:alt"')
  })

  it('lets an empty UI Open Graph field suppress lower-precedence values', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: {
        info: { title: 'Info title', version: '1.0.0' },
        paths: {},
        'x-usd': {
          documentation: {
            openGraph: { title: 'USD title' },
          },
        },
      },
      ui: { openGraph: { title: '   ' } },
    })

    expect(html).not.toContain('property="og:title"')
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
      escapeJsonForScript([]),
      escapeJsonForScript('/docs/-/assets'),
      escapeJsonForScript(null),
      escapeJsonForScript({}),
      escapeJsonForScript({})
    )

    expect(script).toContain('window.__RAFFEL_DOCS__ = {')
    expect(script).toContain('spec: {"info":{"title":"API","version":"1.0.0"},"paths":{}},')
    expect(script).toContain('const data = win.__RAFFEL_DOCS__ ?? {}')
    expect(script).toContain('function installDocsPluginApi()')
    expect(script).toContain('function renderMarkedMarkdown(')
    expect(script).toContain('function appendDeclarativeSidebar(')
    expect(script).toContain('function applyStringHook(')
    expect(script).toContain('function applySearchResultsHook(')
    expect(script).toContain('function unmountDocsComponents(root = doc)')
    expect(script).toContain('function parseMarkdownAttributes(')
    expect(script).toContain('function parseMarkdownDestination(')
    expect(script).toContain('function parseComponentFence(')
    expect(script).toContain('function parseHeadingTitle(')
    expect(script).toContain('function renderEmojiShorthand(')
    expect(script).toContain('function getExternalLinkTarget()')
    expect(script).toContain('function isNoCompileLink(')
    expect(script).toContain('function resolveDocsAlias(')
    expect(script).toContain('function parseMarkdown(')
    expect(script).toContain('docsAliases: {"/old":"/new"},')
    expect(script).toContain('searchIndex: [],')
    expect(script).toContain('docsSidebar: [],')
    expect(script).toContain('docsAssetBasePath: "/docs/-/assets",')
    expect(script).toContain('markdownConfig: {}')
    expect(script).toContain('function getEndpointsForProtocol(')
    expect(script).toContain('function renderSidebar()')
    expect(script).toContain('function parsePageFrontmatter(')
    expect(script).toContain('function renderDocsPagination(')
    expect(script).toContain('function renderEndpointDetails(')
    expect(script).toContain('createDocsSearchModal')
    expect(script).toContain('function init()')
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
        customCss: '/docs/-/assets/custom.css',
        navbar: [
          { title: 'Guide', href: '#/quickstart' },
          { title: 'More', children: [{ title: 'API', href: '#/api' }] },
        ],
      },
    })

    expect(html).toContain('<link rel="stylesheet" href="/docs/-/raffel-docs.css">')
    expect(html).toContain('<link rel="stylesheet" href="/docs/-/assets/custom.css" data-raffel-custom-css>')
    expect(html).toContain('<script src="/docs/-/marked.umd.js"></script>')
    expect(html).toContain('<script src="/docs/-/prism.js"></script>')
    expect(html).toMatch(/src="\/docs\/-\/raffel-docs\.js(\?v=\d+)?"/)
    expect(html).toContain('"imports"')
    expect(html).toContain('/docs/-/sidebar-tree.js')
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

    expect(runtime).toContain('const data = win.__RAFFEL_DOCS__ ?? {}')
    expect(runtime).toContain('function getDocsPageView(page)')
    expect(runtime).toContain('function getDocsPageMarkdown(page)')
    expect(runtime).toContain('function getEndpointsForProtocol(protocol')
    expect(runtime).toContain("protocol === 'websocket'")
    expect(runtime).toContain("protocol === 'udp'")
    expect(runtime).toContain('function getGrpcMethodType(method')
    expect(runtime).toContain('function renderEndpointDetails(')
    expect(runtime).toContain('function renderDocsSearch(')
    expect(runtime).toContain('function renderDocsPagination(')
    expect(runtime).toContain('function extractSidebarHeadings(markdown)')
    expect(runtime).toContain('function renderMermaidDiagrams(root = doc)')
    expect(runtime).toContain('function highlightCodeBlocks(root = doc)')
    expect(runtime).toContain('function appendDeclarativeSidebar(')
    expect(runtime).toContain('docsSidebar')
    expect(runtime).toContain('function installDocsPluginApi()')
    expect(runtime).toContain('fetchDocsState')
    expect(runtime).toContain('function startDocsStatePolling()')
    expect(runtime).toContain('apiRevisionChangedAt')
    expect(runtime).toContain('win.RaffelDocs')
    expect(runtime).toContain('refreshDocsState')
    expect(runtime).toContain('win.navigator?.clipboard')
    expect(runtime).toContain('image-zoom-overlay')
    expect(css).toContain('.docs-state-summary')
    expect(css).toContain('.docs-state-pill')
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
    expect(css).toContain('[data-theme="custom"]')
    expect(css).toContain('.token.keyword')
    expect(css).toContain('.endpoint-right .sample-code')
    expect(css).toContain('.endpoint-right .token.keyword')
    expect(css).toContain('--bg-tertiary: #1e293b;')
    expect(css).toContain('.skip-link')
    expect(css).toContain('.top-nav-submenu')
    expect(css).toContain('.app-container-no-sidebar')
    expect(css).toContain('.nav-subitem')
  })

  it('uses the compact documentation type scale', () => {
    const css = generateStyles({ primaryColor: '#336699', heroBackgroundCSS: '' })

    expect(css).toContain('--font-size-body: 13px;')
    expect(css).toContain('--font-size-small: 12px;')
    expect(css).toContain('--font-size-xs: 10px;')
    expect(css).toContain('--font-size-h1: 28px;')
    expect(css).toContain('--font-size-h2: 22px;')
    expect(css).toContain('--font-size-h3: 18px;')
    expect(css).toContain('--font-size-h4: 15px;')
    expect(css).toContain('--font-size-h5: 13px;')
    expect(css).toContain('--font-size-h6: 12px;')
    expect(css).toContain('--font-size-code: 11px;')
    expect(css).toContain('--line-height-body: 1.5;')
  })

  it('keeps nested HTTP reference surfaces compact', () => {
    const css = generateStyles({ primaryColor: '#336699', heroBackgroundCSS: '' })

    expect(css).toContain('.tag-group-header {\n      display: flex;\n      align-items: center;\n      gap: 6px;\n      padding: 8px 10px;')
    expect(css).toContain('.http-param {\n      padding: 8px 12px;')
    expect(css).toContain('.response-accordion-body {\n      padding: 10px 12px;')
    expect(css).toContain('.schema-tree-row {\n      padding: 4px 0;')
    expect(css).toContain('.endpoint-right .sample-code {\n      margin: 0;\n      padding: 10px;')
    expect(css).toContain('.endpoint-right .sample-code code {\n      color: inherit;\n      font-family:')
    expect(css).toContain('font-size: 11px;\n      line-height: 1.4;')
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

  it('uses the shared docs runtime source for inline delivery', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: {
        info: { title: 'API', version: '1.0.0' },
        paths: {},
      },
      ui: { assets: { mode: 'inline' } },
    })

    expect(html).toContain('data-raffel-runtime="inline"')
    expect(html).toContain('data-raffel-inline-dependency="marked"')
    expect(html).toContain('data-raffel-inline-dependency="prism"')
    expect(html).toContain('Prism.languages.bash')
    expect(html).toContain('Prism.languages.typescript')
    expect(html).toContain('Prism.languages.rust')
    expect(html).toContain('Prism.languages.python')
    expect(html).toContain('Prism.languages.go')
    expect(html).toContain('Prism.languages.json')
    expect(html).toContain('function renderMarkedMarkdown(')
    expect(html).toContain('function appendDeclarativeSidebar(')
    expect(html).toContain('function installDocsPluginApi()')
    expect(html).not.toContain('const docsData = window.__RAFFEL_DOCS__ || {};')
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

  it('embeds breadcrumb config + runtime + CSS for every Markdown page', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: {
        info: { title: 'API', version: '1.0.0' },
        paths: {},
        'x-usd': {
          documentation: {
            pages: [
              { title: 'Sessions', path: '/guides/advanced/sessions', markdown: '# Sessions' },
            ],
            sidebar: [
              {
                title: 'Guides',
                children: [
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
        },
      },
    })

    // breadcrumb config payload reaches the client.
    expect(html).toContain('breadcrumbsConfig: {"enabled":true,"hideOnHome":true}')
    // Runtime exposes the resolver + renderer.
    expect(html).toContain('function resolveDocsBreadcrumbs(')
    expect(html).toContain('function renderDocsBreadcrumb(')
    // CSS section is shipped.
    expect(html).toContain('.docs-breadcrumb')
    // aria-label is wired into the runtime via setAttribute (not literal HTML).
    expect(html).toContain("'aria-label', 'Breadcrumb'")
  })

  it('honours ui.breadcrumbs option overrides', () => {
    const disabled = generateUIHTML({
      basePath: '/docs',
      doc: { info: { title: 'API', version: '1.0.0' }, paths: {} },
      ui: { breadcrumbs: false },
    })
    const customised = generateUIHTML({
      basePath: '/docs',
      doc: { info: { title: 'API', version: '1.0.0' }, paths: {} },
      ui: { breadcrumbs: { hideOnHome: false } },
    })

    expect(disabled).toContain('breadcrumbsConfig: {"enabled":false,"hideOnHome":true}')
    expect(customised).toContain('breadcrumbsConfig: {"enabled":true,"hideOnHome":false}')
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
