/**
 * Raffel docs browser runtime.
 *
 * This file is intentionally normal browser TypeScript, not a server-side
 * string template. The build step emits it to dist/docs/ui/assets.
 */

type DocsPage = {
  title?: string
  path?: string
  markdown?: string
  description?: string
  section?: string
  order?: number
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

const win = globalThis as unknown as {
  document?: any
  location?: any
  history?: any
  scrollTo?: (options: unknown) => void
  addEventListener?: (...args: unknown[]) => void
  navigator?: any
  __RAFFEL_DOCS__?: any
}

const doc = win.document
const data = win.__RAFFEL_DOCS__ ?? {}
const spec = data.spec ?? { info: { title: 'API', version: '1.0.0' }, paths: {} }
const tagGroups = data.tagGroups ?? []
const sidebarConfig = data.sidebarConfig ?? {}
const introductionMarkdown = data.introductionMarkdown ?? null
const docsPages = Array.isArray(data.docsPages) ? data.docsPages as DocsPage[] : []
const searchIndex = Array.isArray(data.searchIndex) ? data.searchIndex as SearchIndexEntry[] : []
const footerMarkdown = data.footerMarkdown ?? null
const tocConfig = data.tocConfig ?? {}

const xUsd = spec['x-usd'] ?? {}
const protocolData = detectProtocols()
const protocols = Object.keys(protocolData)
let activeProtocol = protocols[0] ?? 'http'
let searchQuery = ''
let routeState = parseRouteHash()
let activePagePath = routeState.pagePath
let activeHeadingId = routeState.headingId

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

function isSafeUrl(url: unknown): boolean {
  return !/^\s*(?:javascript|data|vbscript):/i.test(String(url ?? ''))
}

function normalizeDocsPath(path: unknown): string {
  const raw = String(path ?? '').trim()
  if (!raw) return ''
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withSlash.replace(/\/+$/, '') || '/'
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
  if (!base.endsWith('/')) baseParts.pop()
  const inputParts = pathPart.split('/').filter(Boolean)
  const parts = pathPart.startsWith('/') ? [] : baseParts
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

function parseInlineMarkdown(value: unknown, currentPath?: string): string {
  const codeTokens: string[] = []
  let text = String(value ?? '').replace(/`([^`]+)`/g, (_match, code) => {
    const token = `\u0000INLINE_CODE_${codeTokens.length}\u0000`
    codeTokens.push(`<code class="md-inline-code">${esc(code)}</code>`)
    return token
  })

  text = esc(text)
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (match, alt, url, title) => {
    if (!isSafeUrl(url)) return match
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
    return `<img class="md-image" src="${escapeAttr(url)}" alt="${escapeAttr(alt)}"${titleAttr}>`
  })
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]+)")?\)/g, (_match, label, href, title) => {
    const resolved = resolveMarkdownHref(href, currentPath)
    if (!resolved) return esc(label)
    const external = resolved.external ? ' target="_blank" rel="noopener noreferrer"' : ''
    const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
    return `<a href="${escapeAttr(resolved.href)}"${external}${titleAttr}>${label}</a>`
  })
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  text = text.replace(/_([^_]+)_/g, '<em>$1</em>')
  codeTokens.forEach((html, index) => {
    text = text.replace(`\u0000INLINE_CODE_${index}\u0000`, html)
  })
  return text
}

function parseMarkdown(markdown: unknown, currentPath?: string): string {
  const source = String(markdown ?? '').replace(/\r\n?/g, '\n')
  const lines = source.split('\n')
  const html: string[] = []
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

    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim() || 'text'
      const code: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      if (lang === 'mermaid') {
        html.push(`<div class="mermaid">${esc(code.join('\n'))}</div>`)
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
      const title = heading[2].replace(/\s+#+$/, '').trim()
      const id = slugifyHeading(title)
      const href = activePagePath ? routeToHash(activePagePath, id) : `#${id}`
      html.push(`<h${level} class="md-h${level}" id="${escapeAttr(id)}"><a class="heading-anchor" href="${escapeAttr(href)}">#</a>${parseInlineMarkdown(title, currentPath)}</h${level}>`)
      index += 1
      continue
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      html.push('<hr class="md-hr">')
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

  return html.join('\n')
}

function renderAlert(lines: string[], currentPath?: string): string | null {
  const first = lines[0] ?? ''
  const match = first.match(/^\[!(NOTE|TIP|WARNING|DANGER|INFO)\]\s*(.*)$/i)
  if (!match) return null
  const kind = match[1].toLowerCase()
  const title = match[2] || `${match[1].charAt(0).toUpperCase()}${match[1].slice(1).toLowerCase()}`
  return `<aside class="md-alert md-alert-${escapeAttr(kind)}"><div class="md-alert-title">${esc(title)}</div><div class="md-alert-body">${parseMarkdown(lines.slice(1).join('\n'), currentPath)}</div></aside>`
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
  if (xUsd.websocket?.channels) out.websocket = Object.keys(xUsd.websocket.channels).length
  if (xUsd.streams?.endpoints) out.streams = Object.keys(xUsd.streams.endpoints).length
  if (xUsd.jsonrpc?.methods) out.jsonrpc = Object.keys(xUsd.jsonrpc.methods).length
  if (xUsd.grpc?.services) {
    out.grpc = Object.values(xUsd.grpc.services).reduce((sum: number, service: any) => sum + Object.keys(service.methods ?? {}).length, 0)
  }
  if (xUsd.tcp?.servers) out.tcp = Object.keys(xUsd.tcp.servers).length
  if (xUsd.udp?.endpoints) out.udp = Object.keys(xUsd.udp.endpoints).length
  return out
}

function getEndpointsForProtocol(protocol: string): Endpoint[] {
  const endpoints: Endpoint[] = []
  let id = 0
  if (protocol === 'http' && spec.paths) {
    for (const [path, methods] of Object.entries(spec.paths) as Array<[string, any]>) {
      for (const [method, operation] of Object.entries(methods ?? {}) as Array<[string, any]>) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
        endpoints.push({
          id: `ep-${id++}`,
          path,
          method: method.toUpperCase(),
          summary: operation.summary,
          description: operation.description,
          tags: operation.tags ?? [],
          data: operation,
        })
      }
    }
  }
  return endpoints
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
      render()
    }
    container.appendChild(button)
  }
}

