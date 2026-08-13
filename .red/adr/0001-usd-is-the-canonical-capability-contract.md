---
status: accepted
---

# USD is the canonical capability contract

Raffel treats USD as the protocol-independent source of truth for an application capability. OpenAPI, gRPC/proto metadata, and other transport-specific descriptions are projections of that shared contract rather than independent canonical definitions, preserving Raffel's multi-protocol model and avoiding divergent copies of the same capability.

## Consequences

- Protocol-specific information remains representable in USD and appears only in the relevant projection.
- Generators must preserve shared schemas and semantics across projections and report information that cannot be represented without silently changing the contract.
- Imports from OpenAPI or proto become inputs translated into USD, not competing sources of truth after translation.
