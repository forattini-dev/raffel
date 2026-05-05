export const PROXY_GUIDE = `# Reverse Proxy Guide

Raffel ships a proxy toolkit, where the reverse proxy is the HTTP/HTTPS edge and all proxy engines can share policy, filtering, telemetry, and middleware conventions.

Current modules:

- \`createReverseProxy\` (edge ingress for HTTP/HTTPS, CONNECT, WebSocket)
- \`createExplicitProxy\` (HTTP forward + CONNECT tunnel + upgrade forwarding)
- \`createSocks5Proxy\` (SOCKS5 with \`CONNECT\`, \`BIND\`, and \`UDP ASSOCIATE\`)
- \`createTransparentProxy\` (kernel-transparent TCP mode)
- \`createProxySuite\` (explicit + socks5 with shared collector)
- Service-mesh oriented observability via unified graph and shared collectors.
- Unified proxy middleware for policy engines, request shaping, and destination rewrites.

## 1) Protocol matrix by mode

| Capability | Reverse | Explicit | SOCKS5 | Transparent | Suite |
|:----------|:------:|:------:|:------:|:----------:|:-----:|
| HTTP/HTTPS ingress | ✅ | ✅ | ❌ | ❌ | ✅ |
| CONNECT tunneling | ✅ | ✅ | ❌ | ❌ | ✅ |
| WebSocket (\`upgrade\`) | ✅ | ✅ | ❌ | ❌ | ✅ |
| SOCKS5h (hostname mode) | ❌ | ❌ | ✅ (socks5h) | ❌ | ✅ |
| SOCKS5 UDP | ❌ | ❌ | ✅ (socks5-udp, socks5h-udp) | ❌ | ✅ |
| TCP transparent | ❌ | ❌ | ❌ | ✅ | ❌ |

Notes:
- HTTP/HTTPS for reverse proxy is controlled by \`server.tls\` (see section 9).
- Reverse routing only accepts upstream targets with \`http:\`/HTTPS schemes.
- Transparent proxy is TCP-only.

## 2) Reverse proxy (createReverseProxy)

Use this for edge routing by host/path/method and Traefik-like local simulations.

Supports both:

- **File-driven config** (\`.json\` / \`.yaml\`) via \`loadReverseProxyConfig\`.
- **Programmatic config** via \`parseReverseProxyConfig\`.

Both modes produce the same runtime behavior and let you route by host/path/method and rewrites.

\`\`\`ts
import { createReverseProxy, loadReverseProxyConfig, parseReverseProxyConfig } from 'raffel'

const reverseFromFile = await loadReverseProxyConfig('./infra/reverse-proxy.yaml')
const reverseFromCode = parseReverseProxyConfig({
  server: { host: '0.0.0.0', port: 3443 },
  routes: [{ match: { host: 'api.internal.local', pathPrefix: '/v1' }, target: 'http://127.0.0.1:4100' }],
})

await (await createReverseProxy(reverseFromFile)).start()
await (await createReverseProxy(reverseFromCode)).start()
\`\`\`

## 3) Explicit proxy (createExplicitProxy)

\`createExplicitProxy\` is useful when you need classic HTTP proxy client support:

- absolute-form HTTP proxy requests
- CONNECT tunneling
- protocol upgrades (WebSocket)

\`\`\`ts
import { createExplicitProxy } from 'raffel'

const explicit = createExplicitProxy({
  host: '127.0.0.1',
  port: 3128,
  forward: {
    maxBodySize: 4 * 1024 * 1024,
  },
  tunnel: {
    mode: 'forward',
  },
  telemetry: { sourceHeader: 'x-service-name' },
})

await explicit.start()
\`\`\`

## 4) SOCKS5 proxy (createSocks5Proxy)

Use this for SOCKS5 and SOCKS5h clients, including UDP-associate flows.

\`\`\`ts
import { createSocks5Proxy } from 'raffel'

const socks5 = createSocks5Proxy({
  host: '127.0.0.1',
  port: 1080,
  onConnect: (info) => {
    console.log('SOCKS5 connected', info)
  },
})

await socks5.start()
\`\`\`

## 5) Transparent proxy (createTransparentProxy)

For Linux environments where you want original destination interception:

\`\`\`ts
import { createTransparentProxy } from 'raffel'

const transparent = createTransparentProxy({
  host: '0.0.0.0',
  port: 15001,
  mode: 'tproxy',
})

await transparent.start()
\`\`\`

## 6) Route matching by host, path, and method

Reverse routing is selected in declaration order and stops at the first match.

Routes are matched in order and stop at the first hit.

### Host matching

- \`match.host\` supports a string or array.
- wildcard suffix is supported (for example \`*.internal.local\`).

### Path matching

- \`match.path\`: exact match after normalization.
- \`match.pathPrefix\`: prefix match.
- \`match.path\` supports \`*\` wildcards.

### Method matching

- \`match.methods\` accepts single method or array (\`GET\`, \`POST\`, etc.).
- omitted methods match all.

### Prefix rewrite

- default: \`stripPrefix\` follows \`match.pathPrefix\`.
- explicit \`stripPrefix: false\` disables rewrite.
- explicit string sets exact prefix to remove.

## 7) Examples for common Traefik-like patterns

### Different subdomains, same path

\`\`\`json
[
  {
    "match": { "host": "api.internal.local", "path": "/users" },
    "target": "http://127.0.0.1:4200"
  },
  {
    "match": { "host": "admin.internal.local", "path": "/users" },
    "target": "http://127.0.0.1:4210"
  }
]
\`\`\`

### Same subdomain, different paths

\`\`\`json
[
  {
    "match": { "host": "app.internal.local", "pathPrefix": "/api" },
    "target": "http://127.0.0.1:4300"
  },
  {
    "match": { "host": "app.internal.local", "path": "/health" },
    "target": "http://127.0.0.1:4301",
    "stripPrefix": false
  }
]
\`\`\`

## 8) No-match behavior

Customize missing-route responses with \`noMatch\`.

\`\`\`json
{
  "noMatch": {
    "status": 404,
    "body": "No route matched"
  }
}
\`\`\`

\`{route}\` in body is replaced with the route reason (\`request\`, \`connect\`, etc.).

## 9) MITM, capture and replay (Explicit CONNECT proxy)

\`createExplicitProxy\` exposes a CONNECT tunnel (\`createConnectTunnel\`) with two modes:

- \`forward\` (raw TLS forwarding)
- \`mitm\` (local TLS termination + request intercept)

In \`mitm\` mode you can use:

- \`onRequest\`/\`onResponse\` hooks for inspection/mutation
- \`validate\` for JSON payload validation
- \`mitmCapture\` for persistence/replay workflows

\`\`\`ts
import { createExplicitProxy } from 'raffel'

const explicit = createExplicitProxy({
  port: 3128,
  tunnel: {
    mode: 'mitm',
    mitmCapture: {
      enabled: true,
      mode: 'capture-only',
      file: './capture/requests.ndjson',
    },
  },
})

await explicit.start()
await explicit.tunnel.startCapture({
  file: './capture/requests.ndjson',
  mode: 'passthrough',
})
await explicit.tunnel.replayCapture({
  file: './capture/requests.ndjson',
  timeoutMs: 15_000,
})
const captureState = explicit.tunnel.getCaptureState()
\`\`\`

About local HTTPS and trust:

- createExplicitProxy generates the proxy MITM CA (\`caCert\`) automatically in tunnel mode.
- For development, clients can use \`rejectUnauthorized: false\` temporarily.
- For production, use trusted certificates at the reverse-proxy ingress and explicit trust stores.

## 10) HTTPS and automatic TLS (Reverse proxy)

\`server.tls\` controls HTTPS:

- omit \`server.tls\` for HTTP
- \`server.tls: false\` to force HTTP explicitly
- \`server.tls\` object to enable HTTPS
- \`server.tls.cert\` / \`server.tls.key\` for inline certs
- \`server.tls.certFile\` / \`server.tls.keyFile\` for file-based certs
- \`server.tls: {}\` to auto-generate cert/key at startup

This is the default local-friendly option for HTTPS tests and multi-subdomain simulations.

\`\`\`ts
import { createReverseProxy } from 'raffel'

const reverse = await createReverseProxy({
  server: {
    host: '127.0.0.1',
    port: 3443,
    tls: {}, // auto-generate cert and key for local bootstrap
  },
  routes: [
    {
      match: { host: 'auto.internal.test', pathPrefix: '/' },
      target: 'http://127.0.0.1:4100',
    },
  ],
})

await reverse.start()
\`\`\`

For production, keep stable certificates in files (cert/key, or CA-chain + files) and never
rely on auto-generated certs for long-running public endpoints.

\`\`\`ts
server: {
  tls: {
    certFile: './certs/api.internal.test/fullchain.pem',
    keyFile: './certs/api.internal.test/privkey.pem',
    rejectUnauthorized: true,
  }
}
\`\`\`

## 11) Unified proxy middleware

All proxy runtimes can opt into a shared middleware surface:

- \`http-request\` / \`http-response\`
- \`mitm-request\` / \`mitm-response\`
- \`upgrade-request\`
- \`connect\`
- \`socks5-connect\`, \`socks5-bind\`, \`socks5-udp-associate\`
- \`transparent\`

The same middleware chain can:

- inspect source, destination, headers, and protocol phase
- block traffic with a standard \`ctx.blocked\` payload
- rewrite \`ctx.target.host\` / \`ctx.target.port\`
- mutate HTTP/MITM request and response objects

\`\`\`ts
import { createExplicitProxy } from 'raffel'

const explicit = createExplicitProxy({
  port: 3128,
  middleware: [
    async (ctx, next) => {
      if (ctx.kind === 'http-request') {
        ctx.request.headers['x-edge'] = 'mesh-a'
      }

      if (ctx.kind === 'connect' && ctx.target.host.endsWith('.blocked.internal')) {
        ctx.blocked = { statusCode: 403, reason: 'blocked by policy' }
        return
      }

      if (ctx.kind === 'mitm-response' && ctx.response) {
        ctx.response.headers['x-inspected-by'] = 'raffel'
      }

      await next()
    },
  ],
  tunnel: { mode: 'mitm' },
})
\`\`\`

Operational note:

- Middleware is opt-in, just like telemetry.
- Without a configured middleware array, proxy runtimes keep the simpler fast-path behavior.
- Reverse/explicit/MITM support full request-response shaping.
- SOCKS5 and transparent proxy middleware work at connection level (policy + target rewrite).

## 12) Shared proxy options and rollout

\`proxy\` options unify policy and observability for \`createReverseProxy\` and \`createExplicitProxy\`:

- \`auth\` (shared Basic auth model)
- \`filter\` (host/TLD/method-based access rules)
- \`middleware\` (policy, block, rewrite, request/response shaping)
- \`forward\` (HTTP request forwarding tuning)
- \`tunnel\` (CONNECT mode and CA handling)
- \`upgrade\` (WebSocket handshake handling)
- \`telemetry\` (metrics + graph + node labels)

Example:

\`\`\`json
{
  "proxy": {
    "auth": {
      "credentials": {
        "username": "admin",
        "password": "secret"
      }
    },
    "filter": {
      "allowHosts": ["api.internal.local"],
      "denyTLDs": ["ru"]
    },
    "telemetry": {
      "sourceHeader": "x-service-name",
      "graphEndpoint": "/proxy/graph",
      "metricsEndpoint": "/metrics"
    }
  }
}
\`\`\`

## 13) Rollout checklist

- Start local with one route and explicit \`host\` and \`path\`.
- Add TLS (\`server.tls\`) only after route match order is validated.
- Keep \`noMatch\` explicit to avoid leaking upstream errors.
- Start with CONNECT and WebSocket checks before adding TLS passthrough flows.
- Move to method-level splits once path-only routing is stable.
- Add observability endpoints last, after protocol-level ownership is defined.
- Run canary comparing old/new edge behavior before full cutover.
- Validate SOCKS5 and UDP flows in an isolated test harness when enabled.

## 14) Service mesh and flow observability

For service-mesh style visibility, pair explicit and SOCKS5 proxies with shared collectors and graph snapshots:

- \`createTransparentProxy\` for kernel-level TCP interception (where supported)
- \`createProxySuite\` for explicit+SOCKS5 unified telemetry
- \`graphSnapshot()\` for topology and edge labels (\`source\`, \`destination\`, \`protocol\`)

Protocol labels include \`http\`, \`https\`, \`connect\`, \`ws\`, \`wss\`, \`socks5\`, \`socks5h\`, \`socks5-udp\`, \`socks5h-udp\`, and \`tcp\`.

## 15) Next docs

- [Configuração por Arquivo](/proxy/config-file.md)
- [Configuração Programática](/proxy/config-code.md)
- [Roteamento](/proxy/routing.md)
- [TLS/HTTPS](/proxy/tls.md)
- [Webhook Edge](/guides/webhook-edge.md)
- [Arquitetura](/proxy/architecture.md)
- [Modos de Proxy](/proxy/modes.md)
- [Service Mesh](/proxy/service-mesh.md)
- [Métricas e Grafo](/proxy/flow-metrics.md)
- [Operação e Integração](/proxy/operations.md)
- [Troubleshooting](/proxy/troubleshooting.md)
- [Migração de Traefik](/migration/traefik-replacement.md)
`

