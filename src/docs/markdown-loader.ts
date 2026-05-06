import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import type { USDDocumentation, USDDocumentationPage, USDDocumentationSidebarItem, USDHero, USDHeroButton } from '../usd/index.js'
import type { NavItem } from './ui/types.js'

export interface MarkdownDocsDirConfig {
  /** Directory containing Markdown docs. */
  dir: string
  /** Route prefix for discovered pages, for example `/guides`. */
  routeBase?: string
  /** file-backed Markdown route aliases. Keys and values are normalized to hash routes. */
  aliases?: Record<string, string>
  /** Markdown file to use as the docs home page instead of README.md. */
  homepage?: string
  /** Directory names to skip while walking docs. */
  excludeDirs?: string[]
}

export type MarkdownDocsSource = true | string | MarkdownDocsDirConfig

export interface LoadedMarkdownDocs {
  documentation: USDDocumentation
  navbar?: NavItem[]
}

export interface ResolvedMarkdownDocsSource {
  rootDir: string
  routeBase: string
  excludeDirs: Set<string>
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

interface SidebarManifest {
  routePrefix: string
  entriesByPath: Map<string, SidebarEntry>
  items: USDDocumentationSidebarItem[]
}

interface SidebarParseResult {
  entries: SidebarEntry[]
  items: USDDocumentationSidebarItem[]
}

const SPECIAL_MARKDOWN_FILES = new Set(['_sidebar.md', '_navbar.md', '_coverpage.md', '_404.md'])

export function loadMarkdownDocs(source: MarkdownDocsSource): LoadedMarkdownDocs {
  const { rootDir, routeBase, excludeDirs } = resolveMarkdownDocsSource(source)
  const config = normalizeMarkdownDocsSource(source)
  const homepage = resolveHomepage(rootDir, config.homepage)
  const configuredAliases = normalizeDocsAliases(config.aliases, routeBase, homepage)
  const markdownFiles = listMarkdownFiles(rootDir, excludeDirs)
  const specialFiles = new Map(markdownFiles
    .filter(file => SPECIAL_MARKDOWN_FILES.has(path.basename(file)))
    .map(file => [path.basename(file), file]))
  const sidebars = loadSidebars(markdownFiles, rootDir, routeBase, homepage)
  const pages = markdownFiles
    .filter(file => !SPECIAL_MARKDOWN_FILES.has(path.basename(file)))
    .map((file, index) => {
      const relativePath = path.relative(rootDir, file)
      const markdown = readFileSync(file, 'utf8')
      const routePath = normalizeRoutePath(markdownFileToRoute(relativePath, homepage), routeBase)
      const sidebarByPath = findNearestSidebar(routePath, sidebars)
      const updatedAt = statSync(file).mtime.toISOString()
      return createDocumentationPage(markdown, routePath, relativePath, index, sidebarByPath, updatedAt)
    })
    .sort(comparePages)

  const documentation: USDDocumentation = { pages }
  const rootSidebar = findRootSidebar(sidebars, routeBase)
  if (rootSidebar && rootSidebar.items.length > 0) {
    documentation.sidebar = rootSidebar.items
  }
  if (routeBase) documentation.routeBase = routeBase
  if (Object.keys(configuredAliases).length > 0) {
    documentation.aliases = configuredAliases
  }
  const coverpage = specialFiles.get('_coverpage.md')
  if (coverpage) {
    const hero = parseCoverpageHero(readFileSync(coverpage, 'utf8'))
    if (hero) documentation.hero = hero
  }
  const notFound = specialFiles.get('_404.md')
  if (notFound) {
    pages.push({
      title: '404',
      path: normalizeRoutePath('/404', routeBase),
      markdown: readFileSync(notFound, 'utf8'),
      section: 'System',
      order: Number.MAX_SAFE_INTEGER,
      updatedAt: statSync(notFound).mtime.toISOString(),
    })
  }

  const navbar = specialFiles.has('_navbar.md')
    ? parseNavbar(readFileSync(specialFiles.get('_navbar.md')!, 'utf8'), routeBase, homepage)
    : undefined

  return { documentation, navbar }
}

export function resolveMarkdownDocsSource(source: MarkdownDocsSource): ResolvedMarkdownDocsSource {
  const config = normalizeMarkdownDocsSource(source)
  return {
    rootDir: path.resolve(config.dir),
    routeBase: normalizeRouteBase(config.routeBase),
    excludeDirs: new Set(config.excludeDirs ?? ['node_modules', '.git', 'dist', 'build']),
  }
}

function normalizeMarkdownDocsSource(source: MarkdownDocsSource): MarkdownDocsDirConfig {
  if (source === true) return { dir: 'docs' }
  return typeof source === 'string' ? { dir: source } : source
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
    aliases: { ...(loaded.aliases ?? {}), ...(explicit.aliases ?? {}) },
    sidebar: explicit.sidebar ?? loaded.sidebar,
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
  sidebarByPath: Map<string, SidebarEntry>,
  updatedAt?: string
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
    updatedAt,
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

function loadSidebars(markdownFiles: string[], rootDir: string, routeBase: string, homepage = 'README.md'): SidebarManifest[] {
  return markdownFiles
    .filter(file => path.basename(file) === '_sidebar.md')
    .map(file => {
      const relativeDir = path.dirname(path.relative(rootDir, file))
      const localRouteBase = normalizeRoutePath(relativeDir === '.' ? '/' : markdownFileToRoute(`${relativeDir}/README.md`, homepage), routeBase)
      const parsed = parseSidebar(readFileSync(file, 'utf8'), localRouteBase, routeBase, homepage)
      return {
        routePrefix: localRouteBase,
        entriesByPath: new Map(parsed.entries.map(entry => [entry.path, entry])),
        items: parsed.items,
      }
    })
    .sort((a, b) => b.routePrefix.length - a.routePrefix.length)
}

function findRootSidebar(sidebars: SidebarManifest[], routeBase: string): SidebarManifest | undefined {
  const rootPrefix = routeBase || '/'
  return sidebars.find(sidebar => sidebar.routePrefix === rootPrefix)
    ?? sidebars[sidebars.length - 1]
}

function findNearestSidebar(routePath: string, sidebars: SidebarManifest[]): Map<string, SidebarEntry> {
  return sidebars.find(sidebar =>
    routePath === sidebar.routePrefix || routePath.startsWith(`${sidebar.routePrefix}/`)
  )?.entriesByPath ?? new Map()
}

function parseSidebar(markdown: string, routeBase: string, rootRouteBase = routeBase, homepage = 'README.md'): SidebarParseResult {
  const items: USDDocumentationSidebarItem[] = []
  const stack: Array<{ indent: number, item: USDDocumentationSidebarItem }> = []

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(\s*)[-*]\s+(?:\[([^\]]+)\]\(([^)]+)\)|(.+))\s*$/.exec(line)
    if (!match) continue
    const indent = match[1].length
    const linkTitle = match[2]
    const href = match[3]?.trim()
    const title = stripSidebarLabel((linkTitle ?? match[4] ?? '').trim())
    if (!title) continue

