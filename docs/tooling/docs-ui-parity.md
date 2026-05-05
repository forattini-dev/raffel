# Docs UI Parity With Markdown docs

This is the working completion checklist for replacing Markdown docs in-house.

The target is not only to render Markdown. The target is to provide a docs app that can load a directory by convention, render free-form Markdown, render generated USD/API reference, avoid route collisions, and ship from the npm package without CDN requirements.

## Completion Criteria

| Area | Status | Evidence | Remaining work |
| --- | --- | --- | --- |
| npm-published runtime assets | Done | `package.json` runs `prepack` through `build`; `scripts/build-docs-ui-assets.mjs` emits `dist/docs/ui/assets/raffel-docs.js` and `.css`; `pnpm pack --dry-run` includes those assets | None known |
| Docs directory loader | Done | `src/docs/markdown-loader.ts` loads `README.md`, nested pages, `_sidebar.md`, nested `_sidebar.md`, `_navbar.md`, `_coverpage.md`, and `_404.md` | None known |
| Route collision boundary | Done | `basePath` mounts the real HTTP docs app; `docsDir.routeBase` scopes in-app Markdown routes; runtime resolves absolute and relative `.md` links under `x-usd.documentation.routeBase` | None known |
| USD/OpenAPI generated reference | Done | `src/docs/ui/runtime/index.ts` renders HTTP, WebSocket, streams, JSON-RPC, gRPC, TCP, and UDP protocol tabs from `paths` and `x-usd.*`; non-HTTP protocols render starter request panels; `docs/tooling/docs-ui-protocol-examples.md` documents first-party examples for each protocol | Live protocol consoles can still improve |
| Markdown pages alongside API docs | Done | `x-usd.documentation.pages` and `docsDir` pages render in the same UI as generated API/protocol docs | None known |
| Sidebar and navbar conventions | Done | `_sidebar.md` controls sections/order, nested sidebars are supported, `_navbar.md` supports dropdown children | Sidebar collapse persistence is not implemented |
| Search | Done | `src/docs/search-index.ts` builds page and heading entries with weighted scoring for exact phrases, title matches, section matches, excerpts, body text, and all-term coverage; browser smoke validates search results and hotkey | Full-text indexing can still evolve if docs become very large |
| Basic GFM rendering | Partial | Tables, task lists, fenced code, inline code, strong/emphasis, links/images, and strikethrough are implemented and smoke-tested | Full GFM edge-case coverage still needs a real Markdown engine or a much larger parser |
| Heading anchors | Done | Custom `:id=...`, generated slugs, duplicate generated heading IDs, active heading links, TOC, and sidebar subheadings are covered | None known |
| Markdown attributes | Partial | Link `:ignore`, `:target`, `:disabled`; image `:class`, `:id`, `:size`, `:no-zoom` are implemented | Other plugin-specific attributes are not exhaustively covered |
| Admonitions and legacy callouts | Done | `[!NOTE]`, `[!WARNING]`, `[!IMPORTANT]`, `!>`, and `?>` render in the browser smoke | None known |
| Tabs | Done | `<!-- tabs:start -->` / `<!-- tabs:end -->` blocks render and switch panels | Advanced plugin options are not implemented |
| Mermaid | Done | Mermaid code fences render through `window.mermaid` when present and fall back safely | Bundled Mermaid is intentionally not included |
| Copy code | Done | Fenced code blocks include copy buttons | Browser clipboard fallback is basic |
| Image zoom | Done | Markdown images zoom unless `:no-zoom` is set | None known |
| Emoji | Done | Common emoji shorthand renders unless `markdown.noEmoji` is set | Emoji catalog is intentionally small |
| Pagination | Done | Previous/next page navigation renders from page order | Advanced pagination options are not implemented |
| Theme and layout | Done for current surface | Light/dark/auto theme support, persisted user preference, Markdown-specific light/dark CSS variables, hidden sidebar, skip link, responsive layout, and top navigation exist; browser smoke validates dark Markdown variables | Continue visual review as new components are added |
| Plugin/extensibility model | Done for API v1 | `window.RaffelDocs.apiVersion` exposes API version `1`; runtime hooks exist for `beforeMarkdown`, `afterMarkdown`, render hooks, route changes, search results, Svelte-friendly component mounts, image zoom, tab changes, and copy-code events | Add API v2 hooks only when new docs features need them |
| Svelte integration | Done | `svelte-component` fences create mount targets; host code mounts via plugin hooks; no Vue dependency is embedded | A first-party Svelte adapter package is not implemented |
| Raw HTML handling | Done | Markdown HTML is escaped by default; `markdown.html: 'raw'` opts into trusted raw HTML rendering and browser smoke covers both modes | Sanitization is intentionally not implemented; use raw mode only for trusted Markdown |
| Markdown engine foundation | Missing | `marked` is present as an optional dependency, but the browser runtime still uses the in-house parser | Need a bundled/browser-safe renderer plan or server/build-time pre-rendering |
| Browser regression coverage | Done for current surface | `scripts/verify-docs-ui-browser.mjs` opens real generated docs with Chrome and validates routing, search, Markdown features, protocols, Svelte mounts, Mermaid, tabs, zoom, and routeBase links | Add fixtures as new parity rows move from partial/missing to done |

## Current Not-Done Items

These are the remaining blockers before this can honestly be called a full in-house docs replacement:

1. Replace or significantly harden the Markdown parser.
2. Replace starter request panels with live protocol consoles where that is safe for each transport.

## Verification Gates

Run these before claiming parity progress:

```bash
pnpm run typecheck
pnpm exec vitest run -c vitest.config.unit.ts test/docs/markdown-loader.unit.test.ts test/docs/search-index.unit.test.ts test/docs/ui/html-builder.unit.test.ts
pnpm run test:docs-ui-browser
pnpm run check:line-limits
git diff --check
pnpm pack --dry-run | rg "dist/docs/ui/assets/raffel-docs|README.md|package.json"
```