export const WEBHOOK_EDGE_GUIDE = `# Webhook Edge Guide

Use Raffel's reverse proxy to expose a public webhook endpoint with TLS termination and layered verification before forwarding to a local service.

Reference example: \`examples/11-webhook-proxy.ts\`

## What the example covers

- local Raffel service for \`/health\` and \`/webhook\`
- public reverse proxy edge with configurable host, port, path, and methods
- TLS termination on the edge
- optional shared-token verification
- optional HMAC signature verification
- optional anti-replay nonce checks

## Flow

\`\`\`text
Internet -> Raffel reverse proxy edge -> local Raffel service
\`\`\`

## Key environment groups

- local service: \`WEBHOOK_INTERNAL_*\`
- public edge: \`WEBHOOK_PUBLIC_*\`, \`WEBHOOK_ROUTE_*\`
- TLS: \`WEBHOOK_TLS_*\`
- message security: \`WEBHOOK_TOKEN_*\`, \`WEBHOOK_SIGNATURE_*\`, \`WEBHOOK_NONCE_*\`

## Production baseline

1. Use file-backed real certificates instead of auto-generated certs.
2. Validate message authenticity with token and/or HMAC.
3. Add nonce replay protection.
4. Enable client certificate validation when the sender supports mTLS.
5. Keep request logging minimal and privacy-aware.

Use the static guide at \`/guides/webhook-edge.md\` for the full env-var matrix and curl examples.
`

