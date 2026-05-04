# Framework Runtime RFC

> Status: draft
> Scope: Raffel core and bootstrap layer
> Motivation: make Raffel a better substrate for higher-level frameworks such as Purple without forcing those frameworks to become parallel runtimes

---

## Summary

Raffel already provides strong primitives for:

- multi-protocol handler registration
- runtime inspection and preview
- integrated MCP exposure
- startup-time dependency injection

What it does not yet provide as first-class extension surfaces is:

1. lifecycle plugins for framework-level startup and shutdown work
2. framework contributions to the runtime inspection graph
3. a richer integrated MCP composition model for derived tools plus framework-specific tools/resources/prompts

Frameworks built on top of Raffel currently compensate for those gaps by re-implementing orchestration in userland. Purple is a useful forcing function here, but the proposal is intentionally general: the same APIs should help any framework or platform layer that wants to build on Raffel.

The goal is not to move application-specific logic into Raffel. The goal is to expose the missing extension points so higher-level frameworks can stay thin.

---

## Problem Statement

Today the extension story is split across three incomplete surfaces:

- `createServer()` is still effectively a thin passthrough over the builder
- `server.provide()` handles dependency injection, but not framework lifecycle
- `server.preview()` produces a strong graph for core Raffel concepts, but frameworks cannot attach their own nodes and diagnostics
- integrated MCP can bridge procedures to tools, but framework authors still need a separate composition layer for runtime catalogs, prompts, and exposure policy

The result is predictable:

- frameworks accumulate their own boot kernels
- framework docs and tooling drift away from the core runtime graph
- MCP support gets duplicated outside Raffel
- "provider" becomes overloaded to mean both DI and startup hooks

This increases maintenance cost and makes the core runtime less reusable than it should be.

---

## Goals

- Let frameworks extend Raffel without forking the runtime model
- Keep `ctx.services` as the canonical dependency surface for handlers
- Let framework metadata participate in `preview`, `doctor`, `playground`, and contract tooling
- Let integrated MCP expose both bridged procedures and framework-specific context
- Make startup/shutdown orchestration explicit instead of hiding it behind DI

## Non-Goals

- Turn Raffel into an opinionated application framework
- Replace framework-specific domain models
- Add a second plugin system for ordinary request middleware
- Collapse all framework semantics into the core graph schema on day one

---

## Proposal 1: Server Plugins And Lifecycle Hooks

### Rationale

Raffel already has lifecycle management internally, but there is no public API for framework-level bootstrap work. This forces higher-level frameworks to own their own kernel and call Raffel procedurally from the outside.

Dependency injection and lifecycle are different concerns:

- DI resolves stable shared services for handlers
- lifecycle hooks orchestrate startup, registration, shutdown, inspection, and protocol composition

Those concerns should not share the same abstraction.

### Proposed API

```ts
export interface ServerPlugin {
  name: string

  configure?(ctx: ServerPluginConfigureContext): void | Promise<void>
  register?(ctx: ServerPluginRegisterContext): void | Promise<void>

  beforeStart?(ctx: ServerPluginRuntimeContext): void | Promise<void>
  afterStart?(ctx: ServerPluginRuntimeContext): void | Promise<void>

  beforeStop?(ctx: ServerPluginRuntimeContext): void | Promise<void>
  afterStop?(ctx: ServerPluginRuntimeContext): void | Promise<void>

  inspect?(ctx: ServerPluginInspectContext): RuntimeInspectionContribution | void | Promise<RuntimeInspectionContribution | void>
}

export interface ServerPluginConfigureContext {
  options: ServerOptions
  previewConfig: () => ServerConfigPreview
}

export interface ServerPluginRegisterContext {
  server: RaffelServer
  providers: Readonly<ResolvedProviders>
}

export interface ServerPluginRuntimeContext {
  server: RaffelServer
  providers: Readonly<ResolvedProviders>
  signal: AbortSignal
}

export interface ServerPluginInspectContext {
  server: RaffelServer
  preview: RuntimeInspectionGraph
  providers: Readonly<ResolvedProviders>
}
```

### Server Surface

```ts
createServer({
  port: 3000,
  plugins: [
    createHealthPlugin(),
    createMcpCatalogPlugin(),
  ],
})

server.usePlugin(createFooPlugin())
```

### Intended Responsibilities

- `configure`:
  normalize options, validate plugin config, prepare defaults
