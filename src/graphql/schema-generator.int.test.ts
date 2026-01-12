/**
 * GraphQL Schema Generator Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { createRegistry } from '../core/registry.js'
import { createSchemaRegistry } from '../validation/index.js'
import { generateGraphQLSchema } from './schema-generator.js'

describe('generateGraphQLSchema', () => {
  let registry: ReturnType<typeof createRegistry>
  let schemaRegistry: ReturnType<typeof createSchemaRegistry>

  beforeEach(() => {
    registry = createRegistry()
    schemaRegistry = createSchemaRegistry()
  })

  it('should map procedures using meta when configured', () => {
    registry.procedure('users.get', async () => ({ id: '1' }), {
      graphql: { type: 'query' },
    })
    registry.procedure('users.create', async () => ({ id: '2' }), {
      graphql: { type: 'mutation' },
    })

    schemaRegistry.register('users.get', {
      output: z.object({ id: z.string() }),
    })
    schemaRegistry.register('users.create', {
      output: z.object({ id: z.string() }),
    })

    const result = generateGraphQLSchema({
      registry,
      schemaRegistry,
      options: { procedureMapping: 'meta' },
    })

    expect(result.queries).toContain('users.get')
    expect(result.mutations).toContain('users.create')
  })

  it('should treat missing meta as mutations when using meta mapping', () => {
    registry.procedure('users.list', async () => [])
    schemaRegistry.register('users.list', {
      output: z.array(z.string()),
    })

    const result = generateGraphQLSchema({
      registry,
      schemaRegistry,
      options: { procedureMapping: 'meta' },
    })

    expect(result.queries).not.toContain('users.list')
    expect(result.mutations).toContain('users.list')
  })
})
