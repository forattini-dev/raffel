/**
 * Reverse proxy — integration tests
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { type Socket } from 'node:net'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createReverseProxy, loadReverseProxyConfig, parseReverseProxyConfig } from '../../src/proxy/reverse.js'
import { createMockHttpServer } from '../../src/testing/index.js'
import { generateCertificate } from '../../src/utils/certs.js'

type MockHttpServer = Awaited<ReturnType<typeof createMockHttpServer>>

interface SimpleResponse {
  status: number
  body: string
  headers: Record<string, string>
}

let upstreamA: MockHttpServer
let upstreamB: MockHttpServer
let reverse: Awaited<ReturnType<typeof createReverseProxy>> | null = null
const tempConfigDirs = new Set<string>()

beforeEach(async () => {
  upstreamA = await createMockHttpServer({ host: '127.0.0.1' })
  upstreamB = await createMockHttpServer({ host: '127.0.0.1' })
})

afterEach(async () => {
  if (reverse?.isRunning) {
    await reverse.stop()
  }

  await upstreamA.stop()
  await upstreamB.stop()

  for (const directory of tempConfigDirs) {
    await rm(directory, { recursive: true, force: true })
  }
  tempConfigDirs.clear()
})

function readHeaders(responseHeaders: NodeJS.Dict<string | string[] | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(responseHeaders).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join(', ') : (value ?? ''),
    ]),
  )
}

type TransportProtocol = 'http' | 'https'

function fetchViaProxy(
  path: string,
  proxyPort: number,
  headers: Record<string, string> = {},
  method = 'GET',
  protocol: TransportProtocol = 'http',
  skipTlsVerification = true,
): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    const request = (protocol === 'https' ? httpsRequest : httpRequest)(
      {
        host: '127.0.0.1',
        port: proxyPort,
        path,
        method,
        headers,
        ...(protocol === 'https' ? { rejectUnauthorized: !skipTlsVerification } : {}),
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString(),
            headers: readHeaders(response.headers),
          })
        })
      },
    )

    request.on('error', reject)
    request.end()
  })
}

async function sendConnect(proxyPort: number, host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port: proxyPort,
      method: 'CONNECT',
      path: `${host}:${port}`,
      headers: { host: `${host}:${port}` },
    })

    req.on('connect', (_res, socket) => {
      resolve(socket)
    })
    req.on('error', reject)
    req.end()
  })
}

function collectSocketData(socket: Socket): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    socket.on('close', () => {
      resolve(Buffer.concat(chunks).toString())
    })
  })
}

async function createConfigFile(contents: string, extension: 'json' | 'yaml'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'raffel-reverse-proxy-config-'))
  const filePath = join(directory, `config.${extension}`)
  await writeFile(filePath, contents, 'utf-8')
  tempConfigDirs.add(directory)
  return filePath
}

async function createTempFile(contents: string, extension: 'pem' | 'key' | 'crt' | 'txt'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'raffel-reverse-proxy-tls-'))
  const filePath = join(directory, `artifact.${extension}`)
  await writeFile(filePath, contents, 'utf-8')
  tempConfigDirs.add(directory)
  return filePath
}

describe('Reverse Proxy', () => {
  it('forwards HTTP and CONNECT routes with host, path, and stripPrefix', async () => {
    upstreamA.get('/users', () => ({ status: 200, body: 'users-ok' }))
    upstreamB.get('/status', () => ({ status: 200, body: 'admin-ok' }))

    const config = parseReverseProxyConfig({
      server: { host: '127.0.0.1', port: 0 },
      noMatch: {
        status: 404,
        body: 'not-found',
      },
      routes: [
        {
          match: { host: 'api.internal.test', pathPrefix: '/api', methods: ['GET'] },
          target: `http://127.0.0.1:${upstreamA.port}`,
          name: 'api',
        },
        {
          match: { host: 'api.internal.test', methods: ['CONNECT'] },
          target: `http://127.0.0.1:${upstreamA.port}`,
          name: 'api-connect',
        },
        {
          match: { host: 'admin.internal.test', methods: ['GET'], pathPrefix: '/admin' },
          target: `http://127.0.0.1:${upstreamB.port}`,
          name: 'admin',
        },
      ],
    })

    reverse = await createReverseProxy(config)
    const proxyPort = await reverse.start()

    const response = await fetchViaProxy('/api/users', proxyPort, { host: 'api.internal.test' })
    expect(response.status).toBe(200)
    expect(response.body).toBe('users-ok')

    const adminRoute = await fetchViaProxy('/admin/status', proxyPort, {
      host: 'admin.internal.test',
      'x-bypass': '1',
    })
    expect(adminRoute.status).toBe(200)
    expect(adminRoute.body).toBe('admin-ok')

    const notFound = await fetchViaProxy('/missing', proxyPort, { host: 'unknown.internal.test' })
    expect(notFound.status).toBe(404)
    expect(notFound.body).toBe('not-found')

    const socket = await sendConnect(proxyPort, 'api.internal.test', upstreamA.port)
    const raw = collectSocketData(socket)
    socket.write('GET /users HTTP/1.0\r\nHost: api.internal.test\r\n\r\n')

    const throughTunnel = await raw
    expect(throughTunnel).toContain('200')
    expect(throughTunnel).toContain('users-ok')
  })

  it('loads JSON and YAML config files', async () => {
    upstreamA.get('/json', () => ({ status: 200, body: 'json-ok' }))
    upstreamA.get('/yaml', () => ({ status: 200, body: 'yaml-ok' }))

    const jsonConfig = {
      server: { host: '127.0.0.1', port: 0 },
      routes: [
        {
          match: { host: 'api.internal.test', pathPrefix: '/api' },
          target: `http://127.0.0.1:${upstreamA.port}`,
        },
      ],
    }

    const jsonPath = await createConfigFile(JSON.stringify(jsonConfig, null, 2), 'json')
    const yamlConfig = `
server:
  host: 127.0.0.1
  port: 0
routes:
  - match:
      host: yaml.internal.test
      pathPrefix: /yaml
    target: http://127.0.0.1:${upstreamA.port}
`
    const yamlPath = await createConfigFile(yamlConfig, 'yaml')

    const jsonLoaded = await loadReverseProxyConfig(jsonPath)
    const yamlLoaded = await loadReverseProxyConfig(yamlPath)

    expect(jsonLoaded.routes).toHaveLength(1)
    expect(yamlLoaded.routes).toHaveLength(1)

    reverse = await createReverseProxy(jsonLoaded)
    const proxyPort = await reverse.start()
    const jsonResponse = await fetchViaProxy('/api/json', proxyPort, { host: 'api.internal.test' })
    expect(jsonResponse.status).toBe(200)
    expect(jsonResponse.body).toBe('json-ok')

    await reverse.stop()

    reverse = await createReverseProxy(yamlLoaded)
    const yamlProxyPort = await reverse.start()
    const yamlResponse = await fetchViaProxy('/yaml/yaml', yamlProxyPort, { host: 'yaml.internal.test' })
    expect(yamlResponse.status).toBe(200)
    expect(yamlResponse.body).toBe('yaml-ok')
  })

  it('supports programmatic parsing with methods and wildcard host', async () => {
    upstreamA.get('/public', () => ({ status: 200, body: 'public-ok' }))
    upstreamB.get('/public', () => ({ status: 200, body: 'admin-ok' }))

    const parsed = parseReverseProxyConfig({
      server: { host: '127.0.0.1', port: 0 },
      routes: [
        {
          match: {
            host: ['*.public.internal.test', 'api.public.internal.test'],
            path: '/public',
            methods: ['GET'],
          },
          target: `http://127.0.0.1:${upstreamA.port}`,
        },
        {
          match: { host: '*.admin.internal.test', path: '/public' },
          target: `http://127.0.0.1:${upstreamB.port}`,
        },
      ],
    })

    reverse = await createReverseProxy(parsed)
    const proxyPort = await reverse.start()

    const publicRequest = await fetchViaProxy('/public', proxyPort, {
      host: 'service.public.internal.test',
    })
    expect(publicRequest.status).toBe(200)
    expect(publicRequest.body).toBe('public-ok')

    const blockedMethodResponse = await fetchViaProxy('/public', proxyPort, {
      host: 'service.public.internal.test',
      'x-test-method': 'post',
    }, 'POST')
    expect(blockedMethodResponse.status).toBe(404)

    const adminRequest = await fetchViaProxy('/public', proxyPort, {
      host: 'ops.admin.internal.test',
    })
    expect(adminRequest.status).toBe(200)
    expect(adminRequest.body).toBe('admin-ok')
  })

  it('supports HTTPS listener with inline TLS certificate/key', async () => {
    upstreamA.get('/', () => ({ status: 200, body: 'secure-ok' }))

    const cert = await generateCertificate('127.0.0.1')
    const config = parseReverseProxyConfig({
      server: {
        host: '127.0.0.1',
        port: 0,
        tls: {
          cert: cert.cert,
          key: cert.key,
        },
      },
      routes: [
        {
          match: {
            host: 'secure.internal.test',
            pathPrefix: '/secure',
          },
          target: `http://127.0.0.1:${upstreamA.port}`,
        },
      ],
    })

    reverse = await createReverseProxy(config)
    const proxyPort = await reverse.start()

    const response = await fetchViaProxy(
      '/secure',
      proxyPort,
      { host: 'secure.internal.test' },
      'GET',
      'https',
      true,
    )

    expect(response.status).toBe(200)
    expect(response.body).toBe('secure-ok')
  })

  it('loads TLS certificate and key from files in config', async () => {
    upstreamA.get('/', () => ({ status: 200, body: 'file-cert-ok' }))

    const cert = await generateCertificate('127.0.0.1')
    const certPath = await createTempFile(cert.cert, 'pem')
    const keyPath = await createTempFile(cert.key, 'key')
    const jsonPath = await createConfigFile(
      JSON.stringify(
        {
          server: {
            host: '127.0.0.1',
            port: 0,
            tls: {
              certFile: certPath,
              keyFile: keyPath,
            },
          },
          routes: [
            {
              match: {
                host: 'file.internal.test',
                pathPrefix: '/files',
              },
              target: `http://127.0.0.1:${upstreamA.port}`,
            },
          ],
        },
        null,
        2,
      ),
      'json',
    )

    const loaded = await loadReverseProxyConfig(jsonPath)
    reverse = await createReverseProxy(loaded)
    const proxyPort = await reverse.start()

    const response = await fetchViaProxy(
      '/files',
      proxyPort,
      { host: 'file.internal.test' },
      'GET',
      'https',
      true,
    )

    expect(response.status).toBe(200)
    expect(response.body).toBe('file-cert-ok')
  })

  it('auto-generates TLS certificate/key when not provided', async () => {
    upstreamA.get('/auto', () => ({ status: 200, body: 'auto-cert-ok' }))

    const config = parseReverseProxyConfig({
      server: {
        host: '127.0.0.1',
        port: 0,
        tls: {},
      },
      routes: [
        {
          match: {
            host: 'auto.internal.test',
            path: '/auto',
          },
          target: `http://127.0.0.1:${upstreamA.port}`,
        },
      ],
    })

    reverse = await createReverseProxy(config)
    const proxyPort = await reverse.start()

    const response = await fetchViaProxy(
      '/auto',
      proxyPort,
      { host: 'auto.internal.test' },
      'GET',
      'https',
      true,
    )

    expect(response.status).toBe(200)
    expect(response.body).toBe('auto-cert-ok')
  })
})