function setDocsPage(path: unknown, headingId = ''): void {
  activePagePath = normalizeDocsPath(path)
  activeHeadingId = headingId
  win.history?.replaceState?.(null, '', routeToHash(activePagePath, activeHeadingId))
  if (!activeHeadingId) win.scrollTo?.({ top: 0, behavior: 'smooth' })
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
      onClick: () => setDocsPage(page.path),
    })))
  }
}

function appendSidebarGroup(nav: any, title: string, items: Array<{ active: boolean, label: string, prefix?: string, onClick: () => void }>): void {
  const group = doc.createElement('div')
  group.className = 'tag-group'
  const header = doc.createElement('div')
  header.className = 'tag-group-header'
  header.innerHTML = `<span class="tag-group-arrow">▼</span>${esc(title)}<span class="tag-group-count">${items.length}</span>`
  header.onclick = () => group.classList.toggle('collapsed')
  const itemContainer = doc.createElement('div')
  itemContainer.className = 'tag-group-items'
  itemContainer.style.maxHeight = `${items.length * 50}px`
  for (const item of items) {
    const el = doc.createElement('div')
    el.className = `nav-item${item.active ? ' active' : ''}`
    el.innerHTML = `${item.prefix ? `<span class="nav-item-method method-${esc(item.prefix.toLowerCase())}">${esc(item.prefix)}</span>` : ''}<span class="nav-item-path">${esc(item.label)}</span>`
    el.onclick = (event: any) => {
      event.stopPropagation()
      item.onClick()
    }
    itemContainer.appendChild(el)
  }
  group.appendChild(header)
  group.appendChild(itemContainer)
  nav.appendChild(group)
}

function renderContent(): void {
  const main = byId('mainContent')
  if (!main) return
  main.textContent = ''
  const page = activePagePath ? getDocsPageViews().find(item => item.path === activePagePath) : null
  if (page) {
    const article = doc.createElement('article')
    article.className = 'docs-page markdown-content'
    article.innerHTML = parseMarkdown(page.markdown, page.path)
    main.appendChild(article)
    renderDocsPagination(main, page)
    renderToc(main)
    scrollToActiveHeading()
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
    main.appendChild(section)
  }
  renderToc(main)
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
    return getDocsPageViews()
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
  }

  const terms = query.split(/\s+/).filter(Boolean)
  return searchIndex
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
}

function scoreSearchEntry(entry: SearchIndexEntry, terms: string[]): number {
  const title = String(entry.title ?? '').toLowerCase()
  const section = String(entry.section ?? '').toLowerCase()
  const text = String(entry.text ?? '').toLowerCase()
  let score = 0
  for (const term of terms) {
    if (title === term) score += 80
    if (title.includes(term)) score += 40
    if (section.includes(term)) score += 10
    if (text.includes(term)) score += 5
  }
  return score
}

function highlightSearchExcerpt(excerpt: string): string {
  const query = searchQuery.trim()
  if (!query) return esc(excerpt)
  const escaped = esc(excerpt)
  const terms = query.split(/\s+/).filter(Boolean).map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (terms.length === 0) return escaped
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
  const min = Number(tocConfig.minLevel ?? 2)
  const max = Number(tocConfig.maxLevel ?? 3)
  const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6') ?? []).filter((heading: any) => {
    const level = Number(heading.tagName.slice(1))
    return heading.id && level >= min && level <= max
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

function bindEvents(): void {
  byId('searchInput')?.addEventListener('input', (event: any) => {
    searchQuery = String(event.target?.value ?? '').toLowerCase()
    render()
  })
  byId('themeToggle')?.addEventListener('click', () => {
    const root = doc.documentElement
    const current = root.getAttribute('data-theme') || 'auto'
    root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark')
  })
  byId('backToTop')?.addEventListener('click', () => win.scrollTo?.({ top: 0, behavior: 'smooth' }))
  win.addEventListener?.('hashchange', () => {
    routeState = parseRouteHash()
    activePagePath = routeState.pagePath
    activeHeadingId = routeState.headingId
    render()
  })
  doc?.addEventListener?.('click', (event: any) => {
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
      return
    }

    const copyButton = event.target?.closest?.('.copy-code-btn')
    if (!copyButton) return
    const code = copyButton.closest('.md-code-wrap')?.querySelector?.('code')
    const text = code?.textContent ?? ''
    win.navigator?.clipboard?.writeText?.(text)
    copyButton.textContent = 'Copied'
    setTimeout(() => { copyButton.textContent = 'Copy' }, 1500)
  })
}

function render(): void {
  renderProtocolTabs()
  renderSidebar()
  renderContent()
}

function init(): void {
  if (!doc) return
  const intro = byId('introductionContent')
  if (intro && introductionMarkdown) intro.innerHTML = parseMarkdown(introductionMarkdown)
  bindEvents()
  renderFooter()
  render()
}

init()

export {}
