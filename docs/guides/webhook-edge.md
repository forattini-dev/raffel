# Webhook Edge pública com `createReverseProxy`

Este guia descreve um endpoint público de webhook que termina TLS no edge Raffel e encaminha para uma aplicação local.

## Arquivo pronto

`examples/11-webhook-proxy.ts`

Ele já faz:

- cria um app local (`/health` e `/webhook`)
- sobe `createServer` local e `createReverseProxy` público
- aplica TLS configurável no edge
- valida token opcional
- valida assinatura HMAC opcional
- aplica anti-replay por nonce opcional
- permite configurar host, porta, caminhos e método por variável de ambiente

## Fluxo

```text
Internet ──▶ Edge HTTPS/HTTP (Raffel)
               └─▶ Serviço local (Raffel)
```

- O TLS do reverse proxy protege tráfego entre o cliente e o seu endpoint público.
- O serviço interno pode ser `http` ou `https`.
- Roteamento é por `host`, `pathPrefix` e `methods`.

## Segurança: TLS, MITM e pinning

- TLS protege em trânsito e impede leitura simples.
- MITM com certificado válido é o cenário que realmente preocupa.
- Para reduzir risco, combine camadas.
- `ca`/`caFile` com `requestCert: true` e `rejectUnauthorized: true` valida cliente por certificado (mTLS) quando o emissor suporta isso.
- Pinning de certificado não é campo próprio em `server.tls` do `createReverseProxy`; faça isso no lado do cliente (quem envia webhook) ou em um gateway antes do Raffel.
- Mesmo com mTLS, use assinatura HMAC e nonce para defesa em profundidade.

## Mínimo recomendado para produção

1. Porta pública exposta somente no `reverse proxy`.
2. Certificado real (sem `auto` sem cert/key) e chave segura.
3. Verificação de autenticação da mensagem (token ou HMAC).
4. Anti-replay com nonce.
5. `requestCert` + `ca`/`caFile` quando for possível exigir mTLS.
6. Log mínimo com timestamp, hash do payload e resultado de autenticação.

## Variáveis disponíveis

### Infra local

- `WEBHOOK_INTERNAL_HOST` host do serviço local, padrão `127.0.0.1`.
- `WEBHOOK_INTERNAL_PORT` porta do serviço local, padrão `3000`.
- `WEBHOOK_INTERNAL_SCHEME` `http` ou `https`.
- `WEBHOOK_INTERNAL_WEBHOOK_PATH` path local do webhook, padrão `/webhook`.
- `WEBHOOK_INTERNAL_HEALTH_PATH` path local de health, padrão `/health`.

### Edge pública

- `WEBHOOK_PUBLIC_HOST` host lógico usado em logs.
- `WEBHOOK_PUBLIC_LISTEN_HOST` bind interno (`0.0.0.0` por padrão).
- `WEBHOOK_PUBLIC_PORT` porta pública, padrão `3443`.
- `WEBHOOK_PUBLIC_TLS` `true` ou `false`.
- `WEBHOOK_ROUTE_HOSTS` hosts permitidos, separados por vírgula.
- `WEBHOOK_ROUTE_WEBHOOK_PATH_PREFIX` prefixo público do webhook.
- `WEBHOOK_ROUTE_HEALTH_PATH_PREFIX` prefixo público de health.
- `WEBHOOK_ROUTE_WEBHOOK_METHODS` métodos permitidos no webhook.
- `WEBHOOK_ROUTE_HEALTH_METHODS` métodos permitidos de health.
- `WEBHOOK_NO_MATCH_STATUS` status para rota não casada.
- `WEBHOOK_NO_MATCH_BODY` body textual para rota não casada.

### TLS no edge

- `WEBHOOK_TLS_MODE` `off`, `auto`, `files` ou `inline`.
- `WEBHOOK_TLS_CERT_FILE` caminho do certificado público.
- `WEBHOOK_TLS_KEY_FILE` caminho da chave privada.
- `WEBHOOK_TLS_CERT` certificado inline (modo `inline`).
- `WEBHOOK_TLS_KEY` chave inline (modo `inline`).
- `WEBHOOK_TLS_CA` CA(s) inline extra para validação de cliente.
- `WEBHOOK_TLS_CA_FILES` arquivos de CA inline separados por vírgula.
- `WEBHOOK_TLS_MIN_VERSION` versão mínima TLS, ex `TLSv1.2`.
- `WEBHOOK_TLS_MAX_VERSION` versão máxima TLS, ex `TLSv1.3`.
- `WEBHOOK_TLS_REQUEST_CERT` `true` ou `false` para pedir certificado de cliente.
- `WEBHOOK_TLS_REJECT_UNAUTHORIZED` `true` ou `false` para exigir validação.

