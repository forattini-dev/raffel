import { describe, expect, it } from 'vitest'

import {
  defaultEditLinkLabel,
  resolveEditLink,
  type DocsRepoConfig,
  type ResolveEditLinkInput,
} from '../../src/docs/ui/edit-link.js'

interface Case {
  name: string
  input: ResolveEditLinkInput
  expected: { url: string; label: string } | null
}

const githubRepo: DocsRepoConfig = { base: 'https://github.com/forattini-dev/raffel' }

const cases: Case[] = [
  {
    name: 'GitHub default branch resolves to /edit/main/<filePath>',
    input: { filePath: 'docs/guides/quickstart.md', docsRepo: githubRepo },
    expected: {
      url: 'https://github.com/forattini-dev/raffel/edit/main/docs/guides/quickstart.md',
      label: 'Edit on GitHub',
    },
  },
  {
    name: 'GitHub custom branch is used in the URL',
    input: {
      filePath: 'docs/guides/quickstart.md',
      docsRepo: { ...githubRepo, branch: 'develop' },
    },
    expected: {
      url: 'https://github.com/forattini-dev/raffel/edit/develop/docs/guides/quickstart.md',
      label: 'Edit on GitHub',
    },
  },
  {
    name: 'pathPrefix is concatenated and slash-normalized',
    input: {
      filePath: 'guides/quickstart.md',
      docsRepo: { ...githubRepo, pathPrefix: 'docs/' },
    },
    expected: {
      url: 'https://github.com/forattini-dev/raffel/edit/main/docs/guides/quickstart.md',
      label: 'Edit on GitHub',
    },
  },
  {
    name: 'non-GitHub host falls back to "Edit this page" label',
    input: {
      filePath: 'docs/guides/quickstart.md',
      docsRepo: { base: 'https://gitlab.com/owner/repo', branch: 'trunk' },
    },
    expected: {
      url: 'https://gitlab.com/owner/repo/edit/trunk/docs/guides/quickstart.md',
      label: 'Edit this page',
    },
  },
  {
    name: 'missing docsRepo returns null',
    input: { filePath: 'docs/guides/quickstart.md' },
    expected: null,
  },
  {
    name: 'generated reference (no filePath) returns null',
    input: { filePath: undefined, docsRepo: githubRepo },
    expected: null,
  },
  {
    name: 'frontmatter editable: false opts out of the link',
    input: {
      filePath: 'docs/guides/quickstart.md',
      docsRepo: githubRepo,
      frontmatter: { editable: false },
    },
    expected: null,
  },
]

describe('resolveEditLink', () => {
  it.each(cases)('$name', ({ input, expected }) => {
    expect(resolveEditLink(input)).toEqual(expected)
  })

  it('honors a string "false" for editable in frontmatter', () => {
    expect(resolveEditLink({
      filePath: 'docs/x.md',
      docsRepo: githubRepo,
      frontmatter: { editable: 'false' },
    })).toBeNull()
  })

  it('uses an explicit label override when provided', () => {
    const result = resolveEditLink({
      filePath: 'docs/x.md',
      docsRepo: { ...githubRepo, label: 'Suggest a change' },
    })
    expect(result?.label).toBe('Suggest a change')
  })

  it('encodes spaces and unsafe characters in path segments', () => {
    const result = resolveEditLink({
      filePath: 'docs/guides/with space.md',
      docsRepo: githubRepo,
    })
    expect(result?.url).toBe(
      'https://github.com/forattini-dev/raffel/edit/main/docs/guides/with%20space.md'
    )
  })

  it('respects a custom editSegment for non-GitHub forges', () => {
    const result = resolveEditLink({
      filePath: 'docs/x.md',
      docsRepo: { base: 'https://bitbucket.org/owner/repo', editSegment: 'src' },
    })
    expect(result?.url).toBe('https://bitbucket.org/owner/repo/src/main/docs/x.md')
  })
})

describe('defaultEditLinkLabel', () => {
  it('returns "Edit on GitHub" for github.com bases', () => {
    expect(defaultEditLinkLabel('https://github.com/o/r')).toBe('Edit on GitHub')
  })

  it('returns "Edit this page" for non-GitHub bases', () => {
    expect(defaultEditLinkLabel('https://gitlab.com/o/r')).toBe('Edit this page')
  })
})
