/**
 * UI Types
 *
 * Type definitions for the USD documentation UI.
 */

/**
 * UI configuration options
 */
export interface UIConfig {
  theme?: UIThemeMode | UIThemeConfig
  primaryColor?: string
  logo?: string
  favicon?: string
  openGraph?: OpenGraphConfig
  /** External CSS files loaded after the built-in stylesheet so they can override variables and component styles. */
  customCss?: string | string[]
  tryItOut?: boolean | TryItOutConfig
  codeGeneration?: {
    enabled?: boolean
    languages?: ('curl' | 'typescript' | 'rust' | 'python' | 'go')[]
  }
  hero?: HeroConfig
  sidebar?: SidebarConfig
  navbar?: NavItem[]
  footer?: string
  toc?: TocConfig
  assets?: UIAssetsConfig
  markdown?: MarkdownConfig
  skipLink?: boolean | string
  /** Repository config used to render an "Edit this page" link in Markdown page headers. */
  docsRepo?: DocsRepoConfig
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
  /**
   * Previous / Next page navigation cards rendered below every Markdown page.
   * - `true` / omitted: enabled for every file-backed page in the sidebar.
   * - `false`: disabled globally.
   * - `{ hide: [...] }`: enabled, but the listed paths opt out of the chain.
   *   Markdown frontmatter `pageNav: false` opts out individual pages too.
   */
  pageNav?: boolean | PageNavConfig
  /**
   * Mermaid diagram rendering for fenced ` ```mermaid ` blocks.
   *
   *   `false` / omitted — Mermaid blocks render as fallback `<pre>` text.
   *   `true`            — Inject `<script defer src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js">`
   *                       before the docs runtime so `window.mermaid` is available
   *                       when the runtime walks the DOM looking for diagrams.
   *   `{ src }`         — Same as `true` but with an explicit script URL. Use this
   *                       to pin a Mermaid version or self-host the asset.
   *
   * Mermaid is intentionally not bundled in Raffel (~3 MB) — this option exists
   * to avoid the customCss-can-only-load-CSS gap when a consumer needs diagrams.
   */
  mermaid?: boolean | MermaidConfig
}

export type UIThemeMode = 'light' | 'dark' | 'custom' | 'auto'

export interface UIThemeConfig {
  /** Initial mode. The reader can still switch between auto, light and dark. */
  defaultMode?: Exclude<UIThemeMode, 'custom'>
  light?: UIThemePalette
  dark?: UIThemePalette
}

export interface UIThemePalette {
  colors?: {
    primary?: string
    primaryHover?: string
    background?: string
    backgroundPrimary?: string
    backgroundSecondary?: string
    backgroundTertiary?: string
    surface?: string
    text?: string
    textPrimary?: string
    textSecondary?: string
    textMuted?: string
    border?: string
    accent?: string
    codeBackground?: string
    sidebarBackground?: string
    hoverBackground?: string
    codePanelBackground?: string
    codePanelText?: string
    codePanelHeader?: string
    methodGet?: string
    methodPost?: string
    methodPut?: string
    methodPatch?: string
    methodDelete?: string
  }
  typography?: {
    fontFamily?: string
    bodySize?: string
    smallSize?: string
    extraSmallSize?: string
    h1Size?: string
    h2Size?: string
    h3Size?: string
    h4Size?: string
    h5Size?: string
    h6Size?: string
    codeSize?: string
    lineHeight?: string
    tightLineHeight?: string
  }
}

export interface OpenGraphConfig {
  title?: string
  description?: string
  type?: string
  url?: string
  image?: string
  imageAlt?: string
  siteName?: string
  locale?: string
}

export interface TryItOutConfig {
  /** Browser fetch, or a same-origin bounded server proxy for APIs without docs CORS. */
  mode?: 'direct' | 'proxy'
  /** Extra exact origins accepted by proxy mode in addition to document servers. */
  allowedOrigins?: string[]
  /** Abort an upstream proxy request after this duration. Default: 15000. */
  timeoutMs?: number
  /** Maximum buffered upstream response. Default: 1 MiB. */
  maxResponseBytes?: number
}

export interface MermaidConfig {
  /** Script URL to load Mermaid from. Defaults to jsdelivr CDN. */
  src?: string
  /**
   * Wrap rendered diagrams in a viewer with a toolbar (zoom in/out/reset/fullscreen).
   * Pan via mouse drag when zoomed in. Wheel-zoom with Ctrl / ⌘ pressed.
   *
   * Default: `true`. Set `false` to render diagrams without the viewer overlay.
   */
  viewer?: boolean
}

/**
 * Editor / source-of-truth repository for Markdown pages.
 */
export interface DocsRepoConfig {
  /** Repository base URL, for example `https://github.com/owner/repo`. */
  base: string
  /** Branch name. Defaults to `main`. */
  branch?: string
  /** Optional path prefix prepended to a page's `filePath`. */
  pathPrefix?: string
  /** Optional override for the rendered link label. */
  label?: string
  /** Optional URL segment between branch and filePath. Defaults to `edit`. */
  editSegment?: string
}

/**
 * Breadcrumb trail configuration.
 */
export interface BreadcrumbsConfig {
  /** Hide the breadcrumb on the home / root page. Default: true. */
  hideOnHome?: boolean
}

/**
 * Configuration for the bottom-of-page Previous / Next navigation cards.
 */
export interface PageNavConfig {
  /** Routes that should be skipped over when computing neighbours. */
  hide?: string[]
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
  /** Allow readers to drag or keyboard-resize the sidebar. Default: true. */
  resizable?: boolean
  /** Initial sidebar width in pixels. Default: 280. */
  width?: number
  /** Minimum reader-selectable width in pixels. Default: 220. */
  minWidth?: number
  /** Maximum reader-selectable width in pixels. Default: 560. */
  maxWidth?: number
  /** Declarative sidebar tree. Order is preserved exactly as declared. */
  items?: DocsSidebarItem[]
  /** file-backed Markdown heading depth to include under the active docs page. */
  subMaxLevel?: number
  /** When set, wraps all auto-generated docs-page sections under a single collapsible group with this label. */
  docsPagesGroup?: string
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
