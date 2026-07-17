# Testing

Raffel is protocol-agnostic, so your tests can be too. A procedure is just a
handler function plus a schema and a context — you can test it in isolation, or
you can start a real server and drive it over HTTP. This guide covers the full
range: unit tests for procedures, streams, and events; integration tests against
a running server; contract tests derived from your OpenAPI/USD document; and the
mocking and hygiene patterns that keep all of it fast and deterministic.

The examples use Node's built-in test runner (`node:test`) with
`assert/strict`, which is how the framework tests itself. Nothing here is
runner-specific — the same patterns work with Vitest or Jest.

```bash
node --test
# or, for TypeScript sources
node --test --import tsx
```

---

## The Testing Pyramid In Raffel

| Level | What you exercise | Speed | Tool |
|-------|-------------------|-------|------|
| Unit | A single handler with a mocked `ctx` | Fastest | `createContext` |
| Integration | A real `createServer()` over the router or HTTP | Fast | `createServer`, `server.router.handle`, `fetch` |
| Contract | The documented surface (OpenAPI/USD) against a mock | Medium | `createMockServer`, `raffel contract-tests` |

Prefer unit tests for business logic, integration tests for wiring
(interceptors, validation, providers, protocol adapters), and contract tests to
keep your documentation and clients honest.

---

## Unit Testing Procedures

A procedure handler is an `async (input, ctx) => output` function. The cleanest
unit test extracts the handler and calls it directly with a mocked context.

The recommended way to build a context is `createContext(requestId, seed)`,
exported from `raffel`. It gives you a fully-formed `ctx` with sensible defaults
and lets you seed only the parts your handler reads (`auth`, `services`,
`input`, `signal`).

```ts
// user-service.ts — handler written so it is trivially testable
import { Errors, type Context } from 'raffel'

export interface UserService {
  findById(id: string): Promise<{ id: string; name: string } | null>
}

export const getUser = async (
  input: { id: string },
  ctx: Context,
) => {
  const services = ctx.services as { users: UserService }
  const user = await services.users.findById(input.id)
  if (!user) throw Errors.notFound('User', input.id)
  return user
}
```

```ts
// user-service.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createContext } from 'raffel'
import { getUser, type UserService } from './user-service.js'

describe('getUser', () => {
  it('returns the user when found', async () => {
    const users: UserService = {
      async findById(id) {
        return { id, name: 'Ada' }
      },
    }

    const ctx = createContext('test-request-1', { services: { users } })
    const result = await getUser({ id: 'usr_1' }, ctx)

    assert.deepEqual(result, { id: 'usr_1', name: 'Ada' })
  })

  it('throws NOT_FOUND when the user is missing', async () => {
    const users: UserService = {
      async findById() {
        return null
      },
    }

    const ctx = createContext('test-request-2', { services: { users } })

    await assert.rejects(
      () => getUser({ id: 'missing' }, ctx),
      (err: unknown) => (err as { code?: string }).code === 'NOT_FOUND',
    )
  })
})
```

Because the schema validation, interceptors, and protocol adapters live outside
the handler, a unit test like this runs in microseconds and never touches a
socket. Test *those* layers at the integration level (below), not here.

### Seeding the context

`createContext(requestId, seed)` accepts a partial seed. The fields you will
reach for most in tests:

| Seed field | Populates | Use for |
|------------|-----------|---------|
| `services` | `ctx.services` | Injected dependencies / providers |
| `auth` | `ctx.auth` | Principal, roles, scopes |
| `input` | `ctx.input` (`body`, `params`, `query`, `metadata`) | Normalized request input |
| `signal` | `ctx.signal` | Cancellation |
| `deadline` | `ctx.deadline` | Timeout logic |

---

## Unit Testing Streams

A server stream handler is an async generator. Test it by iterating the
generator and collecting the yielded values. Use an `AbortController` to prove
that cancellation is honored.

```ts
// counter.ts
import { type Context } from 'raffel'

export async function* countUpTo(
  input: { limit: number },
  ctx: Context,
) {
  for (let i = 0; i < input.limit; i++) {
    if (ctx.signal?.aborted) return
    yield { value: i }
  }
}
```

