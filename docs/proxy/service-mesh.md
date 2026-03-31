# Service Mesh com Proxy Transparente

O objetivo aqui não é substituir um service mesh completo (control plane, policy e discovery), mas usar o Raffel como **camada de observabilidade e roteamento de tráfego** para malhas existentes ou transição para uma malha.

## Arquitetura recomendada

1. **Edge / entrada HTTP** com `createReverseProxy`
   - roteia por host/path para os serviços do domínio
2. **Fluxo east-west** com `createTransparentProxy`
   - captura tráfego TCP real sem alterar clientes
3. **Saídas externas e legado** com `createExplicitProxy` + `createSocks5Proxy`
   - mantém telemetria uniforme para serviços heterogêneos
4. **Collector único** com `createProxySuite` ou configuração comum
   - consolida `source`, `destination`, `protocol` em um único grafo

```ts
const suite = createProxySuite({
  explicit: {
    port: 3128,
    host: '127.0.0.1',
    telemetry: {
      sourceHeader: 'x-service-name',
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
    percentiles: ['p50', 'p90', 'p95'],
    rateWindowSeconds: 60,
  },
})
```

## Transparente e identificação de origem/destino

- Em `createTransparentProxy`, o protocolo da aresta é `tcp`.
- O destino pode ser resolvido por kernel (`TPROXY`) ou por callback customizado em ambiente de teste/integração.
- Para enriquecer origem e destino, use `resolveNode` e/ou `sourceHeader`.

```ts
createTransparentProxy({
  port: 15006,
  mode: 'redirect',
  telemetry: {
    sourceHeader: 'x-service-name',
    resolveNode(ctx) {
      if (ctx.role === 'source') return ctx.clientAddress ?? 'unknown'
      if (ctx.role === 'destination' && ctx.port) {
        return `${ctx.host}:${ctx.port}`
      }
      return ctx.host
    },
  },
})
```

## Montagem do grafo origem→destino

Você pode montar dashboards com:

- `source` (nó A)
- `destination` (nó B)
- `protocol` (canal da aresta)

Exemplo de fluxo:

`svc-gateway -> http -> svc-api` (HTTP)

`svc-worker -> tcp -> db.internal:5432` (TCP transparente)

`svc-legacy -> socks5h -> external.api:443` (SOCKS5h)

## Métricas para acompanhar em produção

- `flows` e `requests` totais por aresta
- `bytesFromSource` / `bytesToSource`
- `errors` + `failureRatio`
- `flow duration` e `request duration` (e percentis p50/p90/p95)
- taxas em janela: `flow_rate`, `request_rate`, `error_rate`, `bytes rate`

Para o mesmo serviço com múltiplos protocolos, compare as cores por `protocol` para detectar gargalos.

## Limitações importantes

- O reverse proxy (`createReverseProxy`) não expõe `/metrics`/`/proxy/graph` como endpoint primário se o request interno já for tratado internamente; use `graphSnapshot()` ou proxy separado.
- Em ambientes sem privilégio de kernel, `createTransparentProxy` funciona em modo `redirect` como fallback.
- TTL de política e sincronização de certificados ainda continuam fora da camada de proxy atual.
