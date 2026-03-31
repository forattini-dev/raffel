# Troubleshooting

## Nenhuma rota casou (`404`/custom noMatch)

Sintoma:
- resposta `No route matched` ou corpo customizado via `noMatch`.

Checklist:

- Host header está vindo exatamente como esperado (sem porta)?
  - Regra usa `match.host` e compara contra host sem porta.
- Path foi reescrito pelo cliente?
  - `pathPrefix` combina início do path, `path` exige correspondência exata após normalização de `/`.
- Método está restrito em `methods`?
- A regra anterior na lista não está capturando tudo primeiro?
  - A resolução é ordem-declarativa; primeira regra que casa vence.
- Rotas foram carregadas com erro de parse?
  - Sempre validar com `parseReverseProxyConfig` no bootstrap.

Exemplo de correção:

```ts
{
  match: {
    host: 'api.internal.test',
    pathPrefix: '/v1',
    methods: ['GET', 'POST'],
  },
  target: 'http://127.0.0.1:4100',
}
```

Para diagnosticar rapidamente:

```bash
curl -H "Host: api.internal.test" http://127.0.0.1:3000/v1/health
```

## TLS falhando na conexão

Sintomas comuns:

- `ERR_SSL_PROTOCOL_ERROR` no navegador
- `socket hang up` no cliente Node
- handshake rejeitado por certificado não confiável

Ajustes:

- Certificado e chave inválidos (ponto e vírgula? espaços? caminho errado no `certFile`/`keyFile`);
- `server.tls` ausente, mas cliente tentando HTTPS;
- self-signed sem trust da CA do cliente.

Verificação:

- confirme que `server.tls.cert`/`server.tls.key` existem e não estão vazios;
- teste com `curl -k` apenas para validar fluxo;
- gere cert consistente por host no mesmo domínio usado em `Host`.

Exemplo:

```bash
curl -k https://api.internal.test:3443/health
```

## `CONNECT` não entra

Sintomas:

- handshake de túnel cai com `400` ou 404;
- conexão HTTPS não sobe por `CONNECT`.

Checklist:

- O `host` do `CONNECT` precisa casar com a regra de `match.host` da rota.
- `method` não informado ou `methods` da rota sem `CONNECT`.
- A rota `CONNECT` selecionada encaminha para target sem rota de aplicação esperada.

Validação recomendada:

```bash
curl -x http://127.0.0.1:3000 -X CONNECT -H "Host: api.internal.test:443" https://api.internal.test:443
```

No teste de produção use ferramenta de túnel própria do app (OpenSSL, netcat), porque curl pode mascarar parte do fluxo.

## WebSocket falhando no upgrade

- Não bate o host/path da regra para a sessão de upgrade.
- `Upgrade` é tratado com protocolo `ws`/`wss` dependendo do listener.
- O `path` pode estar com prefixo e ser reescrito com `stripPrefix`.

Testes mínimos:

```bash
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Host: ws.internal.test" \
  http://127.0.0.1:3000/ws/chat
```

## Path rewrite estranho

Sintoma típico:
- `GET /api/users` chegou no backend em `/users` sem querer, ou chegou em `/api/users` e precisava remover.

Regras:

- Com `pathPrefix: '/api'`, `stripPrefix` default é esse mesmo prefixo.
- Com `stripPrefix: false`, não reescreve.
- Com `stripPrefix: '/algo'`, sempre remove o prefixo definido.

## Diagnóstico de inicialização

Erros de parse que param startup:

- `routes must be an array`
- `routes must contain at least one entry`
- `target must be a valid absolute URL`
- `server.tls.cert is required` (ou `server.tls.key is required`) quando só um lado do par foi passado
- `server.tls.cert`/`server.tls.key` não vieram após leitura de arquivo (path inválido ou vazio)

Estratégia:

- `parseReverseProxyConfig()` antes de `createReverseProxy`
- `loadReverseProxyConfig()` no caminho final do ambiente
- start só após `config` validada (em produção, falha cedo em CI é melhor do que em runtime)

## Checklist rápido por incidente

- Verificar rota correta com host/path/método em ordem.
- Testar chamada com `Host` explícito e sem `stripPrefix` primeiro.
- Conferir certificados e cadeia (`cert`/`key`/`ca`).
- Habilitar logs no proxy e coletar `reverse.stats`.
- Se for regressão em produção, revert para último snapshot e manter tráfego no caminho anterior por rollback.
