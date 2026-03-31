# Métricas e Grafo de Fluxo

A telemetria de proxy da Raffel gera métricas e snapshots por **aresta de tráfego**.

Cada aresta é identificada por:

- `source`: nó de origem (service name, client IP ou regra customizada)
- `destination`: nó de destino (`host:porta` por padrão)
- `protocol`: protocolo do fluxo

## Métricas exportadas

Quando `telemetry` é habilitado, o collector cria:

- `raffel_proxy_edge_flows_total`
- `raffel_proxy_edge_active_flows`
- `raffel_proxy_edge_bytes_from_source_total`
- `raffel_proxy_edge_bytes_to_source_total`
- `raffel_proxy_edge_requests_total`
- `raffel_proxy_edge_flow_duration_seconds` (+ `_bucket`, `+ _sum`, `+ _count`)
- `raffel_proxy_edge_request_duration_seconds` (+ `_bucket`, `+ _sum`, `+ _count`)
- `raffel_proxy_edge_flow_duration_quantile_seconds`
- `raffel_proxy_edge_errors_total`
- `raffel_proxy_edge_flow_rate_per_second`
- `raffel_proxy_edge_request_rate_per_second`
- `raffel_proxy_edge_error_rate_per_second`
- `raffel_proxy_edge_bytes_from_source_rate_per_second`
- `raffel_proxy_edge_bytes_to_source_rate_per_second`
- `raffel_proxy_edge_failure_ratio`

## Labels por métrica

As labels-base são:

- `source`
- `destination`
- `protocol`

`requests_total` e duração de request também adicionam:

- `method`
- `status`

`errors_total` acrescenta:

- `error`

## Duração (latência)

- `flow_duration_seconds`: duração fim-a-fim do fluxo de conexão.
- `request_duration_seconds`: duração por request dentro do fluxo.
- `flow_duration_quantile_seconds`: percentis de duração do fluxo
  - padrão: `p50`, `p90`, `p95`

Os percentis também aparecem no snapshot do grafo em `snapshot.edges[*].latency.percentiles`.

## Taxas em tempo real

A taxa é calculada em janela deslizante (padrão 60s), com labels de aresta.

Campos disponíveis no snapshot:

- `flowsPerSecond`
- `requestsPerSecond`
- `errorsPerSecond`
- `bytesFromSourcePerSecond`
- `bytesToSourcePerSecond`
- `bytesPerSecond`
- `failureRatio`

`failureRatio` é calculado como:

- `erros / (requests > 0 ? requests : flows)`

## Protocolos usados nas arestas

As arestas também segmentam por protocolo. Os valores atuais incluem:

- `http`, `https`, `connect`
- `ws`, `wss`
- `socks5`, `socks5h`
- `socks5-bind`, `socks5h-bind`
- `socks5-udp`, `socks5h-udp`
- `tcp`

Isso permite separar visualmente tráfego HTTP, TCP e SOCKS em um único grafo.

## Onde consultar

- **Proxy explícito**: endpoints `metricsEndpoint` e `graphEndpoint`
- **Proxy suite**: mesmos endpoints (se informados no `telemetry` da suite)
- **Reverse/Transparent**: `graphSnapshot()` e `metricsRegistry` no runtime. O reverse não expõe `/metrics`/`/proxy/graph` por padrão no mesmo listener porque a URL é reescrita internamente.

Exemplo de integração de consulta PromQL:

```promql
sum by (source, destination, protocol) (rafel_proxy_edge_flow_rate_per_second)
```

```promql
sum by (source, destination, protocol) (raffel_proxy_edge_failure_ratio)
```

```promql
sum by (source, destination, protocol) (raffel_proxy_edge_bytes_from_source_rate_per_second + raffel_proxy_edge_bytes_to_source_rate_per_second)
```

## Recomendação de configuração para service mesh local

- Use `sourceHeader` (ex.: `x-service-name`) para nomear origem por serviço
- Ou `resolveNode` para mapear `clientAddress` e `host` para nomes de negócio
- Use um único coletor para multiple proxies (via `createProxySuite`), para montar grafo de ponta a ponta.
