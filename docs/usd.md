# USD (Universal Service Documentation)

USD is a unified documentation format that extends OpenAPI 3.1 with the `x-usd` namespace to support multiple protocols in a single document.

```
┌─────────────────────────────────────────────────────────────────┐
│                         USD Document                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────────────────────┐              │
│  │    paths    │  │            x-usd            │              │
│  │   (HTTP)    │  │ websocket / streams / rpc   │              │
│  └─────────────┘  │ grpc / tcp / udp / errors   │              │
│                   └─────────────────────────────┘              │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

```ts
import { createServer } from 'raffel'
import { z } from 'zod'

const server = createServer({ port: 3000 })

// Enable USD documentation
server.enableUSD({
  basePath: '/docs',
  info: {
    title: 'My Multi-Protocol API',
    version: '1.0.0',
    description: 'API with HTTP, WebSocket, and Streams support',
  },
})

// Your API definitions are automatically documented
server
  .procedure('users.list')
  .description('List all users')
  .output(z.array(z.object({ id: z.string(), name: z.string() })))
  .handler(async () => [{ id: '1', name: 'Alice' }])

await server.start()
```

Endpoints available at:
- `GET /docs` - Interactive documentation UI
- `GET /docs/usd.json` - USD document (JSON)
- `GET /docs/usd.yaml` - USD document (YAML)
- `GET /docs/openapi.json` - Pure OpenAPI 3.1 (for Swagger UI)

## Configuration

```ts
interface USDMiddlewareConfig {
  // Base path for docs endpoints (default: '/docs')
  basePath?: string

  // API metadata
  info?: {
    title?: string
    version?: string
    description?: string
    termsOfService?: string
    contact?: {
      name?: string
      url?: string
      email?: string
    }
    license?: {
      name: string
      url?: string
    }
  }

  // Server definitions
  servers?: Array<{
    url: string
    description?: string
  }>

  // Protocols to include (auto-detected if not specified)
  protocols?: Array<'http' | 'websocket' | 'streams' | 'jsonrpc' | 'grpc' | 'tcp' | 'udp'>

  // Global content types for non-HTTP protocols
  contentTypes?: {
    default?: string
    supported?: string[]
  }

  // Security schemes
  securitySchemes?: Record<string, SecurityScheme>

