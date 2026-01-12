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
 * Hero section configuration
 */
export interface HeroConfig {
  title?: string
  tagline?: string
  background?: 'gradient' | 'solid' | 'pattern' | 'image'
  backgroundImage?: string
  buttons?: Array<{
    text: string
    href?: string
    primary?: boolean
  }>
  quickLinks?: Array<{
    title: string
    description?: string
    href: string
    icon?: string
  }>
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
