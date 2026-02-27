import { spawnSync } from 'node:child_process'
import path from 'node:path'
/**
 * MCP runtime tests for version and category behavior.
 */

import { describe, it, expect } from 'vitest'
import { createMCPServer } from '../../src/mcp/server.js'
import { MCP_VERSION } from '../../src/mcp/version.js'
import { toolCategories } from '../../src/mcp/tools/index.js'

describe('MCP runtime behavior', () => {
  it('should match CLI --version output to package version', () => {
    const cliPath = path.resolve(process.cwd(), 'src', 'mcp', 'cli.ts')
    const result = spawnSync(process.execPath, ['--import', 'tsx', cliPath, '--version'], {
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(`raffel-mcp version ${MCP_VERSION}`)
  })

  it('should report package version in initialize result', async () => {
    const server = createMCPServer()

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    })

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        serverInfo: {
          name: 'raffel-mcp',
          version: MCP_VERSION,
        },
      },
    })
  })

  it('should return only tools for a minimal category', async () => {
    const server = createMCPServer({ category: 'minimal' })

    const response = await server.handleRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })

    const tools = response?.result?.tools ?? []
    const toolNames = tools.map((tool) => tool.name)

    expect(toolNames).toHaveLength(toolCategories.minimal.length)
    for (const name of toolNames) {
      expect(toolCategories.minimal).toContain(name)
    }
  })
})
