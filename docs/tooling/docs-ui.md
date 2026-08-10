# Raffel Docs UI

> **`mountUSDDocs` and `mountOpenApiDocs` are intentionally separate. Pick one based on what you ship.**

Raffel has two documentation surfaces, and they target different consumers. They are not redundant — they sit side by side in many real projects and solve different problems. Use this matrix to pick:

| You want… | Use | Lives in |
|---|---|---|
| ReDoc-style HTTP API reference, single-protocol, Swagger compatible | `mountOpenApiDocs(app, opts)` | `raffel/http` |
| Multi-protocol reference (HTTP + WebSocket + gRPC + JSON-RPC + TCP + UDP) plus Markdown guides plus live protocol consoles | `mountUSDDocs(app, ctx, opts)` | `raffel/docs` |
| Both, side by side (e.g. ReDoc at `/api`, USD at `/docs`) | Both — they don't conflict | — |
| Just the spec endpoints with no UI | Either helper, or call the underlying generators directly (`generateOpenAPI`, `createUSDHandlers`) | — |

The split is by *consumer*: ReDoc/Swagger are universally recognised and useful for HTTP-first APIs that are consumed by tools outside the Raffel ecosystem. USD docs are richer (everything the Raffel server registered shows up — including channels, streams, gRPC services, etc.) and were designed for projects that want a single-page docs site backed by the contract Raffel already knows about, including hand-written Markdown alongside.

There is no `prefer="usd"` flag on `mountOpenApiDocs` (or vice versa) — they run on different paths, with different UIs, and a project that needs both mounts both. A project that doesn't need OpenAPI compatibility can skip `mountOpenApiDocs` entirely.

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

### Landing page (docs root)

Opening the docs root (`/docs`) renders an overview built straight from the OpenAPI/USD `info` and `servers`: the API title and version, contact/license, the list of servers, and `info.description` rendered as Markdown — followed by the endpoint list. There is nothing to configure; populate `info.description`, `info.contact`, `info.license`, and `servers` in the spec and they show up.

The reference also opens on the **most relevant protocol** by a fixed priority — `http` → `graphql` → `websocket` → `jsonrpc` → `grpc` → `streams` → `tcp` → `udp` — so an HTTP-first API lands on HTTP. The active protocol's endpoints are listed expanded in the sidebar with its tab active. Switching tabs is one click; a genuine non-root path that does not exist still shows a "Page not found" surface.

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
      customCss: '/docs/-/assets/custom.css',
      sidebar: {
        search: true,
        docsPages: true,
        subMaxLevel: 3,
        resizable: true,
        width: 280,
        minWidth: 220,
        maxWidth: 560,
        items: [
          {
            title: 'Guides',
            children: [
              { title: 'Quickstart', path: '/quickstart' },
              { title: 'Deployment', path: '/guides/deployment' },
            ],
          },
        ],
      },
      markdown: {
        autoHeader: true,
        formatUpdated: 'YYYY-MM-DD',
      },
    },
  })