    const item: USDDocumentationSidebarItem = { title }
    if (href) {
      if (isExternalHref(href)) item.href = href
      else item.path = normalizeDocsHref(href, routeBase, rootRouteBase, homepage)
    }

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    const parent = stack[stack.length - 1]?.item
    if (parent) {
      parent.children ??= []
      parent.children.push(item)
    } else {
      items.push(item)
    }
    stack.push({ indent, item })
  }

  return {
    items,
    entries: flattenSidebarEntries(items),
  }
}

function flattenSidebarEntries(items: USDDocumentationSidebarItem[], section?: string): SidebarEntry[] {
  const entries: SidebarEntry[] = []
  let order = 0
  const visit = (item: USDDocumentationSidebarItem, currentSection?: string) => {
    const nextSection = currentSection ?? (item.path ? undefined : item.title)
    if (item.path && !isExternalHref(item.path)) {
      entries.push({
        title: item.title,
        path: item.path,
        section: currentSection,
        order: order++,
      })
    }
    for (const child of item.children ?? []) visit(child, nextSection)
  }
  for (const item of items) visit(item, section)
  return entries
}

function parseNavbar(markdown: string, routeBase: string, homepage = 'README.md'): NavItem[] {
  const items: NavItem[] = []
  const stack: Array<{ indent: number, item: NavItem }> = []

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(\s*)[-*]\s+(?:\[([^\]]+)\]\(([^)]+)\)|(.+))\s*$/.exec(line)
    if (!match) continue
    const indent = match[1].length
    const title = (match[2] ?? match[4] ?? '').trim()
    const href = match[3]?.trim()
    if (!title) continue

    const item: NavItem = href
      ? {
          title,
          href: isExternalHref(href) ? href : `#${normalizeDocsHref(href, routeBase, routeBase, homepage)}`,
          external: isExternalHref(href),
        }
      : { title }

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    const parent = stack[stack.length - 1]?.item
    if (parent) {
      parent.children ??= []
      parent.children.push(item)
    } else {
      items.push(item)
    }
    stack.push({ indent, item })
  }
  return items
}

