/**
 * Resource Builder for REST CRUD Operations
 *
 * Dramatically reduces verbosity when defining REST resources.
 * Instead of defining 5+ procedures with .http() config each,
 * define a single resource with all CRUD operations.
 *
 * @example
 * ```typescript
 * // VERBOSE (without resource builder):
 * server.procedure('users.list')
 *   .input(ListUsersInput)
 *   .output(z.array(User))
 *   .http('/users', 'GET')
 *   .handler(async (input, ctx) => db.users.list(input))
 *
 * server.procedure('users.get')
 *   .input(z.object({ id: z.string() }))
 *   .output(User)
 *   .http('/users/:id', 'GET')
 *   .handler(async (input, ctx) => db.users.findById(input.id))
 *
 * server.procedure('users.create')
 *   .input(CreateUserInput)
 *   .output(User)
 *   .http('/users', 'POST')
 *   .handler(async (input, ctx) => db.users.create(input))
 *
 * // ... 2 more for update and delete
 *
 * // CONCISE (with resource builder):
 * server.resource('users', User)
 *   .list(z.object({ page: z.number().optional() }), async (input) => db.users.list(input))
 *   .get(async (id) => db.users.findById(id))
 *   .create(CreateUserInput, async (input) => db.users.create(input))
 *   .update(UpdateUserInput, async (id, input) => db.users.update(id, input))
 *   .delete(async (id) => db.users.delete(id))
 * ```
 */

import type { z } from 'zod'
import type { Registry } from '../core/registry.js'
import type { SchemaRegistry, HandlerSchema } from '../validation/index.js'
import type { Interceptor, Context } from '../types/index.js'
import { createValidationInterceptor } from '../validation/index.js'

/**
 * Resource builder options
 */
export interface ResourceBuilderOptions {
  registry: Registry
  schemaRegistry: SchemaRegistry
  name: string
  basePath: string
  outputSchema?: z.ZodType
  inheritedInterceptors?: Interceptor[]
  tags?: string[]
}

/**
 * Handler context with resource-specific helpers
 */
export interface ResourceContext extends Context {
  /** ID extracted from path parameter */
  id?: string
}

/**
 * Resource builder for fluent REST CRUD definition
 */
export interface ResourceBuilder<TOutput = unknown> {
  /**
   * Configure interceptors for all operations
   */
  use(interceptor: Interceptor): ResourceBuilder<TOutput>

  /**
   * Define tags for documentation
   */
  tags(tags: string[]): ResourceBuilder<TOutput>

  /**
   * Define GET /resources → List all
   *
   * @example
   * ```typescript
   * .list(
   *   z.object({ page: z.number().optional(), limit: z.number().optional() }),
   *   async (input, ctx) => db.users.list(input)
   * )
   * ```
   */
  list<TInput>(
    inputSchema: z.ZodType<TInput>,
    handler: (input: TInput, ctx: Context) => Promise<TOutput[]>
  ): ResourceBuilder<TOutput>

  /**
   * Define GET /resources → List all (without input schema)
   */
  list(handler: (input: unknown, ctx: Context) => Promise<TOutput[]>): ResourceBuilder<TOutput>

  /**
   * Define GET /resources/:id → Get one
   *
   * @example
   * ```typescript
   * .get(async (id, ctx) => db.users.findById(id))
   * ```
   */
  get(handler: (id: string, ctx: Context) => Promise<TOutput | null>): ResourceBuilder<TOutput>

  /**
   * Define POST /resources → Create
   *
   * @example
   * ```typescript
   * .create(
   *   z.object({ name: z.string(), email: z.string() }),
   *   async (input, ctx) => db.users.create(input)
   * )
   * ```
   */
  create<TInput>(
    inputSchema: z.ZodType<TInput>,
    handler: (input: TInput, ctx: Context) => Promise<TOutput>
  ): ResourceBuilder<TOutput>

  /**
   * Define PUT /resources/:id → Full update
   *
   * @example
   * ```typescript
   * .update(
   *   z.object({ name: z.string(), email: z.string() }),
   *   async (id, input, ctx) => db.users.update(id, input)
   * )
   * ```
   */
  update<TInput>(
    inputSchema: z.ZodType<TInput>,
    handler: (id: string, input: TInput, ctx: Context) => Promise<TOutput>
  ): ResourceBuilder<TOutput>

