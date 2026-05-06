# Architecture Glossary

This glossary names the durable concepts used when evolving Raffel internals.
Use these terms in architecture reviews, issues, tests, and module names so that
implementation details can change without changing the project language.

## Runtime Planning

**Runtime Plan** is the immutable snapshot of how a server will start: selected
entrypoint, protocol bindings, shared middleware features, address book, startup
phases, and shutdown phases.

**Runtime Plan Query** is the behavioural interface for reading a runtime plan.
Consumers should ask questions such as "which entrypoint is selected?", "where is
GraphQL bound?", or "does the HTTP pipeline include docs?" instead of coupling to
raw execution arrays.

**Protocol Binding** is the planned host, port, mode, path, and adapter options
for one protocol. A binding describes what will be started, not how the adapter
executes requests.

**Address Book** is the externally meaningful view of planned protocol addresses.
It records host, port, path, sharing, front-door strategy, and source for tooling,
inspection, and documentation.

## Lifecycle Execution

**Lifecycle Executor** is the module that applies a runtime plan to server state.
It owns phase traversal, adapter startup, stop-task registration, and shutdown
ordering.

**Lifecycle Step** is a behavioural unit the executor can start or stop. Tests
should assert visible outcomes such as registered middleware, started adapters,
and stop order rather than private dispatch branches.

**Stop Task** is a shutdown action registered by a lifecycle step. Stop tasks are
snapshotted in reverse lifecycle order so started resources are released
predictably.

## Discovery

**DiscoverySource** is the module that owns filesystem walking, extension
filtering, dynamic import, stats, and import failure reporting.

**Discovery Adapter** maps discovered files and exports into Raffel domain
objects such as routes, streams, channels, REST resources, TCP handlers, and UDP
handlers. Adapters should not repeat traversal or import ceremony.

**Discovery Stats** are the stable counts and duration emitted by discovery.
They are useful for observability and tests, but they should describe discovered
domain objects rather than filesystem implementation details.

## HTTP Routing

**HTTP Route Table** owns registration and matching semantics for the standalone
HTTP module: exact routes, dynamic params, optional params, wildcards,
precedence, and middleware lookup.

**HttpApp Fetch Adapter** adapts Fetch requests and responses around the route
table. It owns context creation, middleware execution, error handling, not-found
handling, and Node compatibility helpers.

## USD Assembly

**USD Assembly Context** accumulates the generated document facts: paths,
schemas, tags, security schemes, content types, documentation metadata, and
`x-usd` protocol blocks.

**Protocol Generator** contributes facts to the assembly context for one
protocol. It should describe HTTP paths, WebSocket channels, streams, JSON-RPC
methods, gRPC services, TCP servers, or UDP endpoints without owning final
document merge policy.

**OpenAPI Compatibility** is the requirement that generated USD remains valid
OpenAPI 3.1 for HTTP tooling where possible, with multi-protocol data kept under
the USD extension namespace.

## Docs UI Runtime

**Docs UI Runtime** is the browser behaviour for loading Markdown, rendering
navigation, applying themes, running plugins, highlighting code, and handling
hash routing.

**Runtime Delivery Adapter** is the packaging mode for the same runtime
behaviour. Inline scripts and external assets should differ only in delivery,
not in sidebar, routing, Markdown, theme, Prism, or plugin semantics.

## Review Guidance

When reviewing architecture work, start by naming which deep module interface is
being changed: Runtime Plan Query, Lifecycle Executor, DiscoverySource, HTTP
Route Table, USD Assembly Context, or Docs UI Runtime. Prefer tests that ask
behavioural questions through that interface. Keep raw arrays, file layouts, and
adapter dispatch branches internal unless they are themselves the domain concept
under test.
