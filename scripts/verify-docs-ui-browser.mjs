#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const htmlBuilderPath = join(root, 'dist/docs/ui/html-builder.js')
const assetsDir = join(root, 'dist/docs/ui/assets')
const chromeCandidates = [
  process.env.CHROME_BIN,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
].filter(Boolean)

const docs = {
  openapi: '3.1.0',
  info: {
    title: 'Browser Smoke Docs',
    version: '1.0.0',
    description: 'Runtime validation fixture.',
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
  'x-usd': {
    documentation: {
      aliases: { '/start': '/quickstart', '/legacy/(.*)': '/$1' },
      sidebar: [
        {
          title: 'Guides',
          children: [
            {
              title: 'Getting Started',
              children: [
                { title: 'Quickstart', path: '/quickstart' },
                { title: 'Guide', path: '/guide' },
              ],
            },
          ],
        },
        {
          title: 'Reference',
          children: [
            { title: 'No Header', path: '/no-header' },
          ],
        },
      ],
      pages: [
        {
          title: 'Quickstart',
          path: '/quickstart',
          section: 'Guides',
          markdown: `---
title: Quickstart
description: Browser runtime smoke fixture
order: 1
---
# Quickstart

PLUGIN_TOKEN

Ship docs :rocket: :warning: :unknown_emoji:

~~Removed option~~

https://example.com/autolink

<span data-raw-html="yes">Raw HTML</span>

## Install

| Tool | Command |
| --- | --- |
| pnpm | \`pnpm add raffel\` |

- [x] Render task lists
- [ ] Keep unchecked tasks

> [!NOTE] Browser check
> Admonitions render.

> [!IMPORTANT]
> Important callouts render.

!> Legacy important callout.

![Logo](./images/logo.svg)

[Guide](./guide.md)
[No compile](./plain.md)
[External](https://example.com/docs)
[Raw](/raw/ ':ignore raw title')
[Target](/target ':target=_self')
[Disabled](/disabled ':disabled')

### Helper Heading :id=helper-heading

## Install

Repeated generated heading IDs stay unique.

### Hidden Heading <!-- {raffel-ignore} -->

![No zoom](./images/logo.svg ':size=50x100 :class=docs-logo :id=docs-logo :no-zoom')

\`\`\`svelte-component DemoCounter
{"label":"Mounted from Markdown"}
\`\`\`

<!-- tabs:start -->
#### npm
\`\`\`bash
npm install raffel
\`\`\`
#### pnpm
\`\`\`bash
pnpm install raffel
\`\`\`
<!-- tabs:end -->

\`\`\`mermaid
graph TD
  A[Markdown] --> B[Runtime]
\`\`\`
`,
        },
        {
          title: 'Guide',
          path: '/guide',
          section: 'Guides',
          updatedAt: '2026-05-04T03:02:01.000Z',
          markdown: '# Guide\n\nRelative links resolve here.\n\nUpdated {raffel-updated}.',
        },
        {
          title: 'No Header',
          path: '/no-header',
          section: 'Guides',
          markdown: 'This page relies on the configured auto header.',
        },
        {
          title: 'Not found',
          path: '/404',
          section: 'System',
          markdown: '# Missing\n\nCustom 404 page.',
        },
      ],
    },
    websocket: {
      channels: {
        chat: {
          description: 'Chat channel',
          type: 'public',
          tags: ['Realtime'],
          subscribe: {
            message: {
              payload: {
                type: 'object',
                properties: { text: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    graphql: {
      endpoint: '/graphql',
      resources: {
        Lead: {
          name: 'Lead',
          pluralName: 'leads',
          schema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
            },
          },
          policies: ['lead-read'],
          relations: {
            owner: {
              type: 'User',
              authz: {
                action: 'user.read',
                mode: 'all',
                'has-resource-resolver': true,
              },
            },
          },
        },
      },
      queries: {
        leads: {
          field: 'leads',
          kind: 'query',
          resource: 'Lead',
          source: 'resource',
          output: {
            type: 'array',
            items: { $ref: '#/components/schemas/LeadGraphQLResource' },
          },
          pagination: {
            style: 'offset',
            defaultLimit: 20,
            maxLimit: 100,
          },
          authz: {
            action: 'lead.read',
            mode: 'all',
            'has-resource-resolver': true,
          },
        },
      },
    },
    streams: {
      endpoints: {
        events: {
          direction: 'server-to-client',
          description: 'Event stream',
          tags: ['Realtime'],
          message: {
            payload: {
              type: 'object',
              properties: { id: { type: 'string' } },
            },
          },
        },
      },
    },
    jsonrpc: {
      methods: {
        'tasks.list': {
          description: 'List tasks',
          tags: ['RPC'],
          params: { type: 'object', properties: { limit: { type: 'integer' } } },
          result: { type: 'array', items: { type: 'object' } },
        },
      },
    },
    grpc: {
      services: {
        TaskService: {
          tags: ['gRPC'],
          methods: {
            ListTasks: {
              description: 'List tasks over gRPC',
              output: { type: 'object', properties: { tasks: { type: 'array' } } },
            },
          },
        },
      },
    },
    tcp: {
      servers: {
        telemetry: {
          description: 'Telemetry TCP',
          host: '0.0.0.0',
          port: 9000,
          tags: ['Sockets'],
        },
      },
    },
    udp: {
      endpoints: {
        metrics: {
          description: 'Metrics UDP',
          host: '0.0.0.0',
          port: 9001,
          tags: ['Sockets'],
          message: { payload: { type: 'object', properties: { value: { type: 'number' } } } },
        },
      },
    },
  },
}

const routeBaseDocs = {
  openapi: '3.1.0',
  info: { title: 'Route Base Docs', version: '1.0.0' },
  paths: {},
  'x-usd': {
    documentation: {
      routeBase: '/handbook',
      pages: [
        {
          title: 'Home',
          path: '/handbook',
          section: 'Guides',
          markdown: '# Home\n\n[Absolute Guide](/guide.md)\n[Relative Guide](./guide.md)',
        },
        {
          title: 'Guide',
          path: '/handbook/guide',
          section: 'Guides',
          markdown: '# Guide',
        },
      ],
    },
  },
}

function injectBrowserSmoke(html, assetMode = 'external') {
  const runtimeTagPattern = assetMode === 'external'
    ? /<script type="module" data-raffel-runtime="external" src="\/docs\/-\/raffel-docs\.js(?:\?v=[^"]+)?"><\/script>/
    : /<script type="module" data-raffel-runtime="inline">/
  const runtimeTag = html.match(runtimeTagPattern)?.[0]
  if (!runtimeTag) {
    throw new Error(`Generated HTML did not include the expected ${assetMode} runtime script tag`)
  }
  const smoke = `<script>
try { localStorage.setItem('raffel-docs-theme', 'dark') } catch {}
window.__RAFFEL_DOCS_PLUGINS__ = [{
  name: 'browser-smoke',
  beforeMarkdown(markdown) {
    return markdown.replace('PLUGIN_TOKEN', 'Plugin changed')
  },
  mountComponent(target, name, props) {
    target.setAttribute('data-mounted-component', name)
    target.textContent = name + ':' + String(props.label || '')
    document.documentElement.setAttribute('data-component-mounted', name)
    document.documentElement.setAttribute('data-component-props', String(props.label || ''))
  },
  unmountComponent(target) {
    document.documentElement.setAttribute('data-component-unmounted', target.getAttribute('data-mounted-component') || '')
  },
  onImageZoom(src, alt, context) {
    document.documentElement.setAttribute('data-plugin-image-zoom', String(Boolean(src) && context.activePagePath === '/quickstart'))
  },
  onTabChange(title, index, context) {
    document.documentElement.setAttribute('data-plugin-tab-change', String(title === 'pnpm' && index === 1 && context.activePagePath === '/quickstart'))
  },
  onCopyCode(text, context) {
    document.documentElement.setAttribute('data-plugin-copy-code', String(text.includes('pnpm install raffel') && context.activePagePath === '/quickstart'))
  },
  afterRender(context) {
    document.documentElement.setAttribute('data-plugin-after-render', 'yes')
    document.documentElement.setAttribute('data-plugin-api-version', String(window.RaffelDocs?.apiVersion || ''))
    document.documentElement.setAttribute('data-active-page', context.activePagePath || '')
    document.documentElement.setAttribute('data-current-hash', window.location.hash)
    window.setTimeout(window.__runRaffelDocsSmoke, 150)
  }
}]
window.mermaid = {
  initialize() {},
  render(id, source) {
    return Promise.resolve({
      svg: '<svg class="mermaid-svg" data-id="' + id + '"><text>' +
        source.replace(/[&<>"]/g, '') +
        '</text></svg>'
    })
  }
}
window.__runRaffelDocsSmoke = function () {
  const image = document.querySelector('.md-image')
  image?.click()
  document.documentElement.setAttribute('data-zoom-open', String(Boolean(document.querySelector('.image-zoom-overlay'))))
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  document.documentElement.setAttribute('data-zoom-closed', String(!document.querySelector('.image-zoom-overlay')))

  const secondTab = document.querySelector('.md-tab-button[data-tab-index="1"]')
  secondTab?.click()
  const activePanel = document.querySelector('.md-tab-panel.active')
  document.documentElement.setAttribute('data-active-tab-ok', String(activePanel?.textContent?.includes('pnpm install raffel')))
  document.querySelector('.md-tab-panel.active .copy-code-btn')?.click()
  if (!window.__themeSmokeRan) {
    window.__themeSmokeRan = true
    document.documentElement.setAttribute('data-theme-persisted-ok', String(document.documentElement.getAttribute('data-theme') === 'dark'))
    const rootStyle = getComputedStyle(document.documentElement)
    document.documentElement.setAttribute('data-dark-markdown-vars-ok', String(
      rootStyle.getPropertyValue('--bg-tertiary').trim() === '#1e293b' &&
      rootStyle.getPropertyValue('--text-primary').trim() === '#f8fafc' &&
      rootStyle.getPropertyValue('--border').trim() === '#475569'
    ))
    document.getElementById('themeToggle')?.click()
    document.documentElement.setAttribute('data-theme-toggle-persisted-ok', String(
      document.documentElement.getAttribute('data-theme') === 'light' &&
      localStorage.getItem('raffel-docs-theme') === 'light'
    ))
  }
  const tocText = Array.from(document.querySelectorAll('.toc-link')).map((link) => link.textContent || '').join('|')
  document.documentElement.setAttribute('data-ignore-toc-ok', String(!tocText.includes('Hidden Heading')))
  const links = Array.from(document.querySelectorAll('.markdown-content a'))
  const linkByText = (text) => links.find((link) => (link.textContent || '').trim() === text)
  const noCompileLink = linkByText('No compile')
  const externalLink = linkByText('External')
  const targetLink = linkByText('Target')
  document.documentElement.setAttribute('data-link-debug', links.map((link) => [
    (link.textContent || '').trim(),
    link.getAttribute('href') || '',
    link.target || '',
    link.getAttribute('rel') || '',
  ].join('~')).join('|'))
  document.documentElement.setAttribute('data-no-compile-link-ok', String(noCompileLink?.getAttribute('href') === './plain.md'))
  document.documentElement.setAttribute('data-external-target-ok', String(
    externalLink?.getAttribute('href') === 'https://example.com/docs' &&
    externalLink?.target === '_self' &&
    externalLink?.getAttribute('rel') === null
  ))
  document.documentElement.setAttribute('data-target-link-ok', String(
    targetLink?.getAttribute('href') === '/target' &&
    targetLink?.target === '_self'
  ))
  document.documentElement.setAttribute('data-marked-renderer-ok', String(Boolean(window.marked) && document.documentElement.getAttribute('data-markdown-engine') === 'marked'))
  document.documentElement.setAttribute('data-prism-ok', String(Boolean(window.Prism) && Boolean(document.querySelector('pre code[data-prism-highlighted="true"]')) && document.documentElement.getAttribute('data-syntax-highlight') === 'prism'))
  document.documentElement.setAttribute('data-custom-css-ok', String(getComputedStyle(document.documentElement).getPropertyValue('--custom-smoke-token').trim() === 'loaded'))
  const openSidebarGroups = Array.from(document.querySelectorAll('.docs-sidebar-group:not(.collapsed) > .tag-group-header')).map((item) => item.textContent || '').join('|')
  const collapsedSidebarGroups = Array.from(document.querySelectorAll('.docs-sidebar-group.collapsed > .tag-group-header')).map((item) => item.textContent || '').join('|')
  document.documentElement.setAttribute('data-sidebar-ancestor-open-ok', String(openSidebarGroups.includes('Guides') && openSidebarGroups.includes('Getting Started')))
  document.documentElement.setAttribute('data-sidebar-collapsed-default-ok', String(collapsedSidebarGroups.includes('Reference')))
  document.documentElement.setAttribute('data-sidebar-active-page-ok', String(Boolean(document.querySelector('.docs-sidebar-page.active')?.textContent?.includes('Quickstart'))))
  const sidebarSubText = Array.from(document.querySelectorAll('.nav-subitem')).map((link) => link.textContent || '').join('|')
  document.documentElement.setAttribute('data-sidebar-sublevel-ok', String(
    sidebarSubText.includes('Install') &&
    sidebarSubText.includes('Helper Heading') &&
    !sidebarSubText.includes('Hidden Heading')
  ))
  document.documentElement.setAttribute('data-sidebar-subactive-ok', String(
    Boolean(document.querySelector('.nav-subitem.active')?.textContent?.includes('Install'))
  ))
  document.documentElement.setAttribute('data-duplicate-heading-ok', String(
    Boolean(document.getElementById('install')) &&
    Boolean(document.getElementById('install-1')) &&
    Array.from(document.querySelectorAll('.heading-anchor')).some((link) => link.getAttribute('href') === '#/quickstart?id=install-1')
  ))

  if (!window.location.hash.startsWith('#/') && !window.__protocolSmokeRan) {
    window.__protocolSmokeRan = true
    const protocolChecks = [
      ['Websocket', 'chat', 'Chat channel'],
      ['Graphql', 'leads', 'lead.read'],
      ['Streams', 'events', 'Event stream'],
      ['Jsonrpc', 'tasks.list', 'Result'],
      ['Grpc', 'TaskService/ListTasks', 'Response'],
      ['Tcp', 'telemetry', '9000'],
      ['Udp', 'metrics', '9001'],
    ]
    const buttons = Array.from(document.querySelectorAll('.protocol-tab'))
    for (const [label, pathNeedle, detailsNeedle] of protocolChecks) {
      const button = buttons.find((item) => (item.textContent || '').includes(label))
      button?.click()
      const mainText = document.getElementById('mainContent')?.textContent || ''
      const tryPanel = document.querySelector('.protocol-try-it-' + label.toLowerCase())
      const liveExpected = ['Websocket', 'Streams', 'Jsonrpc'].includes(label)
      document.documentElement.setAttribute(
        'data-protocol-' + label.toLowerCase() + '-ok',
        String(Boolean(button) && mainText.includes(pathNeedle) && mainText.includes(detailsNeedle))
      )
      document.documentElement.setAttribute('data-protocol-try-' + label.toLowerCase() + '-ok', String(Boolean(tryPanel) && tryPanel.textContent.includes(liveExpected ? 'Live console' : 'Starter request')))
    }
  }

  const search = document.getElementById('searchInput')
  if (search && !window.location.hash.startsWith('#/') && !window.__searchSmokeRan) {
    window.__searchSmokeRan = true
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }))
    const searchModal = document.querySelector('.search-modal')
    document.documentElement.setAttribute('data-search-hotkey-ok', String(Boolean(searchModal?.hasAttribute('open') || searchModal?.open === true)))
    search.value = 'install'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    document.documentElement.setAttribute('data-search-results-ok', String(document.querySelectorAll('.docs-page-result').length > 0))
  }

  document.documentElement.setAttribute('data-smoke-ready', 'yes')
}
</script>
${runtimeTag}`
  return html.replace(runtimeTag, smoke)
}

async function findChrome() {
  for (const candidate of chromeCandidates) {
    try {
      const { stdout } = await execFileAsync('which', [candidate], { timeout: 3000 })
      const resolved = stdout.trim()
      if (resolved) return resolved
    } catch {
      // Try the next known executable name.
    }
  }
  return null
}

async function assertBuildOutputExists() {
  try {
    await access(htmlBuilderPath)
    await access(join(assetsDir, 'raffel-docs.js'))
    await access(join(assetsDir, 'marked-renderer.js'))
    await access(join(assetsDir, 'protocol-console.js'))
    await access(join(assetsDir, 'sidebar-tree.js'))
    await access(join(assetsDir, 'code-block-toolbar.js'))
    await access(join(assetsDir, 'page-nav.js'))
    await access(join(assetsDir, 'search-modal.js'))
    await access(join(assetsDir, 'marked.umd.js'))
    await access(join(assetsDir, 'prism.js'))
    await access(join(assetsDir, 'raffel-docs.css'))
  } catch {
    throw new Error('Docs UI dist assets are missing. Run `pnpm run build` before browser verification.')
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address()))
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

async function createFixtureServer(html) {
  const runtimeJs = await readFile(join(assetsDir, 'raffel-docs.js'))
  const markedRendererJs = await readFile(join(assetsDir, 'marked-renderer.js'))
  const protocolConsoleJs = await readFile(join(assetsDir, 'protocol-console.js'))
  const sidebarTreeJs = await readFile(join(assetsDir, 'sidebar-tree.js'))
  const codeBlockToolbarJs = await readFile(join(assetsDir, 'code-block-toolbar.js'))
  const pageNavJs = await readFile(join(assetsDir, 'page-nav.js'))
  const searchModalJs = await readFile(join(assetsDir, 'search-modal.js'))
  const markedUmdJs = await readFile(join(assetsDir, 'marked.umd.js'))
  const prismJs = await readFile(join(assetsDir, 'prism.js'))
  const runtimeCss = await readFile(join(assetsDir, 'raffel-docs.css'))
  const customCss = Buffer.from(':root { --custom-smoke-token: loaded; } [data-theme="custom"] { --raffel-bg-color: rgb(1, 2, 3); }')
  const logoSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#0f766e"/><text x="8" y="25" fill="white">Raffel</text></svg>')

  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (path === '/docs' || path === '/docs/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(html)
      return
    }
    if (path === '/docs/-/raffel-docs.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(runtimeJs)
      return
    }
    if (path === '/docs/-/marked-renderer.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(markedRendererJs)
      return
    }
    if (path === '/docs/-/protocol-console.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(protocolConsoleJs)
      return
    }
    if (path === '/docs/-/sidebar-tree.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(sidebarTreeJs)
      return
    }
    if (path === '/docs/-/code-block-toolbar.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(codeBlockToolbarJs)
      return
    }
    if (path === '/docs/-/page-nav.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(pageNavJs)
      return
    }
    if (path === '/docs/-/search-modal.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(searchModalJs)
      return
    }
    if (path === '/docs/-/marked.umd.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(markedUmdJs)
      return
    }
    if (path === '/docs/-/prism.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(prismJs)
      return
    }
    if (path === '/docs/-/raffel-docs.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
      response.end(runtimeCss)
      return
    }
    if (path === '/docs/-/assets/custom.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
      response.end(customCss)
      return
    }
    if (path === '/docs/-/assets/images/logo.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' })
      response.end(logoSvg)
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`Not found: ${path}`)
  })

  const address = await listen(server)
  return { server, origin: `http://${address.address}:${address.port}` }
}

