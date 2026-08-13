import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('AI workload streaming', () => {
  it('publishes a canonical fs-discovery example backed by an injected model service', async () => {
    const [guide, sidebar] = await Promise.all([
      readProjectFile('docs/guides/ai-workload-streaming.md'),
      readProjectFile('docs/_sidebar.md'),
    ])

    expect(sidebar).toContain(
      '[AI workload streaming](/guides/ai-workload-streaming.md)',
    )
    expect(guide).toContain('// src/streams/assistant/chat.ts')
    expect(guide).toContain("server.provide('modelGateway'")
    expect(guide).toContain('ctx.services.modelGateway.stream')
    expect(guide).toContain('ctx.signal')
    expect(guide).not.toContain("from 'openai'")
    expect(guide).not.toContain("from '@anthropic-ai/sdk'")
  })

  it('models every business stream outcome explicitly', async () => {
    const guide = await readProjectFile('docs/guides/ai-workload-streaming.md')

    for (const outcome of ['delta', 'usage', 'final', 'cancelled', 'error']) {
      expect(guide).toContain(`z.literal('${outcome}')`)
    }
    expect(guide).toContain("z.discriminatedUnion('type'")
    expect(guide).toContain('export const output = aiStreamEvent')
    expect(guide).toMatch(/yield \{\s+type: 'cancelled'/)
    expect(guide).toMatch(/yield \{\s+type: 'error'/)
  })

  it('separates live delivery, replay, MCP transports, and application SSE', async () => {
    const guide = await readProjectFile('docs/guides/ai-workload-streaming.md')

    expect(guide).toContain('Live reconnection is not replay')
    expect(guide).toContain('Resumable Stream')
    expect(guide).toContain('Replay Provider')
    expect(guide).toContain('Durable Stream Source')
    expect(guide).toContain('Raffel MCP')
    expect(guide).toContain('MCP Streamable HTTP')
    expect(guide).toContain('legacy MCP SSE')
    expect(guide).toContain('application SSE')
    expect(guide).not.toContain('automatically stores generated tokens')
  })
})