  /**
   * Define PATCH /resources/:id → Partial update
   *
   * @example
   * ```typescript
   * .patch(
   *   z.object({ name: z.string().optional() }),
   *   async (id, input, ctx) => db.users.patch(id, input)
   * )
   * ```
   */
  patch<TInput>(
    inputSchema: z.ZodType<TInput>,
    handler: (id: string, input: TInput, ctx: Context) => Promise<TOutput>
  ): ResourceBuilder<TOutput>

  /**
   * Define DELETE /resources/:id → Delete
   *
   * @example
   * ```typescript
   * .delete(async (id, ctx) => db.users.delete(id))
   * ```
   */
  delete(handler: (id: string, ctx: Context) => Promise<void | TOutput>): ResourceBuilder<TOutput>

  /**
   * Define custom action on collection: POST /resources/:action
   *
   * @example
   * ```typescript
   * .action('import', ImportSchema, async (input, ctx) => {
   *   return db.users.bulkCreate(input.items)
   * })
   * // → POST /users/import
   * ```
   */
  action<TInput, TActionOutput = TOutput>(
    actionName: string,
    inputSchema: z.ZodType<TInput>,
    handler: (input: TInput, ctx: Context) => Promise<TActionOutput>
  ): ResourceBuilder<TOutput>

  /**
   * Define custom action on item: POST /resources/:id/:action
   *
   * @example
   * ```typescript
   * .itemAction('activate', async (id, ctx) => {
   *   return db.users.activate(id)
   * })
   * // → POST /users/:id/activate
   * ```
   */
  itemAction<TInput = void, TActionOutput = TOutput>(
    actionName: string,
    handler: (id: string, ctx: Context) => Promise<TActionOutput>
  ): ResourceBuilder<TOutput>

  itemAction<TInput, TActionOutput = TOutput>(
    actionName: string,
    inputSchema: z.ZodType<TInput>,
    handler: (id: string, input: TInput, ctx: Context) => Promise<TActionOutput>
  ): ResourceBuilder<TOutput>
}

/**
 * Create a resource builder for REST CRUD operations
 */
