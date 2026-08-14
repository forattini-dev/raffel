import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('real-time capability research', () => {
  it('routes agents to current post-Spec capabilities and remaining decisions', async () => {
    const research = await readFile(
      new URL(
        '../../.red/researches/2026-08-13-streaming-long-polling-service-communication-ai.md',
        import.meta.url,
      ),
      'utf8',
    )

    expect(research).toContain('## Current capability status')
    expect(research).toContain('## Remaining decisions')
    expect(research).toContain('docs/guides/realtime-and-async.md')
    expect(research).toContain('docs/guides/service-to-service.md')
    expect(research).toContain('docs/guides/ai-workload-streaming.md')
    expect(research).not.toContain(
      'Raffel does not have a named long-polling abstraction or a dedicated long-polling guide.',
    )
    expect(research).not.toContain(
      'Current application SSE has no event ID/resume/heartbeat layer.',
    )
  })
})
