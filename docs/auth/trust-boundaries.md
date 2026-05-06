# Trust Boundaries

> **The contract between bytes you don't control and the structured wire formats Raffel writes.**

Raffel sits on the request path of multiple protocols (HTTP, WebSocket, gRPC, JSON-RPC, MCP) and runs a dedicated proxy module in front of upstream services. Every place where untrusted input becomes part of a structured serialisation — an HTTP header, a registry lookup, a structured log line — is a trust boundary. This guide names the boundaries Raffel guards, the ones the application developer is responsible for, and the rejection-vs-strip policy at each sink.

If you're investigating a CVE class like the November 2026 GitHub `Babeld` push-options injection, this is the place to start.

## Attacker model

Raffel's threat model assumes an attacker can:

- Send arbitrary bytes in HTTP request headers, body, path segments, query strings.
- Open a WebSocket connection and send arbitrary `subscribe`/`publish` payloads.
- Send arbitrary JSON-RPC `method` strings and MCP tool/resource names.
- Reach a malicious upstream that responds with arbitrary bytes (relevant for the proxy module's CONNECT MITM intercept mode).
- Supply arbitrary strings to any user-defined hook (`onRequest` / `onResponse` / custom resolvers / custom conditions). The hook is YOUR code; Raffel sanitises around it but cannot reason about its semantics.

The attacker does NOT have:

- Filesystem access on the server.
- The ability to modify policy files, source code, or operator-controlled configuration.
- Network access between Raffel and downstream services beyond what the app exposes.

## In-scope sinks

These are the sinks Raffel sanitises automatically. You do not need to wrap your handler code in defensive checks — the bytes are clean by the time your handler runs.

| Sink | Where | Sanitiser | Failure mode |
|---|---|---|---|
| HTTP forward proxy outbound headers | `src/proxy/http-forward.ts` | `sanitiseOutboundHeaders` | `400 Bad Request` |
| CONNECT MITM intercept request headers | `src/proxy/connect-tunnel.ts` (after `onRequest`/middleware) | `sanitiseOutboundHeaders` | `400 Bad Request` |
| CONNECT MITM intercept response headers | `src/proxy/connect-tunnel.ts` (after `onResponse`/middleware) | `sanitiseOutboundHeaders` | `502 Bad Gateway` |
| WebSocket `subscribe` / `publish` channel name | `src/adapters/websocket.ts` | `safeChannelName` (or custom regex via `ChannelOptions.nameValidation`) | `close 1008 Policy Violation` |
| JSON-RPC dispatch `method` | `src/adapters/jsonrpc.ts` | `safeStructuredKey` | `INVALID_REQUEST` (-32600) |
| MCP `tools/call` `params.name` | `src/protocols/mcp/protocol.ts` | `safeStructuredKey` | `InvalidParams` (-32602) |
| MCP `resources/read` `params.uri` | `src/protocols/mcp/protocol.ts` | `safeHeaderValue` (URI-tolerant char class) | `InvalidParams` (-32602) |

## Out-of-scope (developer responsibility)

These are paths where Raffel cannot apply a sanitiser without breaking your code's intent. Your application owns them.

- **Custom proxy hooks** (`onRequest`, `onResponse`, `onUpstreamCert`, middleware) — Raffel sanitises the wire output AROUND your hook, but your hook itself can still log, store, or forward unsanitised bytes inside its own logic.
- **Custom policy `condition` callbacks** — these are TS code; Raffel hands you the request as-is.
- **Custom channel `authorize`** functions — same shape.
- **Application-supplied logger sinks** — if you pipe `ctx.input.body` into a structured logger, the logger's escaping is the contract, not Raffel's.
- **Database query parameters** — use parametrised queries. Raffel doesn't see your DB layer.
- **HTML rendered by your handler** — if you build HTML with user data, escape per your template engine's rules.
- **Operator-written files** (policy YAML, FS-discovery handler files) — these are NOT in the request trust boundary. Their parser validates them at load time, and any policy reference to a registered TS function is resolved at boot.

## Sanitiser library

The library lives at `src/security/sanitize/` and exports four named sinks. Application code can reuse it for app-specific trust boundaries.

```ts
import { safeHeaderValue, safeChannelName, safeRouteSegment, safeStructuredKey } from 'raffel/security'
```

| Function | Allowed shape | Default max length |
|---|---|---|
| `safeHeaderValue` | Printable ASCII + extended; rejects CRLF, NUL, control bytes (< 0x20 except `\t`), `\x7F` | 4096 |
| `safeChannelName` | `[a-zA-Z0-9._:/-]+`, NFKC-normalised | 256 |
| `safeRouteSegment` | Same character class as channel name | 256 |
| `safeStructuredKey` | `[a-zA-Z_][a-zA-Z0-9_.-]*` (identifier-shaped) | 256 |

Each sink defaults to **reject mode**: malicious input throws `SanitisationError` with a tagged `kind` (`'invalid-char' | 'too-long' | 'empty'`). Strip mode is opt-in per call site for the rare case where information loss is intentional (e.g. log-line normalisation).

```ts
import { safeHeaderValue, SanitisationError } from 'raffel/security'

try {
  const cleaned = safeHeaderValue(userSupplied)
  upstream.set('X-Forwarded-Original', cleaned)
} catch (err) {
  if (err instanceof SanitisationError) {
    return new Response('Bad Request', { status: 400 })
  }
  throw err
}
```

## What to do when you find a new sink

If you spot a new place in your application code where an untrusted string lands inside a structured wire format that Raffel doesn't already cover:

1. **Decide the sink shape.** Is it a header value (free-form printable)? An identifier (alphanumeric)? A path segment? A URI?
2. **Pick the matching sanitiser** from the four above. If none fit cleanly, prefer `safeHeaderValue` — it's the most permissive while still rejecting CRLF/NUL/control bytes.
3. **Choose reject vs strip.** Default to reject. Strip mode loses information silently and should only be used when you're explicitly normalising for display/log.
4. **Surface the rejection at the protocol layer.** HTTP: 400 / 502. WebSocket: close 1008. JSON-RPC / MCP: documented error code.
5. **Add a test.** Pick one or two vectors from `test/security/fuzz.int.test.ts`'s `VECTORS` catalogue and assert your new sink rejects them. The fuzz harness will then exercise it on every push.
6. **Update this guide** with a row in the "in-scope sinks" table above.

## Worked example: the GitHub `Babeld` bug

The November 2026 GitHub vulnerability is an excellent worked example of the bug class this guide guards against:

- `Babeld` accepted git push options (untrusted user input) and serialised them into an `Xstat` HTTP header for forwarding to `git RPCD`.
- The serialisation used `;` as a delimiter and did not escape the delimiter inside push-option values.
- An attacker put a `;` in a push option, smuggled additional headers into the `Xstat` field, and overrode the `largeBlobRejectionEnabled` flag — eventually achieving remote code execution.

The same shape of bug is what `safeHeaderValue` and `sanitiseOutboundHeaders` defend against in Raffel's proxy and adapter paths. The lesson is structural: **wherever untrusted input crosses into a delimited serialisation format, the delimiter must be escaped or the input must be rejected**. The sanitiser library is Raffel's seatbelt for that class.

## Related

- [Policies](../policies/README.md) — once a request is past the trust boundary, authorisation decides whether the principal may act.
- [Connection filter](../core/interceptors/overview.md) — IP-level allow/deny that runs before any sanitiser.
- [Co-located policies](../policies/co-located.md) — operator-written policies are a different trust model (load-time validation, not request-time).
