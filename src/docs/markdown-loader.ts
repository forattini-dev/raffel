import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { USDDocumentation, USDDocumentationPage } from '../usd/index.js'
import type { NavItem } from './ui/types.js'

export interface MarkdownDocsDirConfig {
  /** Directory containing Markdown docs. */
  dir: string
  /** Route prefix for discovered pages, for example `/guides`. */
  routeBase?: string
  /** Directory names to skip while walking docs. */
  excludeDirs?: string[]
}

export type MarkdownDocsSource = string | MarkdownDocsDirConfig

export interface LoadedMarkdownDocs {
  documentation: USDDocumentation
  navbar?: NavItem[]
}

interface FrontmatterResult {
  data: Record<string, string>
  body: string
}

interface SidebarEntry {
  title: string
  path: string
  section?: string
  order: number
}

const SPECIAL_DOCSIFY_FILES = new Set(['_sidebar.md', '_navbar.md', '_coverpage.md', '_404.md'])

export function loadMarkdownDocs(source: MarkdownDocsSource): LoadedMarkdownDocs {
  const config = typeof source === 'string' ? { dir: source } : source
  const rootDir = path.resolve(config.dir)
  const routeBase = normalizeRouteBase(config.routeBase)
  const excludedDirs = new Set(config.excludeDirs ?? ['node_modules', '.git', 'dist', 'build'])
  const markdownFiles = listMarkdownFiles(rootDir, excludedDirs)
  const specialFiles = new Map(markdownFiles
    .filter(file => SPECIAL_DOCSIFY_FILES.has(path.basename(file)))
    .map(file => [path.basename(file), file]))
  const sidebarEntries = specialFiles.has('_sidebar.md')
    ? parseSidebar(readFileSync(specialFiles.get('_sidebar.md')!, 'utf8'), routeBase)
    : []
  const sidebarByPath = new Map(sidebarEntries.map(entry => [entry.path, entry]))
  const pages = markdownFiles
    .filter(file => !SPECIAL_DOCSIFY_FILES.has(path.basename(file)))
    .map((file, index) => {
      const relativePath = path.relative(rootDir, file)
      const markdown = readFileSync(file, 'utf8')
      const routePath = normalizeRoutePath(markdownFileToRoute(relativePath), routeBase)
      return createDocumentationPage(markdown, routePath, relativePath, index, sidebarByPath)
    })
    .sort(comparePages)

  const documentation: USDDocumentation = { pages }
  const coverpage = specialFiles.get('_coverpage.md')
  if (coverpage) {
    documentation.introduction = readFileSync(coverpage, 'utf8')
  }
  const notFound = specialFiles.get('_404.md')
  if (notFound) {
    pages.push({
      title: '404',
      path: normalizeRoutePath('/404', routeBase),
      markdown: readFileSync(notFound, 'utf8'),
      section: 'System',
      order: Number.MAX_SAFE_INTEGER,
    })
  }

  const navbar = specialFiles.has('_navbar.md')
    ? parseNavbar(readFileSync(specialFiles.get('_navbar.md')!, 'utf8'), routeBase)
    : undefined

  return { documentation, navbar }
}

export function mergeMarkdownDocumentation(
  explicit: USDDocumentation | undefined,
  loaded: USDDocumentation | undefined
): USDDocumentation | undefined {
  if (!explicit) return loaded
  if (!loaded) return explicit

  const pagesByPath = new Map<string, USDDocumentationPage>()
  for (const page of loaded.pages ?? []) {
    pagesByPath.set(normalizeRoutePath(page.path), page)
  }
  for (const page of explicit.pages ?? []) {
    pagesByPath.set(normalizeRoutePath(page.path), page)
  }

  return {
    ...loaded,
    ...explicit,
    hero: { ...loaded.hero, ...explicit.hero },
    pages: Array.from(pagesByPath.values()).sort(comparePages),
    externalLinks: [
      ...(loaded.externalLinks ?? []),
      ...(explicit.externalLinks ?? []),
    ],
  }
}

function listMarkdownFiles(rootDir: string, excludedDirs: Set<string>): string[] {
  const entries = readdirSync(rootDir)
  const files: string[] = []
  for (const entry of entries) {
    if (excludedDirs.has(entry)) continue
    const fullPath = path.join(rootDir, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      files.push(...listMarkdownFiles(fullPath, excludedDirs))
      continue
    }
    if (stats.isFile() && entry.toLowerCase().endsWith('.md')) {
      files.push(fullPath)
    }
  }
  return files.sort((a, b) => a.localeCompare(b))
}

