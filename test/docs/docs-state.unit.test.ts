import { describe, expect, it } from 'vitest'

import {
  createMarkdownDocsState,
  joinDocsEndpoint,
  normalizeDocsBasePath,
} from '../../src/docs/docs-state.js'

describe('docs state', () => {
  it('normalizes docs base paths and endpoint suffixes consistently', () => {
    expect(normalizeDocsBasePath('docs/')).toBe('/docs')
    expect(normalizeDocsBasePath('/docs///')).toBe('/docs')
    expect(normalizeDocsBasePath('/')).toBe('/')

    expect(joinDocsEndpoint('docs/', 'state.json')).toBe('/docs/state.json')
    expect(joinDocsEndpoint('/docs/', '/openapi.json')).toBe('/docs/openapi.json')
    expect(joinDocsEndpoint('/', '/state.json')).toBe('/state.json')
  })

  it('creates Markdown docs state without depending on USD HTTP handlers', () => {
    const state = createMarkdownDocsState({
      basePath: '/docs/',
      docsDir: '/tmp/docs',
      documentation: {
        pages: [
          {
            title: 'Guide',
            path: '/guide/',
            markdown: '# Guide',
            filePath: 'guide.md',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
          {
            title: 'Intro',
            path: 'intro',
            markdown: '# Intro',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
        aliases: {
          '/start': '/intro',
        },
        sidebar: [
          {
            title: 'Docs',
            children: [
              { title: 'Intro', path: '/intro' },
            ],
          },
        ],
      },
      mounted: true,
      loadedAt: '2026-01-03T00:00:00.000Z',
      mountedAt: '2026-01-04T00:00:00.000Z',
    })

    expect(state).toMatchObject({
      enabled: true,
      mounted: true,
      fresh: true,
      revision: 1,
      basePath: '/docs',
      endpoints: {
        ui: '/docs',
        state: '/docs/state.json',
        assets: '/docs/-/assets/*',
      },
      paths: {
        pages: ['/guide', '/intro'],
        files: ['guide.md'],
        aliases: ['/start'],
        assets: '/docs/-/assets/*',
      },
      counts: {
        configured: 1,
        pages: 2,
        fileBackedPages: 0,
        explicitPages: 2,
        aliases: 1,
        sidebarItems: 2,
      },
      updatedAt: '2026-01-02T00:00:00.000Z',
      loadedAt: '2026-01-03T00:00:00.000Z',
      mountedAt: '2026-01-04T00:00:00.000Z',
      staleReasons: [],
    })
  })
})
