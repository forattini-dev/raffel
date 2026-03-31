# Traefik Replacement Roadmap

## Objective

Guide the team to replace Traefik with another ingress/reverse proxy layer (or no dedicated ingress if not needed) without breaking traffic delivery, TLS trust, or observability.

## Scope

- Do **not** change application code in this repository in this roadmap.
- Focus on control-plane and edge infrastructure: routing, TLS, middleware behavior, observability, rollout, and rollback.
- Keep the application stack in this repo untouched until the new edge is fully validated.

## Timeline (example)

- Start date: 31/03/2026 (UTC-3)
- End date: 24/05/2026 (UTC-3)
- Duration: 8 weeks (6 migration phases + 2 weeks hardening)

## Execution model

Recommended 8-week cadence (adjust to your release calendar):

1. Week 1-2: Phase 0 + Phase 1
2. Week 3: Phase 2 (staging proof of concept ready)
3. Week 4-5: Phase 2 load and chaos testing
4. Week 6: Phase 3 (canary 5% to 50%)
5. Week 7: Phase 3 completion and Phase 4 cutover
6. Week 8: Phase 4 stability window and Phase 5 start

## Ticketized backlog template

Use this directly in Jira/Linear/Asana as a starting point:

| Ticket | Phase | Scope | DoD (definition of done) |
|:-------|:------|:------|:-------------------------|
| TRA-001 | Phase 0 | Current Traefik inventory capture | Inventory doc includes routers, middlewares, certs, ACME settings, rate limits, and auth policy |
| TRA-002 | Phase 0 | Baseline metrics collection | 7-day baseline captured for all critical routes and saved in shared dashboard |
| TRA-003 | Phase 1 | Candidate matrix | At least 2 candidates evaluated, with pass/fail matrix for required features |
| TRA-004 | Phase 1 | Decision record | Approved architecture + fallback, TLS strategy, domain routing strategy and ownership defined |
| TRA-005 | Phase 2 | Staging POC provisioning | New proxy runs in staging with TLS, routing, and health checks enabled |
| TRA-006 | Phase 2 | Functional parity tests | Tests for redirects, rewrites, headers, security middleware, and failure codes pass in staging |
| TRA-007 | Phase 2 | Observability parity | Metrics/traces/logs from edge can be queried with same alert conditions as baseline |
| TRA-008 | Phase 3 | Canary automation | Traffic split automation + gates for 5%, 20%, 50%, 100% implemented and documented |
| TRA-009 | Phase 3 | Gate criteria validation | Canary passed with no SLO breach for defined windows |
| TRA-010 | Phase 4 | Full cutover | DNS/LB switch to new proxy for 100% production traffic with rollback ready |
| TRA-011 | Phase 4 | Stability run | 72h monitor window with no rollback and no P1 regression |
| TRA-012 | Phase 5 | Rollback readiness | All rollback commands and config snapshots are versioned and tested |
| TRA-013 | Phase 5 | Traefik decommission | Old stack removed from pipeline and secrets/documents archived |
| TRA-014 | Phase 5 | Hardening tasks | New runbook merged, DR updated, and regression suite scheduled in CI |

## Phase 0 - Discovery and baseline

1. Build complete inventory from current Traefik:
   - Entrypoints, routers, services, middlewares, resolvers, entry rules.
   - Certificates and ACME settings.
   - Redirect/rewrite behavior.
   - Auth/ACL/RBAC/WAF usage.
   - mTLS, SNI, WebSocket and gRPC paths.
   - Rate limits, timeouts, circuit-breaking, load balancing strategy.
2. Capture production baselines for 7 days:
   - RPS, p50/p95/p99 latency per path.
   - Error rates by upstream service and status class.
   - TLS handshake latency and failure reasons.
   - CPU, memory, open connections, fd usage of current edge.
3. Define success criteria now:
   - Error budget: no increase in p95/p99 > 5%.
   - Availability target for each critical route.
   - Timeout and header/cors behavior exactness.

## Phase 1 - Target architecture and selection

- Candidate stack shortlist:
  - NGINX
  - Caddy
  - Envoy
  - HAProxy
- Define for each candidate:
  - ACME/LetsEncrypt support
  - WebSocket and gRPC compatibility
  - Dynamic config reload model
  - Middleware feature parity with Traefik
  - mTLS support and cert store lifecycle
  - Operational model (GitOps, Helm, Terraform, or static config)
- Approve a primary option and one fallback before implementation.
- Finalize:
  - Domain-to-service mapping (host/path based)
  - TLS strategy (single wildcard vs per-service certs)
  - Logging schema and tracing format
  - Monitoring queries/alerts to keep parity