function assertDom(dom, checks) {
  const missing = checks.filter(({ needle }) => !dom.includes(needle))
  if (missing.length === 0) return
  const details = missing.map(({ label, needle }) => `- ${label}: missing ${JSON.stringify(needle)}`).join('\n')
  const debug = dom.match(/data-link-debug="([^"]*)"/)?.[1]
  throw new Error(`Docs UI browser smoke failed:\n${details}${debug ? `\nlink-debug: ${debug}` : ''}`)
}

function assertDomMissing(dom, checks) {
  const present = checks.filter(({ needle }) => dom.includes(needle))
  if (present.length === 0) return
  const details = present.map(({ label, needle }) => `- ${label}: found ${JSON.stringify(needle)}`).join('\n')
  throw new Error(`Docs UI browser smoke failed:\n${details}`)
}

async function dumpDom(chrome, url) {
  const { stdout, stderr } = await execFileAsync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--virtual-time-budget=5000',
    '--dump-dom',
    url,
  ], {
    timeout: 20000,
    maxBuffer: 20 * 1024 * 1024,
  })

  if (!stdout.trim()) {
    throw new Error(`Chrome produced an empty DOM dump.\n${stderr}`)
  }
  return stdout
}

async function run() {
  await assertBuildOutputExists()
  const chrome = await findChrome()
  if (!chrome) {
    console.log('Skipping docs UI browser smoke: Chrome/Chromium was not found.')
    return
  }

  const { generateUIHTML } = await import(pathToFileURL(htmlBuilderPath).href)
  const html = injectBrowserSmoke(generateUIHTML({
    doc: docs,
    basePath: '/docs',
      ui: {
      assets: { mode: 'external' },
      customCss: '/docs/-/assets/custom.css',
      skipLink: 'Jump to content',
      navbar: [
        { title: 'Guide', href: '#/quickstart' },
        { title: 'More', children: [{ title: 'API', href: '#/api' }] },
      ],
      sidebar: { search: true, docsPages: true, subMaxLevel: 3 },
      toc: { enabled: true, minLevel: 2, maxLevel: 3 },
      markdown: {
        externalLinkTarget: '_self',
        externalLinkRel: '',
        noCompileLinks: ['^\\./plain\\.md$'],
        autoHeader: true,
        formatUpdated: 'YYYY/MM/DD HH:mm',
      },
    },
  }))

  const { server, origin } = await createFixtureServer(html)
  try {
    const pageDom = await dumpDom(chrome, `${origin}/docs#/legacy/quickstart?id=install`)
    assertDom(pageDom, [
      { label: 'runtime completion marker', needle: 'data-smoke-ready="yes"' },
      { label: 'plugin afterRender hook', needle: 'data-plugin-after-render="yes"' },
      { label: 'plugin API version', needle: 'data-plugin-api-version="1"' },
      { label: 'plugin image zoom hook', needle: 'data-plugin-image-zoom="true"' },
      { label: 'plugin tab change hook', needle: 'data-plugin-tab-change="true"' },
      { label: 'plugin copy code hook', needle: 'data-plugin-copy-code="true"' },
      { label: 'regex alias route resolution', needle: 'data-current-hash="#/quickstart?id=install"' },
      { label: 'active page state', needle: 'data-active-page="/quickstart"' },
      { label: 'nested navbar rendering', needle: 'class="top-nav-submenu"' },
      { label: 'nested navbar child link', needle: 'href="#/api"' },
      { label: 'skipLink rendering', needle: '<a class="skip-link" href="#mainContent">Jump to content</a>' },
      { label: 'plugin beforeMarkdown hook', needle: 'Plugin changed' },
      { label: 'emoji shorthand rendering', needle: 'class="emoji" aria-label="rocket"' },
      { label: 'second emoji shorthand rendering', needle: 'class="emoji" aria-label="warning"' },
      { label: 'unknown emoji shorthand stays text', needle: ':unknown_emoji:' },
      { label: 'GFM strikethrough rendering', needle: '<del>Removed option</del>' },
      { label: 'raw HTML escaped by default', needle: '&lt;span data-raw-html="yes"&gt;Raw HTML&lt;/span&gt;' },
      { label: 'GFM table rendering', needle: 'class="md-table"' },
      { label: 'task list rendering', needle: 'type="checkbox"' },
      { label: 'relative asset path', needle: '/docs/-/assets/images/logo.svg' },
      { label: 'relative markdown link', needle: 'href="#/guide"' },
      { label: 'noCompileLinks option', needle: 'data-no-compile-link-ok="true"' },
      { label: 'externalLinkTarget option', needle: 'data-external-target-ok="true"' },
      { label: 'ignore link attribute', needle: 'href="/raw/" title="raw title"' },
      { label: 'target link attribute', needle: 'data-target-link-ok="true"' },
      { label: 'Markdown engine bridge', needle: 'data-marked-renderer-ok="true"' },
      { label: 'Prism syntax highlight', needle: 'data-prism-ok="true"' },
      { label: 'declarative sidebar opens active ancestors', needle: 'data-sidebar-ancestor-open-ok="true"' },
      { label: 'declarative sidebar collapsed by default', needle: 'data-sidebar-collapsed-default-ok="true"' },
      { label: 'active declarative sidebar page', needle: 'data-sidebar-active-page-ok="true"' },
      { label: 'disabled link attribute', needle: 'aria-disabled="true" tabindex="-1" class="markdown-disabled"' },
      { label: 'heading id attribute', needle: 'id="helper-heading"' },
      { label: 'ignored heading still renders', needle: 'Hidden Heading' },
      { label: 'ignored heading marker is removed', needle: 'data-markdown-ignore="true"' },
      { label: 'ignored heading stays out of TOC', needle: 'data-ignore-toc-ok="true"' },
      { label: 'subMaxLevel headings in sidebar', needle: 'data-sidebar-sublevel-ok="true"' },
      { label: 'active sidebar heading', needle: 'data-sidebar-subactive-ok="true"' },
      { label: 'duplicate generated heading ids', needle: 'data-duplicate-heading-ok="true"' },
      { label: 'image class attribute', needle: 'class="md-image docs-logo"' },
      { label: 'image id attribute', needle: 'id="docs-logo"' },
      { label: 'image width attribute', needle: 'width="50"' },
      { label: 'image height attribute', needle: 'height="100"' },
      { label: 'no-zoom image attribute', needle: 'data-no-zoom="true"' },
      { label: 'Svelte component mount target', needle: 'class="docs-component-mount svelte-component-mount"' },
      { label: 'Svelte component hook mounted', needle: 'data-component-mounted="DemoCounter"' },
      { label: 'Svelte component props passed', needle: 'data-component-props="Mounted from Markdown"' },
      { label: 'tab rendering', needle: 'class="md-tabs"' },
      { label: 'tab interaction', needle: 'data-active-tab-ok="true"' },
      { label: 'stored theme applies on load', needle: 'data-theme-persisted-ok="true"' },
      { label: 'dark Markdown CSS variables', needle: 'data-dark-markdown-vars-ok="true"' },
      { label: 'theme toggle persists user choice', needle: 'data-theme-toggle-persisted-ok="true"' },
      { label: 'custom CSS asset overrides variables', needle: 'data-custom-css-ok="true"' },
      { label: 'admonition rendering', needle: 'class="md-alert md-alert-note"' },
      { label: 'important callout rendering', needle: 'class="md-alert md-alert-important"' },
      { label: 'legacy callout rendering', needle: 'Legacy important callout.' },
      { label: 'Mermaid rendering', needle: 'data-mermaid-rendered="true"' },
      { label: 'Mermaid SVG output', needle: 'class="mermaid-svg"' },
      { label: 'image zoom opens', needle: 'data-zoom-open="true"' },
      { label: 'image zoom closes', needle: 'data-zoom-closed="true"' },
    ])

    const searchDom = await dumpDom(chrome, `${origin}/docs`)
    assertDom(searchDom, [
      { label: 'search smoke completion marker', needle: 'data-smoke-ready="yes"' },
      { label: 'auto-generated WebSocket docs', needle: 'data-protocol-websocket-ok="true"' },
      { label: 'auto-generated GraphQL docs', needle: 'data-protocol-graphql-ok="true"' },
      { label: 'auto-generated stream docs', needle: 'data-protocol-streams-ok="true"' },
      { label: 'auto-generated JSON-RPC docs', needle: 'data-protocol-jsonrpc-ok="true"' },
      { label: 'auto-generated gRPC docs', needle: 'data-protocol-grpc-ok="true"' },
      { label: 'auto-generated TCP docs', needle: 'data-protocol-tcp-ok="true"' },
      { label: 'auto-generated UDP docs', needle: 'data-protocol-udp-ok="true"' },
      { label: 'WebSocket try panel', needle: 'data-protocol-try-websocket-ok="true"' },
      { label: 'GraphQL try panel', needle: 'data-protocol-try-graphql-ok="true"' },
      { label: 'stream try panel', needle: 'data-protocol-try-streams-ok="true"' },
      { label: 'JSON-RPC try panel', needle: 'data-protocol-try-jsonrpc-ok="true"' },
      { label: 'gRPC try panel', needle: 'data-protocol-try-grpc-ok="true"' },
      { label: 'TCP try panel', needle: 'data-protocol-try-tcp-ok="true"' },
      { label: 'UDP try panel', needle: 'data-protocol-try-udp-ok="true"' },
      { label: 'search Ctrl+K hotkey focus', needle: 'data-search-hotkey-ok="true"' },
      { label: 'search index UI result', needle: 'data-search-results-ok="true"' },
    ])

    const autoHeaderDom = await dumpDom(chrome, `${origin}/docs#/no-header`)
    assertDom(autoHeaderDom, [
      { label: 'autoHeader route rendered', needle: 'data-smoke-ready="yes"' },
      { label: 'autoHeader option', needle: '<h1 class="md-h1" id="no-header">' },
      { label: 'autoHeader title text', needle: 'No Header' },
    ])

    const updatedDom = await dumpDom(chrome, `${origin}/docs#/guide`)
    assertDom(updatedDom, [
      { label: 'raffel-updated route rendered', needle: 'data-smoke-ready="yes"' },
      { label: 'updated marker', needle: 'Updated 2026/05/04 03:02.' },
    ])
  } finally {
    await close(server)
  }

  const inlineHtml = injectBrowserSmoke(generateUIHTML({
    doc: docs,
    basePath: '/docs',
    ui: {
      assets: { mode: 'inline' },
      customCss: '/docs/-/assets/custom.css',
      skipLink: 'Jump to content',
      navbar: [
        { title: 'Guide', href: '#/quickstart' },
        { title: 'More', children: [{ title: 'API', href: '#/api' }] },
      ],
      sidebar: { search: true, docsPages: true, subMaxLevel: 3 },
      toc: { enabled: true, minLevel: 2, maxLevel: 3 },
      markdown: {
        externalLinkTarget: '_self',
        externalLinkRel: '',
        noCompileLinks: ['^\\./plain\\.md$'],
        autoHeader: true,
        formatUpdated: 'YYYY/MM/DD HH:mm',
      },
    },
  }), 'inline')
  const { server: inlineServer, origin: inlineOrigin } = await createFixtureServer(inlineHtml)
  try {
    const inlineDom = await dumpDom(chrome, `${inlineOrigin}/docs#/legacy/quickstart?id=install`)
    assertDom(inlineDom, [
      { label: 'inline runtime completion marker', needle: 'data-smoke-ready="yes"' },
      { label: 'inline plugin afterRender hook', needle: 'data-plugin-after-render="yes"' },
      { label: 'inline plugin API version', needle: 'data-plugin-api-version="1"' },
      { label: 'inline regex alias route resolution', needle: 'data-current-hash="#/quickstart?id=install"' },
      { label: 'inline active page state', needle: 'data-active-page="/quickstart"' },
      { label: 'inline plugin beforeMarkdown hook', needle: 'Plugin changed' },
      { label: 'inline Markdown engine bridge', needle: 'data-marked-renderer-ok="true"' },
      { label: 'inline Prism syntax highlight', needle: 'data-prism-ok="true"' },
      { label: 'inline declarative sidebar opens active ancestors', needle: 'data-sidebar-ancestor-open-ok="true"' },
      { label: 'inline active declarative sidebar page', needle: 'data-sidebar-active-page-ok="true"' },
      { label: 'inline subMaxLevel headings in sidebar', needle: 'data-sidebar-sublevel-ok="true"' },
      { label: 'inline active sidebar heading', needle: 'data-sidebar-subactive-ok="true"' },
      { label: 'inline relative markdown link', needle: 'href="#/guide"' },
      { label: 'inline externalLinkTarget option', needle: 'data-external-target-ok="true"' },
      { label: 'inline custom CSS asset overrides variables', needle: 'data-custom-css-ok="true"' },
      { label: 'inline stored theme applies on load', needle: 'data-theme-persisted-ok="true"' },
      { label: 'inline theme toggle persists user choice', needle: 'data-theme-toggle-persisted-ok="true"' },
      { label: 'inline plugin image zoom hook', needle: 'data-plugin-image-zoom="true"' },
      { label: 'inline tab interaction', needle: 'data-active-tab-ok="true"' },
      { label: 'inline plugin copy code hook', needle: 'data-plugin-copy-code="true"' },
    ])
  } finally {
    await close(inlineServer)
  }

  const routeBaseHtml = injectBrowserSmoke(generateUIHTML({
    doc: routeBaseDocs,
    basePath: '/docs',
    ui: { assets: { mode: 'external' }, sidebar: { docsPages: true } },
  }))
  const { server: routeBaseServer, origin: routeBaseOrigin } = await createFixtureServer(routeBaseHtml)
  try {
    const routeBaseDom = await dumpDom(chrome, `${routeBaseOrigin}/docs#/handbook`)
    assertDom(routeBaseDom, [
      { label: 'routeBase route rendered', needle: 'data-smoke-ready="yes"' },
      { label: 'absolute Markdown link keeps docs routeBase', needle: '<a href="#/handbook/guide">Absolute Guide</a>' },
      { label: 'relative Markdown link stays under current routeBase', needle: '<a href="#/handbook/guide">Relative Guide</a>' },
    ])
  } finally {
    await close(routeBaseServer)
  }

  const noEmojiHtml = injectBrowserSmoke(generateUIHTML({
    doc: docs,
    basePath: '/docs',
    ui: {
      assets: { mode: 'external' },
      sidebar: { search: true, docsPages: true },
      markdown: { noEmoji: true },
    },
  }))
  const { server: noEmojiServer, origin: noEmojiOrigin } = await createFixtureServer(noEmojiHtml)
  try {
    const noEmojiDom = await dumpDom(chrome, `${noEmojiOrigin}/docs#/quickstart`)
    assertDom(noEmojiDom, [
      { label: 'noEmoji route rendered', needle: 'data-smoke-ready="yes"' },
      { label: 'noEmoji option keeps shorthand text', needle: ':rocket:' },
    ])
    assertDomMissing(noEmojiDom, [
      { label: 'noEmoji option suppresses emoji spans', needle: 'class="emoji" aria-label="rocket"' },
    ])
  } finally {
    await close(noEmojiServer)
  }

  const rawHtml = injectBrowserSmoke(generateUIHTML({
    doc: docs,
    basePath: '/docs',
    ui: {
      assets: { mode: 'external' },
      sidebar: { search: true, docsPages: true },
      markdown: { html: 'raw' },
    },
  }))
  const { server: rawHtmlServer, origin: rawHtmlOrigin } = await createFixtureServer(rawHtml)
  try {
    const rawHtmlDom = await dumpDom(chrome, `${rawHtmlOrigin}/docs#/quickstart`)
    assertDom(rawHtmlDom, [
      { label: 'raw HTML route rendered', needle: 'data-smoke-ready="yes"' },
      { label: 'raw HTML option renders trusted HTML', needle: '<span data-raw-html="yes">Raw HTML</span>' },
    ])
  } finally {
    await close(rawHtmlServer)
  }

  console.log('Docs UI browser smoke passed.')
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
