#!/usr/bin/env node
/**
 * Raffel MCP CLI
 *
 * Command-line interface for starting the Raffel MCP server.
 *
 * Usage:
 *   raffel-mcp                          # Start with stdio transport (default)
 *   raffel-mcp --transport http         # Start HTTP server
 *   raffel-mcp --transport sse          # Start SSE server
 *   raffel-mcp --port 3200              # Custom port for HTTP/SSE
 *   raffel-mcp --category minimal       # Only essential tools
 *   raffel-mcp --category docs,codegen  # Multiple categories
 *   raffel-mcp --debug                  # Enable debug logging
 *   raffel-mcp --list-categories        # Show available categories
 */

import { runMCPServer } from './server.js'
import type { MCPTransportMode, CategoryName } from './types.js'
import { toolCategories } from './tools/index.js'

// Parse command-line arguments
function parseArgs(): {
  transport: MCPTransportMode
  port: number
  debug: boolean
  category: CategoryName[]
  listCategories: boolean
} {
  const args = process.argv.slice(2)
  const result = {
    transport: 'stdio' as MCPTransportMode,
    port: 3200,
    debug: false,
    category: ['full'] as CategoryName[],
    listCategories: false,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg === '--transport' || arg === '-t') {
      const value = args[++i]
      if (value === 'stdio' || value === 'http' || value === 'sse') {
        result.transport = value
      }
    } else if (arg === '--port' || arg === '-p') {
      result.port = parseInt(args[++i], 10) || 3200
    } else if (arg === '--debug' || arg === '-d') {
      result.debug = true
    } else if (arg === '--category' || arg === '-c') {
      const value = args[++i]
      if (value) {
        result.category = value.split(',').map((c) => c.trim()) as CategoryName[]
      }
    } else if (arg === '--list-categories') {
      result.listCategories = true
    } else if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    } else if (arg === '--version' || arg === '-v') {
      console.log('raffel-mcp version 0.1.0')
      process.exit(0)
    }
  }

  return result
}

function printHelp(): void {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                    Raffel MCP Server                              ║
║            Unified Multi-Protocol Server Runtime                  ║
╚═══════════════════════════════════════════════════════════════════╝

Usage: raffel-mcp [options]

Options:
  -t, --transport <mode>    Transport mode: stdio, http, sse (default: stdio)
  -p, --port <port>         Port for HTTP/SSE transport (default: 3200)
  -c, --category <cats>     Tool categories (comma-separated)
  -d, --debug               Enable debug logging
  --list-categories         Show available tool categories
  -h, --help                Show this help message
  -v, --version             Show version

Categories:
  minimal     Essential tools only (~2.5K tokens)
  docs        Documentation tools (~3K tokens)
  codegen     Code generation tools (~4K tokens)
  full        All tools (~8K tokens)

Examples:
  raffel-mcp                          Start with stdio (for Claude Code)
  raffel-mcp -t http -p 3200          Start HTTP server on port 3200
  raffel-mcp -c minimal,codegen       Only minimal and codegen tools
  raffel-mcp --debug                  Enable debug output

For Claude Code integration, add to ~/.claude/mcp.json:
{
  "mcpServers": {
    "raffel": {
      "command": "npx",
      "args": ["raffel-mcp"]
    }
  }
}
`)
}

function printCategories(): void {
  console.log(`
Available Tool Categories:

  minimal (~2.5K tokens)
    Essential tools for quick queries
    Tools: ${toolCategories.minimal.join(', ')}

  docs (~3K tokens)
    Documentation and search tools
    Tools: ${toolCategories.docs.join(', ')}

  codegen (~4K tokens)
    Code generation tools
    Tools: ${toolCategories.codegen.join(', ')}

  full (~8K tokens)
    All available tools
    Tools: ${toolCategories.full.join(', ')}

Usage:
  raffel-mcp --category minimal            Single category
  raffel-mcp --category minimal,codegen    Multiple categories
`)
}

function printBanner(options: ReturnType<typeof parseArgs>): void {
  const categoryStr = options.category.join(', ')
  const tokenEstimate =
    options.category.includes('full')
      ? '~8K'
      : options.category.includes('codegen')
        ? '~4K'
        : options.category.includes('docs')
          ? '~3K'
          : '~2.5K'

  console.error(`
╔═══════════════════════════════════════════════════════════════════╗
║                    Raffel MCP Server                              ║
╚═══════════════════════════════════════════════════════════════════╝

  Transport:  ${options.transport}
  Port:       ${options.port}
  Debug:      ${options.debug ? 'enabled' : 'disabled'}
  Category:   ${categoryStr} (${tokenEstimate} tokens)

  Available tools:
`)

  const enabledTools = new Set<string>()
  for (const cat of options.category) {
    const catTools = toolCategories[cat as keyof typeof toolCategories] || []
    for (const tool of catTools) {
      enabledTools.add(tool)
    }
  }

  for (const tool of toolCategories.full) {
    const enabled = enabledTools.has(tool)
    console.error(`    ${enabled ? '✓' : '✗'} ${tool}${enabled ? '' : ' (disabled)'}`)
  }

  console.error('')
}

// Main entry point
async function main(): Promise<void> {
  const options = parseArgs()

  if (options.listCategories) {
    printCategories()
    process.exit(0)
  }

  // Print banner for non-stdio transports
  if (options.transport !== 'stdio') {
    printBanner(options)
  }

  await runMCPServer({
    transport: options.transport,
    port: options.port,
    debug: options.debug,
    category: options.category,
  })
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
