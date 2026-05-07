/**
 * Breadcrumb resolver — pure function.
 *
 * Given a sidebar tree (declarative DocsSidebarItem[] shape) and the active
 * docs page path, returns the ordered chain of `{ title, path }` ancestors
 * leading to the active page. The last entry is the current page; preceding
 * entries are clickable ancestors.
 *
 * Rules
 *  - Single-segment chains (the home page itself, or a top-level page with no
 *    ancestors) return an empty array — the caller should hide the breadcrumb.
 *  - External-only entries (a sidebar leaf with `href` and no `path`) are
 *    skipped: they cannot be ancestors of an internal page.
 *  - Group nodes that have no `path` of their own are still rendered in the
 *    chain (as labels) so the hierarchy is visible. Their `path` field in the
 *    output is empty, signalling the caller to render them as plain text or
 *    as a non-link label. (When the resolver finds a chain via a group, it
 *    keeps the group's `title` and an empty `path`.)
 *  - When the active path does not appear anywhere in the tree, the resolver
 *    returns a single-entry array `[{ title: <derived>, path: activePath }]`,
 *    which then collapses to empty by the single-segment rule (see above).
 *
 * No DOM, no I/O. Safe to import in tests and SSR contexts.
 */

export type BreadcrumbSidebarItem = {
  title?: string
  path?: string
  href?: string
  children?: BreadcrumbSidebarItem[]
}

export type BreadcrumbEntry = {
  title: string
  /** Empty string for group labels with no own `path`. */
  path: string
}

/**
 * Resolve the breadcrumb chain from a sidebar tree to the active docs page.
 *
 * @param sidebar  Declarative sidebar tree (the same shape as
 *                 `UIConfig.sidebar.items` / `DocsSidebarItem[]`).
 * @param activePath  Active docs path, e.g. `/guides/auth`. Leading slashes are
 *                 normalised to a single `/` and trailing slashes removed.
 * @returns        Ordered list, root → current page. Empty when the chain has
 *                 fewer than 2 visible segments.
 */
export function resolveBreadcrumbs(
  sidebar: BreadcrumbSidebarItem[] | undefined | null,
  activePath: string | undefined | null
): BreadcrumbEntry[] {
  const target = normalizePath(activePath)
  if (!target) return []
  const items = Array.isArray(sidebar) ? sidebar : []

  const chain = findChain(items, target)
  if (chain && chain.length >= 2) return chain

  // Path absent from the sidebar — fall back to a synthetic single entry. Per
  // the single-segment rule, this collapses to empty so the caller hides the
  // breadcrumb. (Documented behaviour even though the issue suggests
  // returning `root + page`: the test fixtures and the "hide single segment"
  // rule are stronger constraints — a synthetic root would be misleading.)
  return []
}

function findChain(
  items: BreadcrumbSidebarItem[],
  targetPath: string
): BreadcrumbEntry[] | null {
  for (const item of items) {
    const itemPath = normalizePath(item.path)
    const ownEntry: BreadcrumbEntry | null = isExternalOnly(item)
      ? null
      : { title: titleOf(item), path: itemPath }

    // Match on this node.
    if (itemPath && itemPath === targetPath && ownEntry) {
      return [ownEntry]
    }

    // Recurse into children, prepending this node (group label or page).
    const children = Array.isArray(item.children) ? item.children : []
    if (children.length > 0) {
      const sub = findChain(children, targetPath)
      if (sub) {
        const head: BreadcrumbEntry = ownEntry ?? { title: titleOf(item), path: '' }
        return [head, ...sub]
      }
    }
  }
  return null
}

function isExternalOnly(item: BreadcrumbSidebarItem): boolean {
  if (item.path) return false
  if (item.href) return true
  return false
}

function titleOf(item: BreadcrumbSidebarItem): string {
  return String(item.title ?? item.path ?? item.href ?? '').trim()
}

function normalizePath(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const withSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withSlash.replace(/\/+$/, '') || '/'
}
