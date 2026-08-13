# Security hardening migration

Raffel 2 tightens defaults at network and authentication trust boundaries. Most
local development continues to work without configuration; deployments that
intentionally expose listeners must now state that intent.

## Listener and CORS defaults

HTTP, WebSocket, JSON-RPC, gRPC, TCP, UDP, SMTP, SSH, MCP, and proxy listeners
bind to `127.0.0.1` when no host is supplied. Configure `host: '0.0.0.0'` or an
explicit interface only when remote access is required.

CORS is disabled unless `cors` is supplied. Credentialed CORS requires an
explicit origin allowlist or validator; `credentials: true` with `origin: '*'
is rejected.

## OAuth2 and OIDC

Browser authorization transactions now use a short-lived signed, `HttpOnly`,
`SameSite=Lax` cookie. The cookie binds state, provider, issuance time, PKCE
verifier, and OIDC nonce to the browser that started the flow. Outside loopback,
HTTPS is required.

```ts
app.use('/auth/*', oidc({
  providers: [provider],
  transactionSecret: process.env.OAUTH_TRANSACTION_SECRET,
  transactionCookie: { secure: true, maxAgeSeconds: 600 },
  onSuccess,
}))
```

Set `transactionCookie.secure: true` when TLS terminates at a trusted reverse
proxy and the internal request URL uses `http:`. OIDC ID tokens and back-channel
logout tokens are verified against the provider JWKS with issuer, audience,
algorithm, expiry, nonce/event, and replay checks.

## Session and composite authentication

`cookieSession()` loads and verifies session state; it is not an authentication
decision. Use `sessionAuth()` inside `compositeAuth()`:

```ts
app.use('*', cookieSession({ secret: process.env.SESSION_SECRET }))
app.use('*', compositeAuth({
  drivers: [sessionAuth(), bearerAuth({ verifyToken })],
}))
```

Passing generic middleware such as `cookieSession()` as a composite driver is
rejected so an unauthenticated `next()` cannot become an auth bypass.

## Externally reachable proxies

Explicit HTTP and SOCKS5 proxies bound outside loopback require both
authentication and a destination filter. Private, loopback, link-local, and
metadata-style targets are denied by default.

```ts
createExplicitProxy({
  host: '0.0.0.0',
  port: 3128,
  auth: { credentials: { username, password } },
  filter: { allowedHosts: ['api.example.com'] },
})
```

The escape hatches `dangerouslyAllowUnauthenticatedNetwork` and
`dangerouslyAllowPrivateTargets` are intended only for reviewed, isolated
networks. Their names are deliberately conspicuous because they remove a trust
boundary.

## MCP and channel APIs

An externally bound HTTP MCP server requires `auth`. The legacy SSE transport
cannot authenticate external clients and therefore requires the explicit
`dangerouslyAllowUnauthenticatedNetwork` escape hatch. REST channel APIs require
`auth` or `apiKey`; intentionally public deployments must set
`allowUnauthenticated: true`.

Default MCP limits are 1 MiB per request, 1,000 sessions, and five streams per
session. Tune `maxBodySize`, `maxSessions`, and `maxStreamsPerSession` downward
for internet-facing deployments. MCP CORS is disabled unless `cors` is supplied;
the legacy SSE transport additionally caps connected clients.

## Resource and query limits

- Buffered upstream proxy responses default to a 10 MiB maximum.
- GraphQL requests default to depth 15, complexity 1,000, and 50 aliases.
- GraphQL subscriptions cap payload size, connections, and subscriptions per
  connection and require timely connection initialization.
- Static-file and documentation asset handlers verify real paths, preventing a
  symlink from escaping the configured root.

Load-test custom limits before rollout and alert on rejected requests (`413` or
`429`) so legitimate capacity pressure is distinguishable from abuse.

## Release verification

CI runs CodeQL, Gitleaks, and an OSV audit of exact production dependency
versions. Release publishing uses npm provenance and attaches a CycloneDX SBOM.
All third-party GitHub Actions are pinned to immutable commits.

Stable tags wait for a ZAP baseline scan. Configure the protected
`security-testing` environment with an authorized `DAST_TARGET_URL`; a missing
target intentionally blocks publication.
