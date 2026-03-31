# Configuração Programática (Reverse Proxy)

Além de arquivo, você pode montar a configuração em código e já validar com `parseReverseProxyConfig` antes de subir o listener.

Este arquivo documenta somente o modo de borda HTTP/HTTPS (`createReverseProxy`).

## API

```ts
import {
  parseReverseProxyConfig,
  createReverseProxy,
} from 'raffel'

const config = parseReverseProxyConfig({
  server: { host: '127.0.0.1', port: 0 },
  routes: [
    {
      match: { host: 'api.internal.local', pathPrefix: '/v1' },
      target: 'http://127.0.0.1:4100',
    },
  ],
})

const reverse = await createReverseProxy(config)
await reverse.start()
```

## TLS com certificado automático

```ts
const reverse = await createReverseProxy(parseReverseProxyConfig({
  server: {
    host: '127.0.0.1',
    port: 3443,
    tls: {}, // gera cert/key automaticamente
  },
  routes: [
    {
      match: { host: 'local.internal.test', pathPrefix: '/' },
      target: 'http://127.0.0.1:4100',
    },
  ],
}))
```

## Exemplo real com mix de regras

```ts
const reverse = await createReverseProxy(parseReverseProxyConfig({
  server: { host: '0.0.0.0', port: 8080 },
  noMatch: { status: 404, body: JSON.stringify({ error: 'no route' }) },
  routes: [
    {
      name: 'admin-api',
      match: {
        host: ['admin.internal.local', '*.admin.internal.local'],
        pathPrefix: '/api',
        methods: ['GET', 'POST'],
      },
      target: 'http://127.0.0.1:4100',
    },
    {
      name: 'admin-health',
      match: {
        host: ['admin.internal.local', '*.admin.internal.local'],
        path: '/health',
      },
      target: 'http://127.0.0.1:4101',
      stripPrefix: false,
    },
    {
      name: 'ws-public',
      match: {
        host: 'ws.internal.local',
        path: '/ws',
      },
      target: 'http://127.0.0.1:4102',
    },
    {
      name: 'connect-tunnel',
      match: {
        host: 'api.internal.local',
        methods: ['CONNECT'],
      },
      target: 'http://127.0.0.1:4103',
    },
  ],
  proxy: {
    auth: {
      credentials: { username: 'admin', password: 'secret' },
    },
    filter: {
      allowHosts: ['admin.internal.local', 'api.internal.local'],
      denyTLDs: ['ru'],
    },
    forward: {
      timeout: 20_000,
      maxBodySize: 4 * 1024 * 1024,
    },
    tunnel: {
      mode: 'forward',
    },
    telemetry: {
      sourceHeader: 'x-service-name',
      percentiles: [0.5, 0.9, 0.95],
    },
  },
}))
```

## Diferença entre parse e create

- `parseReverseProxyConfig(raw)`:
  - valida e normaliza, retorna config carregada.
- `createReverseProxy(config)`:
  - cria runtime, ainda não inicia.
- `start()`:
  - sobe listener.

## Dica para bootstrap

Use:

```ts
const config = parseReverseProxyConfig(rawFromEnv || fileParsed)
const reverse = await createReverseProxy(config)
await reverse.start()
```

Assim você valida cedo e só sobe se a config estiver consistente.
