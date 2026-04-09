# Documentation MCP Server

Turn any Markdown docs tree into an MCP server with search, section reads, code example extraction, and lightweight prompt helpers.

Raffel supports this in two ways:

1. `raffel mcp --docs <dir|repo>` for quick CLI usage
2. `createDocsMcpServer()` when you want to embed the docs server in your own code

---

## CLI: local docs directory

```bash
raffel mcp --docs ./docs
raffel mcp --docs ./docs --transport http --port 3200
raffel mcp --docs ./docs --name my-docs
```

Useful when you already have a docs folder and want to expose it to Claude Code or another MCP client without writing server code.

---

## CLI: git repository

```bash
raffel mcp --docs https://github.com/org/repo
raffel mcp --docs https://github.com/org/repo --path docs/
raffel mcp --docs https://github.com/org/repo --branch main
```

Raffel clones the repo to a temporary directory, indexes the Markdown files, and exposes the result over MCP.

---

## Programmatic API

```typescript
import { createDocsMcpServer, createBearerAuth } from 'raffel'

const server = createDocsMcpServer({
  name: 'project-docs',
  version: '1.0.0',
  dir: './docs',
  extensions: ['.md', '.mdx'],
  exclude: ['node_modules', '.git', 'dist'],
  maxDepth: 8,
  watchInterval: 30_000,
  auth: createBearerAuth({
    verify: (token) => token === process.env.DOCS_TOKEN
      ? { token, clientId: 'docs-client', scopes: ['read'] }
      : null,
  }),
})

await server.startHttp({ port: 3200, path: '/mcp' })
```

You can also index a repository directly:

```typescript
import { createDocsMcpServer } from 'raffel'

const server = createDocsMcpServer({
  repo: 'https://github.com/org/repo',
  branch: 'main',
  path: 'docs/',
  name: 'repo-docs',
})

await server.startStdio()
```

---

## Tools exposed by default

- `search`: full-text search across indexed sections
- `list_files`: list indexed files with titles and word counts
- `read_file`: return the full content of one file
- `read_section`: return one section by file + heading
- `list_headings`: inspect headings across the docs tree
- `code_examples`: extract fenced code blocks, optionally by language
- `file_outline`: get the heading tree for a file
- `stats`: inspect file/section/code-block counts

This is intentionally docs-first. The server is optimized for discovery, navigation, and extracting the exact section or example an agent needs next.

---

## Resources and prompts

Resources:

- `docs://files`
- `docs://file/{path}`

Prompts:

- `explain`
- `summarize`

These make the docs server usable both as a search surface and as a reusable resource library for MCP-aware clients.

---

## Reindexing

`createDocsMcpServer()` returns the normal MCP server API plus `reindex()`:

```typescript
await server.reindex()
```

Use this when you update the docs on disk and want to refresh the index immediately instead of waiting for the next `watchInterval`.

---

## Operational notes

- `watchInterval` is disabled by default. Set it to a positive value to auto-refresh the index.
- HTTP and SSE transports can use `auth`. `stdio` does not.
- Git-backed docs mode clones into a temporary directory for indexing.
- By default Raffel indexes `.md` and `.mdx` files and skips `node_modules`, `.git`, and `dist`.

---

## See also

- [Building MCP Servers](/guides/mcp-server.md)
- [MCP Protocol Reference](/protocols/mcp.md)
- [Raffel AI Assistant](/reference/mcp.md)
