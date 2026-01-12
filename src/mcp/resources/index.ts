/**
 * Raffel MCP - Resources
 *
 * MCP resource definitions and handlers for raffel:// URIs.
 */

import type { MCPResource, MCPResourceTemplate, MCPResourceReadResult } from '../types.js'
import {
  interceptors,
  getInterceptor,
  adapters,
  getAdapter,
  patterns,
  getPattern,
  errors,
  getError,
  quickstartGuide,
  boilerplates,
  getBoilerplate,
} from '../docs/index.js'

// === Static Resources ===

export function getStaticResources(): MCPResource[] {
  const resources: MCPResource[] = []

  // Guides
  resources.push({
    uri: 'raffel://guide/quickstart',
    name: 'Quickstart Guide',
    description: 'Getting started with Raffel',
    mimeType: 'text/markdown',
  })

  // Interceptors
  for (const i of interceptors) {
    resources.push({
      uri: `raffel://interceptor/${i.name}`,
      name: i.name,
      description: i.description.slice(0, 100),
      mimeType: 'text/markdown',
    })
  }

  // Adapters
  for (const a of adapters) {
    resources.push({
      uri: `raffel://adapter/${a.name.toLowerCase()}`,
      name: `${a.name} Adapter`,
      description: a.description.slice(0, 100),
      mimeType: 'text/markdown',
    })
  }

  // Patterns
  for (const p of patterns) {
    const slug = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    resources.push({
      uri: `raffel://pattern/${slug}`,
      name: p.name,
      description: p.description.slice(0, 100),
      mimeType: 'text/markdown',
    })
  }

  // Errors
  for (const e of errors) {
    resources.push({
      uri: `raffel://error/${e.code}`,
      name: e.code,
      description: e.message,
      mimeType: 'text/markdown',
    })
  }

  // Boilerplates
  for (const [name, bp] of Object.entries(boilerplates)) {
    resources.push({
      uri: `raffel://boilerplate/${name}`,
      name: bp.title,
      description: bp.description,
      mimeType: 'text/markdown',
    })
  }

  return resources
}

// === Resource Templates ===

export function getResourceTemplates(): MCPResourceTemplate[] {
  return [
    {
      uriTemplate: 'raffel://interceptor/{name}',
      name: 'Interceptor Documentation',
      description: 'Get documentation for a specific interceptor',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://adapter/{name}',
      name: 'Adapter Documentation',
      description: 'Get documentation for a specific protocol adapter',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://pattern/{name}',
      name: 'API Pattern',
      description: 'Get documentation for a specific API pattern',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://error/{code}',
      name: 'Error Explanation',
      description: 'Get explanation for a specific error code',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://guide/{topic}',
      name: 'Guide',
      description: 'Get a specific guide',
      mimeType: 'text/markdown',
    },
    {
      uriTemplate: 'raffel://boilerplate/{template}',
      name: 'Boilerplate Code',
      description: 'Get boilerplate code for a specific template',
      mimeType: 'text/markdown',
    },
  ]
}

// === Resource Reader ===

export function readResource(uri: string): MCPResourceReadResult | null {
  const url = new URL(uri)
  const [type, ...nameParts] = url.pathname.slice(2).split('/')
  const name = nameParts.join('/')

  switch (type) {
    case 'guide': {
      if (name === 'quickstart') {
        return {
          contents: [
            {
              uri,
              mimeType: 'text/markdown',
              text: quickstartGuide,
            },
          ],
        }
      }
      return null
    }

    case 'interceptor': {
      const interceptor = getInterceptor(name)
      if (!interceptor) return null

      let md = `# ${interceptor.name}\n\n`
      md += `**Category:** ${interceptor.category}\n\n`
      md += `${interceptor.description}\n\n`

      if (interceptor.options.length > 0) {
        md += `## Options\n\n`
        md += `| Name | Type | Required | Default | Description |\n`
        md += `|------|------|----------|---------|-------------|\n`
        for (const opt of interceptor.options) {
          md += `| ${opt.name} | \`${opt.type}\` | ${opt.required ? 'Yes' : 'No'} | ${opt.default || '-'} | ${opt.description} |\n`
        }
        md += '\n'
      }

      if (interceptor.examples.length > 0) {
        md += `## Examples\n\n`
        for (const ex of interceptor.examples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
        }
      }

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    case 'adapter': {
      const adapter = getAdapter(name)
      if (!adapter) return null

      let md = `# ${adapter.name} Adapter\n\n`
      md += `**Protocol:** ${adapter.protocol}\n\n`
      md += `${adapter.description}\n\n`

      if (adapter.features.length > 0) {
        md += `## Features\n\n`
        for (const f of adapter.features) {
          md += `- ${f}\n`
        }
        md += '\n'
      }

      if (adapter.options.length > 0) {
        md += `## Options\n\n`
        md += `| Name | Type | Required | Default | Description |\n`
        md += `|------|------|----------|---------|-------------|\n`
        for (const opt of adapter.options) {
          md += `| ${opt.name} | \`${opt.type}\` | ${opt.required ? 'Yes' : 'No'} | ${opt.default || '-'} | ${opt.description} |\n`
        }
        md += '\n'
      }

      if (adapter.mapping) {
        md += adapter.mapping + '\n'
      }

      if (adapter.examples.length > 0) {
        md += `## Examples\n\n`
        for (const ex of adapter.examples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
        }
      }

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    case 'pattern': {
      const pattern = getPattern(name.replace(/-/g, ' '))
      if (!pattern) return null

      let md = `# ${pattern.name}\n\n`
      md += `${pattern.description}\n\n`
      md += `**Components:** ${pattern.components.join(', ')}\n\n`
      md += `## Signature\n\n\`\`\`typescript\n${pattern.signature}\n\`\`\`\n\n`

      if (pattern.correctExamples.length > 0) {
        md += `## Correct Usage\n\n`
        for (const ex of pattern.correctExamples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
        }
      }

      if (pattern.wrongExamples.length > 0) {
        md += `## Common Mistakes (AVOID)\n\n`
        for (const ex of pattern.wrongExamples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
          if (ex.description) {
            md += `> **Why this is wrong:** ${ex.description}\n\n`
          }
        }
      }

      md += `## Why This Pattern?\n\n${pattern.why}\n`

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    case 'error': {
      const error = getError(name)
      if (!error) return null

      let md = `# ${error.code}\n\n`
      md += `**Message:** ${error.message}\n\n`
      md += `${error.description}\n\n`

      md += `## Possible Causes\n\n`
      for (const cause of error.possibleCauses) {
        md += `- ${cause}\n`
      }
      md += '\n'

      md += `## Solutions\n\n`
      for (const sol of error.solutions) {
        md += `- ${sol}\n`
      }
      md += '\n'

      if (error.examples && error.examples.length > 0) {
        md += `## Examples\n\n`
        for (const ex of error.examples) {
          md += `### ${ex.title}\n\n\`\`\`typescript\n${ex.code}\n\`\`\`\n\n`
        }
      }

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    case 'boilerplate': {
      const bp = getBoilerplate(name as 'basic-api')
      if (!bp) return null

      let md = `# ${bp.title}\n\n`
      md += `${bp.description}\n\n`

      for (const [filename, content] of Object.entries(bp.files)) {
        md += `## ${filename}\n\n`
        const ext = filename.split('.').pop()
        md += `\`\`\`${ext === 'json' ? 'json' : 'typescript'}\n${content}\n\`\`\`\n\n`
      }

      return {
        contents: [{ uri, mimeType: 'text/markdown', text: md }],
      }
    }

    default:
      return null
  }
}
