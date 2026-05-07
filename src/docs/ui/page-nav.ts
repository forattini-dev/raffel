/**
 * Page navigation resolver — public entry point.
 *
 * Source of truth lives at {@link ./runtime/page-nav.ts} so the same module is
 * shared between the Node-side HTML builder and the bundled browser runtime.
 */

export type { PageNavEntry, PageNavNeighbours, PageNavSidebarItem } from './runtime/page-nav.js'
export { flattenReadingOrder, prevNext } from './runtime/page-nav.js'
