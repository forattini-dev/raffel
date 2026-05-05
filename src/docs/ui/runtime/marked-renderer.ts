type MarkedDeps = {
  win: { marked?: any; document?: any }
  markdownConfig: any
  activePagePath: () => string
  esc: (value: unknown) => string
  escapeAttr: (value: unknown) => string
  renderEmojiShorthand: (value: string) => string
  parseMarkdown: (markdown: unknown, currentPath?: string) => string
  parseMarkdownAttributes: (text: string) => any
  parseMarkdownDestination: (value: unknown) => { href: string, attrs: any } | null
  renderMarkdownAttributeString: (attrs: any, kind: 'link' | 'image') => string
  resolveMarkdownHref: (href: unknown, currentPath?: string) => { href: string, external: boolean } | null
  resolveMarkdownAssetHref: (href: unknown, currentPath?: string) => string | null
  getExternalLinkTarget: () => string
  getExternalLinkRel: (target: string) => string
  isNoCompileLink: (href: string) => boolean
  parseHeadingTitle: (value: string) => { title: string, id: string, customId: boolean, ignore: boolean, ignoreAll: boolean }
  uniqueHeadingId: (id: string, customId: boolean, seen: Map<string, number>) => string
  routeToHash: (path: string, headingId?: string) => string
  parseComponentFence: (lang: string, body: string) => { name: string, props: string } | null
  renderAlert: (lines: string[], currentPath?: string) => string | null
}

export function renderMarkedMarkdown(
  source: string,
  currentPath: string | undefined,
  deps: MarkedDeps
): string | null {
  const root = deps.win.marked
  const api = root?.Marked ? root : root?.marked
  if (!api?.Marked || !api?.parse) return null

  const blockTokens: string[] = []
  const markedSource = protectTabBlocks(source, blockTokens, currentPath, deps)
  const seenHeadingIds = new Map<string, number>()
  const renderer = buildRenderer(currentPath, seenHeadingIds, deps)
  try {
    const instance = new api.Marked({ gfm: true, async: false, renderer })
    const html = instance.parse(markedSource, { async: false })
    deps.win.document?.documentElement?.setAttribute?.('data-markdown-engine', 'marked')
    return restoreBlockTokens(String(html), blockTokens)
  } catch {
    return null
  }
}

