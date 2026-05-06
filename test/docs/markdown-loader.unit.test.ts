import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadMarkdownDocs, mergeMarkdownDocumentation, resolveMarkdownDocsSource } from '../../src/docs/markdown-loader.js'
import { readDocsAsset } from '../../src/docs/usd-middleware.js'

describe('Markdown docs loader', () => {
  it('loads a file-backed Markdown docs directory into USD documentation pages', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'raffel-docs-'))
    mkdirSync(path.join(dir, 'guides'))
    mkdirSync(path.join(dir, 'guides', 'advanced'))
    writeFileSync(path.join(dir, 'README.md'), '# Home\n\nWelcome.')
    writeFileSync(path.join(dir, 'guides', 'quickstart.md'), [
      '---',
      'title: Quickstart',
      'description: First steps',
      '---',
      '# Ignored heading',
      '',
      'Run `raffel`.',
    ].join('\n'))
    writeFileSync(path.join(dir, 'guides', 'advanced', 'deep.md'), '# Deep\n\nAdvanced docs.')
    writeFileSync(path.join(dir, '_sidebar.md'), [
      '- Intro',
      '  - [Home](/README.md)',
      '- Guides',
      '  - [Start here](/guides/quickstart.md)',
    ].join('\n'))
    writeFileSync(path.join(dir, 'guides', '_sidebar.md'), [
      '- Guide Local',
      '  - [Quick local](quickstart.md)',
      '  - [Deep local](advanced/deep.md)',
      '  - [Home absolute](/README.md)',
    ].join('\n'))
    writeFileSync(path.join(dir, '_navbar.md'), [
      '- [Home](/README.md)',
      '- Translations',
      '  - [English](/README.md)',
      '  - [Portuguese](/guides/quickstart.md)',
      '- [Repository](https://example.com/repo)',
    ].join('\n'))
    writeFileSync(path.join(dir, '_coverpage.md'), '# Cover\n\nRaffel docs.')
    writeFileSync(path.join(dir, '_404.md'), '# Not found')

    const loaded = loadMarkdownDocs({
      dir,
      routeBase: '/docs',
      aliases: {
        '/old-start.md': '/guides/quickstart.md',
        '/legacy/(.*).md': '/guides/$1.md',
      },
    })

    expect(loaded.documentation.introduction).toBe('# Cover\n\nRaffel docs.')
    expect(loaded.documentation.routeBase).toBe('/docs')
    expect(loaded.documentation.aliases).toEqual({
      '/docs/old-start': '/docs/guides/quickstart',
      '/docs/legacy/(.*)': '/docs/guides/$1',
    })
    expect(loaded.documentation.sidebar).toEqual([
      {
        title: 'Intro',
        children: [{ title: 'Home', path: '/docs' }],
      },
      {
        title: 'Guides',
        children: [{ title: 'Start here', path: '/docs/guides/quickstart' }],
      },
    ])
    expect(loaded.navbar).toEqual([
      { title: 'Home', href: '#/docs', external: false },
      {
        title: 'Translations',
        children: [
          { title: 'English', href: '#/docs', external: false },
          { title: 'Portuguese', href: '#/docs/guides/quickstart', external: false },
        ],
      },
      { title: 'Repository', href: 'https://example.com/repo', external: true },
    ])
    expect(loaded.documentation.pages.map(page => ({
      ...page,
      updatedAt: page.updatedAt ? '<updated>' : undefined,
    }))).toEqual([
      {
        title: 'Quickstart',
        path: '/docs/guides/quickstart',
        markdown: '---\ntitle: Quickstart\ndescription: First steps\n---\n# Ignored heading\n\nRun `raffel`.',
        description: 'First steps',
        section: 'Guide Local',
        order: 0,
        updatedAt: '<updated>',
      },
      {
        title: 'Home',
        path: '/docs',
        markdown: '# Home\n\nWelcome.',
        description: undefined,
        section: 'Intro',
        order: 0,
        updatedAt: '<updated>',
      },
      {
        title: 'Deep local',
        path: '/docs/guides/advanced/deep',
        markdown: '# Deep\n\nAdvanced docs.',
        description: undefined,
        section: 'Guide Local',
        order: 1,
        updatedAt: '<updated>',
      },
      {
        title: '404',
        path: '/docs/404',
        markdown: '# Not found',
        section: 'System',
        order: Number.MAX_SAFE_INTEGER,
        updatedAt: '<updated>',
      },
    ])
  })

  it('lets explicit documentation pages override loaded pages by path', () => {
    const merged = mergeMarkdownDocumentation(
      {
        pages: [
          {
            title: 'Explicit Quickstart',
            path: '/quickstart',
            markdown: '# Explicit',
          },
        ],
        footer: 'Explicit footer',
        aliases: { '/legacy': '/explicit' },
      },
      {
        pages: [
          {
            title: 'Loaded Quickstart',
            path: '/quickstart',
            markdown: '# Loaded',
          },
          {
            title: 'Loaded Home',
            path: '/',
            markdown: '# Home',
          },
        ],
        footer: 'Loaded footer',
        aliases: { '/old-home': '/' },
      }
    )

    expect(merged?.footer).toBe('Explicit footer')
    expect(merged?.aliases).toEqual({ '/old-home': '/', '/legacy': '/explicit' })
    expect(merged?.pages).toEqual([
      { title: 'Explicit Quickstart', path: '/quickstart', markdown: '# Explicit' },
      { title: 'Loaded Home', path: '/', markdown: '# Home' },
    ])
  })

  it('supports a custom Markdown docs homepage file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'raffel-docs-homepage-'))
    writeFileSync(path.join(dir, 'README.md'), '# Readme\n\nSecondary readme.')
    writeFileSync(path.join(dir, 'home.md'), '# Custom home\n\nPrimary page.')
    writeFileSync(path.join(dir, '_navbar.md'), '- [Start](/home.md)\n- [Readme](/README.md)')

    const loaded = loadMarkdownDocs({
      dir,
      routeBase: '/docs',
      homepage: 'home.md',
      aliases: { '/legacy-home.md': '/home.md' },
    })

    expect(loaded.documentation.aliases).toEqual({ '/docs/legacy-home': '/docs' })
    expect(loaded.navbar).toEqual([
      { title: 'Start', href: '#/docs', external: false },
      { title: 'Readme', href: '#/docs/README', external: false },
    ])
    expect(loaded.documentation.pages.map(page => [page.path, page.title])).toEqual([
      ['/docs', 'Custom home'],
      ['/docs/README', 'Readme'],
    ])
  })

  it('treats docsDir true as the project docs directory', () => {
    const source = resolveMarkdownDocsSource(true)

    expect(source.rootDir).toBe(path.resolve('docs'))
    expect(source.routeBase).toBe('')
    expect(source.excludeDirs.has('node_modules')).toBe(true)
  })

  it('serves static assets from docsDir without exposing markdown or traversal paths', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'raffel-docs-assets-'))
    mkdirSync(path.join(dir, 'images'))
    writeFileSync(path.join(dir, 'images', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    writeFileSync(path.join(dir, 'custom.css'), 'body { color: black; }')
    writeFileSync(path.join(dir, 'custom.js'), 'window.docsLoaded = true')
    writeFileSync(path.join(dir, 'module.mjs'), 'export const docsLoaded = true')
    writeFileSync(path.join(dir, 'secret.md'), '# Secret')

    const source = resolveMarkdownDocsSource(dir)
    const asset = readDocsAsset(source.rootDir, 'images/logo.svg')
    const css = readDocsAsset(source.rootDir, 'custom.css')
    const js = readDocsAsset(source.rootDir, 'custom.js')
    const mjs = readDocsAsset(source.rootDir, 'module.mjs')

    expect(asset?.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(await asset?.text()).toContain('<svg')
    expect(css?.headers.get('Content-Type')).toBe('text/css; charset=utf-8')
    expect(await css?.text()).toContain('color: black')
    expect(js?.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8')
    expect(await js?.text()).toContain('docsLoaded')
    expect(mjs?.headers.get('Content-Type')).toBe('application/javascript; charset=utf-8')
    expect(await mjs?.text()).toContain('export const')
    expect(readDocsAsset(source.rootDir, 'secret.md')).toBeNull()
    expect(readDocsAsset(source.rootDir, '../package.json')).toBeNull()
  })
})
