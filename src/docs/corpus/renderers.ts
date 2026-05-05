import type { AdapterDoc, InterceptorDoc, PatternDoc, RaffelErrorDoc } from '../../mcp/types.js'

export function formatInterceptor(i: InterceptorDoc): string {
  let md = `# ${i.name}\n\n`
  md += `**Category:** ${i.category}\n\n`
  md += `${i.description}\n\n`

  if (i.options.length > 0) {
    md += `## Options\n\n`
    md += `| Name | Type | Required | Default | Description |\n`
    md += `|------|------|----------|---------|-------------|\n`
    for (const opt of i.options) {
      md += `| ${opt.name} | \`${opt.type}\` | ${opt.required ? 'Yes' : 'No'} | ${opt.default || '-'} | ${opt.description} |\n`
    }
    md += '\n'
  }

  if (i.examples.length > 0) {
    md += `## Examples\n\n`
    for (const ex of i.examples) {
      md += `### ${ex.title}\n\n`
      md += '```typescript\n'
      md += ex.code
      md += '\n```\n\n'
    }
  }

  return md
}

export function formatAdapter(a: AdapterDoc): string {
  let md = `# ${a.name} Adapter\n\n`
  md += `**Protocol:** ${a.protocol}\n\n`
  md += `${a.description}\n\n`

  if (a.features.length > 0) {
    md += `## Features\n\n`
    for (const f of a.features) {
      md += `- ${f}\n`
    }
    md += '\n'
  }

  if (a.options.length > 0) {
    md += `## Options\n\n`
    md += `| Name | Type | Required | Default | Description |\n`
    md += `|------|------|----------|---------|-------------|\n`
    for (const opt of a.options) {
      md += `| ${opt.name} | \`${opt.type}\` | ${opt.required ? 'Yes' : 'No'} | ${opt.default || '-'} | ${opt.description} |\n`
    }
    md += '\n'
  }

  if (a.mapping) {
    md += a.mapping
    md += '\n'
  }

  if (a.examples.length > 0) {
    md += `## Examples\n\n`
    for (const ex of a.examples) {
      md += `### ${ex.title}\n\n`
      md += '```typescript\n'
      md += ex.code
      md += '\n```\n\n'
    }
  }

  return md
}

export function formatPattern(p: PatternDoc): string {
  let md = `# ${p.name}\n\n`
  md += `${p.description}\n\n`
  md += `**Components:** ${p.components.join(', ')}\n\n`

  md += `## Signature\n\n`
  md += '```typescript\n'
  md += p.signature
  md += '\n```\n\n'

  if (p.correctExamples.length > 0) {
    md += `## Correct Usage\n\n`
    for (const ex of p.correctExamples) {
      md += `### ${ex.title}\n\n`
      md += '```typescript\n'
      md += ex.code
      md += '\n```\n\n'
    }
  }

  if (p.wrongExamples.length > 0) {
    md += `## Common Mistakes (AVOID)\n\n`
    for (const ex of p.wrongExamples) {
      md += `### ${ex.title}\n\n`
      md += '```typescript\n'
      md += ex.code
      md += '\n```\n\n'
      if (ex.description) {
        md += `> **Why this is wrong:** ${ex.description}\n\n`
      }
    }
  }

  md += `## Why This Pattern?\n\n${p.why}\n`

  return md
}

export function formatError(e: RaffelErrorDoc): string {
  let md = `# ${e.code}\n\n`
  md += `**Message:** ${e.message}\n\n`
  md += `${e.description}\n\n`

  md += `## Possible Causes\n\n`
  for (const cause of e.possibleCauses) {
    md += `- ${cause}\n`
  }
  md += '\n'

  md += `## Solutions\n\n`
  for (const sol of e.solutions) {
    md += `- ${sol}\n`
  }
  md += '\n'

  if (e.examples && e.examples.length > 0) {
    md += `## Examples\n\n`
    for (const ex of e.examples) {
      md += `### ${ex.title}\n\n`
      md += '```typescript\n'
      md += ex.code
      md += '\n```\n\n'
    }
  }

  return md
}
