/**
 * UI Types
 *
 * Type definitions for the USD documentation UI.
 */

/**
 * UI configuration options
 */
export interface UIConfig {
  theme?: 'light' | 'dark' | 'auto'
  primaryColor?: string
  logo?: string
  favicon?: string
  tryItOut?: boolean
  codeGeneration?: {
    enabled?: boolean
    languages?: ('typescript' | 'python' | 'go' | 'curl')[]
  }
  hero?: HeroConfig
  sidebar?: SidebarConfig
}

/**
 * Hero section configuration (Docsify-inspired cover page)
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
