import type { USDDocumentation, USDDocumentationPage, USDDocumentationSidebarItem } from '../usd/index.js'
import type {
  LoadedMarkdownDocs,
  MarkdownDocsSource,
  ResolvedMarkdownDocsSource,
} from './markdown-loader.js'

export const DOCUMENTATION_FORMATS = ['json', 'yaml', 'yml', 'toon'] as const

export interface DocsSurfaceState {
  enabled: boolean
  mounted: boolean
  fresh: boolean
  basePath: string
  endpoints: Record<string, string>
  updatedAt: string | null
  mountedAt: string | null
  staleReasons: string[]
}

export interface ApiDocsState extends DocsSurfaceState {
  revision: number
  formats: Array<(typeof DOCUMENTATION_FORMATS)[number]>
  routeCounts: {
    procedures: number
    restRoutes: number
    graphqlResources?: number
    total: number
  }
}

export interface MarkdownDocsState extends DocsSurfaceState {
  revision: number | null
  loadedAt: string | null
  paths: {
    routeBase: string | null
    pages: string[]
    files: string[]
    aliases: string[]
    assets?: string
  }
  counts: {
    configured: number
    pages: number
    fileBackedPages: number
    explicitPages: number
    aliases: number
    sidebarItems: number
  }
}

export interface DocsState {
  generatedAt: string
  api: ApiDocsState
  markdown: MarkdownDocsState
}

export function normalizeDocsBasePath(basePath: string): string {
  const normalized = `/${String(basePath || '/docs')}`.replace(/\/+/g, '/').replace(/\/$/, '')
  return normalized || '/'
}

export function joinDocsEndpoint(basePath: string, suffix: string): string {
  const base = normalizeDocsBasePath(basePath)
  const normalizedSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`
  return base === '/' ? normalizedSuffix : `${base}${normalizedSuffix}`
}

export function createMarkdownDocsState(options: {
  basePath?: string
  docsDir?: MarkdownDocsSource
  documentation?: USDDocumentation
  loadedMarkdownDocs?: LoadedMarkdownDocs
  markdownDocsSource?: ResolvedMarkdownDocsSource
  mergedDocumentation?: USDDocumentation
  mounted?: boolean
  loadedAt?: string | null
  mountedAt?: string | null
}): MarkdownDocsState {
  const basePath = normalizeDocsBasePath(options.basePath ?? '/docs')
  const mergedDocumentation = options.mergedDocumentation ?? options.documentation
  const pages = mergedDocumentation?.pages ?? []
  const loadedPages = options.loadedMarkdownDocs?.documentation.pages ?? []
  const explicitPages = options.documentation?.pages ?? []
  const aliases = Object.keys(mergedDocumentation?.aliases ?? {}).sort()
  const enabled = Boolean(options.docsDir || options.documentation)
  const mounted = Boolean(options.mounted && enabled)
  const loadedAt = enabled ? options.loadedAt ?? null : null
  const updatedAt = enabled ? latestUpdatedAt(pages) ?? loadedAt : null
  const assetsPath = options.docsDir ? joinDocsEndpoint(basePath, '/-/assets/*') : undefined

  return {
    enabled,
    mounted,
    fresh: enabled ? mounted : true,
    revision: mounted ? 1 : null,
    basePath,
    endpoints: enabled
      ? {
          ui: basePath,
          state: joinDocsEndpoint(basePath, '/state.json'),
          ...(assetsPath ? { assets: assetsPath } : {}),
        }
      : {},
    paths: {
      routeBase: mergedDocumentation?.routeBase ?? options.loadedMarkdownDocs?.documentation.routeBase ?? null,
      pages: uniqueStrings(pages.map(page => normalizePagePath(page.path))),
      files: uniqueStrings(pages.map(page => page.filePath).filter(isString)),
      aliases,
      ...(assetsPath ? { assets: assetsPath } : {}),
    },
    counts: {
      configured: enabled ? 1 : 0,
      pages: pages.length,
      fileBackedPages: loadedPages.length,
      explicitPages: explicitPages.length,
      aliases: aliases.length,
      sidebarItems: countSidebarItems(mergedDocumentation?.sidebar ?? []),
    },
    updatedAt,
    loadedAt,
    mountedAt: mounted ? options.mountedAt ?? loadedAt : null,
    staleReasons: enabled && !mounted ? ['not-mounted'] : [],
  }
}

function normalizePagePath(value: unknown): string {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  return (`/${raw}`).replace(/\/+/g, '/').replace(/\/$/, '') || '/'
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

function latestUpdatedAt(pages: USDDocumentationPage[]): string | null {
  let latest = 0
  let value: string | null = null
  for (const page of pages) {
    if (!page.updatedAt) continue
    const time = Date.parse(page.updatedAt)
    if (!Number.isFinite(time) || time <= latest) continue
    latest = time
    value = page.updatedAt
  }
  return value
}

function countSidebarItems(items: readonly USDDocumentationSidebarItem[] = []): number {
  let count = 0
  for (const item of items) {
    count += 1
    count += countSidebarItems(item.children ?? [])
  }
  return count
}
