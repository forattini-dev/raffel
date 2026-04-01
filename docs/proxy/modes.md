# Modos de Proxy

<a id="reverse-proxy"></a>
## Reverse Proxy (`createReverseProxy`)

É o servidor de borda (edge): recebe HTTP/HTTPS e aplica roteamento por `host`, `path` e `methods`.

- **Entradas**: `server`, `routes`, `proxy`
- **Fluxos**: HTTP, CONNECT e upgrade de WebSocket
- **Observabilidade**: telemetria disponível internamente via `graphSnapshot()` e, via configuração explícita de `proxy.telemetry` (caso necessário), via `/metrics` e `/proxy/graph` no listener

```ts
const reverse = await createReverseProxy({
  server: { host: '127.0.0.1', port: 3000 },
  routes: [{ match: { host: 'api.internal.test', pathPrefix: '/v1' }, target: 'http://127.0.0.1:4100' }],
})
```

<a id="explicit-proxy"></a>
## Explicit Proxy (`createExplicitProxy`)

É um proxy HTTP de camada aplicação que une três funcionalidades:

- `http-forward`: requisições HTTP absolutos (proxy estilo navegador/cliente)
- `connect-tunnel`: `CONNECT` para TLS/UDP-like streams
- `upgrade`: WebSocket/upgrade handlers

É o componente base usado por outras estratégias para garantir telemetria e hooks homogêneos.
Também é a base do middleware unificado para `http-request`, `http-response`, `connect`,
`upgrade-request`, `mitm-request` e `mitm-response`.

```ts
const explicit = createExplicitProxy({
  port: 3128,
  host: '127.0.0.1',
  tunnel: {
    mode: 'mitm',
    mitmCapture: {
      mode: 'capture-only',
      file: './logs/requests.ndjson',
    },
  },
  telemetry: {
    metricsEndpoint: '/metrics',
    graphEndpoint: '/proxy/graph',
    sourceHeader: 'x-service-name',
  },
})
```

### HTTPS local com MITM

Quando `tunnel.mode: 'mitm'`, o `createExplicitProxy` pode inspecionar conexões TLS.

`connect` é feito em túnel HTTPS com certificado gerado pelo próprio proxy (`caCert`) e
terminado localmente para permitir inspeção de request/response, regras de hook e captura.

Exemplo de captura local sem repassar:

```ts
const explicit = createExplicitProxy({
  port: 3128,
  tunnel: {
    mode: 'mitm',
    mitmCapture: {
      enabled: true,
      mode: 'capture-only', // não encaminha para upstream
      file: './capture/requests.ndjson',
    },
  },
})
await explicit.start()
```

Para repassar (com validações/hooks) e ainda gravar:

```ts
explicit.tunnel.startCapture({
  file: './capture/requests.ndjson',
  mode: 'passthrough',
})
```

Para reproduzir depois:

```ts
const summary = await explicit.tunnel.replayCapture({
  file: './capture/requests.ndjson',
  timeoutMs: 15_000,
  rejectUnauthorized: false,
})
```

<a id="socks5-proxy"></a>
## SOCKS5 Proxy (`createSocks5Proxy`)

Servidor SOCKS5 standalone com autenticação opcional, suporte a:

- `CONNECT`
- `BIND`
- `UDP ASSOCIATE`
- IPv4, IPv6 e hostname

É útil para clientes legacy, ambientes corporativos e cenários de observabilidade de TCP/UDP não HTTP.

```ts
const socks5 = createSocks5Proxy({
  port: 1080,
  host: '0.0.0.0',
  telemetry: {
    sourceHeader: 'x-service-name',
  },
})
```

O SOCKS5 também participa do middleware unificado nos eventos `socks5-connect`,
`socks5-bind` e `socks5-udp-associate`. Nesses contextos você pode bloquear conexão,
anexar metadata e reescrever `ctx.target.host` / `ctx.target.port` antes do dial.

<a id="transparent-proxy"></a>
## Transparent Proxy (`createTransparentProxy`)

Intercepta TCP no kernel para preservar destino original sem configuração no cliente.

- `mode: 'tproxy'` (padrão): requer `IP_TRANSPARENT` e privilégios (`CAP_NET_ADMIN`)
- `mode: 'redirect'`: modo fallback sem resolução completa de destino original
- telemetria com protocolo de aresta `tcp`

```ts
const transparent = createTransparentProxy({
  port: 15000,
  host: '0.0.0.0',
  mode: 'tproxy',
  telemetry: {
    sourceHeader: 'x-service-name',
    rateWindowSeconds: 30,
  },
})
```

O modo transparente também aceita `middleware` para policy no nível de conexão e rewrite
do destino original antes do encaminhamento.

<a id="proxy-suite"></a>
## Proxy Suite (`createProxySuite`)

Agrupa explicit + socks5 com coletor único de telemetria e snapshots.

Use quando você precisa de:

- `explicit` (HTTP/HTTPS/CONNECT/WS)
- `socks5`
- métricas e grafo consolidados (`suite.graphSnapshot()`)

```ts
const suite = createProxySuite({
  explicit: { port: 3128, host: '127.0.0.1' },
  socks5: { port: 1080, host: '127.0.0.1' },
  telemetry: {
    sourceHeader: 'x-service-name',
    percentiles: ['p50', 'p90', 'p95'],
  },
})
```

Ao usar `createProxySuite`, você evita dois exporters diferentes e melhora o grafo de origem/destino no mesmo namespace operacional.

## Middleware unificado entre modos

Todos os proxies compartilham uma superfície programável comum:

- `ctx.kind`: fase do fluxo
- `ctx.proxy`: origem do runtime (`reverse`, `explicit`, `socks5`, `transparent`, etc.)
- `ctx.target`: host/porta/protocolo de destino
- `ctx.request` / `ctx.response`: quando o fluxo é HTTP ou MITM
- `ctx.blocked`: forma padrão de barrar fluxo

Exemplo:

```ts
const reverse = await createReverseProxy({
  server: { host: '127.0.0.1', port: 3000 },
  routes: [{ match: { host: 'api.internal.local', pathPrefix: '/' }, target: 'http://127.0.0.1:4100' }],
  proxy: {
    middleware: [
      async (ctx, next) => {
        if (ctx.kind === 'http-request') {
          ctx.request.headers['x-mesh-node'] = 'edge-a'
        }

        if (ctx.kind === 'mitm-response' && ctx.response) {
          ctx.response.headers['x-inspected-by'] = 'raffel'
        }

        if (ctx.target.host.endsWith('.shadow.internal')) {
          ctx.blocked = { statusCode: 403, reason: 'shadow traffic disabled' }
          return
        }

        await next()
      },
    ],
  },
})
```

Limites atuais:

- `reverse`, `explicit` e `MITM` permitem mutação completa de request/response.
- `socks5` e `transparent` trabalham no nível de conexão, com bloqueio, metadata e rewrite de destino.
