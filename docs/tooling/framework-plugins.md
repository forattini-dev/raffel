# Framework Plugins

If you are building a higher-level framework or platform on top of Raffel,
`ServerPlugin` is the public extension surface for runtime composition.

Use plugins when you need to:

- register framework-owned procedures, streams, channels, or resources
- run startup and shutdown logic that is not ordinary request middleware
- attach framework metadata to `server.preview()`

Use providers when you need shared dependencies inside handlers.

That distinction matters:

- providers solve dependency injection
- plugins solve runtime extension and lifecycle

For the broader roadmap around presets, richer MCP composition, and framework
bootstrap, see the [Framework Runtime RFC](/reference/framework-runtime-rfc.md).

---

## Quick Start

```ts
import { createServer, type ServerPlugin } from 'raffel'

const purplePlugin: ServerPlugin = {
  name: 'purple',

  register({ server }) {
    server.procedure('purple.health').handler(async () => ({
      ok: true,
      runtime: 'purple',
    }))
  },

  async beforeStart({ providers }) {
    const services = providers as { db?: { ping(): Promise<void> } }
    await services.db?.ping()
  },

  inspect() {
    return {
      namespace: 'purple',
      title: 'Purple Runtime',
      nodes: [
        {
          id: 'purple:runtime',
          kind: 'runtime',
          label: 'Purple Runtime',
          data: {
            resources: 12,
            workers: 3,
          },
        },
      ],
    }
  },
}

const server = createServer({
  port: 3000,
  plugins: [purplePlugin],
})
```

You can also register later:

```ts
server.usePlugin(purplePlugin)
```

Plugins must be registered before `server.start()`.

---

## Providers vs Plugins

Use a provider when:

- a handler needs a shared dependency
- you want a singleton database, cache, client, or service object
- the main consumer is `ctx.services`

Use a plugin when:

- you need to register framework-owned handlers or routes
- you need startup/shutdown orchestration
- you want framework metadata to appear in the runtime inspection graph

Prefer this split:

```ts
const server = createServer({ port: 3000 })
  .provide('db', () => createDatabase())
  .usePlugin({
    name: 'purple',
    register({ server }) {
      server.procedure('purple.ready').handler(async () => 'ok')
    },
    beforeStart: async ({ providers }) => {
      const services = providers as { db: { migrate(): Promise<void> } }
      await services.db.migrate()
    },
  })
```

Avoid treating providers as lifecycle hooks with custom `setup({ server, db })`
semantics. That is plugin territory.

---

## Lifecycle Hooks

Available hooks:

- `register`
- `beforeStart`
- `afterStart`
- `beforeStop`
- `afterStop`
- `inspect`

Execution order:

1. plugins register in declaration order
2. `beforeStart` runs in declaration order
3. `afterStart` runs in declaration order
4. `beforeStop` runs in reverse order
5. `afterStop` runs in reverse order

This makes plugin teardown behave like stack unwinding.

---

## Runtime Inspection Extensions

Frameworks can attach namespaced metadata to the canonical runtime graph.

```ts
server.usePlugin({
  name: 'purple-inspect',
  inspect: ({ preview }) => ({
    namespace: 'purple',
    title: 'Purple Runtime',
    nodes: [
      {
        id: 'purple:summary',
        kind: 'summary',
        label: 'Purple Summary',
        data: {
          operationCount: preview.operations.length,
          services: preview.services.map((service) => service.name),
        },
      },
      {
        id: 'purple:workers',
        kind: 'worker-group',
        label: 'Workers',
        children: [
          {
            id: 'purple:worker:emails',
            kind: 'worker',
            label: 'emails',
            data: { concurrency: 4 },
          },
        ],
      },
    ],
  }),
})

const preview = server.preview()
console.log(preview.extensions)
```

This is the right place to publish framework-owned metadata such as:

- resources and collections
- workers and schedules
- migrations
- policy summaries
- provider/runtime summaries

If you are building custom DX on top of Raffel, read from `server.preview()`
instead of maintaining a parallel registry.

---

## MCP And Framework Wrappers

If your framework also exposes MCP, prefer Raffel's integrated `mcp` mode over
running a second MCP server by default:

```ts
const server = createServer({
  port: 3000,
  mcp: {
    path: '/mcp',
    resources: [
      {
        uri: 'purple://runtime',
        name: 'Purple Runtime',
        handler: async () => ({
          contents: [{
            uri: 'purple://runtime',
            mimeType: 'application/json',
            text: JSON.stringify(server.preview(), null, 2),
          }],
        }),
      },
    ],
  },
  plugins: [purplePlugin],
})
```

Current guidance:

- use `mcp` for tools/resources/prompts exposure
- use plugins for lifecycle and runtime graph contribution
- keep framework tooling derived from the same Raffel server whenever possible

For deeper MCP composition in core, follow the
[Framework Runtime RFC](/reference/framework-runtime-rfc.md).

---

## Recommended Shape For Framework Authors

Good layering:

- providers for DB, cache, auth clients, policy engines, queues
- plugins for registration, startup work, shutdown work, inspection metadata
- `ctx.services` as the canonical handler dependency surface
- `server.preview()` as the canonical runtime metadata surface

This keeps the framework thin and keeps Raffel as the runtime substrate.
