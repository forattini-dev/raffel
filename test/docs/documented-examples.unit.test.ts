import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  compileDocumentedExamples,
  extractValidatedExamples,
} from '../../scripts/docs-validation.mjs'

const EXAMPLES = [
  ['application-owned model port', 'ai-workload-streaming.md', 'ai-model-gateway', 'application/model-gateway.ts'],
  ['canonical Live Stream', 'realtime-and-async.md', 'real-time-live-stream', 'streams/orders/live.ts'],
  ['Source-Backed Resumable Stream', 'realtime-and-async.md', 'real-time-resumable-stream', 'streams/orders/resumable.ts'],
  ['Long Poll Interaction', 'realtime-and-async.md', 'real-time-long-poll', 'http/orders/updates/get.ts'],
  ['named SSE browser consumer', 'realtime-and-async.md', 'real-time-browser-sse', 'browser/orders-live.ts'],
  ['typed AI workload stream', 'ai-workload-streaming.md', 'ai-workload-stream', 'streams/assistant/chat.ts'],
  ['AI SSE browser consumer', 'ai-workload-streaming.md', 'ai-browser-sse', 'browser/assistant-chat.ts'],
  ['service provider composition', 'service-to-service.md', 'service-provider-composition', 'server.ts'],
  ['service HTTP route', 'service-to-service.md', 'service-http-route', 'http/orders/create/post.ts'],
] as const

describe('validated documentation examples', () => {
  it.each(EXAMPLES)('keeps the %s synchronized', async (_title, guidePath, name, fixturePath) => {
    const [guide, fixture] = await Promise.all([
      readFile(new URL(`../../docs/guides/${guidePath}`, import.meta.url), 'utf8'),
      readFile(new URL(`../fixtures/docs-examples/src/${fixturePath}`, import.meta.url), 'utf8'),
    ])

    expect(extractValidatedExamples(guide).get(name)).toBe(fixture.trimEnd())
  })

  it('typechecks the canonical examples strictly against Raffel source exports', async () => {
    const diagnostics = compileDocumentedExamples(
      new URL('../fixtures/docs-examples', import.meta.url),
    )

    expect(diagnostics).toEqual([])
  })
})
