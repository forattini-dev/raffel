import { describe, expect, it } from 'vitest'

import { buildDocsSearchIndex } from '../../src/docs/search-index.js'

describe('Docs search index', () => {
  it('indexes pages and heading sections with stable heading ids and excerpts', () => {
    const index = buildDocsSearchIndex([
      {
        title: 'Fallback',
        path: '/guides/quickstart',
        section: 'Guides',
        markdown: [
          '---',
          'title: Quickstart',
          'section: Learn',
          '---',
          '# Quickstart',
          '',
          'Install Raffel and create your first server.',
          '',
          '## Build docs :id=build-custom',
          '',
          'Generate USD documentation from Markdown and API metadata.',
          '',
          '## Hidden <!-- {raffel-ignore} -->',
          '',
          'This ignored heading should not be indexed.',
        ].join('\n'),
      },
    ])

    expect(index).toEqual([
      {
        kind: 'page',
        title: 'Quickstart',
        path: '/guides/quickstart',
        section: 'Learn',
        excerpt: 'Quickstart Install Raffel and create your first server. Build docs Generate USD documentation from Markdown and API metadata. Hidden This ignored heading should not be indexed.',
        text: 'Quickstart Learn Quickstart Install Raffel and create your first server. Build docs Generate USD documentation from Markdown and API metadata. Hidden This ignored heading should not be indexed.',
        rank: 0,
      },
      {
        kind: 'heading',
        title: 'Build docs',
        path: '/guides/quickstart',
        section: 'Learn',
        headingId: 'build-custom',
        excerpt: 'Generate USD documentation from Markdown and API metadata.',
        text: 'Quickstart Learn Build docs Generate USD documentation from Markdown and API metadata.',
        rank: 1,
      },
    ])
  })

  it('honors raffel-ignore-all on the first page heading', () => {
    const index = buildDocsSearchIndex([
      {
        title: 'Hidden headings',
        path: '/hidden',
        markdown: '# Hidden headings {raffel-ignore-all}\n\n## Details\n\nSecret detail.',
      },
    ])

    expect(index).toEqual([
      {
        kind: 'page',
        title: 'Hidden headings',
        path: '/hidden',
        section: undefined,
        excerpt: 'Hidden headings Details Secret detail.',
        text: 'Hidden headings Hidden headings Details Secret detail.',
        rank: 0,
      },
    ])
  })

  it('keeps duplicate generated heading ids unique while preserving custom ids', () => {
    const index = buildDocsSearchIndex([
      {
        title: 'Duplicates',
        path: '/duplicates',
        markdown: '# Install\n\n## Install\n\nFirst.\n\n## Install\n\nSecond.\n\n## Install :id=install\n\nCustom.',
      },
    ])

    expect(index.filter(entry => entry.kind === 'heading').map(entry => [entry.title, entry.headingId])).toEqual([
      ['Install', 'install-1'],
      ['Install', 'install-2'],
      ['Install', 'install'],
    ])
  })
})
