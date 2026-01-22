# USD Specification

## Version 1.0.0

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [BCP 14](https://tools.ietf.org/html/bcp14) [RFC2119](https://tools.ietf.org/html/rfc2119) [RFC8174](https://tools.ietf.org/html/rfc8174) when, and only when, they appear in all capitals, as shown here.

This document is licensed under [The Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0.html).

---

## Table of Contents

1. [Introduction](#introduction)
2. [Definitions](#definitions)
3. [Specification](#specification)
   - [Versions](#versions)
   - [Format](#format)
   - [Document Structure](#document-structure)
   - [Schema](#schema)
4. [USD Object](#usd-object)
5. [Info Object](#info-object)
6. [Server Object](#server-object)
7. [Components Object](#components-object)
8. [Paths Object](#paths-object)
9. [x-usd Extension](#x-usd-extension)
   - [Protocol Servers](#protocol-servers)
   - [Content Types](#content-types)
   - [WebSocket](#websocket)
   - [Streams](#streams)
   - [JSON-RPC](#json-rpc)
   - [gRPC](#grpc)
   - [TCP](#tcp)
   - [UDP](#udp)
   - [Errors](#errors)
   - [Documentation](#documentation)
10. [Security](#security)
11. [Specification Extensions](#specification-extensions)
12. [Appendix A: Revision History](#appendix-a-revision-history)

---

## Introduction

The Universal Service Documentation (USD) Specification defines a standard, programming language-agnostic interface description for multi-protocol APIs. USD extends [OpenAPI Specification 3.1](https://spec.openapis.org/oas/v3.1.0) to support additional protocols beyond HTTP, including WebSocket, Server-Sent Events (Streams), JSON-RPC, gRPC, TCP, and UDP.

A USD document describes a complete API surface across all its transport protocols in a single, unified document. This allows both humans and machines to understand and interact with services without requiring access to source code, additional documentation, or network traffic inspection.

### Design Principles

1. **OpenAPI Compatibility**: A USD document is a valid OpenAPI 3.1 document. Tools that understand OpenAPI MUST be able to process the HTTP portions of a USD document.

2. **Single Source of Truth**: All protocols are documented in one place, sharing schemas, security definitions, and server configurations.

3. **Protocol Agnostic Core**: Shared concepts (schemas, errors, security) are defined once and reused across protocols.

4. **Progressive Enhancement**: Start with HTTP (OpenAPI), add other protocols as needed via the `x-usd` extension.

5. **Content Negotiation**: Each protocol can specify its own content types with a clear precedence hierarchy.

### Relationship with OpenAPI

USD is a **superset** of OpenAPI 3.1. Every valid USD document is also a valid OpenAPI 3.1 document. The relationship can be visualized as:

```
┌─────────────────────────────────────────────────────────────────┐
│                         USD Document                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐            │
│  │              OpenAPI 3.1 Document                │            │
│  │  ┌─────────┐  ┌─────────┐  ┌───────────────┐   │            │
│  │  │  info   │  │  paths  │  │  components   │   │            │
│  │  └─────────┘  └─────────┘  └───────────────┘   │            │
│  │  ┌─────────┐  ┌─────────┐  ┌───────────────┐   │            │
│  │  │ servers │  │security │  │     tags      │   │            │
│  │  └─────────┘  └─────────┘  └───────────────┘   │            │
│  └─────────────────────────────────────────────────┘            │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                        x-usd Extension                       ││
│  │  ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌───────────────┐ ││
│  │  │ websocket │ │  streams  │ │ jsonrpc  │ │     grpc      │ ││
│  │  └───────────┘ └───────────┘ └──────────┘ └───────────────┘ ││
│  │  ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌───────────────┐ ││
│  │  │    tcp    │ │    udp    │ │  errors  │ │ contentTypes  │ ││
│  │  └───────────┘ └───────────┘ └──────────┘ └───────────────┘ ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Relationship with AsyncAPI

USD differs from [AsyncAPI](https://www.asyncapi.com/) in several key ways:

| Aspect | USD | AsyncAPI |
|--------|-----|----------|
| **Base** | Extends OpenAPI 3.1 | Separate specification |
| **HTTP Support** | Native (OpenAPI paths) | Via bindings |
| **Single Document** | Always one document | Often multiple docs |
| **Tool Compatibility** | Works with OpenAPI tools | Requires AsyncAPI tools |
| **Focus** | Multi-protocol APIs | Event-driven architectures |

USD is ideal for APIs that expose the same business logic over multiple transports. AsyncAPI is better suited for complex event-driven systems with many channels and message types.

---

## Definitions

### USD Document

A self-contained resource which defines or describes an API. A USD document uses and conforms to both the OpenAPI Specification 3.1 and this USD Specification.

### Path Templating

Path templating refers to the usage of template expressions, delimited by curly braces (`{}`), to mark a section of a URL path or channel name as replaceable using path parameters.

Each template expression in the path MUST correspond to a path parameter defined in the parameters section.

### Media Types

Media type definitions follow [RFC6838](https://tools.ietf.org/html/rfc6838).

Common media types in USD:

| Media Type | Usage |
|------------|-------|
| `application/json` | JSON data (default for most protocols) |
| `application/x-protobuf` | Protocol Buffers (default for gRPC) |
| `application/octet-stream` | Binary data (default for TCP/UDP) |
| `text/event-stream` | Server-Sent Events |
| `application/x-ndjson` | Newline-delimited JSON (streaming) |
| `text/csv` | CSV data |

### Protocol

A transport mechanism used to communicate with an API. USD supports:

| Protocol | Description | Default Port |
|----------|-------------|--------------|
| `http` | HTTP/HTTPS (standard OpenAPI) | 80/443 |
| `websocket` | WebSocket connections | 80/443 |
| `streams` | Server-Sent Events (SSE) | 80/443 |
| `jsonrpc` | JSON-RPC 2.0 over HTTP/WS | 80/443 |
| `grpc` | gRPC (HTTP/2) | 443 |
| `tcp` | Raw TCP connections | Custom |
| `udp` | UDP datagrams | Custom |

---

## Specification

### Versions

The USD Specification is versioned using a `major.minor.patch` versioning scheme. The `major.minor` portion of the version string (e.g., `1.0`) SHALL designate the USD feature set. Patch versions address errors in, or provide clarifications to, this document, not the feature set.

The current version is **1.0.0**.

### Format

A USD document is represented in either JSON or YAML format. All field names are case-sensitive.

The document MUST be a single file. USD does not support multi-file documents through `$ref` to external files at the root level (though `$ref` within `components` is allowed).

### Document Structure

A USD document MAY be made up of a single document or be divided into multiple connected parts at the discretion of the author. In the latter case, Reference Objects are used.

### Schema

This specification uses JSON Schema Draft 2020-12 for schema definitions. The USD JSON Schema is available at:

```
https://raffel.dev/schemas/usd/1.0.0/usd-schema.json
```

---

## USD Object

This is the root object of the USD document.

### Fixed Fields

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| usd | `string` | **Yes** | **MUST** be `"1.0.0"`. The USD Specification version. |
| openapi | `string` | **Yes** | **MUST** be `"3.1.0"`. The OpenAPI Specification version. |
| info | [Info Object](#info-object) | **Yes** | Provides metadata about the API. |
| servers | [[Server Object](#server-object)] | No | Array of HTTP Server Objects for connectivity. |
| paths | [Paths Object](#paths-object) | No | HTTP paths and operations (OpenAPI standard). |
| components | [Components Object](#components-object) | No | Reusable schemas, parameters, responses, etc. |
| security | [[Security Requirement Object](#security-requirement-object)] | No | Global security requirements. |
| tags | [[Tag Object](#tag-object)] | No | Tags for organization. |
| x-tagGroups | [[Tag Group Object](#tag-group-object)] | No | Hierarchical tag grouping. |
| externalDocs | [External Documentation Object](#external-documentation-object) | No | Additional external documentation. |
| x-usd | [x-usd Object](#x-usd-extension) | No | USD protocol extensions. |

### Example

```yaml
usd: "1.0.0"
openapi: "3.1.0"
info:
  title: Multi-Protocol API
  version: "1.0.0"
  description: An API that speaks HTTP, WebSocket, and gRPC
servers:
  - url: https://api.example.com
    description: Production server
paths:
  /users:
    get:
      operationId: listUsers
      responses:
        "200":
          description: List of users
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserList"
x-usd:
  protocols:
    - http
    - websocket
    - grpc
  websocket:
    path: /ws
    channels:
      users:
        type: public
        subscribe:
          message:
            payload:
              $ref: "#/components/schemas/UserEvent"
components:
  schemas:
    User:
      type: object
      properties:
        id:
          type: string
        name:
          type: string
    UserList:
      type: array
      items:
        $ref: "#/components/schemas/User"
    UserEvent:
      type: object
      properties:
        type:
          type: string
          enum: [created, updated, deleted]
        user:
          $ref: "#/components/schemas/User"
```

---

## Info Object

Provides metadata about the API. The metadata MAY be used by tooling as required.

### Fixed Fields

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| title | `string` | **Yes** | The title of the API. |
| version | `string` | **Yes** | The version of the API document. |
| description | `string` | No | Description of the API. Supports CommonMark markdown. |
| summary | `string` | No | Short summary of the API. |
| termsOfService | `string` | No | URL to the Terms of Service. MUST be a valid URL. |
| contact | [Contact Object](#contact-object) | No | Contact information for the API. |
| license | [License Object](#license-object) | No | License information for the API. |

### Contact Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| name | `string` | No | The identifying name of the contact. |
| url | `string` | No | URL pointing to the contact information. |
| email | `string` | No | Email address of the contact. MUST be valid email format. |

### License Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| name | `string` | **Yes** | The license name. |
| url | `string` | No | URL to the license. |
| identifier | `string` | No | SPDX license expression. |

### Example

```yaml
info:
  title: Awesome API
  version: "2.1.0"
  description: |
    # Overview
    This is an awesome multi-protocol API.

    ## Features
    - HTTP REST endpoints
    - Real-time WebSocket channels
    - gRPC for high-performance
  summary: Multi-protocol API for awesome things
  termsOfService: https://example.com/tos
  contact:
    name: API Support
    url: https://support.example.com
    email: support@example.com
  license:
    name: Apache 2.0
    url: https://www.apache.org/licenses/LICENSE-2.0.html
```

---

## Server Object

An object representing a server.

### Fixed Fields

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| url | `string` | **Yes** | URL to the server. MAY contain variables. |
| description | `string` | No | Description of the server. |
| variables | Map[`string`, [Server Variable Object](#server-variable-object)] | No | Map of server variables. |

### Server Variable Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| enum | [`string`] | No | Enumeration of allowed values. |
| default | `string` | **Yes** | Default value. MUST exist in `enum` if provided. |
| description | `string` | No | Description of the variable. |

### Example

```yaml
servers:
  - url: https://{region}.api.example.com/v{version}
    description: Production server with region selection
    variables:
      region:
        default: us
        enum:
          - us
          - eu
          - asia
        description: Server region
      version:
        default: "1"
        description: API version
```

---

## Components Object

Holds a set of reusable objects. All objects defined in components have no effect unless they are explicitly referenced.

### Fixed Fields

| Field Name | Type | Description |
|------------|------|-------------|
| schemas | Map[`string`, [Schema Object](#schema-object)] | Reusable Schema Objects. |
| responses | Map[`string`, [Response Object](#response-object)] | Reusable Response Objects. |
| parameters | Map[`string`, [Parameter Object](#parameter-object)] | Reusable Parameter Objects. |
| examples | Map[`string`, [Example Object](#example-object)] | Reusable Example Objects. |
| requestBodies | Map[`string`, [Request Body Object](#request-body-object)] | Reusable Request Body Objects. |
| headers | Map[`string`, [Header Object](#header-object)] | Reusable Header Objects. |
| securitySchemes | Map[`string`, [Security Scheme Object](#security-scheme-object)] | Reusable Security Scheme Objects. |
| links | Map[`string`, [Link Object](#link-object)] | Reusable Link Objects. |
| callbacks | Map[`string`, [Callback Object](#callback-object)] | Reusable Callback Objects. |
| pathItems | Map[`string`, [Path Item Object](#path-item-object)] | Reusable Path Item Objects. |

All keys MUST match the regular expression: `^[a-zA-Z0-9._-]+$`

### Example

```yaml
components:
  schemas:
    User:
      type: object
      required:
        - id
        - name
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
          minLength: 1
          maxLength: 100
        email:
          type: string
          format: email
    Error:
      type: object
      required:
        - code
        - message
      properties:
        code:
          type: integer
        message:
          type: string
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
    apiKey:
      type: apiKey
      in: header
      name: X-API-Key
```

---

## Paths Object

Holds the relative paths to the individual HTTP endpoints. The path is appended to the URL from the Server Object to construct the full URL.

This is standard OpenAPI 3.1 syntax. See the [OpenAPI Specification](https://spec.openapis.org/oas/v3.1.0#paths-object) for complete documentation.

### Example

```yaml
paths:
  /users:
    get:
      operationId: listUsers
      summary: List all users
      tags:
        - users
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
            default: 20
            maximum: 100
      responses:
        "200":
          description: Successful response
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/User"
    post:
      operationId: createUser
      summary: Create a new user
      tags:
        - users
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateUserRequest"
      responses:
        "201":
          description: User created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/User"
  /users/{id}:
    get:
      operationId: getUser
      summary: Get user by ID
      tags:
        - users
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        "200":
          description: Successful response
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/User"
        "404":
          description: User not found
```

---

## x-usd Extension

The `x-usd` extension is the core of the USD specification. It contains all protocol-specific definitions beyond HTTP.

### Fixed Fields

| Field Name | Type | Description |
|------------|------|-------------|
| protocols | [`string`] | List of protocols used. Values: `http`, `websocket`, `streams`, `jsonrpc`, `grpc`, `tcp`, `udp`. |
| servers | [[Protocol Server Object](#protocol-server-object)] | Protocol-specific servers (non-HTTP). |
| contentTypes | [Content Types Object](#content-types-object) | Global default content types. |
| messages | Map[`string`, [Message Object](#message-object)] | Reusable message definitions. |
| websocket | [WebSocket Object](#websocket-object) | WebSocket channel definitions. |
| streams | [Streams Object](#streams-object) | Stream endpoint definitions. |
| jsonrpc | [JSON-RPC Object](#json-rpc-object) | JSON-RPC method definitions. |
| grpc | [gRPC Object](#grpc-object) | gRPC service definitions. |
| tcp | [TCP Object](#tcp-object) | TCP server definitions. |
| udp | [UDP Object](#udp-object) | UDP endpoint definitions. |
| errors | Map[`string`, [Error Object](#error-object)] | Unified error definitions. |
| documentation | [Documentation Object](#documentation-object) | Documentation UI customization (hero, introduction). |

### Protocol Server Object

Defines a server for non-HTTP protocols.

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| url | `string` | **Yes** | Server URL (e.g., `wss://ws.example.com`). |
| protocol | `string` | **Yes** | Protocol type. |
| description | `string` | No | Server description. |
| variables | Map[`string`, Server Variable Object] | No | URL template variables. |

### Example

```yaml
x-usd:
  protocols:
    - http
    - websocket
    - grpc
    - tcp
  servers:
    - url: wss://ws.example.com
      protocol: websocket
      description: WebSocket server
    - url: grpc://grpc.example.com:50051
      protocol: grpc
      description: gRPC server
    - url: tcp://tcp.example.com:9000
      protocol: tcp
      description: Raw TCP server
  contentTypes:
    default: application/json
    supported:
      - application/json
      - application/x-protobuf
      - application/octet-stream
```

---

## Content Types Object

Defines content type defaults and supported types. Content negotiation follows a strict precedence:

1. **Operation-level** `contentTypes` (highest priority)
2. **Protocol-level** `contentTypes`
3. **Global** `x-usd.contentTypes`
4. **Built-in defaults** (lowest priority)

### Fixed Fields

| Field Name | Type | Description |
|------------|------|-------------|
| default | `string` | Default content type when not specified. |
| supported | [`string`] | Additional supported content types. |

### Built-in Defaults by Protocol

| Protocol | Default Content Type |
|----------|---------------------|
| http | Per OpenAPI `requestBody.content` / `responses.content` |
| websocket | `application/json` |
| streams | `application/json` |
| jsonrpc | `application/json` |
| grpc | `application/x-protobuf` |
| tcp | `application/octet-stream` |
| udp | `application/octet-stream` |

### Example

```yaml
x-usd:
  # Global defaults
  contentTypes:
    default: application/json
    supported:
      - application/json
      - text/csv
      - application/x-protobuf

  # Protocol-level override
  grpc:
    contentTypes:
      default: application/x-protobuf
    services:
      UserService:
        methods:
          GetUser:
            # Operation-level override (highest priority)
            contentTypes:
              default: application/x-protobuf
            input:
              $ref: "#/components/schemas/GetUserRequest"
            output:
              $ref: "#/components/schemas/User"

  # JSON-RPC with CSV export
  jsonrpc:
    methods:
      reports.export:
        contentTypes:
          default: text/csv
        result:
          type: string
          description: CSV data
```

---

## WebSocket Object

Defines WebSocket channel configurations.

### Fixed Fields

| Field Name | Type | Description |
|------------|------|-------------|
| path | `string` | WebSocket endpoint path (e.g., `/ws`). |
| contentTypes | [Content Types Object](#content-types-object) | Default content types for WebSocket messages. |
| channels | Map[`string`, [Channel Object](#channel-object)] | Channel definitions. Keys support path templating. |
| authentication | [WebSocket Authentication Object](#websocket-authentication-object) | How to authenticate WebSocket connections. |
| events | [WebSocket Events Object](#websocket-events-object) | Connection lifecycle events. |

### Channel Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| type | `string` | **Yes** | Channel type: `public`, `private`, or `presence`. |
| description | `string` | No | Channel description. |
| parameters | Map[`string`, Channel Parameter Object] | No | Path parameters for templated channel names. |
| tags | [`string`] | No | Tags for grouping. |
| subscribe | [Channel Operation Object](#channel-operation-object) | No | Messages from server to client. |
| publish | [Channel Operation Object](#channel-operation-object) | No | Messages from client to server. |
| x-usd-presence | [Presence Object](#presence-object) | No | Presence tracking (only for `presence` type). |

### Channel Types

| Type | Description | Use Case |
|------|-------------|----------|
| `public` | Anyone can subscribe. No authentication required. | Public feeds, announcements |
| `private` | Requires authentication. Server validates access. | User-specific data |
| `presence` | Like `private`, but tracks who is subscribed. | Chat rooms, collaborative editing |

### Channel Operation Object

| Field Name | Type | Description |
|------------|------|-------------|
| summary | `string` | Short summary. |
| description | `string` | Detailed description. |
| contentTypes | [Content Types Object](#content-types-object) | Override content types. |
| message | [Message Object](#message-object) or Reference | Message schema. |
| tags | [`string`] | Tags for grouping. |
| security | [[Security Requirement Object](#security-requirement-object)] | Security requirements. |

### Presence Object

| Field Name | Type | Description |
|------------|------|-------------|
| memberSchema | Schema Object or Reference | Schema for member data. |
| events | [`string`] | Events to emit: `member_added`, `member_removed`, `member_updated`. |

### Example

```yaml
x-usd:
  websocket:
    path: /ws
    contentTypes:
      default: application/json
    authentication:
      in: query
      name: token
      description: JWT token for authentication
    channels:
      # Public channel - no parameters
      announcements:
        type: public
        description: Public announcements
        subscribe:
          message:
            payload:
              $ref: "#/components/schemas/Announcement"

      # Private channel with parameter
      user:{userId}:
        type: private
        description: User-specific notifications
        parameters:
          userId:
            description: User ID
            required: true
            schema:
              type: string
              format: uuid
        subscribe:
          message:
            payload:
              $ref: "#/components/schemas/UserNotification"

      # Presence channel
      room:{roomId}:
        type: presence
        description: Chat room with presence tracking
        parameters:
          roomId:
            description: Room identifier
            required: true
            schema:
              type: string
        subscribe:
          message:
            payload:
              $ref: "#/components/schemas/ChatMessage"
        publish:
          message:
            payload:
              $ref: "#/components/schemas/SendMessage"
        x-usd-presence:
          memberSchema:
            $ref: "#/components/schemas/ChatMember"
          events:
            - member_added
            - member_removed
```

---

## Streams Object

Defines Server-Sent Events (SSE) and streaming endpoints.

### Fixed Fields

| Field Name | Type | Description |
|------------|------|-------------|
| contentTypes | [Content Types Object](#content-types-object) | Default content types. |
| endpoints | Map[`string`, [Stream Endpoint Object](#stream-endpoint-object)] | Stream endpoint definitions. |

### Stream Endpoint Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| description | `string` | No | Endpoint description. |
| direction | `string` | **Yes** | Stream direction. |
| contentTypes | [Content Types Object](#content-types-object) | No | Override content types. |
| message | [Message Object](#message-object) or Reference | **Yes** | Message schema. |
| tags | [`string`] | No | Tags for grouping. |
| security | [[Security Requirement Object](#security-requirement-object)] | No | Security requirements. |
| x-usd-backpressure | `boolean` | No | Whether backpressure is supported. |

### Stream Directions

| Direction | Description | Implementation |
|-----------|-------------|----------------|
| `server-to-client` | Server pushes events to client. | SSE, `EventSource` API |
| `client-to-server` | Client pushes data to server. | Upload streams |
| `bidirectional` | Full duplex streaming. | HTTP/2 streams |

### Example

```yaml
x-usd:
  streams:
    contentTypes:
      default: application/json
    endpoints:
      # Server-Sent Events (SSE)
      events:
        direction: server-to-client
        description: Real-time event stream
        message:
          payload:
            $ref: "#/components/schemas/ServerEvent"

      # Bidirectional stream
      chat:
        direction: bidirectional
        description: Chat stream
        x-usd-backpressure: true
        message:
          payload:
            $ref: "#/components/schemas/ChatMessage"
```

---

## JSON-RPC Object

Defines JSON-RPC 2.0 methods.

### Fixed Fields

| Field Name | Type | Description |
|------------|------|-------------|
| endpoint | `string` | HTTP endpoint path for JSON-RPC (e.g., `/rpc`). |
| version | `string` | JSON-RPC version. MUST be `"2.0"`. |
| contentTypes | [Content Types Object](#content-types-object) | Default content types. |
| methods | Map[`string`, [JSON-RPC Method Object](#json-rpc-method-object)] | Method definitions. |
| batch | [Batch Object](#batch-object) | Batch request configuration. |

### JSON-RPC Method Object

| Field Name | Type | Description |
|------------|------|-------------|
| description | `string` | Method description. |
| contentTypes | [Content Types Object](#content-types-object) | Override content types. |
| params | Schema Object or Reference | Parameters schema. |
| result | Schema Object or Reference | Result schema. |
| errors | [[JSON-RPC Error Object](#json-rpc-error-object)] | Possible errors. |
| tags | [`string`] | Tags for grouping. |
| security | [[Security Requirement Object](#security-requirement-object)] | Security requirements. |
| x-usd-streaming | `boolean` | Whether method supports streaming responses. |
| x-usd-notification | `boolean` | Whether method is a notification (no response). |

### JSON-RPC Error Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| code | `integer` | **Yes** | JSON-RPC error code. |
| message | `string` | **Yes** | Error message. |
| description | `string` | No | Detailed description. |
| data | Schema Object or Reference | No | Additional error data schema. |

### Standard JSON-RPC Error Codes

| Code | Message | Description |
|------|---------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid Request | Not a valid JSON-RPC request |
| -32601 | Method not found | Method does not exist |
| -32602 | Invalid params | Invalid method parameters |
| -32603 | Internal error | Internal JSON-RPC error |
| -32000 to -32099 | Server error | Reserved for server errors |

### USD Extended Error Codes

| Code | Message | Description |
|------|---------|-------------|
| -32001 | Not found | Resource not found |
| -32002 | Unauthorized | Authentication required |
| -32003 | Forbidden | Permission denied |
| -32004 | Conflict | Resource conflict |
| -32005 | Rate limited | Too many requests |

### Example

```yaml
x-usd:
  jsonrpc:
    endpoint: /rpc
    version: "2.0"
    contentTypes:
      default: application/json
    batch:
      enabled: true
      maxSize: 10
    methods:
      users.get:
        description: Get a user by ID
        params:
          type: object
          required:
            - id
          properties:
            id:
              type: string
              format: uuid
        result:
          $ref: "#/components/schemas/User"
        errors:
          - code: -32001
            message: User not found
            description: The requested user does not exist

      calculator.add:
        description: Add two numbers
        params:
          type: object
          required:
            - a
            - b
          properties:
            a:
              type: number
            b:
              type: number
        result:
          type: object
          properties:
            result:
              type: number
```

---

## gRPC Object

Defines gRPC service configurations.

### Fixed Fields

| Field Name | Type | Description |
|------------|------|-------------|
| package | `string` | Proto package name (e.g., `myservice.v1`). |
| syntax | `string` | Proto syntax version: `proto3` (default) or `proto2`. |
| contentTypes | [Content Types Object](#content-types-object) | Default content types. |
| services | Map[`string`, [gRPC Service Object](#grpc-service-object)] | Service definitions. |
| options | `object` | Proto file options. |

### gRPC Service Object

| Field Name | Type | Description |
|------------|------|-------------|
| description | `string` | Service description. |
| methods | Map[`string`, [gRPC Method Object](#grpc-method-object)] | Method definitions. |

### gRPC Method Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| description | `string` | No | Method description. |
| contentTypes | [Content Types Object](#content-types-object) | No | Override content types. |
| input | Schema Object or Reference | **Yes** | Input message schema. |
| output | Schema Object or Reference | **Yes** | Output message schema. |
| tags | [`string`] | No | Tags for grouping. |
| x-usd-client-streaming | `boolean` | No | Client streaming enabled. |
| x-usd-server-streaming | `boolean` | No | Server streaming enabled. |

### gRPC Method Types

| Client Streaming | Server Streaming | Type | Description |
|------------------|------------------|------|-------------|
| false | false | Unary | Single request, single response |
| false | true | Server streaming | Single request, stream of responses |
| true | false | Client streaming | Stream of requests, single response |
| true | true | Bidirectional | Stream of requests, stream of responses |

### Example

```yaml
x-usd:
  grpc:
    package: users.v1
    syntax: proto3
    services:
      UserService:
        description: User management service
        methods:
          GetUser:
            description: Get a single user
            input:
              $ref: "#/components/schemas/GetUserRequest"
            output:
              $ref: "#/components/schemas/User"

          ListUsers:
            description: List users with server streaming
            x-usd-server-streaming: true
            input:
              $ref: "#/components/schemas/ListUsersRequest"
            output:
              $ref: "#/components/schemas/User"

          Chat:
            description: Bidirectional chat stream
            x-usd-client-streaming: true
            x-usd-server-streaming: true
            input:
              $ref: "#/components/schemas/ChatMessage"
            output:
              $ref: "#/components/schemas/ChatMessage"

components:
  schemas:
    GetUserRequest:
      type: object
      properties:
        id:
          type: string
    ListUsersRequest:
      type: object
      properties:
        page_size:
          type: integer
        page_token:
          type: string
```

---

## TCP Object

Defines raw TCP server configurations.

### Fixed Fields

| Field Name | Type | Description |
|------------|------|-------------|
| contentTypes | [Content Types Object](#content-types-object) | Default content types. |
| servers | Map[`string`, [TCP Server Object](#tcp-server-object)] | Server definitions. |

### TCP Server Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| description | `string` | No | Server description. |
| contentTypes | [Content Types Object](#content-types-object) | No | Override content types. |
| host | `string` | **Yes** | Host address (e.g., `localhost`, `0.0.0.0`). |
| port | `integer` | **Yes** | Port number (1-65535). |
| tls | [TLS Object](#tls-object) | No | TLS configuration. |
| framing | [Framing Object](#framing-object) | No | Message framing configuration. |
| messages | [TCP Messages Object](#tcp-messages-object) | No | Message schemas. |
| lifecycle | [Lifecycle Object](#lifecycle-object) | No | Connection lifecycle. |
| tags | [`string`] | No | Tags for grouping. |
| security | [[Security Requirement Object](#security-requirement-object)] | No | Security requirements. |

### TLS Object

| Field Name | Type | Description |
|------------|------|-------------|
| enabled | `boolean` | Whether TLS is enabled. |
| cert | `string` | Certificate path (documentation only). |
| key | `string` | Key path (documentation only). |
| ca | `string` | CA certificate path. |
| clientAuth | `boolean` | Whether client certificates are required. |

### Framing Object

| Field Name | Type | Description |
|------------|------|-------------|
| type | `string` | Framing type: `length-prefixed`, `delimiter`, `fixed`, `none`. |
| lengthBytes | `integer` | Bytes for length prefix: `1`, `2`, `4`, or `8`. |
| byteOrder | `string` | Byte order: `big-endian` or `little-endian`. |
| delimiter | `string` | Delimiter string (for `delimiter` type). |
| fixedSize | `integer` | Fixed frame size in bytes. |

### TCP Messages Object

| Field Name | Type | Description |
|------------|------|-------------|
| inbound | Message Object or Reference | Client to server message schema. |
| outbound | Message Object or Reference | Server to client message schema. |

### Example

```yaml
x-usd:
  tcp:
    contentTypes:
      default: application/octet-stream
    servers:
      game-server:
        description: Game server for multiplayer
        host: "0.0.0.0"
        port: 9000
        tls:
          enabled: true
          clientAuth: false
        framing:
          type: length-prefixed
          lengthBytes: 4
          byteOrder: big-endian
        messages:
          inbound:
            payload:
              $ref: "#/components/schemas/GamePacket"
          outbound:
            payload:
              $ref: "#/components/schemas/GameResponse"
        lifecycle:
          onConnect: Client handshake and authentication
          onDisconnect: Cleanup player state
          keepAlive:
            enabled: true
            intervalMs: 30000
```

---

## UDP Object

Defines UDP endpoint configurations.

### Fixed Fields

| Field Name | Type | Description |
|------------|------|-------------|
| contentTypes | [Content Types Object](#content-types-object) | Default content types. |
| endpoints | Map[`string`, [UDP Endpoint Object](#udp-endpoint-object)] | Endpoint definitions. |

### UDP Endpoint Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| description | `string` | No | Endpoint description. |
| contentTypes | [Content Types Object](#content-types-object) | No | Override content types. |
| host | `string` | **Yes** | Host address. |
| port | `integer` | **Yes** | Port number (1-65535). |
| multicast | [Multicast Object](#multicast-object) | No | Multicast configuration. |
| maxPacketSize | `integer` | No | Maximum packet size (max 65507). |
| messages | [UDP Messages Object](#udp-messages-object) | No | Message schemas. |
| reliability | [Reliability Object](#reliability-object) | No | Reliability settings. |
| tags | [`string`] | No | Tags for grouping. |
| security | [[Security Requirement Object](#security-requirement-object)] | No | Security requirements. |

### Multicast Object

| Field Name | Type | Description |
|------------|------|-------------|
| enabled | `boolean` | Whether multicast is enabled. |
| group | `string` | Multicast group address. |
| ttl | `integer` | Time-to-live for packets. |

### Example

```yaml
x-usd:
  udp:
    contentTypes:
      default: application/octet-stream
    endpoints:
      metrics:
        description: StatsD-compatible metrics endpoint
        host: "0.0.0.0"
        port: 8125
        contentTypes:
          default: text/plain
        maxPacketSize: 1432
        messages:
          inbound:
            payload:
              type: string
              description: StatsD metric format
              example: "myapp.request.count:1|c"

      discovery:
        description: Service discovery via multicast
        host: "0.0.0.0"
        port: 5353
        multicast:
          enabled: true
          group: "224.0.0.251"
          ttl: 255
        messages:
          inbound:
            payload:
              $ref: "#/components/schemas/DiscoveryRequest"
          outbound:
            payload:
              $ref: "#/components/schemas/DiscoveryResponse"
```

---

## Errors Object

Defines unified error codes that work across all protocols.

### Error Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| status | `integer` | No | HTTP status code. |
| code | `integer` | No | JSON-RPC error code. |
| grpcCode | `integer` | No | gRPC status code. |
| message | `string` | **Yes** | Error message. |
| description | `string` | No | Detailed description. |
| data | Schema Object or Reference | No | Additional error data schema. |

### Cross-Protocol Error Mapping

USD provides automatic mapping between protocol error codes:

| HTTP Status | JSON-RPC Code | gRPC Code | Description |
|-------------|---------------|-----------|-------------|
| 400 | -32602 | 3 (INVALID_ARGUMENT) | Bad request |
| 401 | -32002 | 16 (UNAUTHENTICATED) | Not authenticated |
| 403 | -32003 | 7 (PERMISSION_DENIED) | Not authorized |
| 404 | -32001 | 5 (NOT_FOUND) | Not found |
| 409 | -32004 | 6 (ALREADY_EXISTS) | Conflict |
| 429 | -32005 | 8 (RESOURCE_EXHAUSTED) | Rate limited |
| 500 | -32603 | 13 (INTERNAL) | Internal error |
| 501 | -32601 | 12 (UNIMPLEMENTED) | Not implemented |
| 503 | -32000 | 14 (UNAVAILABLE) | Service unavailable |

### Example

```yaml
x-usd:
  errors:
    NotFound:
      status: 404
      code: -32001
      grpcCode: 5
      message: Resource not found
      description: The requested resource could not be found
      data:
        type: object
        properties:
          resource:
            type: string
          id:
            type: string

    RateLimited:
      status: 429
      code: -32005
      grpcCode: 8
      message: Rate limit exceeded
      description: Too many requests, please slow down
      data:
        type: object
        properties:
          retryAfter:
            type: integer
            description: Seconds to wait before retrying
```

---

## Documentation Object

The Documentation Object allows customizing the generated documentation UI, including a hero section (cover page) and introduction content.

### Fixed Fields

| Field Name | Type | Description |
|------------|------|-------------|
| hero | [Hero Object](#hero-object) | Hero section configuration (Docsify-style cover page). |
| introduction | `string` | Markdown content displayed after the hero, before API endpoints. |
| logo | `string` | Custom logo URL. |
| favicon | `string` | Custom favicon URL. |
| externalLinks | [[External Link Object](#external-link-object)] | External documentation links. |

### Hero Object

The hero section creates a Docsify-inspired cover page with branding, features, and call-to-action buttons.

| Field Name | Type | Description |
|------------|------|-------------|
| title | `string` | Override title (defaults to `info.title`). |
| version | `string` | Version badge (defaults to `info.version`). |
| tagline | `string` | Tagline/description below title. |
| features | [`string`] | Feature list with checkmark bullets. |
| background | `string` | Background style: `gradient`, `solid`, `pattern`, or `image`. |
| backgroundImage | `string` | Custom background image URL (for `image` background). |
| backgroundColor | `string` | Custom background color (for `solid` background). |
| buttons | [[Hero Button Object](#hero-button-object)] | Call-to-action buttons. |
| quickLinks | [[Quick Link Object](#quick-link-object)] | Quick links grid below buttons. |
| github | `string` | GitHub repository URL (shows corner octocat). |

### Hero Button Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| text | `string` | **Yes** | Button text. |
| href | `string` | No | Button link URL. |
| primary | `boolean` | No | Whether this is a primary (highlighted) button. |

### Quick Link Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| title | `string` | **Yes** | Link title. |
| href | `string` | **Yes** | Link URL. |
| description | `string` | No | Optional description. |
| icon | `string` | No | Optional icon (emoji or icon class). |

### External Link Object

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| title | `string` | **Yes** | Link title. |
| url | `string` | **Yes** | Link URL. |
| description | `string` | No | Optional description. |

### Example

```yaml
x-usd:
  documentation:
    logo: https://example.com/logo.svg
    favicon: https://example.com/favicon.ico
    hero:
      tagline: A powerful multi-protocol API
      features:
        - Bearer Token Authentication
        - Role-based Access Control
        - OpenMetrics & Tracing
        - GraphQL Support
      buttons:
        - text: Get Started
          href: "#docs"
          primary: true
        - text: GitHub
          href: https://github.com/example/repo
      github: https://github.com/example/repo
      background: gradient
    introduction: |
      # Welcome to the API

      This API provides a complete solution for managing users and resources.

      ## Features

      - **Authentication**: Secure Bearer token authentication
      - **Authorization**: Role-based access control (RBAC)
      - **Multi-Protocol**: HTTP REST, WebSocket, and GraphQL endpoints

      ## Quick Start

      To get started, obtain an API token and include it in your requests:

      \`\`\`bash
      curl -H "Authorization: Bearer YOUR_TOKEN" https://api.example.com/users
      \`\`\`
```

---

## Security

USD inherits OpenAPI's security scheme definitions and extends them for non-HTTP protocols.

### Security Scheme Object Extensions

Standard OpenAPI security schemes apply to HTTP. For other protocols, USD adds:

| Field Name | Type | Description |
|------------|------|-------------|
| x-usd-websocket | [WebSocket Security Object](#websocket-security-object) | WebSocket authentication. |
| x-usd-streams | [Streams Security Object](#streams-security-object) | SSE/streams authentication. |

### WebSocket Security Object

| Field Name | Type | Description |
|------------|------|-------------|
| in | `string` | Token location: `query`, `header`, or `cookie`. |
| name | `string` | Parameter/header/cookie name. |

### Streams Security Object

| Field Name | Type | Description |
|------------|------|-------------|
| in | [`string`] | Supported locations: `query`, `header`, `cookie`. |
| name | `string` | Parameter/header/cookie name. |
| description | `string` | How to use this auth with streams. |

### Example

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      x-usd-websocket:
        in: query
        name: token
      x-usd-streams:
        in:
          - query
          - header
        name: authorization
        description: |
          For EventSource (SSE), pass token as query parameter.
          For fetch streams, use Authorization header.

security:
  - bearerAuth: []
```

---

## Specification Extensions

While USD uses `x-usd` for its protocol extensions, the specification also allows additional vendor extensions.

### Rules

1. Extensions MUST begin with `x-` prefix.
2. Extensions MUST NOT conflict with USD reserved extensions (`x-usd-*`).
3. Extensions can appear at any level of the document.
4. Tools SHOULD preserve extensions they don't understand.

### USD Reserved Extensions

The following `x-usd-*` prefixes are reserved:

| Extension | Location | Description |
|-----------|----------|-------------|
| `x-usd-streaming` | HTTP Operation | Mark HTTP response as streaming |
| `x-usd-presence` | WebSocket Channel | Presence configuration |
| `x-usd-backpressure` | Stream Endpoint | Backpressure support |
| `x-usd-client-streaming` | gRPC Method | Client streaming |
| `x-usd-server-streaming` | gRPC Method | Server streaming |
| `x-usd-notification` | JSON-RPC Method | Notification (no response) |

---

## Tag Object

Adds metadata to tags for organization.

### Fixed Fields

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| name | `string` | **Yes** | Tag name. |
| description | `string` | No | Tag description. |
| externalDocs | External Documentation Object | No | Additional documentation. |
| x-displayName | `string` | No | Display name if different from `name`. |

---

## Tag Group Object

Groups tags for hierarchical organization (like Redoc's x-tagGroups).

### Fixed Fields

| Field Name | Type | Required | Description |
|------------|------|----------|-------------|
| name | `string` | **Yes** | Group name displayed in sidebar. |
| tags | [`string`] | **Yes** | Tags included in this group. |
| description | `string` | No | Group description. |
| expanded | `boolean` | No | Whether expanded by default. |

### Example

```yaml
tags:
  - name: users
    description: User management
  - name: products
    description: Product catalog
  - name: orders
    description: Order processing
  - name: websocket
    description: WebSocket channels
  - name: rpc
    description: JSON-RPC methods

x-tagGroups:
  - name: REST API
    tags:
      - users
      - products
      - orders
  - name: Real-time
    tags:
      - websocket
  - name: RPC
    tags:
      - rpc
```

---

## Message Object

Defines a message payload for non-HTTP protocols.

### Fixed Fields

| Field Name | Type | Description |
|------------|------|-------------|
| name | `string` | Message name. |
| title | `string` | Human-readable title. |
| summary | `string` | Short summary. |
| description | `string` | Detailed description. |
| contentType | `string` | Content type override. |
| payload | Schema Object or Reference | Message payload schema. |
| tags | [`string`] | Tags for grouping. |
| example | `any` | Example value. |
| examples | Map[`string`, Example Object] | Multiple examples. |

### Example

```yaml
# Inline message
subscribe:
  message:
    name: UserCreated
    summary: User creation event
    payload:
      type: object
      properties:
        type:
          type: string
          const: user.created
        data:
          $ref: "#/components/schemas/User"
    example:
      type: user.created
      data:
        id: "123"
        name: "Alice"

# Reference to reusable message
x-usd:
  messages:
    UserEvent:
      title: User Event
      payload:
        $ref: "#/components/schemas/UserEvent"

  websocket:
    channels:
      users:
        subscribe:
          message:
            $ref: "#/x-usd/messages/UserEvent"
```

---

## Appendix A: Revision History

| Version | Date | Notes |
|---------|------|-------|
| 1.0.0 | 2025-01-22 | Initial release |

---

## Appendix B: Complete Example

```yaml
usd: "1.0.0"
openapi: "3.1.0"
info:
  title: Complete Multi-Protocol API
  version: "1.0.0"
  description: |
    A complete example demonstrating all USD protocols.
  contact:
    name: API Support
    email: support@example.com
  license:
    name: MIT

servers:
  - url: https://api.example.com
    description: Production

tags:
  - name: users
    description: User management
  - name: realtime
    description: Real-time features
  - name: rpc
    description: RPC methods

x-tagGroups:
  - name: REST API
    tags: [users]
  - name: Real-time
    tags: [realtime]
  - name: RPC
    tags: [rpc]

paths:
  /users:
    get:
      operationId: listUsers
      summary: List users
      tags: [users]
      responses:
        "200":
          description: Success
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/User"
    post:
      operationId: createUser
      summary: Create user
      tags: [users]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateUser"
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/User"

x-usd:
  protocols:
    - http
    - websocket
    - streams
    - jsonrpc

  servers:
    - url: wss://ws.example.com
      protocol: websocket

  contentTypes:
    default: application/json
    supported:
      - application/json
      - text/csv

  websocket:
    path: /ws
    channels:
      user:{userId}:
        type: private
        tags: [realtime]
        parameters:
          userId:
            required: true
            schema:
              type: string
        subscribe:
          message:
            payload:
              $ref: "#/components/schemas/UserEvent"

  streams:
    endpoints:
      events:
        direction: server-to-client
        tags: [realtime]
        message:
          payload:
            $ref: "#/components/schemas/ServerEvent"

  jsonrpc:
    endpoint: /rpc
    version: "2.0"
    methods:
      users.get:
        tags: [rpc]
        params:
          type: object
          properties:
            id:
              type: string
        result:
          $ref: "#/components/schemas/User"

  errors:
    NotFound:
      status: 404
      code: -32001
      message: Not found
    Unauthorized:
      status: 401
      code: -32002
      message: Unauthorized

components:
  schemas:
    User:
      type: object
      required: [id, name]
      properties:
        id:
          type: string
        name:
          type: string
        email:
          type: string
          format: email

    CreateUser:
      type: object
      required: [name]
      properties:
        name:
          type: string
        email:
          type: string
          format: email

    UserEvent:
      type: object
      properties:
        type:
          type: string
          enum: [created, updated, deleted]
        user:
          $ref: "#/components/schemas/User"

    ServerEvent:
      type: object
      properties:
        id:
          type: string
        type:
          type: string
        data:
          type: object

  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      x-usd-websocket:
        in: query
        name: token

security:
  - bearerAuth: []
```

---

*USD Specification v1.0.0*
*Copyright 2025 Tetis.io. All rights reserved.*
