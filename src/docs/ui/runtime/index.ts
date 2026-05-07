import { renderMarkedMarkdown } from './marked-renderer.js'
import { appendProtocolConsole } from './protocol-console.js'
import { appendDeclarativeSidebar, type RuntimeSidebarItem } from './sidebar-tree.js'
import { createDocsSearchModal } from './search-modal.js'
type DocsPage = {
  title?: string
  path?: string
  markdown?: string
  description?: string
  section?: string
  order?: number
  updatedAt?: string
}
type Endpoint = {
  id: string
  path: string
  method: string
  summary?: string
  description?: string
  tags?: string[]
  data?: unknown
}
type PageView = Required<Pick<DocsPage, 'title' | 'path' | 'markdown' | 'description' | 'section'>> & {
  order: number
  updatedAt?: string
  frontmatter: Record<string, string>
}
type SearchIndexEntry = {
  kind?: 'page' | 'heading'
  title?: string
  path?: string
  section?: string
  headingId?: string
  excerpt?: string
  text?: string
  rank?: number
}
type SidebarHeadingItem = { id: string; title: string; level: number }
type MarkdownAttributes = {
  title?: string; target?: string
  disabled?: boolean; ignore?: boolean; noZoom?: boolean
  id?: string
  classes: string[]
  width?: string; height?: string; widthStyle?: string
}
type DocsRuntimeState = { activePagePath: string; activeHeadingId: string; activeProtocol: string; searchQuery: string }
type DocsPluginContext = DocsRuntimeState & { pagePath?: string; headingId?: string }
type DocsRuntimePlugin = {
  name?: string
  beforeMarkdown?: (markdown: string, context: DocsPluginContext) => string | undefined
  afterMarkdown?: (html: string, context: DocsPluginContext) => string | undefined
  beforeRender?: (context: DocsPluginContext) => void
  afterRender?: (context: DocsPluginContext) => void
  mountComponent?: (target: unknown, name: string, props: Record<string, unknown>, context: DocsPluginContext) => void
  unmountComponent?: (target: unknown, context: DocsPluginContext) => void
  onRouteChange?: (context: DocsPluginContext) => void
  onSearchResults?: (results: SearchIndexEntry[], context: DocsPluginContext) => SearchIndexEntry[] | undefined
  onCopyCode?: (text: string, context: DocsPluginContext) => void; onTabChange?: (title: string, index: number, context: DocsPluginContext) => void; onImageZoom?: (src: string, alt: string, context: DocsPluginContext) => void
}
const COMMON_EMOJI_ENTITIES: Record<string, string> = {
  '+1': '&#x1F44D;', '-1': '&#x1F44E;', '100': '&#x1F4AF;',
  bug: '&#x1F41B;', book: '&#x1F4D6;', books: '&#x1F4DA;',
  bulb: '&#x1F4A1;', check: '&#x2705;', fire: '&#x1F525;',
  gear: '&#x2699;&#xFE0F;', grinning: '&#x1F600;', heart: '&#x2764;&#xFE0F;',
  info: '&#x2139;&#xFE0F;', joy: '&#x1F602;', link: '&#x1F517;',
  lock: '&#x1F512;', memo: '&#x1F4DD;', package: '&#x1F4E6;',
  pushpin: '&#x1F4CC;', rocket: '&#x1F680;', smile: '&#x1F604;',
  sparkles: '&#x2728;', star: '&#x2B50;', tada: '&#x1F389;',
  unlock: '&#x1F513;', warning: '&#x26A0;&#xFE0F;', white_check_mark: '&#x2705;',
  wrench: '&#x1F527;', x: '&#x274C;', zap: '&#x26A1;',
}
const win = globalThis as unknown as {
  document?: any; location?: any; history?: any
  scrollTo?: (options: unknown) => void
  addEventListener?: (...args: unknown[]) => void
  navigator?: any; localStorage?: any; mermaid?: any; marked?: any; Prism?: any
  __RAFFEL_DOCS__?: any; __RAFFEL_DOCS_PLUGINS__?: unknown[]; RaffelDocs?: any
}
const doc = win.document
const data = win.__RAFFEL_DOCS__ ?? {}
const spec = data.spec ?? { info: { title: 'API', version: '1.0.0' }, paths: {} }
const tagGroups = data.tagGroups ?? []
const sidebarConfig = data.sidebarConfig ?? {}
const introductionMarkdown = data.introductionMarkdown ?? null
const docsPages = Array.isArray(data.docsPages) ? data.docsPages as DocsPage[] : []
const docsAliases = normalizeDocsAliases(data.docsAliases)
const searchIndex = Array.isArray(data.searchIndex) ? data.searchIndex as SearchIndexEntry[] : []
const docsSidebar = Array.isArray(data.docsSidebar) ? data.docsSidebar as RuntimeSidebarItem[] : []
const docsAssetBasePath = String(data.docsAssetBasePath ?? '')
const footerMarkdown = data.footerMarkdown ?? null
const tocConfig = data.tocConfig ?? {}
const markdownConfig = data.markdownConfig ?? {}
const xUsd = spec['x-usd'] ?? {}
const { websocket: wsSpec = {}, streams: streamsSpec = {}, jsonrpc: jsonrpcSpec = {}, grpc: grpcSpec = {}, tcp: tcpSpec = {}, udp: udpSpec = {} } = xUsd
const docsRouteBase = String(xUsd.documentation?.routeBase ?? '').replace(/^#/, '').replace(/\/+$/, '')
const protocolData = detectProtocols()
const protocols = Object.keys(protocolData)
let activeProtocol = protocols[0] ?? 'http'
let searchQuery = ''
let routeState = parseRouteHash()
let activePagePath = resolveDocsAlias(routeState.pagePath)
let activeHeadingId = routeState.headingId
const docsPlugins: DocsRuntimePlugin[] = [], themeStorageKey = 'raffel-docs-theme'
function getDocsRuntimeState(): DocsRuntimeState { return { activePagePath, activeHeadingId, activeProtocol, searchQuery } }

function getPluginContext(extra: Partial<DocsPluginContext> = {}): DocsPluginContext {
  return { ...getDocsRuntimeState(), ...extra }
}

function registerDocsPlugin(plugin: unknown): void {
  if (!plugin) return
  if (typeof plugin === 'function') {
    plugin({
      use: registerDocsPlugin,
      getState: getDocsRuntimeState,
    })
    return
  }
  if (typeof plugin === 'object') docsPlugins.push(plugin as DocsRuntimePlugin)
}

function installDocsPluginApi(): void {
  for (const plugin of win.__RAFFEL_DOCS_PLUGINS__ ?? []) registerDocsPlugin(plugin)
  win.RaffelDocs = {
    ...(win.RaffelDocs ?? {}),
    apiVersion: 1,
    use: registerDocsPlugin, plugins: docsPlugins,
    getState: getDocsRuntimeState,
  }
}

function applyStringHook(
  hookName: 'beforeMarkdown' | 'afterMarkdown',
  value: string,
  context: DocsPluginContext
): string {
  let current = value
  for (const plugin of docsPlugins) {
    const next = plugin[hookName]?.(current, context)
    if (typeof next === 'string') current = next
  }
  return current
}

function runVoidHook(hookName: 'beforeRender' | 'afterRender' | 'onRouteChange', context: DocsPluginContext): void {
  for (const plugin of docsPlugins) plugin[hookName]?.(context)
}

function applySearchResultsHook<T extends SearchIndexEntry>(results: T[], context: DocsPluginContext): T[] {
  let current = results
  for (const plugin of docsPlugins) {
    const next = plugin.onSearchResults?.(current, context)
    if (Array.isArray(next)) current = next as T[]
  }
  return current
}

function unmountDocsComponents(root: any = doc): void {
  root?.querySelectorAll?.('[data-raffel-component-mounted="true"]')?.forEach((target: any) => {
    for (const plugin of docsPlugins) {
      plugin.unmountComponent?.(target, getPluginContext({
        pagePath: target.getAttribute?.('data-page-path') ?? activePagePath,
      }))
    }
    delete target.dataset.raffelComponentMounted
  })
}

function esc(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

function slugifyHeading(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function escapeAttr(value: unknown): string {
  return esc(value).replace(/"/g, '&quot;')
}

function renderEmojiShorthand(value: string): string {
  if (markdownConfig.noEmoji === true) return value
  return value.replace(/:([a-z0-9_+-]+):/gi, (match, name) => {
    const entity = COMMON_EMOJI_ENTITIES[String(name).toLowerCase()]
    return entity ? `<span class="emoji" aria-label="${escapeAttr(name)}">${entity}</span>` : match
  })
}

function getExternalLinkTarget(): string {
  return String(markdownConfig.externalLinkTarget ?? '_blank')
}

function getExternalLinkRel(target: string): string {
  if (target !== '_blank') return ''
  return String(markdownConfig.externalLinkRel ?? 'noopener noreferrer')
}

function isNoCompileLink(href: string): boolean {
  const patterns = Array.isArray(markdownConfig.noCompileLinks)
    ? markdownConfig.noCompileLinks
    : []
  return patterns.some((pattern: unknown) => {
    try {
      return new RegExp(String(pattern)).test(href)
    } catch {
      return false
    }
  })
}

function parseMarkdownAttributes(text: string): MarkdownAttributes {
  const attrs: MarkdownAttributes = { classes: [] }
  const withoutAttrs = text.replace(/:([A-Za-z-]+)(?:=([^\s:]+))?/g, (_match, name, value = '') => {
    const key = String(name).toLowerCase()
    if (key === 'class' && value) attrs.classes.push(value)
    if (key === 'id' && value) attrs.id = value
    if (key === 'target' && value) attrs.target = value
    if (key === 'disabled') attrs.disabled = true
    if (key === 'ignore') attrs.ignore = true
    if (key === 'no-zoom') attrs.noZoom = true
    if (key === 'size' && value) {
      const [width, height] = String(value).split('x')
      if (width?.endsWith('%')) attrs.widthStyle = width
      else if (width) attrs.width = width
      if (height) attrs.height = height
    }
    return ''
  }).trim()
  if (withoutAttrs) attrs.title = withoutAttrs
  return attrs
}

function parseMarkdownDestination(value: unknown): { href: string, attrs: MarkdownAttributes } | null {
  const raw = String(value ?? '').trim()
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
  if (!raw) return null
  const match = raw.match(/^(\S+)(?:\s+(['"])(.*?)\2)?$/)
  const href = match?.[1] ?? raw
  const meta = match?.[3] ?? ''
  const attrs = meta.startsWith(':')
    ? parseMarkdownAttributes(meta)
    : { title: meta || undefined, classes: [] }
  return { href, attrs }
}

function parseComponentFence(lang: string, body: string): { name: string, props: string } | null {
  const match = lang.match(/^(?:raffel-component|svelte-component)\s+([A-Za-z][\w.-]*)(?:\s+(.+))?$/)
  if (!match) return null
  return {
    name: match[1],
    props: match[2]?.trim() || body.trim(),
  }
}

function renderMarkdownAttributeString(attrs: MarkdownAttributes, kind: 'link' | 'image'): string {
  const attributes: string[] = []
  if (attrs.title) attributes.push(`title="${escapeAttr(attrs.title)}"`)
  if (attrs.id) attributes.push(`id="${escapeAttr(attrs.id)}"`)
  if (attrs.classes.length > 0) {
    const base = kind === 'image' ? 'md-image' : ''
    attributes.push(`class="${escapeAttr([base, ...attrs.classes].filter(Boolean).join(' '))}"`)
  }
  if (kind === 'image') {
    if (attrs.noZoom) attributes.push('data-no-zoom="true"')
    if (attrs.width) attributes.push(`width="${escapeAttr(attrs.width)}"`)
    if (attrs.height) attributes.push(`height="${escapeAttr(attrs.height)}"`)
    if (attrs.widthStyle) attributes.push(`style="width:${escapeAttr(attrs.widthStyle)}"`)
  }
  return attributes.length > 0 ? ` ${attributes.join(' ')}` : ''
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

function getSidebarSubMaxLevel(): number {
  const max = Number(sidebarConfig.subMaxLevel ?? 0)
  return Number.isFinite(max) && max > 1 ? Math.floor(max) : 0
}

function extractSidebarHeadings(markdown: string): SidebarHeadingItem[] {
  const max = getSidebarSubMaxLevel()
  if (max === 0) return []
  const headings: SidebarHeadingItem[] = []
  const seen = new Map<string, number>()
  for (const line of String(markdown ?? '').split(/\r?\n/)) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim())
    if (!heading) continue
    const level = heading[1].length
    const parsed = parseHeadingTitle(heading[2])
    const id = uniqueHeadingId(parsed.id, parsed.customId, seen)
    if (parsed.ignoreAll) return []
    if (level < 2 || level > max || parsed.ignore) continue
    headings.push({ id, title: parsed.title, level })
  }
  return headings
}

function isSafeUrl(url: unknown): boolean {
  return !/^\s*(?:javascript|data|vbscript):/i.test(String(url ?? ''))
}

function normalizeDocsPath(path: unknown): string {
  const raw = String(path ?? '').trim()
  if (!raw) return ''
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withSlash.replace(/\/+$/, '') || '/'
}

function normalizeDocsAliases(raw: unknown): Record<string, string> {
  const aliases: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return aliases
  for (const [from, to] of Object.entries(raw as Record<string, unknown>)) {
    const fromPath = normalizeDocsPath(from)
    const toPath = normalizeDocsPath(to)
    if (!fromPath || !toPath || fromPath === toPath) continue
    aliases[fromPath] = toPath
  }
  return aliases
}

function resolveDocsAliasTarget(path: string): string {
  const exact = docsAliases[path]
  if (exact) return exact

  for (const [pattern, target] of Object.entries(docsAliases)) {
    if (!/[()*+?[\\\]^$|]/.test(pattern)) continue
    try {
      const expression = new RegExp(pattern.startsWith('^') ? pattern : `^${pattern}$`)
      const match = path.match(expression)
      if (!match) continue
      return String(target).replace(/\$(\d+)/g, (_token, index) => match[Number(index)] ?? '')
    } catch {
      continue
    }
  }

  return ''
}

function resolveDocsAlias(path: string): string {
  let current = normalizeDocsPath(path)
  const seen = new Set<string>()
  for (let depth = 0; depth < 10; depth += 1) {
    const next = resolveDocsAliasTarget(current)
    if (!next || seen.has(next)) return current
    seen.add(current)
    current = normalizeDocsPath(next)
  }
  return current
}

function parseRouteHash(): { pagePath: string, headingId: string } {
  const hash = String(win.location?.hash ?? '')
  if (!hash.startsWith('#/')) return { pagePath: '', headingId: hash.startsWith('#') ? hash.slice(1) : '' }
  const raw = hash.slice(1)
  const [pathPart, query = ''] = raw.split('?')
  const params = typeof URLSearchParams === 'undefined' ? null : new URLSearchParams(query)
  return {
    pagePath: normalizeDocsPath(pathPart),
    headingId: params?.get?.('id') ?? '',
  }
}

function routeToHash(path: string, headingId = ''): string {
  const normalized = normalizeDocsPath(path)
  return `#${normalized}${headingId ? `?id=${encodeURIComponent(headingId)}` : ''}`
}

function stripMarkdownExtension(path: string): string {
  return path
    .replace(/\/README\.md$/i, '')
    .replace(/^README\.md$/i, '')
    .replace(/\.md$/i, '')
}

function resolveRelativeDocsPath(href: string, currentPath?: string): string {
  const [pathPart, hashPart = ''] = href.split('#')
  const baseCandidate = currentPath ?? activePagePath
  const base = normalizeDocsPath(baseCandidate || '/')
  const baseParts = base.split('/').filter(Boolean)
  if (!base.endsWith('/') && base !== docsRouteBase) baseParts.pop()
  const inputParts = pathPart.split('/').filter(Boolean)
  const parts = pathPart.startsWith('/') ? docsRouteBase.split('/').filter(Boolean) : baseParts
  for (const part of inputParts) {
    if (part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  const resolved = normalizeDocsPath(stripMarkdownExtension(parts.join('/')))
  return routeToHash(resolved || '/', hashPart ? slugifyHeading(hashPart) : '')
}

function resolveMarkdownHref(href: unknown, currentPath?: string): { href: string, external: boolean } | null {
  const raw = String(href ?? '').trim()
  if (!raw || !isSafeUrl(raw)) return null
  if (/^(?:https?:)?\/\//i.test(raw) || /^(?:mailto|tel):/i.test(raw)) return { href: raw, external: true }
  if (raw.startsWith('#')) return { href: activePagePath ? routeToHash(activePagePath, raw.slice(1)) : raw, external: false }
  if (raw.endsWith('.md') || raw.includes('.md#') || raw.startsWith('./') || raw.startsWith('../')) {
    return { href: resolveRelativeDocsPath(raw, currentPath), external: false }
  }
  return { href: raw, external: false }
}

function resolveMarkdownAssetHref(href: unknown, currentPath?: string): string | null {
  const raw = String(href ?? '').trim()
  if (!raw || !isSafeUrl(raw)) return null
  if (/^(?:https?:)?\/\//i.test(raw) || /^(?:mailto|tel|data):/i.test(raw)) return raw
  if (!docsAssetBasePath || raw.startsWith('/') || raw.startsWith('#')) return raw
  const baseCandidate = currentPath ?? activePagePath
  const base = normalizeDocsPath(baseCandidate || '/')
  const baseParts = base.split('/').filter(Boolean)
  if (!base.endsWith('/')) baseParts.pop()
  const [pathPart, hashPart = ''] = raw.split('#')
  const parts = pathPart.startsWith('/') ? [] : baseParts
  for (const part of pathPart.split('/').filter(Boolean)) {
    if (part === '.') continue
    if (part === '..') {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  const assetPath = parts.map(part => encodeURIComponent(part)).join('/')
  return `${docsAssetBasePath.replace(/\/$/, '')}/${assetPath}${hashPart ? `#${hashPart}` : ''}`
}

function parseInlineMarkdown(value: unknown, currentPath?: string): string {
  const codeTokens: string[] = []
  const htmlTokens: string[] = []
  const protectHtml = (html: string): string => {
    const token = `\u0000H${htmlTokens.length}H\u0000`
    htmlTokens.push(html)
    return token
  }
  let text = String(value ?? '').replace(/`([^`]+)`/g, (_match, code) => {
    const token = `\u0000C${codeTokens.length}C\u0000`
    codeTokens.push(`<code class="md-inline-code">${esc(code)}</code>`)
    return token
  })

  if (markdownConfig.html === 'raw') text = text.replace(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>/g, protectHtml)
  text = esc(text)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, destination) => {
    const parsed = parseMarkdownDestination(destination)
    if (!parsed) return match
    const resolved = resolveMarkdownAssetHref(parsed.href, currentPath)
    if (!resolved) return match
    const attrs = renderMarkdownAttributeString(parsed.attrs, 'image')
    const classAttr = parsed.attrs.classes.length > 0 ? '' : ' class="md-image"'
    return protectHtml(`<img${classAttr} src="${escapeAttr(resolved)}" alt="${escapeAttr(alt)}"${attrs}>`)
  })
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, destination) => {
    const parsed = parseMarkdownDestination(destination)
    if (!parsed) return esc(label)
    if ((parsed.attrs.ignore || isNoCompileLink(parsed.href)) && !isSafeUrl(parsed.href)) return esc(label)
    const resolved = parsed.attrs.ignore || isNoCompileLink(parsed.href)
      ? { href: parsed.href, external: /^(?:https?:)?\/\//i.test(parsed.href) }
      : resolveMarkdownHref(parsed.href, currentPath)
    if (!resolved) return esc(label)
    const target = parsed.attrs.target ?? (resolved.external ? getExternalLinkTarget() : '')
    const targetAttr = target ? ` target="${escapeAttr(target)}"` : ''
    const rel = getExternalLinkRel(target)
    const relAttr = rel ? ` rel="${escapeAttr(rel)}"` : ''
    const disabledAttrs = parsed.attrs.disabled ? ' aria-disabled="true" tabindex="-1"' : ''
    const classes = parsed.attrs.disabled ? ['markdown-disabled', ...parsed.attrs.classes] : parsed.attrs.classes
    const attrs = renderMarkdownAttributeString({ ...parsed.attrs, classes }, 'link')
    return `${protectHtml(`<a href="${escapeAttr(resolved.href)}"${targetAttr}${relAttr}${disabledAttrs}${attrs}>`)}${label}${protectHtml('</a>')}`
  })
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>').replace(/_([^_]+)_/g, '<em>$1</em>')
  text = renderEmojiShorthand(text)
  codeTokens.forEach((html, index) => { text = text.replace(`\u0000C${index}C\u0000`, html) })
  htmlTokens.forEach((html, index) => { text = text.replace(`\u0000H${index}H\u0000`, html) })
  return text
}

function parseMarkdown(markdown: unknown, currentPath?: string): string {
  const context = getPluginContext({ pagePath: currentPath })
  const source = applyStringHook('beforeMarkdown', String(markdown ?? ''), context).replace(/\r\n?/g, '\n')
  const markedHtml = renderMarkedMarkdown(source, currentPath, {
    win, markdownConfig, activePagePath: () => activePagePath, esc, escapeAttr, renderEmojiShorthand,
    parseMarkdown, parseMarkdownAttributes, parseMarkdownDestination, renderMarkdownAttributeString,
    resolveMarkdownHref, resolveMarkdownAssetHref, getExternalLinkTarget, getExternalLinkRel,
    isNoCompileLink, parseHeadingTitle, uniqueHeadingId, routeToHash, parseComponentFence, renderAlert,
  })
  if (markedHtml !== null) return applyStringHook('afterMarkdown', markedHtml, context)
  const lines = source.split('\n')
  const html: string[] = []
  const seenHeadingIds = new Map<string, number>()
  let index = 0

  function readUntilBlank(): string[] {
    const block: string[] = []
    while (index < lines.length && (lines[index] ?? '').trim()) {
      block.push(lines[index] ?? '')
      index += 1
    }
    return block
  }

  function renderList(ordered: boolean): string {
    const items: string[] = []
    const re = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/
    while (index < lines.length && re.test(lines[index] ?? '')) {
      const match = (lines[index] ?? '').match(re)
      let body = match?.[1] ?? ''
      let checkbox = ''
      const task = body.match(/^\[( |x|X)\]\s+(.+)$/)
      if (task) {
        const checked = task[1].toLowerCase() === 'x' ? ' checked' : ''
        checkbox = `<input type="checkbox" disabled${checked}> `
        body = task[2]
      }
      items.push(`<li>${checkbox}${parseInlineMarkdown(body, currentPath)}</li>`)
      index += 1
    }
    const tag = ordered ? 'ol' : 'ul'
    return `<${tag} class="md-list">${items.join('')}</${tag}>`
  }

  function renderTable(): string | null {
    const header = (lines[index] ?? '').trim()
    const separator = (lines[index + 1] ?? '').trim()
    if (!/^\|.*\|$/.test(header) || !/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator)) {
      return null
    }

    const headers = header.replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())
    index += 2
    const rows: string[][] = []
    while (index < lines.length && /^\|.*\|$/.test((lines[index] ?? '').trim())) {
      rows.push((lines[index] ?? '').trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()))
      index += 1
    }

    return '<table class="md-table"><thead><tr>' +
      headers.map(cell => `<th>${parseInlineMarkdown(cell, currentPath)}</th>`).join('') +
      '</tr></thead><tbody>' +
      rows.map(row => `<tr>${row.map(cell => `<td>${parseInlineMarkdown(cell, currentPath)}</td>`).join('')}</tr>`).join('') +
      '</tbody></table>'
  }

  function renderTabs(): string {
    const tabs: Array<{ title: string, lines: string[] }> = []
    let current: { title: string, lines: string[] } | null = null
    index += 1

    while (index < lines.length && (lines[index] ?? '').trim() !== '<!-- tabs:end -->') {
      const tabHeading = (lines[index] ?? '').trim().match(/^####\s+(.+)$/)
      if (tabHeading) {
        if (current) tabs.push(current)
        current = { title: tabHeading[1].replace(/^\*\*|\*\*$/g, '').trim(), lines: [] }
        index += 1
        continue
      }
      current?.lines.push(lines[index] ?? '')
      index += 1
    }

    if (current) tabs.push(current)
    if (index < lines.length) index += 1
    if (tabs.length === 0) return ''

    const buttons = tabs.map((tab, tabIndex) =>
      `<button type="button" class="md-tab-button${tabIndex === 0 ? ' active' : ''}" data-tab-index="${tabIndex}">${esc(tab.title || `Tab ${tabIndex + 1}`)}</button>`
    ).join('')
    const panels = tabs.map((tab, tabIndex) =>
      `<div class="md-tab-panel${tabIndex === 0 ? ' active' : ''}" data-tab-index="${tabIndex}">${parseMarkdown(tab.lines.join('\n'), currentPath)}</div>`
    ).join('')

    return `<div class="md-tabs"><div class="md-tab-list" role="tablist">${buttons}</div>${panels}</div>`
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (markdownConfig.html === 'raw' && /^<\/?[A-Za-z][^>]*>$/.test(trimmed)) { html.push(readUntilBlank().join('\n')); continue }
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim() || 'text'
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      const component = parseComponentFence(lang, code.join('\n'))
      if (component) {
        html.push(`<div class="docs-component-mount svelte-component-mount" data-raffel-component="${escapeAttr(component.name)}" data-props="${escapeAttr(component.props)}"></div>`)
      } else if (lang === 'mermaid') {
        html.push(`<div class="mermaid" data-mermaid-source="${escapeAttr(code.join('\n'))}">${esc(code.join('\n'))}</div>`)
      } else {
        html.push(`<div class="md-code-wrap"><button type="button" class="copy-code-btn">Copy</button><pre class="md-code-block"><code class="language-${escapeAttr(lang)}">${esc(code.join('\n'))}</code></pre></div>`)
      }
      continue
    }

    if (trimmed === '<!-- tabs:start -->') {
      html.push(renderTabs())
      continue
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      const level = heading[1].length
      const { title, id: rawId, customId, ignore, ignoreAll } = parseHeadingTitle(heading[2])
      const id = uniqueHeadingId(rawId, customId, seenHeadingIds)
      const href = activePagePath ? routeToHash(activePagePath, id) : `#${id}`
      const ignoreAttrs = `${ignore ? ' data-markdown-ignore="true"' : ''}${ignoreAll ? ' data-markdown-ignore-all="true"' : ''}`
      html.push(`<h${level} class="md-h${level}" id="${escapeAttr(id)}"${ignoreAttrs}><a class="heading-anchor" href="${escapeAttr(href)}">#</a>${parseInlineMarkdown(title, currentPath)}</h${level}>`)
      index += 1
      continue
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      html.push('<hr class="md-hr">')
      index += 1
      continue
    }

    if (/^[!?]>\s?/.test(trimmed)) {
      const alert = renderAlert([trimmed], currentPath)
      if (alert) html.push(alert)
      index += 1
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      const quote: string[] = []
      while (index < lines.length && /^>\s?/.test((lines[index] ?? '').trim())) {
        quote.push((lines[index] ?? '').trim().replace(/^>\s?/, ''))
        index += 1
      }
      const alert = renderAlert(quote, currentPath)
      html.push(alert ?? `<blockquote class="md-blockquote">${parseMarkdown(quote.join('\n'), currentPath)}</blockquote>`)
      continue
    }

    const table = renderTable()
    if (table) {
      html.push(table)
      continue
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      html.push(renderList(false))
      continue
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      html.push(renderList(true))
      continue
    }

    html.push(`<p class="md-p">${parseInlineMarkdown(readUntilBlank().join(' '), currentPath)}</p>`)
  }

  return applyStringHook('afterMarkdown', html.join('\n'), context)
}

function renderAlert(lines: string[], currentPath?: string): string | null {
  const first = lines[0] ?? ''
  const match = first.match(/^\[!(NOTE|TIP|WARNING|DANGER|INFO|IMPORTANT|CAUTION)\]\s*(.*)$/i)
  const legacy = first.match(/^([!?])>\s*(.*)$/)
  if (!match && !legacy) return null
  const rawKind = match?.[1] ?? (legacy?.[1] === '?' ? 'TIP' : 'IMPORTANT')
  const kind = rawKind.toLowerCase()
  const title = match?.[2] || `${rawKind.charAt(0).toUpperCase()}${rawKind.slice(1).toLowerCase()}`
  const bodyLines = legacy ? [legacy[2] ?? '', ...lines.slice(1)] : lines.slice(1)
  return `<aside class="md-alert md-alert-${escapeAttr(kind)}"><div class="md-alert-title">${esc(title)}</div><div class="md-alert-body">${parseMarkdown(bodyLines.join('\n'), currentPath)}</div></aside>`
}

function parsePageFrontmatter(markdown: unknown): { data: Record<string, string>, body: string } {
  const source = String(markdown ?? '').replace(/\r\n?/g, '\n')
  if (!source.startsWith('---\n')) return { data: {}, body: source }
  const end = source.indexOf('\n---', 4)
  if (end === -1) return { data: {}, body: source }

  const data: Record<string, string> = {}
  for (const line of source.slice(4, end).split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    data[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
  }

  const bodyStart = source.indexOf('\n', end + 4)
  return { data, body: bodyStart === -1 ? '' : source.slice(bodyStart + 1) }
}

function firstMarkdownHeading(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.replace(/\s+#+$/, '').trim() ?? ''
}

function getDocsPageView(page: DocsPage): PageView {
  const parsed = parsePageFrontmatter(page.markdown ?? '')
  const order = Number(parsed.data.order ?? page.order ?? 0)
  return {
    title: parsed.data.title ?? page.title ?? firstMarkdownHeading(parsed.body) ?? page.path ?? 'Untitled',
    path: normalizeDocsPath(page.path ?? ''),
    markdown: parsed.body,
    description: parsed.data.description ?? page.description ?? '',
    section: parsed.data.section ?? page.section ?? 'Guides',
    order: Number.isFinite(order) ? order : 0,
    updatedAt: parsed.data.updatedAt ?? page.updatedAt,
    frontmatter: parsed.data,
  }
}

function getDocsPageViews(): PageView[] {
  return docsPages
    .map(getDocsPageView)
    .filter(page => page.path)
    .sort((a, b) =>
      a.section.localeCompare(b.section) ||
      a.order - b.order ||
      a.title.localeCompare(b.title)
    )
}

function getDocsPageMarkdown(page: PageView): string {
  const markdown = renderUpdatedMarker(page.markdown ?? '', page.updatedAt)
  if (markdownConfig.autoHeader !== true || /^#\s+.+$/m.test(markdown)) return markdown
  return `# ${page.title}\n\n${markdown}`
}

function renderUpdatedMarker(markdown: string, updatedAt?: string): string {
  if (!markdown.includes('{raffel-updated}')) return markdown
  return markdown.replace(/\{raffel-updated\}/g, formatDocsUpdated(updatedAt))
}

function formatDocsUpdated(updatedAt?: string): string {
  if (!updatedAt) return ''
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  const tokens: Record<string, string> = {
    YYYY: String(date.getUTCFullYear()),
    MM: pad(date.getUTCMonth() + 1),
    DD: pad(date.getUTCDate()),
    HH: pad(date.getUTCHours()),
    mm: pad(date.getUTCMinutes()),
    ss: pad(date.getUTCSeconds()),
  }
  const format = String(markdownConfig.formatUpdated ?? 'YYYY-MM-DD')
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, token => tokens[token] ?? token)
}

function detectProtocols(): Record<string, number> {
  const out: Record<string, number> = {}
  if (spec.paths) {
    let count = 0
    for (const methods of Object.values(spec.paths) as any[]) {
      for (const method of Object.keys(methods ?? {})) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) count += 1
      }
    }
    if (count > 0) out.http = count
  }
  if (wsSpec.channels) out.websocket = Object.keys(wsSpec.channels).length
  if (streamsSpec.endpoints) out.streams = Object.keys(streamsSpec.endpoints).length
  if (jsonrpcSpec.methods) out.jsonrpc = Object.keys(jsonrpcSpec.methods).length
  if (grpcSpec.services) {
    out.grpc = Object.values(grpcSpec.services).reduce((sum: number, service: any) => sum + Object.keys(service.methods ?? {}).length, 0)
  }
  if (tcpSpec.servers) out.tcp = Object.keys(tcpSpec.servers).length
  if (udpSpec.endpoints) out.udp = Object.keys(udpSpec.endpoints).length
  return out
}

function getEndpointsForProtocol(protocol: string): Endpoint[] {
  const endpoints: Endpoint[] = []
  let id = 0
  const add = (path: string, method: string, data: any, tags?: string[]) => endpoints.push({
    id: `ep-${id++}`,
    path,
    method,
    summary: data?.summary ?? data?.description ?? path,
    description: data?.description,
    tags: tags ?? data?.tags ?? [],
    data,
  })
  if (protocol === 'http' && spec.paths) {
    for (const [path, methods] of Object.entries(spec.paths) as Array<[string, any]>) {
      for (const [method, operation] of Object.entries(methods ?? {}) as Array<[string, any]>) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
        add(path, method.toUpperCase(), operation)
      }
    }
  }
  if (protocol === 'websocket') forEntries(wsSpec.channels, (name, channel) => add(name, 'WS', channel))
  if (protocol === 'streams') forEntries(streamsSpec.endpoints, (name, endpoint) => add(name, endpoint.direction ?? 'STREAM', endpoint))
  if (protocol === 'jsonrpc') forEntries(jsonrpcSpec.methods, (name, method) => add(name, 'RPC', method))
  if (protocol === 'grpc' && grpcSpec.services) {
    for (const [serviceName, service] of Object.entries(grpcSpec.services) as Array<[string, any]>) {
      for (const [methodName, method] of Object.entries(service.methods ?? {}) as Array<[string, any]>) {
        add(`${serviceName}/${methodName}`, getGrpcMethodType(method).toUpperCase(), { service, method, serviceName, methodName, summary: method.summary, description: method.description }, method.tags ?? service.tags)
      }
    }
  }
  if (protocol === 'tcp') forEntries(tcpSpec.servers, (name, server) => add(name, 'TCP', server))
  if (protocol === 'udp') forEntries(udpSpec.endpoints, (name, endpoint) => add(name, 'UDP', endpoint))
  return endpoints
}

function forEntries(value: any, callback: (name: string, item: any) => void): void {
  for (const [name, item] of Object.entries(value ?? {}) as Array<[string, any]>) callback(name, item)
}

function getGrpcMethodType(method: any): string {
  const client = method?.['x-usd-client-streaming']
  const server = method?.['x-usd-server-streaming']
  if (client && server) return 'bidirectional'
  if (client) return 'client_streaming'
  if (server) return 'server_streaming'
  return 'unary'
}

function byId(id: string): any {
  return doc?.getElementById(id)
}

function renderProtocolTabs(): void {
  const container = byId('protocolTabs')
  if (!container) return
  container.textContent = ''
  for (const protocol of protocols) {
    const button = doc.createElement('button')
    button.className = `protocol-tab${!activePagePath && protocol === activeProtocol ? ' active' : ''}`
    button.innerHTML = `${esc(protocol.charAt(0).toUpperCase() + protocol.slice(1))}${sidebarConfig.showCounts !== false ? `<span class="count">${protocolData[protocol]}</span>` : ''}`
    button.onclick = () => {
      activeProtocol = protocol
      activePagePath = ''
      activeHeadingId = ''
      render()
    }
    container.appendChild(button)
  }
}

function setDocsPage(path: unknown, headingId = ''): void {
  activePagePath = resolveDocsAlias(normalizeDocsPath(path))
  activeHeadingId = headingId
  win.history?.replaceState?.(null, '', routeToHash(activePagePath, activeHeadingId))
  if (!activeHeadingId) win.scrollTo?.({ top: 0, behavior: 'smooth' })
  runVoidHook('onRouteChange', getPluginContext({ pagePath: activePagePath, headingId: activeHeadingId }))
  render()
}

function renderSidebar(): void {
  const nav = byId('sidebarNav')
  if (!nav) return
  nav.textContent = ''
  renderDocsPagesNav(nav)
  if (activePagePath) return

  const endpoints = getEndpointsForProtocol(activeProtocol).filter(endpoint =>
    !searchQuery ||
    endpoint.path.toLowerCase().includes(searchQuery) ||
    (endpoint.summary ?? '').toLowerCase().includes(searchQuery) ||
    (endpoint.description ?? '').toLowerCase().includes(searchQuery)
  )
  const tags = new Map<string, Endpoint[]>()
  for (const endpoint of endpoints) {
    const tag = endpoint.tags?.[0] ?? 'Endpoints'
    if (!tags.has(tag)) tags.set(tag, [])
    tags.get(tag)?.push(endpoint)
  }
  const groups = tagGroups.length > 0
    ? tagGroups
    : Array.from(tags.keys()).sort().map(name => ({ name, tags: [name], expanded: true }))
  for (const group of groups) {
    const groupEndpoints = (group.tags ?? []).flatMap((tag: string) => tags.get(tag) ?? [])
    if (groupEndpoints.length === 0) continue
    appendSidebarGroup(nav, group.name, groupEndpoints.map((endpoint: Endpoint) => ({
      active: false,
      label: endpoint.path,
      prefix: endpoint.method,
      onClick: () => scrollToEndpoint(endpoint.id),
    })))
  }
}

function renderDocsPagesNav(nav: any): void {
  if (sidebarConfig.docsPages === false) return
  if (docsSidebar.length > 0 && !searchQuery) {
    renderDeclarativeDocsSidebar(nav)
    return
  }
  const pages = getDocsPageViews().filter(page =>
    !searchQuery ||
    page.title.toLowerCase().includes(searchQuery) ||
    page.description.toLowerCase().includes(searchQuery) ||
    page.markdown.toLowerCase().includes(searchQuery)
  )
  const sections = new Map<string, PageView[]>()
  for (const page of pages) {
    if (!sections.has(page.section)) sections.set(page.section, [])
    sections.get(page.section)?.push(page)
  }
  for (const [section, sectionPages] of sections) {
    appendSidebarGroup(nav, section, sectionPages.map(page => ({
      active: page.path === activePagePath,
      label: page.title,
      children: page.path === activePagePath && !searchQuery ? extractSidebarHeadings(page.markdown) : [],
      onClick: () => setDocsPage(page.path),
    })))
  }
}

function renderDeclarativeDocsSidebar(nav: any): void {
  appendDeclarativeSidebar(nav, docsSidebar, {
    doc,
    win,
    sidebarConfig,
    activePagePath,
    activeHeadingId,
    searchQuery,
    esc,
    resolveDocsAlias,
    normalizeDocsPath,
    setDocsPage,
    getDocsPageViews,
    extractSidebarHeadings,
  })
}

function appendSidebarGroup(
  nav: any,
  title: string,
  items: Array<{
    active: boolean
    label: string
    prefix?: string
    children?: SidebarHeadingItem[]
    onClick: () => void
  }>
): void {
  const group = doc.createElement('div')
  group.className = 'tag-group'
  const header = doc.createElement('div')
  header.className = 'tag-group-header'
  header.innerHTML = `<span class="tag-group-arrow">▼</span>${esc(title)}<span class="tag-group-count">${items.length}</span>`
  header.onclick = () => group.classList.toggle('collapsed')
  const itemContainer = doc.createElement('div')
  itemContainer.className = 'tag-group-items'
  const childCount = items.reduce((count, item) => count + (item.children?.length ?? 0), 0)
  itemContainer.style.maxHeight = `${items.length * 50 + childCount * 34}px`
  for (const item of items) {
    const el = doc.createElement('div')
    el.className = `nav-item${item.active ? ' active' : ''}`
    el.innerHTML = `${item.prefix ? `<span class="nav-item-method method-${esc(item.prefix.toLowerCase())}">${esc(item.prefix)}</span>` : ''}<span class="nav-item-path">${esc(item.label)}</span>`
    el.onclick = (event: any) => {
      event.stopPropagation()
      item.onClick()
    }
    itemContainer.appendChild(el)
    if (item.children && item.children.length > 0) {
      const subItems = doc.createElement('div')
      subItems.className = 'nav-subitems'
      for (const child of item.children) {
        const childEl = doc.createElement('button')
        childEl.type = 'button'
        childEl.className = `nav-subitem nav-subitem-level-${child.level}${child.id === activeHeadingId ? ' active' : ''}`
        childEl.textContent = child.title
        childEl.onclick = (event: any) => {
          event.stopPropagation()
          setDocsPage(activePagePath || item.label, child.id)
        }
        subItems.appendChild(childEl)
      }
      itemContainer.appendChild(subItems)
    }
  }
  group.appendChild(header)
  group.appendChild(itemContainer)
  nav.appendChild(group)
}

function renderEndpointDetails(endpoint: Endpoint): any {
  const container = doc.createElement('div')
  container.className = 'endpoint-details'
  const data = (endpoint.data ?? {}) as any
  appendProtocolConsole(container, { doc, spec, wsSpec, streamsSpec, jsonrpcSpec, activeProtocol, endpoint, data, esc, escapeAttr })
  const appendMany = (items: Array<[string, unknown]>) => items.forEach(([title, value]) => appendSchemaSubsection(container, title, value))
  if (activeProtocol === 'http') appendMany([['Parameters', data.parameters], ['Request Body', getFirstContentSchema(data.requestBody?.content)], ['Responses', data.responses]])
  if (activeProtocol === 'websocket') {
    appendInfoGrid(container, [['Channel Type', data.type], ['Path', endpoint.path]])
    appendMany([['Parameters', parameterMapToSchema(data.parameters)], ['Subscribe Message', resolveMessagePayload(data.subscribe?.message)], ['Publish Message', resolveMessagePayload(data.publish?.message)]])
  }
  if (activeProtocol === 'streams') {
    appendInfoGrid(container, [['Direction', data.direction], ['Path', endpoint.path]])
    appendMany([['Parameters', parameterMapToSchema(data.parameters)], ['Message Schema', resolveMessagePayload(data.message)]])
  }
  if (activeProtocol === 'jsonrpc') {
    appendInfoGrid(container, [['Method', endpoint.path], ['Notification', data['x-usd-notification'] === true ? 'yes' : undefined], ['Streaming', data['x-usd-streaming'] === true ? 'yes' : undefined]])
    appendMany([['Parameters', data.params], ['Result', data.result], ['Errors', data.errors]])
  }
  if (activeProtocol === 'grpc') {
    const method = data.method ?? {}
    appendInfoGrid(container, [['Service', data.serviceName], ['Method', data.methodName], ['Type', getGrpcMethodType(method).replace(/_/g, ' ')]])
    appendMany([['Request', method.input], ['Response', method.output]])
  }
  if (activeProtocol === 'tcp') {
    appendInfoGrid(container, [['Host', data.host ?? 'localhost'], ['Port', data.port], ['TLS', data.tls?.enabled === true ? 'enabled' : undefined]])
    appendMany([['Framing', data.framing], ['Inbound Message', resolveMessagePayload(data.messages?.inbound)], ['Outbound Message', resolveMessagePayload(data.messages?.outbound)]])
  }
  if (activeProtocol === 'udp') {
    appendInfoGrid(container, [['Host', data.host ?? '0.0.0.0'], ['Port', data.port], ['Max Packet', data.maxPacketSize ? `${data.maxPacketSize} bytes` : undefined]])
    appendMany([['Inbound Message', resolveMessagePayload(data.messages?.inbound)], ['Outbound Message', resolveMessagePayload(data.messages?.outbound)], ['Message Schema', resolveMessagePayload(data.message)]])
  }
  return container
}

function parameterMapToSchema(parameters: unknown): unknown {
  if (!parameters || typeof parameters !== 'object' || Object.keys(parameters).length === 0) return null
  const schema = { type: 'object', properties: {}, required: [] as string[] } as any
  for (const [name, parameter] of Object.entries(parameters) as Array<[string, any]>) {
    schema.properties[name] = parameter.schema ?? { type: 'string', description: parameter.description }
    if (parameter.required) schema.required.push(name)
  }
  return schema
}

function appendInfoGrid(container: any, items: Array<[string, unknown]>): void {
  const visible = items.filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (visible.length === 0) return
  const grid = doc.createElement('div')
  grid.className = 'info-grid endpoint-info-grid'
  grid.innerHTML = visible.map(([label, value]) => `<div class="info-card"><div class="info-card-title">${esc(label)}</div><div class="info-card-value">${esc(value)}</div></div>`).join('')
  container.appendChild(grid)
}

function appendSchemaSubsection(container: any, title: string, schema: unknown): void {
  const resolved = resolveSchema(schema)
  if (!resolved) return
  appendObjectSubsection(container, title, resolved)
}

function appendObjectSubsection(container: any, title: string, value: unknown): void {
  if (value === undefined || value === null) return
  const section = doc.createElement('div')
  section.className = 'endpoint-subsection'
  section.innerHTML = `<div class="subsection-label">${esc(title)}</div><pre class="sample-json"><code>${esc(JSON.stringify(value, null, 2))}</code></pre>`
  container.appendChild(section)
}

function getFirstContentSchema(content: any): unknown {
  if (!content || typeof content !== 'object') return null
  const first = Object.values(content)[0] as any
  return first?.schema ?? null
}

function resolveMessagePayload(message: any): unknown {
  const resolved = resolveSchema(message)
  if (!resolved) return null
  return (resolved as any).payload ?? resolved
}

function resolveSchema(schema: any): unknown {
  if (!schema) return null
  if (schema.$ref) return resolveRef(schema.$ref) ?? schema
  return schema
}

function resolveRef(ref: unknown): unknown {
  const pointer = String(ref ?? '')
  if (!pointer.startsWith('#/')) return null
  return pointer.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((current: any, part) => current?.[part], spec)
}

function renderContent(): void {
  const main = byId('mainContent')
  if (!main) return
  main.textContent = ''
  const page = activePagePath ? getDocsPageViews().find(item => item.path === activePagePath) : null
  if (page) {
    const article = doc.createElement('article')
    article.className = 'docs-page markdown-content'
    article.innerHTML = parseMarkdown(getDocsPageMarkdown(page), page.path)
    main.appendChild(article)
    renderDocsPagination(main, page)
    renderToc(main)
    scrollToActiveHeading()
    return
  }
  if (activePagePath) {
    renderMissingDocsPage(main)
    renderToc(main)
    return
  }

  if (!searchQuery && spec.info?.description) {
    const intro = doc.createElement('div')
    intro.className = 'intro-section'
    intro.innerHTML = `<div class="markdown-content">${parseMarkdown(spec.info.description)}</div>`
    main.appendChild(intro)
  }

  if (searchQuery) renderDocsSearch(main)
  const endpoints = getEndpointsForProtocol(activeProtocol).filter(endpoint =>
    !searchQuery ||
    endpoint.path.toLowerCase().includes(searchQuery) ||
    (endpoint.summary ?? '').toLowerCase().includes(searchQuery)
  )
  for (const endpoint of endpoints) {
    const section = doc.createElement('section')
    section.className = 'endpoint-section'
    section.id = endpoint.id
    section.innerHTML = `<div class="endpoint-header"><div><div class="endpoint-method-path"><span class="badge badge-${esc(endpoint.method.toLowerCase())}">${esc(endpoint.method)}</span><span class="endpoint-path">${esc(endpoint.path)}</span></div><h2 class="endpoint-title">${esc(endpoint.summary ?? endpoint.path)}</h2>${endpoint.description ? `<div class="endpoint-description markdown-content">${parseMarkdown(endpoint.description)}</div>` : ''}</div></div>`
    section.appendChild(renderEndpointDetails(endpoint))
    main.appendChild(section)
  }
  renderToc(main)
}

function renderMissingDocsPage(main: any): void {
  const notFound = getDocsPageViews().find(page => page.path === '/404' || page.path.endsWith('/404'))
  const article = doc.createElement('article')
  article.className = 'docs-page markdown-content'
  article.innerHTML = notFound
    ? parseMarkdown(notFound.markdown, notFound.path)
    : `<h1 class="md-h1" id="not-found">Page not found</h1><p class="md-p">${esc(activePagePath)} does not exist.</p>`
  main.appendChild(article)
}

function renderDocsSearch(main: any): void {
  const matches = getDocsSearchResults()
  if (matches.length === 0) return
  const section = doc.createElement('section')
  section.className = 'section docs-search-results'
  section.innerHTML = '<h2 class="section-title" id="docs-pages">Documentation pages</h2>'
  for (const result of matches) {
    const button = doc.createElement('button')
    button.type = 'button'
    button.className = 'docs-page-result'
    button.innerHTML = `<span class="docs-page-result-title">${esc(result.title)}</span>${result.excerpt ? `<span class="docs-page-result-desc">${highlightSearchExcerpt(result.excerpt)}</span>` : ''}`
    button.onclick = () => setDocsPage(result.path, result.headingId ?? '')
    section.appendChild(button)
  }
  main.appendChild(section)
}

function getDocsSearchResults(): Array<Required<Pick<SearchIndexEntry, 'title' | 'path' | 'excerpt'>> & SearchIndexEntry> {
  const query = searchQuery.trim().toLowerCase()
  if (!query) return []
  if (searchIndex.length === 0) {
    const fallbackResults = getDocsPageViews()
      .filter(page =>
        page.title.toLowerCase().includes(query) ||
        page.description.toLowerCase().includes(query) ||
        page.markdown.toLowerCase().includes(query)
      )
      .map(page => ({
        title: page.title,
        path: page.path,
        excerpt: page.description || page.markdown.replace(/\s+/g, ' ').slice(0, 180),
        text: page.markdown,
        rank: page.order,
      }))
    return applySearchResultsHook(fallbackResults, getPluginContext())
  }

  const terms = getSearchTerms(query)
  const results = searchIndex
    .map(entry => ({ entry, score: scoreSearchEntry(entry, terms) }))
    .filter(result => result.score > 0 && result.entry.title && result.entry.path)
    .sort((a, b) => b.score - a.score || (a.entry.rank ?? 0) - (b.entry.rank ?? 0))
    .slice(0, 12)
    .map(result => ({
      title: result.entry.kind === 'heading'
        ? `${result.entry.title} · ${result.entry.section ?? 'Docs'}`
        : result.entry.title ?? '',
      path: normalizeDocsPath(result.entry.path),
      headingId: result.entry.headingId,
      excerpt: result.entry.excerpt ?? '',
      text: result.entry.text ?? '',
      rank: result.entry.rank ?? 0,
    }))
  return applySearchResultsHook(results, getPluginContext())
}

function scoreSearchEntry(entry: SearchIndexEntry, terms: string[]): number {
  const title = String(entry.title ?? '').toLowerCase()
  const section = String(entry.section ?? '').toLowerCase()
  const excerpt = String(entry.excerpt ?? '').toLowerCase()
  const text = String(entry.text ?? '').toLowerCase()
  const phrase = terms.join(' ')
  let score = scoreSearchField(title, phrase, terms, 140, 80, 52) + scoreSearchField(section, phrase, terms, 60, 32, 18) + scoreSearchField(excerpt, phrase, terms, 42, 18, 10) + scoreSearchField(text, phrase, terms, 16, 8, 4)
  if (terms.length > 1) score = terms.every(term => `${title} ${section} ${excerpt} ${text}`.includes(term)) ? score + 35 : Math.floor(score * 0.2)
  if (entry.kind === 'heading' && score > 0) score += 12
  return score
}
function scoreSearchField(value: string, phrase: string, terms: string[], phraseScore: number, prefixScore: number, termScore: number): number {
  if (!value) return 0
  let score = value === phrase ? phraseScore * 2 : value.includes(phrase) ? phraseScore : 0; for (const term of terms) score += value === term ? prefixScore * 2 : value.startsWith(term) ? prefixScore : value.includes(term) ? termScore : 0
  return score
}
const getSearchTerms = (query: string): string[] => query.trim().toLowerCase().split(/\s+/).filter(Boolean)
function highlightSearchExcerpt(excerpt: string): string {
  const query = searchQuery.trim()
  if (!query) return esc(excerpt)
  const escaped = esc(excerpt)
  const terms = getSearchTerms(query).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); if (terms.length === 0) return escaped
  return escaped.replace(new RegExp(`(${terms.join('|')})`, 'gi'), '<mark>$1</mark>')
}

function renderDocsPagination(main: any, page: PageView): void {
  const pages = getDocsPageViews()
  const index = pages.findIndex(item => item.path === page.path)
  if (index === -1 || pages.length < 2) return
  const nav = doc.createElement('nav')
  nav.className = 'docs-pagination'
  const previous = pages[index - 1]
  const next = pages[index + 1]
  nav.appendChild(previous ? paginationButton(previous, 'Previous', 'previous') : doc.createElement('span'))
  if (next) nav.appendChild(paginationButton(next, 'Next', 'next'))
  main.appendChild(nav)
}

function paginationButton(page: PageView, label: string, direction: string): any {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = `docs-pagination-link docs-pagination-${direction}`
  button.innerHTML = `<span class="docs-pagination-label">${esc(label)}</span><span class="docs-pagination-title">${esc(page.title)}</span>`
  button.onclick = () => setDocsPage(page.path)
  return button
}

function renderToc(root: any): void {
  const toc = byId('pageToc')
  if (!toc) return
  toc.textContent = ''
  if (tocConfig.enabled === false) return
  if (root.querySelector?.('[data-markdown-ignore-all="true"]')) return
  const min = Number(tocConfig.minLevel ?? 2)
  const max = Number(tocConfig.maxLevel ?? 3)
  const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? []).filter((heading: any) => {
    const level = Number(heading.tagName.slice(1))
    return heading.id && level >= min && level <= max && heading.dataset?.markdownIgnore !== 'true'
  }) as any[]
  if (headings.length === 0) return
  const title = doc.createElement('div')
  title.className = 'toc-title'
  title.textContent = 'On this page'
  toc.appendChild(title)
  for (const heading of headings) {
    const link = doc.createElement('a')
    link.className = `toc-link toc-level-${heading.tagName.slice(1)}`
    link.href = `#${heading.id}`
    link.textContent = heading.textContent?.replace(/^#/, '').trim() ?? ''
    link.onclick = (event: any) => {
      event.preventDefault()
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
      win.history?.replaceState?.(null, '', `#${heading.id}`)
    }
    toc.appendChild(link)
  }
}

function renderFooter(): void {
  const footer = byId('docsFooter')
  if (footer && footerMarkdown) footer.innerHTML = parseMarkdown(footerMarkdown)
}

function scrollToActiveHeading(): void {
  if (!activeHeadingId) return
  const heading = byId(activeHeadingId)
  if (!heading) return
  setTimeout(() => heading.scrollIntoView?.({ behavior: 'smooth', block: 'start' }), 0)
}

function scrollToEndpoint(id: string): void {
  byId(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

function renderMermaidDiagrams(root: any = doc): void {
  const mermaid = win.mermaid
  const diagrams = Array.from(root?.querySelectorAll?.('.mermaid:not([data-mermaid-rendered])') ?? []) as any[]
  if (diagrams.length === 0) return
  if (!mermaid) {
    diagrams.forEach(diagram => diagram.classList.add('mermaid-fallback'))
    return
  }
  mermaid.initialize?.({ startOnLoad: false, securityLevel: 'strict' })
  diagrams.forEach((diagram, index) => {
    const source = diagram.getAttribute('data-mermaid-source') || diagram.textContent || ''
    const id = `raffel-mermaid-${Date.now()}-${index}`
    Promise.resolve(mermaid.render(id, source))
      .then((result: any) => {
        diagram.innerHTML = typeof result === 'string' ? result : result.svg
        result?.bindFunctions?.(diagram)
        diagram.dataset.mermaidRendered = 'true'
        diagram.classList.remove('mermaid-fallback', 'mermaid-error')
      })
      .catch((error: unknown) => {
        diagram.dataset.mermaidRendered = 'error'
        diagram.classList.add('mermaid-error')
        diagram.setAttribute('title', error instanceof Error ? error.message : 'Unable to render Mermaid diagram')
      })
  })
}

function parseComponentProps(raw: unknown): Record<string, unknown> {
  const source = String(raw ?? '').trim()
  if (!source) return {}
  try {
    const parsed = JSON.parse(source)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function mountDocsComponents(root: any = doc): void {
  const targets = Array.from(root?.querySelectorAll?.('[data-raffel-component]:not([data-raffel-component-mounted])') ?? []) as any[]
  for (const target of targets) {
    const name = String(target.getAttribute?.('data-raffel-component') ?? '').trim()
    if (!name) continue
    const props = parseComponentProps(target.getAttribute?.('data-props'))
    target.dataset.raffelComponentMounted = 'true'
    target.dataset.pagePath = activePagePath
    const context = getPluginContext({ pagePath: activePagePath })
    for (const plugin of docsPlugins) plugin.mountComponent?.(target, name, props, context)
  }
}

function openImageZoom(image: any): void {
  if (!image?.src) return
  closeImageZoom()
  const overlay = doc.createElement('div')
  overlay.className = 'image-zoom-overlay'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.innerHTML = `<button type="button" class="image-zoom-close" aria-label="Close image preview">&times;</button><img class="image-zoom-img" src="${escapeAttr(image.src)}" alt="${escapeAttr(image.alt ?? '')}">`
  doc.body?.appendChild(overlay)
  for (const plugin of docsPlugins) plugin.onImageZoom?.(String(image.src), String(image.alt ?? ''), getPluginContext({ pagePath: activePagePath }))
}
function closeImageZoom(): void {
  doc?.querySelector?.('.image-zoom-overlay')?.remove?.()
}

function bindEvents(): void {
  byId('searchInput')?.addEventListener('input', (event: any) => {
    searchQuery = String(event.target?.value ?? '').toLowerCase()
    render()
  })
  byId('themeToggle')?.addEventListener('click', () => {
    const root = doc.documentElement
    const current = root.getAttribute('data-theme') || 'auto'
    const next = current === 'auto' ? 'dark' : current === 'dark' ? 'light' : current === 'light' ? 'custom' : 'auto'
    root.setAttribute('data-theme', next)
    win.localStorage?.setItem?.(themeStorageKey, next)
  })
  byId('backToTop')?.addEventListener('click', () => win.scrollTo?.({ top: 0, behavior: 'smooth' }))
  win.addEventListener?.('hashchange', () => {
    routeState = parseRouteHash()
    activePagePath = resolveDocsAlias(routeState.pagePath)
    activeHeadingId = routeState.headingId
    if (activePagePath && activePagePath !== routeState.pagePath) {
      win.history?.replaceState?.(null, '', routeToHash(activePagePath, activeHeadingId))
    }
    runVoidHook('onRouteChange', getPluginContext({ pagePath: activePagePath, headingId: activeHeadingId }))
    render()
  })
  doc?.addEventListener?.('click', (event: any) => {
    const zoomClose = event.target?.closest?.('.image-zoom-close')
    if (zoomClose || event.target?.classList?.contains?.('image-zoom-overlay')) {
      closeImageZoom()
      return
    }
    const zoomImage = event.target?.closest?.('.markdown-content .md-image')
    if (zoomImage) {
      if (zoomImage.matches?.('[data-no-zoom="true"], .no-zoom')) return
      openImageZoom(zoomImage)
      return
    }
    const tabButton = event.target?.closest?.('.md-tab-button')
    if (tabButton) {
      const tabs = tabButton.closest('.md-tabs')
      const tabIndex = tabButton.getAttribute('data-tab-index')
      tabs?.querySelectorAll?.('.md-tab-button')?.forEach((button: any) => {
        button.classList.toggle('active', button === tabButton)
      })
      tabs?.querySelectorAll?.('.md-tab-panel')?.forEach((panel: any) => {
        panel.classList.toggle('active', panel.getAttribute('data-tab-index') === tabIndex)
      })
      for (const plugin of docsPlugins) plugin.onTabChange?.(tabButton.textContent?.trim?.() ?? '', Number(tabIndex ?? 0), getPluginContext({ pagePath: activePagePath }))
      return
    }
    const copyButton = event.target?.closest?.('.copy-code-btn')
    if (!copyButton) return
    const code = copyButton.closest('.md-code-wrap')?.querySelector?.('code')
    const text = code?.textContent ?? ''
    win.navigator?.clipboard?.writeText?.(text)
    for (const plugin of docsPlugins) plugin.onCopyCode?.(text, getPluginContext({ pagePath: activePagePath }))
    copyButton.textContent = 'Copied'
    setTimeout(() => { copyButton.textContent = 'Copy' }, 1500)
  })
  doc?.addEventListener?.('keydown', (event: any) => {
    if (event.key === 'Escape') closeImageZoom()
  })
}

function render(): void {
  runVoidHook('beforeRender', getPluginContext())
  unmountDocsComponents(byId('mainContent'))
  renderProtocolTabs()
  renderSidebar()
  renderContent()
  highlightCodeBlocks(byId('mainContent'))
  renderMermaidDiagrams()
  mountDocsComponents(byId('mainContent'))
  runVoidHook('afterRender', getPluginContext())
}

function init(): void {
  if (!doc) return
  const storedTheme = win.localStorage?.getItem?.(themeStorageKey)
  if (storedTheme === 'auto' || storedTheme === 'dark' || storedTheme === 'light' || storedTheme === 'custom') doc.documentElement.setAttribute('data-theme', storedTheme)
  installDocsPluginApi()
  if (activePagePath && activePagePath !== routeState.pagePath) {
    win.history?.replaceState?.(null, '', routeToHash(activePagePath, activeHeadingId))
  }
  const intro = byId('introductionContent')
  if (intro && introductionMarkdown) intro.innerHTML = parseMarkdown(introductionMarkdown)
  bindEvents()
  renderFooter()
  render()
  // Mount cmd+K / ctrl+K search modal (skipped when sidebar search is disabled).
  const modal = createDocsSearchModal({
    doc, win, enabled: sidebarConfig?.search !== false,
    altShortcut: typeof sidebarConfig?.searchModalAltShortcut === 'string' ? String(sidebarConfig.searchModalAltShortcut) : '',
    getEntries: () => searchIndex, scoreEntry: (entry, terms) => scoreSearchEntry(entry as any, terms),
    getSearchTerms, esc, setDocsPage, normalizeDocsPath,
  })
  if (modal && win.RaffelDocs) win.RaffelDocs.searchModal = modal
}

function highlightCodeBlocks(root: any = doc): void {
  const prism = win.Prism
  if (!prism?.highlightElement) return
  const blocks = Array.from(root?.querySelectorAll?.('pre code[class*="language-"]:not([data-prism-highlighted])') ?? []) as any[]
  for (const block of blocks) {
    prism.highlightElement(block)
    block.dataset.prismHighlighted = 'true'
  }
  doc?.documentElement?.setAttribute?.('data-syntax-highlight', 'prism')
}

init()
