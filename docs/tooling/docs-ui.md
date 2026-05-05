# Raffel Docs UI

Raffel has two documentation inputs that meet in one UI.

USD/OpenAPI documentation is generated from the API contract registered in the server: procedures, REST resources, schemas, protocols, tags, security, streams, WebSocket channels, JSON-RPC, gRPC, TCP, and UDP. This is the source for `/docs/usd.json`, `/docs/usd.yaml`, `/docs/openapi.json`, and the generated API reference shown in `/docs`.

Markdown documentation is free-form product documentation, closer to Markdown docs: guides, concepts, tutorials, migration notes, architecture notes, and README-style pages. It comes from `docsDir` or explicit `documentation.pages`, and it is rendered in the same `/docs` UI next to the generated API reference.

## Generated API And Protocol Docs

The API/protocol reference is generated from Raffel metadata, not from Markdown files. Markdown can explain how to use a channel or endpoint, but the source of truth for shapes, methods, schemas, and protocol behavior is USD.

| API surface | USD/OpenAPI source | UI behavior | Export |
| --- | --- | --- | --- |
| HTTP procedures and REST resources | OpenAPI `paths` plus Raffel metadata | Rendered as HTTP endpoint reference with request/response schemas and examples | `/docs/openapi.json`, `/docs/usd.json` |
| WebSocket channels | `x-usd.websocket.channels` | Rendered under the WebSocket protocol tab with channel type, params, subscribe/publish schemas, and examples | `/docs/usd.json` |
| Streams / SSE | `x-usd.streams.endpoints` | Rendered under the Streams protocol tab with direction, message schema, and streaming examples | `/docs/usd.json` |
| JSON-RPC | `x-usd.jsonrpc.methods` | Rendered under the JSON-RPC protocol tab with params, result, errors, notifications, and streaming flags | `/docs/usd.json` |
| gRPC | `x-usd.grpc.services` | Rendered under the gRPC protocol tab with service methods, request/response schemas, and streaming type | `/docs/usd.json` |
| TCP | `x-usd.tcp.servers` | Rendered under the TCP protocol tab with host, port, TLS, framing, and message schemas | `/docs/usd.json` |
| UDP | `x-usd.udp.endpoints` | Rendered under the UDP protocol tab with host, port, packet sizing, and message schemas | `/docs/usd.json` |
| Auth and security | OpenAPI `security`, `components.securitySchemes`, and Raffel policy metadata | Rendered as part of generated endpoint/protocol metadata | `/docs/openapi.json`, `/docs/usd.json` |

OpenAPI is intentionally the compatibility export for HTTP tooling. It strips protocol-specific USD extensions when needed. USD is the complete Raffel contract and should be used when you need WebSocket, streams, JSON-RPC, gRPC, TCP, UDP, policy, or multi-protocol metadata.

Markdown pages do not replace this generated reference. They complement it. For example, a Markdown guide can explain "how to subscribe to private channels", while `x-usd.websocket.channels` remains the generated source for channel names, payload schemas, auth requirements, and examples.

## Enable Both

For a project with a conventional `./docs` directory, enable both generated API docs and Markdown docs with `docsDir: true`:

```ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })
  .enableUSD({
    basePath: '/docs',
    info: {
      title: 'Acme API',
      version: '1.0.0',
      description: 'Generated API reference plus product guides.',
    },
    docsDir: true,
    ui: {
      assets: { mode: 'external' },
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

See [Docs UI Complete Project Example](./docs-ui-complete-example.md) for a full project layout with generated API/protocol reference and Markdown guides in one UI. See [Docs UI Protocol Examples](./docs-ui-protocol-examples.md) for HTTP, WebSocket, streams, JSON-RPC, gRPC, TCP, and UDP examples.

This exposes:

| Route | Purpose |
| --- | --- |
| `/docs` | Unified docs UI |
| `/docs/usd.json` | Full USD document with `x-usd` protocol extensions |
| `/docs/usd.yaml` | Full USD document as YAML |
| `/docs/openapi.json` | OpenAPI 3.1 export for Swagger/OpenAPI tooling |
| `/docs/-/raffel-docs.js` | Reusable frontend docs runtime |
| `/docs/-/marked.umd.js` | Packaged Markdown engine used by the external runtime |
| `/docs/-/marked-renderer.js` | Raffel renderer bridge for Markdown-specific behavior |
| `/docs/-/raffel-docs.css` | Reusable frontend docs stylesheet |
| `/docs/-/assets/*` | Static assets referenced by Markdown pages |

## Route Boundaries

There are two different routing layers:

| Option | Layer | Example | What it controls |
| --- | --- | --- | --- |
| `basePath` | HTTP route | `/my-path` | Where the docs app, USD JSON, OpenAPI JSON, runtime assets, and Markdown assets are mounted |
| `docsDir.routeBase` | In-app Markdown route | `/guides` | Where file-backed Markdown pages live inside the docs UI hash router |

Use `basePath` to avoid real HTTP route collisions with your API:

```ts
server.enableUSD({
  basePath: '/internal-docs',
  info: { title: 'Acme API', version: '1.0.0' },
  docsDir: true,
})
```

This mounts the docs system at:

| Route | Purpose |
| --- | --- |
| `/internal-docs` | Unified docs UI |
| `/internal-docs/usd.json` | USD JSON |
| `/internal-docs/openapi.json` | OpenAPI JSON |
| `/internal-docs/-/assets/*` | Static assets from `docsDir` |

Use `docsDir.routeBase` to avoid in-app route collisions between file-backed Markdown pages and other docs UI states:

```ts
server.enableUSD({
  basePath: '/internal-docs',
  info: { title: 'Acme API', version: '1.0.0' },
  docsDir: {
    dir: './docs',
    routeBase: '/guides',
  },
})
```

With that setup, `docs/quickstart.md` becomes `#/guides/quickstart` inside `/internal-docs`. It does not become a real HTTP route like `/guides/quickstart`, so it will not collide with API handlers registered in Raffel.

Absolute Markdown links also stay inside the configured docs route base. For example, `[API](/api.md)` from a file-backed Markdown page resolves to `#/guides/api` when `docsDir.routeBase` is `/guides`; relative links such as `[Next](./next.md)` continue to resolve from the current page's folder.

## Markdown Directory

When `docsDir: true`, Raffel loads `./docs`. A custom directory can be provided as a string:

```ts
server.enableUSD({
  info: { title: 'Acme API', version: '1.0.0' },
  docsDir: './handbook',
})
```

Use the object form when you need route aliases, a route prefix, a custom homepage, or excluded directories:

```ts
server.enableUSD({
  info: { title: 'Acme API', version: '1.0.0' },
  docsDir: {
    dir: './docs',
    routeBase: '/guides',
    homepage: 'home.md',
    aliases: {
      '/old-start.md': '/getting-started.md',
      '/legacy/(.*).md': '/guides/$1.md',
    },
    excludeDirs: ['node_modules', '.git', 'dist', 'build'],
  },
})
```

The loader understands these file-backed Markdown files:

| File | Behavior |
| --- | --- |
| `README.md` | Homepage, unless `homepage` is configured |
| `_sidebar.md` | Sidebar sections and page ordering |
| nested `_sidebar.md` | Local sidebar for nested docs folders |
| `_navbar.md` | Top navigation, including nested dropdowns |
| `_coverpage.md` | Intro/cover Markdown above the app content |
| `_404.md` | Custom missing-page content |
| other `.md` files | Rendered as routable documentation pages |

Static assets beside Markdown pages are served under `/docs/-/assets/*`. Markdown files themselves are not served as raw assets.

For example:

| File | Served as |
| --- | --- |
| `docs/custom.css` | `/docs/-/assets/custom.css` with `text/css` |
| `docs/custom.js` | `/docs/-/assets/custom.js` with `application/javascript` |
| `docs/module.mjs` | `/docs/-/assets/module.mjs` with `application/javascript` |
| `docs/images/logo.svg` | `/docs/-/assets/images/logo.svg` with `image/svg+xml` |

Use the docs asset path for files that belong to the documentation UI. Use the general static-file middleware for public application assets outside the docs tree.

## Recommended Layout

```text
docs/
  README.md
  _sidebar.md
  _navbar.md
  _coverpage.md
  _404.md
  guides/
    quickstart.md
    deployment.md
  images/
    architecture.svg
```

Example `_sidebar.md`:

```md
- Start
  - [Home](/README.md)
  - [Quickstart](/guides/quickstart.md)
- Operations
  - [Deployment](/guides/deployment.md)
```

Example `_navbar.md`:

```md
- [Home](/README.md)
- Guides
  - [Quickstart](/guides/quickstart.md)
  - [Deployment](/guides/deployment.md)
- [Repository](https://github.com/acme/api)
```

## Markdown Features

The Markdown runtime supports common file-backed Markdown authoring features:

- GFM-style tables and task lists
- GFM-style strikethrough with `~~removed~~`
- fenced code blocks with copy buttons
- relative Markdown links and relative asset links
- heading anchors and `:id=custom-heading`
- `raffel-ignore` and `raffel-ignore-all`
- link attributes such as `:ignore`, `:target`, and `:disabled`
- image attributes such as `:class`, `:id`, `:size`, and `:no-zoom`
- admonitions like `[!NOTE]`, `[!WARNING]`, `[!IMPORTANT]`
- legacy callouts with `!>` and `?>`
- tab blocks with `<!-- tabs:start -->`
- Mermaid blocks
- image zoom
- emoji shorthand, unless `markdown.noEmoji` is enabled
- `markdown.noCompileLinks`
- `markdown.externalLinkTarget` and `markdown.externalLinkRel`
- `markdown.autoHeader`
- `{raffel-updated}` with `markdown.formatUpdated`
- raw HTML is escaped by default; set `markdown.html: 'raw'` only for trusted Markdown

When `ui.assets.mode` is `external`, Raffel serves the Markdown engine and renderer bridge from the same docs mount as the UI runtime. There is no CDN requirement. If the engine asset is unavailable, the runtime falls back to the built-in parser.

## Theme Preference

The UI supports `ui.theme: 'light' | 'dark' | 'auto'`. The theme toggle cycles through `auto`, `dark`, and `light`, and stores the user's choice in `localStorage` under `raffel-docs-theme`. A stored preference overrides the configured default on the next page load.

## Svelte Mounts

Raffel does not embed Vue. Component slots are Svelte-friendly and framework-neutral. Use a fenced block in Markdown:

````md
```svelte-component DemoCounter
{"label":"Mounted from Markdown"}
```
````

The docs runtime renders a mount target and calls registered plugins through `mountComponent(target, name, props, context)` and `unmountComponent(target, context)`. The host app can use those hooks to mount Svelte components without coupling the core docs runtime to Svelte.

## Plugin API

The browser runtime exposes `window.RaffelDocs` with `apiVersion: 1`, `use(plugin)`, `plugins`, and `getState()`. Plugins may also be queued before the runtime loads through `window.__RAFFEL_DOCS_PLUGINS__`.

```js
window.__RAFFEL_DOCS_PLUGINS__ = [{
  name: 'acme-docs',
  beforeMarkdown(markdown, context) {
    return markdown
  },
  afterRender(context) {
    console.log(context.activePagePath)
  },
  mountComponent(target, name, props, context) {
    // Mount a Svelte component here.
  },
  unmountComponent(target, context) {
    // Destroy component instances here.
  },
}]
```

Supported hooks in API version 1 are `beforeMarkdown`, `afterMarkdown`, `beforeRender`, `afterRender`, `onRouteChange`, `onSearchResults`, `mountComponent`, `unmountComponent`, `onImageZoom`, `onTabChange`, and `onCopyCode`.

## Mental Model

Use USD/OpenAPI docs for API truth: routes, schemas, transport protocols, auth, request and response shapes, generated examples, and machine-readable contract exports.

Use Markdown docs for human explanation: why the API exists, how to onboard, architecture, workflows, migration guides, operational runbooks, screenshots, diagrams, and tutorials.

Use `enableUSD({ docsDir: true })` when you want both to be automatic for a project: the API reference is generated from registered Raffel metadata, and the Markdown site is discovered from the project `./docs` directory by convention.