## Phase 2 - Proof of concept in staging

- Provision the new proxy in a staging cluster/environment only.
- Replay all production-like traffic classes:
  - `GET/POST/PATCH/DELETE` public routes
  - WebSocket upgrades
  - gRPC method calls
  - Long-lived connections
  - Health/check endpoints
- Recreate Traefik behavior exactly in a matrix:
  - Redirects and rewrites
  - CORS and security headers
  - Rate limit / burst behavior
  - Retry and timeout values
  - Response codes on failures (401/403/429/502/503/504)
- Add acceptance tests:
  - Contract tests for path mapping
  - Certificate renewal simulation
  - Failover/healthcheck behavior
  - Canary fail-safe behavior

## Phase 3 - Dual path and canary

- Keep Traefik and new proxy running in parallel.
- Route 5% → new proxy and 95% → Traefik.
- Increase to 20%, 50%, then 100% only after:
  - Latency and error gates pass for 30 min sustained window.
  - No regression in auth and TLS chains.
  - Log/metric schema matches the expected dashboard alerts.
- Canary rollback condition examples:
  - Error rate > 0.3% above baseline for 3 consecutive windows
  - P95 latency +25% for any critical route
  - TLS handshake failure ratio > 0.2%
  - Any security regression in auth middleware metrics

## Phase 4 - Cutover and stability window

- Switch DNS or upstream LB target to new proxy (100% traffic).
- Freeze config drift: freeze the old Traefik pipeline for 1 week.
- Keep legacy path documented and re-activatable.
- Run synthetic probes every minute for critical flows:
  - Public API
  - WebSockets
  - Health endpoints
  - Background callbacks/cron webhook callbacks
- On-goal rule: no P1 incident and no rollback after 72h.

## Phase 5 - Retire old edge and harden

- Decommission Traefik resources:
  - Static files
  - Secrets and ACME state
  - Dashboard/access policies
  - Auto-heal or operator controllers
- Replace with post-migration runbook and change control checks:
  - Pull request template for proxy config
  - Diff review checklist
  - Expiration alert for certificates
  - Change freeze windows for peak hours
- Post-cutover tasks:
  - Update on-call runbook
  - Update disaster recovery path
  - Add canary tests to CI/CD pipeline
  - Add regression tests for proxy-layer assumptions

## Validation checklist by artifact

- Config parity
  - [ ] All domains and paths routed
  - [ ] All redirects and rewrites reproduced
  - [ ] TLS versions/ciphers and ALPN set correctly
  - [ ] Header mutation policy equal to baseline
- Security
  - [ ] TLS redirection mandatory where required
  - [ ] HSTS and security headers parity
  - [ ] IP allow/block policy parity
  - [ ] WAF/middleware equivalence validated
- Operations
  - [ ] Metrics exported in Prometheus format
  - [ ] Distributed tracing context preserved where used
  - [ ] Standard dashboards show same service names/tags
  - [ ] Runbook contains cutover and rollback commands
- Reliability
  - [ ] Load test at production peak equivalent
  - [ ] Chaos test for backend failure and timeout
  - [ ] WebSocket reconnect behavior under pod restart
  - [ ] TLS cert rotation tested without restart

## Rollback plan

- Keep previous config + state snapshots in one immutable release.
- Keep rollback command list in the first post-cutdown ticket:
  - Reverse traffic split in DNS/LB.
  - Restore previous cert source configuration.
  - Re-enable Traefik health probes and rate limits.
  - Notify on-call with explicit expected impact window.

## First 14-day execution variant

If your team is smaller or your release window is tight, use this shorter execution:

1. Days 1-2: Complete Phase 0 + baseline and Phase 1 selection.
2. Days 3-5: Build staging POC and validate routing/security parity.
3. Days 6-8: Load and chaos tests in staging.
4. Days 9-11: Canary 5% -> 20% -> 50%.
5. Days 12-13: Canary to 100%, execute cutover and initial hardening.
6. Day 14: Full validation freeze, rollback readiness check, and decision to proceed.

## Deliverables

- New infra repository changes (or manifests) for the chosen proxy.
- Signed validation report with each checklist section completed.
- Operational runbook for deploy, rollback, and certificate operations.
- Final "no longer used" list for Traefik components.

## Exit criteria

- All validation checklists completed.
- Zero critical production incidents attributed to the edge migration for 14 days.
- Team signed acceptance on security and operational parity.
- Legacy Traefik fully retired and removed from deployment automation.

