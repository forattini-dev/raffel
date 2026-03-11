import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  createMockServer,
  createMockModule,
  generateFromSchema,
  resetFakeDataCounter,
  extractRoutes,
  toExpressPath,
  resolveResponse,
} from '../../src/mock-server/index.js'

// ── Fake Data Generator ─────────────────────────────────────────────────────

describe('generateFromSchema', () => {
  beforeEach(() => resetFakeDataCounter())

  it('returns example when available', () => {
    expect(generateFromSchema({ type: 'string', example: 'hello' })).toBe('hello')
  })

  it('returns default when available', () => {
    expect(generateFromSchema({ type: 'number', default: 42 })).toBe(42)
  })

  it('returns first enum value', () => {
    expect(generateFromSchema({ type: 'string', enum: ['active', 'inactive'] })).toBe('active')
  })

  it('generates string', () => {
    expect(generateFromSchema({ type: 'string' })).toBe('string')
  })

  it('generates email format', () => {
    expect(generateFromSchema({ type: 'string', format: 'email' })).toMatch(/@example\.com$/)
  })

  it('generates uuid format', () => {
    expect(generateFromSchema({ type: 'string', format: 'uuid' })).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('generates date format', () => {
    expect(generateFromSchema({ type: 'string', format: 'date' })).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('generates date-time format', () => {
    expect(generateFromSchema({ type: 'string', format: 'date-time' })).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('generates uri format', () => {
    expect(generateFromSchema({ type: 'string', format: 'uri' })).toMatch(/^https:\/\//)
  })

  it('generates number with constraints', () => {
    const val = generateFromSchema({ type: 'number', minimum: 10, maximum: 20 }) as number
    expect(val).toBeGreaterThanOrEqual(10)
    expect(val).toBeLessThanOrEqual(20)
  })

  it('generates integer', () => {
    const val = generateFromSchema({ type: 'integer' }) as number
    expect(Number.isInteger(val)).toBe(true)
  })

  it('generates boolean', () => {
    expect(generateFromSchema({ type: 'boolean' })).toBe(true)
  })

  it('generates array with items', () => {
    const val = generateFromSchema({
      type: 'array',
      items: { type: 'string' },
    }) as unknown[]
    expect(Array.isArray(val)).toBe(true)
    expect(val.length).toBeGreaterThanOrEqual(1)
    expect(typeof val[0]).toBe('string')
  })

  it('generates object with properties', () => {
    const val = generateFromSchema({
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
    }) as Record<string, unknown>
    expect(typeof val.name).toBe('string')
    expect(typeof val.age).toBe('number')
  })

  it('handles oneOf — uses first option', () => {
    const val = generateFromSchema({
      oneOf: [{ type: 'string' }, { type: 'number' }],
    })
    expect(typeof val).toBe('string')
  })

  it('handles allOf — merges schemas', () => {
    const val = generateFromSchema({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { b: { type: 'number' } } },
      ],
    }) as Record<string, unknown>
    expect('a' in val).toBe(true)
    expect('b' in val).toBe(true)
  })

  it('handles nullable type array', () => {
    const val = generateFromSchema({ type: ['string', 'null'] })
    expect(typeof val).toBe('string')
  })

  it('generates const value', () => {
    expect(generateFromSchema({ const: 'fixed' })).toBe('fixed')
  })

  it('respects minLength/maxLength', () => {
    const val = generateFromSchema({ type: 'string', minLength: 10 }) as string
    expect(val.length).toBeGreaterThanOrEqual(10)
  })
})

// ── Route Extraction ─────────────────────────────────────────────────────────

describe('extractRoutes', () => {
  it('extracts routes from OpenAPI paths', () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            operationId: 'listPets',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } },
                    },
                  },
                },
              },
            },
          },
          post: {
            operationId: 'createPet',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['name'],
                    properties: {
                      name: { type: 'string' },
                      tag: { type: 'string' },
                    },
                  },
                },
              },
            },
            responses: {
              '201': {
                description: 'Created',
                content: {
                  'application/json': {
                    example: { id: 1, name: 'Buddy', tag: 'dog' },
                  },
                },
              },
            },
          },
        },
        '/pets/{petId}': {
          get: {
            operationId: 'getPet',
            parameters: [
              { name: 'petId', in: 'path', required: true, schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { id: { type: 'integer' }, name: { type: 'string' }, tag: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }

    const routes = extractRoutes(spec as any)

    expect(routes).toHaveLength(3)

    const listPets = routes.find(r => r.operationId === 'listPets')!
    expect(listPets.method).toBe('GET')
    expect(listPets.pathPattern).toBe('/pets')

    const createPet = routes.find(r => r.operationId === 'createPet')!
    expect(createPet.method).toBe('POST')
    expect(createPet.requestBodyRequired).toBe(true)
    expect(createPet.requestBodySchema).toBeDefined()
    // Uses direct example
    expect(createPet.response.body).toEqual({ id: 1, name: 'Buddy', tag: 'dog' })

    const getPet = routes.find(r => r.operationId === 'getPet')!
    expect(getPet.pathPattern).toBe('/pets/:petId')
    expect(getPet.parameters).toHaveLength(1)
    expect(getPet.parameters[0].name).toBe('petId')
  })
})

