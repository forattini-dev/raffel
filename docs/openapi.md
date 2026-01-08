# OpenAPI

Generate OpenAPI schemas from the registry and handler schemas.

```ts
import { generateOpenAPI } from 'raffel'

const document = generateOpenAPI(server.registry, schemaRegistry, {
  info: { title: 'Raffel API', version: '1.0.0' },
})
```

Use `basePath`, `streamPath`, and `eventPath` to align with your HTTP routing.

If you build the server with the core primitives, pass the same `SchemaRegistry`
you register your handlers with. When using `createServer`, keep a reference to
your schemas if you want to generate OpenAPI later.

## Options

```ts
generateOpenAPI(server.registry, schemaRegistry, {
  info: { title: 'Raffel API', version: '1.0.0' },
  basePath: '/',
  streamPath: '/streams',
  eventPath: '/events',
  groupByNamespace: true,
  includeExamples: false,
})
```
