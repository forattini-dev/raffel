import { describe, expect, it } from 'vitest'

import { resolveEditLink } from '../../src/docs/ui/edit-link.js'
import { generateUICSS, generateUIHTML } from '../../src/docs/ui/html-builder.js'
import type { USDDocumentationPage } from '../../src/usd/index.js'

const docsRepo = {
  base: 'https://github.com/forattini-dev/raffel',
  branch: 'main',
}

function buildSpec(pages: USDDocumentationPage[]) {
  return {
    info: { title: 'Edit-link demo', version: '1.0.0' },
    paths: {
      '/things': {
        get: {
          operationId: 'listThings',
          tags: ['Things'],
          responses: { '200': { description: 'OK' } },
        },
      },
    },
    'x-usd': {
      documentation: { pages },
    },
  }
}

describe('Edit-on-source link integration', () => {
  it('embeds docsRepoConfig and a Markdown page filePath into the runtime payload', () => {
    const markdownPage: USDDocumentationPage = {
      title: 'Quickstart',
      path: '/quickstart',
      markdown: '# Quickstart\n\nGet started.',
      filePath: 'docs/quickstart.md',
    }

    const html = generateUIHTML({
      basePath: '/docs',
      doc: buildSpec([markdownPage]),
      ui: { docsRepo },
    })

    // docsRepoConfig is wired into the bootstrap data.
    expect(html).toContain('docsRepoConfig:')
    expect(html).toContain('https://github.com/forattini-dev/raffel')
    // The Markdown page surfaces filePath into the runtime so the resolver can use it.
    expect(html).toContain('docs/quickstart.md')
    // Edit-link CSS lands in the inline stylesheet.
    expect(html).toContain('.docs-edit-link')
    expect(html).toContain('.docs-page-header')

    // The pure resolver yields the canonical GitHub edit URL for that page.
    expect(resolveEditLink({
      filePath: markdownPage.filePath,
      docsRepo,
    })).toEqual({
      url: 'https://github.com/forattini-dev/raffel/edit/main/docs/quickstart.md',
      label: 'Edit on GitHub',
    })
  })

  it('renders no edit link for a generated reference page (no filePath)', () => {
    const generatedPage: USDDocumentationPage = {
      title: 'Generated reference',
      path: '/reference',
      markdown: '# Generated\n\nAuto-generated body.',
      // intentionally no filePath
    }

    const html = generateUIHTML({
      basePath: '/docs',
      doc: buildSpec([generatedPage]),
      ui: { docsRepo },
    })

    // docsRepoConfig still embeds because UI is configured.
    expect(html).toContain('docsRepoConfig:')
    // The pure resolver returns null for pages without a filePath.
    expect(resolveEditLink({ filePath: undefined, docsRepo })).toBeNull()
    expect(resolveEditLink({
      filePath: generatedPage.filePath as string | undefined,
      docsRepo,
    })).toBeNull()
  })

  it('omits docsRepoConfig wiring (defaults to null) when docsRepo is not configured', () => {
    const html = generateUIHTML({
      basePath: '/docs',
      doc: buildSpec([{
        title: 'Quickstart',
        path: '/quickstart',
        markdown: '# Quickstart',
        filePath: 'docs/quickstart.md',
      }]),
    })

    // The runtime still sees the key, but its value is null -> the resolver short-circuits.
    expect(html).toMatch(/docsRepoConfig:\s*null/)
  })

  it('emits the edit-link CSS section in the generated stylesheet', () => {
    const css = generateUICSS({
      basePath: '/docs',
      doc: buildSpec([]),
      ui: { docsRepo },
    })

    expect(css).toContain('.docs-edit-link')
    expect(css).toContain('.docs-edit-link-glyph')
    expect(css).toContain('.docs-page-header')
  })
})