describe('toExpressPath', () => {
  it('converts {param} to :param', () => {
    expect(toExpressPath('/users/{userId}/posts/{postId}')).toBe('/users/:userId/posts/:postId')
  })

  it('leaves paths without params unchanged', () => {
    expect(toExpressPath('/users')).toBe('/users')
  })
})

describe('resolveResponse', () => {
  beforeEach(() => resetFakeDataCounter())

  it('uses direct example over schema generation', () => {
    const op = {
      responses: {
        '200': {
          description: 'OK',
          content: {
            'application/json': {
              example: { id: 1, name: 'test' },
              schema: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } },
            },
          },
        },
      },
    }
    const response = resolveResponse(op as any)
    expect(response.body).toEqual({ id: 1, name: 'test' })
    expect(response.statusCode).toBe(200)
  })

  it('uses named examples when no direct example', () => {
    const op = {
      responses: {
        '200': {
          description: 'OK',
          content: {
            'application/json': {
              examples: {
                first: { value: { id: 99 } },
              },
              schema: { type: 'object' },
            },
          },
        },
      },
    }
    const response = resolveResponse(op as any)
    expect(response.body).toEqual({ id: 99 })
  })

  it('falls back to schema generation when no examples', () => {
    const op = {
      responses: {
        '200': {
          description: 'OK',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  active: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    }
    const response = resolveResponse(op as any)
    expect(response.body).toEqual({ name: 'string', active: true })
  })

  it('handles 204 no content', () => {
    const op = {
      responses: {
        '204': { description: 'No Content' },
      },
    }
    const response = resolveResponse(op as any)
    expect(response.statusCode).toBe(204)
    expect(response.body).toBeUndefined()
  })
})

// ── Integration: Mock Server ─────────────────────────────────────────────────

// Port plan (24200–24203)
const BASE = 24200