## Reverse-Proxy Config Example (JSON/YAML-driven)

Before replacing Traefik, start by defining routes in one of these supported formats and load them with the same runtime path.

Programmatic configuration:

```typescript
import { createReverseProxy } from 'raffel'

const reverse = await createReverseProxy({
  server: { host: '0.0.0.0', port: 3000 },
  noMatch: {
    status: 404,
    body: 'No route matched',
  },
  routes: [
    {
      name: 'public-http',
      match: {
        host: 'api.internal.example.com',
        pathPrefix: '/v1',
        methods: ['GET', 'POST'],
      },
      target: 'http://127.0.0.1:4000',
    },
    {
      name: 'admin-ws',
      match: {
        host: 'admin.internal.example.com',
        path: '/ws',
      },
      target: 'http://127.0.0.1:4001',
      stripPrefix: '/ws',
    },
  ],
  proxy: {
    telemetry: {
      sourceHeader: 'x-service-name',
      graphEndpoint: '/proxy/graph',
      metricsEndpoint: '/metrics',
    },
  },
})

await reverse.start()
```

JSON config file (`proxy.json`):

```json
{
  "server": { "host": "0.0.0.0", "port": 3000 },
  "routes": [
    {
      "name": "public-http",
      "match": {
        "host": "api.internal.example.com",
        "pathPrefix": "/v1",
        "methods": ["GET", "POST"]
      },
      "target": "http://127.0.0.1:4000"
    }
  ]
}
```

YAML config file (`proxy.yaml`):

```yaml
server:
  host: 0.0.0.0
  port: 3000
routes:
  - name: admin-ws
    match:
      host: admin.internal.example.com
      path: /ws
    target: http://127.0.0.1:4001
    stripPrefix: /ws
```

Load and start with:

```typescript
import { loadReverseProxyConfig, createReverseProxy } from 'raffel'

const config = await loadReverseProxyConfig('./proxy.yaml') // .json also works
const reverse = await createReverseProxy(config)
await reverse.start()
```

This flow keeps routing policy in files while preserving the same `createReverseProxy()` runtime used in service startup.

## HTTPS (local/production)

`server.tls` aceita PEM inline, arquivos (`certFile`/`keyFile`) ou configuração automática com `tls: {}`.

- `server.tls: {}` é uma conveniência para dev/local: o proxy gera `cert/key` autoassinado em start.
- Para produção, prefira certificados persistentes (arquivo ou vault/secret mount).

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3443,
    "tls": {
      "certFile": "/path/to/localhost.crt",
      "keyFile": "/path/to/localhost.key",
      "caFile": "/path/to/ca.pem",
      "rejectUnauthorized": false
    }
  },
  "routes": [
    {
      "name": "app-https",
      "match": {
        "host": "app.internal.example.com",
        "path": "/"
      },
      "target": "http://127.0.0.1:4000"
    }
  ]
}
```

Exemplo mínimo local sem passar cert:

```json
{
  "server": {
    "host": "127.0.0.1",
    "port": 3443,
    "tls": {}
  },
  "routes": [
    {
      "name": "dev-catchall",
      "match": {
        "host": "local.internal.example.com",
        "path": "/"
      },
      "target": "http://127.0.0.1:4000"
    }
  ]
}
```

- `host`/`path` rules match by Host header and path.
- Use `path` for exact matches, `pathPrefix` for prefix matches, and multiple route entries for the same host.
- `noMatch` returns a custom response when no route matches, useful for API not-found.
- `rejectUnauthorized: false` is common for self-signed local TLS when the reverse proxy is the terminating endpoint.

Example using inline cert/key (useful in tests/dev bootstrap):

```ts
import { createReverseProxy } from 'raffel'

const reverse = await createReverseProxy({
  server: {
    host: '127.0.0.1',
    port: 3443,
    tls: {
      cert: process.env.LOCAL_PROXY_CERT,
      key: process.env.LOCAL_PROXY_KEY,
    },
  },
  routes: [
    {
      name: 'local-catchall',
      match: { host: '*.internal.example.com', pathPrefix: '/api' },
      target: 'http://127.0.0.1:4000',
    },
    {
      name: 'same-host-admin',
      match: { host: '*.internal.example.com', path: '/health' },
      target: 'http://127.0.0.1:4001',
      stripPrefix: false,
    },
  ],
})

await reverse.start()
```

`stripPrefix` defaults to the configured `pathPrefix` when present, so `/api/foo` above is sent as `/foo` to upstream. Use `stripPrefix: false` to keep `/health` unchanged.
