import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('real-time and async guide', () => {
  it('publishes a complete decision matrix in the canonical sidebar', async () => {
    const [guide, sidebar] = await Promise.all([
      readProjectFile('docs/guides/realtime-and-async.md'),
      readProjectFile('docs/_sidebar.md'),
    ])

    for (const interaction of [
      'Polling',
      'Long Poll Interaction',
      'Live Stream over SSE',
      'Resumable Stream',
      'WebSocket duplex',
      'gRPC duplex',
      'Asynchronous job resource',
      'Event',
    ]) {
      expect(guide).toContain(`| ${interaction} |`)
    }
    expect(sidebar).toContain(
      '[Real-time & asynchronous interactions](/guides/realtime-and-async.md)',
    )
  })

  it('uses current fs-discovery exports and named SSE listeners', async () => {
    const guide = await readProjectFile('docs/guides/realtime-and-async.md')

    expect(guide).toContain('// src/streams/orders/live.ts')
    expect(guide).toContain('export const input = z.object')
    expect(guide).toContain('export const output = z.object')
    expect(guide).toContain('export const snapshot = z.object')
    expect(guide).toContain('export const resumable = {')
    expect(guide).toContain('export default async function* liveOrders')
    expect(guide).toContain("source.addEventListener('data'")
    expect(guide).toContain("source.addEventListener('snapshot'")
    expect(guide).not.toContain('source.onmessage')
    expect(guide).not.toContain('inputSchema')
    expect(guide).not.toContain('outputSchema')
  })

  it('separates guarantees and states operational ownership explicitly', async () => {
    const guide = await readProjectFile('docs/guides/realtime-and-async.md')

    expect(guide).toContain('reconnection is not replay')
    expect(guide).toContain('at-least-once replay')
    expect(guide).toContain('Long polling requires application storage or pub-sub')
    expect(guide).toContain('proxy idle timeout')
    expect(guide).toContain('heartbeatMs')
    expect(guide).toContain('ctx.signal.aborted')
    expect(guide).toContain('connection limits')
    expect(guide).toContain('EventSource cannot set an Authorization header')
  })
})
