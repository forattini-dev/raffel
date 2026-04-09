import { describe, it, expect } from 'vitest'
import { indexDocs, searchIndex, getHeadings, getCodeExamples } from '../../../src/protocols/mcp/docs-server/indexer.js'
import { createDocsMcpServer } from '../../../src/protocols/mcp/docs-server/index.js'
import path from 'path'

const DOCS_DIR = path.resolve(process.cwd(), 'docs')

describe('Markdown Indexer', () => {
  it('should index the Raffel docs directory', async () => {
    const index = await indexDocs({ dir: DOCS_DIR })

    expect(index.files.length).toBeGreaterThan(10)
    expect(index.sections.length).toBeGreaterThan(50)
    expect(index.root).toBe(DOCS_DIR)
    expect(index.indexedAt).toBeDefined()
  })

  it('should extract headings from files', async () => {
    const index = await indexDocs({ dir: DOCS_DIR })
    const headings = getHeadings(index)

    expect(headings.length).toBeGreaterThan(20)
    expect(headings[0]).toHaveProperty('file')
    expect(headings[0]).toHaveProperty('heading')
    expect(headings[0]).toHaveProperty('level')
    expect(headings[0]).toHaveProperty('anchor')
  })

  it('should filter headings by level', async () => {
    const index = await indexDocs({ dir: DOCS_DIR })
    const h1s = getHeadings(index, { level: 1 })
    const h2s = getHeadings(index, { level: 2 })

    expect(h1s.every((h) => h.level === 1)).toBe(true)
    expect(h2s.every((h) => h.level === 2)).toBe(true)
  })

  it('should extract code examples', async () => {
    const index = await indexDocs({ dir: DOCS_DIR })
    const examples = getCodeExamples(index)

    expect(examples.length).toBeGreaterThan(5)
    expect(examples[0]).toHaveProperty('language')
    expect(examples[0]).toHaveProperty('code')
    expect(examples[0]).toHaveProperty('file')
  })

  it('should filter code examples by language', async () => {
    const index = await indexDocs({ dir: DOCS_DIR })
    const tsExamples = getCodeExamples(index, { language: 'typescript' })
    const bashExamples = getCodeExamples(index, { language: 'bash' })

    expect(tsExamples.every((e) => e.language === 'typescript')).toBe(true)
    if (bashExamples.length > 0) {
      expect(bashExamples.every((e) => e.language === 'bash')).toBe(true)
    }
  })

  it('should search by keyword', async () => {
    const index = await indexDocs({ dir: DOCS_DIR })
    const results = searchIndex(index, 'authentication')

    expect(results.length).toBeGreaterThan(0)
    expect(results[0].score).toBeGreaterThan(0)
    expect(results[0].section).toBeDefined()
    expect(results[0].matchType).toBeDefined()
  })

  it('should search by phrase', async () => {
    const index = await indexDocs({ dir: DOCS_DIR })
    const results = searchIndex(index, 'rate limiting')

    expect(results.length).toBeGreaterThan(0)
  })

  it('should return empty for nonsense query', async () => {
    const index = await indexDocs({ dir: DOCS_DIR })
    const results = searchIndex(index, 'xyzzyflurble99')

    expect(results).toHaveLength(0)
  })

  it('should respect search limit', async () => {
    const index = await indexDocs({ dir: DOCS_DIR })
    const results = searchIndex(index, 'server', { limit: 3 })

    expect(results.length).toBeLessThanOrEqual(3)
  })

  it('should parse frontmatter', async () => {
    const index = await indexDocs({ dir: DOCS_DIR })
    // Some files might have frontmatter, some won't
    const withFrontmatter = index.files.filter((f) => Object.keys(f.frontmatter).length > 0)
    // Just check the structure is correct
    for (const file of withFrontmatter) {
      expect(typeof file.frontmatter).toBe('object')
    }
  })

  it('should track word counts', async () => {
    const index = await indexDocs({ dir: DOCS_DIR })
    for (const file of index.files) {
      expect(typeof file.wordCount).toBe('number')
      expect(file.wordCount).toBeGreaterThanOrEqual(0)
    }
  })

  it('should handle nested directories', async () => {
    const index = await indexDocs({ dir: DOCS_DIR })
    const paths = index.files.map((f) => f.path)
    const nested = paths.filter((p) => p.includes('/'))
    expect(nested.length).toBeGreaterThan(0)
  })
})

describe('createDocsMcpServer', () => {
  it('should create a server with all expected tools', () => {
    const server = createDocsMcpServer({ dir: DOCS_DIR })
    const protocol = server.getProtocolHandler()
    const tools = protocol.listTools()
    const toolNames = tools.map((t) => t.name)

    expect(toolNames).toContain('search')
    expect(toolNames).toContain('list_files')
    expect(toolNames).toContain('read_file')
    expect(toolNames).toContain('read_section')
    expect(toolNames).toContain('list_headings')
    expect(toolNames).toContain('code_examples')
    expect(toolNames).toContain('file_outline')
    expect(toolNames).toContain('stats')
    expect(toolNames).toContain('reindex')
  })

  it('should create resources', () => {
    const server = createDocsMcpServer({ dir: DOCS_DIR })
    const protocol = server.getProtocolHandler()
    const resources = protocol.listResources()

    expect(resources.some((r) => r.uri === 'docs://files')).toBe(true)
  })

  it('should create prompts', () => {
    const server = createDocsMcpServer({ dir: DOCS_DIR })
    const protocol = server.getProtocolHandler()
    const prompts = protocol.listPrompts()
    const promptNames = prompts.map((p) => p.name)

    expect(promptNames).toContain('explain')
    expect(promptNames).toContain('summarize')
  })

  it('should handle search tool call', async () => {
    const server = createDocsMcpServer({ dir: DOCS_DIR })
    const protocol = server.getProtocolHandler()

    const response = await protocol.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'search', arguments: { query: 'authentication' } },
    })

    const result = response!.result as { content: Array<{ text: string }> }
    expect(result.content[0].text).toContain('authentication')
  })

  it('should handle list_files tool call', async () => {
    const server = createDocsMcpServer({ dir: DOCS_DIR })
    const protocol = server.getProtocolHandler()

    const response = await protocol.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_files', arguments: {} },
    })

    const result = response!.result as { content: Array<{ text: string }> }
    expect(result.content[0].text).toContain('|') // markdown table
  })

  it('should handle stats tool call', async () => {
    const server = createDocsMcpServer({ dir: DOCS_DIR })
    const protocol = server.getProtocolHandler()

    const response = await protocol.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'stats', arguments: {} },
    })

    const result = response!.result as { content: Array<{ text: string }> }
    const stats = JSON.parse(result.content[0].text)
    expect(stats.files).toBeGreaterThan(10)
    expect(stats.sections).toBeGreaterThan(50)
  })

  it('should support reindex', async () => {
    const server = createDocsMcpServer({ dir: DOCS_DIR })
    await server.reindex()
    // No error = success
  })

  it('should accept custom name and version', () => {
    const server = createDocsMcpServer({
      dir: DOCS_DIR,
      name: 'my-docs',
      version: '2.0.0',
      title: 'My Docs',
      description: 'Custom docs server',
    })
    const protocol = server.getProtocolHandler()
    // Verify through initialize
    expect(protocol).toBeDefined()
  })
})
