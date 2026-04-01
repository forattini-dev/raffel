# MITM, Capture e Replay (Connect Tunnel)

O túnel CONNECT do Raffel suporta dois modos:

- `forward`: encaminhamento TLS bruto (comportamento clássico de proxy)
- `mitm`: terminação TLS local, inspeção de payload e manipulação opcional

Em `mitm`, você pode gravar e reproduzir requisições HTTPS do mesmo jeito que um ambiente de
teste de proxy de integração ou observabilidade de tráfego exige.

## O que é útil para substituir Traefik localmente

Para cenários de simulação de ambiente local (certificados self-signed, vários hosts/subdomínios,
paths separados, regras por host/path), use:

- `createReverseProxy` para roteamento por host/path/método (`connect` e WebSocket incluídos)
- arquivos `.json/.yaml` ou código com `loadReverseProxyConfig` / `parseReverseProxyConfig`
- `createExplicitProxy` com `tunnel.mode: 'mitm'` para inspeção HTTPS local

## API (MITM no explicit)

No modo `mitm`, você pode combinar:

- `onRequest` / `onResponse` para hooks pontuais
- `middleware` com fases `mitm-request` e `mitm-response`
- `mitmCapture` para persistência e replay
- `validate` para validação do payload antes do upstream

```ts
import {
  createExplicitProxy,
  createConnectTunnel,
} from 'raffel'

const explicit = createExplicitProxy({
  port: 3128,
  middleware: [
    async (ctx, next) => {
      if (ctx.kind === 'mitm-request') {
        ctx.request.headers['x-mitm'] = 'true'
      }
      await next()
    },
  ],
  tunnel: {
    mode: 'mitm',
    mitmCapture: {
      enabled: true,
      file: './tmp/capture.ndjson',
      mode: 'capture-only',
    },
  },
})

await explicit.start()
```

Use `middleware` quando quiser uma pipeline compartilhada entre reverse, explicit, MITM,
SOCKS5 e transparent. Use `onRequest` / `onResponse` quando quiser apenas um hook dedicado
ao fluxo HTTPS interceptado.

Ou iniciando a captura em runtime:

```ts
const tunnel = explicit.tunnel
tunnel.startCapture({
  file: './tmp/capture.json', // pode ser NDJSON ou array JSON
  mode: 'passthrough',
})
```

## Formato de captura

Cada linha NDJSON contém um registro:

```json
{
  "id": "uuid",
  "capturedAt": "2026-03-31T12:00:00.000Z",
  "host": "127.0.0.1",
  "port": 443,
  "method": "GET",
  "path": "/health",
  "headers": {
    "user-agent": "..."
  },
  "bodyBase64": "base64..."
}
```

Também aceitamos um `array JSON` com vários objetos (sem quebra de linha) se preferir exportar/importar lotes.

## Replay

```ts
const summary = await tunnel.replayCapture({
  file: './tmp/capture.ndjson',
  timeoutMs: 20_000,
  rejectUnauthorized: false,
})
```

Exemplo de resposta:

```ts
{
  "total": 3,
  "success": 3,
  "failed": 0,
  "durationMs": 42,
  "entries": [
    { "id": "...", "host": "127.0.0.1", "port": 443, "status": 200, "ok": true }
  ]
}
```

## HTTPS local com certificado automático

Para teste local, o modo MITM gera `caCert` automaticamente:

```ts
const explicit = createExplicitProxy({
  port: 3128,
  tunnel: { mode: 'mitm' },
})
console.log(explicit.caCert) // pem do CA do proxy
```

Você pode usar `rejectUnauthorized: false` no cliente para reduzir fricção local.

Em produção, prefira certificados persistentes e confiança explícita da cadeia.

## Regras de roteamento por host/path (Traefik-like)

Para substituir padrões por subdomínio e path:

- subdomínio diferente + mesmo path:
  - `appA.example.local/users` → serviço A
  - `appB.example.local/users` → serviço B
- mesmo subdomínio + path diferente:
  - `api.example.local/api/*`
  - `api.example.local/admin/*`

Hoje isso fica mais robusto no `createReverseProxy` (arquivo JSON/YAML ou código),
porque o CONNECT/mitm lida com tráfego já direcionado pelo cliente para host:porta.

## Observações

- `capture-only`:
  - grava e retorna `202` sem repassar a requisição.
- `passthrough`:
  - grava e continua o fluxo normal.
- `getCaptureState()`:
  - estado atual (`enabled`, `mode`, `file`, `captured`, `replayed`, `lastCaptureAt`)

Isso permite cenários de "reserva de requests" e replay controlado sem bloquear a produção em tempo real.
