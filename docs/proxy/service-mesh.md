# Service Mesh com Proxy Raffel

O objetivo não é substituir um control plane completo. A ideia é usar a Raffel como **camada de telemetria ativa e roteamento** para montar observabilidade de malha entre serviços que não exigem sidecar em todos os nós.

## Arquitetura recomendada

1. **Edge / entrada HTTP** com `createReverseProxy`
   - roteamento por host/path/método para aplicações HTTP e WebSocket.
2. **East-West e legacy transparente** com `createTransparentProxy`
   - captura tráfego TCP real sem mudanças no cliente.
3. **Saídas externas e cenários especiais** com `createExplicitProxy` + `createSocks5Proxy`
   - cobre HTTP/CONNECT/WS/SOCKS com métricas e grafo.
4. **Collector único** com `createProxySuite` ou coletor compartilhado via `telemetry.collector`
   - consolida `source`, `destination`, `protocol` em um único grafo.

```ts
import { createProxySuite, createTransparentProxy } from 'raffel'

const suite = createProxySuite({
  explicit: {
    port: 3128,
    host: '127.0.0.1',
    telemetry: {
      sourceHeader: 'x-service-name',
      percentiles: ['p50', 'p90', 'p95'],
      rateWindowSeconds: 60,
    },
  },
  socks5: {
    port: 1080,
    host: '127.0.0.1',
    telemetry: {
      sourceHeader: 'x-service-name',
    },
  },
  telemetry: {
    sourceHeader: 'x-service-name',
    percentiles: ['p50', 'p90', 'p95'],
    rateWindowSeconds: 60,
  },
})

const transparent = createTransparentProxy({
  port: 15006,
  host: '0.0.0.0',
  mode: 'tproxy',
  telemetry: {
    sourceHeader: 'x-service-name',
  },
})

await suite.start()
await transparent.start()
```

## Grafo como modelo de relatório estilo Istio

Em `suite.graphSnapshot()` e `transparent.graphSnapshot()`, cada aresta segue esse eixo:

- `source` (serviço origem)
- `destination` (serviço destino)
- `protocol` (ex.: `http`, `connect`, `ws`, `socks5h`, `tcp`)

Com isso você consegue construir os mesmo tipos de painel de malha:

- **Traffic flow**: `source` → `destination` por `protocol`.
- **Latência**: `request_duration_seconds` e percentis (`p50`, `p90`, `p95`).
- **Taxa de erro**: `failureRatio`, `error_rate` e série de `errors_total`.
- **Volume**: `bytesFromSourceRate`, `bytesToSourceRate`, `bytesRate`.

## Transparência + identidade semântico-negócio

Em `createTransparentProxy`, o protocolo padrão da aresta é `tcp`.
Use `resolveOriginalDestination` (modo teste) e `resolveNode` para mapear endereços reais em nomes de serviço.

```ts
import { createTransparentProxy } from 'raffel'

const transparent = createTransparentProxy({
  port: 15006,
  mode: 'tproxy',
  telemetry: {
    sourceHeader: 'x-service-name',
    resolveNode(ctx) {
      if (ctx.role === 'source' && ctx.clientAddress) return ctx.clientAddress
      if (ctx.role === 'destination' && ctx.host && ctx.port) return `${ctx.host}:${ctx.port}`
      return 'unknown'
    },
  },
})
```

## Exemplos de arestas

- `edge-frontend -> tcp -> postgres.internal:5432` (transparente)
- `edge-frontend -> http -> svc-auth` (reverse por host/path)
- `svc-api -> connect -> partner.api:443` (túnel HTTPS)
- `svc-gateway -> socks5h -> legacy.partner.net:3128` (SOCKS5H)

## Métricas críticas para operação

- taxa de erro em tempo real: `error_rate` e `failure_ratio`
- duração e picos: `request_duration_seconds` + percentis
- throughput: `request_rate`, `flow_rate`, `bytes` por segundo
- health da malha: `active_flows`, fluxos ativos por nó

Quando você tem reverse + explicit + socks5 + transparente, use `createProxySuite` + `transparent.graphSnapshot()` para consolidar o estado entre camadas.

## Limitações importantes

- `createReverseProxy` não expõe automaticamente `/metrics` e `/proxy/graph` no mesmo listener HTTP do roteamento; prefira exposição via `graphSnapshot()` ou um endpoint administrativo dedicado.
- `createTransparentProxy` em `redirect` é fallback sem visibilidade plena de destino em todos os cenários de kernel.
- Certificado TLS, política e service discovery continuam fora da responsabilidade dessa camada, salvo integrações externas.
