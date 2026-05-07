/**
 * Edit-on-source link resolver.
 *
 * Pure module: takes a Markdown page's `filePath`, the configured `docsRepo`,
 * and an optional `frontmatter` map, and returns the absolute URL that opens
 * the page's source file in the upstream editor (GitHub by default).
 *
 * Returns `null` whenever:
 *   - no `docsRepo` config is supplied,
 *   - no `filePath` is supplied (e.g. a generated reference page), or
 *   - the page opts out via `frontmatter.editable === false` (or `'false'`).
 */

export interface DocsRepoConfig {
  /** Repository base URL, for example `https://github.com/owner/repo`. */
  base: string
  /** Branch name. Defaults to `main`. */
  branch?: string
  /** Optional path prefix prepended to the file path, for example `docs/`. */
  pathPrefix?: string
  /** Optional override for the rendered link label. */
  label?: string
  /**
   * Optional URL segment between branch and filePath. Defaults to `edit`.
   * Useful for non-GitHub forges that use a different verb.
   */
  editSegment?: string
}

export interface ResolveEditLinkInput {
  /** Repository-relative path to the Markdown source, for example `docs/guides/quickstart.md`. */
  filePath?: string | null
  /** Editor configuration. When missing, the resolver returns `null`. */
  docsRepo?: DocsRepoConfig | null
  /** Optional frontmatter map. `editable: false` opts the page out. */
  frontmatter?: Record<string, unknown> | null
}

export interface ResolvedEditLink {
  url: string
  label: string
}

/**
 * Compute the edit URL for a Markdown page. Returns `null` when the link
 * cannot or should not be rendered.
 */
export function resolveEditLink(input: ResolveEditLinkInput): ResolvedEditLink | null {
  if (!input?.docsRepo) return null
  if (!input.filePath || typeof input.filePath !== 'string') return null
  if (isEditableFalse(input.frontmatter)) return null

  const base = stripTrailingSlash(String(input.docsRepo.base ?? '').trim())
  if (!base) return null

  const branch = encodeURIComponent(stripSlashes(String(input.docsRepo.branch ?? 'main')))
  const segment = stripSlashes(String(input.docsRepo.editSegment ?? 'edit'))
  const prefix = normalizePathPrefix(input.docsRepo.pathPrefix)
  const file = stripLeadingSlash(String(input.filePath).replace(/\\/g, '/'))
  const fullPath = `${prefix}${file}`

  const url = `${base}/${segment}/${branch}/${encodePathSegments(fullPath)}`
  const label = String(input.docsRepo.label ?? defaultEditLinkLabel(base)).trim() || defaultEditLinkLabel(base)
  return { url, label }
}

/**
 * Default label for the edit link based on the configured base host.
 * GitHub gets the canonical "Edit on GitHub" wording; other forges fall back
 * to a neutral "Edit this page".
 */
export function defaultEditLinkLabel(base: string): string {
  return isGitHubHost(base) ? 'Edit on GitHub' : 'Edit this page'
}

function isGitHubHost(base: string): boolean {
  try {
    const url = new URL(base)
    return url.hostname === 'github.com' || url.hostname.endsWith('.github.com')
  } catch {
    return /(?:^|\/)github\.com(?:\/|:|$)/i.test(base)
  }
}

function isEditableFalse(frontmatter: Record<string, unknown> | null | undefined): boolean {
  if (!frontmatter) return false
  const raw = frontmatter.editable
  if (raw === false) return true
  if (typeof raw === 'string' && raw.trim().toLowerCase() === 'false') return true
  return false
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function stripLeadingSlash(value: string): string {
  return value.replace(/^\/+/, '')
}

function stripSlashes(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '')
}

function normalizePathPrefix(prefix: string | undefined): string {
  if (!prefix) return ''
  const cleaned = String(prefix).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleaned) return ''
  return cleaned.endsWith('/') ? cleaned : `${cleaned}/`
}

function encodePathSegments(value: string): string {
  return value.split('/').map(segment => encodeURIComponent(segment)).join('/')
}