- `register`:
  register procedures, streams, resources, transports, metrics, docs, MCP extras
- `beforeStart`:
  start background workers, warm caches, verify dependencies
- `afterStart`:
  emit startup logs, publish ready state, start periodic jobs that require active listeners
- `beforeStop`:
  stop polling, reject new work, flush buffers
- `afterStop`:
  final cleanup after listeners and managed resources are closed
- `inspect`:
  contribute framework-specific metadata and diagnostics to the runtime graph

### Why This Helps Frameworks

This lets a framework move from:

- "own the whole application kernel"

to:

- "compose a set of Raffel plugins plus a small convention layer"

That is the right abstraction boundary for Purple, but also for any future framework built on top of Raffel.

---

## Proposal 2: Runtime Inspection Contributions

### Rationale

The runtime inspection graph is already the strongest part of Raffel's DX story. The missing piece is an official way for frameworks to contribute domain/runtime metadata without patching the graph out-of-band.

If a framework cannot extend the graph, it cannot participate cleanly in:

- `server.preview()`
- inspect/doctor tooling
- playground UI
- contract tests
- MCP catalog publication derived from runtime state

### Proposed API

```ts
export interface RuntimeInspectionContribution {
  namespace: string
  title?: string
  nodes?: RuntimeInspectionExtensionNode[]
  diagnostics?: RuntimeInspectionDiagnostic[]
}

export interface RuntimeInspectionExtensionNode {
  kind: string
  id: string
  label: string
  data: Record<string, unknown>
}

export interface RuntimeInspectionGraph {
  version: number
  generatedAt: string
  config: ServerConfigPreview
  services: RuntimeInspectionService[]
  operations: RuntimeInspectionOperation[]
  channels: RuntimeInspectionChannel[]
  transportHandlers: RuntimeInspectionTransportHandler[]
  transports: RuntimeInspectionTransport[]
  diagnostics: RuntimeInspectionDiagnostic[]
  extensions?: RuntimeInspectionContribution[]
}
```

### Contribution Rules

- core Raffel graph shape stays stable and remains the primary source of truth
- framework contributions are additive, namespaced, and optional
- framework diagnostics reuse the existing `RuntimeInspectionDiagnostic` type
- contributions must be serializable and safe to consume in CLI and browser tooling

### Example

```ts
const purplePlugin: ServerPlugin = {
  name: 'purple-runtime',
  inspect() {
    return {
      namespace: 'purple',
      title: 'Purple Runtime',
      nodes: [
        {
          kind: 'resource',
          id: 'users',
          label: 'users',
          data: {
            kind: 'table',
            indexes: ['email'],
            softDelete: true,
          },
        },
        {
          kind: 'worker',
          id: 'emails',
          label: 'emails',
          data: {
            concurrency: 4,
          },
        },
      ],
      diagnostics: [
        {
          code: 'purple.resource.missing-policy',
          severity: 'warning',
          message: 'orders.delete has no explicit policy coverage',
          subject: { kind: 'operation', id: 'orders.delete' },
        },
      ],
    }
  },
}
```

### Why This Matters

Once contributions are part of the graph, every existing DX tool can consume them incrementally instead of every framework needing:

- its own inspect command
- its own doctor command
- its own runtime explorer
- its own playground-side metadata plumbing

That is the highest-leverage way to make Raffel more framework-friendly.

---

## Proposal 3: Richer Integrated MCP Composition

### Rationale

Raffel already supports:

- procedure-to-tool bridging
- extra tools
- extra resources
- extra prompts

That is a strong baseline. What is still missing is a formal composition and exposure model for frameworks that need both:

- auto-bridged runtime tools
- framework-specific catalogs and prompts
- read-only vs admin vs dangerous exposure policies

### Proposed Evolution

```ts
export interface McpExposurePolicy {
  tools?: 'all' | 'read-only' | 'none'
  resources?: 'all' | 'safe' | 'none'
  prompts?: 'all' | 'none'
  filter?: (
    subject: {
      type: 'tool' | 'resource' | 'prompt'
      name: string
      derived: boolean
    },
    ctx: McpCallContext
  ) => boolean | Promise<boolean>
}

export interface McpAdapterOptions {
  path?: string
  name?: string
  version?: string
  instructions?: string

  bridge?: {
    enabled?: boolean
    filter?: (meta: { name: string; kind: string; tags?: string[]; description?: string }) => boolean
    toolName?: (procedureName: string) => string
  }

  expose?: McpExposurePolicy
  interceptors?: McpInterceptor[]

  tools?: McpToolRegistration[]
  resources?: McpResourceRegistration[]
  resourceTemplates?: McpResourceTemplateRegistration[]
  prompts?: McpPromptRegistration[]
}
```

