/**
 * serve() TLS + mTLS integration tests
 *
 * Covers four scenarios:
 *
 *   1. Plain TLS (no client cert): server starts on https, request succeeds,
 *      no peer-cert info is attached.
 *   2. mTLS strict (requestCert + rejectUnauthorized=true + valid client
 *      cert): handler reads peer cert via getRequestPeerCertificate.
 *   3. mTLS soft (requestCert + rejectUnauthorized=false + no client cert):
 *      handshake succeeds, handler sees no peer cert (request anonymous).
 *   4. Boot-time guard: requestCert=true without `ca` and with
 *      rejectUnauthorized=true throws synchronously before listening.
 *
 * Certs are generated with the in-tree certs.ts utility — no external CA,
 * no fixtures on disk.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { request as httpsRequest } from 'node:https'
import { serve, type RaffelServer } from '../../src/http/serve.js'
import { generateCertificate, getDefaultCA } from '../../src/utils/certs.js'
import { getRequestPeerCertificate } from '../../src/utils/peer-cert.js'

const servers: RaffelServer[] = []

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!
    await s.shutdown(1000).catch(() => undefined)
  }
})

function track(server: RaffelServer): RaffelServer {
  servers.push(server)
  return server
}

function getPort(server: RaffelServer): number {
  const addr = server.address()
  if (addr && typeof addr === 'object') return addr.port
  throw new Error('server has no address')
}

interface HttpsResult {
  status: number
  body: string
}

function httpsGet(opts: {
  port: number
  path?: string
  ca?: string
  key?: string
  cert?: string
}): Promise<HttpsResult> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: 'localhost',
        port: opts.port,
        path: opts.path ?? '/',
        method: 'GET',
        ca: opts.ca,
        key: opts.key,
        cert: opts.cert,
        // Localhost cert + localhost host — disable SNI strictness which
        // varies across Node versions in test envs.
        servername: 'localhost',
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

// Use the singleton default CA so server + client certs share an issuer name
// the chain validator accepts. `generateCertificate` rebuilds the issuer name
// from the CA subject's CN only — passing a custom caCert with multi-RDN
// subjects (O+CN) produces a non-matching issuer string and breaks chain
// validation. The default-CA path uses the well-known CA_NAME_COMPONENTS and
// works end-to-end.
async function makeTrustChain(): Promise<{
  ca: string
  serverKey: string
  serverCert: string
  clientKey: string
  clientCert: string
}> {
  const ca = getDefaultCA()
  const server = await generateCertificate('localhost')
  const client = await generateCertificate('test-client@example.com')
  return {
    ca: ca.cert,
    serverKey: server.key,
    serverCert: server.cert,
    clientKey: client.key,
    clientCert: client.cert,
  }
}

describe('serve() — plain TLS (no client cert)', () => {
  it('starts an https listener and returns 200', async () => {
    const ca = getDefaultCA()
    const leaf = await generateCertificate('localhost')

    const server = track(
      await serve({
        fetch: () => new Response('hello over tls', { status: 200 }),
        port: 0,
        tls: { key: leaf.key, cert: leaf.cert },
      }),
    )

    const res = await httpsGet({ port: getPort(server), ca: ca.cert })
    expect(res.status).toBe(200)
    expect(res.body).toBe('hello over tls')
  })
})

describe('serve() — strict mTLS', () => {
  it('attaches peer cert to the request when client presents a valid cert', async () => {
    const chain = await makeTrustChain()

    let observedSubject: string | undefined
    let observedAuthorized: boolean | undefined

    const server = track(
      await serve({
        fetch: (req) => {
          const peer = getRequestPeerCertificate(req)
          if (!peer) return new Response('no cert', { status: 401 })
          observedSubject = peer.certificate.subject?.CN
          observedAuthorized = peer.authorized
          return new Response('hi ' + (observedSubject ?? ''), { status: 200 })
        },
        port: 0,
        tls: {
          key: chain.serverKey,
          cert: chain.serverCert,
          ca: chain.ca,
          requestCert: true,
          rejectUnauthorized: true,
        },
      }),
    )

    const res = await httpsGet({
      port: getPort(server),
      ca: chain.ca,
      key: chain.clientKey,
      cert: chain.clientCert,
    })

    expect(res.status).toBe(200)
    expect(res.body).toBe('hi test-client@example.com')
    expect(observedSubject).toBe('test-client@example.com')
    expect(observedAuthorized).toBe(true)
  })

  it('rejects the connection when no client cert is presented', async () => {
    const chain = await makeTrustChain()

    const server = track(
      await serve({
        fetch: () => new Response('should not reach', { status: 200 }),
        port: 0,
        tls: {
          key: chain.serverKey,
          cert: chain.serverCert,
          ca: chain.ca,
          requestCert: true,
          rejectUnauthorized: true,
        },
      }),
    )

    await expect(
      httpsGet({ port: getPort(server), ca: chain.ca }),
    ).rejects.toThrow()
  })
})

describe('serve() — soft mTLS', () => {
  it('lets the handler distinguish anonymous from cert-authenticated clients', async () => {
    const chain = await makeTrustChain()

    const server = track(
      await serve({
        fetch: (req) => {
          const peer = getRequestPeerCertificate(req)
          if (!peer) return new Response('anonymous', { status: 200 })
          return new Response('authed:' + peer.certificate.subject?.CN, { status: 200 })
        },
        port: 0,
        tls: {
          key: chain.serverKey,
          cert: chain.serverCert,
          ca: chain.ca,
          requestCert: true,
          rejectUnauthorized: false,
        },
      }),
    )

    const anon = await httpsGet({ port: getPort(server), ca: chain.ca })
    expect(anon.status).toBe(200)
    expect(anon.body).toBe('anonymous')

    const authed = await httpsGet({
      port: getPort(server),
      ca: chain.ca,
      key: chain.clientKey,
      cert: chain.clientCert,
    })
    expect(authed.status).toBe(200)
    expect(authed.body).toBe('authed:test-client@example.com')
  })
})

describe('serve() — boot-time guard', () => {
  it('rejects requestCert=true without a CA in strict mode', async () => {
    const leaf = await generateCertificate('localhost')

    await expect(
      serve({
        fetch: () => new Response('unreachable'),
        port: 0,
        tls: {
          key: leaf.key,
          cert: leaf.cert,
          requestCert: true,
          // rejectUnauthorized defaults to true
        },
      }),
    ).rejects.toThrow(/requires tls\.ca/)
  })
})
