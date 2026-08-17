/**
 * `meta.auth: 'required'` on a discovered route must not pre-empt the authenticator.
 *
 * A discovered route declaring `meta.auth` gets a contract-policy gate
 * (`createContractAuthPolicyInterceptor`) that only inspects `ctx.auth` — it holds
 * no verifier and cannot authenticate. It used to be composed BEFORE the global
 * auth middleware (discovery passes the globals inside `options.interceptors`, and
 * the registry prepended the policy gate), so it threw `Authentication required`
 * before anything read the credential: every such route answered 401 regardless of
 * the token. This was the mass 401 in staging on 2026-08-17.
 *
 * Driven through real discovery + a real HTTP server + a global auth middleware —
 * the exact shape svc-closer uses.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthMiddleware, createBearerStrategy, createServer } from '../../src/index.js';

const PORT = 45_231;
const BASE = `http://127.0.0.1:${PORT}`;
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'meta-auth-routes');

let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  server = createServer({
    port: PORT,
    host: '127.0.0.1',
    hotReload: false,
    discovery: { http: fixtures },
  });

  server.use(
    createAuthMiddleware({
      strategies: [
        createBearerStrategy({
          verify: async (token: string) =>
            token === 'good'
              ? { authenticated: true, principal: 'user-1', roles: ['agent'] }
              : null,
        }),
      ],
      publicProcedures: [],
    }),
  );

  await server.start();
});

afterAll(async () => {
  await server?.stop();
});

const get = (path: string, token?: string) =>
  fetch(`${BASE}${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);

describe('discovered route with meta.auth required', () => {
  it('a valid credential reaches the handler (was a fixed 401 before the fix)', async () => {
    const res = await get('/protected', 'good');
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true });
  });

  it('an invalid credential is rejected', async () => {
    expect((await get('/protected', 'bad')).status).toBe(401);
  });

  it('a missing credential is rejected', async () => {
    expect((await get('/protected')).status).toBe(401);
  });

  it('a route without meta.auth is still guarded by the global middleware', async () => {
    // Confirms the global middleware runs on every route, so removing meta.auth is
    // never what opens a route — it is the global that authenticates.
    expect((await get('/open', 'good')).status).toBe(200);
    expect((await get('/open')).status).toBe(401);
  });
});
