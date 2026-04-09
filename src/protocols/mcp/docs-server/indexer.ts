/**
 * Markdown Documentation Indexer
 *
 * Parses a directory of .md files into a searchable index.
 * Zero dependencies — uses regex-based parsing with code-fence awareness.
 */

import { readdir, readFile } from 'fs/promises'
import { join, relative, extname, basename } from 'path'

// ─── Types ──────────────────────────────────────────────────────

export interface DocSection {
  /** Source file path (relative to root) */
  file: string
  /** Section heading text */
  heading: string
  /** Heading level (1-6), 0 = preamble */
  level: number
  /** Section body text (paragraphs joined) */
  text: string
  /** Code blocks in this section */
  codeBlocks: DocCodeBlock[]
  /** Links found in this section */
  links: DocLink[]
  /** Line number where this section starts */
  line: number
  /** Heading anchor (slugified) */
  anchor: string
}

export interface DocCodeBlock {
  language: string
  code: string
  line: number
}

export interface DocLink {
  text: string
  url: string
  isInternal: boolean
}

export interface DocFile {
  /** Path relative to root */
  path: string
  /** First heading (title) */
  title: string
  /** YAML frontmatter (if present) */
  frontmatter: Record<string, unknown>
  /** All sections in the file */
  sections: DocSection[]
  /** Total word count */
  wordCount: number
}

export interface DocsIndex {
  /** Root directory */
  root: string
  /** All indexed files */
  files: DocFile[]
  /** All sections (flattened from all files) */
  sections: DocSection[]
  /** Build timestamp */
  indexedAt: string
}

export interface DocsIndexerOptions {
  /** Root directory to index */
  dir: string
  /** File extensions to include (default: ['.md', '.mdx']) */
  extensions?: string[]
  /** Directories to exclude (default: ['node_modules', '.git', 'dist']) */
  exclude?: string[]
  /** Max depth for directory traversal (default: 10) */
  maxDepth?: number
}

