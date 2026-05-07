/**
 * Page navigation resolver.
 *
 * Pure module: given a sidebar tree, produces a flat reading order and a
 * Previous / Next accessor for any active page. Drives the page-nav cards
 * rendered at the bottom of every Markdown page (issue #123).
 *
 * Group headings (items without `path`) and external links (items with `href`
 * but no `path`) are skipped — only file-backed pages participate.
 */

/**
 * Minimal shape of a sidebar item for page-nav resolution.
 * Mirrors {@link import('../types.js').DocsSidebarItem} but is intentionally
 * declared locally so the runtime bundle has no module imports stripped.
 */
export interface PageNavSidebarItem {
  title?: string
  path?: string
  href?: string
  children?: PageNavSidebarItem[]
}

/**
 * A single entry in the flattened sidebar reading order.
 */
export interface PageNavEntry {
  title: string
  path: string
}

/**
 * Result of resolving prev/next for an active page.
 */
export interface PageNavNeighbours {
  prev?: PageNavEntry
  next?: PageNavEntry
}

/**
 * Walk the sidebar tree depth-first and emit one entry per file-backed page.
 *
 * Skips items that are pure group headings (no `path`) and external links
 * (`href` without a sidebar `path`). Order follows the declared structure.
 */
export function flattenReadingOrder(items: ReadonlyArray<PageNavSidebarItem> | undefined | null): PageNavEntry[] {
  const out: PageNavEntry[] = []
  if (!Array.isArray(items)) return out
  for (const item of items) visit(item, out)
  return out
}

function visit(item: PageNavSidebarItem, out: PageNavEntry[]): void {
  if (!item) return
  if (item.path && !isExternal(item.path)) {
    const title = (item.title ?? '').trim() || item.path
    out.push({ title, path: item.path })
  }
  for (const child of item.children ?? []) visit(child, out)
}

function isExternal(href: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href) || /^(?:mailto|tel):/i.test(href)
}

/**
 * Resolve previous and next page entries for the given active path.
 *
 * `optedOut` lists paths that should be skipped over — adjacent pages still
 * see real neighbours, never the opted-out page.
 */
export function prevNext(
  activePath: string | undefined | null,
  flatOrder: ReadonlyArray<PageNavEntry>,
  optedOut?: ReadonlySet<string>
): PageNavNeighbours {
  if (!activePath || !Array.isArray(flatOrder) || flatOrder.length === 0) return {}
  const opt = optedOut ?? new Set<string>()
  const index = flatOrder.findIndex(entry => entry.path === activePath)
  if (index === -1) return {}

  let prev: PageNavEntry | undefined
  for (let i = index - 1; i >= 0; i -= 1) {
    const entry = flatOrder[i]
    if (!opt.has(entry.path)) { prev = entry; break }
  }

  let next: PageNavEntry | undefined
  for (let i = index + 1; i < flatOrder.length; i += 1) {
    const entry = flatOrder[i]
    if (!opt.has(entry.path)) { next = entry; break }
  }

  const result: PageNavNeighbours = {}
  if (prev) result.prev = prev
  if (next) result.next = next
  return result
}