```ts
// counter.test.ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createContext } from 'raffel'
import { countUpTo } from './counter.js'

describe('countUpTo', () => {
  it('yields each value up to the limit', async () => {
    const ctx = createContext('stream-test-1')

    const chunks: Array<{ value: number }> = []
    for await (const chunk of countUpTo({ limit: 3 }, ctx)) {
      chunks.push(chunk)
    }

    assert.deepEqual(chunks, [{ value: 0 }, { value: 1 }, { value: 2 }])
  })

  it('stops early when the signal is aborted', async () => {
    const controller = new AbortController()
    const ctx = createContext('stream-test-2', { signal: controller.signal })

    const chunks: Array<{ value: number }> = []
    for await (const chunk of countUpTo({ limit: 100 }, ctx)) {
      chunks.push(chunk)
      if (chunks.length === 2) controller.abort()
    }

    // The next iteration observes the abort and returns.
    assert.equal(chunks.length, 2)
  })
})
```

For **client** and **bidi** streams, the handler receives an async iterable of
inputs. Feed it a plain async generator in the test:

```ts
async function* inputs() {
  yield { chunk: 'a' }
  yield { chunk: 'b' }
}

const result = await uploadHandler(inputs(), createContext('upload-test'))
assert.equal(result.count, 2)
```

---

## Unit Testing Events

An event handler is `async (payload, ctx, ack) => void`. There is no response to
assert on — instead assert on side effects and on whether `ack()` was called.
Use `node:test`'s `mock.fn()` for the `ack` and for any injected dependency.

```ts
// welcome.ts
import { type Context } from 'raffel'

export const sendWelcome = async (
  payload: { userId: string },
  ctx: Context,
  ack: () => void,
) => {
  const services = ctx.services as {
    mailer: { send(userId: string): Promise<void> }
  }
  await services.mailer.send(payload.userId)
  ack()
}
```

```ts
// welcome.test.ts
import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createContext } from 'raffel'
import { sendWelcome } from './welcome.js'

describe('sendWelcome', () => {
  it('sends the email and acknowledges', async () => {
    const send = mock.fn(async (_userId: string) => {})
    const ack = mock.fn()

    const ctx = createContext('event-test-1', {
      services: { mailer: { send } },
    })

    await sendWelcome({ userId: 'usr_1' }, ctx, ack)

    assert.equal(send.mock.callCount(), 1)
    assert.deepEqual(send.mock.calls[0].arguments, ['usr_1'])
    assert.equal(ack.mock.callCount(), 1)
  })

  it('does not ack when delivery fails', async () => {
    const send = mock.fn(async () => {
      throw new Error('smtp down')
    })
    const ack = mock.fn()

    const ctx = createContext('event-test-2', {
      services: { mailer: { send } },
    })

    await assert.rejects(() => sendWelcome({ userId: 'usr_1' }, ctx, ack))
    assert.equal(ack.mock.callCount(), 0)
  })
})
```

