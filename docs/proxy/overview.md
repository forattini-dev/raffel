# Proxy Toolkit

Esta seção reúne a família de proxies da Raffel em um guia único:

- roteamento HTTP/HTTPS de borda (`createReverseProxy`)
- proxy explícito HTTP/CONNECT/WS (`createExplicitProxy`)
- proxy SOCKS5 (TCP/UDP) (`createSocks5Proxy`)
- proxy transparente (`createTransparentProxy`)
- suíte unificada (`createProxySuite`)

A ideia é permitir cenários de borda e malha de serviço com a mesma base de telemetria.

## Leitura recomendada por intenção

- **Entender a visão geral da pilha**: [Arquitetura](/proxy/architecture.md)
- **Subir edge HTTP/HTTPS por config**: [Configuração por Arquivo](/proxy/config-file.md) e [Configuração Programática](/proxy/config-code.md)
- **Escolher o tipo de proxy**: [Modos de Proxy](/proxy/modes.md)
- **Mapear rotas e reescrita**: [Roteamento](/proxy/routing.md)
- **HTTPS e TLS**: [TLS/HTTPS](/proxy/tls.md)
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