  // UI customization
  ui?: {
    theme?: 'light' | 'dark' | 'auto'
    primaryColor?: string
    logo?: string
    tryItOut?: boolean
  }
}
```

## Content Negotiation

USD keeps OpenAPI as the source of truth for HTTP request/response content types. For every other protocol, use `x-usd.contentTypes` to define defaults and override them at the protocol or operation level.

Precedence:
1. Operation-level override
2. Protocol-level override
3. Global `x-usd.contentTypes`

### Global Defaults

```json
{
  "x-usd": {
    "contentTypes": {
      "default": "application/json",
      "supported": [
        "application/json",
        "text/csv",
        "application/x-protobuf",
        "application/octet-stream"
      ]
    }
  }
}
```

### Protocol Overrides

```json
{
  "x-usd": {
    "jsonrpc": {
      "contentTypes": { "default": "application/json" }
    },
    "grpc": {
      "contentTypes": { "default": "application/x-protobuf" }
    },
    "tcp": {
      "contentTypes": { "default": "application/octet-stream" }
    }
  }
}
```

### Operation Overrides

```json
{
  "x-usd": {
    "websocket": {
      "channels": {
        "chat:room:{roomId}": {
          "type": "presence",
          "subscribe": {
            "contentTypes": { "default": "application/json" },
            "message": { "payload": { "$ref": "#/components/schemas/ChatMessage" } }
          }
        }
      }
    },
    "jsonrpc": {
      "methods": {
        "analytics.export": {
          "contentTypes": { "default": "text/csv" },
          "params": { "$ref": "#/components/schemas/ExportRequest" },
          "result": { "$ref": "#/components/schemas/ExportResult" }
        }
      }
    },
    "grpc": {
      "services": {
        "UserService": {
          "methods": {
            "GetUser": {
              "contentTypes": { "default": "application/x-protobuf" },
              "input": { "$ref": "#/components/schemas/GetUserRequest" },
              "output": { "$ref": "#/components/schemas/User" }
            }
          }
        }
      }
    },
    "tcp": {
      "servers": {
        "binary-feed": {
          "host": "localhost",
          "port": 9001,
          "contentTypes": { "default": "application/octet-stream" }
        }
      }
    },
    "udp": {
      "endpoints": {
        "metrics": {
          "host": "localhost",
          "port": 8125,
          "contentTypes": { "default": "text/csv" }
        }
      }
    }
  }
}
```

### DX Shorthand

You can set a single `contentType` in handler metadata and generators will expand it into a full `contentTypes` section:

```ts
export const meta = {
  description: 'Export metrics as CSV',
  contentType: 'text/csv',
}
```

## Protocol Extensions

### HTTP (Standard OpenAPI)

HTTP endpoints use standard OpenAPI `paths`:

```json
{
  "paths": {
    "/users": {
      "get": {
        "operationId": "users.list",
        "summary": "List all users",
        "responses": {
          "200": {
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/UserList" }
              }
            }
          }
        }
      }
    }
  }
}
```

HTTP content negotiation uses OpenAPI `requestBody.content` and `responses[*].content`.

### WebSocket (`x-usd.websocket`)

WebSocket channels are documented in `x-usd.websocket`:

```json
{
  "x-usd": {
    "websocket": {
      "path": "/ws",
      "contentTypes": {
        "default": "application/json",
        "supported": ["application/json", "application/octet-stream"]
      },
      "channels": {
        "chat:room:{roomId}": {
          "type": "presence",
          "description": "Chat room channel with presence",
          "parameters": {
            "roomId": {
              "description": "Room identifier",
              "required": true,
              "schema": { "type": "string" }
            }
          },
          "subscribe": {
            "message": { "payload": { "$ref": "#/components/schemas/ChatMessage" } }
          },
          "publish": {
            "message": { "payload": { "$ref": "#/components/schemas/SendMessage" } }
          },
          "x-usd-presence": {
            "memberSchema": { "$ref": "#/components/schemas/User" }
          }
        }
      }
    }
  }
}
```

Channel types:
- `public` - Anyone can subscribe
- `private` - Requires authentication
- `presence` - Track online users

### Streams (`x-usd.streams`)

Server-Sent Events (SSE) and bidirectional streams:

```json
{
  "x-usd": {
    "streams": {
      "contentTypes": { "default": "application/json" },
      "endpoints": {
        "events": {
          "direction": "server-to-client",
          "description": "Real-time event stream",
          "message": {
            "payload": { "$ref": "#/components/schemas/Event" }
          }
        }
      }
    }
  }
}
```

Stream directions:
- `server-to-client` - SSE from server
- `client-to-server` - Client uploads
- `bidirectional` - Full duplex

### JSON-RPC (`x-usd.jsonrpc`)

JSON-RPC 2.0 methods:

```json
{
  "x-usd": {
    "jsonrpc": {
      "endpoint": "/rpc",
      "version": "2.0",
      "contentTypes": { "default": "application/json" },
      "methods": {
        "calculator.add": {
          "description": "Add two numbers",
          "params": { "$ref": "#/components/schemas/CalcInput" },
          "result": { "$ref": "#/components/schemas/CalcResult" },
          "errors": [
            { "code": -32602, "message": "Invalid params" },
            { "code": -32006, "message": "Rate limited" }
          ]
        }
      }
    }
  }
}
```

### gRPC (`x-usd.grpc`)

gRPC service definitions:

```json
{
  "x-usd": {
    "grpc": {
      "package": "myservice",
      "syntax": "proto3",
      "contentTypes": { "default": "application/x-protobuf" },
      "services": {
        "UserService": {
          "methods": {
            "GetUser": {
              "input": { "$ref": "#/components/schemas/GetUserRequest" },
              "output": { "$ref": "#/components/schemas/User" }
            },
            "ListUsers": {
              "input": { "$ref": "#/components/schemas/ListUsersRequest" },
              "output": { "$ref": "#/components/schemas/User" },
              "x-usd-server-streaming": true
            }
          }
        }
      }
    }
  }
}
```

### TCP (`x-usd.tcp`)

TCP server connections:

```json
{
  "x-usd": {
    "tcp": {
      "contentTypes": { "default": "application/octet-stream" },
      "servers": {
        "game-server": {
          "host": "localhost",
          "port": 9000,
          "framing": {
            "type": "length-prefixed",
            "lengthBytes": 4
          },
          "messages": {
            "inbound": { "payload": { "$ref": "#/components/schemas/GamePacket" } },
            "outbound": { "payload": { "$ref": "#/components/schemas/GameAck" } }
          }
        }
      }
    }
  }
}
```

Framing types:
- `length-prefixed` - Length header before each message
- `delimiter` - Separator between messages (e.g., newline)
- `fixed` - Fixed-size messages
- `none` - Raw stream

### UDP (`x-usd.udp`)

UDP endpoints:

```json
{
  "x-usd": {
    "udp": {
      "contentTypes": { "default": "application/octet-stream" },
      "endpoints": {
        "metrics": {
          "host": "localhost",
          "port": 8125,
          "description": "StatsD-compatible metrics",
          "messages": {
            "inbound": { "payload": { "$ref": "#/components/schemas/Metric" } },
            "outbound": { "payload": { "$ref": "#/components/schemas/MetricAck" } }
          }
        }
      }
    }
  }
}
```

## Programmatic Access

Access USD and OpenAPI documents programmatically:

```ts
const server = createServer({ port: 3000 })
  .enableUSD({ info: { title: 'My API', version: '1.0.0' } })

