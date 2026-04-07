---
title: Reverse Proxy (moved to Proxy Toolkit)
---

# Reverse Proxy (migrado para Toolkit)

Esta documentação aponta para a seção de Proxy Toolkit, que agora cobre:

- roteamento HTTP/HTTPS (reverse)
- reverse proxy (`createReverseProxy`) com TLS
- proxy explícito (HTTP forward + CONNECT + WebSocket upgrade)
- SOCKS5/SOCKS5h (CONNECT/BIND/UDP ASSOCIATE)
- proxy transparente TCP
- suíte unificada (`createProxySuite`) com telemetria compartilhada

Links diretos:

- [Visão Geral](/proxy/overview.md)
- [Arquitetura](/proxy/architecture.md)
- [Modos](/proxy/modes.md)
- [Configuração por Arquivo (Reverse)](/proxy/config-file.md)
- [Configuração Programática (Reverse)](/proxy/config-code.md)
- [Roteamento e Rewrite de Path](/proxy/routing.md)
- [MITM e Replay](/proxy/mitm-capture.md)
- [TLS/HTTPS no Reverse Edge](/proxy/tls.md)
- [Webhook público com reverse proxy](/guides/webhook-edge.md)
- [Service Mesh e Transparência](/proxy/service-mesh.md)
- [Métricas/Fluxo](/proxy/flow-metrics.md)
- [Operação e Integração](/proxy/operations.md)
- [Troubleshooting](/proxy/troubleshooting.md)
- [Migrar de Traefik](/migration/traefik-replacement.md)

Se você ainda quiser consultar um guia consolidado antigo, consulte o histórico de commits.
