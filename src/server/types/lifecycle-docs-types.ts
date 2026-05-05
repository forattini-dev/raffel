import type {
  USDDocument,
  USDProtocol,
  USDTag,
  USDTagGroup,
  USDExternalDocs,
  USDServer,
  USDSecurityScheme,
} from '../../usd/index.js'
import type { OpenAPIDocument } from '../../usd/export/openapi.js'
import type { MarkdownDocsSource } from '../../docs/markdown-loader.js'

// === USD Documentation Types ===

/**
 * USD (Universal Service Documentation) configuration.
 *
 * USD extends OpenAPI 3.1 with the x-usd namespace for multi-protocol support.
 */
export interface USDDocsConfig {
  /** Base path for documentation endpoints (default: '/docs') */
  basePath?: string

  /** API information */
  info?: {
    title?: string
    version?: string
    description?: string
    termsOfService?: string
    contact?: {
      name?: string
      url?: string
      email?: string
    }
    license?: {
      name: string
      url?: string
      identifier?: string
    }
    summary?: string
  }

  /** Server definitions */
  servers?: USDServer[]

  /** Protocols to include (auto-detected if not specified) */
  protocols?: USDProtocol[]

  /** Security schemes */
  securitySchemes?: Record<string, USDSecurityScheme>

  /** Default security requirement */
  defaultSecurity?: Array<Record<string, string[]>>

  /** Tags for grouping */
  tags?: USDTag[]

  /** External documentation */
  externalDocs?: USDExternalDocs

  /** UI configuration */
  ui?: {
    /** Theme preference */
    theme?: 'light' | 'dark' | 'auto'
    /** Primary color for UI */
    primaryColor?: string
    /** Logo URL */
    logo?: string
    /** Favicon URL */
    favicon?: string
    /** Enable "Try It Out" feature */
    tryItOut?: boolean
    /** Code generation options */
    codeGeneration?: {
      enabled?: boolean
      languages?: ('typescript' | 'python' | 'go' | 'curl')[]
    }
    /** Hero section configuration (file-backed Markdown cover page) */
    hero?: {
      /** Override title from info.title */
      title?: string
      /** Version badge */
      version?: string
      /** Tagline/description */
      tagline?: string
      /** Feature list */
      features?: string[]
      /** Background style */
      background?: 'gradient' | 'solid' | 'pattern' | 'image'
      /** Background image URL */
      backgroundImage?: string
      /** Background color (for solid) */
      backgroundColor?: string
      /** CTA buttons */
      buttons?: Array<{ text: string; href?: string; primary?: boolean }>
      /** Quick links */
      quickLinks?: Array<{ title: string; description?: string; href: string; icon?: string }>
      /** GitHub URL (corner octocat) */
      github?: string
    }
    /** Sidebar configuration */
    sidebar?: {
      search?: boolean
      expandAll?: boolean
      showCounts?: boolean
      docsPages?: boolean
      hide?: boolean
      subMaxLevel?: number
    }
    /** Top navigation links */
    navbar?: Array<{ title: string; href?: string; external?: boolean; children?: Array<{ title: string; href?: string; external?: boolean }> }>
    /** Footer markdown/text */
    footer?: string
    /** In-page table of contents */
    toc?: { enabled?: boolean; minLevel?: number; maxLevel?: number }
    /** Markdown rendering behavior */
    markdown?: {
      autoHeader?: boolean
      formatUpdated?: string
      noEmoji?: boolean
      externalLinkTarget?: string
      externalLinkRel?: string
      noCompileLinks?: string[]
    }
    /** Skip navigation link text or toggle */
    skipLink?: boolean | string
    /** UI asset delivery mode */
    assets?: { mode?: 'inline' | 'external' }
  }

  /** Documentation customization for USD spec (portable, included in x-usd) */
  documentation?: {
    /** Hero section configuration */
    hero?: {
      title?: string
      version?: string
      tagline?: string
      features?: string[]
      background?: 'gradient' | 'solid' | 'pattern' | 'image'
      backgroundImage?: string
      backgroundColor?: string
      buttons?: Array<{ text: string; href?: string; primary?: boolean }>
      quickLinks?: Array<{ title: string; description?: string; href: string; icon?: string }>
      github?: string
    }
    /** Introduction markdown (displayed after hero) */
    introduction?: string
    /** Markdown documentation pages */
    pages?: Array<{
      title: string
      path: string
      markdown: string
      description?: string
      section?: string
      order?: number
    }>
    /** Route aliases for preserving old docs links, for example { '/old': '/new' } */
    aliases?: Record<string, string>
    /** In-app route prefix used by file-backed Markdown docs, for example `/guides` */
    routeBase?: string
    /** Logo URL */
    logo?: string
    /** Favicon URL */
    favicon?: string
    /** External links */
    externalLinks?: Array<{ title: string; url: string; description?: string }>
    /** Footer markdown/text */
    footer?: string
  }

  /**
   * Markdown docs directory to load by convention.
   *
   * Supports file-backed Markdown files such as README.md, nested Markdown pages,
   * _sidebar.md, _navbar.md, _coverpage.md, and _404.md. Use `true` to
   * load the project's `./docs` directory.
   */
  docsDir?: MarkdownDocsSource

  /** Include standard error schemas */
  includeErrorSchemas?: boolean

  /** Include stream event schemas */
  includeStreamEventSchemas?: boolean

  /** Global content types for documentation and content negotiation */
  contentTypes?: {
    /** Default content type */
    default?: string
    /** Supported content types */
    supported?: string[]
  }

  /** Tag groups for the documentation sidebar */
  tagGroups?: USDTagGroup[]

  /** JSON-RPC generation options */
  jsonrpc?: {
    endpoint?: string
    version?: '2.0'
    batch?: {
      enabled?: boolean
      maxSize?: number
    }
    groupByNamespace?: boolean
  }

  /** gRPC generation options */
  grpc?: {
    package?: string
    syntax?: 'proto3' | 'proto2'
    options?: Record<string, unknown>
    serviceNameOverrides?: Record<string, { service: string; method?: string }>
    defaultServiceName?: string
  }
}

/**
 * USD documentation handlers
 */
export interface USDDocsHandlers {
  /** Serve the main documentation UI */
  serveUI: () => Response
  /** Serve USD document as JSON */
  serveUSD: () => Response
  /** Serve USD document as YAML */
  serveUSDYaml: () => Response
  /** Serve pure OpenAPI 3.1 JSON (for Swagger UI compatibility) */
  serveOpenAPI: () => Response
  /** Serve reusable docs UI JavaScript runtime */
  serveUIRuntime: () => Response
  /** Serve reusable Markdown engine support asset */
  serveUIMarkdownEngine: () => Response
  /** Serve reusable Markdown renderer bridge */
  serveUIMarkdownRenderer: () => Response
  /** Serve reusable protocol console bridge */
  serveUIProtocolConsole: () => Response
  /** Serve docs UI stylesheet */
  serveUIStyles: () => Response
  /** Serve static assets referenced by Markdown docsDir pages */
  serveDocsAsset: (pathname: string) => Response | null
  /** Get the USD document */
  getUSDDocument: () => USDDocument
  /** Get the OpenAPI document */
  getOpenAPIDocument: () => OpenAPIDocument
}
