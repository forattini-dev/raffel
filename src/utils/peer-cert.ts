/**
 * Peer certificate side-channel for request handlers.
 *
 * `Request` is the WHATWG Fetch type — by contract it has no socket and no
 * peer identity. When `serve()` is configured with `tls.requestCert`, the
 * Node `TLSSocket` does carry the client's peer certificate, but there is
 * no place on the platform Request to surface it without breaking the Web
 * contract.
 *
 * Mirrors the WeakMap pattern from `client-ip.ts` (`attachRequestSocketInfo` /
 * `getRequestSocketInfo`) so a handler can read peer-cert info per-request
 * without leaking it into the public Request shape.
 *
 * Usage:
 *
 * ```ts
 * import { getRequestPeerCertificate } from 'raffel'
 *
 * app.get('/me/sessions', (c) => {
 *   const cert = getRequestPeerCertificate(c.req.raw)
 *   if (!cert) return c.json({ error: 'client certificate required' }, 401)
 *   const subjectCN = cert.subject?.CN
 *   // ... filter by subjectCN
 * })
 * ```
 */
import type { PeerCertificate } from 'node:tls'

/**
 * Minimal information surfaced to the request handler. Mirrors the relevant
 * fields of Node's `tls.PeerCertificate`, plus an `authorized` flag that
 * captures whether the TLS handshake validated the cert against the
 * configured CA (i.e. the cert passed `rejectUnauthorized` semantics).
 *
 * Handlers should treat `authorized === false` as "this cert was presented
 * but failed validation" — useful with `rejectUnauthorized: false` to log
 * the bad cert before responding 401, instead of silently accepting it.
 */
export interface RequestPeerCertificateInfo {
  /** Full Node PeerCertificate (use `subject.CN`, `subjectaltname`, `fingerprint256`, …) */
  certificate: PeerCertificate
  /** True iff the TLS layer validated the cert chain against the configured CA */
  authorized: boolean
  /** Reason the handshake marked the cert as unauthorized, when available */
  authorizationError?: Error
}

const requestPeerCertificate = new WeakMap<Request, RequestPeerCertificateInfo>()

/**
 * Attach peer-cert info to a Request. Called by the `serve()` HTTPS branch
 * once per incoming connection. Returns the Request unchanged so callers can
 * chain.
 */
export function attachRequestPeerCertificate(
  request: Request,
  info: RequestPeerCertificateInfo,
): Request {
  requestPeerCertificate.set(request, info)
  return request
}

/**
 * Read the peer-cert info for a Request. Returns `undefined` when the request
 * arrived over plain HTTP, or over HTTPS without `requestCert: true`, or when
 * the client did not present a cert and `rejectUnauthorized: false` allowed
 * the handshake to proceed.
 */
export function getRequestPeerCertificate(
  request: Request,
): RequestPeerCertificateInfo | undefined {
  return requestPeerCertificate.get(request)
}
