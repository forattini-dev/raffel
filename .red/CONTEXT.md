# Raffel

The shared language for Raffel as a multi-protocol application runtime.

## Language

**Raffel**:
A server-first multi-protocol runtime whose boundary is exposing and executing application capabilities, not supplying outbound clients, message brokers, or model SDKs.
_Avoid_: Full-stack communications toolkit, client SDK platform

**Live Stream**:
A stream that delivers data only while the consumer remains connected, without recovery of missed messages.
_Avoid_: Resumable stream, durable stream

**Resumable Stream**:
An opt-in stream whose consumer can continue from an acknowledged position after reconnecting.
_Avoid_: Live stream, automatic reconnect

**Resume Cursor**:
An opaque ordered position supplied by the application that identifies where a Resumable Stream consumer can continue.
_Avoid_: Timestamp, process-local sequence

**Poll Cursor**:
An opaque position after which a Long Poll Interaction waits exclusively for a change.
_Avoid_: Resume Cursor, inclusive cursor

**Replay Provider**:
An application-supplied source of ordered stream records used by one or more Resumable Streams.
_Avoid_: Raffel-owned event store, in-memory production replay

**Durable Stream Source**:
An application-owned producer that retains ordered events independently of consumer connections.
_Avoid_: Connection-scoped handler, Raffel background job

**Source-Backed Stream**:
A Resumable Stream whose execution is supplied directly by a Durable Stream Source instead of a connection-scoped handler.
_Avoid_: Resumable handler, persisted handler output

**Stream Record**:
An ordered delivery record containing a Resume Cursor and business data emitted by a Replay Provider.
_Avoid_: Business payload with embedded cursor, transport envelope

**Capability Contract**:
The protocol-independent USD definition of an application capability from which protocol-specific contracts are projected.
_Avoid_: OpenAPI-only contract, unrelated per-protocol contracts

**Stream Snapshot**:
An application-defined representation of current state paired with a valid Resume Cursor for continuing a Resumable Stream.
_Avoid_: Automatic replay fallback, Raffel-owned snapshot

**Contract Projection**:
A protocol-specific representation derived from a Capability Contract that preserves unsupported semantics as explicit extensions and diagnostics.
_Avoid_: Independent protocol contract, silent lossy conversion

**Long Poll Interaction**:
An HTTP interaction that waits for a change or timeout and returns one response carrying continuation metadata.
_Avoid_: Stream, repeated responses, new capability kind

**AI workload**:
Application behavior that uses Raffel's general protocol capabilities without becoming a Raffel-owned model or AI abstraction.
_Avoid_: Raffel AI runtime, built-in model integration

**Raffel MCP**:
Raffel's implementation of the Model Context Protocol for exposing tools, resources, prompts, and protocol capabilities.
_Avoid_: Raffel AI Assistant, Raffel AI runtime

## Relationships

- **Raffel** exposes application capabilities through one or more inbound protocols
- Applications integrate outbound clients, message brokers, and model SDKs around **Raffel**
- A **Resumable Stream** adds recovery semantics that a **Live Stream** does not provide
- A **Resumable Stream** uses a **Resume Cursor** and provides at-least-once delivery across reconnections
- A **Long Poll Interaction** uses a **Poll Cursor** without repeating the indicated change
- A **Resumable Stream** names a **Replay Provider** rather than relying on process-local history
- A **Resumable Stream** subscribes to a **Durable Stream Source** that continues independently of its consumers
- A **Source-Backed Stream** is the runtime form of a **Resumable Stream**
- A **Replay Provider** emits **Stream Records** while the Capability Contract describes their business data
- An **AI workload** may consume a **Live Stream** or **Resumable Stream** without changing Raffel's server-first boundary
- **Raffel MCP** is a protocol surface of **Raffel**, not a model-provider abstraction
- A **Capability Contract** may project OpenAPI for HTTP and proto metadata for gRPC
- A consumer recovers an expired **Resume Cursor** by obtaining a **Stream Snapshot**
- A **Contract Projection** derives from a **Capability Contract** without silently discarding semantics
- A **Long Poll Interaction** remains an ordinary HTTP capability and is distinguished by contract metadata

## Example dialogue

> **Dev:** "Should Raffel include an HTTP client for calling another service?"
> **Maintainer:** "No — Raffel owns the server runtime; the application chooses its outbound client."
>
> **Dev:** "Does streaming model output make Raffel an AI framework?"
> **Maintainer:** "No — AI is one workload using Raffel's general streaming surface."

## Flagged ambiguities

- "Communication toolkit" can imply ownership of both server and client runtimes — resolved: **Raffel** is server-first.
- "AI support" can imply model-provider abstractions — resolved: Raffel supports **AI workloads** only through its general server capabilities.
- "Raffel AI Assistant" conflates MCP interoperability with model ownership — resolved: use **Raffel MCP**.
- "Reconnect" can imply recovery of missed data — resolved: only a **Resumable Stream** promises continuation.
- "API contract" can mean a transport-specific document or the shared capability — resolved: **Capability Contract** means the USD source; OpenAPI and proto are projections.
