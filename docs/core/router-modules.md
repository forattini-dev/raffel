# Router Modules

Router modules let you group routes into reusable bundles and mount them with
prefixes on any server.

## Create a module

```ts
import { createRouterModule } from 'raffel'

const users = createRouterModule('users')
users.procedure('create').handler(async () => ({ id: '1' }))
```

## Mount a module

```ts
import { createServer } from 'raffel'

const server = createServer({ port: 3000 })
server.mount('api', users)
// Registers: api.users.create
```

## Mount interceptors

```ts
server.mount('api', users, {
  interceptors: [auditInterceptor],
})
```

## Grouping

Use `group` for shared prefixes and interceptors.

```ts
const admin = server.group('admin')
admin.use(authInterceptor)

admin.procedure('users.list').handler(async () => [])
admin.event('audit.write').delivery('at-least-once').handler(async () => {})
```

## Interceptor order

Global -> Mount -> Module -> Handler