function createDocumentationPage(
  markdown: string,
  routePath: string,
  relativePath: string,
  index: number,
  sidebarByPath: Map<string, SidebarEntry>
): USDDocumentationPage {
  const parsed = parseFrontmatter(markdown)
  const sidebar = sidebarByPath.get(routePath)
  const sectionFromPath = path.dirname(relativePath) === '.'
    ? undefined
    : titleFromSlug(path.dirname(relativePath).split(path.sep)[0])
  const title = parsed.data.title
    ?? sidebar?.title
    ?? extractFirstHeading(parsed.body)
    ?? titleFromSlug(path.basename(relativePath, '.md'))

  return {
    title,
    path: routePath,
    markdown,
    description: parsed.data.description,
    section: parsed.data.section ?? sidebar?.section ?? sectionFromPath,
    order: parseNumericOrder(parsed.data.order) ?? sidebar?.order ?? index,
  }
}

function parseFrontmatter(markdown: string): FrontmatterResult {
  if (!markdown.startsWith('---\n')) return { data: {}, body: markdown }
  const end = markdown.indexOf('\n---', 4)
  if (end === -1) return { data: {}, body: markdown }
  const raw = markdown.slice(4, end)
  const body = markdown.slice(end + 4).replace(/^\r?\n/, '')
  const data: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (!match) continue
    data[match[1]] = stripYamlString(match[2])
  }
  return { data, body }
}

function parseSidebar(markdown: string, routeBase: string): SidebarEntry[] {
  const entries: SidebarEntry[] = []
  let section: string | undefined
  let order = 0

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(\s*)[-*]\s+(?:\[([^\]]+)\]\(([^)]+)\)|(.+))\s*$/.exec(line)
    if (!match) continue
    const indent = match[1].length
    const linkTitle = match[2]
    const href = match[3]
    const label = (match[4] ?? '').trim()
    if (!href) {
      if (indent === 0 && label) section = label
      continue
    }
    entries.push({
      title: linkTitle.trim(),
      path: normalizeDocsHref(href, routeBase),
      section,
      order: order++,
    })
  }

  return entries
}

function parseNavbar(markdown: string, routeBase: string): NavItem[] {
  const items: NavItem[] = []
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\s*[-*]\s+\[([^\]]+)\]\(([^)]+)\)/.exec(line)
    if (!match) continue
    const title = match[1].trim()
    const href = match[2].trim()
    const external = isExternalHref(href)
    items.push({
      title,
      href: external ? href : `#${normalizeDocsHref(href, routeBase)}`,
      external,
    })
  }
  return items
}

function markdownFileToRoute(relativePath: string): string {
  const normalized = relativePath.split(path.sep).join('/')
  if (/^README\.md$/i.test(normalized)) return '/'
  if (/\/README\.md$/i.test(normalized)) {
    return `/${normalized.replace(/\/README\.md$/i, '')}`
  }
  return `/${normalized.replace(/\.md$/i, '')}`
}

function normalizeDocsHref(href: string, routeBase: string): string {
  if (isExternalHref(href)) return href
  const withoutHash = href.split('#')[0]
  const route = withoutHash.endsWith('.md')
    ? markdownFileToRoute(withoutHash)
    : withoutHash
  return normalizeRoutePath(route, routeBase)
}

function normalizeRouteBase(routeBase: string | undefined): string {
  if (!routeBase) return ''
  const normalized = normalizeRoutePath(routeBase)
  return normalized === '/' ? '' : normalized
}

function normalizeRoutePath(routePath: string, routeBase = ''): string {
  const withoutHash = routePath.split('#')[0]
  const normalized = `/${withoutHash}`.replace(/\/+/g, '/').replace(/\/$/, '')
  const pathPart = normalized === '' ? '/' : normalized
  if (!routeBase) return pathPart || '/'
  if (pathPart === '/') return routeBase || '/'
  return `${routeBase}${pathPart}`.replace(/\/+/g, '/')
}

function extractFirstHeading(markdown: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(markdown)
  return match?.[1]?.trim()
}

function titleFromSlug(slug: string): string {
  return slug
    .replace(/README$/i, 'Home')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase())
}

function stripYamlString(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

function parseNumericOrder(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function comparePages(a: USDDocumentationPage, b: USDDocumentationPage): number {
  return (a.order ?? 0) - (b.order ?? 0)
    || (a.section ?? '').localeCompare(b.section ?? '')
    || a.title.localeCompare(b.title)
}

function isExternalHref(href: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href) || /^(?:mailto|tel):/i.test(href)
}
