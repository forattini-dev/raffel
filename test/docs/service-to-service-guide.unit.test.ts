import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readProjectFile(path: string): Promise<string> {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
}

describe('service-to-service guide', () => {
  it('publishes the server-first decision path in the canonical sidebar', async () => {
    const [guide, sidebar] = await Promise.all([
      readProjectFile('docs/guides/service-to-service.md'),
      readProjectFile('docs/_sidebar.md'),
    ])

    for (const need of [
      'Request/response',
      'Live updates',
      'Duplex communication',
      'Durable asynchronous work',
      'Internal low-overhead traffic',
    ]) {
      expect(guide).toContain(`| ${need} |`)
    }
    expect(sidebar).toContain(
      '[Server-first service-to-service](/guides/service-to-service.md)',
    )
    expect(guide).toContain('Raffel is a server runtime, not an outbound client or broker')
    expect(guide).toContain('does not generate an outbound client')
  })

  it('covers cross-service context and deployment constraints', async () => {
    const guide = await readProjectFile('docs/guides/service-to-service.md')

    expect(guide).toContain('deadline')
    expect(guide).toContain('ctx.signal')
    expect(guide).toContain('UNAUTHENTICATED')
    expect(guide).toContain('PERMISSION_DENIED')
    expect(guide).toContain('traceparent')
    expect(guide).toContain('tracestate')
    expect(guide).toContain('baggage')
    expect(guide).toContain('load balancer')
    expect(guide).toContain('service discovery')
    expect(guide).toContain('connection draining')
  })

  it('bounds retries and assigns resilience and durability ownership accurately', async () => {
    const guide = await readProjectFile('docs/guides/service-to-service.md')

    expect(guide).toContain('Retry only idempotent calls or calls protected by an idempotency key')
    expect(guide).toContain('createCircuitBreakerInterceptor')
    expect(guide).toContain('createBulkheadInterceptor')
    expect(guide).toContain('createFallbackInterceptor')
    expect(guide).toContain('reruns the inbound handler')
    expect(guide).toContain('The application owns brokers, workers, and durable job state')
    expect(guide).not.toContain('Raffel automatically calls downstream services')
  })
})
