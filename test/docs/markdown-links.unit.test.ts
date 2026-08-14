import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { findBrokenMarkdownLinks } from '../../scripts/docs-validation.mjs'

describe('published Markdown links', () => {
  it('resolve every local editorial link outside examples', async () => {
    const broken = await findBrokenMarkdownLinks({
      projectRoot: new URL('../..', import.meta.url),
      roots: ['docs', '.red/CONTEXT.md', '.red/adr', '.red/researches'],
    })

    expect(broken).toEqual([])
  })

  it('reports missing local targets without flagging non-editorial links', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'raffel-doc-links-'))

    try {
      await mkdir(join(projectRoot, 'docs', 'guides'), { recursive: true })
      await writeFile(join(projectRoot, 'docs', 'overview.md'), '# Overview\n')
      await writeFile(join(projectRoot, 'docs', 'guides', 'existing.md'), '# Existing\n')
      await writeFile(join(projectRoot, 'docs', 'guides', 'links.md'), [
        '[relative](existing.md)',
        '[absolute](/overview.md)',
        '[external](https://example.com/missing)',
        '[anchor](#missing)',
        '`[inline code](inline-missing.md)`',
        '```md',
        '[fenced code](fenced-missing.md)',
        '```',
        '[missing](missing.md)',
      ].join('\n'))

      await expect(findBrokenMarkdownLinks({
        projectRoot,
        roots: ['docs'],
      })).resolves.toEqual([{
        file: 'docs/guides/links.md',
        line: 9,
        target: 'missing.md',
      }])
    } finally {
      await rm(projectRoot, { recursive: true, force: true })
    }
  })
})
