# Roteamento

## Matchers disponíveis

### `host`

Aceita string ou array de strings.

- exato: `api.internal.local`
- wildcard prefix: `*.internal.local`

O wildcard casa:
- `admin.internal.local`
- `*.admin.internal.local`
- e também o domínio raiz `admin.internal.local` no matcher `*.admin.internal.local` (implementação atual).

### `path`, `pathPrefix` e `methods`

- `path`: match exato após normalização de `/`.
- `pathPrefix`: match por prefixo de caminho.
- `path` com `*`: glob simples convertido em regex (`*` -> `.*`).
- sem path/prefix: casa tudo (`all`).
- `methods`: string única ou array. Se omitido, aceita qualquer método.

## Regras de precedência

- `pathPrefix` vence quando ambos estão presentes.
- A rota escolhida é sempre a primeira que casar ao percorrer `routes` na ordem declarada.

## `stripPrefix` e construção final de path

- `stripPrefix: false` => não remove prefixo.
- `stripPrefix: '/base'` => remove esse prefixo.
- omitido + `pathPrefix` definido => remove automaticamente `pathPrefix`.
- omitido + sem `pathPrefix` => não remove.

Exemplo:

- rota: `pathPrefix: '/api'`, `target: http://127.0.0.1:4100/base`, request `/api/users`
- destino final: `http://127.0.0.1:4100/base/users`

## Roteamento por método

O matcher de método é aplicado usando os métodos em `req.method`.

Use isso para separar rotas com mesmo host/path por verbo:

- `GET /admin` para leitura
- `POST /admin` para escrita

## CONNECT e WS

### CONNECT

Para `CONNECT` a resolução ocorre com:
- host do target solicitado (ex.: `svc.internal:443`)
- path fixo `/`

Depois o handler do connect-tunnel faz o túnel para o `target` configurado.

### Upgrade

- o protocolo de destino é `ws` ou `wss` conforme socket TLS
- path também participa do matcher
- após seleção da rota, path é reescrito e enviado ao handler de upgrade

## Padrões de roteamento para Traefik-like

### Subdomínios isolados

```json
{"match":{"host":"api.internal.local","pathPrefix":"/v1"}}
```

### Mesmo host, caminhos distintos

```json
{"match":{"host":"app.internal.local","pathPrefix":"/v1"}}
{"match":{"host":"app.internal.local","path":"/health"},"stripPrefix":false}
```

## Erros de roteamento

- `No route matched` (404 customizado via `noMatch`):
  - host não definido
  - path não confere
  - método não está na lista

