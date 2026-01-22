# USD Specification

Universal Service Documentation (USD) is a specification for documenting multi-protocol APIs. It extends OpenAPI 3.1 to support WebSocket, Streams (SSE), JSON-RPC, gRPC, TCP, and UDP in a single unified document.

## Versions

| Version | Status | Specification | JSON Schema |
|---------|--------|---------------|-------------|
| **1.0.0** | Current | [usd-1.0.0.md](usd-1.0.0.md) | [usd-schema-1.0.0.json](usd-schema-1.0.0.json) |

## Quick Links

- [Full Specification](usd-1.0.0.md)
- [JSON Schema](usd-schema-1.0.0.json)
- [Usage Guide](../usd.md)

## Key Concepts

### Relationship with OpenAPI

USD is a **superset** of OpenAPI 3.1:

```
┌─────────────────────────────────────────────────┐
│               USD Document                       │
│  ┌───────────────────────────────────────────┐  │
│  │         OpenAPI 3.1 Document              │  │
│  │   (paths, components, security, etc.)     │  │
│  └───────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────┐  │
│  │            x-usd Extension                │  │
│  │  (websocket, streams, jsonrpc, grpc,     │  │
│  │   tcp, udp, errors, contentTypes)         │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### Supported Protocols

| Protocol | Description | Extension Location |
|----------|-------------|-------------------|
| HTTP | Standard REST APIs | `paths` (OpenAPI) |
| WebSocket | Real-time channels | `x-usd.websocket` |
| Streams | SSE / HTTP Streams | `x-usd.streams` |
| JSON-RPC | JSON-RPC 2.0 methods | `x-usd.jsonrpc` |
| gRPC | gRPC services | `x-usd.grpc` |
| TCP | Raw TCP servers | `x-usd.tcp` |
| UDP | UDP endpoints | `x-usd.udp` |

### Content Negotiation

USD provides hierarchical content type configuration:

```
Operation-level  →  Protocol-level  →  Global x-usd  →  Built-in defaults
   (highest)                              (lowest)
```

### Unified Errors

Define errors once, use across all protocols:

```yaml
x-usd:
  errors:
    NotFound:
      status: 404      # HTTP
      code: -32001     # JSON-RPC
      grpcCode: 5      # gRPC
      message: Resource not found
```

## Minimal Example

```yaml
usd: "1.0.0"
openapi: "3.1.0"
info:
  title: My API
  version: "1.0.0"
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        "200":
          description: Success
x-usd:
  protocols: [http, websocket]
  websocket:
    path: /ws
    channels:
      users:
        type: public
        subscribe:
          message:
            payload:
              type: object
```

## Validation

Use the JSON Schema to validate USD documents:

```bash
# Using ajv-cli
ajv validate -s usd-schema-1.0.0.json -d your-api.usd.yaml

# Using Raffel
npx raffel validate your-api.usd.yaml
```

## Contributing

USD is developed as part of [Raffel](https://github.com/tetis-io/raffel). Contributions welcome!

## License

Apache 2.0
