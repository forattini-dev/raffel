import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('fs-discovered Live Stream documentation', () => {
  it('uses the canonical discovery exports and named SSE events', async () => {
    const [streamGuide, discoveryGuide, streamExample] = await Promise.all([
      readProjectFile('docs/core/streams.md'),
      readProjectFile('docs/routing/file-system.md'),
      readProjectFile('examples/04-streams-server.ts'),
    ])

    expect(streamGuide).toContain('// src/streams/metrics/live.ts')
    expect(streamGuide).toContain('export const input = z.object')
    expect(streamGuide).toContain('export const output = z.object')
    expect(streamGuide).toContain("source.addEventListener('data'")
    expect(streamGuide).not.toContain('live.stream.ts')
    expect(streamGuide).not.toContain('export const inputSchema')
    expect(streamGuide).not.toContain('export const outputSchema')

    expect(discoveryGuide).toContain('export const input = z.object')
    expect(discoveryGuide).toContain('export const output = z.object')
    expect(discoveryGuide).toContain('ctx.signal.aborted')
    expect(discoveryGuide).toContain('finally')

    expect(streamExample).toContain("es.addEventListener('data'")
    expect(streamExample).not.toContain('es.onmessage')
  })
})
