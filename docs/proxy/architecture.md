# Arquitetura do Toolkit de Proxy

## Diagrama lógico

```
Cliente
  -> ReverseProxy (http/https)
     -> Resolver (host/path/método)
        -> createExplicitProxy
           -> http-forward   (requests HTTP em absolute-form)
           -> connect-tunnel (CONNECT)
           -> upgrade handler (WS/UPGRADE)

  -> createProxySuite
     -> explicit (http/https/connect/ws)
     -> socks5 (socks5/socks5h/udp)

  -> createTransparentProxy (tcp)
     -> resolução de destino original (TPROXY/REDIRECT)
     -> pipe bidirecional
```

## Componentes internos (panorama)

- `src/proxy/reverse.ts`
  - parsing de configuração;
  - seleção de rota;
  - listener HTTP/HTTPS;
  - composição de fluxo para `createExplicitProxy`.
- `src/proxy/explicit.ts`
  - motor unificado de fluxo com hooks, autenticação e telemetria.
- `src/proxy/http-forward.ts`
  - proxy de request HTTP (absolute URL).
- `src/proxy/connect-tunnel.ts`
  - túnel `forward` ou MITM para `CONNECT`.
- `src/proxy/socks5.ts`
  - parser/codec SOCKS5 com suporte a `CONNECT`, `BIND`, `UDP ASSOCIATE`.
- `src/proxy/transparent.ts`
  - proxy de camada TCP com resolução de destino em modo transparente.
- `src/proxy/suite.ts`
  - orquestra explicit + socks5 com coletor de telemetria compartilhado.
- `src/proxy/telemetry.ts`
  - snapshots por aresta e telemetria de métricas.

## Modelo de estado

### Reverse Proxy

`ReverseProxy` expõe:

- `start()`: inicia listener e resolve porta real
- `stop(drainTimeoutMs?)`: encerra com timeout de drenagem
- `isRunning`
- `boundPort`
- `stats` (contadores de conexão)
- `config` (configuração normalizada)
- `caCert` (do túnel explícito, útil em cenários de inspeção)
- `graphSnapshot()`

### Explicit / SOCKS5 / Transparent

Esses módulos também expõem `isRunning`, `stats`, `boundPort`, `metricsRegistry` e `graphSnapshot()`.

## Fluxos suportados

### HTTP (Reverse Proxy)

1. `req.url` chega no proxy reverso
2. parse de `host`, `path`, `method`
3. encontra primeira rota compatível
4. `joinUpstreamPath` compõe destino final
5. request repassado para HTTP forward

### CONNECT

1. recebe `host:port` no método `CONNECT`
2. resolve rota com `host` + path `/`
3. repassa para `createConnectTunnel`

### WebSocket / upgrade

1. handshake chega via `upgrade`
2. detecta target (`ws` ou `wss`) conforme TLS do socket
3. resolve rota + reescreve path
4. repassa para handler de upgrade

### SOCKS5

1. handshake SOCKS5
2. autenticação (opcional)
3. seleção de comando (`CONNECT`, `BIND`, `UDP ASSOCIATE`)
4. criação de fluxo por protocolo e telemetria por aresta

### Transparência TCP

1. conexão chega no socket TCP do proxy transparente
2. resolve destino original (kernel/redirect)
3. abre conexão upstream
4. pipe bidirecional com contadores de fluxo

## Precedência e comportamento

- O reverse usa resolução por ordem declarativa: primeira rota compatível ganha.
- `host` é normalizado em minúsculas no roteamento por host.
- Não existe ranking automático de especificidade entre path/host; ordem de definição importa.

## Por que essa arquitetura

Ela evita duplicação: em vez de reimplementar autenticação, filtros, hooks e telemetria por modo, os fluxos compartilham um bloco comum e variam apenas no parser/protocolo de entrada.