export const PROXY_CAPABILITIES_GUIDE = `# Proxy Capability Matrix

The proxy toolkit exposes four execution classes, a unified telemetry model, and one shared middleware surface:

- reverse proxy
- explicit proxy
- SOCKS5/SOCKS5h proxy
- transparent TCP proxy
- suite (explicit + socks5 with shared collector)

### Mode × Protocol Matrix

| Capability | Reverse | Explicit | SOCKS5(SOCKS5h) | Transparent | Suite |
|---|:---:|:---:|:---:|:---:|:---:|
| HTTP/HTTPS ingress | ✅ | ✅ | ❌ | ❌ | ✅ |
| CONNECT tunneling | ✅ | ✅ | ❌ | ❌ | ✅ |
| WebSocket upgrade | ✅ | ✅ | ❌ | ❌ | ✅ |
| SOCKS5 + UDP ASSOCIATE | ❌ | ❌ | ✅ | ❌ | ✅ |
| TCP transparent capture | ❌ | ❌ | ❌ | ✅ | ❌ |
| Shared collector/graph | optional | optional | optional | optional | ✅ |

### Metrics and graph defaults

- Telemetry is opt-in by design.
- \`proxy.telemetry\` enables collectors for metrics and graph snapshots.
- Shared \`collector\` can consolidate reverse + explicit + socks5 + transparent state.

Useful options:

- \`sourceHeader\` (\`x-service-name\` or custom marker)
- \`resolveNode\` and \`metricsEndpoint\`
- \`graphEndpoint\` (typically \`/proxy/graph\`)
- \`percentiles\`: \`['p50','p90','p95']\` or \`[0.5,0.9,0.95]\`
- \`rateWindowSeconds\`

### Middleware coverage by mode

- Reverse: \`http-request\`, \`http-response\`, \`connect\`, \`upgrade-request\`, \`mitm-request\`, \`mitm-response\`
- Explicit: \`http-request\`, \`http-response\`, \`connect\`, \`upgrade-request\`, \`mitm-request\`, \`mitm-response\`
- SOCKS5/SOCKS5h: \`socks5-connect\`, \`socks5-bind\`, \`socks5-udp-associate\`
- Transparent: \`transparent\`
- Suite: inherits explicit + socks5 middleware coverage

Behavior model:

- Middleware is opt-in.
- \`ctx.blocked\` cancels a flow with a protocol-appropriate response.
- \`ctx.target\` can be rewritten before the upstream dial.
- HTTP and MITM phases can mutate request/response headers, bodies, paths, and status.
`

