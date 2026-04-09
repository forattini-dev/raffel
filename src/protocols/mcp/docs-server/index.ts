/**
 * Documentation MCP Server
 *
 * Point to a directory of markdown files → get a full MCP server
 * with search, navigation, and code example extraction tools.
 *
 * @example
 * ```typescript
 * import { createDocsMcpServer } from 'raffel'
 *
 * const server = createDocsMcpServer({
 *   name: 'my-docs',
 *   version: '1.0.0',
 *   dir: './docs',
 * })
 *
 * await server.startStdio()
 * ```
 */

import { execSync } from 'child_process'
import { mkdtempSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import type { McpServer } from '../standalone.js'
import { createMcpServer } from '../standalone.js'
import { mcpText, mcpJson, mcpTable, mcpError } from '../response-helpers.js'
import { indexDocs, searchIndex, getHeadings, getCodeExamples, type DocsIndex, type DocsIndexerOptions } from './indexer.js'
import type { McpServerOptions } from '../types.js'

export interface DocsMcpServerOptions extends Omit<McpServerOptions, 'name' | 'version'> {
  /** Server name */
  name?: string

  /** Server version */
  version?: string

  /**
   * Root directory containing markdown files.
   * Required when `repo` is not set.
   */
  dir?: string

  /**
   * Git repository URL to clone and index.
   * When set, `dir` is ignored — the repo is cloned to a temp directory.
   *
   * @example
   * ```typescript
   * createDocsMcpServer({ repo: 'https://github.com/org/project', path: 'docs/' })
   * ```
   */
  repo?: string

  /** Branch/tag/commit to checkout (default: HEAD) */
  branch?: string

  /** Path within the repo to index (default: root) */
  path?: string

  /** File extensions to index (default: ['.md', '.mdx']) */
  extensions?: string[]

  /** Directories to skip (default: ['node_modules', '.git', 'dist']) */
  exclude?: string[]

  /** Max directory depth (default: 10) */
  maxDepth?: number

  /** Auto-reindex interval in ms (0 = disabled, default: 0) */
  watchInterval?: number
}

/**
 * Create an MCP server that indexes a directory of markdown files
 * and exposes tools for search, navigation, and code extraction.
 *
 * Tools provided:
 * - `search` — Full-text search across all documentation
 * - `list_files` — List all indexed files
 * - `read_file` — Read a specific file's content
 * - `read_section` — Read a specific section by heading
 * - `list_headings` — List all headings (optional level/file filter)
 * - `code_examples` — Extract code blocks (optional language filter)
 * - `file_outline` — Get the heading structure of a file
 * - `stats` — Index statistics
 *
 * Resources provided:
 * - `docs://files` — List of all indexed files
 * - `docs://file/{path}` — Full content of a file
 *
 * Prompts provided:
 * - `explain` — Explain a concept from the docs
 * - `summarize` — Summarize a file or section
 */
/**
 * Clone a git repo to a temp directory and return the resolved docs path.
 */
function resolveGitRepo(repo: string, branch?: string, subpath?: string): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'raffel-docs-'))
  const branchArgs = branch ? ['--branch', branch] : []
  const cmd = ['git', 'clone', '--depth', '1', ...branchArgs, repo, tmpDir].join(' ')

  try {
    execSync(cmd, { stdio: 'pipe', timeout: 60_000 })
  } catch (error) {
    throw new Error(`Failed to clone ${repo}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const docsDir = subpath ? join(tmpDir, subpath) : tmpDir
  if (!existsSync(docsDir)) {
    throw new Error(`Path "${subpath}" not found in repository ${repo}`)
  }

  return docsDir
}

export function createDocsMcpServer(options: DocsMcpServerOptions): McpServer & { reindex(): Promise<void> } {
  const serverName = options.name ?? 'docs'
  const serverVersion = options.version ?? '1.0.0'

  // Resolve docs directory — either local or from git
  let resolvedDir: string
  if (options.repo) {
    resolvedDir = resolveGitRepo(options.repo, options.branch, options.path)
  } else if (options.dir) {
    resolvedDir = resolve(options.dir)
  } else {
    throw new Error('Either "dir" or "repo" must be provided')
  }

  let index: DocsIndex | null = null
  let indexPromise: Promise<void> | null = null

  const indexerOpts: DocsIndexerOptions = {
    dir: resolvedDir,
    extensions: options.extensions,
    exclude: options.exclude,
    maxDepth: options.maxDepth,
  }

  async function ensureIndex(): Promise<DocsIndex> {
    if (!index) {
      if (!indexPromise) {
        indexPromise = indexDocs(indexerOpts).then((idx) => { index = idx })
      }
      await indexPromise
    }
    return index!
  }

  async function reindex(): Promise<void> {
    index = await indexDocs(indexerOpts)
    indexPromise = null
  }

  const server = createMcpServer({
    name: serverName,
    version: serverVersion,
    instructions: options.instructions ?? `Documentation server for ${options.repo ?? resolvedDir}. Use 'search' to find information, 'list_files' to browse, and 'read_section' to dive into specific topics.`,
    title: options.title,
    description: options.description ?? `MCP server for markdown documentation in ${options.repo ?? resolvedDir}`,
    websiteUrl: options.websiteUrl,
    icons: options.icons,
    auth: options.auth,
    capabilities: options.capabilities,
    requestTimeout: options.requestTimeout,
    maxTotalTimeout: options.maxTotalTimeout,
  })

  // ─── Tools ──────────────────────────────────────────────────

  server.tool({
    name: 'search',
    description: 'Search across all documentation. Returns matching sections ranked by relevance.',
    input: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (keywords or phrases)' },
        limit: { type: 'number', description: 'Max results (default: 10)' },
        file: { type: 'string', description: 'Filter by file path (substring match)' },
        level: { type: 'number', description: 'Filter by heading level (1-6)' },
        language: { type: 'string', description: 'Filter code blocks by language' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
    handler: async (args: Record<string, unknown>) => {
      const idx = await ensureIndex()
      const query = String(args.query ?? '')
      if (!query) return mcpError('Query is required')

      const results = searchIndex(idx, query, {
        limit: (args.limit as number) ?? 10,
        filePattern: args.file as string,
        level: args.level as number,
        language: args.language as string,
      })

      if (results.length === 0) {
        return mcpText(`No results found for "${query}"`)
      }

      const formatted = results.map((r, i) => {
        const loc = `${r.section.file}${r.section.level > 0 ? `#${r.section.anchor}` : ''}`
        const preview = r.section.text.slice(0, 200).replace(/\n/g, ' ')
        return `### ${i + 1}. ${r.section.heading}\n**File:** ${loc} | **Match:** ${r.matchType} | **Score:** ${r.score}\n\n${preview}${r.section.text.length > 200 ? '...' : ''}`
      })

      return mcpText(`Found ${results.length} result(s) for "${query}":\n\n${formatted.join('\n\n---\n\n')}`)
    },
  })

  server.tool({
    name: 'list_files',
    description: 'List all indexed documentation files with their titles and word counts.',
    annotations: { readOnlyHint: true },
    handler: async () => {
      const idx = await ensureIndex()
      return mcpTable(
        ['File', 'Title', 'Sections', 'Words'],
        idx.files.map((f) => [f.path, f.title, f.sections.length, f.wordCount])
      )
    },
  })

  server.tool({
    name: 'read_file',
    description: 'Read the full content of a documentation file.',
    input: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path (relative to docs root)' },
      },
      required: ['path'],
    },
    annotations: { readOnlyHint: true },
    handler: async (args: Record<string, unknown>) => {
      const idx = await ensureIndex()
      const path = String(args.path ?? '')
      const file = idx.files.find((f) => f.path === path || f.path.includes(path))
      if (!file) return mcpError(`File not found: ${path}`)

      const content = file.sections.map((s) => {
        const heading = s.level > 0 ? `${'#'.repeat(s.level)} ${s.heading}\n\n` : ''
        const code = s.codeBlocks.map((b) => `\`\`\`${b.language}\n${b.code}\n\`\`\``).join('\n\n')
        return `${heading}${s.text}${code ? `\n\n${code}` : ''}`
      }).join('\n\n')

      return mcpText(content)
    },
  })

  server.tool({
    name: 'read_section',
    description: 'Read a specific section by file and heading. Use list_headings or search to find the right section first.',
    input: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path (substring match)' },
        heading: { type: 'string', description: 'Section heading (substring match)' },
      },
      required: ['heading'],
    },
    annotations: { readOnlyHint: true },
    handler: async (args: Record<string, unknown>) => {
      const idx = await ensureIndex()
      const heading = String(args.heading ?? '').toLowerCase()
      const file = args.file ? String(args.file) : undefined

      const section = idx.sections.find((s) => {
        if (file && !s.file.includes(file)) return false
        return s.heading.toLowerCase().includes(heading)
      })

      if (!section) return mcpError(`Section not found: "${args.heading}"`)

      const code = section.codeBlocks.map((b) => `\`\`\`${b.language}\n${b.code}\n\`\`\``).join('\n\n')
      const header = section.level > 0 ? `${'#'.repeat(section.level)} ${section.heading}\n\n` : ''

      return mcpText(`**File:** ${section.file}\n\n${header}${section.text}${code ? `\n\n${code}` : ''}`)
    },
  })

  server.tool({
    name: 'list_headings',
    description: 'List all headings in the documentation. Filter by file or heading level.',
    input: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Filter by file path' },
        level: { type: 'number', description: 'Filter by heading level (1-6)' },
      },
    },
    annotations: { readOnlyHint: true },
    handler: async (args: Record<string, unknown>) => {
      const idx = await ensureIndex()
      const headings = getHeadings(idx, {
        file: args.file as string,
        level: args.level as number,
      })

      if (headings.length === 0) return mcpText('No headings found.')

      return mcpTable(
        ['File', 'Level', 'Heading'],
        headings.map((h) => [h.file, `H${h.level}`, h.heading])
      )
    },
  })

  server.tool({
    name: 'code_examples',
    description: 'Extract code blocks from documentation. Filter by programming language.',
    input: {
      type: 'object',
      properties: {
        language: { type: 'string', description: 'Programming language (e.g., typescript, python, bash)' },
        file: { type: 'string', description: 'Filter by file path' },
        limit: { type: 'number', description: 'Max results (default: 20)' },
      },
    },
    annotations: { readOnlyHint: true },
    handler: async (args: Record<string, unknown>) => {
      const idx = await ensureIndex()
      const examples = getCodeExamples(idx, {
        language: args.language as string,
        file: args.file as string,
      }).slice(0, (args.limit as number) ?? 20)

      if (examples.length === 0) return mcpText('No code examples found.')

      const formatted = examples.map((ex) =>
        `### ${ex.heading} (${ex.file})\n\`\`\`${ex.language}\n${ex.code}\n\`\`\``
      )

      return mcpText(formatted.join('\n\n---\n\n'))
    },
  })

  server.tool({
    name: 'file_outline',
    description: 'Get the heading structure of a file (table of contents).',
    input: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
      },
      required: ['path'],
    },
    annotations: { readOnlyHint: true },
    handler: async (args: Record<string, unknown>) => {
      const idx = await ensureIndex()
      const path = String(args.path ?? '')
      const file = idx.files.find((f) => f.path === path || f.path.includes(path))
      if (!file) return mcpError(`File not found: ${path}`)

      const outline = file.sections
        .filter((s) => s.level > 0)
        .map((s) => `${'  '.repeat(s.level - 1)}- ${s.heading}`)
        .join('\n')

      return mcpText(`# ${file.title}\n\n${outline || '(no headings)'}`)
    },
  })

  server.tool({
    name: 'stats',
    description: 'Get documentation index statistics.',
    annotations: { readOnlyHint: true },
    handler: async () => {
      const idx = await ensureIndex()
      const totalWords = idx.files.reduce((sum, f) => sum + f.wordCount, 0)
      const totalCode = idx.sections.reduce((sum, s) => sum + s.codeBlocks.length, 0)
      const languages = new Set(idx.sections.flatMap((s) => s.codeBlocks.map((b) => b.language)).filter(Boolean))

      return mcpJson({
        root: idx.root,
        indexedAt: idx.indexedAt,
        files: idx.files.length,
        sections: idx.sections.length,
        totalWords,
        codeBlocks: totalCode,
        languages: Array.from(languages).sort(),
      })
    },
  })

  server.tool({
    name: 'reindex',
    description: 'Force re-index of all documentation files. Use after files change.',
    handler: async () => {
      await reindex()
      return mcpText(`Re-indexed ${index!.files.length} files with ${index!.sections.length} sections.`)
    },
  })

  // ─── Resources ──────────────────────────────────────────────

  server.resource({
    uri: 'docs://files',
    name: 'Documentation Files',
    description: 'List of all indexed documentation files',
    mimeType: 'application/json',
    handler: async () => {
      const idx = await ensureIndex()
      return {
        contents: [{
          uri: 'docs://files',
          mimeType: 'application/json',
          text: JSON.stringify(idx.files.map((f) => ({
            path: f.path,
            title: f.title,
            sections: f.sections.length,
            wordCount: f.wordCount,
          })), null, 2),
        }],
      }
    },
  })

  server.resourceTemplate({
    uriTemplate: 'docs://file/{path}',
    name: 'Documentation File',
    description: 'Content of a specific documentation file',
    mimeType: 'text/markdown',
    handler: async (uri, params) => {
      const idx = await ensureIndex()
      const file = idx.files.find((f) => f.path === params.path || f.path.includes(params.path))
      if (!file) {
        return { contents: [{ uri, mimeType: 'text/plain', text: `File not found: ${params.path}` }] }
      }

      const content = file.sections.map((s) => {
        const heading = s.level > 0 ? `${'#'.repeat(s.level)} ${s.heading}\n\n` : ''
        return `${heading}${s.text}`
      }).join('\n\n')

      return { contents: [{ uri, mimeType: 'text/markdown', text: content }] }
    },
    completions: {
      path: async (prefix) => {
        const idx = await ensureIndex()
        return idx.files
          .map((f) => f.path)
          .filter((p) => p.includes(prefix))
          .slice(0, 10)
      },
    },
  })

  // ─── Prompts ────────────────────────────────────────────────

  server.prompt({
    name: 'explain',
    description: 'Explain a concept from the documentation',
    arguments: [
      { name: 'topic', description: 'Topic or concept to explain', required: true },
    ],
    handler: async ({ topic }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Search the documentation for "${topic}" and explain it clearly. Include relevant code examples if available. Start by using the search tool to find relevant sections.`,
        },
      }],
    }),
  })

  server.prompt({
    name: 'summarize',
    description: 'Summarize a documentation file',
    arguments: [
      { name: 'file', description: 'File path to summarize', required: true },
    ],
    handler: async ({ file }) => ({
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Read the file "${file}" using the read_file tool, then provide a concise summary covering: what it's about, key concepts, and important code examples.`,
        },
      }],
    }),
  })

  // Auto-reindex
  if (options.watchInterval && options.watchInterval > 0) {
    const timer = setInterval(() => reindex(), options.watchInterval)
    if (timer.unref) timer.unref()
  }

  // Trigger initial index on first access
  ensureIndex()

  return Object.assign(server, { reindex })
}

// Re-export indexer for advanced usage
export { indexDocs, searchIndex, getHeadings, getCodeExamples } from './indexer.js'
export type { DocsIndex, DocFile, DocSection, DocCodeBlock, DocLink, DocsIndexerOptions, SearchOptions, SearchResult } from './indexer.js'
