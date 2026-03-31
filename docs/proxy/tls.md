# HTTPS e TLS no Reverse Proxy

## O que o `ReverseProxy` cobre em TLS hoje

- O listener do `createReverseProxy` pode subir em HTTP (`.tls` ausente) ou HTTPS (`.tls` presente).
- O TLS da borda termina no listener do reverse proxy; o `target` dos `routes` continua podendo ser `http` ou `https` conforme necessário.
- O proxy explícito interno (forward/CONNECT/upgrade) continua usando as opções que você passar em `proxy`.

## Configuração de listener

`server.tls` segue a interface `ReverseProxyServerTlsConfig`.

- `cert` / `key`: certificados inline.
- `certFile` / `keyFile`: arquivos PEM no disco.
- `ca` / `caFile`: CA chain opcional (string única ou array).
- `requestCert` e `rejectUnauthorized`: controle de mTLS no listener.
- `minVersion` / `maxVersion`: `TLSv1`, `TLSv1.1`, `TLSv1.2`, `TLSv1.3`.
- `enabled: false`: força desativar TLS mesmo com chave/cert carregados.
- Se `server.tls` existir e `cert`/`key` não forem informados, o proxy gera automaticamente um certificado autoassinado para facilitar ambiente local.

Observação prática:

- `.tls` ausente → HTTP.
- `server.tls` com `cert`/`key` válido → HTTPS.
- `server.tls: false` → HTTPS desativado explicitamente.
- `server.tls: {}` → HTTPS com certificado gerado automaticamente (self-signed), ideal para desenvolvimento/local.

## Exemplo JSON com arquivo de cert

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3443,
    "tls": {
      "certFile": "./certs/dev.local.crt",
      "keyFile": "./certs/dev.local.key",
      "caFile": "./certs/dev-ca.pem",
      "rejectUnauthorized": false
    }
  },
  "routes": [
    {
      "match": {
        "host": "api.internal.test",
        "pathPrefix": "/v1"
      },
      "target": "http://127.0.0.1:4100"
    }
  ]
}
```

## Exemplo YAML com inline cert para dev/test

```yaml
server:
  host: 127.0.0.1
  port: 3443
  tls:
    cert: |
      -----BEGIN CERTIFICATE-----
      ...
      -----END CERTIFICATE-----
    key: |
      -----BEGIN PRIVATE KEY-----
      ...
      -----END PRIVATE KEY-----
    minVersion: TLSv1.2
    maxVersion: TLSv1.3
routes:
  - match:
      host: "*.internal.test"
      path: "/"
    target: http://127.0.0.1:4100
```

## Exemplo programático

```ts
import { createReverseProxy, generateCertificate } from 'raffel'

const cert = await generateCertificate('dev.internal.test')

const proxy = await createReverseProxy({
  server: {
    host: '127.0.0.1',
    port: 3443,
    tls: {
      cert: cert.cert,
      key: cert.key,
      rejectUnauthorized: false,
    },
  },
  routes: [
    {
      match: { host: 'dev.internal.test', pathPrefix: '/' },
      target: 'http://127.0.0.1:4100',
    },
  ],
})

await proxy.start()
```

## Geração automática (sem certificados fornecidos)

Para ambiente local você pode simplesmente:

```ts
import { createReverseProxy } from 'raffel'

const reverse = await createReverseProxy({
  server: {
    host: '127.0.0.1',
    port: 3443,
    tls: {}, // não passe cert/key
  },
  routes: [
    {
      match: { host: 'auto.internal.test', pathPrefix: '/' },
      target: 'http://127.0.0.1:4100',
    },
  ],
})

await reverse.start()
```

O projeto já cria o par `key/cert` em tempo de inicialização usando a mesma fábrica interna de certificados.

Nota importante:

- esse certificado é autoassinado (ideal para `localhost`/desenvolvimento);
- o nome do certificado é derivado de `server.host` no start; em ambiente local use host resolvível (`127.0.0.1`, `localhost` ou DNS do `/etc/hosts`);
- clientes vão rejeitar por padrão se não estiverem confiando o certificado;
- para produção, mantenha certificados persistentes (Let's Encrypt, ACME, Vault, etc.).

Para confiar sem `-k`, não use geração automática sem persistir o certificado. Gere o par com `generateCertificate` (ou CA interna), passe via `tls.cert`/`tls.key` e distribua a autoridade para clientes.

## Rodando HTTPS local com cert gerado pelo proxy

1. Start com `tls: {}`
2. Aponte DNS/`hosts` para `127.0.0.1` (`auto.internal.test`)
3. Teste com verificação desligada no cliente (somente dev):

```bash
curl -k https://auto.internal.test:3443/
```

## Autenticação mútua (opcional)

Se você precisa validar cliente por certificado no listener:

- ative `requestCert: true`
- configure `ca`/`caFile` com a CA que emitiu os client certs
- ajuste `rejectUnauthorized` conforme a política do time.

## Limitações atuais

- Não há hot-reload de certificados por evento.
- Não há roteamento SNI por domínio do próprio proxy ainda.
- Não há renovação automática de certs (`ACME`) integrada.
- A troca de certificados exige `stop` + novo `start`.

## Self-signed local

Para ambiente local com cert gerado localmente:

- faça a rota apontar para um host fixo em `/etc/hosts` (ex.: `127.0.0.1 api.internal.test`),
- inicie o proxy com cert/key locais,
- clientes locais devem confiar na CA ou usar `rejectUnauthorized: false` temporariamente.

Exemplo de chamada:

```bash
curl -k https://api.internal.test:3443/health
```
