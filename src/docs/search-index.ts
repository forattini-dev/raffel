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

export function getDocsSearchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean)
}

export function scoreDocsSearchEntry(entry: Pick<DocsSearchIndexEntry, 'kind' | 'title' | 'section' | 'excerpt' | 'text'>, query: string | string[]): number {
  const terms = Array.isArray(query) ? query : getDocsSearchTerms(query)
  if (terms.length === 0) return 0
  const phrase = terms.join(' ')
  const title = String(entry.title ?? '').toLowerCase()
  const section = String(entry.section ?? '').toLowerCase()
  const excerpt = String(entry.excerpt ?? '').toLowerCase()
  const text = String(entry.text ?? '').toLowerCase()
  const combined = `${title} ${section} ${excerpt} ${text}`
  let score = scoreSearchField(title, phrase, terms, 140, 80, 52)
    + scoreSearchField(section, phrase, terms, 60, 32, 18)
    + scoreSearchField(excerpt, phrase, terms, 42, 18, 10)
    + scoreSearchField(text, phrase, terms, 16, 8, 4)
  const allTermsMatch = terms.every(term => combined.includes(term))
  if (terms.length > 1) score = allTermsMatch ? score + 35 : Math.floor(score * 0.2)
  if (entry.kind === 'heading' && score > 0) score += 12
  return score
}

function scoreSearchField(value: string, phrase: string, terms: string[], phraseScore: number, prefixScore: number, termScore: number): number {
  if (!value) return 0
  let score = value === phrase ? phraseScore * 2 : value.includes(phrase) ? phraseScore : 0
  for (const term of terms) {
    if (value === term) score += prefixScore * 2
    else if (value.startsWith(term)) score += prefixScore
    else if (value.includes(term)) score += termScore
  }
  return score
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
      headingId: heading.id,
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

function extractHeadingSections(markdown: string): Array<{ title: string, id: string, markdown: string }> {
  const lines = markdown.split(/\r?\n/)
  const sections: Array<{ title: string, id: string, markdown: string[] }> = []
  let current: { title: string, id: string, markdown: string[] } | null = null
  const seenHeadingIds = new Map<string, number>()
  let sawHeading = false

  for (const line of lines) {
    const heading = /^#{2,3}\s+(.+)$/.exec(line.trim())
    if (heading) {
      sawHeading = true
      if (current) sections.push(current)
      const parsedHeading = parseHeadingTitle(heading[1])
      const id = uniqueHeadingId(parsedHeading.id, parsedHeading.customId, seenHeadingIds)
      if (parsedHeading.ignoreAll) return []
      if (parsedHeading.ignore) {
        current = null
        continue
      }
      current = { ...parsedHeading, id, markdown: [] }
      continue
    }
    const topHeading = /^#\s+(.+)$/.exec(line.trim())
    if (!sawHeading && topHeading) {
      const parsedHeading = parseHeadingTitle(topHeading[1])
      uniqueHeadingId(parsedHeading.id, parsedHeading.customId, seenHeadingIds)
      if (parsedHeading.ignoreAll) return []
    }
    current?.markdown.push(line)
  }

  if (current) sections.push(current)
  return sections.map(section => ({
    title: section.title,
    id: section.id,
    markdown: section.markdown.join('\n'),
  }))
}

function firstHeading(markdown: string): string | undefined {
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]
  return heading ? parseHeadingTitle(heading).title : undefined
}

function markdownToText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s+:id=[A-Za-z0-9_-]+/g, ' ')
    .replace(/<!--\s*\{raffel-ignore(?:-all)?\}\s*-->/ig, ' ')
    .replace(/\{raffel-ignore(?:-all)?\}/ig, ' ')
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

function parseHeadingTitle(value: string): { title: string, id: string, customId: boolean, ignore: boolean, ignoreAll: boolean } {
  const withoutClosingHashes = value.replace(/\s+#+$/, '').trim()
  const ignoreAll = /\{raffel-ignore-all\}/i.test(withoutClosingHashes)
  const ignore = ignoreAll || /\{raffel-ignore\}/i.test(withoutClosingHashes)
  const withoutIgnore = withoutClosingHashes
    .replace(/<!--\s*\{raffel-ignore(?:-all)?\}\s*-->/ig, '')
    .replace(/\{raffel-ignore(?:-all)?\}/ig, '')
    .trim()
  const idMatch = withoutIgnore.match(/\s+:id=([A-Za-z0-9_-]+)\s*$/)
  const title = idMatch
    ? withoutIgnore.slice(0, idMatch.index).trim()
    : withoutIgnore
  return {
    title,
    id: idMatch?.[1] ?? slugifyHeading(title),
    customId: Boolean(idMatch),
    ignore,
    ignoreAll,
  }
}

function uniqueHeadingId(id: string, customId: boolean, seen: Map<string, number>): string {
  if (customId) return id
  const count = seen.get(id) ?? 0
  seen.set(id, count + 1)
  return count ? `${id}-${count}` : id
}
