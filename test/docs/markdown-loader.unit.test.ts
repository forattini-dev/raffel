import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { loadMarkdownDocs, mergeMarkdownDocumentation } from '../../src/docs/markdown-loader.js'

describe('Markdown docs loader', () => {
  it('loads a Docsify-like docs directory into USD documentation pages', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'raffel-docs-'))
    mkdirSync(path.join(dir, 'guides'))
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
    writeFileSync(path.join(dir, '_sidebar.md'), [
      '- Intro',
      '  - [Home](/README.md)',
      '- Guides',
      '  - [Start here](/guides/quickstart.md)',
    ].join('\n'))
    writeFileSync(path.join(dir, '_navbar.md'), [
      '- [Home](/README.md)',
      '- [Repository](https://example.com/repo)',
    ].join('\n'))
    writeFileSync(path.join(dir, '_coverpage.md'), '# Cover\n\nRaffel docs.')
    writeFileSync(path.join(dir, '_404.md'), '# Not found')

    const loaded = loadMarkdownDocs({ dir, routeBase: '/docs' })

    expect(loaded.documentation.introduction).toBe('# Cover\n\nRaffel docs.')
    expect(loaded.navbar).toEqual([
      { title: 'Home', href: '#/docs', external: false },
      { title: 'Repository', href: 'https://example.com/repo', external: true },
    ])
    expect(loaded.documentation.pages).toEqual([
      {
        title: 'Home',
        path: '/docs',
        markdown: '# Home\n\nWelcome.',
        description: undefined,
        section: 'Intro',
        order: 0,
      },
      {
        title: 'Quickstart',
        path: '/docs/guides/quickstart',
        markdown: '---\ntitle: Quickstart\ndescription: First steps\n---\n# Ignored heading\n\nRun `raffel`.',
        description: 'First steps',
        section: 'Guides',
        order: 1,
      },
      {
        title: '404',
        path: '/docs/404',
        markdown: '# Not found',
        section: 'System',
        order: Number.MAX_SAFE_INTEGER,
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
      }
    )

    expect(merged?.footer).toBe('Explicit footer')
    expect(merged?.pages).toEqual([
      { title: 'Explicit Quickstart', path: '/quickstart', markdown: '# Explicit' },
      { title: 'Loaded Home', path: '/', markdown: '# Home' },
    ])
  })
})
