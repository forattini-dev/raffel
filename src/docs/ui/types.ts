/**
 * UI Types
 *
 * Type definitions for the USD documentation UI.
 */

/**
 * UI configuration options
 */
export interface UIConfig {
  theme?: 'light' | 'dark' | 'custom' | 'auto'
  primaryColor?: string
  logo?: string
  favicon?: string
  /** External CSS files loaded after the built-in stylesheet so they can override variables and component styles. */
  customCss?: string | string[]
  tryItOut?: boolean
  codeGeneration?: {
    enabled?: boolean
    languages?: ('typescript' | 'python' | 'go' | 'curl')[]
  }
  hero?: HeroConfig
  sidebar?: SidebarConfig
  navbar?: NavItem[]
  footer?: string
  toc?: TocConfig
  assets?: UIAssetsConfig
  markdown?: MarkdownConfig
  skipLink?: boolean | string
  /**
   * Breadcrumb trail at the top of every Markdown / generated reference page.
   *
   *   `false`         — disable
   *   `true`          — enable with default options
   *   `{ ... }`       — enable with overrides
   *
   * Default: enabled with `hideOnHome: true`.
   */
  breadcrumbs?: boolean | BreadcrumbsConfig
}

/**
 * Breadcrumb trail configuration.
 */
export interface BreadcrumbsConfig {
  /** Hide the breadcrumb on the home / root page. Default: true. */
  hideOnHome?: boolean
}

/**
 * Hero section configuration (built-in cover page)
 */
export interface HeroConfig {
  /** Override title from spec.info.title */
  title?: string
  /** Version badge next to title */
  version?: string
  /** Tagline/description below title */
  tagline?: string
  /** Feature list bullets */
  features?: string[]
  /** Background style */
  background?: 'gradient' | 'solid' | 'pattern' | 'image'
  /** Custom background image URL */
  backgroundImage?: string
  /** Custom background color (for solid) */
  backgroundColor?: string
  /** Call-to-action buttons */
  buttons?: Array<{
    text: string
    href?: string
    primary?: boolean
  }>
  /** Quick links grid below buttons */
  quickLinks?: Array<{
    title: string
    description?: string
    href: string
    icon?: string
  }>
  /** GitHub corner link */
  github?: string
}

/**
 * Sidebar configuration
 */
export interface SidebarConfig {
  search?: boolean
  expandAll?: boolean
  showCounts?: boolean
  docsPages?: boolean
  hide?: boolean
  /** Declarative sidebar tree. Order is preserved exactly as declared. */
  items?: DocsSidebarItem[]
  /** file-backed Markdown heading depth to include under the active docs page. */
  subMaxLevel?: number
}

/**
 * Declarative sidebar item. Groups may contain nested children, while pages
 * point at a hash-routed Markdown page path.
 */
export interface DocsSidebarItem {
  title: string
  path?: string
  href?: string
  children?: DocsSidebarItem[]
}

/**
 * Top navigation item.
 */
export interface NavItem {
  title: string
  href?: string
  external?: boolean
  children?: NavItem[]
}

/**
 * Markdown documentation page rendered by the file-backed Markdown UI.
 */
export interface DocsPage {
  title: string
  path: string
  markdown: string
  description?: string
  section?: string
  order?: number
  updatedAt?: string
}

/**
 * In-page table of contents configuration.
 */
export interface TocConfig {
  enabled?: boolean
  minLevel?: number
  maxLevel?: number
}

/**
 * Markdown rendering behavior.
 */
export interface MarkdownConfig {
  /** Add the page title as an H1 when a docs page has no top-level heading. */
  autoHeader?: boolean
  /** Format for `{raffel-updated}` markers. Supports YYYY, MM, DD, HH, mm, ss. */
  formatUpdated?: string
  /** Disable emoji shorthand conversion, for example `:rocket:`. */
  noEmoji?: boolean
  /** Raw HTML policy. Defaults to `escape`; `raw` should only be used with trusted Markdown. */
  html?: 'escape' | 'raw'
  /** Default target for external Markdown links. Defaults to `_blank`. */
  externalLinkTarget?: string
  /** Default rel for external Markdown links opened in a new tab. Defaults to `noopener noreferrer`. */
  externalLinkRel?: string
  /** file-backed Markdown patterns for links that should not be compiled into docs routes. */
  noCompileLinks?: string[]
}

/**
 * Docs UI asset delivery mode.
 */
export interface UIAssetsConfig {
  /**
   * `inline` keeps generated HTML self-contained.
   * `external` references runtime/style assets served by the docs middleware.
   */
  mode?: 'inline' | 'external'
}

/**
 * Tag group for hierarchical organization
 */
export interface TagGroup {
  name: string
  tags: string[]
  description?: string
  expanded?: boolean
}

/**
 * Options for generating UI HTML
 */
export interface UIGeneratorOptions {
  doc: any // USDDocument
  basePath: string
  ui?: UIConfig
  tagGroups?: TagGroup[]
}
