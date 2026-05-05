import type { USDDocumentationPage } from '../usd/index.js'

export interface DocsSearchIndexEntry {
  kind: 'page' | 'heading'
  title: string
  path: string
  section?: string
  headingId?: string
  excerpt: string
  text: string
  rank: number
}

interface ParsedMarkdownPage {
  frontmatter: Record<string, string>
  body: string
}

export function buildDocsSearchIndex(pages: readonly USDDocumentationPage[] = []): DocsSearchIndexEntry[] {
  return pages.flatMap((page, pageIndex) => indexPage(page, pageIndex))
}

function indexPage(page: USDDocumentationPage, pageIndex: number): DocsSearchIndexEntry[] {
  const parsed = parseFrontmatter(page.markdown)
  const title = parsed.frontmatter.title ?? page.title ?? firstHeading(parsed.body) ?? page.path
  const section = parsed.frontmatter.section ?? page.section
  const bodyText = markdownToText(parsed.body)
  const entries: DocsSearchIndexEntry[] = [{
    kind: 'page',
    title,
    path: normalizeDocsPath(page.path),
    section,
    excerpt: firstExcerpt(bodyText),
    text: [title, section, page.description, bodyText].filter(Boolean).join(' '),
    rank: pageIndex * 100,
  }]

  const headings = extractHeadingSections(parsed.body)
  headings.forEach((heading, headingIndex) => {
    entries.push({
      kind: 'heading',
      title: heading.title,
      path: normalizeDocsPath(page.path),
      section,
      headingId: slugifyHeading(heading.title),
      excerpt: firstExcerpt(markdownToText(heading.markdown)),
      text: [title, section, heading.title, markdownToText(heading.markdown)].filter(Boolean).join(' '),
      rank: pageIndex * 100 + headingIndex + 1,
    })
  })

  return entries
}

function parseFrontmatter(markdown: string): ParsedMarkdownPage {
  const source = String(markdown ?? '').replace(/\r\n?/g, '\n')
  if (!source.startsWith('---\n')) return { frontmatter: {}, body: source }
  const end = source.indexOf('\n---', 4)
  if (end === -1) return { frontmatter: {}, body: source }

  const frontmatter: Record<string, string> = {}
  for (const line of source.slice(4, end).split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    frontmatter[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }

  return { frontmatter, body: source.slice(end + 4).replace(/^\n/, '') }
}

function extractHeadingSections(markdown: string): Array<{ title: string, markdown: string }> {
  const lines = markdown.split(/\r?\n/)
  const sections: Array<{ title: string, markdown: string[] }> = []
  let current: { title: string, markdown: string[] } | null = null

  for (const line of lines) {
    const heading = /^#{2,3}\s+(.+)$/.exec(line.trim())
    if (heading) {
      if (current) sections.push(current)
      current = { title: heading[1].replace(/\s+#+$/, '').trim(), markdown: [] }
      continue
    }
    current?.markdown.push(line)
  }

  if (current) sections.push(current)
  return sections.map(section => ({ title: section.title, markdown: section.markdown.join('\n') }))
}

function firstHeading(markdown: string): string | undefined {
  return /^#\s+(.+)$/m.exec(markdown)?.[1]?.replace(/\s+#+$/, '').trim()
}

function markdownToText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_`~|[\]()-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function firstExcerpt(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 180 ? `${compact.slice(0, 177).trim()}...` : compact
}

function normalizeDocsPath(path: string): string {
  const raw = String(path ?? '').trim()
  if (!raw) return '/'
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withSlash.replace(/\/+$/, '') || '/'
}

function slugifyHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
