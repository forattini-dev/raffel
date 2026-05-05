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
          '## Build docs',
          '',
          'Generate USD documentation from Markdown and API metadata.',
        ].join('\n'),
      },
    ])

    expect(index).toEqual([
      {
        kind: 'page',
        title: 'Quickstart',
        path: '/guides/quickstart',
        section: 'Learn',
        excerpt: 'Quickstart Install Raffel and create your first server. Build docs Generate USD documentation from Markdown and API metadata.',
        text: 'Quickstart Learn Quickstart Install Raffel and create your first server. Build docs Generate USD documentation from Markdown and API metadata.',
        rank: 0,
      },
      {
        kind: 'heading',
        title: 'Build docs',
        path: '/guides/quickstart',
        section: 'Learn',
        headingId: 'build-docs',
        excerpt: 'Generate USD documentation from Markdown and API metadata.',
        text: 'Quickstart Learn Build docs Generate USD documentation from Markdown and API metadata.',
        rank: 1,
      },
    ])
  })
})
