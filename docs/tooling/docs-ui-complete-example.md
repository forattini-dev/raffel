# Docs UI Complete Project Example

This example enables one documentation app for generated API/protocol reference and free-form Markdown guides.

## Server Setup

```ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })

server.procedure('tasks.list').handler(async () => {
  return [{ id: 'task_1', title: 'Ship docs' }]
})

server.enableUSD({
  basePath: '/docs',
  info: {
    title: 'Acme Service',
    version: '1.0.0',
    description: 'Generated API reference and Markdown guides in one UI.',
  },
  docsDir: {
    dir: './docs',
    routeBase: '/handbook',
    homepage: 'README.md',
  },
  ui: {
    assets: { mode: 'external' },
    theme: 'auto',
    sidebar: {
      search: true,
      docsPages: true,
      subMaxLevel: 3,
    },
    markdown: {
      autoHeader: true,
      formatUpdated: 'YYYY-MM-DD',
    },
  },
})

await server.start()
```

## Folder Layout

```text
.
|-- src/
|   `-- server.ts
`-- docs/
    |-- README.md
    |-- _sidebar.md
    |-- _navbar.md
    |-- _coverpage.md
    |-- _404.md
    |-- guides/
    |   |-- quickstart.md
    |   `-- operations.md
    `-- images/
        `-- architecture.svg
```

## Markdown Navigation

`docs/_sidebar.md`:

```md
- Guides
  - [Home](/README.md)
  - [Quickstart](/guides/quickstart.md)
  - [Operations](/guides/operations.md)
- Reference
  - [API](#/)
```

`docs/_navbar.md`:

```md
- [Home](/README.md)
- Guides
  - [Quickstart](/guides/quickstart.md)
  - [Operations](/guides/operations.md)
- [API](#/)
```

## What Gets Served

| URL | Purpose |
| --- | --- |
| `/docs` | Main docs UI with generated API/protocol reference and Markdown guides |
| `/docs/usd.json` | Full USD document, including protocol extensions when enabled |
| `/docs/usd.yaml` | YAML form of the same USD document |
| `/docs/openapi.json` | OpenAPI 3.1 export for HTTP/OpenAPI tooling |
| `/docs/-/raffel-docs.js` | Package-provided browser runtime |
| `/docs/-/raffel-docs.css` | Package-provided stylesheet |
| `/docs/-/assets/*` | Static assets from the Markdown docs directory |

`basePath` is the real HTTP mount. `docsDir.routeBase` only scopes routes inside the browser app, so `docs/guides/quickstart.md` renders as `#/handbook/guides/quickstart` when `routeBase` is `/handbook`. Use `basePath` to avoid collisions with service routes and use `routeBase` to organize Markdown pages inside the docs UI.

## Generated Protocol Reference

The generated reference comes from the server's USD document. HTTP routes come from OpenAPI-compatible `paths`; WebSocket channels, streams, JSON-RPC methods, gRPC services, TCP servers, and UDP endpoints come from `x-usd` protocol sections. When those protocol sections exist, the docs UI creates protocol tabs automatically and shows each operation with its summary, description, method/type, path, and protocol metadata.

## Markdown Guides

Markdown pages are for onboarding, operations, architecture, migration notes, tutorials, and runbooks. They support relative links, relative assets, headings with anchors, search indexing, Mermaid fences, tabs, admonitions, copy-code buttons, image zoom, Svelte-friendly component mount fences, and theme persistence.

Use generated reference for contract truth. Use Markdown for explanation and workflows.
