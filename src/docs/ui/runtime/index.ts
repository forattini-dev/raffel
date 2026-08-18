import { renderMarkedMarkdown } from './marked-renderer.js'
import { appendProtocolConsole } from './protocol-console.js'
import { appendDeclarativeSidebar, type RuntimeSidebarItem } from './sidebar-tree.js'
import { enhanceCodeBlockToolbars } from './code-block-toolbar.js'
import { flattenReadingOrder, prevNext, type PageNavEntry } from './page-nav.js'
import { createDocsSearchModal } from './search-modal.js'
type DocsPage = {
  title?: string
  path?: string
  markdown?: string
  description?: string
  section?: string
  order?: number
  updatedAt?: string
  filePath?: string
  editable?: boolean
}
type DocsRepoRuntimeConfig = {
  base?: string
  branch?: string
  pathPrefix?: string
  label?: string
  editSegment?: string
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
type EndpointGroup = { name: string; endpoints: Endpoint[] }
type PageView = Required<Pick<DocsPage, 'title' | 'path' | 'markdown' | 'description' | 'section'>> & {
  order: number
  updatedAt?: string
  frontmatter: Record<string, string>
  filePath?: string
  editable?: boolean
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
type DocsSurfaceState = {
  enabled?: boolean
  mounted?: boolean
  fresh?: boolean
  revision?: number | null
  counts?: Record<string, unknown>
  routeCounts?: Record<string, unknown>
  staleReasons?: string[]
  updatedAt?: string | null
  mountedAt?: string | null
}
type DocsStatePayload = {
  generatedAt?: string
  api?: DocsSurfaceState
  markdown?: DocsSurfaceState
}
type DocsStateRuntimeSnapshot = {
  state: DocsStatePayload | null
  apiRevision: number | null
  apiRevisionChangedAt: number
  error: string
}
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
  btoa?: (value: string) => string
  fetch?: typeof fetch
  setInterval?: typeof setInterval
  innerWidth?: number
  navigator?: any; localStorage?: any; sessionStorage?: any; mermaid?: any; marked?: any; Prism?: any
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
const mermaidConfig = data.mermaidConfig ?? { enabled: true, src: 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js', viewer: true }
const serializedResponseExamples = data.responseExamples ?? {}
const tryItConfig = data.tryIt ?? { enabled: false, mode: 'direct' }
let mermaidLoadPromise: Promise<any> | null = null
const docsRepoConfig = (data.docsRepoConfig ?? null) as DocsRepoRuntimeConfig | null
const breadcrumbsConfig = (data.breadcrumbsConfig && typeof data.breadcrumbsConfig === 'object')
  ? data.breadcrumbsConfig
  : { enabled: true, hideOnHome: true }
const pageNavConfig: { enabled?: boolean; hide?: string[] } = data.pageNavConfig ?? { enabled: true, hide: [] }
const xUsd = spec['x-usd'] ?? {}
const authenticationConfig = spec['x-usd-authentication'] ?? {}
const { websocket: wsSpec = {}, graphql: graphqlSpec = {}, streams: streamsSpec = {}, jsonrpc: jsonrpcSpec = {}, grpc: grpcSpec = {}, tcp: tcpSpec = {}, udp: udpSpec = {} } = xUsd
const docsRouteBase = String(xUsd.documentation?.routeBase ?? '').replace(/^#/, '').replace(/\/+$/, '')
const protocolData = detectProtocols()
// Logical priority for which protocol the docs open on (and the tab order):
// what a consumer of *this* API most likely came to read first. HTTP wins
// when present, then GraphQL, then realtime/RPC, then raw sockets.
const PROTOCOL_PRIORITY = ['http', 'graphql', 'websocket', 'jsonrpc', 'grpc', 'streams', 'tcp', 'udp']
const protocolRank = (name: string): number => {
  const i = PROTOCOL_PRIORITY.indexOf(name)
  return i === -1 ? PROTOCOL_PRIORITY.length : i
}
const protocols = Object.keys(protocolData).sort((a, b) => protocolRank(a) - protocolRank(b))
let activeProtocol = protocols[0] ?? 'http'
type RuntimeEnvironment = { id: string; label: string; url: string; description: string; variables: Record<string, string>; variableDefinitions: Record<string, any> }
const environments = resolveEnvironments(spec.servers)
const environmentStorageKey = `raffel-docs-environment:${String(win.location?.pathname ?? '/docs')}`
let selectedEnvironmentUrl = inferEnvironmentUrl(environments)
let searchQuery = ''
let routeState = parseRouteHash()
let activePagePath = resolveDocsAlias(routeState.pagePath)
let activeHeadingId = routeState.headingId
// Authentication material is deliberately memory-only. Persisting API keys,
// tokens, or OAuth client secrets in Web Storage makes them available to any
// script running on the documentation origin.
const credentialMemory = new Map<string, Record<string, any>>()
const pendingOAuthMemory = new Map<string, Record<string, any>>()
const docsPlugins: DocsRuntimePlugin[] = []
const themeStorageKey = 'raffel-docs-theme'
const sidebarWidthStorageKey = 'raffel-docs-sidebar-width'
const defaultSidebarWidth = 280
const defaultSidebarMinWidth = 220
const defaultSidebarMaxWidth = 560
const docsStatePollMs = 10000
const docsStateRevisionNoticeMs = 15000
let docsStateSnapshot: DocsStateRuntimeSnapshot = {
  state: null,
  apiRevision: null,
  apiRevisionChangedAt: 0,
  error: '',
}
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
    getDocsState: () => docsStateSnapshot.state,
    refreshDocsState: () => fetchDocsState(),
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
  let escaped = ''
  for (const character of String(value)) {
    if (character === '&') escaped += '&amp;'
    else if (character === '<') escaped += '&lt;'
    else if (character === '>') escaped += '&gt;'
    else if (character === '"') escaped += '&quot;'
    else if (character === "'") escaped += '&#x27;'
    else escaped += character
  }
  return escaped
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
  // When no docs route is in the hash, return the canonical root path
  // (`/`) instead of the empty string. Returning `''` would make every
  // downstream comparison against page paths (which always start with
  // `/`) fail, so the initial render would land on no page and the docs
  // nav highlight would point nowhere.
  if (!hash.startsWith('#/')) return { pagePath: '/', headingId: hash.startsWith('#') ? hash.slice(1) : '' }
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
  const editableFlag = parseEditableFromFrontmatter(parsed.data.editable)
  return {
    title: parsed.data.title ?? page.title ?? firstMarkdownHeading(parsed.body) ?? page.path ?? 'Untitled',
    path: normalizeDocsPath(page.path ?? ''),
    markdown: parsed.body,
    description: parsed.data.description ?? page.description ?? '',
    section: parsed.data.section ?? page.section ?? 'Guides',
    order: Number.isFinite(order) ? order : 0,
    updatedAt: parsed.data.updatedAt ?? page.updatedAt,
    frontmatter: parsed.data,
    filePath: page.filePath,
    editable: editableFlag ?? page.editable,
  }
}

function parseEditableFromFrontmatter(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = String(value).trim().toLowerCase()
  if (normalized === 'false') return false
  if (normalized === 'true') return true
  return undefined
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

function resolveEditLinkForPage(page: PageView): { url: string; label: string } | null {
  if (!docsRepoConfig || !docsRepoConfig.base) return null
  if (!page.filePath) return null
  if (page.editable === false) return null

  const base = String(docsRepoConfig.base).trim().replace(/\/+$/, '')
  if (!base) return null
  const branch = encodeURIComponent(String(docsRepoConfig.branch ?? 'main').replace(/^\/+|\/+$/g, ''))
  const segment = String(docsRepoConfig.editSegment ?? 'edit').replace(/^\/+|\/+$/g, '')
  const rawPrefix = String(docsRepoConfig.pathPrefix ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  const prefix = rawPrefix ? (rawPrefix.endsWith('/') ? rawPrefix : `${rawPrefix}/`) : ''
  const file = String(page.filePath).replace(/\\/g, '/').replace(/^\/+/, '')
  const fullPath = `${prefix}${file}`
  const encoded = fullPath.split('/').map(part => encodeURIComponent(part)).join('/')
  const url = `${base}/${segment}/${branch}/${encoded}`
  const label = String(docsRepoConfig.label ?? '').trim() || defaultEditLinkLabel(base)
  return { url, label }
}

function defaultEditLinkLabel(base: string): string {
  try {
    const parsed = new URL(base)
    if (parsed.hostname === 'github.com' || parsed.hostname.endsWith('.github.com')) return 'Edit on GitHub'
  } catch {
    if (/(?:^|\/)github\.com(?:\/|:|$)/i.test(base)) return 'Edit on GitHub'
  }
  return 'Edit this page'
}

function injectEditLink(article: any, page: PageView): void {
  const link = resolveEditLinkForPage(page)
  if (!link) return
  const heading = article?.querySelector?.('h1')
  if (!heading || heading.parentElement !== article) return
  const wrapper = doc.createElement('div')
  wrapper.className = 'docs-page-header'
  const anchor = doc.createElement('a')
  anchor.className = 'docs-edit-link'
  anchor.href = link.url
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.setAttribute('aria-label', link.label)
  anchor.innerHTML = `<span class="docs-edit-link-label">${esc(link.label)}</span><span class="docs-edit-link-glyph" aria-hidden="true">&#x2197;</span>`
  article.insertBefore(wrapper, heading)
  wrapper.appendChild(heading)
  wrapper.appendChild(anchor)
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
  if (graphqlSpec.queries || graphqlSpec.mutations || graphqlSpec.subscriptions || graphqlSpec.resources) {
    const operationCount =
      Object.keys(graphqlSpec.queries ?? {}).length
      + Object.keys(graphqlSpec.mutations ?? {}).length
      + Object.keys(graphqlSpec.subscriptions ?? {}).length
    out.graphql = operationCount || Object.keys(graphqlSpec.resources ?? {}).length
  }
  if (streamsSpec.endpoints) out.streams = Object.keys(streamsSpec.endpoints).length
  if (jsonrpcSpec.methods) out.jsonrpc = Object.keys(jsonrpcSpec.methods).length
  if (grpcSpec.services) {
    out.grpc = Object.values(grpcSpec.services).reduce((sum: number, service: any) => sum + Object.keys(service.methods ?? {}).length, 0)
  }
  if (tcpSpec.servers) out.tcp = Object.keys(tcpSpec.servers).length
  if (udpSpec.endpoints) out.udp = Object.keys(udpSpec.endpoints).length
  return out
}

function mergePathItemParameters(pathParameters: any, operationParameters: any): any[] {
  const resolvedParameters = (parameters: any): any[] => (
    Array.isArray(parameters) ? parameters.map(parameter => resolveSchema(parameter) ?? parameter) : []
  )
  const inherited = resolvedParameters(pathParameters)
  const declared = resolvedParameters(operationParameters)
  const declaredKeys = new Set(declared.map(parameter => {
    const resolved = resolveSchema(parameter) as any
    return `${String(resolved?.in ?? '')}\0${String(resolved?.name ?? '')}`
  }))
  return [
    ...inherited.filter(parameter => {
      const resolved = resolveSchema(parameter) as any
      return !declaredKeys.has(`${String(resolved?.in ?? '')}\0${String(resolved?.name ?? '')}`)
    }),
    ...declared,
  ]
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
        add(path, method.toUpperCase(), {
          ...operation,
          parameters: mergePathItemParameters(methods.parameters, operation.parameters),
        })
      }
    }
  }
  if (protocol === 'websocket') forEntries(wsSpec.channels, (name, channel) => add(name, 'WS', channel))
  if (protocol === 'graphql') {
    forEntries(graphqlSpec.queries, (name, query) => add(name, 'QUERY', query))
    forEntries(graphqlSpec.mutations, (name, mutation) => add(name, 'MUTATION', mutation))
    forEntries(graphqlSpec.subscriptions, (name, subscription) => add(name, 'SUBSCRIPTION', subscription))
    if (endpoints.length === 0) {
      forEntries(graphqlSpec.resources, (name, resource) => add(name, 'TYPE', resource))
    }
  }
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

function endpointMatchesSearch(endpoint: Endpoint): boolean {
  return !searchQuery ||
    endpoint.path.toLowerCase().includes(searchQuery) ||
    (endpoint.summary ?? '').toLowerCase().includes(searchQuery) ||
    (endpoint.description ?? '').toLowerCase().includes(searchQuery)
}

function getEndpointGroupsForProtocol(protocol: string): EndpointGroup[] {
  const endpoints = getEndpointsForProtocol(protocol).filter(endpointMatchesSearch)
  const endpointsByTag = new Map<string, Endpoint[]>()
  for (const endpoint of endpoints) {
    const tag = endpoint.tags?.[0] ?? 'Endpoints'
    const taggedEndpoints = endpointsByTag.get(tag) ?? []
    taggedEndpoints.push(endpoint)
    endpointsByTag.set(tag, taggedEndpoints)
  }

  if (tagGroups.length === 0) {
    return Array.from(endpointsByTag.keys())
      .sort()
      .map(name => ({ name, endpoints: endpointsByTag.get(name) ?? [] }))
  }

  const groups: EndpointGroup[] = []
  const consumedTags = new Set<string>()
  for (const group of tagGroups) {
    const groupEndpoints = (group.tags ?? []).flatMap((tag: string) => {
      consumedTags.add(tag)
      return endpointsByTag.get(tag) ?? []
    })
    if (groupEndpoints.length > 0) groups.push({ name: group.name, endpoints: groupEndpoints })
  }
  for (const tag of Array.from(endpointsByTag.keys()).filter(tag => !consumedTags.has(tag)).sort()) {
    groups.push({ name: tag, endpoints: endpointsByTag.get(tag) ?? [] })
  }
  return groups
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

function finiteSidebarNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === '') return fallback
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function sidebarWidthLimits(): { min: number, max: number, initial: number } {
  const min = Math.max(180, Math.round(finiteSidebarNumber(sidebarConfig.minWidth, defaultSidebarMinWidth)))
  const configuredMax = Math.max(min, Math.round(finiteSidebarNumber(sidebarConfig.maxWidth, defaultSidebarMaxWidth)))
  const viewportMax = Math.max(min, Math.floor(finiteSidebarNumber(win.innerWidth, 1440) * 0.6))
  const max = Math.min(configuredMax, viewportMax)
  const initial = Math.max(min, Math.min(max, Math.round(finiteSidebarNumber(sidebarConfig.width, defaultSidebarWidth))))
  return { min, max, initial }
}

function initSidebarResize(): void {
  const app = byId('docs')
  const handle = byId('sidebarResizer')
  if (!app || !handle || app.dataset?.sidebarHidden === 'true') return

  let limits = sidebarWidthLimits()
  const stored = finiteSidebarNumber(win.localStorage?.getItem?.(sidebarWidthStorageKey), limits.initial)
  let width = Math.max(limits.min, Math.min(limits.max, Math.round(stored)))
  let dragging = false

  const applyWidth = (nextWidth: number, persist = false): void => {
    limits = sidebarWidthLimits()
    width = Math.max(limits.min, Math.min(limits.max, Math.round(nextWidth)))
    app.style?.setProperty?.('--sidebar-width', `${width}px`)
    handle.setAttribute?.('aria-valuemin', String(limits.min))
    handle.setAttribute?.('aria-valuemax', String(limits.max))
    handle.setAttribute?.('aria-valuenow', String(width))
    if (persist) win.localStorage?.setItem?.(sidebarWidthStorageKey, String(width))
  }

  applyWidth(width)
  if (sidebarConfig.resizable === false) {
    handle.hidden = true
    return
  }

  const widthFromPointer = (event: any): number => {
    const left = Number(app.getBoundingClientRect?.().left ?? 0)
    return Number(event.clientX ?? width) - left
  }
  const finishResize = (event?: any): void => {
    if (!dragging) return
    dragging = false
    doc.documentElement?.classList?.remove?.('sidebar-is-resizing')
    if (event?.pointerId !== undefined) handle.releasePointerCapture?.(event.pointerId)
    applyWidth(width, true)
  }

  handle.addEventListener?.('pointerdown', (event: any) => {
    if (event.button !== undefined && event.button !== 0) return
    dragging = true
    handle.setPointerCapture?.(event.pointerId)
    doc.documentElement?.classList?.add?.('sidebar-is-resizing')
    applyWidth(widthFromPointer(event))
    event.preventDefault?.()
  })
  handle.addEventListener?.('pointermove', (event: any) => {
    if (!dragging) return
    applyWidth(widthFromPointer(event))
  })
  handle.addEventListener?.('pointerup', finishResize)
  handle.addEventListener?.('pointercancel', finishResize)
  handle.addEventListener?.('dblclick', () => applyWidth(limits.initial, true))
  handle.addEventListener?.('keydown', (event: any) => {
    const step = event.shiftKey ? 32 : 16
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = width - step
    else if (event.key === 'ArrowRight') next = width + step
    else if (event.key === 'Home') next = limits.min
    else if (event.key === 'End') next = limits.max
    if (next === null) return
    event.preventDefault?.()
    applyWidth(next, true)
  })
  win.addEventListener?.('resize', () => applyWidth(width))
}

function renderProtocolTabs(): void {
  const container = byId('protocolTabs')
  if (!container) return
  container.textContent = ''
  const isRoot = !activePagePath || activePagePath === '/'
  for (const protocol of protocols) {
    const button = doc.createElement('button')
    button.className = `protocol-tab${isRoot && protocol === activeProtocol ? ' active' : ''}`
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
  if (!activeHeadingId) {
    const appEl = doc.getElementById('docs') ?? doc.querySelector('.app-container')
    if (appEl) appEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else win.scrollTo?.({ top: 0, behavior: 'smooth' })
  }
  runVoidHook('onRouteChange', getPluginContext({ pagePath: activePagePath, headingId: activeHeadingId }))
  render()
}

type BreadcrumbEntry = { title: string, path: string }

/**
 * Resolve the breadcrumb chain from the declarative sidebar tree to the
 * active docs page. Mirrors src/docs/ui/breadcrumbs.ts so the runtime stays
 * self-contained but the algorithm is identical.
 */
function resolveDocsBreadcrumbs(items: RuntimeSidebarItem[], targetPath: string): BreadcrumbEntry[] {
  const target = normalizeDocsPath(targetPath)
  if (!target) return []
  const chain = findBreadcrumbChain(Array.isArray(items) ? items : [], target)
  return chain && chain.length >= 2 ? chain : []
}

function findBreadcrumbChain(items: RuntimeSidebarItem[], target: string): BreadcrumbEntry[] | null {
  for (const item of items) {
    const itemPath = item?.path ? normalizeDocsPath(item.path) : ''
    const externalOnly = !item?.path && !!item?.href
    const ownEntry: BreadcrumbEntry | null = externalOnly
      ? null
      : { title: String(item?.title ?? item?.path ?? item?.href ?? '').trim(), path: itemPath }
    if (itemPath && itemPath === target && ownEntry) return [ownEntry]
    const children = Array.isArray(item?.children) ? item.children as RuntimeSidebarItem[] : []
    if (children.length > 0) {
      const sub = findBreadcrumbChain(children, target)
      if (sub) {
        const head: BreadcrumbEntry = ownEntry ?? { title: String(item?.title ?? item?.path ?? item?.href ?? '').trim(), path: '' }
        return [head, ...sub]
      }
    }
  }
  return null
}

function renderDocsBreadcrumb(page: PageView): any {
  const config = breadcrumbsConfig as { enabled?: boolean, hideOnHome?: boolean }
  if (config.enabled === false) return null
  const activePath = normalizeDocsPath(page?.path ?? '')
  if (!activePath) return null
  if (config.hideOnHome !== false && (activePath === '/' || activePath === '/index' || activePath === '/home')) return null
  const chain = resolveDocsBreadcrumbs(docsSidebar, activePath)
  if (!chain || chain.length < 2) return null
  const nav = doc.createElement('nav')
  nav.className = 'docs-breadcrumb'
  nav.setAttribute('aria-label', 'Breadcrumb')
  const ol = doc.createElement('ol')
  ol.className = 'docs-breadcrumb-list'
  chain.forEach((entry: BreadcrumbEntry, index: number) => {
    const li = doc.createElement('li')
    li.className = 'docs-breadcrumb-item'
    const isLast = index === chain.length - 1
    if (isLast) {
      const span = doc.createElement('span')
      span.className = 'docs-breadcrumb-current'
      span.setAttribute('aria-current', 'page')
      span.textContent = entry.title
      li.appendChild(span)
    } else if (entry.path) {
      const a = doc.createElement('a')
      a.className = 'docs-breadcrumb-link'
      a.href = `#${entry.path}`
      a.textContent = entry.title
      a.onclick = (event: any) => {
        event.preventDefault?.()
        setDocsPage(entry.path)
      }
      li.appendChild(a)
    } else {
      const span = doc.createElement('span')
      span.className = 'docs-breadcrumb-label'
      span.textContent = entry.title
      li.appendChild(span)
    }
    ol.appendChild(li)
    if (!isLast) {
      const sep = doc.createElement('span')
      sep.className = 'docs-breadcrumb-separator'
      sep.setAttribute('aria-hidden', 'true')
      sep.textContent = '›'
      ol.appendChild(sep)
    }
  })
  nav.appendChild(ol)
  return nav
}

function renderSidebar(): void {
  const nav = byId('sidebarNav')
  if (!nav) return
  nav.textContent = ''
  renderDocsPagesNav(nav)
  // A real doc page (or a genuine non-root 404) shows the docs nav only.
  // The docs root (`/`) is NOT a page — it's the overview, so it must list
  // the active protocol's endpoints, expanded, like the old empty-path state.
  const matchedPage = activePagePath
    ? getDocsPageViews().some((p) => p.path === activePagePath)
    : false
  const isRoot = !activePagePath || activePagePath === '/'
  if (matchedPage || !isRoot) return

  for (const group of getEndpointGroupsForProtocol(activeProtocol)) {
    appendSidebarGroup(nav, group.name, group.endpoints.map((endpoint: Endpoint) => ({
      active: false,
      label: endpoint.path,
      prefix: endpoint.method,
      onClick: () => scrollToEndpoint(endpoint.id),
    })))
  }
}

function renderDocsPagesNav(nav: any): void {
  if (sidebarConfig.docsPages === false) return

  const groupLabel = sidebarConfig.docsPagesGroup
  const hasActiveDocPage = Boolean(activePagePath)
  let target = nav
  if (groupLabel) {
    const allPages = getDocsPageViews()
    const wrapper = doc.createElement('div')
    wrapper.className = `tag-group docs-pages-group${hasActiveDocPage || sidebarConfig.expandAll ? '' : ' collapsed'}`
    const header = doc.createElement('div')
    header.className = 'tag-group-header'
    header.title = String(groupLabel)
    header.innerHTML = `<span class="tag-group-arrow">▼</span>${esc(groupLabel)}<span class="tag-group-count">${allPages.length}</span>`
    const inner = doc.createElement('div')
    inner.className = 'tag-group-items'
    inner.style.maxHeight = hasActiveDocPage || sidebarConfig.expandAll ? '9999px' : '0'
    header.onclick = () => {
      wrapper.classList.toggle('collapsed')
      inner.style.maxHeight = wrapper.classList.contains('collapsed') ? '0' : '9999px'
    }
    wrapper.appendChild(header)
    wrapper.appendChild(inner)
    nav.appendChild(wrapper)
    target = inner
  }

  if (docsSidebar.length > 0 && !searchQuery) {
    renderDeclarativeDocsSidebar(target)
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
    appendSidebarGroup(target, section, sectionPages.map(page => ({
      active: page.path === activePagePath,
      label: page.title,
      path: page.path,
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

const HOME_ICON_SVG = '<svg class="docs-sidebar-home-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>'

function appendSidebarGroup(
  nav: any,
  title: string,
  items: Array<{
    active: boolean
    label: string
    path?: string
    prefix?: string
    children?: SidebarHeadingItem[]
    onClick: () => void
  }>
): void {
  const group = doc.createElement('div')
  group.className = 'tag-group'
  const header = doc.createElement('div')
  header.className = 'tag-group-header'
  header.title = title
  header.innerHTML = `<span class="tag-group-arrow">▼</span>${esc(title)}<span class="tag-group-count">${items.length}</span>`
  const itemContainer = doc.createElement('div')
  itemContainer.className = 'tag-group-items'
  const childCount = items.reduce((count, item) => count + (item.children?.length ?? 0), 0)
  const expandedHeight = `${items.length * 50 + childCount * 34}px`
  itemContainer.style.maxHeight = expandedHeight
  header.onclick = () => {
    group.classList.toggle('collapsed')
    itemContainer.style.maxHeight = group.classList.contains('collapsed') ? '0' : expandedHeight
  }
  for (const item of items) {
    const el = doc.createElement('div')
    el.className = `nav-item${item.active ? ' active' : ''}`
    el.title = item.label
    const isHome = item.path === '/' || item.path === ''
    el.innerHTML = isHome
      ? `<span class="docs-sidebar-home">${HOME_ICON_SVG}<span class="nav-item-path">${esc(item.label)}</span></span>`
      : `${item.prefix ? `<span class="nav-item-method method-${esc(item.prefix.toLowerCase())}">${esc(item.prefix)}</span>` : ''}<span class="nav-item-path">${esc(item.label)}</span>`
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
        childEl.title = child.title
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

function generateExampleFromSchema(schema: any, refStack = new Set<string>()): any {
  if (!schema) return null
  if (schema.$ref) {
    const pointer = String(schema.$ref)
    const name = pointer.split('/').pop() || pointer
    if (refStack.has(pointer)) return `Recursive schema: ${name}`
    const resolved = resolveSchema(schema)
    if (resolved === schema) return `Unresolved schema reference: ${name}`
    return generateExampleFromSchema(resolved, new Set([...refStack, pointer]))
  }
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (schema.enum && schema.enum.length > 0) return schema.enum[0]

  switch (schema.type) {
    case 'string': return schema.format === 'email' ? 'user@example.com' : 'string'
    case 'number': return 0
    case 'integer': return 0
    case 'boolean': return true
    case 'array': return schema.items ? [generateExampleFromSchema(schema.items, refStack)] : []
    case 'object':
      if (!schema.properties) return {}
      const obj: any = {}
      Object.entries(schema.properties).forEach(([key, prop]: [string, any]) => {
        obj[key] = generateExampleFromSchema(prop, refStack)
      })
      return obj
    default: return null
  }
}

function resolveEnvironments(servers: any): RuntimeEnvironment[] {
  const resolved: RuntimeEnvironment[] = []
  const list = Array.isArray(servers) && servers.length > 0
    ? servers
    : [{ url: win.location?.origin ?? 'http://localhost:3000', description: 'Current origin' }]
  list.forEach((server: any, serverIndex: number) => {
    const template = String(server?.url ?? '')
    const variables = server?.variables && typeof server.variables === 'object' ? server.variables : {}
    let combinations: Array<Record<string, string>> = [{}]
    for (const [name, definition] of Object.entries(variables) as Array<[string, any]>) {
      const values: string[] = Array.isArray(definition?.enum) && definition.enum.length > 0
        ? definition.enum.map(String)
        : [String(definition?.default ?? '')]
      combinations = combinations.flatMap(current => values.map(value => ({ ...current, [name]: value }))).slice(0, 64)
    }
    combinations.forEach((values, variantIndex) => {
      const expandedUrl = Object.entries(values).reduce(
        (current, [name, value]) => current.replaceAll(`{${name}}`, encodeURIComponent(value)),
        template
      )
      const url = String(safeRuntimeUrl(expandedUrl)?.toString() ?? expandedUrl).replace(/\/$/, '')
      const described = String(server?.description ?? '')
      const label = Object.entries(values).reduce(
        (current, [name, value]) => current.replaceAll(`{${name}}`, value),
        described
      ) || Object.values(values).join(' / ') || `Server ${serverIndex + 1}`
      resolved.push({ id: `${serverIndex}:${variantIndex}`, label, url, description: described, variables: values, variableDefinitions: variables })
    })
  })
  return resolved
}

function inferEnvironmentUrl(options: RuntimeEnvironment[]): string {
  if (options.length === 0) return String(win.location?.origin ?? 'http://localhost:3000')
  const stored = win.localStorage?.getItem?.(environmentStorageKey)
  if (stored && options.some(environment => environment.url === stored)) return stored
  const current = safeRuntimeUrl(String(win.location?.href ?? ''))
  if (!current) return options[0].url
  const scored = options.map((environment, index) => {
    const candidate = safeRuntimeUrl(environment.url)
    if (!candidate) return { environment, score: -index }
    let score = -index
    if (candidate.origin === current.origin) score += 1000
    if (current.href.startsWith(candidate.href.replace(/\/$/, ''))) score += 100
    if (candidate.hostname === current.hostname) score += 50
    score += candidate.pathname === '/' ? 0 : candidate.pathname.length
    return { environment, score }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0].environment.url
}

function safeRuntimeUrl(value: string): URL | null {
  try { return new URL(value, win.location?.origin ?? 'http://localhost:3000') } catch { return null }
}

function selectedEnvironment(): RuntimeEnvironment {
  return environments.find(environment => environment.url === selectedEnvironmentUrl) ?? environments[0]
}

function httpBaseUrl(): string {
  return String(selectedEnvironment()?.url ?? spec?.servers?.[0]?.url ?? 'http://localhost:3000').replace(/\/$/, '')
}

// Collect JSON-Schema validation constraints as readable chips.
function schemaConstraintChips(schema: any): string[] {
  if (!schema || typeof schema !== 'object') return []
  const chips: string[] = []
  if (typeof schema.minLength === 'number') chips.push(`min length: ${schema.minLength}`)
  if (typeof schema.maxLength === 'number') chips.push(`max length: ${schema.maxLength}`)
  if (typeof schema.minimum === 'number') chips.push(`>= ${schema.minimum}`)
  if (typeof schema.exclusiveMinimum === 'number') chips.push(`> ${schema.exclusiveMinimum}`)
  if (typeof schema.maximum === 'number') chips.push(`<= ${schema.maximum}`)
  if (typeof schema.exclusiveMaximum === 'number') chips.push(`< ${schema.exclusiveMaximum}`)
  if (typeof schema.multipleOf === 'number') chips.push(`multiple of ${schema.multipleOf}`)
  if (typeof schema.minItems === 'number') chips.push(`min items: ${schema.minItems}`)
  if (typeof schema.maxItems === 'number') chips.push(`max items: ${schema.maxItems}`)
  if (schema.uniqueItems) chips.push('unique items')
  if (typeof schema.pattern === 'string') chips.push(`pattern: ${schema.pattern}`)
  if (schema.nullable) chips.push('nullable')
  if (schema.readOnly) chips.push('read-only')
  if (schema.writeOnly) chips.push('write-only')
  return chips
}

// Append constraint / default / enum chips to a row element.
function appendConstraintChips(row: any, schema: any): void {
  if (!schema || typeof schema !== 'object') return
  const chips = schemaConstraintChips(schema)
  const hasDefault = schema.default !== undefined
  const enumValues: any[] = Array.isArray(schema.enum) ? schema.enum : []
  if (!chips.length && !hasDefault && enumValues.length === 0) return
  const wrap = doc.createElement('div')
  wrap.className = 'constraint-chips'
  if (hasDefault) {
    const chip = doc.createElement('span')
    chip.className = 'constraint-chip'
    chip.textContent = `default: ${JSON.stringify(schema.default)}`
    wrap.appendChild(chip)
  }
  chips.forEach(text => {
    const chip = doc.createElement('span')
    chip.className = 'constraint-chip'
    chip.textContent = text
    wrap.appendChild(chip)
  })
  enumValues.forEach(value => {
    const chip = doc.createElement('span')
    chip.className = 'constraint-chip constraint-enum'
    chip.textContent = String(value)
    wrap.appendChild(chip)
  })
  row.appendChild(wrap)
}

function formatContractExample(value: unknown): string {
  if (typeof value === 'string') return value
  const json = JSON.stringify(value)
  return json === undefined ? String(value) : json
}

function collectContractExamples(owner: any, schema: any): unknown[] {
  const examples: unknown[] = []
  if (owner?.example !== undefined) examples.push(owner.example)
  Object.values(owner?.examples ?? {}).forEach((example: any) => {
    if (example && typeof example === 'object' && 'value' in example) examples.push(example.value)
  })
  if (schema?.example !== undefined) examples.push(schema.example)
  if (Array.isArray(schema?.examples)) examples.push(...schema.examples)

  const seen = new Set<string>()
  return examples.filter(value => {
    const key = formatContractExample(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function contractSchemaType(rawSchema: any, schema: any): { type: string, label: string } {
  const refName = rawSchema?.$ref ? String(rawSchema.$ref).split('/').pop() : ''
  const type = Array.isArray(schema?.type)
    ? schema.type.join(' | ')
    : schema?.type || (refName ? 'object' : 'any')
  if (type === 'array') {
    const items = resolveSchema(schema?.items) as any
    const itemType = items?.type || (schema?.items?.$ref ? String(schema.items.$ref).split('/').pop() : 'any')
    const itemFormat = items?.format ? ` <${items.format}>` : ''
    return { type, label: `array of ${itemType}${itemFormat}` }
  }
  const format = schema?.format ? ` <${schema.format}>` : ''
  const reference = refName ? ` <${refName}>` : ''
  return { type, label: `${type}${format}${reference}` }
}

function appendContractDescription(parent: any, description: unknown, className: string): void {
  if (!description) return
  const desc = doc.createElement('div')
  desc.className = `${className} markdown-content`
  desc.innerHTML = parseMarkdown(description)
  parent.appendChild(desc)
}

function appendContractExamples(parent: any, examples: unknown[], prefix = ''): void {
  examples.forEach((value, index) => {
    const line = doc.createElement('div')
    line.className = 'schema-tree-example'
    const label = examples.length > 1 ? `Example ${index + 1}:` : 'Example:'
    const rendered = prefix ? `${prefix}${formatContractExample(value)}` : formatContractExample(value)
    line.innerHTML = `<span>${label}</span><code>${esc(rendered)}</code>`
    parent.appendChild(line)
  })
}

function createContractRow(
  name: string,
  rawSchema: any,
  required: boolean,
  options: { owner?: any, description?: unknown, deprecated?: boolean, examplePrefix?: string } = {},
): { row: any, toggle: any | null, nestedSchema: any | null } {
  const schema = resolveSchema(rawSchema) as any ?? {}
  const nestedSchema = schema.type === 'object' && schema.properties
    ? rawSchema
    : schema.type === 'array' && (resolveSchema(schema.items) as any)?.properties
      ? schema.items
      : null
  const row = doc.createElement('div')
  row.className = `schema-tree-row${nestedSchema ? ' schema-tree-row-expandable' : ''}`

  const key = doc.createElement('div')
  key.className = 'schema-tree-key'
  let toggle: any | null = null
  if (nestedSchema) {
    toggle = doc.createElement('button')
    toggle.type = 'button'
    toggle.className = 'schema-tree-toggle'
    toggle.setAttribute('aria-expanded', 'false')
    toggle.setAttribute('aria-label', `Expand ${name}`)
    toggle.textContent = '›'
    key.appendChild(toggle)
  }
  const nameEl = doc.createElement('code')
  nameEl.className = 'schema-tree-name'
  nameEl.textContent = name
  key.appendChild(nameEl)
  const state = doc.createElement('span')
  state.className = required ? 'schema-tree-required' : 'schema-tree-optional'
  state.textContent = required ? 'required' : 'optional'
  key.appendChild(state)
  if (options.deprecated) {
    const deprecated = doc.createElement('span')
    deprecated.className = 'schema-tree-deprecated'
    deprecated.textContent = 'deprecated'
    key.appendChild(deprecated)
  }

  const details = doc.createElement('div')
  details.className = 'schema-tree-details'
  const schemaType = contractSchemaType(rawSchema, schema)
  const type = doc.createElement('div')
  type.className = `schema-tree-type type-text-${esc(schemaType.type)}`
  type.textContent = schemaType.label
  details.appendChild(type)
  appendContractExamples(
    details,
    collectContractExamples(options.owner, schema),
    options.examplePrefix ?? '',
  )
  appendContractDescription(details, options.description ?? schema.description, 'schema-tree-description')
  appendConstraintChips(details, schema)
  if (schema.type === 'array' && schema.items) {
    const items = resolveSchema(schema.items) as any
    if (Array.isArray(items?.enum) && items.enum.length > 0) {
      const label = doc.createElement('div')
      label.className = 'schema-tree-items-label'
      label.textContent = 'Items'
      details.appendChild(label)
      appendConstraintChips(details, items)
    }
  }

  row.appendChild(key)
  row.appendChild(details)
  return { row, toggle, nestedSchema }
}

// Render a JSON value as a Python literal (for the Python request sample).
function pyLiteral(value: any): string {
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(pyLiteral).join(', ')}]`
  if (typeof value === 'object') {
    return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${pyLiteral(v)}`).join(', ')}}`
  }
  return 'None'
}

type StructuredHttpRequest = { method: string; url: string; headers: Record<string, string>; body: any }

function parameterSample(parameter: any): unknown {
  const schema = parameter?.schema ?? {}
  if (parameter?.example !== undefined) return parameter.example
  if (schema.example !== undefined) return schema.example
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  return parameter?.required ? generateExampleFromSchema(schema) : undefined
}

function serializeParameter(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => serializeParameter(item)).join(',')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value ?? '')
}

function hasStoredCredential(schemeName: string): boolean {
  const scheme = spec?.components?.securitySchemes?.[schemeName]
  const credential = readStoredCredential(schemeName)
  if (!scheme) return false
  if (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer') return Boolean(credential.accessToken)
  if (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'basic') return Boolean(credential.username || credential.password)
  if (scheme.type === 'oauth2' || scheme.type === 'openIdConnect') return Boolean(credential.accessToken)
  if (scheme.type === 'apiKey') return Boolean(credential.apiKey)
  return false
}

function selectedSecurityRequirement(operation: any): Record<string, unknown> | null {
  const requirements = operation.security === undefined ? (spec.security ?? []) : operation.security
  if (!Array.isArray(requirements) || requirements.length === 0) return null
  return requirements.find(requirement => (
    requirement &&
    typeof requirement === 'object' &&
    Object.keys(requirement).every(hasStoredCredential)
  )) ?? requirements[0]
}

function buildStructuredHttpRequest(endpoint: Endpoint, operation: any): StructuredHttpRequest {
  const method = String(endpoint.method || 'GET').toUpperCase()
  const requestContent = operation.requestBody?.content
  const body = requestContent ? operationRequestExample(operation) : null
  const headers: Record<string, string> = {}
  let url = `${httpBaseUrl()}${endpoint.path || '/'}`
  if (body !== null && body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    headers['Content-Type'] = 'application/json'
  }
  const query = new URLSearchParams()
  const cookies: string[] = []
  for (const parameter of operation.parameters ?? []) {
    const sample = parameterSample(parameter)
    if (sample === undefined) continue
    const serialized = serializeParameter(sample)
    if (parameter.in === 'path') {
      url = url.replaceAll(`{${parameter.name}}`, encodeURIComponent(serialized)).replaceAll(`:${parameter.name}`, encodeURIComponent(serialized))
    } else if (parameter.in === 'query') {
      query.set(parameter.name, serialized)
    } else if (parameter.in === 'header') {
      headers[parameter.name] = serialized
    } else if (parameter.in === 'cookie') {
      cookies.push(`${parameter.name}=${encodeURIComponent(serialized)}`)
    }
  }
  const queryText = query.toString()
  if (queryText) url += `${url.includes('?') ? '&' : '?'}${queryText}`
  if (cookies.length > 0) headers.Cookie = cookies.join('; ')
  const requirement = selectedSecurityRequirement(operation)
  if (requirement && typeof requirement === 'object') {
    for (const schemeName of Object.keys(requirement)) {
      const scheme = spec?.components?.securitySchemes?.[schemeName]
      const credential = readStoredCredential(schemeName)
      if (!scheme) continue
      if (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer' && credential.accessToken) {
        headers.Authorization = `Bearer ${credential.accessToken}`
      } else if (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'basic' && credential.username) {
        const encoded = typeof win.btoa === 'function'
          ? win.btoa(`${credential.username}:${credential.password ?? ''}`)
          : `${credential.username}:${credential.password ?? ''}`
        headers.Authorization = `Basic ${encoded}`
      } else if ((scheme.type === 'oauth2' || scheme.type === 'openIdConnect') && credential.accessToken) {
        headers.Authorization = `${credential.tokenType || 'Bearer'} ${credential.accessToken}`
      } else if (scheme.type === 'apiKey' && credential.apiKey) {
        if (scheme.in === 'query') {
          const parsed = safeRuntimeUrl(url)
          if (parsed) { parsed.searchParams.set(scheme.name || schemeName, credential.apiKey); url = parsed.toString() }
        } else if (scheme.in === 'cookie') {
          headers.Cookie = `${scheme.name || schemeName}=${credential.apiKey}`
        } else {
          headers[scheme.name || schemeName] = credential.apiKey
        }
      }
    }
  }
  return { method, url, headers, body }
}

// Build display-only request samples. Execution always uses the structured
// fetch request model, never one of these language snippets.
function buildHttpSamples(request: StructuredHttpRequest): Record<string, string> {
  const { method, url, body } = request
  const hasBody = body !== null && body !== undefined && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  const jsonPretty = hasBody ? JSON.stringify(body, null, 2) : ''
  const samples: Record<string, string> = {}

  let curl = `curl -X ${method} "${url}"`
  Object.entries(request.headers).forEach(([name, value]) => { curl += ` \\\n  -H ${JSON.stringify(`${name}: ${value}`)}` })
  if (hasBody) curl += ` \\\n  -d '${JSON.stringify(body)}'`
  samples.curl = curl

  let js = `const res = await fetch(${JSON.stringify(url)}, {\n  method: ${JSON.stringify(method)},`
  if (Object.keys(request.headers).length > 0) js += `\n  headers: ${JSON.stringify(request.headers, null, 2).split('\n').join('\n  ')},`
  if (hasBody) js += `\n  body: JSON.stringify(${jsonPretty.split('\n').join('\n  ')}),`
  js += `\n});\nconst data = await res.json();\nconsole.log(data);`
  samples.typescript = js

  let py = `import requests\n\nres = requests.${method.toLowerCase()}(\n    ${JSON.stringify(url)},`
  if (Object.keys(request.headers).length > 0) py += `\n    headers=${JSON.stringify(request.headers)},`
  if (hasBody) py += `\n    json=${pyLiteral(body)},`
  py += `\n)\nprint(res.json())`
  samples.python = py

  let rust = `use reqwest::Client;\n\nlet client = Client::new();\nlet res = client\n    .${method.toLowerCase()}(${JSON.stringify(url)})`
  Object.entries(request.headers).forEach(([name, value]) => { rust += `\n    .header(${JSON.stringify(name)}, ${JSON.stringify(value)})` })
  if (hasBody) rust += `\n    .json(&serde_json::json!(${jsonPretty.split('\n').join('\n    ')}))`
  rust += `\n    .send()\n    .await?;\nlet body = res.text().await?;\nprintln!("{}", body);`
  samples.rust = rust

  const goImports = hasBody ? '"net/http"\n  "strings"' : '"net/http"'
  const goBody = hasBody ? `strings.NewReader(${JSON.stringify(JSON.stringify(body))})` : 'nil'
  let go = `package main\n\nimport (\n  ${goImports}\n)\n\nfunc main() {\n  req, err := http.NewRequest(${JSON.stringify(method)}, ${JSON.stringify(url)}, ${goBody})\n  if err != nil { panic(err) }`
  Object.entries(request.headers).forEach(([name, value]) => { go += `\n  req.Header.Set(${JSON.stringify(name)}, ${JSON.stringify(value)})` })
  go += `\n  res, err := http.DefaultClient.Do(req)\n  if err != nil { panic(err) }\n  defer res.Body.Close()\n}`
  samples.go = go

  return samples
}

function createSampleCopyButton(className: string, getText: () => string): any {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = 'Copy'
  button.onclick = () => {
    const text = getText()
    const finish = () => {
      button.textContent = 'Copied'
      setTimeout(() => { if (button.textContent === 'Copied') button.textContent = 'Copy' }, 1200)
    }
    try {
      const result = win.navigator?.clipboard?.writeText?.(text)
      if (result && typeof result.then === 'function') result.then(finish).catch(finish)
      else finish()
    } catch {
      finish()
    }
  }
  return button
}

function renderCodeExamples(endpoint: any, data: any): any {
  const samples = buildHttpSamples(buildStructuredHttpRequest(endpoint, data))
  const langs: Array<[string, string, string]> = [
    ['curl', 'cURL', 'bash'],
    ['typescript', 'TypeScript', 'typescript'],
    ['rust', 'Rust', 'rust'],
    ['python', 'Python', 'python'],
    ['go', 'Go', 'go'],
  ]

  const wrap = doc.createElement('div')
  wrap.className = 'http-code-samples'
  const tabs = doc.createElement('div')
  tabs.className = 'code-tabs'
  const contents = doc.createElement('div')
  contents.className = 'code-contents'

  langs.forEach(([key, label, language], index) => {
    const tab = doc.createElement('button')
    tab.type = 'button'
    tab.className = `code-tab${index === 0 ? ' active' : ''}`
    tab.textContent = label
    const content = doc.createElement('div')
    content.className = `code-content${index === 0 ? ' active' : ''}`
    const pre = doc.createElement('pre')
    pre.className = 'http-code-sample-pre'
    pre.setAttribute('data-code-toolbar', 'managed')
    const code = doc.createElement('code')
    code.className = `language-${language}`
    code.textContent = samples[key]
    pre.appendChild(code)
    content.appendChild(pre)
    tab.onclick = () => {
      tabs.querySelectorAll('.code-tab').forEach((t: any) => t.classList.remove('active'))
      contents.querySelectorAll('.code-content').forEach((c: any) => c.classList.remove('active'))
      tab.classList.add('active')
      content.classList.add('active')
    }
    tabs.appendChild(tab)
    contents.appendChild(content)
  })

  const copy = createSampleCopyButton('http-code-copy', () => {
    const active = contents.querySelector('.code-content.active pre')
    return active?.textContent ?? ''
  })
  tabs.appendChild(copy)

  wrap.appendChild(tabs)
  wrap.appendChild(contents)
  return wrap
}

async function executeStructuredHttpRequest(endpoint: Endpoint, operation: any, button: any, result: any): Promise<void> {
  button.disabled = true
  result.textContent = 'Sending request…'
  try {
    await refreshCredentialsBeforeRequest(operation)
    const request = buildStructuredHttpRequest(endpoint, operation)
    let status: number
    let statusText: string
    let responseHeaders: Record<string, string> = {}
    let responseBody: string
    if (tryItConfig.mode === 'proxy') {
      const proxyResponse = await win.fetch?.(tryItConfig.proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!proxyResponse) throw new Error('Fetch is not available in this browser.')
      const payload: any = await proxyResponse.json()
      if (!proxyResponse.ok) throw new Error(payload?.detail || payload?.message || `Proxy failed with ${proxyResponse.status}.`)
      status = payload.status
      statusText = payload.statusText ?? ''
      responseHeaders = payload.headers ?? {}
      responseBody = payload.body ?? ''
    } else {
      const response = await win.fetch?.(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body === null || request.body === undefined ? undefined : JSON.stringify(request.body),
        credentials: 'include',
      })
      if (!response) throw new Error('Fetch is not available in this browser.')
      status = response.status
      statusText = response.statusText
      response.headers?.forEach?.((value: string, name: string) => { responseHeaders[name] = value })
      responseBody = await response.text()
    }
    const headerText = Object.entries(responseHeaders).map(([name, value]) => `${name}: ${value}`).join('\n')
    result.textContent = `${status} ${statusText}`.trim() + `${headerText ? `\n${headerText}` : ''}${responseBody ? `\n\n${responseBody}` : ''}`
  } catch (error) {
    result.textContent = `Request failed: ${String((error as Error)?.message ?? error)}`
  } finally {
    button.disabled = false
  }
}

function renderHttpExecutor(endpoint: Endpoint, operation: any): any {
  const wrapper = doc.createElement('div')
  wrapper.className = 'http-try'
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'http-try-run'
  button.textContent = 'Run request'
  const result = doc.createElement('pre')
  result.className = 'http-try-result'
  result.textContent = tryItConfig.mode === 'proxy' ? 'Ready · server proxy' : 'Ready · browser fetch'
  button.onclick = () => { void executeStructuredHttpRequest(endpoint, operation, button, result) }
  wrapper.appendChild(button)
  wrapper.appendChild(result)
  return wrapper
}

// Append a JSON example block to a container.
// Syntax-highlight a JSON value into HTML using the .sample-json token classes.
function highlightJsonHtml(value: any): string {
  let json = JSON.stringify(value, null, 2)
  if (json === undefined) return ''
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return json.replace(
    /("(?:\\.|[^"\\])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match: string, _token: string, colon: string) => {
      let cls = 'json-number'
      if (match[0] === '"') cls = colon ? 'json-key' : 'json-string'
      else if (match === 'true' || match === 'false') cls = 'json-boolean'
      else if (match === 'null') cls = 'json-null'
      return `<span class="${cls}">${match}</span>`
    }
  )
}

// Right-panel response samples: one status tab per response, each showing the
// generated JSON example (colorized) — ReDoc's response sample switcher.
function renderResponseSamples(responses: Record<string, any>, endpoint: Endpoint): any {
  const wrap = doc.createElement('div')
  const tabs = doc.createElement('div')
  tabs.className = 'sample-tabs'
  const contents = doc.createElement('div')
  contents.className = 'sample-contents'
  const entries = Object.entries(responses) as Array<[string, any]>
  entries.forEach(([status, resp], index) => {
    const statusClass = status.startsWith('2') ? 'status-2xx'
      : status.startsWith('4') ? 'status-4xx'
      : status.startsWith('5') ? 'status-5xx'
      : ''
    const tab = doc.createElement('button')
    tab.type = 'button'
    tab.className = `sample-tab ${statusClass}${index === 0 ? ' active' : ''}`
    tab.textContent = status
    const content = doc.createElement('div')
    content.className = `sample-content${index === 0 ? ' active' : ''}`
    const operationKey = `${String(endpoint.method).toUpperCase()} ${endpoint.path}`
    const mediaEntries = Object.entries(resp.content ?? {}) as Array<[string, any]>
    mediaEntries.forEach(([mediaType, media]) => {
      const mediaBlock = doc.createElement('div')
      mediaBlock.className = 'response-media-sample'
      const typeLine = doc.createElement('div')
      typeLine.className = 'sample-content-type'
      typeLine.textContent = mediaType
      mediaBlock.appendChild(typeLine)
      const prepared = serializedResponseExamples?.[operationKey]?.[status]?.[mediaType] as any[] | undefined
      const isToonl = mediaType.toLowerCase().includes('toonl')
      const examples = prepared?.length
        ? prepared
        : isToonl
          ? [{ name: 'example required', language: 'text', value: 'TOONL examples require an explicit array of flat object records.', error: true }]
          : media?.schema
          ? [{ name: 'generated', language: 'json', value: JSON.stringify(generateExampleFromSchema(media.schema), null, 2) }]
          : []
      examples.forEach(example => {
        const label = doc.createElement('div')
        label.className = 'response-example-name'
        label.textContent = example.summary || example.name
        const pre = doc.createElement('pre')
        pre.className = `sample-code${example.error ? ' sample-code-error' : ''}`
        pre.setAttribute('data-code-toolbar', 'managed')
        const code = doc.createElement('code')
        code.className = `language-${example.language || 'text'}`
        code.textContent = example.value
        pre.appendChild(code)
        const toolbar = doc.createElement('div')
        toolbar.className = 'response-example-toolbar'
        toolbar.appendChild(label)
        toolbar.appendChild(createSampleCopyButton('sample-code-copy', () => code.textContent ?? ''))
        mediaBlock.appendChild(toolbar)
        mediaBlock.appendChild(pre)
      })
      if (examples.length === 0) {
        const empty = doc.createElement('div')
        empty.className = 'no-example'
        empty.textContent = 'No example provided.'
        mediaBlock.appendChild(empty)
      }
      content.appendChild(mediaBlock)
    })
    if (mediaEntries.length === 0) {
      const empty = doc.createElement('div')
      empty.className = 'no-example'
      empty.textContent = resp.description || 'No response body.'
      content.appendChild(empty)
    }
    tab.onclick = () => {
      tabs.querySelectorAll('.sample-tab').forEach((t: any) => t.classList.remove('active'))
      contents.querySelectorAll('.sample-content').forEach((c: any) => c.classList.remove('active'))
      tab.classList.add('active')
      content.classList.add('active')
    }
    tabs.appendChild(tab)
    contents.appendChild(content)
  })
  wrap.appendChild(tabs)
  wrap.appendChild(contents)
  return wrap
}

const DEFAULT_EXPANDED_SCHEMA_DEPTH = 3

function renderSchemaTree(parent: any, schema: any, depth = 0, refStack = new Set<string>()): void {
  if (!schema) return
  const pointer = schema.$ref ? String(schema.$ref) : ''
  if (pointer && refStack.has(pointer)) {
    const recursive = doc.createElement('div')
    recursive.className = 'schema-tree-row schema-tree-unresolved'
    recursive.textContent = `Recursive schema: ${pointer.split('/').pop()}`
    parent.appendChild(recursive)
    return
  }
  const nextRefStack = pointer ? new Set([...refStack, pointer]) : refStack
  schema = resolveSchema(schema)
  const div = doc.createElement('div')
  div.className = depth === 0 ? 'schema-tree schema-tree-root' : 'schema-tree schema-tree-nested'

  if (schema.$ref) {
    const refName = String(schema.$ref).split('/').pop()
    const row = doc.createElement('div')
    row.className = 'schema-tree-row schema-tree-unresolved'
    row.textContent = `Unresolved schema reference: ${refName}`
    div.appendChild(row)
  } else if (schema.type === 'object' && schema.properties) {
    Object.entries(schema.properties).forEach(([key, prop]: [string, any]) => {
      const contract = createContractRow(key, prop, schema.required?.includes(key) === true)
      div.appendChild(contract.row)
      if (contract.nestedSchema && contract.toggle) {
        const initiallyExpanded = depth < DEFAULT_EXPANDED_SCHEMA_DEPTH
        const children = doc.createElement('div')
        children.className = `schema-tree-children${initiallyExpanded ? '' : ' collapsed'}`
        renderSchemaTree(children, contract.nestedSchema, depth + 1, nextRefStack)
        contract.toggle.classList.toggle('open', initiallyExpanded)
        contract.toggle.setAttribute('aria-expanded', String(initiallyExpanded))
        contract.toggle.setAttribute('aria-label', `${initiallyExpanded ? 'Collapse' : 'Expand'} ${key}`)
        contract.toggle.onclick = () => {
          const collapsed = children.classList.toggle('collapsed')
          contract.toggle.classList.toggle('open', !collapsed)
          contract.toggle.setAttribute('aria-expanded', String(!collapsed))
          contract.toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${key}`)
        }
        div.appendChild(children)
      }
    })
  } else if (schema.type === 'array' && schema.items) {
    const contract = createContractRow('items', schema.items, true)
    div.appendChild(contract.row)
    if (contract.nestedSchema && contract.toggle) {
      const initiallyExpanded = depth < DEFAULT_EXPANDED_SCHEMA_DEPTH
      const children = doc.createElement('div')
      children.className = `schema-tree-children${initiallyExpanded ? '' : ' collapsed'}`
      renderSchemaTree(children, contract.nestedSchema, depth + 1, nextRefStack)
      contract.toggle.classList.toggle('open', initiallyExpanded)
      contract.toggle.setAttribute('aria-expanded', String(initiallyExpanded))
      contract.toggle.setAttribute('aria-label', `${initiallyExpanded ? 'Collapse' : 'Expand'} items`)
      contract.toggle.onclick = () => {
        const collapsed = children.classList.toggle('collapsed')
        contract.toggle.classList.toggle('open', !collapsed)
        contract.toggle.setAttribute('aria-expanded', String(!collapsed))
        contract.toggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} items`)
      }
      div.appendChild(children)
    }
  } else {
    const row = doc.createElement('div')
    row.className = 'schema-tree-row schema-tree-meta'
    row.textContent = schema.type || 'any'
    appendConstraintChips(row, schema)
    div.appendChild(row)
  }
  parent.appendChild(div)
}

// Render one HTTP parameter group (path/query/header/cookie) ReDoc-style.
function renderParamGroup(title: string, params: any[]): any {
  const group = doc.createElement('div')
  group.className = 'http-param-group'
  const heading = doc.createElement('div')
  heading.className = 'http-param-group-title'
  heading.textContent = title
  group.appendChild(heading)
  const list = doc.createElement('div')
  list.className = 'http-params schema-tree schema-tree-root'
  params.forEach(param => {
    const schema = param.schema || {}
    const contract = createContractRow(param.name, schema, param.required === true, {
      owner: param,
      description: param.description || schema.description,
      deprecated: param.deprecated,
      examplePrefix: `${param.name}=`,
    })
    contract.row.classList.add('http-param')
    list.appendChild(contract.row)
  })
  group.appendChild(list)
  return group
}

// Render a single response as a collapsible accordion (ReDoc-style).
function renderResponseAccordion(status: string, resp: any, openByDefault: boolean): any {
  const statusClass = status.startsWith('2') ? 'status-2xx'
    : status.startsWith('3') ? 'status-3xx'
    : status.startsWith('4') ? 'status-4xx'
    : 'status-5xx'
  const acc = doc.createElement('div')
  acc.className = `response-accordion${openByDefault ? ' open' : ''}`

  const header = doc.createElement('button')
  header.type = 'button'
  header.className = `response-accordion-header ${statusClass}`
  header.innerHTML = `<span class="response-accordion-caret">▶</span>` +
    `<span class="response-status-dot ${statusClass}"></span>` +
    `<span class="response-status-code">${esc(status)}</span>` +
    `<span class="response-status-desc">${esc(resp.description || '')}</span>`

  const body = doc.createElement('div')
  body.className = 'response-accordion-body'

  if (resp.headers && Object.keys(resp.headers).length > 0) {
    const block = doc.createElement('div')
    block.className = 'response-block'
    const sub = doc.createElement('div')
    sub.className = 'response-subhead'
    sub.textContent = 'Response Headers'
    block.appendChild(sub)
    const list = doc.createElement('div')
    list.className = 'http-params schema-tree schema-tree-root'
    Object.entries(resp.headers).forEach(([name, def]: [string, any]) => {
      const hschema = (def as any).schema || {}
      const contract = createContractRow(name, hschema, (def as any).required === true, {
        owner: def,
        description: (def as any).description,
        deprecated: (def as any).deprecated,
      })
      contract.row.classList.add('http-param')
      list.appendChild(contract.row)
    })
    block.appendChild(list)
    body.appendChild(block)
  }

  const content = resp.content
  for (const [contentType, media] of Object.entries(content ?? {}) as Array<[string, any]>) {
    const block = doc.createElement('div')
    block.className = 'response-block'
    const sub = doc.createElement('div')
    sub.className = 'response-subhead'
    sub.textContent = `Response Body · ${contentType}`
    block.appendChild(sub)
    if (media?.schema) renderSchemaTree(block, media.schema)
    else {
      const note = doc.createElement('div')
      note.className = 'response-desc-only'
      note.textContent = media?.examples || 'example' in (media ?? {}) ? 'Example available' : 'No schema provided.'
      block.appendChild(note)
    }
    body.appendChild(block)
  }

  if (resp.links && Object.keys(resp.links).length > 0) {
    const block = doc.createElement('div')
    block.className = 'response-block response-links'
    const sub = doc.createElement('div')
    sub.className = 'response-subhead'
    sub.textContent = 'Response links'
    block.appendChild(sub)
    Object.entries(resp.links).forEach(([name, rawLink]: [string, any]) => {
      const link = resolveSchema(rawLink) as any
      const card = doc.createElement('div')
      card.className = 'response-link'
      const target = link?.operationId || link?.operationRef || 'Linked operation'
      card.innerHTML = `<strong>${esc(name)}</strong><code>${esc(target)}</code>${link?.description ? `<span>${esc(link.description)}</span>` : ''}`
      if (link?.parameters && Object.keys(link.parameters).length > 0) {
        const parameters = doc.createElement('pre')
        parameters.className = 'response-link-parameters'
        parameters.textContent = JSON.stringify(link.parameters, null, 2)
        card.appendChild(parameters)
      }
      block.appendChild(card)
    })
    body.appendChild(block)
  }

  if (!body.children.length) {
    const empty = doc.createElement('div')
    empty.className = 'response-desc-only'
    empty.textContent = resp.description || 'No content.'
    body.appendChild(empty)
  }

  header.onclick = () => acc.classList.toggle('open')
  acc.appendChild(header)
  acc.appendChild(body)
  return acc
}

const OPENAPI_HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

function appendPathItemContract(container: any, expression: string, rawPathItem: any): void {
  const pathItem = resolveSchema(rawPathItem) as any
  const contract = doc.createElement('div')
  contract.className = 'async-contract'
  const expressionLine = doc.createElement('code')
  expressionLine.className = 'async-contract-expression'
  expressionLine.textContent = expression
  contract.appendChild(expressionLine)
  OPENAPI_HTTP_METHODS.forEach(method => {
    const operation = pathItem?.[method]
    if (!operation) return
    const row = doc.createElement('div')
    row.className = 'async-contract-operation'
    const requestTypes = Object.keys(operation.requestBody?.content ?? {})
    const statuses = Object.keys(operation.responses ?? {})
    row.innerHTML = `<span class="badge badge-${method}">${method.toUpperCase()}</span><strong>${esc(operation.summary || operation.operationId || expression)}</strong>${requestTypes.length ? `<span>body: ${esc(requestTypes.join(', '))}</span>` : ''}${statuses.length ? `<span>responses: ${esc(statuses.join(', '))}</span>` : ''}`
    contract.appendChild(row)
  })
  container.appendChild(contract)
}

function renderAsyncContracts(title: string, entries: Record<string, any>, callbacks = false): any | null {
  if (!entries || Object.keys(entries).length === 0) return null
  const section = doc.createElement('section')
  section.className = `async-contracts ${title.toLowerCase()}-section`
  section.innerHTML = `<div class="subsection-label">${esc(title.toUpperCase())}</div><h2>${esc(title)}</h2><p class="async-contract-note">Read-only contract. Raffel never executes callbacks or webhooks from this page.</p>`
  Object.entries(entries).forEach(([name, rawEntry]: [string, any]) => {
    const entry = resolveSchema(rawEntry) as any
    const group = doc.createElement('div')
    group.className = 'async-contract-group'
    const heading = doc.createElement('h3')
    heading.textContent = name
    group.appendChild(heading)
    if (callbacks) {
      Object.entries(entry ?? {}).forEach(([expression, pathItem]) => appendPathItemContract(group, expression, pathItem))
    } else {
      appendPathItemContract(group, name, entry)
    }
    section.appendChild(group)
  })
  return section
}

// Merge content-type declarations across the three USD layers (operation →
// protocol → global) the same way the reference generator does, so a console
// row shows the effective default plus every supported media type.
function resolveEffectiveContentTypes(operationTypes: any, protocolTypes: any): { default: string; supported: string[] } {
  const globalTypes = (xUsd && (xUsd as any).contentTypes) ? (xUsd as any).contentTypes : {}
  const defaultType = (operationTypes && operationTypes.default)
    || (protocolTypes && protocolTypes.default)
    || globalTypes.default
    || 'application/json'
  const supportedList = (operationTypes && operationTypes.supported)
    || (protocolTypes && protocolTypes.supported)
    || globalTypes.supported
    || []
  const supported = Array.isArray(supportedList) ? supportedList.slice() : []
  if (defaultType && supported.indexOf(defaultType) === -1) supported.unshift(defaultType)
  return { default: defaultType, supported }
}

function appendContentTypesSection(container: any, label: string, contentTypes: { default: string; supported: string[] } | null): void {
  if (!contentTypes) return
  const section = doc.createElement('div')
  section.className = 'endpoint-subsection'
  section.innerHTML = `<div class="subsection-label">${esc(label)}</div>`
  const grid = doc.createElement('div')
  grid.className = 'info-grid'
  const supportedText = (contentTypes.supported && contentTypes.supported.length > 0)
    ? contentTypes.supported.join(', ')
    : contentTypes.default
  grid.innerHTML =
    `<div class="info-card"><div class="info-card-title">Default</div><div class="info-card-value">${esc(contentTypes.default || 'application/json')}</div></div>` +
    `<div class="info-card"><div class="info-card-title">Supported</div><div class="info-card-value">${esc(supportedText || 'application/json')}</div></div>`
  section.appendChild(grid)
  container.appendChild(section)
}

// Multi-language client snippets for WebSocket channels.
function generateWsCodeSample(lang: string, url: string, path: string, data: any): string {
  const channelType = data?.type || 'public'
  const subscribeMsg = { type: 'subscribe', channel: path, id: '1' }
  const subscribeMsgStr = JSON.stringify(subscribeMsg, null, 2)
  const publishMsg = data?.publish?.message?.payload
    ? { type: 'publish', channel: path, event: 'message', data: generateExampleFromSchema(data.publish.message.payload), id: '2' }
    : null
  const needsAuth = channelType === 'private' || channelType === 'presence'
  const authUrl = needsAuth ? `${url}?token=YOUR_TOKEN` : url
  const indent = (value: string, pad: string) => value.split('\n').map((line, i) => i === 0 ? line : pad + line).join('\n')
  switch (lang) {
    case 'wscat': {
      let out = `wscat -c "${authUrl}"\n\n# Subscribe to channel:\n> ${JSON.stringify(subscribeMsg)}`
      if (publishMsg) out += `\n\n# Publish a message:\n> ${JSON.stringify(publishMsg)}`
      return out
    }
    case 'javascript': {
      let out = `const ws = new WebSocket("${authUrl}");\n\n`
      out += `ws.onopen = () => {\n  console.log("Connected");\n  // Subscribe to channel\n  ws.send(JSON.stringify(${indent(subscribeMsgStr, '    ')}));\n};\n\n`
      out += `ws.onmessage = (event) => {\n  const msg = JSON.parse(event.data);\n  console.log("Received:", msg);\n`
      if (publishMsg) out += `\n  // After subscribed, you can publish:\n  // ws.send(JSON.stringify(${JSON.stringify(publishMsg)}));\n`
      out += `};\n\nws.onclose = () => {\n  console.log("Disconnected");\n};`
      return out
    }
    case 'recker': {
      let out = `import { ws } from "recker";\n\n`
      out += needsAuth
        ? `const socket = await ws("${url}", {\n  query: { token: "YOUR_TOKEN" }\n});\n\n`
        : `const socket = await ws("${url}");\n\n`
      out += `// Subscribe to channel\nsocket.send(${indent(subscribeMsgStr, '  ')});\n\n`
      out += `// Listen for messages\nsocket.on("message", (data) => {\n  console.log("Received:", data);\n});\n`
      if (publishMsg) out += `\n// Publish a message\n// socket.send(${JSON.stringify(publishMsg)});\n`
      return out
    }
    case 'python': {
      let out = `import asyncio\nimport websockets\nimport json\n\n`
      out += `async def connect():\n    async with websockets.connect("${authUrl}") as ws:\n`
      out += `        # Subscribe to channel\n        await ws.send(json.dumps(${indent(subscribeMsgStr, '        ')}))\n        \n`
      out += `        # Wait for messages\n        async for message in ws:\n            data = json.loads(message)\n            print(f"Received: {data}")\n\n`
      out += `asyncio.run(connect())`
      return out
    }
    default:
      return '// Not implemented'
  }
}

// Multi-language client snippets for SSE / EventSource streams.
function generateStreamCodeSample(lang: string, url: string): string {
  switch (lang) {
    case 'curl':
      return `curl -N "${url}"\n\n# -N disables buffering for streaming output`
    case 'eventsource':
      return `const eventSource = new EventSource("${url}");\n\neventSource.onmessage = (event) => {\n  console.log("Received:", event.data);\n};\n\neventSource.onerror = (error) => {\n  console.error("Error:", error);\n  eventSource.close();\n};\n\n// To close the connection:\n// eventSource.close();`
    case 'recker':
      return `import { sse } from "recker";\n\nconst stream = sse("${url}");\n\nfor await (const event of stream) {\n  console.log("Received:", event.data);\n}`
    case 'python':
      return `import sseclient\nimport requests\n\nresponse = requests.get("${url}", stream=True)\nclient = sseclient.SSEClient(response)\n\nfor event in client.events():\n    print(f"Event: {event.event}, Data: {event.data}")`
    default:
      return '// Not implemented'
  }
}

// Tabbed client-code panel for the non-HTTP protocols that carry a live console
// (WebSocket, streams). Mirrors renderCodeExamples' markup so the shared code
// tab / copy styling applies.
function renderProtocolCodeSamples(kind: 'websocket' | 'streams', endpoint: Endpoint, data: any): any {
  const base = String(spec.servers?.[0]?.url ?? 'http://localhost:3000').replace(/\/$/, '')
  const isWs = kind === 'websocket'
  const url = isWs
    ? `${base.replace(/^http/, 'ws')}${(wsSpec as any).path ?? '/ws'}`
    : `${base}/${(streamsSpec as any).pathPrefix ?? 'streams'}/${endpoint.path}`.replace(/([^:]\/)\/+/g, '$1')
  const langs: Array<[string, string, string]> = isWs
    ? [['wscat', 'wscat', 'bash'], ['javascript', 'WebSocket', 'javascript'], ['recker', 'Recker', 'typescript'], ['python', 'Python', 'python']]
    : [['curl', 'cURL', 'bash'], ['eventsource', 'EventSource', 'javascript'], ['recker', 'Recker', 'typescript'], ['python', 'Python', 'python']]

  const section = doc.createElement('div')
  section.className = 'endpoint-subsection'
  section.innerHTML = '<div class="subsection-label">Client examples</div>'
  const wrap = doc.createElement('div')
  wrap.className = 'http-code-samples'
  const tabs = doc.createElement('div')
  tabs.className = 'code-tabs'
  const contents = doc.createElement('div')
  contents.className = 'code-contents'

  langs.forEach(([key, label, language], index) => {
    const tab = doc.createElement('button')
    tab.type = 'button'
    tab.className = `code-tab${index === 0 ? ' active' : ''}`
    tab.textContent = label
    const content = doc.createElement('div')
    content.className = `code-content${index === 0 ? ' active' : ''}`
    const pre = doc.createElement('pre')
    pre.className = 'http-code-sample-pre'
    pre.setAttribute('data-code-toolbar', 'managed')
    const code = doc.createElement('code')
    code.className = `language-${language}`
    code.textContent = isWs
      ? generateWsCodeSample(key, url, endpoint.path, data)
      : generateStreamCodeSample(key, url)
    pre.appendChild(code)
    content.appendChild(pre)
    tab.onclick = () => {
      tabs.querySelectorAll('.code-tab').forEach((t: any) => t.classList.remove('active'))
      contents.querySelectorAll('.code-content').forEach((c: any) => c.classList.remove('active'))
      tab.classList.add('active')
      content.classList.add('active')
    }
    tabs.appendChild(tab)
    contents.appendChild(content)
  })

  const copy = createSampleCopyButton('http-code-copy', () => {
    const active = contents.querySelector('.code-content.active pre')
    return active?.textContent ?? ''
  })
  tabs.appendChild(copy)
  wrap.appendChild(tabs)
  wrap.appendChild(contents)
  section.appendChild(wrap)
  return section
}

function renderEndpointDetails(endpoint: Endpoint): any {
  const container = doc.createElement('div')
  container.className = 'endpoint-details'
  const data = (endpoint.data ?? {}) as any
  appendProtocolConsole(container, { doc, spec, wsSpec, streamsSpec, jsonrpcSpec, activeProtocol, endpoint, data, esc, escapeAttr, tryItConfig })
  const appendMany = (items: Array<[string, unknown]>) => items.forEach(([title, value]) => appendSchemaSubsection(container, title, value))
  if (activeProtocol === 'http') {
    // Two-column operation layout (ReDoc-style): the left column carries the
    // contract (params + schemas + responses); the right column is a sticky
    // dark panel with the request samples and response examples.
    const content = doc.createElement('div')
    content.className = 'endpoint-content'
    const left = doc.createElement('div')
    left.className = 'endpoint-left'
    const right = doc.createElement('div')
    right.className = 'endpoint-right'

    const longPoll = data['x-usd-long-poll'] ?? data['x-raffel-long-poll']
    if (longPoll) {
      const section = doc.createElement('div')
      section.className = 'endpoint-subsection long-poll-interaction'
      section.innerHTML = '<div class="subsection-label">Long Poll Interaction</div>'
      appendInfoGrid(section, [
        ['Cursor', `${longPoll.cursor?.input ?? 'cursor'} → ${longPoll.cursor?.output ?? 'cursor'} (${longPoll.cursor?.semantics ?? 'exclusive'})`],
        ['Maximum wait', longPoll.waitMs ? `${longPoll.waitMs} ms` : undefined],
        ['Retry hint', longPoll.retryMs ? `${longPoll.retryMs} ms` : undefined],
        ['Timeout outcome', longPoll.timeoutOutcome],
      ])
      left.appendChild(section)
    }

    const params = (data.parameters ?? []) as any[]
    if (params.length > 0) {
      const section = doc.createElement('div')
      section.className = 'endpoint-subsection'
      section.innerHTML = '<div class="subsection-label">PARAMETERS</div>'
      const groups: Array<[string, string]> = [
        ['path', 'Path Parameters'],
        ['query', 'Query Parameters'],
        ['header', 'Header Parameters'],
        ['cookie', 'Cookie Parameters'],
      ]
      groups.forEach(([location, title]) => {
        const inGroup = params.filter(p => (p.in || 'query') === location)
        if (inGroup.length > 0) section.appendChild(renderParamGroup(title, inGroup))
      })
      left.appendChild(section)
    }
    const reqBody = data.requestBody
    if (reqBody?.content) {
      const section = doc.createElement('div')
      section.className = 'endpoint-subsection'
      const contentType = Object.keys(reqBody.content)[0]
      section.innerHTML = `<div class="subsection-label">REQUEST BODY${reqBody.required ? ' <span style="color:#ef4444">required</span>' : ''}${contentType ? ` · ${esc(contentType)}` : ''}</div>`
      const bodyContent = reqBody.content[contentType]
      if (bodyContent?.schema) renderSchemaTree(section, bodyContent.schema)
      const requestExamples = Object.entries(bodyContent?.examples ?? {}) as Array<[string, any]>
      if (requestExamples.length > 0 || bodyContent && 'example' in bodyContent) {
        const examplesTitle = doc.createElement('div')
        examplesTitle.className = 'response-subhead request-examples-title'
        examplesTitle.textContent = 'Request examples'
        section.appendChild(examplesTitle)
        const examples = requestExamples.length > 0
          ? requestExamples
          : [['example', { value: bodyContent.example }]] as Array<[string, any]>
        examples.forEach(([name, example]) => {
          const wrapper = doc.createElement('div')
          wrapper.className = 'request-example'
          const label = doc.createElement('div')
          label.className = 'response-example-name'
          label.textContent = example?.summary || name
          const pre = doc.createElement('pre')
          pre.className = 'sample-code'
          const code = doc.createElement('code')
          code.className = 'language-json'
          code.textContent = JSON.stringify(example?.value, null, 2)
          pre.appendChild(code)
          wrapper.appendChild(label)
          wrapper.appendChild(pre)
          section.appendChild(wrapper)
        })
      }
      left.appendChild(section)
    }
    const responses = data.responses
    if (responses && Object.keys(responses).length > 0) {
      const section = doc.createElement('div')
      section.className = 'endpoint-subsection'
      section.innerHTML = '<div class="subsection-label">RESPONSES</div>'
      const entries = Object.entries(responses) as Array<[string, any]>
      let opened = false
      entries.forEach(([status, resp]) => {
        const open = !opened && status.startsWith('2')
        if (open) opened = true
        section.appendChild(renderResponseAccordion(status, resp, open))
      })
      if (!opened) {
        const first = section.querySelector('.response-accordion')
        if (first) first.classList.add('open')
      }
      left.appendChild(section)
    }
    const callbacks = renderAsyncContracts('Callbacks', data.callbacks ?? {}, true)
    if (callbacks) left.appendChild(callbacks)

    // Right column: request samples (cURL / TypeScript / Rust / Python / Go).
    const samplesSection = doc.createElement('div')
    samplesSection.className = 'endpoint-right-section'
    samplesSection.innerHTML = '<div class="endpoint-right-header">Request samples</div>'
    samplesSection.appendChild(renderCodeExamples(endpoint, data))
    if (tryItConfig.enabled) samplesSection.appendChild(renderHttpExecutor(endpoint, data))
    right.appendChild(samplesSection)

    // Right column: response samples (JSON examples per status code).
    if (responses && Object.keys(responses).length > 0) {
      const respSamples = doc.createElement('div')
      respSamples.className = 'endpoint-right-section'
      respSamples.innerHTML = '<div class="endpoint-right-header">Response samples</div>'
      respSamples.appendChild(renderResponseSamples(responses, endpoint))
      right.appendChild(respSamples)
    }

    content.appendChild(left)
    content.appendChild(right)
    container.appendChild(content)
  }
  if (activeProtocol === 'websocket') {
    appendInfoGrid(container, [['Channel Type', data.type], ['Path', endpoint.path]])
    appendMany([['Parameters', parameterMapToSchema(data.parameters)], ['Subscribe Message', resolveMessagePayload(data.subscribe?.message)], ['Publish Message', resolveMessagePayload(data.publish?.message)]])
    appendContentTypesSection(container, 'Subscribe Content Types', resolveEffectiveContentTypes(data.subscribe?.contentTypes, (wsSpec as any)?.contentTypes))
    appendContentTypesSection(container, 'Publish Content Types', resolveEffectiveContentTypes(data.publish?.contentTypes, (wsSpec as any)?.contentTypes))
    container.appendChild(renderProtocolCodeSamples('websocket', endpoint, data))
  }
  if (activeProtocol === 'graphql') {
    appendInfoGrid(container, [['Endpoint', graphqlSpec.endpoint], ['Kind', data.kind], ['Resource', data.resource ?? data.name], ['Source', data.source]])
    appendMany([['Arguments', data.args], ['Input', data.input], ['Output', data.output], ['Schema', data.schema], ['Relations', data.relations], ['Authorize', data.authorize], ['Authorization', data.authz], ['Policies', data.policies]])
  }
  if (activeProtocol === 'streams') {
    const resumable = data['x-usd-resumable']
    appendInfoGrid(container, [
      ['Direction', data.direction],
      ['Path', endpoint.path],
      ['Delivery', resumable?.delivery],
      ['Resume Cursor', resumable?.cursor?.header],
      ['Snapshot event', resumable?.snapshot?.event],
    ])
    appendStreamProjectionDiagnostics(container, resumable?.projections)
    appendMany([['Parameters', parameterMapToSchema(data.parameters)], ['Message Schema', resolveMessagePayload(data.message)]])
    appendContentTypesSection(container, 'Content Types', resolveEffectiveContentTypes(data.contentTypes, (streamsSpec as any)?.contentTypes))
    container.appendChild(renderProtocolCodeSamples('streams', endpoint, data))
  }
  if (activeProtocol === 'jsonrpc') {
    appendInfoGrid(container, [['Method', endpoint.path], ['Notification', data['x-usd-notification'] === true ? 'yes' : undefined], ['Streaming', data['x-usd-streaming'] === true ? 'yes' : undefined]])
    appendMany([['Parameters', data.params], ['Result', data.result], ['Errors', data.errors]])
    appendContentTypesSection(container, 'Content Types', resolveEffectiveContentTypes(data.contentTypes, (jsonrpcSpec as any)?.contentTypes))
  }
  if (activeProtocol === 'grpc') {
    const method = data.method ?? {}
    appendInfoGrid(container, [['Service', data.serviceName], ['Method', data.methodName], ['Type', getGrpcMethodType(method).replace(/_/g, ' ')]])
    appendMany([['Request', method.input], ['Response', method.output]])
    appendContentTypesSection(container, 'Content Types', resolveEffectiveContentTypes(method.contentTypes, (grpcSpec as any)?.contentTypes))
  }
  if (activeProtocol === 'tcp') {
    appendInfoGrid(container, [['Host', data.host ?? 'localhost'], ['Port', data.port], ['TLS', data.tls?.enabled === true ? 'enabled' : undefined]])
    appendMany([['Framing', data.framing], ['Inbound Message', resolveMessagePayload(data.messages?.inbound)], ['Outbound Message', resolveMessagePayload(data.messages?.outbound)]])
    appendContentTypesSection(container, 'Content Types', resolveEffectiveContentTypes(data.contentTypes, (tcpSpec as any)?.contentTypes))
  }
  if (activeProtocol === 'udp') {
    appendInfoGrid(container, [['Host', data.host ?? '127.0.0.1'], ['Port', data.port], ['Max Packet', data.maxPacketSize ? `${data.maxPacketSize} bytes` : undefined]])
    appendMany([['Inbound Message', resolveMessagePayload(data.messages?.inbound)], ['Outbound Message', resolveMessagePayload(data.messages?.outbound)], ['Message Schema', resolveMessagePayload(data.message)]])
    appendContentTypesSection(container, 'Content Types', resolveEffectiveContentTypes(data.contentTypes, (udpSpec as any)?.contentTypes))
  }
  return container
}

function appendStreamProjectionDiagnostics(container: any, projections: any): void {
  if (!projections || typeof projections !== 'object') return
  const labels: Record<string, string> = {
    httpSse: 'HTTP / SSE',
    websocket: 'WebSocket',
    grpc: 'gRPC',
  }
  const entries = Object.entries(projections) as Array<[string, any]>
  if (entries.length === 0) return

  const section = doc.createElement('div')
  section.className = 'endpoint-subsection stream-projection-diagnostics'
  section.innerHTML = '<div class="subsection-label">Projection diagnostics</div>'
  const grid = doc.createElement('div')
  grid.className = 'projection-diagnostic-grid'
  for (const [name, diagnostic] of entries) {
    const declaredStatus = String(diagnostic?.status ?? '')
    const status = ['preserved', 'adapted', 'unsupported'].includes(declaredStatus)
      ? declaredStatus
      : 'unsupported'
    const card = doc.createElement('div')
    card.className = `projection-diagnostic projection-${status}`
    const details = [
      diagnostic?.transport,
      diagnostic?.resumeCursor ? `resume: ${diagnostic.resumeCursor}` : undefined,
      diagnostic?.recordCursor ? `records: ${diagnostic.recordCursor}` : undefined,
      diagnostic?.snapshot ? `snapshot: ${diagnostic.snapshot}` : undefined,
    ].filter(Boolean)
    card.innerHTML = `<div class="projection-diagnostic-heading"><strong>${esc(labels[name] ?? name)}</strong><span>${esc(status)}</span></div>${details.length ? `<div class="projection-diagnostic-details">${details.map(esc).join(' · ')}</div>` : ''}${diagnostic?.reason ? `<div class="projection-diagnostic-reason">${esc(diagnostic.reason)}</div>` : ''}`
    grid.appendChild(card)
  }
  section.appendChild(grid)
  container.appendChild(section)
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
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref)
    if (!resolved || typeof resolved !== 'object') return schema
    const { $ref: _ref, ...siblings } = schema
    return { ...(resolved as Record<string, unknown>), ...siblings }
  }
  return schema
}

function resolveRef(ref: unknown): unknown {
  const pointer = String(ref ?? '')
  if (!pointer.startsWith('#/')) return null
  return pointer.slice(2).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((current: any, part) => current?.[part], spec)
}

function credentialStorageKey(schemeName: string): string {
  return `raffel-docs:auth:${encodeURIComponent(selectedEnvironmentUrl)}:${encodeURIComponent(schemeName)}`
}

function readStoredCredential(schemeName: string): Record<string, any> {
  return { ...(credentialMemory.get(credentialStorageKey(schemeName)) ?? {}) }
}

function storeCredential(schemeName: string, value: Record<string, any>): void {
  credentialMemory.set(credentialStorageKey(schemeName), { ...value })
}

function authSchemeKind(scheme: any): string {
  if (scheme?.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer') return 'Bearer token'
  if (scheme?.type === 'http' && String(scheme.scheme).toLowerCase() === 'basic') return 'HTTP Basic'
  if (scheme?.type === 'apiKey') return 'API key'
  if (scheme?.type === 'oauth2') return 'OAuth 2.0'
  if (scheme?.type === 'openIdConnect') return 'OpenID Connect'
  if (scheme?.type === 'mutualTLS') return 'Mutual TLS'
  return String(scheme?.type ?? 'Authentication')
}

function findHttpOperation(operationId: string): { path: string; method: string; operation: any } | null {
  for (const [path, pathItem] of Object.entries(spec.paths ?? {}) as Array<[string, any]>) {
    for (const [method, operation] of Object.entries(pathItem ?? {}) as Array<[string, any]>) {
      if (operation?.operationId === operationId) return { path, method: method.toUpperCase(), operation }
    }
  }
  return null
}

function operationRequestExample(operation: any): unknown {
  const media = Object.values(operation?.requestBody?.content ?? {})[0] as any
  if (!media) return {}
  if ('example' in media) return media.example
  const named = Object.values(media.examples ?? {})[0] as any
  if (named && typeof named === 'object' && 'value' in named) return named.value
  return generateExampleFromSchema(media.schema) ?? {}
}

function readJsonPointer(value: any, pointer: unknown): any {
  const path = String(pointer ?? '')
  if (path === '') return value
  if (!path.startsWith('/')) return undefined
  return path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~')).reduce((current: any, part) => current?.[part], value)
}

function tokenExpiry(response: any, pointers: any): number | undefined {
  const expiresAt = readJsonPointer(response, pointers?.expiresAt)
  if (expiresAt !== undefined) {
    if (typeof expiresAt === 'number') return expiresAt > 1e12 ? expiresAt : expiresAt * 1000
    const parsed = Date.parse(String(expiresAt))
    if (Number.isFinite(parsed)) return parsed
  }
  const expiresIn = Number(readJsonPointer(response, pointers?.expiresIn))
  return Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined
}

type JsonHttpResult = { ok: boolean; status: number; payload: any }

async function executeJsonHttpRequest(url: string, init: RequestInit = {}): Promise<JsonHttpResult> {
  if (tryItConfig.mode === 'proxy') {
    const proxyResponse = await win.fetch?.(tryItConfig.proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        method: String(init.method ?? 'GET').toUpperCase(),
        headers: init.headers ?? {},
        body: init.body,
      }),
    })
    if (!proxyResponse) throw new Error('Fetch is not available in this browser.')
    const envelope: any = await proxyResponse.json()
    if (!proxyResponse.ok) {
      throw new Error(envelope?.detail || envelope?.message || `Proxy failed with ${proxyResponse.status}.`)
    }
    const status = Number(envelope?.status ?? 502)
    let payload: any = {}
    try { payload = JSON.parse(String(envelope?.body ?? '')) } catch { /* callers report a missing token or discovery field */ }
    return { ok: status >= 200 && status < 300, status, payload }
  }

  const response = await win.fetch?.(url, init)
  if (!response) throw new Error('Fetch is not available in this browser.')
  return { ok: response.ok, status: response.status, payload: await response.json() }
}

async function requestOperationToken(
  schemeName: string,
  recipe: any,
  operation: { path: string; method: string; operation: any },
  rawBody: string,
  status: any
): Promise<void> {
  try {
    status.textContent = 'Requesting token…'
    const parsedBody = rawBody.trim() ? JSON.parse(rawBody) : undefined
    const headers: Record<string, string> = parsedBody === undefined ? {} : { 'Content-Type': 'application/json' }
    const response = await executeJsonHttpRequest(`${httpBaseUrl()}${operation.path}`, {
      method: operation.method,
      headers,
      body: parsedBody === undefined ? undefined : JSON.stringify(parsedBody),
    })
    const payload = response.payload
    if (!response.ok) throw new Error(payload?.message || `Token request failed with ${response.status}.`)
    const accessToken = readJsonPointer(payload, recipe.tokenPointers?.accessToken)
    if (accessToken === undefined || accessToken === null || accessToken === '') {
      throw new Error('The access-token JSON Pointer did not match the response.')
    }
    storeCredential(schemeName, {
      accessToken: String(accessToken),
      refreshToken: readJsonPointer(payload, recipe.tokenPointers?.refreshToken),
      expiresAt: tokenExpiry(payload, recipe.tokenPointers),
      tokenType: readJsonPointer(payload, recipe.tokenPointers?.tokenType) ?? 'Bearer',
    })
    render()
  } catch (error) {
    status.textContent = String((error as Error)?.message ?? error)
    status.classList.add('auth-status-error')
  }
}

function oauthFlowLabel(flowName: string): string {
  if (flowName === 'authorizationCode') return 'Authorization code'
  if (flowName === 'clientCredentials') return 'Client credentials'
  if (flowName === 'password') return 'Resource owner password'
  return 'Implicit'
}

function oauthScopeValue(flow: any): string {
  return Object.keys(flow?.scopes ?? {}).join(' ')
}

async function requestOAuthToken(
  schemeName: string,
  flowName: string,
  flow: any,
  fieldset: any,
  status: any
): Promise<void> {
  try {
    const value = (name: string) => String(fieldset.querySelector(`input[name="${name}"]`)?.value ?? '')
    const body = new URLSearchParams()
    body.set('grant_type', flowName === 'clientCredentials' ? 'client_credentials' : 'password')
    if (value('clientId')) body.set('client_id', value('clientId'))
    if (value('clientSecret')) body.set('client_secret', value('clientSecret'))
    if (value('scopes')) body.set('scope', value('scopes'))
    if (flowName === 'password') {
      body.set('username', value('username'))
      body.set('password', value('password'))
    }
    status.textContent = 'Requesting token…'
    const response = await executeJsonHttpRequest(flow.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    const payload = response.payload
    if (!response.ok) throw new Error(payload?.error_description || payload?.error || `Token request failed with ${response.status}.`)
    if (!payload.access_token) throw new Error('The token response did not include access_token.')
    storeCredential(schemeName, {
      accessToken: String(payload.access_token),
      refreshToken: payload.refresh_token,
      expiresAt: Number(payload.expires_in) > 0 ? Date.now() + Number(payload.expires_in) * 1000 : undefined,
      tokenType: payload.token_type || 'Bearer',
      clientId: value('clientId'),
      clientSecret: value('clientSecret'),
      scopes: value('scopes'),
      tokenUrl: flow.tokenUrl,
      refreshUrl: flow.refreshUrl,
    })
    render()
  } catch (error) {
    status.textContent = String((error as Error)?.message ?? error)
    status.classList.add('auth-status-error')
  }
}

function randomOAuthState(): string {
  const values = new Uint32Array(4)
  try { (globalThis.crypto ?? (win as any).crypto)?.getRandomValues?.(values) } catch { values[0] = Date.now() }
  return Array.from(values).map(value => value.toString(16)).join('') || String(Date.now())
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return (win.btoa as (value: string) => string)(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomOAuthVerifier(): string {
  const values = new Uint8Array(32)
  const cryptoApi = globalThis.crypto ?? (win as any).crypto
  try { cryptoApi?.getRandomValues?.(values) } catch { /* use the state-based fallback below */ }
  if (values.every(value => value === 0)) {
    const fallback = `${randomOAuthState()}${randomOAuthState()}`
    values.forEach((_, index) => { values[index] = fallback.charCodeAt(index % fallback.length) })
  }
  return base64Url(values)
}

async function oauthCodeChallenge(verifier: string): Promise<{ challenge: string; method: 'S256' | 'plain' }> {
  const cryptoApi = globalThis.crypto ?? (win as any).crypto
  if (!cryptoApi?.subtle?.digest) return { challenge: verifier, method: 'plain' }
  try {
    const bytes = Uint8Array.from(verifier, character => character.charCodeAt(0))
    const digest = await cryptoApi.subtle.digest('SHA-256', bytes)
    return { challenge: base64Url(new Uint8Array(digest)), method: 'S256' }
  } catch {
    return { challenge: verifier, method: 'plain' }
  }
}

async function startOAuthAuthorization(schemeName: string, flowName: string, flow: any, fieldset: any): Promise<void> {
  const value = (name: string) => String(fieldset.querySelector(`input[name="${name}"]`)?.value ?? '')
  const redirectUri = `${String(win.location?.href ?? '').split('#')[0].split('?')[0]}?raffel_oauth_callback=1`
  const state = randomOAuthState()
  const authorization = new URL(flow.authorizationUrl)
  const popup = (win as any).open?.('', 'raffel-oauth', 'popup,width=540,height=720')
  if (!popup) {
    throw new Error('OAuth authorization requires popups so credentials can remain memory-only.')
  }
  authorization.searchParams.set('response_type', flowName === 'implicit' ? 'token' : 'code')
  authorization.searchParams.set('client_id', value('clientId'))
  authorization.searchParams.set('redirect_uri', redirectUri)
  authorization.searchParams.set('state', state)
  if (value('scopes')) authorization.searchParams.set('scope', value('scopes'))
  let codeVerifier: string | undefined
  if (flowName !== 'implicit') {
    codeVerifier = randomOAuthVerifier()
    const pkce = await oauthCodeChallenge(codeVerifier)
    authorization.searchParams.set('code_challenge', pkce.challenge)
    authorization.searchParams.set('code_challenge_method', pkce.method)
  }
  pendingOAuthMemory.set(state, {
    schemeName, flowName, state, redirectUri, tokenUrl: flow.tokenUrl,
    clientId: value('clientId'), clientSecret: value('clientSecret'), scopes: value('scopes'),
    codeVerifier,
  })
  if (typeof popup.location?.replace === 'function') popup.location.replace(authorization.toString())
  else popup.location = authorization.toString()
}

function appendOAuthFlowFields(form: any, schemeName: string, scheme: any, stored: Record<string, any>): void {
  Object.entries(scheme.flows ?? {}).forEach(([flowName, flow]: [string, any]) => {
    const fieldset = doc.createElement('fieldset')
    fieldset.className = 'auth-oauth-flow'
    fieldset.dataset.oauthFlow = flowName
    const legend = doc.createElement('legend')
    legend.textContent = oauthFlowLabel(flowName)
    fieldset.appendChild(legend)
    fieldset.appendChild(createAuthInput('clientId', 'Client ID', 'text', stored.clientId ?? ''))
    if (flowName !== 'implicit') fieldset.appendChild(createAuthInput('clientSecret', 'Client secret', 'password', stored.clientSecret ?? ''))
    if (flowName === 'password') {
      fieldset.appendChild(createAuthInput('username', 'Username'))
      fieldset.appendChild(createAuthInput('password', 'Password', 'password'))
    }
    fieldset.appendChild(createAuthInput('scopes', 'Scopes', 'text', stored.scopes ?? oauthScopeValue(flow)))
    const actions = doc.createElement('div')
    actions.className = 'auth-actions'
    const button = doc.createElement('button')
    button.type = 'button'
    const status = doc.createElement('span')
    status.className = 'auth-status'
    status.textContent = stored.accessToken ? 'Ready' : 'Not authenticated'
    if (flowName === 'clientCredentials' || flowName === 'password') {
      button.className = 'auth-oauth-token'
      button.textContent = 'Request token'
      button.onclick = () => { void requestOAuthToken(schemeName, flowName, flow, fieldset, status) }
    } else {
      button.className = 'auth-oauth-authorize'
      button.textContent = 'Authorize in popup'
      button.onclick = () => { void startOAuthAuthorization(schemeName, flowName, flow, fieldset) }
    }
    actions.appendChild(button)
    actions.appendChild(status)
    fieldset.appendChild(actions)
    form.appendChild(fieldset)
  })
}

function appendOidcFields(form: any, schemeName: string, scheme: any, stored: Record<string, any>): void {
  const fieldset = doc.createElement('fieldset')
  fieldset.className = 'auth-oauth-flow'
  fieldset.dataset.oauthFlow = 'oidc'
  const legend = doc.createElement('legend')
  legend.textContent = 'OpenID discovery'
  fieldset.appendChild(legend)
  fieldset.appendChild(createAuthInput('clientId', 'Client ID', 'text', stored.clientId ?? ''))
  fieldset.appendChild(createAuthInput('clientSecret', 'Client secret', 'password', stored.clientSecret ?? ''))
  fieldset.appendChild(createAuthInput('scopes', 'Scopes', 'text', stored.scopes ?? 'openid profile'))
  const actions = doc.createElement('div')
  actions.className = 'auth-actions'
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = 'auth-oidc-authorize'
  button.textContent = 'Discover and authorize'
  const status = doc.createElement('span')
  status.className = 'auth-status'
  status.textContent = stored.accessToken ? 'Ready' : 'Not authenticated'
  button.onclick = async () => {
    try {
      status.textContent = 'Loading discovery…'
      const response = await executeJsonHttpRequest(scheme.openIdConnectUrl)
      if (!response.ok) throw new Error('OpenID discovery failed.')
      const discovery = response.payload
      await startOAuthAuthorization(schemeName, 'authorizationCode', {
        authorizationUrl: discovery.authorization_endpoint,
        tokenUrl: discovery.token_endpoint,
        scopes: {},
      }, fieldset)
      status.textContent = 'Authorization opened'
    } catch (error) {
      status.textContent = String((error as Error)?.message ?? error)
      status.classList.add('auth-status-error')
    }
  }
  actions.appendChild(button)
  actions.appendChild(status)
  fieldset.appendChild(actions)
  form.appendChild(fieldset)
}

function oauthCallbackParams(): URLSearchParams | null {
  const query = new URLSearchParams(String(win.location?.search ?? ''))
  const fragment = new URLSearchParams(String(win.location?.hash ?? '').replace(/^#/, ''))
  if (query.has('code') || query.has('error')) return query
  if (fragment.has('access_token') || fragment.has('error')) return fragment
  return null
}

function findPendingOAuth(state: string | null): any | null {
  if (!state) return null
  const pending = pendingOAuthMemory.get(state)
  return pending ? { ...pending } : null
}

async function finishOAuthAuthorization(params: URLSearchParams): Promise<void> {
  const pending = findPendingOAuth(params.get('state'))
  if (!pending) return
  if (params.get('error')) throw new Error(params.get('error_description') || params.get('error') || 'Authorization failed.')
  let payload: any = Object.fromEntries(params.entries())
  if (!payload.access_token && params.get('code')) {
    if (!pending.tokenUrl) throw new Error('The authorization-code flow has no tokenUrl.')
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: String(params.get('code')),
      redirect_uri: pending.redirectUri,
      client_id: pending.clientId,
    })
    if (pending.codeVerifier) body.set('code_verifier', pending.codeVerifier)
    if (pending.clientSecret) body.set('client_secret', pending.clientSecret)
    const response = await executeJsonHttpRequest(pending.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    payload = response.payload
    if (!response.ok) throw new Error(payload?.error_description || payload?.error || 'Token exchange failed.')
  }
  if (!payload.access_token) throw new Error('The authorization response did not include an access token.')
  storeCredential(pending.schemeName, {
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token,
    expiresAt: Number(payload.expires_in) > 0 ? Date.now() + Number(payload.expires_in) * 1000 : undefined,
    tokenType: payload.token_type || 'Bearer',
    clientId: pending.clientId,
    clientSecret: pending.clientSecret,
    scopes: pending.scopes,
    tokenUrl: pending.tokenUrl,
  })
  pendingOAuthMemory.delete(pending.state)
  render()
}

function clearOAuthCallbackLocation(): void {
  const current = safeRuntimeUrl(String(win.location?.href ?? ''))
  if (!current) return
  ;['raffel_oauth_callback', 'code', 'state', 'error', 'error_description'].forEach(name => current.searchParams.delete(name))
  const fragment = new URLSearchParams(current.hash.replace(/^#/, ''))
  if (fragment.has('access_token') || fragment.has('error')) current.hash = ''
  win.history?.replaceState?.(null, '', `${current.pathname}${current.search}${current.hash}`)
}

function installOAuthCallback(): void {
  const params = oauthCallbackParams()
  if (params) {
    if ((win as any).opener && (win as any).opener !== win) {
      ;(win as any).opener.postMessage({ type: 'raffel-oauth-callback', params: params.toString() }, win.location?.origin)
      ;(win as any).close?.()
    } else {
      void finishOAuthAuthorization(params).catch(() => {}).finally(clearOAuthCallbackLocation)
    }
  }
  win.addEventListener?.('message', (event: any) => {
    if (event?.origin !== win.location?.origin || event?.data?.type !== 'raffel-oauth-callback') return
    void finishOAuthAuthorization(new URLSearchParams(String(event.data.params ?? ''))).catch(() => {})
  })
}

function securitySchemeNames(operation: any): string[] {
  const requirement = selectedSecurityRequirement(operation)
  return requirement && typeof requirement === 'object' ? Object.keys(requirement) : []
}

function substituteRefreshToken(value: unknown, refreshToken: string): unknown {
  if (value === '$refreshToken') return refreshToken
  if (Array.isArray(value)) return value.map(item => substituteRefreshToken(item, refreshToken))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, substituteRefreshToken(item, refreshToken)]))
  }
  return value
}

async function refreshCredential(schemeName: string): Promise<void> {
  const credential = readStoredCredential(schemeName)
  if (!credential.accessToken || !credential.refreshToken || !credential.expiresAt) return
  if (Number(credential.expiresAt) > Date.now() + 30_000) return
  const recipe = authenticationConfig?.schemes?.[schemeName]
  if (recipe?.strategy === 'operation' && recipe.refreshOperationId) {
    const operation = findHttpOperation(recipe.refreshOperationId)
    if (!operation) throw new Error(`Refresh operation ${recipe.refreshOperationId} was not found.`)
    const body = substituteRefreshToken(recipe.refreshRequestBody ?? { refreshToken: '$refreshToken' }, credential.refreshToken)
    const response = await executeJsonHttpRequest(`${httpBaseUrl()}${operation.path}`, {
      method: operation.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = response.payload
    if (!response.ok) throw new Error(payload?.message || `Token refresh failed with ${response.status}.`)
    const accessToken = readJsonPointer(payload, recipe.tokenPointers?.accessToken)
    if (!accessToken) throw new Error('The refreshed access-token JSON Pointer did not match the response.')
    storeCredential(schemeName, {
      ...credential,
      accessToken: String(accessToken),
      refreshToken: readJsonPointer(payload, recipe.tokenPointers?.refreshToken) ?? credential.refreshToken,
      expiresAt: tokenExpiry(payload, recipe.tokenPointers),
      tokenType: readJsonPointer(payload, recipe.tokenPointers?.tokenType) ?? credential.tokenType ?? 'Bearer',
    })
    return
  }
  const scheme = spec?.components?.securitySchemes?.[schemeName]
  if (scheme?.type === 'oauth2' || scheme?.type === 'openIdConnect') {
    const tokenUrl = credential.refreshUrl || credential.tokenUrl
    if (!tokenUrl) return
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credential.refreshToken })
    if (credential.clientId) body.set('client_id', credential.clientId)
    if (credential.clientSecret) body.set('client_secret', credential.clientSecret)
    const response = await executeJsonHttpRequest(tokenUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    })
    const payload = response.payload
    if (!response.ok || !payload.access_token) throw new Error(payload?.error_description || payload?.error || 'Token refresh failed.')
    storeCredential(schemeName, {
      ...credential,
      accessToken: String(payload.access_token),
      refreshToken: payload.refresh_token ?? credential.refreshToken,
      expiresAt: Number(payload.expires_in) > 0 ? Date.now() + Number(payload.expires_in) * 1000 : undefined,
      tokenType: payload.token_type ?? credential.tokenType ?? 'Bearer',
    })
  }
}

async function refreshCredentialsBeforeRequest(operation: any): Promise<void> {
  for (const schemeName of securitySchemeNames(operation)) await refreshCredential(schemeName)
}

function createAuthInput(name: string, labelText: string, type = 'text', value = ''): any {
  const label = doc.createElement('label')
  label.className = 'auth-field'
  const caption = doc.createElement('span')
  caption.className = 'auth-field-label'
  caption.textContent = labelText
  const input = doc.createElement('input')
  input.className = 'auth-input'
  input.name = name
  input.type = type
  input.autocomplete = type === 'password' ? 'off' : 'on'
  input.value = value
  label.appendChild(caption)
  label.appendChild(input)
  return label
}

function renderAuthenticationSection(): any | null {
  const schemes = spec?.components?.securitySchemes ?? {}
  if (!schemes || Object.keys(schemes).length === 0) return null
  const section = doc.createElement('section')
  section.className = 'authentication-section'
  section.id = 'authentication'
  const heading = doc.createElement('div')
  heading.className = 'authentication-header'
  heading.innerHTML = '<div><div class="subsection-label">AUTHENTICATION</div><h2>Authentication</h2><p>Credentials saved here are shared with every protected route in this environment.</p></div>'
  section.appendChild(heading)

  const cards = doc.createElement('div')
  cards.className = 'auth-schemes'
  Object.entries(schemes).forEach(([schemeName, scheme]: [string, any]) => {
    const card = doc.createElement('article')
    card.className = 'auth-scheme'
    card.dataset.scheme = schemeName
    const stored = readStoredCredential(schemeName)
    const title = doc.createElement('div')
    title.className = 'auth-scheme-title'
    title.innerHTML = `<strong>${esc(schemeName)}</strong><span>${esc(authSchemeKind(scheme))}</span>`
    card.appendChild(title)
    if (scheme.description) {
      const description = doc.createElement('p')
      description.className = 'auth-scheme-description'
      description.textContent = scheme.description
      card.appendChild(description)
    }
    const form = doc.createElement('div')
    form.className = 'auth-form'
    const recipe = authenticationConfig?.schemes?.[schemeName]
    if (recipe?.strategy === 'operation') {
      const operation = findHttpOperation(recipe.operationId)
      if (!operation) {
        const error = doc.createElement('div')
        error.className = 'auth-status auth-status-error'
        error.textContent = `Operation ${recipe.operationId} was not found.`
        form.appendChild(error)
      } else {
        const label = doc.createElement('label')
        label.className = 'auth-field'
        label.innerHTML = `<span class="auth-field-label">Request body · ${esc(operation.method)} ${esc(operation.path)}</span>`
        const textarea = doc.createElement('textarea')
        textarea.className = 'auth-operation-body'
        textarea.value = JSON.stringify(recipe.requestBody ?? operationRequestExample(operation.operation), null, 2)
        label.appendChild(textarea)
        form.appendChild(label)
        const actions = doc.createElement('div')
        actions.className = 'auth-actions'
        const requestToken = doc.createElement('button')
        requestToken.type = 'button'
        requestToken.className = 'auth-request-token'
        requestToken.textContent = stored.accessToken ? 'Request new token' : 'Request token'
        const status = doc.createElement('span')
        status.className = 'auth-status'
        status.textContent = stored.accessToken ? 'Ready' : 'Not authenticated'
        requestToken.onclick = () => { void requestOperationToken(schemeName, recipe, operation, textarea.value, status) }
        actions.appendChild(requestToken)
        actions.appendChild(status)
        form.appendChild(actions)
      }
    } else if (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'bearer') {
      form.appendChild(createAuthInput('accessToken', 'Bearer token', 'password', stored.accessToken ?? ''))
    } else if (scheme.type === 'http' && String(scheme.scheme).toLowerCase() === 'basic') {
      form.appendChild(createAuthInput('username', 'Username', 'text', stored.username ?? ''))
      form.appendChild(createAuthInput('password', 'Password', 'password', stored.password ?? ''))
    } else if (scheme.type === 'apiKey') {
      form.appendChild(createAuthInput('apiKey', scheme.name || 'API key', 'password', stored.apiKey ?? ''))
      const location = doc.createElement('div')
      location.className = 'auth-scheme-meta'
      location.textContent = `${scheme.in ?? 'header'} · ${scheme.name ?? schemeName}`
      form.appendChild(location)
    } else if (scheme.type === 'oauth2') {
      appendOAuthFlowFields(form, schemeName, scheme, stored)
    } else if (scheme.type === 'openIdConnect') {
      appendOidcFields(form, schemeName, scheme, stored)
    } else {
      const note = doc.createElement('div')
      note.className = 'auth-scheme-meta'
      note.textContent = 'This authentication method must be configured by the HTTP client.'
      form.appendChild(note)
    }
    if (!recipe && ['http', 'apiKey'].includes(scheme.type)) {
      const save = doc.createElement('button')
      save.type = 'button'
      save.className = 'auth-save'
      save.textContent = stored.accessToken || stored.apiKey || stored.username ? 'Update credential' : 'Use credential'
      const status = doc.createElement('span')
      status.className = 'auth-status'
      status.textContent = stored.accessToken || stored.apiKey || stored.username ? 'Ready' : 'Not configured'
      save.onclick = () => {
        const credential: Record<string, string> = {}
        form.querySelectorAll('input[name]').forEach((input: any) => { credential[input.name] = input.value })
        storeCredential(schemeName, credential)
        render()
      }
      const actions = doc.createElement('div')
      actions.className = 'auth-actions'
      actions.appendChild(save)
      actions.appendChild(status)
      form.appendChild(actions)
    }
    card.appendChild(form)
    cards.appendChild(card)
  })
  section.appendChild(cards)
  return section
}

function renderContent(): void {
  const main = byId('mainContent')
  if (!main) return
  main.textContent = ''
  const page = activePagePath ? getDocsPageViews().find(item => item.path === activePagePath) : null
  if (page) {
    const breadcrumb = renderDocsBreadcrumb(page)
    if (breadcrumb) main.appendChild(breadcrumb)
    const article = doc.createElement('article')
    article.className = 'docs-page markdown-content'
    article.innerHTML = parseMarkdown(getDocsPageMarkdown(page), page.path)
    injectEditLink(article, page)
    main.appendChild(article)
    renderDocsPagination(main, page)
    renderToc(main)
    scrollToActiveHeading()
    return
  }
  // The docs root (`/`) is ours to define — never a "not found". Only a
  // non-root path with no matching page is a genuine 404.
  const isRoot = !activePagePath || activePagePath === '/'
  if (activePagePath && !isRoot) {
    renderMissingDocsPage(main)
    renderToc(main)
    return
  }

  // Root landing: an OpenAPI-driven overview (title, version, servers,
  // description) followed by the endpoint list — unless the user is
  // mid-search, in which case the search results take the surface.
  if (!searchQuery) {
    main.appendChild(renderDocsOverview())
    const authentication = renderAuthenticationSection()
    if (authentication) main.appendChild(authentication)
    const webhooks = renderAsyncContracts('Webhooks', spec.webhooks ?? {})
    if (webhooks) main.appendChild(webhooks)
  }

  if (searchQuery) renderDocsSearch(main)
  const endpoints = getEndpointGroupsForProtocol(activeProtocol).flatMap(group => group.endpoints)
  for (const endpoint of endpoints) {
    const section = doc.createElement('section')
    section.className = 'endpoint-section'
    section.id = endpoint.id
    const endpointData = (endpoint.data ?? {}) as any
    const deprecated = endpointData.deprecated ? '<span class="endpoint-deprecated">Deprecated</span>' : ''
    section.innerHTML = `<div class="endpoint-header"><div><div class="endpoint-method-path"><span class="badge badge-${esc(endpoint.method.toLowerCase())}">${esc(endpoint.method)}</span><span class="endpoint-path">${esc(endpoint.path)}</span>${deprecated}</div><h2 class="endpoint-title">${esc(endpoint.summary ?? endpoint.path)}</h2>${endpoint.description ? `<div class="endpoint-description markdown-content">${parseMarkdown(endpoint.description)}</div>` : ''}</div></div>`
    section.appendChild(renderEndpointDetails(endpoint))
    main.appendChild(section)
  }
  renderToc(main)
}

function renderDocsOverview(): any {
  const info = (spec.info ?? {}) as Record<string, any>
  const container = doc.createElement('div')
  container.className = 'docs-overview'

  const title = String(info.title ?? 'API')
  const versionBadge = info.version
    ? `<span class="docs-overview-version">${esc(String(info.version))}</span>`
    : ''
  const header = doc.createElement('header')
  header.className = 'docs-overview-header'
  header.innerHTML = `<h1 class="docs-overview-title" id="overview">${esc(title)}${versionBadge}</h1>`
  container.appendChild(header)

  // Contact / license line (ReDoc-style).
  const contact = (info.contact ?? {}) as Record<string, any>
  const license = (info.license ?? {}) as Record<string, any>
  const metaBits: string[] = []
  if (contact.email) {
    const label = esc(String(contact.name ?? contact.email))
    metaBits.push(`E-mail: <a href="mailto:${esc(String(contact.email))}">${label}</a>`)
  }
  if (contact.url) {
    metaBits.push(`URL: <a href="${esc(String(contact.url))}" target="_blank" rel="noopener">${esc(String(contact.url))}</a>`)
  }
  if (license.name) {
    const lic = license.url
      ? `<a href="${esc(String(license.url))}" target="_blank" rel="noopener">${esc(String(license.name))}</a>`
      : esc(String(license.name))
    metaBits.push(`License: ${lic}`)
  }
  if (metaBits.length) {
    const meta = doc.createElement('div')
    meta.className = 'docs-overview-meta'
    meta.innerHTML = metaBits.join('<span class="docs-overview-meta-sep">·</span>')
    container.appendChild(meta)
  }

  // One compact environment control drives samples, authentication and Try It.
  const servers = Array.isArray(spec.servers) ? spec.servers : []
  if (servers.length) {
    const section = doc.createElement('section')
    section.className = 'docs-overview-servers'
    const label = doc.createElement('label')
    label.className = 'docs-overview-environment'
    label.innerHTML = `<span class="docs-overview-subtitle">${environments.length > 1 ? 'Environment' : 'Server'}</span>`
    const select = doc.createElement('select')
    select.className = 'docs-overview-environment-select'
    environments.forEach(environment => {
      const option = doc.createElement('option')
      option.value = environment.url
      option.textContent = environment.label
      if (environment.url === selectedEnvironmentUrl) option.setAttribute('selected', '')
      select.appendChild(option)
    })
    select.value = selectedEnvironmentUrl
    select.onchange = () => {
      selectedEnvironmentUrl = select.value
      win.localStorage?.setItem?.(environmentStorageKey, selectedEnvironmentUrl)
      render()
    }
    label.appendChild(select)
    section.appendChild(label)

    const current = selectedEnvironment()
    const url = doc.createElement('code')
    url.className = 'docs-overview-server-url'
    url.textContent = current?.url ?? ''
    section.appendChild(url)
    if (current && (current.description || Object.keys(current.variables).length > 0)) {
      const details = doc.createElement('details')
      details.className = 'docs-overview-server-details'
      const variables = Object.entries(current.variableDefinitions).map(([name, definition]: [string, any]) => {
        const allowed = Array.isArray(definition?.enum) && definition.enum.length > 0 ? `<span>allowed: ${esc(definition.enum.join(', '))}</span>` : ''
        const description = definition?.description ? `<span>${esc(definition.description)}</span>` : ''
        return `<li><code>${esc(name)}</code><span>current: ${esc(current.variables[name] ?? '')}</span><span>default: ${esc(definition?.default ?? '')}</span>${allowed}${description}</li>`
      }).join('')
      details.innerHTML = `<summary>${variables ? 'Server variables' : 'Details'}</summary>${current.description ? `<p>${esc(current.description)}</p>` : ''}${variables ? `<ul>${variables}</ul>` : ''}`
      section.appendChild(details)
    }
    container.appendChild(section)
  }

  // Description (markdown).
  if (info.description) {
    const description = doc.createElement('div')
    description.className = 'docs-overview-description markdown-content'
    description.innerHTML = parseMarkdown(String(info.description))
    container.appendChild(description)
  }

  return container
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

function getPageNavOptedOut(): Set<string> {
  const opted = new Set<string>()
  for (const path of pageNavConfig.hide ?? []) {
    if (path) opted.add(normalizeDocsPath(String(path)))
  }
  for (const raw of docsPages) {
    if (!raw?.path) continue
    const flag = String(parsePageFrontmatter(raw.markdown ?? '').data.pageNav ?? '').toLowerCase()
    if (flag === 'false' || flag === 'no' || flag === '0') opted.add(normalizeDocsPath(raw.path))
  }
  return opted
}

function renderDocsPagination(main: any, page: PageView): void {
  if (pageNavConfig.enabled === false) return
  const order = flattenReadingOrder(docsSidebar).map(entry => ({
    title: entry.title,
    path: normalizeDocsPath(entry.path),
  }))
  if (order.length < 2) return
  const optedOut = getPageNavOptedOut()
  if (optedOut.has(page.path)) return
  const neighbours = prevNext(page.path, order, optedOut)
  if (!neighbours.prev && !neighbours.next) return

  const nav = doc.createElement('nav')
  nav.className = 'page-nav-grid docs-pagination'
  nav.setAttribute('aria-label', 'Page navigation')

  if (neighbours.prev) nav.appendChild(pageNavCard(neighbours.prev, 'Previous', 'prev'))
  else nav.appendChild(doc.createElement('span'))

  if (neighbours.next) nav.appendChild(pageNavCard(neighbours.next, 'Next', 'next'))
  else nav.appendChild(doc.createElement('span'))

  main.appendChild(nav)
}

function pageNavCard(entry: PageNavEntry, label: string, direction: 'prev' | 'next'): any {
  const button = doc.createElement('button')
  button.type = 'button'
  button.className = `page-nav-card page-nav-card-${direction} docs-pagination-link docs-pagination-${direction === 'prev' ? 'previous' : 'next'}`
  button.innerHTML = `<span class="page-nav-eyebrow docs-pagination-label">${esc(label)}</span><span class="page-nav-title docs-pagination-title">${esc(entry.title)}</span>`
  button.onclick = () => setDocsPage(entry.path)
  return button
}

function setTocColumn(visible: boolean): void {
  const shell = doc.querySelector?.('.main-shell')
  if (shell) shell.classList.toggle('main-shell-no-toc', !visible)
}

function renderToc(root: any): void {
  const toc = byId('pageToc')
  if (!toc) return
  toc.textContent = ''
  if (tocConfig.enabled === false) { setTocColumn(false); return }
  if (root.querySelector?.('[data-markdown-ignore-all="true"]')) { setTocColumn(false); return }
  const min = Number(tocConfig.minLevel ?? 2)
  const max = Number(tocConfig.maxLevel ?? 3)
  const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? []).filter((heading: any) => {
    const level = Number(heading.tagName.slice(1))
    return heading.id && level >= min && level <= max && heading.dataset?.markdownIgnore !== 'true'
  }) as any[]
  if (headings.length === 0) { setTocColumn(false); return }
  setTocColumn(true)
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

function getDocsStateEndpoint(): string {
  const assetBase = String(docsAssetBasePath ?? '').replace(/\/+$/, '')
  const marker = '/-/assets'
  const markerIndex = assetBase.lastIndexOf(marker)
  if (markerIndex >= 0) {
    const base = assetBase.slice(0, markerIndex) || '/'
    return `${base === '/' ? '' : base}/state.json`
  }
  const pathname = String(win.location?.pathname ?? '/docs').replace(/\/+$/, '') || '/docs'
  return `${pathname}/state.json`
}

function docsSurfaceStatus(surface: DocsSurfaceState | undefined): 'fresh' | 'stale' | 'off' | 'unknown' {
  if (!surface) return 'unknown'
  if (!surface.enabled || !surface.mounted) return 'off'
  return surface.fresh === false ? 'stale' : 'fresh'
}

function docsSurfaceTitle(label: string, surface: DocsSurfaceState | undefined): string {
  if (!surface) return `${label}: state unavailable`
  const stale = Array.isArray(surface.staleReasons) && surface.staleReasons.length > 0
    ? `, stale reasons ${surface.staleReasons.join(', ')}`
    : ''
  return `${label}: enabled ${surface.enabled ? 'yes' : 'no'}, mounted ${surface.mounted ? 'yes' : 'no'}, fresh ${surface.fresh ? 'yes' : 'no'}${stale}`
}

function docsStateMeta(kind: 'api' | 'markdown', surface: DocsSurfaceState | undefined, changed: boolean): string {
  const status = docsSurfaceStatus(surface)
  if (status === 'unknown') return 'unknown'
  if (status === 'off') return surface?.enabled ? 'not mounted' : 'off'
  if (status === 'stale') return 'stale'
  if (kind === 'api' && typeof surface?.revision === 'number') return changed ? `r${surface.revision} updated` : `r${surface.revision}`
  const pages = Number(surface?.counts?.pages ?? 0)
  return pages > 0 ? `${pages} pages` : 'fresh'
}

function renderDocsStatePill(kind: 'api' | 'markdown', label: string, surface: DocsSurfaceState | undefined, changed = false): any {
  const pill = doc.createElement('span')
  const status = docsSurfaceStatus(surface)
  pill.className = 'docs-state-pill'
  pill.dataset.state = status
  if (changed) pill.dataset.updated = 'true'
  pill.title = docsSurfaceTitle(label === 'MD' ? 'Markdown Documentation' : 'API Documentation', surface)
  pill.innerHTML = `<span class="docs-state-dot" aria-hidden="true"></span><span class="docs-state-label">${esc(label)}</span><span class="docs-state-meta">${esc(docsStateMeta(kind, surface, changed))}</span>`
  return pill
}

function renderDocsStatePanel(): void {
  const panel = byId('docsStateSummary')
  if (!panel) return
  const state = docsStateSnapshot.state
  if (!state && !docsStateSnapshot.error) {
    panel.hidden = true
    return
  }

  panel.hidden = false
  panel.textContent = ''
  const apiChanged = docsStateSnapshot.apiRevisionChangedAt > 0 &&
    Date.now() - docsStateSnapshot.apiRevisionChangedAt < docsStateRevisionNoticeMs
  if (state) {
    panel.dataset.apiRevision = state.api?.revision == null ? '' : String(state.api.revision)
    panel.dataset.apiRevisionChanged = apiChanged ? 'true' : 'false'
    panel.appendChild(renderDocsStatePill('api', 'API', state.api, apiChanged))
    panel.appendChild(renderDocsStatePill('markdown', 'MD', state.markdown))
    return
  }

  panel.dataset.apiRevisionChanged = 'false'
  panel.appendChild(renderDocsStatePill('api', 'State', undefined))
}

async function fetchDocsState(): Promise<void> {
  const request = win.fetch ?? globalThis.fetch
  if (!request) return
  try {
    const response = await request(getDocsStateEndpoint(), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const next = await response.json() as DocsStatePayload
    const nextRevision = typeof next.api?.revision === 'number' ? next.api.revision : null
    const previousRevision = docsStateSnapshot.apiRevision
    docsStateSnapshot = {
      state: next,
      apiRevision: nextRevision,
      apiRevisionChangedAt: previousRevision !== null && nextRevision !== null && previousRevision !== nextRevision
        ? Date.now()
        : docsStateSnapshot.apiRevisionChangedAt,
      error: '',
    }
  } catch (error) {
    docsStateSnapshot = {
      ...docsStateSnapshot,
      state: null,
      error: error instanceof Error ? error.message : 'Unable to load docs state',
    }
  }
  renderDocsStatePanel()
}

function startDocsStatePolling(): void {
  void fetchDocsState()
  const schedule = win.setInterval ?? globalThis.setInterval
  schedule?.(() => {
    void fetchDocsState()
  }, docsStatePollMs)
}

/**
 * Lazy-load the Mermaid renderer the first time a page with diagrams is
 * visited. Cached: subsequent route transitions inside the SPA reuse the
 * same `<script>` injection. Pages without `.mermaid` blocks never trigger
 * the network request, so the ~3MB library stays off the critical path
 * for the 95% of docs pages that have no diagrams.
 */
function loadMermaidLibrary(src: string): Promise<any> {
  if (win.mermaid) return Promise.resolve(win.mermaid)
  if (mermaidLoadPromise) return mermaidLoadPromise
  mermaidLoadPromise = new Promise((resolve, reject) => {
    const script = doc.createElement('script')
    script.src = src
    script.defer = true
    script.onload = () => resolve(win.mermaid)
    script.onerror = () => {
      mermaidLoadPromise = null
      reject(new Error(`Failed to load Mermaid from ${src}`))
    }
    doc.head?.appendChild(script)
  })
  return mermaidLoadPromise
}

async function renderMermaidDiagrams(root: any = doc): Promise<void> {
  const diagrams = Array.from(root?.querySelectorAll?.('.mermaid:not([data-mermaid-rendered])') ?? []) as any[]
  if (diagrams.length === 0) return

  if (mermaidConfig.enabled === false) {
    diagrams.forEach(diagram => diagram.classList.add('mermaid-fallback'))
    return
  }

  let mermaid: any = win.mermaid
  if (!mermaid) {
    try {
      mermaid = await loadMermaidLibrary(mermaidConfig.src)
    } catch (error) {
      diagrams.forEach(diagram => {
        diagram.classList.add('mermaid-fallback', 'mermaid-error')
        diagram.setAttribute('title', error instanceof Error ? error.message : 'Unable to load Mermaid')
      })
      return
    }
  }

  mermaid.initialize?.({ startOnLoad: false, securityLevel: 'strict' })
  diagrams.forEach((diagram, index) => {
    const source = diagram.getAttribute('data-mermaid-source') || diagram.textContent || ''
    const id = `raffel-mermaid-${Date.now()}-${index}`
    Promise.resolve(mermaid.render(id, source))
      .then((result: any) => {
        const safeSvg = parseMermaidSvg(typeof result === 'string' ? result : result.svg)
        if (!safeSvg) throw new Error('Mermaid returned invalid SVG output.')
        diagram.replaceChildren(safeSvg)
        result?.bindFunctions?.(diagram)
        diagram.dataset.mermaidRendered = 'true'
        diagram.classList.remove('mermaid-fallback', 'mermaid-error')
        if (mermaidConfig.viewer !== false) mountMermaidViewer(diagram)
      })
      .catch((error: unknown) => {
        diagram.dataset.mermaidRendered = 'error'
        diagram.classList.add('mermaid-error')
        diagram.setAttribute('title', error instanceof Error ? error.message : 'Unable to render Mermaid diagram')
      })
  })
}

function parseMermaidSvg(markup: unknown): any | null {
  const Parser = (win as any).DOMParser
  if (typeof Parser !== 'function') return null
  const parsed = new Parser().parseFromString(String(markup ?? ''), 'image/svg+xml')
  const svg = parsed?.documentElement
  if (!svg || String(svg.localName).toLowerCase() !== 'svg') return null
  svg.querySelectorAll?.('script, foreignObject, iframe, object, embed, link')?.forEach((node: any) => node.remove())
  ;[svg, ...Array.from(svg.querySelectorAll?.('*') ?? [])].forEach((element: any) => {
    for (const attribute of Array.from(element.attributes ?? []) as any[]) {
      const name = String(attribute.name).toLowerCase()
      const value = String(attribute.value).trim().toLowerCase()
      if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && !value.startsWith('#'))) {
        element.removeAttribute(attribute.name)
      }
    }
  })
  return doc.importNode?.(svg, true) ?? svg.cloneNode(true)
}

/**
 * Wrap a freshly rendered Mermaid SVG in a viewer overlay:
 *   • toolbar (zoom in/out/reset/fullscreen) — fades in on hover
 *   • drag-to-pan when zoomed in (scale > 1)
 *   • wheel-zoom with Ctrl/⌘ pressed (so vertical scroll still works normally)
 *   • fullscreen via <dialog>, with same controls
 *
 * Idempotent: skips diagrams already wrapped (data-mermaid-viewer-mounted).
 */
function mountMermaidViewer(diagram: any): void {
  if (diagram.dataset.mermaidViewerMounted) return
  const svg = diagram.querySelector?.('svg')
  if (!svg) return

  const viewport = doc.createElement('div')
  viewport.className = 'mermaid-viewport'
  diagram.insertBefore(viewport, svg)
  viewport.appendChild(svg)

  const toolbar = doc.createElement('div')
  toolbar.className = 'mermaid-toolbar'
  toolbar.innerHTML = [
    '<button class="mermaid-btn" data-mermaid-action="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>',
    '<button class="mermaid-btn" data-mermaid-action="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>',
    '<button class="mermaid-btn" data-mermaid-action="reset" aria-label="Reset view" title="Reset view">⟲</button>',
    '<button class="mermaid-btn" data-mermaid-action="fullscreen" aria-label="Open fullscreen" title="Fullscreen">⛶</button>',
  ].join('')
  diagram.appendChild(toolbar)

  const state = { scale: 1, tx: 0, ty: 0 }
  function apply(): void {
    svg.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`
    svg.style.transformOrigin = 'center center'
    svg.style.transition = 'transform 0.18s cubic-bezier(0.16, 1, 0.3, 1)'
    viewport.style.cursor = state.scale > 1 ? 'grab' : ''
  }
  function reset(): void { state.scale = 1; state.tx = 0; state.ty = 0; apply() }
  function zoomBy(factor: number): void {
    state.scale = Math.max(0.5, Math.min(state.scale * factor, 8))
    if (state.scale === 1) { state.tx = 0; state.ty = 0 }
    apply()
  }

  toolbar.addEventListener('click', (ev: any) => {
    const action = ev.target?.dataset?.mermaidAction
    if (action === 'zoom-in') zoomBy(1.25)
    else if (action === 'zoom-out') zoomBy(1 / 1.25)
    else if (action === 'reset') reset()
    else if (action === 'fullscreen') openMermaidFullscreen(svg.cloneNode(true) as any)
  })

  let panning = false; let panStartX = 0; let panStartY = 0; let panStartTx = 0; let panStartTy = 0
  viewport.addEventListener('mousedown', (ev: any) => {
    if (ev.button !== 0 || state.scale <= 1) return
    panning = true
    panStartX = ev.clientX; panStartY = ev.clientY
    panStartTx = state.tx; panStartTy = state.ty
    viewport.style.cursor = 'grabbing'
    ev.preventDefault()
  })
  doc.addEventListener('mousemove', (ev: any) => {
    if (!panning) return
    state.tx = panStartTx + (ev.clientX - panStartX)
    state.ty = panStartTy + (ev.clientY - panStartY)
    svg.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`
  })
  doc.addEventListener('mouseup', () => {
    if (!panning) return
    panning = false
    viewport.style.cursor = state.scale > 1 ? 'grab' : ''
  })

  viewport.addEventListener('wheel', (ev: any) => {
    if (!ev.ctrlKey && !ev.metaKey) return
    ev.preventDefault()
    zoomBy(ev.deltaY < 0 ? 1.1 : 1 / 1.1)
  })

  diagram.dataset.mermaidViewerMounted = 'true'
}

function openMermaidFullscreen(svg: any): void {
  const dialog = doc.createElement('dialog')
  dialog.className = 'mermaid-fullscreen-dialog'

  const close = doc.createElement('button')
  close.className = 'mermaid-fullscreen-close'
  close.setAttribute('aria-label', 'Close')
  close.textContent = '✕'
  close.addEventListener('click', () => dialog.close())

  const stage = doc.createElement('div')
  stage.className = 'mermaid-fullscreen-stage'
  svg.removeAttribute('style')
  stage.appendChild(svg)

  const fsState = { scale: 1, tx: 0, ty: 0 }
  function fsApply(): void {
    svg.style.transform = `translate(${fsState.tx}px, ${fsState.ty}px) scale(${fsState.scale})`
    svg.style.transformOrigin = 'center center'
    stage.style.cursor = fsState.scale > 1 ? 'grab' : ''
  }
  function fsZoom(factor: number): void {
    fsState.scale = Math.max(0.5, Math.min(fsState.scale * factor, 8))
    if (fsState.scale === 1) { fsState.tx = 0; fsState.ty = 0 }
    fsApply()
  }

  const toolbar = doc.createElement('div')
  toolbar.className = 'mermaid-toolbar mermaid-toolbar-fullscreen'
  toolbar.innerHTML = [
    '<button class="mermaid-btn" data-mermaid-action="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>',
    '<button class="mermaid-btn" data-mermaid-action="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>',
    '<button class="mermaid-btn" data-mermaid-action="reset" aria-label="Reset view" title="Reset view">⟲</button>',
  ].join('')
  toolbar.addEventListener('click', (ev: any) => {
    const action = ev.target?.dataset?.mermaidAction
    if (action === 'zoom-in') fsZoom(1.25)
    else if (action === 'zoom-out') fsZoom(1 / 1.25)
    else if (action === 'reset') { fsState.scale = 1; fsState.tx = 0; fsState.ty = 0; fsApply() }
  })

  let fsPan = false; let fsStartX = 0; let fsStartY = 0; let fsStartTx = 0; let fsStartTy = 0
  stage.addEventListener('mousedown', (ev: any) => {
    if (ev.button !== 0 || fsState.scale <= 1) return
    fsPan = true
    fsStartX = ev.clientX; fsStartY = ev.clientY
    fsStartTx = fsState.tx; fsStartTy = fsState.ty
    stage.style.cursor = 'grabbing'
    ev.preventDefault()
  })
  doc.addEventListener('mousemove', (ev: any) => {
    if (!fsPan) return
    fsState.tx = fsStartTx + (ev.clientX - fsStartX)
    fsState.ty = fsStartTy + (ev.clientY - fsStartY)
    fsApply()
  })
  doc.addEventListener('mouseup', () => {
    if (!fsPan) return
    fsPan = false
    stage.style.cursor = fsState.scale > 1 ? 'grab' : ''
  })
  stage.addEventListener('wheel', (ev: any) => {
    ev.preventDefault()
    fsZoom(ev.deltaY < 0 ? 1.1 : 1 / 1.1)
  })

  dialog.appendChild(close)
  dialog.appendChild(toolbar)
  dialog.appendChild(stage)
  doc.body.appendChild(dialog)
  dialog.addEventListener('close', () => { try { doc.body.removeChild(dialog) } catch {} })
  dialog.addEventListener('keydown', (ev: any) => {
    if (ev.key === 'Escape') dialog.close()
  })
  dialog.showModal?.()
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
    const hasConfiguredTheme = root.getAttribute('data-theme-configured') === 'true'
    const next = current === 'auto' ? 'dark' : current === 'dark' ? 'light' : hasConfiguredTheme ? 'auto' : current === 'light' ? 'custom' : 'auto'
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
  enhanceCodeBlockToolbars(byId('mainContent'), { document: doc, navigator: win.navigator })
  renderMermaidDiagrams()
  mountDocsComponents(byId('mainContent'))
  runVoidHook('afterRender', getPluginContext())
}

function init(): void {
  if (!doc) return
  const storedTheme = win.localStorage?.getItem?.(themeStorageKey)
  const configuredTheme = doc.documentElement.getAttribute('data-theme-configured') === 'true'
  if (storedTheme === 'auto' || storedTheme === 'dark' || storedTheme === 'light' || (!configuredTheme && storedTheme === 'custom')) doc.documentElement.setAttribute('data-theme', storedTheme)
  installOAuthCallback()
  installDocsPluginApi()
  if (activePagePath && activePagePath !== routeState.pagePath) {
    win.history?.replaceState?.(null, '', routeToHash(activePagePath, activeHeadingId))
  }
  const intro = byId('introductionContent')
  if (intro && introductionMarkdown) intro.innerHTML = parseMarkdown(introductionMarkdown)
  initSidebarResize()
  bindEvents()
  renderFooter()
  render()
  startDocsStatePolling()
  // Mount cmd+K / ctrl+K search modal (skipped when sidebar search is disabled).
  // Dispose any previously-mounted modal so a re-initialised runtime never
  // leaves a duplicate dialog or a stale keydown listener behind.
  win.RaffelDocs?.searchModal?.dispose?.()
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