The `ack`-was-not-called assertion is the important one: for `at-least-once`
delivery, not acking is what triggers a retry (see
[Events](/core/events.md#acknowledgment-ack)).

---

## Integration Testing

Integration tests wire a real `createServer()` and exercise the full path:
schema validation, interceptors, providers, and — optionally — a protocol
adapter. There are two levels.

### Through the router (protocol-agnostic)

The router is the core dispatcher every protocol funnels into. Driving it
directly gives you a fast integration test that still runs validation,
interceptors, and providers, without binding a socket. Build a request envelope
with `createContext` and call `server.router.handle(...)`.

```ts
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  createServer,
  createContext,
  registerValidator,
  createZodAdapter,
  type Envelope,
} from 'raffel'
import { z } from 'zod'

registerValidator(createZodAdapter(z))

function request(procedure: string, payload: unknown): Envelope {
  return {
    id: 'test-envelope',
    procedure,
    type: 'request',
    payload,
    metadata: {},
    context: createContext('test-request'),
  }
}

describe('users.create (router)', () => {
  const server = createServer({ port: 0 })
    .provide('users', () => ({
      create: (input: { name: string }) => ({ id: 'usr_1', ...input }),
    }))

  server
    .procedure('users.create')
    .input(z.object({ name: z.string().min(2) }))
    .handler(async (input, ctx) => {
      const services = ctx.services as {
        users: { create(i: { name: string }): { id: string; name: string } }
      }
      return services.users.create(input)
    })

  before(() => server.start())
  after(() => server.stop())

  it('creates a user', async () => {
    const result = (await server.router.handle(
      request('users.create', { name: 'Ada' }),
    )) as Envelope

    assert.equal(result.type, 'response')
    assert.deepEqual(result.payload, { id: 'usr_1', name: 'Ada' })
  })

  it('rejects invalid input', async () => {
    const result = (await server.router.handle(
      request('users.create', { name: 'x' }),
    )) as Envelope

    assert.equal(result.type, 'error')
    assert.equal((result.payload as { code: string }).code, 'VALIDATION_ERROR')
  })
})
```

Note the port `0` — the OS assigns a free port, which avoids collisions when
suites run in parallel.

### Over HTTP (end-to-end)

To verify the HTTP adapter itself — status codes, headers, the error envelope —
start the server on a real port and use `fetch`. A procedure is reachable at
`POST /<procedure-name>`.

```ts
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'raffel'
import { z } from 'zod'

describe('ping over HTTP', () => {
  let baseUrl: string
  const server = createServer({ port: 0 })

  server
    .procedure('ping')
    .output(z.object({ pong: z.boolean() }))
    .handler(async () => ({ pong: true }))

  before(async () => {
    await server.start()
    // addresses is populated after start()
    baseUrl = `http://127.0.0.1:${server.addresses?.http.port}`
  })
  after(() => server.stop())

  it('responds to POST /ping', async () => {
    const res = await fetch(`${baseUrl}/ping`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })

    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { pong: true })
  })
})
```

Events are reachable at `POST /events/<name>` (returns `202`) and server streams
at `GET /streams/<name>` as SSE — see [Streams](/core/streams.md#http-sse-streaming)
and [Events](/core/events.md#protocol-mapping) for the wire formats.

---

## Contract Testing

Contract testing verifies that the surface you *document* matches what clients
depend on. Raffel gives you one source of truth — the runtime graph — and two
complementary tools built on top of it.

### `raffel contract-tests`

The CLI derives a contract-test suite directly from your server's runtime
metadata: schemas, policies, and transport bindings. It produces authorized,
unauthorized, invalid-input, and cross-transport checks so you can catch a
surface that drifts out of alignment across protocols.

```bash
# Human-readable report
raffel contract-tests src/server.ts

# Machine-readable suite for CI or a custom runner
raffel contract-tests src/server.ts --json
```

Wire it into CI as a gate alongside the rest of the DX loop:

```bash
raffel inspect src/server.ts
raffel doctor src/server.ts --fail-on warning
raffel contract-tests src/server.ts
```

### Mocking the documented surface

The second half of contract testing is asserting that the *documented*
responses are still shaped the way clients expect. Generate the OpenAPI/USD
document from your real server, feed it into `createMockServer`, and test
against the mock — if the mock diverges from your live server, your docs (or
your handlers) drifted.

```ts
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createMockServer } from 'raffel'
import server from './server.js'

