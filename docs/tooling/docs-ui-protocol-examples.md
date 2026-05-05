# Docs UI Protocol Examples

The docs UI renders generated reference from USD protocol sections and renders Markdown guides from `docsDir`. Use this page as a checklist for services that expose more than HTTP.

## HTTP

HTTP operations come from OpenAPI-compatible `paths`. They appear under the HTTP protocol tab and can be mixed with Markdown guides in the same UI.

```ts
server.enableUSD({
  basePath: '/docs',
  info: { title: 'Tasks API', version: '1.0.0' },
  docsDir: true,
  paths: {
    '/tasks': {
      get: {
        summary: 'List tasks',
        description: 'Returns visible tasks for the current account.',
        responses: { '200': { description: 'Task list' } },
      },
    },
  },
})
```

## WebSocket Channels

WebSocket channel documentation belongs in `x-usd.websocket.channels`. The docs UI creates a WebSocket protocol tab when channels exist.

```ts
server.enableUSD({
  info: { title: 'Realtime Tasks', version: '1.0.0' },
  websocket: {
    path: '/ws',
    channels: {
      'tasks.updated': {
        summary: 'Task updates',
        description: 'Emits when a task changes.',
        type: 'private',
        publish: {
          message: {
            payload: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                status: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
})
```

## Streams

Streams are long-running server output. They appear under the streams protocol tab and should include event names or payload shape where possible.

```ts
server.enableUSD({
  info: { title: 'Events API', version: '1.0.0' },
  streams: {
    endpoints: {
      events: {
        summary: 'Event stream',
        description: 'Server-sent events for account activity.',
        direction: 'server',
        events: ['task.created', 'task.completed'],
      },
    },
  },
})
```

## JSON-RPC

JSON-RPC methods are documented from `x-usd.jsonrpc.methods`.

```ts
server.enableUSD({
  info: { title: 'RPC Tasks', version: '1.0.0' },
  jsonrpc: {
    endpoint: '/rpc',
    methods: {
      'tasks.list': {
        summary: 'List tasks',
        params: {
          type: 'object',
          properties: {
            limit: { type: 'integer', default: 20 },
          },
        },
        result: {
          type: 'array',
          items: { type: 'object' },
        },
      },
    },
  },
})
```

## gRPC

gRPC reference comes from `x-usd.grpc.services`. Method streaming flags are rendered as the method type.

```ts
server.enableUSD({
  info: { title: 'Task gRPC', version: '1.0.0' },
  grpc: {
    services: {
      TaskService: {
        description: 'Task service RPCs.',
        methods: {
          ListTasks: {
            summary: 'List tasks',
            request: { type: 'object' },
            response: { type: 'object' },
          },
          WatchTasks: {
            summary: 'Watch task changes',
            'x-usd-server-streaming': true,
            request: { type: 'object' },
            response: { type: 'object' },
          },
        },
      },
    },
  },
})
```

## TCP And UDP

TCP and UDP sections document lower-level ports and message semantics. They render as separate protocol tabs when present.

```ts
server.enableUSD({
  info: { title: 'Telemetry', version: '1.0.0' },
  tcp: {
    servers: {
      telemetry: {
        summary: 'Telemetry TCP socket',
        description: 'Line-delimited telemetry ingestion.',
        port: 9000,
        framing: 'newline-delimited-json',
      },
    },
  },
  udp: {
    endpoints: {
      metrics: {
        summary: 'Metrics datagrams',
        description: 'Fire-and-forget metric packets.',
        port: 9001,
      },
    },
  },
})
```

## Pair Generated Reference With Markdown

Use generated protocol reference for contract truth and Markdown for explanations:

```text
docs/
|-- README.md
|-- _sidebar.md
|-- guides/
|   |-- channels.md
|   |-- streams.md
|   `-- telemetry.md
`-- images/
    `-- realtime-flow.svg
```

`docs/guides/channels.md` can explain auth and workflows, while `x-usd.websocket.channels` remains the source of channel names, payload schemas, and protocol metadata. WebSocket, streams, and JSON-RPC references include browser-safe live consoles. gRPC, TCP, and UDP references include starter command panels because browsers do not expose native clients for those transports.
