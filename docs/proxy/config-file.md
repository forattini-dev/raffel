# Configuração por Arquivo (Reverse Proxy)

Você pode definir as regras do `ReverseProxy` em `.json` ou `.yaml` e carregar com `loadReverseProxyConfig`.

Este arquivo documenta somente o modo de borda HTTP/HTTPS (`createReverseProxy`).

## API

```ts
import {
  loadReverseProxyConfig,
  createReverseProxy,
} from 'raffel'

const config = await loadReverseProxyConfig('./infra/reverse-proxy.yaml')
const reverse = await createReverseProxy(config)
await reverse.start()
```

## Telemetria é opt-in

Se `proxy.telemetry` não for configurado no arquivo, o proxy sobe sem:

- registradores Prometheus,
- buffers de estado de grafo em memória,
- endpoints internos de `/metrics` e `/proxy/graph`.

Isso mantém o proxy mais leve para cenários em que só roteamento é necessário.

## Formato aceito

- `.json` é tratado como JSON.
- outros nomes: detecta JSON por início de conteúdo `{` ou `[`; caso contrário interpreta YAML.

Com `server.tls` presente, `createReverseProxy` já sobe HTTPS. Se você não informar `cert`/`key`, eles são gerados automaticamente (auto-signed).

## Estrutura mínima

```json
{
  "server": { "host": "0.0.0.0", "port": 3000 },
  "routes": []
}
```

`routes` é obrigatório e precisa ter ao menos 1 entrada.

Exemplo mínimo com HTTPS automático (sem certificado explícito):

```yaml
server:
  host: 127.0.0.1
  port: 3443
  tls: {}
routes:
  - match:
      host: "*.internal.test"
      path: /health
    target: http://127.0.0.1:4100
```

## Exemplo JSON completo

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000
  },
  "routes": [
    {
      "name": "api-v1",
      "match": {
        "host": "api.internal.local",
        "pathPrefix": "/v1"
      },
      "target": "http://127.0.0.1:4100"
    }
  ],
  "proxy": {
    "auth": {
      "credentials": {
        "username": "admin",
        "password": "secret"
      }
    },
    "telemetry": {
      "sourceHeader": "x-service-name",
      "percentiles": [0.5, 0.9, 0.95],
      "metricsEndpoint": "/metrics",
      "graphEndpoint": "/proxy/graph"
    }
  }
}
```

## Exemplo YAML completo

```yaml
server:
  host: 0.0.0.0
  port: 3000
routes:
  - name: admin-catchall
    match:
      host:
        - admin.internal.local
        - "*.admin.internal.local"
      pathPrefix: /admin
    target: http://127.0.0.1:4200
  - name: admin-health
    match:
      host: admin.internal.local
      path: /health
    target: http://127.0.0.1:4201
    stripPrefix: false
```

## Campos mais importantes

### `server`

- `host` / `port` (ou `root host/port` legado no mesmo parser)
- `tls` (objeto opcional para HTTPS listener)
  - `tls: {}` ativa HTTPS com certificado automático
  - `tls: { cert: '...', key: '...' }` usa certificado inline
  - `tls: { certFile: '...', keyFile: '...' }` usa caminhos de arquivo

### `routes`

- cada entrada define `match` + `target` (+ `stripPrefix` opcional)
- `target` precisa ser URL absoluta (`http://...` ou `https://...`)

### `proxy`

- `auth`, `filter`, `forward`, `tunnel`, `upgrade`, `telemetry`

São as mesmas categorias do `createExplicitProxy`, reaproveitadas pelo reverse proxy.

## Boas práticas de arquivo

- Versione arquivos em repositório Git e aplique revisão por pull request.
- Separe ambientes (`local`, `staging`, `prod`) para validar mudanças controladamente.
- Comece com `noMatch` explícito para reduzir comportamento default.
