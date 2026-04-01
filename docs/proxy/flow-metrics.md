# Métricas e Grafo de Fluxo de Proxy

A telemetria de proxy da Raffel gera métricas e snapshots por **aresta de tráfego**.

Observação de consumo: `createExplicitProxy`, `createSocks5Proxy` e `createTransparentProxy` só criam telemetria quando `telemetry` é passado explicitamente. Sem isso, o custo de runtime de métricas é zero.

Cada aresta é identificada por:

- `source`: nó de origem (service name, client IP ou regra customizada)
- `destination`: nó de destino (`host:porta` por padrão)
- `protocol`: protocolo do fluxo

## O que é uma aresta

Em service mesh de observabilidade, a aresta é o triplo:

- `source`
- `destination`
- `protocol`

Essa combinação vira o identificador único do relacionamento `source -> destination -> protocol`.

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

Para `request_duration_seconds`, use o padrão PromQL:

```promql
histogram_quantile(
  0.95,
  sum by (le, source, destination, protocol) (
    rate(raffel_proxy_edge_request_duration_seconds_bucket[5m])
  )
)
```

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

- `errors / (requests > 0 ? requests : flows)`

## Protocolos usados nas arestas

As arestas também segmentam por protocolo. Os valores atuais incluem:

- `http`, `https`, `connect`
- `ws`, `wss`
- `socks5`, `socks5h`
- `socks5-bind`, `socks5h-bind`
- `socks5-udp`, `socks5h-udp`
- `tcp`

Isso permite separar visualmente tráfego HTTP, CONNECT/TLS, WS/WSS, SOCKS e TCP em um único grafo.

## Onde consultar

### Exportação de métricas

- **Explicit / Suite**: endpoints HTTP:
  - `metricsEndpoint` (padrão `/metrics`)
  - `graphEndpoint` (padrão `/proxy/graph`)
- **createReverseProxy + suite de telemetria compartilhada**: expõe conforme `proxy.telemetry` e pode manter telemetria agregada com explicit/socks5/tcp.
- **Transparent**: não expõe HTTP endpoint para métricas; use `metricsRegistry` e `graphSnapshot()` no runtime.

Exemplo de integração de consulta PromQL:

```promql
sum by (source, destination, protocol) (rate(raffel_proxy_edge_flow_rate_per_second[1m]))
```

```promql
sum by (source, destination, protocol) (rate(raffel_proxy_edge_request_rate_per_second[1m]))
```

```promql
sum by (source, destination, protocol) (rate(raffel_proxy_edge_errors_total[1m]))
/
clamp_min(
  sum by (source, destination, protocol) (rate(raffel_proxy_edge_requests_total[1m])),
  1
)
```

```promql
sum by (source, destination, protocol) (
  rate(raffel_proxy_edge_bytes_from_source_rate_per_second[1m] + raffel_proxy_edge_bytes_to_source_rate_per_second[1m])
)
```

```promql
avg by (source, destination, protocol) (raffel_proxy_edge_failure_ratio)
```

## Recomendação de configuração para service mesh local

- Use `sourceHeader` (ex.: `x-service-name`) para nomear origem por serviço.
- Use `resolveNode` para enriquecer origem/destino com nomes de negócio.
- Defina `percentiles` em números ou strings (`0.5`/`p50`, `0.9`/`p90`, `0.95`/`p95`).
- Defina `rateWindowSeconds` para taxas mais responsivas ou mais estáveis.
- Use um único coletor para múltiplos proxies (via `createProxySuite`), para montar grafo de ponta a ponta.