describe('createMockServer', () => {
  const petstoreSpec = {
    openapi: '3.1.0',
    info: { title: 'Petstore', version: '1.0.0' },
    paths: {
      '/pets': {
        get: {
          operationId: 'listPets',
          parameters: [
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
          ],
          responses: {
            '200': {
              description: 'A list of pets',
              content: {
                'application/json': {
                  example: [
                    { id: 1, name: 'Buddy', species: 'dog' },
                    { id: 2, name: 'Whiskers', species: 'cat' },
                  ],
                },
              },
            },
          },
        },
        post: {
          operationId: 'createPet',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name', 'species'],
                  properties: {
                    name: { type: 'string', minLength: 1 },
                    species: { type: 'string', enum: ['dog', 'cat', 'bird'] },
                    age: { type: 'integer', minimum: 0 },
                  },
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'Pet created',
              content: {
                'application/json': {
                  example: { id: 3, name: 'New Pet', species: 'dog' },
                },
              },
            },
          },
        },
      },
      '/pets/{petId}': {
        get: {
          operationId: 'getPet',
          parameters: [
            { name: 'petId', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: {
            '200': {
              description: 'A pet',
              content: {
                'application/json': {
                  example: { id: 1, name: 'Buddy', species: 'dog' },
                },
              },
            },
          },
        },
        delete: {
          operationId: 'deletePet',
          parameters: [
            { name: 'petId', in: 'path', required: true, schema: { type: 'integer' } },
          ],
          responses: {
            '204': { description: 'Pet deleted' },
          },
        },
      },
    },
  }

  let server: Awaited<ReturnType<typeof createMockServer>>
  let baseUrl: string

  beforeAll(async () => {
    server = await createMockServer({ spec: petstoreSpec, port: BASE })
    baseUrl = `http://localhost:${BASE}`
  })

  afterAll(async () => {
    await server.server.stop()
  })

  it('lists extracted routes', () => {
    expect(server.routes).toHaveLength(4)
    expect(server.routes.map(r => r.operationId).sort()).toEqual([
      'createPet', 'deletePet', 'getPet', 'listPets',
    ])
  })

  it('GET /pets returns example response', async () => {
    const res = await fetch(`${baseUrl}/pets`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')

    const body = await res.json()
    expect(body).toEqual([
      { id: 1, name: 'Buddy', species: 'dog' },
      { id: 2, name: 'Whiskers', species: 'cat' },
    ])
  })

  it('GET /pets/:petId matches path params', async () => {
    const res = await fetch(`${baseUrl}/pets/42`)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ id: 1, name: 'Buddy', species: 'dog' })
  })

  it('POST /pets with valid body returns 201 with echo', async () => {
    const res = await fetch(`${baseUrl}/pets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rex', species: 'dog', age: 3 }),
    })
    expect(res.status).toBe(201)
    const body = await res.json()
    // Echo: request body merged over the response template
    // Template was { id: 3, name: 'New Pet', species: 'dog' }
    // Request body { name: 'Rex', species: 'dog', age: 3 } overrides matching fields
    expect(body).toEqual({ id: 3, name: 'Rex', species: 'dog', age: 3 })
  })

  it('POST /pets with missing required field returns 400', async () => {
    const res = await fetch(`${baseUrl}/pets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rex' }), // missing species
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    // Raffel standard error format: { error: { code, message, details? } }
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'species' }),
      ]),
    )
  })

  it('POST /pets with invalid enum value returns 400', async () => {
    const res = await fetch(`${baseUrl}/pets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rex', species: 'fish' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.details.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'species', message: expect.stringContaining('enum') }),
      ]),
    )
  })

  it('POST /pets with empty body returns 400 (body required)', async () => {
    const res = await fetch(`${baseUrl}/pets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toContain('required')
  })

  it('POST /pets with wrong type returns 400', async () => {
    const res = await fetch(`${baseUrl}/pets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Rex', species: 'dog', age: 'not-a-number' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.details.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'age' }),
      ]),
    )
  })

  it('DELETE /pets/:id returns 204', async () => {
    const res = await fetch(`${baseUrl}/pets/1`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('returns 404-like for unknown routes (middleware returns false)', async () => {
    const res = await fetch(`${baseUrl}/unknown-path`)
    // The middleware returns false for unmatched routes, so the Raffel
    // server's default handler kicks in (likely 404 or similar)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})

// ── createMockModule ─────────────────────────────────────────────────────────

describe('createMockModule', () => {
  it('creates module + middleware from spec object', () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: { '200': { description: 'OK', content: { 'application/json': { example: [] } } } },
          },
        },
      },
    }

    const mock = createMockModule(spec)
    expect(mock.routes).toHaveLength(1)
    expect(mock.middleware).toBeTypeOf('function')
    expect(mock.module).toBeDefined()
  })

  it('accepts JSON string spec', () => {
    const spec = JSON.stringify({
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/health': {
          get: {
            responses: { '200': { description: 'OK', content: { 'application/json': { example: { status: 'ok' } } } } },
          },
        },
      },
    })

    const mock = createMockModule(spec)
    expect(mock.routes).toHaveLength(1)
    expect(mock.routes[0].response.body).toEqual({ status: 'ok' })
  })

  it('resolves $ref in components', () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              email: { type: 'string', format: 'email' },
            },
          },
        },
      },
      paths: {
        '/users': {
          get: {
            operationId: 'listUsers',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/User' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }

    resetFakeDataCounter()
    const mock = createMockModule(spec)
    expect(mock.routes).toHaveLength(1)
    const body = mock.routes[0].response.body as unknown[]
    expect(body).toHaveLength(1) // default array generates 1 item
    expect(body[0]).toHaveProperty('id')
    expect(body[0]).toHaveProperty('email')
  })

  it('validates requests can be disabled', async () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'Test', version: '1.0.0' },
      paths: {
        '/items': {
          post: {
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['name'],
                    properties: { name: { type: 'string' } },
                  },
                },
              },
            },
            responses: { '201': { description: 'Created', content: { 'application/json': { example: { ok: true } } } } },
          },
        },
      },
    }

    // With validation disabled, missing required fields should not 400
    const { server: srv } = await createMockServer({
      spec,
      port: BASE + 1,
      validateRequests: false,
    })

    const baseUrl = `http://localhost:${BASE + 1}`

    const res = await fetch(`${baseUrl}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // missing 'name'
    })
    expect(res.status).toBe(201)

    await srv.stop()
  })
})

// ── Schema-generated responses (no examples in spec) ─────────────────────────

describe('schema-generated mock responses', () => {
  let server: Awaited<ReturnType<typeof createMockServer>>
  let baseUrl: string

  beforeAll(async () => {
    resetFakeDataCounter()
    const spec = {
      openapi: '3.1.0',
      info: { title: 'No Examples API', version: '1.0.0' },
      paths: {
        '/products': {
          get: {
            operationId: 'listProducts',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'integer' },
                          name: { type: 'string' },
                          price: { type: 'number', minimum: 0, maximum: 1000 },
                          inStock: { type: 'boolean' },
                          tags: { type: 'array', items: { type: 'string' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }

    server = await createMockServer({ spec, port: BASE + 2 })
    baseUrl = `http://localhost:${BASE + 2}`
  })

  afterAll(async () => {
    await server.server.stop()
  })

  it('generates mock response from schema when no examples', async () => {
    const res = await fetch(`${baseUrl}/products`)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(1)

    const product = body[0]
    expect(typeof product.id).toBe('number')
    expect(typeof product.name).toBe('string')
    expect(typeof product.price).toBe('number')
    expect(typeof product.inStock).toBe('boolean')
    expect(Array.isArray(product.tags)).toBe(true)
  })
})
