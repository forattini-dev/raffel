# Operação e Integração

## Ciclo de vida em runtime

```ts
import { createReverseProxy } from 'raffel'

const reverse = await createReverseProxy(config)

const port = await reverse.start()   // cria listener + rota
await reverse.stop(8_000)           // para com timeout de drenagem
```

Propriedades disponíveis:

- `isRunning`
- `boundPort`
- `config` (config já normalizada)
- `stats` (somatório do fluxo HTTP/CONNECT/upgrade)
- `caCert` (CA para modo MITM do túnel explícito)
- `graphSnapshot()` (grafo de fluxo para debug/observabilidade)

`start()` também funciona com `server.port = 0` para bind dinâmico; retorna a porta real.

## Arquitetura de integração com o ecossistema de proxy

O `ReverseProxy` é uma camada de roteamento sobre o `createExplicitProxy`.  
Dentro dele já rodam:

- `createHttpForwardProxy`
- `createConnectTunnel`
- fluxo de `upgrade` (WebSocket)

Isso significa:

- Você mantém uma só linguagem de `auth`, `filter`, `telemetry`, timeouts e hooks;
- `stats` e telemetria são compartilhadas com a base de proxy existente;
- Você não perde recursos já implementados para forward/CONNECT.

### Integração com observabilidade

`createExplicitProxy` suporta endpoints internos de telemetria por HTTP (`/metrics`, `/proxy/graph`) quando usado diretamente, mas no `ReverseProxy` o `req.url` é reescrito para URL absoluta antes de repassar ao `httpProxy.requestHandler`, então esses endpoints do fluxo explícito não ficam expostos automaticamente.

Para painel único de origem/destino com múltiplos modos, use [Métricas e Grafo de Fluxo](/proxy/flow-metrics.md).

Padrão recomendado:

- usar `reverse.graphSnapshot()` e `reverse.stats` para inspeção programática,
- ou manter um gateway administrativo separado para coletar métricas HTTP do proxy explícito.

### Consolidação em Service Mesh local

Quando houver `createTransparentProxy` e `createProxySuite` no mesmo ambiente, consolide um único coletor para:

- fluxos HTTP/HTTPS/CONNECT/WS (`http`, `https`, `connect`, `ws`, `wss`)
- fluxos SOCKS (`socks5*`)
- fluxos de rede transparência (`tcp`)

Consulte [Service Mesh com Proxy Transparente](/proxy/service-mesh.md).

## Deploy local com subdomínios e paths

Fluxo comum para substituir Traefik em ambiente local:

1. Mapeie subdomínios em `/etc/hosts` para `127.0.0.1`.
2. Crie regras em arquivo (`.yaml`/`.json`) separadas por app e ambiente.
3. Ative HTTPS no listener com cert local.
4. Defina as rotas por `host` + `pathPrefix`.
5. Use `stripPrefix: false` nos endpoints sensíveis para manter o path original.

Exemplo de árvore de configuração:

- `api.internal.test` -> `/v1/*` -> App A (`/api` interno)
- `admin.internal.test` -> `/health` -> endpoint de status
- `api.internal.test` -> `/ws/*` -> WebSocket backend

## Quando usar `loadReverseProxyConfig` vs `parseReverseProxyConfig`

- `loadReverseProxyConfig(path)`:
  - carregamento de JSON/YAML de disco;
  - ideal para CD/infra como código.
- `parseReverseProxyConfig(raw)`:
  - validação em memória;
  - ideal para bootstrap com variável de ambiente, tests e geração dinâmica.

## Estratégia para ambientes com Mesh/Service Layer

Mesmo com service mesh ativo, o `ReverseProxy` funciona como edge HTTP/WS/CNN:

- roteia para um gateway interno da malha,
- ou para serviços finais que estão atrás de sidecars,
- sem conflito com mesh sidecar no host, desde que as portas e DNS estejam coerentes.

Padrão sugerido:

- edge do mesh aponta para `ReverseProxy` quando quiser centralizar regras de entrada.
- use rotas por `host` para preservar isolamento por aplicação.
- se precisar de políticas de malha avançadas, mantenha-as no router/service da malha e use o reverse apenas para borda.

## Migração prática de configuração já existente

1. Extraia rotas atuais em YAML/JSON.
2. Converta regra por regra:
   - Traefik `PathPrefix` → `pathPrefix`
   - Traefik `Rule(\`Host\`)` → `host`
3. Teste cada app com `--host` no curl ou inspecionando header.
4. Valide `CONNECT`/WS para fluxos persistentes.
5. Só depois de aprovação funcional, mova DNS/Load Balancer para esse proxy.

## Boas práticas operacionais

- versionar arquivos de proxy no repositório,
- manter ambientes: `local`, `staging`, `prod`,
- revisar ordem de rotas em revisão de PR (ordem importa),
- registrar `noMatch` padrão em todos os ambientes para evitar vazamento de comportamento padrão.