await server.start()
```

The sidebar is resizable by default. Readers can drag its right edge, use the
arrow keys while the resize handle is focused, or double-click the handle to
restore the configured width. The selected width is persisted in the browser.
Set `resizable: false` to lock it, or use `width`, `minWidth`, and `maxWidth` to
control its pixel bounds.

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
| `/docs/-/prism.js` | Packaged Prism.js syntax highlighter used by the external runtime |
| `/docs/-/marked-renderer.js` | Raffel renderer bridge for Markdown-specific behavior |
| `/docs/-/protocol-console.js` | Browser-safe live protocol consoles for generated references |
| `/docs/-/sidebar-tree.js` | Declarative sidebar tree renderer used by the external runtime |
| `/docs/-/raffel-docs.css` | Reusable frontend docs stylesheet |
| `/docs/-/assets/*` | Static assets referenced by Markdown pages |

## Mounting on a standalone HttpApp

When wiring USD docs onto a `HttpApp` (or any `app.get(path, handler)`-shaped router) directly, use `mountUSDDocs(app, ctx, config)` instead of calling `createUSDHandlers` and registering the eight handlers by hand:

```ts
import { HttpApp } from 'raffel/http'
import { mountUSDDocs } from 'raffel/docs'

const app = new HttpApp()
mountUSDDocs(app, { registry, schemaRegistry }, {
  basePath: '/coding',
  info: { title: 'My API', version: '1.0.0' },
})
```

`mountUSDDocs` registers every internal asset under `<basePath>/-/<asset>` first, then the spec endpoints (`/openapi.json`, `/usd.json`, `/usd.yaml`), then the markdown asset wildcard, and finally the SPA wildcard. The list of internal assets is owned by Raffel — adding a new asset in a future minor version does not require changes on the consumer side.

The returned `USDHandlers` is the same object `createUSDHandlers` returns, so any additional custom routes (e.g. a separate JSON dump) can call into it after mounting.

Forgetting an asset route used to leave the SPA wildcard serving HTML in place of JS, and the browser threw an opaque module syntax error. The runtime now also probes the sibling asset URLs at boot and emits a clear `console.error` naming the unmounted handler when an asset endpoint returns `text/html`.

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
| `/internal-docs/favicon.ico` | Conventional `docsDir/favicon.ico` when present |
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

If neither `ui.favicon` nor `documentation.favicon` is configured and the docs directory contains `favicon.ico` at its root, the generated HTML links to `<basePath>/favicon.ico`. Raffel serves that exact route before the SPA wildcard with the original ICO bytes and `image/x-icon`; if the file is absent the exact route returns 404.

Global Open Graph metadata can be configured in `ui.openGraph` or portable `documentation.openGraph`. Fields merge one by one with UI taking precedence over USD. `og:title` defaults to `info.title`, `og:description` defaults to `info.description`, and `og:type` defaults to `website`; `url`, `image`, `imageAlt`, `siteName`, and `locale` are emitted only when explicitly configured.

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
| `index.md` | Homepage when present (preferred over `README.md`) |
| `README.md` | Homepage fallback, unless `homepage` is configured |
| `_sidebar.md` | Sidebar sections and page ordering |
| nested `_sidebar.md` | Local sidebar for nested docs folders |
| `_navbar.md` | Top navigation, including nested dropdowns |
| `_coverpage.md` | Hero (cover) section — see [Coverpage hero](#coverpage-hero) |
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

Sidebar order and hierarchy are declarative. The runtime preserves the declared order exactly, supports nested groups, starts groups collapsed by default, and opens only the ancestor chain for the current hash route. You can also bypass `_sidebar.md` and declare the same tree in `ui.sidebar.items` or `x-usd.documentation.sidebar`:

```ts
ui: {
  sidebar: {
    items: [
      {
        title: 'Guides',
        children: [
          { title: 'Quickstart', path: '/quickstart' },
          {
            title: 'Operations',
            children: [
              { title: 'Deployment', path: '/guides/deployment' },
            ],
          },
        ],
      },
    ],
  },
}
```

Example `_navbar.md`:

```md
- [Home](/README.md)
- Guides
  - [Quickstart](/guides/quickstart.md)
  - [Deployment](/guides/deployment.md)
- [Repository](https://github.com/acme/api)
```

## Coverpage Hero

`_coverpage.md` is parsed into the docs hero (cover page) shown above the app content — same idea as Docsify. Lines map as follows:

| Markdown | Hero field |
| --- | --- |
| `# Title <small>v1.0</small>` | `title` + `version` |
| `> tagline` | `tagline` |
| `- item` | `features[]` |
| Line with only `[text](href)` links | `buttons[]` (last button becomes `primary`) |
| `![alt](src)` | Ignored (logo comes from `ui.logo` / `x-usd.documentation.logo`) |

Optional YAML frontmatter overrides individual fields and adds the bits Markdown can't express:

```md
---
background: gradient        # gradient | solid | pattern | image
backgroundColor: "#0f172a"  # for background: solid
backgroundImage: /hero.jpg  # for background: image
github: https://github.com/acme/api
---

# Raffel <small>1.2</small>

> One server. Every protocol.

- HTTP, WebSocket, gRPC, JSON-RPC, TCP, UDP
- File-backed Markdown docs
- USD/OpenAPI auto-generated reference

[GitHub](https://github.com/acme/api)
[Get Started](#/quickstart)
```

The example above produces:

- `title: "Raffel"`, `version: "1.2"`, `tagline: "One server. Every protocol."`
- `features`: the three list items
- `buttons`: GitHub (secondary), Get Started (primary — last button wins)
- `background: gradient`, `github: https://...` (renders the corner Octocat)

If you'd rather configure the hero programmatically, set `ui.hero` on the docs middleware or `x-usd.documentation.hero` in the spec — both override fields parsed from `_coverpage.md`.

## Markdown Features

The Markdown runtime supports common file-backed Markdown authoring features:

- GFM-style tables and task lists
- GFM-style strikethrough with `~~removed~~`
- fenced code blocks with copy buttons and Prism.js highlighting when the Prism asset is loaded
- relative Markdown links and relative asset links
- heading anchors and `:id=custom-heading`
- `raffel-ignore` and `raffel-ignore-all`
- link attributes such as `:ignore`, `:target`, and `:disabled`
- image attributes such as `:class`, `:id`, `:size`, and `:no-zoom`
- admonitions like `[!NOTE]`, `[!WARNING]`, `[!IMPORTANT]`
- legacy callouts with `!>` and `?>`
- tab blocks with `<!-- tabs:start -->`
- Mermaid blocks (lazy-loaded the first time a `.mermaid` element renders — see [Mermaid Diagrams](#mermaid-diagrams))
- image zoom
- emoji shorthand, unless `markdown.noEmoji` is enabled
- `markdown.noCompileLinks`
- `markdown.externalLinkTarget` and `markdown.externalLinkRel`
- `markdown.autoHeader`
- `{raffel-updated}` with `markdown.formatUpdated`
- raw HTML is escaped by default; set `markdown.html: 'raw'` only for trusted Markdown

When `ui.assets.mode` is `external`, Raffel serves the Markdown engine, Prism.js, and renderer bridge from the same docs mount as the UI runtime. There is no CDN requirement. If the Markdown engine asset is unavailable, the runtime falls back to the built-in parser.

## Mermaid Diagrams

Fenced code blocks with the `mermaid` language are parsed into `<div class="mermaid">` elements at HTML generation time. **Rendering is enabled by default and lazy-loaded** — the runtime fetches the Mermaid library only the first time it sees a `.mermaid` element in the DOM, then caches the load promise for the rest of the session. Pages without diagrams never pay the network cost.

Raffel intentionally does NOT bundle Mermaid (~3 MB minified), so the script is fetched from a CDN when needed.

Each rendered diagram is wrapped in a **viewer overlay** with a toolbar (zoom in / zoom out / reset / fullscreen). The toolbar fades in on hover. When zoomed in (scale > 1) the diagram can be panned by mouse drag. Ctrl/⌘ + wheel zooms inside the viewport. Fullscreen mode opens a `<dialog>` with the same controls and `Esc` to close.

Pin a specific Mermaid version, self-host the asset, or disable the viewer overlay:

```ts
ui: {
  mermaid: {
    src: 'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js',
    viewer: true, // default — set false to render raw SVGs without the toolbar
  },
}
```

Disable Mermaid entirely (for example when serving docs in an air-gapped environment with no fallback library):

```ts
ui: {
  mermaid: false,
}
```

When disabled, `.mermaid` blocks render as fallback `<pre>` text — no broken diagrams, no missing-library error. If `window.mermaid` is already present on the page (consumer self-hosted earlier in the shell), the runtime uses it without triggering a second fetch.

## Theme Preference

The UI supports `ui.theme: 'light' | 'dark' | 'custom' | 'auto'`. The theme toggle cycles through `auto`, `dark`, `light`, and `custom`, and stores the user's choice in `localStorage` under `raffel-docs-theme`. A stored preference overrides the configured default on the next page load.

Use `ui.customCss` to load one or more project CSS files after the built-in stylesheet:

```ts
ui: {
  theme: 'custom',
  customCss: ['/docs/-/assets/custom.css'],
}
```

Custom CSS can override component styles directly or set custom theme tokens such as `--raffel-bg-color`, `--raffel-text-color`, `--raffel-primary-color`, `--raffel-sidebar-bg`, and `--raffel-code-bg`.

When `theme: 'custom'` is set and no `--raffel-*` token is defined, fallbacks follow the visitor's `prefers-color-scheme` (dark visitors get the dark-mode hex set, light visitors get the light set). This mirrors `theme: 'auto'` behavior until the consumer takes full control.

### Custom CSS — Public Selector Surface

These are the load-bearing classes that `customCss` can target safely. They are part of the public DX contract: a rename in this list is a breaking change tracked in CHANGELOG.

| Surface | Class | Behavior |
| --- | --- | --- |
| Hero shell | `.hero` | Root wrapper around the cover section |
| Hero content | `.hero-content` | Inner container holding title, tagline, features, buttons, quickLinks |
| Hero title | `.hero-title`, `.hero-version` | H1 plus the small version chip |
| Hero tagline | `.hero-tagline` | Single-line subtitle paragraph |
| Hero features | `.hero-features`, `.hero-features li` | Bullet list parsed from `_coverpage.md` body |
| Hero buttons | `.hero-buttons`, `.hero-btn`, `.hero-btn-primary`, `.hero-btn-secondary` | CTA anchors; last button parsed becomes primary |
| Hero quick links | `.hero-quicklinks`, `.hero-quicklink`, `.hero-quicklink-title`, `.hero-quicklink-desc`, `.hero-quicklink-icon` | Card-style navigation hero cells |
| Top navigation | `.app-nav`, `.top-nav` | Sticky navbar |
| Sidebar | `.sidebar`, `.sidebar-header`, `.sidebar-logo`, `.sidebar-search`, `.sidebar-nav` | Left rail container and parts |
| Sidebar links | `.sidebar a`, `.sidebar a.active` | Nav rows and the active route |
| Main content | `.app-container`, `.markdown-content` | Outer shell plus markdown body |
| TOC | `.toc`, `.toc a`, `.toc a.active` | Right-rail table of contents when `ui.toc.enabled` |
| Code blocks | `.markdown-content pre`, `.markdown-content pre code`, `:not(pre) > code` | Fenced blocks and inline code |
| Prism tokens | `.token.keyword`, `.token.string`, `.token.function`, `.token.class-name`, `.token.property`, `.token.tag`, `.token.boolean`, `.token.number`, `.token.constant`, `.token.symbol`, `.token.selector`, `.token.attr-name`, `.token.char`, `.token.builtin`, `.token.comment` | Syntax-highlighted spans inside fenced code blocks |
| Schema badges | `.type-string`, `.type-number`, `.type-integer`, `.type-boolean`, `.type-object`, `.type-array`, `.type-null`, `.type-ref` | Generated API reference type chips |

Selectors outside this table are internal and may change without notice. If you find yourself reaching for an unlisted class, open an issue describing the use case — that's a candidate for the public list.

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
