type SidebarHeadingItem = { id: string; title: string; level: number }

export type RuntimeSidebarItem = {
  title?: string
  path?: string
  href?: string
  children?: RuntimeSidebarItem[]
}

type SidebarTreeDeps = {
  doc: any
  win: any
  sidebarConfig: any
  activePagePath: string
  activeHeadingId: string
  searchQuery: string
  esc: (value: unknown) => string
  resolveDocsAlias: (path: string) => string
  normalizeDocsPath: (path: unknown) => string
  setDocsPage: (path: unknown, headingId?: string) => void
  getDocsPageViews: () => Array<{ path: string; markdown: string }>
  extractSidebarHeadings: (markdown: string) => SidebarHeadingItem[]
}

export function appendDeclarativeSidebar(
  nav: any,
  items: RuntimeSidebarItem[],
  deps: SidebarTreeDeps
): void {
  for (const item of items) appendSidebarItem(nav, item, 0, deps)
}

function appendSidebarItem(parent: any, item: RuntimeSidebarItem, depth: number, deps: SidebarTreeDeps): void {
  const children = Array.isArray(item.children) ? item.children : []
  const title = String(item.title ?? item.path ?? item.href ?? '')
  if (!title) return
  const itemPath = item.path ? deps.resolveDocsAlias(deps.normalizeDocsPath(item.path)) : ''
  const active = Boolean(itemPath && itemPath === deps.activePagePath)
  const expanded = deps.sidebarConfig.expandAll === true || active || children.some(child => itemContainsActivePath(child, deps))

  if (children.length > 0) {
    const group = deps.doc.createElement('div')
    group.className = `tag-group docs-sidebar-group docs-sidebar-depth-${depth}${expanded ? '' : ' collapsed'}`
    const header = deps.doc.createElement('div')
    header.className = `tag-group-header${active ? ' active' : ''}`
    header.innerHTML = `<span class="tag-group-arrow">▼</span>${deps.esc(title)}<span class="tag-group-count">${countLeaves(children)}</span>`
    header.onclick = () => group.classList.toggle('collapsed')

    const childContainer = deps.doc.createElement('div')
    childContainer.className = 'tag-group-items'
    childContainer.style.maxHeight = expanded ? `${Math.max(1, countRows(children)) * 90}px` : '0'
    if (itemPath || item.href) {
      childContainer.appendChild(createPageItem(item, title, active, depth, deps))
      if (active && !deps.searchQuery) appendActivePageHeadings(childContainer, item.path ?? deps.activePagePath, deps)
    }
    for (const child of children) appendSidebarItem(childContainer, child, depth + 1, deps)

    group.appendChild(header)
    group.appendChild(childContainer)
    parent.appendChild(group)
    return
  }

  parent.appendChild(createPageItem(item, title, active, depth, deps))
  if (active && !deps.searchQuery) appendActivePageHeadings(parent, item.path ?? deps.activePagePath, deps)
}

const HOME_ICON_SVG = '<svg class="docs-sidebar-home-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>'

function createPageItem(item: RuntimeSidebarItem, title: string, active: boolean, depth: number, deps: SidebarTreeDeps): any {
  const element = deps.doc.createElement('div')
  element.className = `nav-item docs-page-nav-item docs-sidebar-page docs-sidebar-depth-${depth}${active ? ' active' : ''}`
  const normalizedPath = item.path ? deps.normalizeDocsPath(item.path) : ''
  const isHome = depth === 0 && (normalizedPath === '/' || normalizedPath === '')
  element.innerHTML = isHome
    ? `<span class="docs-sidebar-home">${HOME_ICON_SVG}<span class="nav-item-text">${deps.esc(title)}</span></span>`
    : `<span class="nav-item-text">${deps.esc(title)}</span>`
  element.onclick = (event: any) => {
    event.stopPropagation()
    if (item.href && !item.path) {
      if (/^(?:https?:)?\/\//i.test(item.href)) deps.win.location.href = item.href
      else deps.win.history?.replaceState?.(null, '', item.href)
      return
    }
    if (item.path) deps.setDocsPage(item.path)
  }
  return element
}

function appendActivePageHeadings(parent: any, path: string, deps: SidebarTreeDeps): void {
  const normalizedPath = deps.resolveDocsAlias(deps.normalizeDocsPath(path))
  const page = deps.getDocsPageViews().find(candidate => candidate.path === normalizedPath)
  if (!page) return
  const headings = deps.extractSidebarHeadings(page.markdown)
  if (headings.length === 0) return

  const subItems = deps.doc.createElement('div')
  subItems.className = 'nav-subitems'
  for (const child of headings) {
    const childElement = deps.doc.createElement('button')
    childElement.type = 'button'
    childElement.className = `nav-subitem nav-subitem-level-${child.level}${child.id === deps.activeHeadingId ? ' active' : ''}`
    childElement.textContent = child.title
    childElement.onclick = (event: any) => {
      event.stopPropagation()
      deps.setDocsPage(deps.activePagePath || path, child.id)
    }
    subItems.appendChild(childElement)
  }
  parent.appendChild(subItems)
}

function itemContainsActivePath(item: RuntimeSidebarItem, deps: SidebarTreeDeps): boolean {
  const itemPath = item.path ? deps.resolveDocsAlias(deps.normalizeDocsPath(item.path)) : ''
  return Boolean(itemPath && itemPath === deps.activePagePath)
    || (item.children ?? []).some(child => itemContainsActivePath(child, deps))
}

function countLeaves(items: RuntimeSidebarItem[]): number {
  return items.reduce((count, item) => count + ((item.children?.length ?? 0) > 0 ? countLeaves(item.children ?? []) : 1), 0)
}

function countRows(items: RuntimeSidebarItem[]): number {
  return items.reduce((count, item) => count + 1 + countRows(item.children ?? []), 0)
}
