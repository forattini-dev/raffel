/**
 * Integration tests for `ctx.http.rawBody` (issue #114).
 *
 * Webhook integrations (Stripe, Svix-based providers like Resend / Clerk /
 * Linear, GitHub webhooks, etc.) require the byte-exact request body to
 * verify the HMAC signature carried in headers. Re-stringifying the parsed
 * input does not produce the same bytes the sender signed because property
 * ordering, whitespace, and unicode escapes can differ.
 *
 * These tests prove that resource handlers (FS-discovered) and procedural
 * `server.http.post(...)` handlers can both recover the raw bytes via
 * `ctx.http.rawBody` and verify a Stripe-style HMAC signature.
 */

import { afterEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { createServer as createNodeHttpServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createServer } from '../../src/server/builder.js'
import { loadDiscovery } from '../../src/server/fs-routes/index.js'

const WEBHOOK_SECRET = 'whsec_test_super_secret_key'

function signStripe(rawBody: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const signedPayload = `${timestamp}.${rawBody}`
  const v1 = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex')
  return `t=${timestamp},v1=${v1}`
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNodeHttpServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to acquire free port')))
        return
      }
      const { port } = address
      server.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

async function createWebhookResourceFixture(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raffel-webhook-'))
  await mkdir(path.join(tempDir, 'src', 'resources'), { recursive: true })

  // Resource that mimics the Stripe webhook scenario from issue #114.
  // The handler reads `ctx.http.rawBody` and verifies the HMAC signature
  // from `Stripe-Signature` against the byte-exact request body.
  //
  // We use a custom collection action so the route is `POST /webhooks/stripe`
  // (mirroring how operators wire webhook handlers in real apps).
  const resource = `
import crypto from 'node:crypto'

export const config = { basePath: '/webhooks' }

const SECRET = ${JSON.stringify(WEBHOOK_SECRET)}

function verifyStripeSignature(rawBody, header) {
  if (!rawBody || !header) return false
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=')),
  )
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return false
  const signed = t + '.' + rawBody.toString('utf-8')
  const expected = crypto.createHmac('sha256', SECRET).update(signed).digest('hex')
  // timing-safe compare
  const a = Buffer.from(v1, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export const actions = {
  stripe: {
    method: 'POST',
    collection: true,
    handler: async (data, _id, ctx) => {
      const raw = ctx.http?.rawBody
      const sig = ctx.http?.headers['stripe-signature']
      const ok = verifyStripeSignature(raw, sig)
      if (!ok) {
        const err = new Error('invalid signature')
        err.status = 401
        err.code = 'UNAUTHENTICATED'
        throw err
      }
      return {
        verified: true,
        eventType: data.type,
        rawByteLength: raw ? raw.length : 0,
        // Echo back the parsed input so the test can confirm normal parsing
        // still works alongside raw-body access.
        received: data,
      }
    },
  },
}
`

  await writeFile(path.join(tempDir, 'src', 'resources', 'webhooks.js'), resource)
  return tempDir
}

describe('ctx.http.rawBody for HMAC webhook verification (issue #114)', () => {
  let server: ReturnType<typeof createServer> | null = null
  let tempDir: string | null = null

  afterEach(async () => {
    if (server?.isRunning) {
      await server.stop()
    }
    server = null
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('exposes raw bytes to a resource handler so it can verify a Stripe signature', async () => {
    tempDir = await createWebhookResourceFixture()
    const discovery = await loadDiscovery({
      baseDir: tempDir,
      discovery: { resources: true },
      extensions: ['.js'],
    })

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })
    server.addDiscovery(discovery)
    await server.start()

    // Build the request body with quirky whitespace / property ordering so
    // that JSON.stringify(parsed) would NOT round-trip to the same bytes.
    const rawBody = '{ "type":"payment_intent.succeeded",   "id":"evt_123","amount":4200 }'
    const signature = signStripe(rawBody, WEBHOOK_SECRET)

    const res = await fetch(`http://127.0.0.1:${port}/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature,
      },
      body: rawBody,
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, any>
    expect(json.verified).toBe(true)
    expect(json.eventType).toBe('payment_intent.succeeded')
    expect(json.rawByteLength).toBe(Buffer.byteLength(rawBody, 'utf-8'))
    expect(json.received).toMatchObject({
      type: 'payment_intent.succeeded',
      id: 'evt_123',
      amount: 4200,
    })
  })

  it('rejects the request when the signature does not match the raw bytes', async () => {
    tempDir = await createWebhookResourceFixture()
    const discovery = await loadDiscovery({
      baseDir: tempDir,
      discovery: { resources: true },
      extensions: ['.js'],
    })

    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })
    server.addDiscovery(discovery)
    await server.start()

    // Sign one body, send a different one — signature must fail.
    const signedFor = '{"type":"payment_intent.succeeded","id":"evt_a"}'
    const actuallySent = '{"type":"payment_intent.succeeded","id":"evt_b"}'
    const signature = signStripe(signedFor, WEBHOOK_SECRET)

    const res = await fetch(`http://127.0.0.1:${port}/webhooks/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': signature,
      },
      body: actuallySent,
    })

    expect(res.status).toBe(401)
    const json = (await res.json()) as Record<string, any>
    expect(json.error?.code).toBe('UNAUTHENTICATED')
  })

  it('also exposes raw bytes to programmatic server.http.post handlers', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    let capturedRaw: Buffer | undefined
    let capturedSig: string | undefined

    server.http.post('/hooks/generic', async (input: any, ctx: any) => {
      capturedRaw = ctx.http?.rawBody
      capturedSig = ctx.http?.headers['x-signature']
      return { ok: true, length: capturedRaw?.length ?? 0 }
    })

    await server.start()

    const rawBody = '{"hello":"world","unicode":"\\u00e9"}'
    const signature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex')

    const res = await fetch(`http://127.0.0.1:${port}/hooks/generic`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': signature,
      },
      body: rawBody,
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as Record<string, any>
    expect(json.ok).toBe(true)
    expect(json.length).toBe(Buffer.byteLength(rawBody, 'utf-8'))

    // The captured raw body MUST be byte-identical to what we sent — this
    // is the property that JSON.stringify(parsed) cannot guarantee.
    expect(capturedRaw).toBeDefined()
    expect(capturedRaw!.toString('utf-8')).toBe(rawBody)

    // And we can recompute the HMAC against it server-side.
    const recomputed = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(capturedRaw!)
      .digest('hex')
    expect(recomputed).toBe(capturedSig)
  })

  it('leaves rawBody undefined for empty-bodied requests', async () => {
    const port = await getFreePort()
    server = createServer({ port, host: '127.0.0.1' })

    let captured: Buffer | undefined
    let saw = false

    server.http.post('/empty', async (_input: any, ctx: any) => {
      saw = true
      captured = ctx.http?.rawBody
      return { ok: true }
    })

    await server.start()

    const res = await fetch(`http://127.0.0.1:${port}/empty`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    })

    expect(res.status).toBeLessThan(500)
    expect(saw).toBe(true)
    expect(captured).toBeUndefined()
  })
})