### Design Intent

- bridged procedure tools remain the default integrated path
- framework packages can add runtime catalogs and semantic prompts without creating a separate MCP server abstraction
- exposure policy becomes a first-class concern instead of ad hoc filtering in each framework package
- MCP interceptors become the canonical place for authz tiers, logging, rate-limiting, and auditing on the MCP surface

### Example

```ts
createServer({
  port: 3000,
  mcp: {
    bridge: {
      enabled: true,
      filter: (meta) => !meta.name.startsWith('internal.'),
    },
    expose: {
      tools: 'read-only',
      resources: 'safe',
      prompts: 'all',
    },
    resources: [
      {
        uri: 'purple://schema',
        name: 'purple-schema',
        mimeType: 'application/json',
        handler: async () => ({
          contents: [{ uri: 'purple://schema', mimeType: 'application/json', text: '{}' }],
        }),
      },
    ],
  },
})
```

### Why This Helps

This lets framework-specific MCP layers become thin adapters over Raffel's integrated mode instead of parallel MCP servers with their own lifecycle and failure modes.

---

## Proposal 4: Keep Providers Focused On DI

### Rationale

`server.provide()` is already a good abstraction for startup-time dependency resolution that flows into `ctx.services`.

That surface should stay narrow and clear.

What should not be done is stretch "provider" to also mean:

- startup registration hook
- route installer
- background worker starter
- schema migrator
- shutdown coordinator

Those are plugin responsibilities, not DI responsibilities.

### Recommendation

- keep `providers` and `server.provide()` as the DI model
- add `plugins` or `server.usePlugin()` for lifecycle and framework composition
- document `ctx.services` as the canonical runtime dependency path
- document plugins as the canonical framework/platform extension path

This preserves the current Raffel mental model instead of overloading it.

---

## Expected Impact On Purple

Purple should be able to collapse from "framework runtime + Raffel server inside it" to:

1. a RedDB integration layer
2. a discovery/convention layer
3. a set of Raffel plugins
4. a set of graph and MCP contributions

In practical terms that means:

- Purple no longer needs a large bespoke boot kernel to orchestrate startup
- Purple MCP becomes a thin composition layer over integrated Raffel MCP
- Purple runtime metadata becomes visible in `preview`, `doctor`, and `playground`
- Purple-specific lifecycle pieces such as migrations, seeders, workers, and health checks can move into plugins

That is a healthier architecture for both projects:

- Raffel becomes a better platform
- Purple becomes thinner and more maintainable

---

## Rollout Plan

### Phase 1

- add `plugins` / `usePlugin()`
- add `RuntimeInspectionGraph.extensions`
- collect plugin `inspect()` contributions during `server.preview()`

This phase immediately unlocks framework-aware inspect and doctor flows.

### Phase 2

- add richer `mcp` composition options
- add MCP interceptors and exposure policy
- document the "bridged tools + framework extras" model

This phase lets framework MCP packages shrink dramatically.

### Phase 3

- migrate built-in operational features to use the same public plugin surface where practical
- document the distinction between DI providers and lifecycle plugins
- publish framework author guidance

This phase makes the public extension model match the internal runtime architecture more closely.

---

## Open Questions

1. Should plugin `configure()` be allowed to mutate `ServerOptions`, or should it only return normalized overlays?
2. Should `inspect()` run before startup, after registration, or in both modes with different contexts?
3. Should MCP exposure policy be static-only, or should it support request-aware decisions via `McpCallContext` from day one?
4. Should plugin-contributed diagnostics participate in `doctor --fail-on warning` immediately, or stay informational until a later phase?
5. Should plugin contributions be grouped only under `extensions`, or should there also be a small set of promoted framework-aware graph sections later if repeated patterns emerge?

---

## Recommendation

The recommended starting point is:

1. plugins/lifecycle
2. runtime inspection contributions
3. MCP composition improvements

That order gives Raffel the highest leverage with the least churn. It improves Purple immediately while also creating a better public substrate for any future framework on top of Raffel.