describe('users contract', () => {
  let mock: Awaited<ReturnType<typeof createMockServer>>['server']
  let baseUrl: string

  before(async () => {
    server.enableUSD({ info: { title: 'Users API', version: '1.0.0' } })
    const openapi = server.getOpenAPIDocument()
    if (!openapi) throw new Error('OpenAPI document is not available')

    const started = await createMockServer({ spec: openapi, port: 0 })
    mock = started.server
    baseUrl = `http://127.0.0.1:${mock.addresses?.http.port}`
  })

  after(() => mock.stop())

  it('GET /users/:id matches the documented shape', async () => {
    const res = await fetch(`${baseUrl}/users/usr_1`)
    assert.equal(res.status, 200)

    const body = (await res.json()) as Record<string, unknown>
    assert.ok('id' in body)
  })

  it('rejects an invalid request body', async () => {
    const res = await fetch(`${baseUrl}/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}), // missing required fields
    })

    assert.equal(res.status, 400)
    const body = (await res.json()) as { error: { code: string } }
    assert.equal(body.error.code, 'VALIDATION_ERROR')
  })
})
```

The mock server validates request bodies against the spec by default and returns
Raffel's standard error envelope. Full option reference — including
`createMockModule` for mounting mocks into an existing server, USD multi-protocol
mocks, and the `raffel mock` CLI — is in
[Mock Server](/tooling/mock-server.md).

---

## Mocks And Fixtures

### Mocking `ctx.services` / providers

Providers registered with `.provide()` are surfaced on `ctx.services`. In unit
tests, skip the provider machinery and seed `ctx.services` directly through
`createContext`:

```ts
const ctx = createContext('test', {
  services: {
    users: { findById: async () => ({ id: 'usr_1', name: 'Ada' }) },
    clock: { now: () => new Date('2026-01-01T00:00:00Z') },
  },
})
```

In integration tests, register test doubles with `.provide()` so the real
resolution path runs:

```ts
const server = createServer({ port: 0 })
  .provide('users', () => new InMemoryUserRepo())
```

### Mocking `ctx.auth`

Seed the auth context to test authorization branches without real tokens or an
auth middleware. `ctx.auth.require(...)` throws when the requirement is not met,
so you can assert on both the allowed and denied paths.

```ts
// Authenticated principal with a scope
const authed = createContext('t1', {
  auth: {
    authenticated: true,
    principalId: 'usr_1',
    roles: ['admin'],
    scopes: ['users:write'],
  },
})

// Anonymous — auth.require({ authenticated: true }) will throw
const anon = createContext('t2', { auth: { authenticated: false } })
```

### Fixtures

Keep fixtures as plain factory functions with overrides so each test states only
what it cares about:

```ts
export function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'usr_1', name: 'Ada', email: 'ada@example.com', ...overrides }
}
```

Prefer a factory over a shared mutable constant — a shared object that one test
mutates will silently corrupt another.

---

## Best Practices

**Isolate tests.** Give each test its own `createContext` and its own server
instance (or a fresh `.provide()` double). Never share a started server whose
state one test mutates and another reads.

**Always clean up.** Every `server.start()` needs a matching `server.stop()` in
`after`/`afterEach`, and every `createMockServer` result needs `mock.stop()`. A
leaked listener holds a port and hangs the runner.

```ts
after(() => server.stop())
```

**Use port `0`.** Let the OS assign a free port and read it back from
`server.addresses?.http.port`. Hard-coded ports collide the moment two suites
run in parallel.

**Keep tests deterministic.**
- Inject the clock and randomness (`services.clock`, a seeded id generator)
  instead of calling `Date.now()` or `Math.random()` inside handlers.
- Drive cancellation with an explicit `AbortController`, not a wall-clock
  `setTimeout` race.
- Assert on `ack` call counts and structured results, not on log output.

**Match the level to the concern.** Business logic → unit test the handler.
Validation, interceptors, provider wiring, protocol behavior → integration test.
Documented surface and cross-protocol alignment → contract test. Don't spin up a
socket to test a pure function.

**Register a validator once.** Schema-based tests need a validator adapter
installed. Call `registerValidator(createZodAdapter(z))` in a shared setup file
so `.input()` / `.output()` are enforced during tests.

---

## Next Steps

- **[Procedures](/core/procedures.md)** — handler and context reference
- **[Streams](/core/streams.md)** — stream directions and wire formats
- **[Events](/core/events.md)** — delivery guarantees and `ack`
- **[Mock Server](/tooling/mock-server.md)** — full mock and `raffel mock` reference
- **[Providers (DI)](/tooling/providers.md)** — how `ctx.services` is populated
</content>
</invoke>