// ... register procedures ...

// Get documents after start
await server.start()

const usdDoc = server.usd?.getUSDDocument()
const openApiDoc = server.usd?.getOpenAPIDocument()

console.log('Protocols:', usdDoc?.['x-usd']?.protocols)
```

## OpenAPI Compatibility

USD documents are 100% compatible with OpenAPI 3.1 tools:

```ts
// Get pure OpenAPI (without the x-usd namespace)
const openapi = server.usd?.getOpenAPIDocument()

// Use with Swagger UI, Redoc, or any OpenAPI tool
```

The `/docs/openapi.json` endpoint serves a clean OpenAPI document that works with:
- Swagger UI
- ReDoc
- Postman
- OpenAPI Generator
- Any OpenAPI 3.1 compatible tool

## Document Structure

Complete USD document structure:

```json
{
  "usd": "1.0.0",
  "openapi": "3.1.0",
  "info": {
    "title": "My API",
    "version": "1.0.0",
    "description": "Multi-protocol API"
  },
  "servers": [
    { "url": "http://localhost:3000" }
  ],
  "paths": { ... },
  "x-usd": {
    "protocols": ["http", "websocket", "streams"],
    "contentTypes": { ... },
    "websocket": { ... },
    "streams": { ... },
    "jsonrpc": { ... },
    "grpc": { ... },
    "tcp": { ... },
    "udp": { ... },
    "errors": { ... }
  },
  "components": {
    "schemas": { ... },
    "securitySchemes": { ... }
  },
  "tags": [ ... ]
}
```

## Security

Define security schemes for your API:

```ts
server.enableUSD({
  info: { title: 'My API', version: '1.0.0' },
  securitySchemes: {
    bearerAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    },
    apiKey: {
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    },
  },
  defaultSecurity: [{ bearerAuth: [] }],
})
```

## Examples

### Multi-Protocol Content Type Overrides

```json
{
  "usd": "1.0.0",
  "openapi": "3.1.0",
  "info": { "title": "Multi-Protocol API", "version": "1.0.0" },
  "x-usd": {
    "protocols": ["http", "websocket", "jsonrpc", "grpc", "tcp", "udp"],
    "contentTypes": {
      "default": "application/json",
      "supported": [
        "application/json",
        "text/csv",
        "application/x-protobuf",
        "application/octet-stream"
      ]
    },
    "websocket": {
      "contentTypes": { "default": "application/json" }
    },
    "jsonrpc": {
      "contentTypes": { "default": "application/json" },
      "methods": {
        "reports.export": {
          "contentTypes": { "default": "text/csv" }
        }
      }
    },
    "grpc": {
      "contentTypes": { "default": "application/x-protobuf" }
    },
    "tcp": {
      "contentTypes": { "default": "application/octet-stream" },
      "servers": {
        "metrics-feed": {
          "host": "localhost",
          "port": 9001,
          "contentTypes": { "default": "application/octet-stream" }
        }
      }
    },
    "udp": {
      "contentTypes": { "default": "application/octet-stream" },
      "endpoints": {
        "metrics": {
          "host": "localhost",
          "port": 8125,
          "contentTypes": { "default": "text/csv" }
        }
      }
    }
  }
}
```

### Full Multi-Protocol Server

```ts
import { createServer, createZodAdapter, registerValidator } from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

const server = createServer({ port: 3000 })
  .enableJsonRpc('/rpc')
  .enableWebSocket('/ws')
  .enableUSD({
    basePath: '/docs',
    info: {
      title: 'Full-Featured API',
      version: '1.0.0',
      description: 'HTTP, WebSocket, Streams, and JSON-RPC',
    },
    ui: {
      theme: 'auto',
      tryItOut: true,
    },
  })

// HTTP procedure
server
  .procedure('health')
  .output(z.object({ status: z.string() }))
  .handler(async () => ({ status: 'ok' }))

// JSON-RPC procedure
server
  .procedure('calculator.add')
  .input(z.object({ a: z.number(), b: z.number() }))
  .output(z.object({ result: z.number() }))
  .handler(async ({ a, b }) => ({ result: a + b }))

// SSE stream
server
  .stream('ticker')
  .output(z.object({ price: z.number(), timestamp: z.string() }))
  .handler(async function* () {
    while (true) {
      yield { price: Math.random() * 100, timestamp: new Date().toISOString() }
      await new Promise(r => setTimeout(r, 1000))
    }
  })

await server.start()
console.log('Docs available at http://localhost:3000/docs')
```

## Best Practices

1. **Always provide descriptions** - Document your procedures, streams, and channels
2. **Use schemas** - Define input/output schemas with Zod for automatic documentation
3. **Group with tags** - Use tags to organize related endpoints
4. **Include examples** - Add example values to schemas when helpful
5. **Version your API** - Use semantic versioning in `info.version`
