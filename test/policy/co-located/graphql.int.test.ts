/**
 * GraphQL co-located policy bridge.
 *
 * Boots a real Raffel server with `discovery.graphql`, loads a sibling
 * `<resource>.policy.yaml`, and verifies GraphQL field authz uses the same
 * policy engine as procedures/resources.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from '../../../src/server/builder.js'
import type { Principal } from '../../../src/middleware/policy/types.js'

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createHttpServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const address = s.address()
      if (!address || typeof address === 'string') {
        s.close(() => reject(new Error('no port')))
        return
      }
      const { port } = address
      s.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

type GraphQLResponse = {
  data?: Record<string, unknown>
  errors?: unknown[]
}

let dir: string
let server: ReturnType<typeof createServer> | null = null

afterEach(async () => {
  if (server) {
    await server.stop().catch(() => {})
    server = null
  }
  if (dir) {
    await rm(dir, { recursive: true, force: true })
    dir = ''
  }
})

describe('GraphQL co-located policies', () => {
  it('registers discovered GraphQL resource policies into the policy engine', async () => {
    dir = await mkdtemp(path.join(process.cwd(), '.tmp-raffel-graphql-policy-'))
    const graphqlDir = path.join(dir, 'graphql')
    await mkdir(graphqlDir, { recursive: true })

    await writeFile(
      path.join(graphqlDir, 'leads.graphql.js'),
      `
import { z } from 'zod'

export default {
  name: 'Lead',
  schema: z.object({
    id: z.string(),
    title: z.string(),
    tenantId: z.string(),
  }),
  queries: {
    list: {
      field: 'leads',
      many: true,
      resolver: async () => [
        { id: 'l1', title: 'Visible', tenantId: 't1' },
        { id: 'l2', title: 'Hidden', tenantId: 't2' },
      ],
      authz: {
        action: 'lead.read',
        resource: (lead) => ({
          type: 'lead',
          id: lead.id,
          tenantId: lead.tenantId,
        }),
        onDeny: 'filter',
      },
    },
  },
}
`.trim(),
    )

    await writeFile(
      path.join(graphqlDir, 'leads.graphql.policy.yaml'),
      `
id: lead-read
effect: allow
principals:
  - scope:lead.read
actions:
  - lead.read
resources:
  - lead:*
`.trim(),
    )

    const port = await getFreePort()
    const principal: Principal = { id: 'u', tenantId: 't1', scopes: ['lead.read'], groups: [] }
    server = createServer({
      port,
      discovery: { graphql: graphqlDir },
      graphql: { path: '/graphql', playground: false },
      policy: {
        principal: { from: 'custom', map: () => principal },
        policies: [],
      },
    })
    await server.start()

    const response = await fetch(`http://127.0.0.1:${port}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '{ leads { id title } }',
      }),
    })

    expect(response.status).toBe(200)
    const result = await response.json() as GraphQLResponse
    expect(result.errors).toBeUndefined()
    expect(result.data?.leads).toEqual([
      { id: 'l1', title: 'Visible' },
    ])
  })
})