export const PROXY_OBSERVABILITY_GUIDE = `# Proxy Observability

All proxy telemetry follows the same **edge model**:

- **source** → **destination** → **protocol**
- protocol values currently include \`http\`, \`https\`, \`connect\`, \`ws\`, \`wss\`, \`socks5\`, \`socks5h\`, \`socks5-udp\`, \`socks5h-udp\`, \`tcp\`

### Core edge metrics

- \`raffel_proxy_edge_requests_total\`
- \`raffel_proxy_edge_active_flows\`
- \`raffel_proxy_edge_errors_total\`
- \`raffel_proxy_edge_flow_duration_seconds\`
- \`raffel_proxy_edge_request_duration_seconds\`
- \`raffel_proxy_edge_flow_rate_per_second\`
- \`raffel_proxy_edge_request_rate_per_second\`
- \`raffel_proxy_edge_error_rate_per_second\`
- \`raffel_proxy_edge_failure_ratio\`

### Graph payload (snapshot)

Graph snapshots expose traffic by edge labels:

- request and byte counters by edge
- request/flow durations with quantiles
- active flow state
- optional method/status labels where available

### Recommended operational checks

- Start with \`createProxySuite\` for explicit + SOCKS5 with one collector.
- Keep \`telemetry.sourceHeader\` consistent so source identity is stable across services.
- Use p50/p90/p95 on duration families for SLA/SLO conversations.
- Pair with \`error_rate\` and \`failure_ratio\` for incident-oriented dashboards.
`
