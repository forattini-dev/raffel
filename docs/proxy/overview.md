# Proxy Toolkit

Esta seção reúne a família de proxies da Raffel em um guia único:

- roteamento HTTP/HTTPS de borda (`createReverseProxy`)
- proxy explícito HTTP/CONNECT/WS (`createExplicitProxy`)
- tunnel HTTPS com inspeção e intercept (`createConnectTunnel` em `mode: 'mitm'`)
- captura/replay de requisições HTTPS (`capture-only`, `replayCapture`)
- proxy SOCKS5 (TCP/UDP) (`createSocks5Proxy`)
- proxy transparente (`createTransparentProxy`)
- suíte unificada (`createProxySuite`)
- middleware unificado para policy, bloqueio e rewrite de request/destino

A ideia é permitir cenários de borda e malha de serviço com a mesma base de telemetria.

Por padrão, **nenhum recurso de observabilidade pesado é ativado automaticamente**.
`telemetry` só é criada quando `telemetry` é informado no modo explícito, SOCKS5,
transparente ou via bloco `proxy` do `createReverseProxy`.

Sem telemetria ativa, você evita:

- criação de registradores de métricas Prometheus,
- coleta de taxas/percentis por aresta,
- geração de grafos de fluxo em memória.

Da mesma forma, **middleware de proxy é opt-in**.
Sem informar `middleware`, os proxies não criam pipeline programático extra para inspeção, bloqueio ou mutação.

## Leitura recomendada por intenção

- **Entender a visão geral da pilha**: [Arquitetura](/proxy/architecture.md)
- **Subir edge HTTP/HTTPS por config**: [Configuração por Arquivo](/proxy/config-file.md) e [Configuração Programática](/proxy/config-code.md)
- **Escolher o tipo de proxy**: [Modos de Proxy](/proxy/modes.md)
- **Entender MITM e replay**: [MITM, captura e reprodução](/proxy/mitm-capture.md)
- **Mapear rotas e reescrita**: [Roteamento](/proxy/routing.md)
- **HTTPS e TLS**: [TLS/HTTPS](/proxy/tls.md)
- **Webhook público (exemplo pronto)**: [Webhook Edge](/guides/webhook-edge.md)
- **Observar tráfego como grafo (origem, destino, protocolo, duração, erros, taxa)**:
  - [Métricas e Grafo de Tráfego](/proxy/flow-metrics.md)
  - [Service Mesh com Proxy Transparente](/proxy/service-mesh.md)
- **Produção e manutenção**: [Operação e Integração](/proxy/operations.md), [Troubleshooting](/proxy/troubleshooting.md)

## Exemplo de bootstrap rápido (reverse)

```ts
import {
  createReverseProxy,
  loadReverseProxyConfig,
  parseReverseProxyConfig,
} from 'raffel'

const reverse = await createReverseProxy({
  server: { host: '0.0.0.0', port: 3000 },
  routes: [],
})

await reverse.start()
```

## Exemplo de observabilidade de tráfego unificada

```ts
import { createProxySuite } from 'raffel'

const suite = createProxySuite({
  explicit: {
    port: 3128,
    host: '0.0.0.0',
  },
  socks5: {
    port: 1080,
    host: '0.0.0.0',
  },
  telemetry: {
    metricsEndpoint: '/metrics',
    graphEndpoint: '/proxy/graph',
    sourceHeader: 'x-service-name',
    percentiles: ['p50', 'p90', 'p95'],
    rateWindowSeconds: 60,
  },
})

await suite.start()
```

O `suite` já mantém um coletor compartilhado, então as arestas de origem→destino podem ser montadas como grafo único.

## Exemplo de policy engine unificado

```ts
import { createExplicitProxy } from 'raffel'

const explicit = createExplicitProxy({
  port: 3128,
  middleware: [
    async (ctx, next) => {
      if (ctx.kind === 'http-request' && ctx.target.host === 'legacy.internal') {
        ctx.target.host = 'legacy-v2.internal'
      }

      if (ctx.kind === 'connect' && ctx.target.port === 25) {
        ctx.blocked = { statusCode: 403, reason: 'SMTP denied at proxy edge' }
        return
      }

      await next()
    },
  ],
})
```

Esse mesmo modelo vale para `http-request`, `http-response`, `mitm-request`, `mitm-response`,
`upgrade-request`, `connect`, `socks5-connect`, `socks5-bind`, `socks5-udp-associate` e `transparent`.