### Segurança da mensagem

- `WEBHOOK_TOKEN_REQUIRED` `true` habilita header de token.
- `WEBHOOK_TOKEN` segredo compartilhado.
- `WEBHOOK_TOKEN_HEADER` nome do header, padrão `x-webhook-token`.
- `WEBHOOK_SIGNATURE_REQUIRED` `true` exige assinatura HMAC.
- `WEBHOOK_SIGNATURE_SECRET` segredo de assinatura.
- `WEBHOOK_SIGNATURE_HEADER` nome do header, padrão `x-webhook-signature`.
- `WEBHOOK_SIGNATURE_PREFIX` padrão `sha256=`.
- `WEBHOOK_NONCE_REQUIRED` `true` exige nonce.
- `WEBHOOK_NONCE_HEADER` header de nonce, padrão `x-webhook-nonce`.
- `WEBHOOK_NONCE_WINDOW_SECONDS` janela de rejeição de replay (padrão `0`).
- `WEBHOOK_NONCE_TTL_SECONDS` TTL de cache em memória para nonces (padrão `3600`).

## Exemplos

### Dev local sem TLS público

```bash
WEBHOOK_PUBLIC_TLS=false \
WEBHOOK_TOKEN_REQUIRED=true \
WEBHOOK_TOKEN=supersecret \
WEBHOOK_SIGNATURE_REQUIRED=false \
WEBHOOK_NONCE_REQUIRED=true \
pnpm exec tsx examples/11-webhook-proxy.ts
```

### Produção com HTTPS por arquivo

```bash
WEBHOOK_PUBLIC_TLS=true \
WEBHOOK_PUBLIC_LISTEN_HOST=0.0.0.0 \
WEBHOOK_PUBLIC_PORT=3443 \
WEBHOOK_TLS_MODE=files \
WEBHOOK_TLS_CERT_FILE=./certs/proxy.crt \
WEBHOOK_TLS_KEY_FILE=./certs/proxy.key \
WEBHOOK_TLS_REQUEST_CERT=true \
WEBHOOK_TLS_REJECT_UNAUTHORIZED=true \
WEBHOOK_TLS_CA_FILES=./certs/client-ca.pem \
WEBHOOK_TOKEN_REQUIRED=true \
WEBHOOK_TOKEN=supersecret \
WEBHOOK_SIGNATURE_REQUIRED=true \
WEBHOOK_SIGNATURE_SECRET=assinatura-secreta \
WEBHOOK_NONCE_REQUIRED=true \
pnpm exec tsx examples/11-webhook-proxy.ts
```

### Payload de teste com assinatura

```bash
BODY='{"event":"ping","id":"1"}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac 'assinatura-secreta' | awk '{print $2}')"
curl -XPOST https://localhost:3443/webhook \
  -H "x-webhook-token: supersecret" \
  -H "x-webhook-nonce: 1680000001" \
  -H "x-webhook-signature: $SIG" \
  -H 'content-type: application/json' \
  -d "$BODY"
```

## Operação e troubleshooting rápido

- `curl -k` só para ambiente com certificado autoassinado.
- Se o endpoint responder 404, ajuste `WEBHOOK_ROUTE_*_PATH_PREFIX` e `WEBHOOK_ROUTE_*_METHODS`.
- Se houver 401 no token, confirme `WEBHOOK_TOKEN` e header.
- Se houver 401 de assinatura, confirme `WEBHOOK_SIGNATURE_SECRET`, `WEBHOOK_SIGNATURE_PREFIX` e body exato.
- Se nonce duplica, aumente `WEBHOOK_NONCE_WINDOW_SECONDS` ou use UUID por evento.

## Observação importante

- O modo com `TLS_MODE=auto` gera certificado autoassinado.
- Para produção, prefira `files` com certificação persistente ou gerador interno entregue em arquivo.
- O pinning que elimina MITM real é mais forte quando validado no cliente contra a CA/CA pública ou via mTLS, não apenas com TLS padrão.