export function createResourceBuilder<TOutput = unknown>(
  options: ResourceBuilderOptions
): ResourceBuilder<TOutput> {
  const {
    registry,
    schemaRegistry,
    name,
    basePath,
    outputSchema,
    inheritedInterceptors = [],
  } = options

  const interceptors: Interceptor[] = [...inheritedInterceptors]
  let resourceTags: string[] = options.tags ?? [name]

  const builder: ResourceBuilder<TOutput> = {
    use(interceptor) {
      interceptors.push(interceptor)
      return builder
    },

    tags(tags) {
      resourceTags = tags
      return builder
    },

    list(inputOrHandler: any, maybeHandler?: any) {
      const hasSchema = typeof maybeHandler === 'function'
      const inputSchema = hasSchema ? inputOrHandler : undefined
      const handler = hasSchema ? maybeHandler : inputOrHandler

      const procedureName = `${name}.list`
      const schema: HandlerSchema = {}
      if (inputSchema) schema.input = inputSchema
      if (outputSchema) schema.output = outputSchema

      if (Object.keys(schema).length > 0) {
        schemaRegistry.register(procedureName, schema)
      }

      const finalInterceptors = [...interceptors]
      if (inputSchema) {
        finalInterceptors.unshift(createValidationInterceptor({ input: inputSchema }))
      }

      registry.procedure(
        procedureName,
        async (input: unknown, ctx: Context) => handler(input, ctx),
        {
          httpPath: basePath,
          httpMethod: 'GET',
          tags: resourceTags,
          summary: `List all ${name}`,
          interceptors: finalInterceptors.length > 0 ? finalInterceptors : undefined,
        }
      )

      return builder
    },

    get(handler) {
      const procedureName = `${name}.get`
      const schema: HandlerSchema = {}
      if (outputSchema) schema.output = outputSchema

      if (Object.keys(schema).length > 0) {
        schemaRegistry.register(procedureName, schema)
      }

      registry.procedure(
        procedureName,
        async (input: { id: string }, ctx: Context) => handler(input.id, ctx),
        {
          httpPath: `${basePath}/:id`,
          httpMethod: 'GET',
          tags: resourceTags,
          summary: `Get ${name} by ID`,
          interceptors: interceptors.length > 0 ? interceptors : undefined,
        }
      )

      return builder
    },

    create(inputSchema, handler) {
      const procedureName = `${name}.create`
      const schema: HandlerSchema = { input: inputSchema }
      if (outputSchema) schema.output = outputSchema

      schemaRegistry.register(procedureName, schema)

      const finalInterceptors = [
        createValidationInterceptor({ input: inputSchema }),
        ...interceptors,
      ]

      registry.procedure(
        procedureName,
        async (input: unknown, ctx: Context) => handler(input as any, ctx),
        {
          httpPath: basePath,
          httpMethod: 'POST',
          tags: resourceTags,
          summary: `Create ${name}`,
          interceptors: finalInterceptors,
        }
      )

      return builder
    },

    update(inputSchema, handler) {
      const procedureName = `${name}.update`
      const schema: HandlerSchema = { input: inputSchema }
      if (outputSchema) schema.output = outputSchema

      schemaRegistry.register(procedureName, schema)

      const finalInterceptors = [
        createValidationInterceptor({ input: inputSchema }),
        ...interceptors,
      ]

      registry.procedure(
        procedureName,
        async (input: { id: string } & Record<string, unknown>, ctx: Context) =>
          handler(input.id, input as any, ctx),
        {
          httpPath: `${basePath}/:id`,
          httpMethod: 'PUT',
          tags: resourceTags,
          summary: `Update ${name}`,
          interceptors: finalInterceptors,
        }
      )

      return builder
    },

    patch(inputSchema, handler) {
      const procedureName = `${name}.patch`
      const schema: HandlerSchema = { input: inputSchema }
      if (outputSchema) schema.output = outputSchema

      schemaRegistry.register(procedureName, schema)

      const finalInterceptors = [
        createValidationInterceptor({ input: inputSchema }),
        ...interceptors,
      ]

      registry.procedure(
        procedureName,
        async (input: { id: string } & Record<string, unknown>, ctx: Context) =>
          handler(input.id, input as any, ctx),
        {
          httpPath: `${basePath}/:id`,
          httpMethod: 'PATCH',
          tags: resourceTags,
          summary: `Partially update ${name}`,
          interceptors: finalInterceptors,
        }
      )

      return builder
    },

    delete(handler) {
      const procedureName = `${name}.delete`

      registry.procedure(
        procedureName,
        async (input: { id: string }, ctx: Context) => handler(input.id, ctx),
        {
          httpPath: `${basePath}/:id`,
          httpMethod: 'DELETE',
          tags: resourceTags,
          summary: `Delete ${name}`,
          interceptors: interceptors.length > 0 ? interceptors : undefined,
        }
      )

      return builder
    },

    action(actionName, inputSchema, handler) {
      const procedureName = `${name}.${actionName}`
      const schema: HandlerSchema = { input: inputSchema }

      schemaRegistry.register(procedureName, schema)

      const finalInterceptors = [
        createValidationInterceptor({ input: inputSchema }),
        ...interceptors,
      ]

      registry.procedure(
        procedureName,
        async (input: unknown, ctx: Context) => handler(input as any, ctx),
        {
          httpPath: `${basePath}/${actionName}`,
          httpMethod: 'POST',
          tags: resourceTags,
          summary: `${actionName} action on ${name}`,
          interceptors: finalInterceptors,
        }
      )

      return builder
    },

    itemAction(actionName: string, schemaOrHandler: any, maybeHandler?: any) {
      const hasSchema = typeof maybeHandler === 'function'
      const inputSchema = hasSchema ? schemaOrHandler : undefined
      const handler = hasSchema ? maybeHandler : schemaOrHandler

      const procedureName = `${name}.${actionName}`
      const schema: HandlerSchema = {}
      if (inputSchema) schema.input = inputSchema

      if (Object.keys(schema).length > 0) {
        schemaRegistry.register(procedureName, schema)
      }

      const finalInterceptors = [...interceptors]
      if (inputSchema) {
        finalInterceptors.unshift(createValidationInterceptor({ input: inputSchema }))
      }

      registry.procedure(
        procedureName,
        async (input: { id: string } & Record<string, unknown>, ctx: Context) =>
          hasSchema ? handler(input.id, input, ctx) : handler(input.id, ctx),
        {
          httpPath: `${basePath}/:id/${actionName}`,
          httpMethod: 'POST',
          tags: resourceTags,
          summary: `${actionName} action on ${name} item`,
          interceptors: finalInterceptors.length > 0 ? finalInterceptors : undefined,
        }
      )

      return builder
    },
  }

  return builder
}
