import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { z } from 'zod'
import { createRegistry } from '../../src/core/registry.js'
import { generateGraphQL } from '../../src/docs/generators/graphql-generator.js'
import { generateUIHTML } from '../../src/docs/ui/html-builder.js'
import { generateGraphQLSchema } from '../../src/graphql/schema-generator.js'
import { createSchemaRegistry } from '../../src/validation/index.js'

function renderGraphQLReference(spec: Record<string, unknown>): Document {
  const html = generateUIHTML({ basePath: '/docs', doc: spec as never, ui: {} } as never)
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://docs.example.com/',
  })
  const runtime = dom.window.document.querySelector('script[data-raffel-runtime="inline"]')
  if (runtime?.textContent) dom.window.eval(runtime.textContent)
  const graphqlTab = [...dom.window.document.querySelectorAll<HTMLButtonElement>('.protocol-tab')]
    .find((button) => button.textContent?.includes('Graphql'))
  graphqlTab?.click()
  return dom.window.document
}

describe('GraphQL generated reference', () => {
  it('normalizes slash-delimited procedure names consistently in runtime and USD', () => {
    const registry = createRegistry()
    const schemaRegistry = createSchemaRegistry()
    registry.procedure('health/get', async () => ({ status: 'ok' }))
    schemaRegistry.register('health/get', {
      output: z.object({ status: z.literal('ok') }),
    })

    const runtime = generateGraphQLSchema({ registry, schemaRegistry })
    const usd = generateGraphQL({ registry, schemaRegistry }).graphql

    expect(runtime.fields.queries).toEqual({ healthGet: 'health/get' })
    expect(runtime.fields.mutations).toEqual({})
    expect(usd.queries?.healthGet).toMatchObject({ field: 'healthGet', kind: 'query' })
    expect(usd.mutations).toBeUndefined()
  })

  it('renders concise GraphQL operations with a live request and schema trees', () => {
    const description = 'Retorna todas as contas do documento com a decisão de roteamento anexada.'
    const document = renderGraphQLReference({
      openapi: '3.1.0',
      info: { title: 'Stone API', version: '1.0.0' },
      paths: {},
      'x-usd': {
        graphql: {
          endpoint: '/graphql',
          queries: {
            stoneAccounts: {
              field: 'stoneAccounts',
              kind: 'query',
              source: 'procedure',
              description,
              input: {
                type: 'object',
                properties: {
                  document: { type: 'string', description: 'CPF ou CNPJ.' },
                },
                required: ['document'],
                additionalProperties: false,
              },
              output: {
                type: 'object',
                properties: {
                  stoneAccounts: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        stoneAccountId: { type: 'string' },
                        status: { type: 'string' },
                      },
                    },
                  },
                },
                required: ['stoneAccounts'],
              },
            },
          },
        },
      },
    })

    const main = document.getElementById('mainContent')!
    expect(main.querySelector('.endpoint-title')).toBeNull()
    expect(main.querySelector('.endpoint-description')?.textContent).toContain(description)
    expect(main.textContent?.split(description)).toHaveLength(2)

    const panel = main.querySelector<HTMLElement>('.protocol-try-it-graphql')!
    expect(panel.textContent).toContain('Live console')
    expect(panel.textContent).not.toContain('nc -u')
    expect(panel.querySelector<HTMLInputElement>('.protocol-console-url')?.value).toBe('https://docs.example.com/graphql')
    expect(panel.querySelector<HTMLButtonElement>('.protocol-console-run')?.textContent).toBe('Send request')
    const payload = JSON.parse(panel.querySelector<HTMLTextAreaElement>('.protocol-console-payload')!.value)
    expect(payload.query).toContain('query StoneAccounts')
    expect(payload.query).toContain('stoneAccounts')
    expect(payload.query).toContain('stoneAccountId')

    const schemaNames = [...main.querySelectorAll('.schema-tree-name')].map((element) => element.textContent)
    expect(schemaNames).toEqual(expect.arrayContaining(['document', 'stoneAccounts']))
    expect(main.querySelector('.sample-json')).toBeNull()
  })
})