function protectTabBlocks(source: string, blockTokens: string[], currentPath: string | undefined, deps: MarkedDeps): string {
  return source.replace(/<!-- tabs:start -->[\s\S]*?<!-- tabs:end -->/g, (block) => {
    const tabs: Array<{ title: string, lines: string[] }> = []
    let current: { title: string, lines: string[] } | null = null
    for (const rawLine of block.split(/\r?\n/).slice(1, -1)) {
      const heading = rawLine.trim().match(/^####\s+(.+)$/)
      if (heading) {
        if (current) tabs.push(current)
        current = { title: heading[1].replace(/^\*\*|\*\*$/g, '').trim(), lines: [] }
      } else current?.lines.push(rawLine)
    }
    if (current) tabs.push(current)
    const buttons = tabs.map((tab, index) => `<button type="button" class="md-tab-button${index === 0 ? ' active' : ''}" data-tab-index="${index}">${deps.esc(tab.title || `Tab ${index + 1}`)}</button>`).join('')
    const panels = tabs.map((tab, index) => `<div class="md-tab-panel${index === 0 ? ' active' : ''}" data-tab-index="${index}">${deps.parseMarkdown(tab.lines.join('\n'), currentPath)}</div>`).join('')
    const token = `<raffel-block-token data-index="${blockTokens.length}"></raffel-block-token>`
    blockTokens.push(`<div class="md-tabs"><div class="md-tab-list" role="tablist">${buttons}</div>${panels}</div>`)
    return token
  })
}

function restoreBlockTokens(html: string, blockTokens: string[]): string {
  return html
    .replace(/<raffel-block-token data-index="(\d+)"><\/raffel-block-token>/g, (_match, index) => blockTokens[Number(index)] ?? '')
    .replace(/(?:<p class="md-p">)?&lt;raffel-block-token data-index=(?:"|&quot;)(\d+)(?:"|&quot;)&gt;&lt;\/raffel-block-token&gt;(?:<\/p>)?/g, (_match, index) => blockTokens[Number(index)] ?? '')
}

function buildRenderer(currentPath: string | undefined, seenHeadingIds: Map<string, number>, deps: MarkedDeps): Record<string, (...args: any[]) => string> {
  const inline = (ctx: any, tokens: unknown[]) => ctx.parser.parseInline(tokens)
  const renderLink = (ctx: any, href: string, title: string | null | undefined, tokens: unknown[]) => {
    const attrs = title?.trim().startsWith(':') ? deps.parseMarkdownAttributes(title) : { title: title || undefined, classes: [] }
    if ((attrs.ignore || deps.isNoCompileLink(href)) && !isSafeMarkedUrl(href)) return inline(ctx, tokens)
    const resolved = attrs.ignore || deps.isNoCompileLink(href) ? { href, external: /^(?:https?:)?\/\//i.test(href) } : deps.resolveMarkdownHref(href, currentPath)
    if (!resolved) return inline(ctx, tokens)
    const target = attrs.target ?? (resolved.external ? deps.getExternalLinkTarget() : '')
    const rel = deps.getExternalLinkRel(target)
    const disabledAttrs = attrs.disabled ? ' aria-disabled="true" tabindex="-1"' : ''
    const classes = attrs.disabled ? ['markdown-disabled', ...attrs.classes] : attrs.classes
    const attrText = deps.renderMarkdownAttributeString({ ...attrs, classes }, 'link')
    return `<a href="${deps.escapeAttr(resolved.href)}"${target ? ` target="${deps.escapeAttr(target)}"` : ''}${rel ? ` rel="${deps.escapeAttr(rel)}"` : ''}${disabledAttrs}${attrText}>${inline(ctx, tokens)}</a>`
  }

  return {
    heading(this: any, token: any) {
      const parsed = deps.parseHeadingTitle(token.text)
      const id = deps.uniqueHeadingId(parsed.id, parsed.customId, seenHeadingIds)
      const href = deps.activePagePath() ? deps.routeToHash(deps.activePagePath(), id) : `#${id}`
      const ignored = `${parsed.ignore ? ' data-markdown-ignore="true"' : ''}${parsed.ignoreAll ? ' data-markdown-ignore-all="true"' : ''}`
      return `<h${token.depth} class="md-h${token.depth}" id="${deps.escapeAttr(id)}"${ignored}><a class="heading-anchor" href="${deps.escapeAttr(href)}">#</a>${deps.parseMarkdown(parsed.title, currentPath).replace(/^<p class="md-p">|<\/p>\n?$/g, '')}</h${token.depth}>`
    },
    paragraph(this: any, token: any) { return `<p class="md-p">${inline(this, token.tokens)}</p>` },
    list(this: any, token: any) { const tag = token.ordered ? 'ol' : 'ul'; return `<${tag} class="md-list">${token.items.map((item: any) => this.listitem(item)).join('')}</${tag}>` },
    listitem(this: any, item: any) { return `<li>${item.task ? `<input type="checkbox" disabled${item.checked ? ' checked' : ''}> ` : ''}${this.parser.parse(item.tokens)}</li>` },
    codespan(token: any) { return `<code class="md-inline-code">${deps.esc(token.text)}</code>` },
    code(token: any) {
      const lang = String(token.lang ?? '').trim() || 'text'
      const component = deps.parseComponentFence(lang, token.text)
      if (component) return `<div class="docs-component-mount svelte-component-mount" data-raffel-component="${deps.escapeAttr(component.name)}" data-props="${deps.escapeAttr(component.props)}"></div>`
      if (lang === 'mermaid') return `<div class="mermaid" data-mermaid-source="${deps.escapeAttr(token.text)}">${deps.esc(token.text)}</div>`
      return `<div class="md-code-wrap"><button type="button" class="copy-code-btn">Copy</button><pre class="md-code-block"><code class="language-${deps.escapeAttr(lang)}">${deps.esc(token.text)}</code></pre></div>`
    },
    blockquote(this: any, token: any) {
      const alert = deps.renderAlert(String(token.text ?? '').split(/\r?\n/), currentPath)
      return alert ?? `<blockquote class="md-blockquote">${this.parser.parse(token.tokens)}</blockquote>`
    },
    html(token: any) {
      if (/^<raffel-block-token data-index="\d+"><\/raffel-block-token>$/.test(token.text)) return token.text
      return deps.markdownConfig.html === 'raw' ? token.text : deps.esc(token.text)
    },
    hr() { return '<hr class="md-hr">' },
    table(this: any, token: any) {
      const cells = (row: any[]) => row.map(cell => `<${cell.header ? 'th' : 'td'}>${inline(this, cell.tokens)}</${cell.header ? 'th' : 'td'}>`).join('')
      return `<table class="md-table"><thead><tr>${cells(token.header)}</tr></thead><tbody>${token.rows.map((row: any[]) => `<tr>${cells(row)}</tr>`).join('')}</tbody></table>`
    },
    link(this: any, token: any) { return renderLink(this, token.href, token.title, token.tokens) },
    image(token: any) {
      const parsed = deps.parseMarkdownDestination(`${token.href}${token.title ? ` "${token.title}"` : ''}`)
      const resolved = parsed ? deps.resolveMarkdownAssetHref(parsed.href, currentPath) : null
      if (!parsed || !resolved) return deps.esc(token.text)
      const attrs = deps.renderMarkdownAttributeString(parsed.attrs, 'image')
      const classAttr = parsed.attrs.classes.length > 0 ? '' : ' class="md-image"'
      return `<img${classAttr} src="${deps.escapeAttr(resolved)}" alt="${deps.escapeAttr(token.text)}"${attrs}>`
    },
    text(token: any) { return deps.renderEmojiShorthand(deps.esc(token.text)) },
  }
}

function isSafeMarkedUrl(url: unknown): boolean {
  return !/^\s*(?:javascript|data|vbscript):/i.test(String(url ?? ''))
}