function markdownFileToRoute(relativePath: string, homepage = 'README.md'): string {
  const normalized = relativePath.split(path.sep).join('/').replace(/^\/+/, '')
  const normalizedHomepage = normalizeHomepagePath(homepage)
  if (normalizeHomepagePath(normalized) === normalizedHomepage) return '/'
  if (/^README\.md$/i.test(normalized)) return normalizedHomepage === 'README.md' ? '/' : '/README'
  if (/\/README\.md$/i.test(normalized)) {
    return `/${normalized.replace(/\/README\.md$/i, '')}`
  }
  return `/${normalized.replace(/\.md$/i, '')}`
}

function normalizeDocsHref(href: string, routeBase: string, rootRouteBase = routeBase, homepage = 'README.md'): string {
  if (isExternalHref(href)) return href
  const withoutHash = href.split('#')[0]
  const route = withoutHash.endsWith('.md')
    ? markdownFileToRoute(withoutHash, homepage)
    : withoutHash
  return normalizeRoutePath(route, href.startsWith('/') ? rootRouteBase : routeBase)
}

function normalizeDocsAliases(aliases: Record<string, string> | undefined, routeBase: string, homepage = 'README.md'): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [from, to] of Object.entries(aliases ?? {})) {
    const fromPath = normalizeDocsHref(from, routeBase, routeBase, homepage)
    const toPath = normalizeDocsHref(to, routeBase, routeBase, homepage)
    if (isExternalHref(fromPath) || isExternalHref(toPath) || fromPath === toPath) continue
    normalized[fromPath] = toPath
  }
  return normalized
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

function normalizeHomepagePath(homepage: string | undefined): string {
  const normalized = String(homepage || 'README.md')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/')
  return normalized || 'README.md'
}

function resolveHomepage(rootDir: string, configured: string | undefined): string {
  if (configured) return normalizeHomepagePath(configured)
  if (existsSync(path.join(rootDir, 'index.md'))) return 'index.md'
  return 'README.md'
}

const COVERPAGE_BACKGROUNDS = new Set<USDHero['background']>(['gradient', 'solid', 'pattern', 'image'])

export function parseCoverpageHero(markdown: string): USDHero | undefined {
  const parsed = parseFrontmatter(markdown)
  const hero: USDHero = {}

  if (parsed.data.title) hero.title = parsed.data.title
  if (parsed.data.version) hero.version = parsed.data.version
  if (parsed.data.tagline) hero.tagline = parsed.data.tagline
  if (parsed.data.background && COVERPAGE_BACKGROUNDS.has(parsed.data.background as USDHero['background'])) {
    hero.background = parsed.data.background as USDHero['background']
  }
  if (parsed.data.backgroundImage) hero.backgroundImage = parsed.data.backgroundImage
  if (parsed.data.backgroundColor) hero.backgroundColor = parsed.data.backgroundColor
  if (parsed.data.github) hero.github = parsed.data.github

  const features: string[] = []
  const buttons: USDHeroButton[] = []
  let titleSeen = false

  for (const raw of parsed.body.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    if (/^!\[[^\]]*\]\([^)]+\)/.test(line)) continue

    const h1 = /^#\s+(.+)$/.exec(line)
    if (h1 && !titleSeen) {
      titleSeen = true
      let titleText = h1[1].trim()
      const small = /<small>([\s\S]*?)<\/small>/i.exec(titleText)
      if (small) {
        hero.version ??= small[1].trim()
        titleText = titleText.replace(/<small>[\s\S]*?<\/small>/i, '').trim()
      }
      hero.title ??= titleText
      continue
    }

    const tagline = /^>\s+(.+)$/.exec(line)
    if (tagline) {
      hero.tagline ??= tagline[1].trim()
      continue
    }

    const feature = /^[-*]\s+(.+)$/.exec(line)
    if (feature) {
      features.push(feature[1].trim())
      continue
    }

    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g
    const links = [...line.matchAll(linkPattern)]
    if (links.length > 0 && line.replace(linkPattern, '').trim() === '') {
      for (const match of links) {
        buttons.push({ text: match[1].trim(), href: match[2].trim() })
      }
    }
  }

  if (features.length > 0 && !hero.features) hero.features = features
  if (buttons.length > 0 && !hero.buttons) {
    buttons[buttons.length - 1].primary = true
    hero.buttons = buttons
  }

  return Object.keys(hero).length > 0 ? hero : undefined
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

function stripSidebarLabel(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[_*`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
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