// ─── Parsing ────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.+)$/
const CODE_FENCE_RE = /^(`{3,}|~{3,})(\S*)/
const FRONTMATTER_START_RE = /^---\s*$/
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; bodyStart: number } {
  const lines = content.split('\n')
  if (!FRONTMATTER_START_RE.test(lines[0])) {
    return { frontmatter: {}, bodyStart: 0 }
  }

  let endIndex = -1
  for (let i = 1; i < lines.length; i++) {
    if (FRONTMATTER_START_RE.test(lines[i])) {
      endIndex = i
      break
    }
  }

  if (endIndex === -1) return { frontmatter: {}, bodyStart: 0 }

  const yamlLines = lines.slice(1, endIndex)
  const frontmatter: Record<string, unknown> = {}

  for (const line of yamlLines) {
    const colonIndex = line.indexOf(':')
    if (colonIndex === -1) continue
    const key = line.slice(0, colonIndex).trim()
    let value: unknown = line.slice(colonIndex + 1).trim()

    // Basic YAML value parsing
    if (value === 'true') value = true
    else if (value === 'false') value = false
    else if (value === 'null') value = null
    else if (/^\d+$/.test(value as string)) value = parseInt(value as string, 10)
    else if (/^\d+\.\d+$/.test(value as string)) value = parseFloat(value as string)
    else if ((value as string).startsWith('"') && (value as string).endsWith('"')) value = (value as string).slice(1, -1)
    else if ((value as string).startsWith('[') && (value as string).endsWith(']')) {
      value = (value as string).slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))
    }

    if (key) frontmatter[key] = value
  }

  return { frontmatter, bodyStart: endIndex + 1 }
}

function extractLinks(text: string): DocLink[] {
  const links: DocLink[] = []
  let match: RegExpExecArray | null
  const re = new RegExp(LINK_RE.source, 'g')
  while ((match = re.exec(text)) !== null) {
    const url = match[2]
    links.push({
      text: match[1],
      url,
      isInternal: !url.startsWith('http://') && !url.startsWith('https://'),
    })
  }
  return links
}

function parseMarkdownFile(filePath: string, content: string): DocFile {
  const { frontmatter, bodyStart } = parseFrontmatter(content)
  const lines = content.split('\n')
  const bodyLines = lines.slice(bodyStart)

  const sections: DocSection[] = []
  let currentHeading = ''
  let currentLevel = 0
  let currentLine = bodyStart + 1
  let currentTextLines: string[] = []
  let currentCodeBlocks: DocCodeBlock[] = []
  let currentLinks: DocLink[] = []

  let inCodeFence = false
  let codeFenceChar = ''
  let codeFenceCount = 0
  let codeLanguage = ''
  let codeLines: string[] = []
  let codeStartLine = 0

  function flushSection(nextLine: number): void {
    const text = currentTextLines.join('\n').trim()
    if (text || currentCodeBlocks.length > 0 || currentHeading) {
      sections.push({
        file: filePath,
        heading: currentHeading || '(preamble)',
        level: currentLevel,
        text,
        codeBlocks: currentCodeBlocks,
        links: currentLinks,
        line: currentLine,
        anchor: slugify(currentHeading || 'preamble'),
      })
    }
    currentTextLines = []
    currentCodeBlocks = []
    currentLinks = []
    currentLine = nextLine
  }

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i]
    const lineNum = bodyStart + i + 1

    // Code fence handling
    const fenceMatch = CODE_FENCE_RE.exec(line)
    if (fenceMatch) {
      const fenceStr = fenceMatch[1]
      const fenceChar = fenceStr[0]
      const fenceLen = fenceStr.length

      if (!inCodeFence) {
        inCodeFence = true
        codeFenceChar = fenceChar
        codeFenceCount = fenceLen
        codeLanguage = fenceMatch[2] || ''
        codeLines = []
        codeStartLine = lineNum
        continue
      } else if (fenceChar === codeFenceChar && fenceLen >= codeFenceCount) {
        inCodeFence = false
        currentCodeBlocks.push({
          language: codeLanguage,
          code: codeLines.join('\n'),
          line: codeStartLine,
        })
        continue
      }
    }

    if (inCodeFence) {
      codeLines.push(line)
      continue
    }

    // Heading
    const headingMatch = HEADING_RE.exec(line)
    if (headingMatch) {
      flushSection(lineNum)
      currentHeading = headingMatch[2].trim()
      currentLevel = headingMatch[1].length
      continue
    }

    // Regular text
    currentTextLines.push(line)
    currentLinks.push(...extractLinks(line))
  }

  // Flush last section
  flushSection(bodyStart + bodyLines.length + 1)

  const title = sections.find((s) => s.level > 0)?.heading
    || (frontmatter.title as string)
    || basename(filePath, extname(filePath))

  const allText = sections.map((s) => s.text).join(' ')
  const wordCount = allText.split(/\s+/).filter(Boolean).length

  return {
    path: filePath,
    title,
    frontmatter,
    sections,
    wordCount,
  }
}

// ─── Directory Traversal ────────────────────────────────────────

async function walkDir(
  dir: string,
  rootDir: string,
  extensions: Set<string>,
  exclude: Set<string>,
  maxDepth: number,
  depth: number = 0,
): Promise<string[]> {
  if (depth > maxDepth) return []

  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    if (exclude.has(entry.name)) continue

    const fullPath = join(dir, entry.name)

    if (entry.isDirectory()) {
      const subFiles = await walkDir(fullPath, rootDir, extensions, exclude, maxDepth, depth + 1)
      files.push(...subFiles)
    } else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
      files.push(relative(rootDir, fullPath))
    }
  }

  return files.sort()
}

// ─── Public API ─────────────────────────────────────────────────

export async function indexDocs(options: DocsIndexerOptions): Promise<DocsIndex> {
  const extensions = new Set(options.extensions ?? ['.md', '.mdx'])
  const exclude = new Set(options.exclude ?? ['node_modules', '.git', 'dist', '.next', '.nuxt', 'build', 'coverage'])
  const maxDepth = options.maxDepth ?? 10

  const filePaths = await walkDir(options.dir, options.dir, extensions, exclude, maxDepth)

  const files: DocFile[] = []
  for (const filePath of filePaths) {
    const fullPath = join(options.dir, filePath)
    const content = await readFile(fullPath, 'utf-8')
    files.push(parseMarkdownFile(filePath, content))
  }

  const sections = files.flatMap((f) => f.sections)

  return {
    root: options.dir,
    files,
    sections,
    indexedAt: new Date().toISOString(),
  }
}

// ─── Search ─────────────────────────────────────────────────────

export interface SearchOptions {
  /** Max results (default: 20) */
  limit?: number
  /** Filter by file path pattern */
  filePattern?: string
  /** Filter by heading level */
  level?: number
  /** Filter by code language */
  language?: string
}

export interface SearchResult {
  section: DocSection
  score: number
  matchType: 'heading' | 'text' | 'code'
}

export function searchIndex(index: DocsIndex, query: string, options: SearchOptions = {}): SearchResult[] {
  const limit = options.limit ?? 20
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  const results: SearchResult[] = []

  for (const section of index.sections) {
    // File pattern filter
    if (options.filePattern && !section.file.includes(options.filePattern)) continue
    // Level filter
    if (options.level !== undefined && section.level !== options.level) continue

    let score = 0
    let matchType: SearchResult['matchType'] = 'text'

    // Heading match (highest weight)
    const headingLower = section.heading.toLowerCase()
    for (const term of terms) {
      if (headingLower.includes(term)) {
        score += 10
        matchType = 'heading'
      }
    }

    // Text match
    const textLower = section.text.toLowerCase()
    for (const term of terms) {
      if (textLower.includes(term)) {
        score += 3
        // Bonus for exact phrase
        if (textLower.includes(query.toLowerCase())) score += 5
      }
    }

    // Code match
    for (const block of section.codeBlocks) {
      if (options.language && block.language !== options.language) continue
      const codeLower = block.code.toLowerCase()
      for (const term of terms) {
        if (codeLower.includes(term)) {
          score += 2
          if (matchType === 'text') matchType = 'code'
        }
      }
    }

    if (score > 0) {
      results.push({ section, score, matchType })
    }
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export function getHeadings(index: DocsIndex, options?: { file?: string; level?: number }): Array<{ file: string; heading: string; level: number; anchor: string }> {
  return index.sections
    .filter((s) => s.level > 0)
    .filter((s) => !options?.file || s.file.includes(options.file))
    .filter((s) => !options?.level || s.level === options.level)
    .map((s) => ({ file: s.file, heading: s.heading, level: s.level, anchor: s.anchor }))
}

export function getCodeExamples(index: DocsIndex, options?: { language?: string; file?: string }): Array<DocCodeBlock & { file: string; heading: string }> {
  const results: Array<DocCodeBlock & { file: string; heading: string }> = []
  for (const section of index.sections) {
    if (options?.file && !section.file.includes(options.file)) continue
    for (const block of section.codeBlocks) {
      if (options?.language && block.language !== options.language) continue
      results.push({ ...block, file: section.file, heading: section.heading })
    }
  }
  return results
}
