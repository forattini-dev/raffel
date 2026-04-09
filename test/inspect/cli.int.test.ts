import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const cliPath = path.resolve(process.cwd(), 'src', 'mcp', 'cli.ts')
const runtimeFixture = path.resolve(process.cwd(), 'test', 'fixtures', 'inspect-cli', 'runtime-preview.ts')
const doctorFixture = path.resolve(process.cwd(), 'test', 'fixtures', 'inspect-cli', 'doctor-preview.ts')
const contractFixture = path.resolve(process.cwd(), 'test', 'fixtures', 'inspect-cli', 'contract-preview.ts')
const fusionFixture = path.resolve(process.cwd(), 'test', 'fixtures', 'inspect-cli', 'fusion-preview.ts')
const tcpFixture = path.resolve(process.cwd(), 'test', 'fixtures', 'inspect-cli', 'tcp-preview.ts')
const udpFixture = path.resolve(process.cwd(), 'test', 'fixtures', 'inspect-cli', 'udp-preview.ts')

function runCli(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', cliPath, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
}

function normalizeCliOutput(output: string): string {
  return output
    .trim()
    .replace(/^Entrypoint module: .+\n/, '')
    .replace(/Generated: .+/, 'Generated: <generatedAt>')
    .replace(/\n\[\d{4}-\d{2}-\d{2}[\s\S]*$/, '')
}

describe('runtime inspection CLI', () => {
  it('should render inspect output for a multi-protocol preview', () => {
    const result = runCli(['inspect', runtimeFixture])

    expect(result.status).toBe(0)
    expect(normalizeCliOutput(result.stdout)).toMatchInlineSnapshot(`
      "Raffel Runtime Preview
      Generated: <generatedAt>
      Entrypoint: HTTP 0.0.0.0:4310 [fusion=disabled]

      Transports
      - http      0.0.0.0:4310 (path=/api, shared, source=native)
      - websocket 0.0.0.0:4310 (path=/api/ws, shared, source=native)
      - jsonrpc   0.0.0.0:4310 (path=/api/rpc, shared, source=native)
      - grpc      0.0.0.0:5310 (dedicated, source=native)

      Services
      - pkg.UserService (1 operation)
        pkg.UserService.GetUser [procedure]
          source: grpc-namespace @ <programmatic>
          bindings: HTTP POST /api/pkg.UserService.GetUser [rpc] | JSON-RPC pkg.UserService.GetUser [request] | WebSocket /api/ws [request] | gRPC pkg.UserService.GetUser [unary]
          policies: none
          schemas: input=zod-to-json-schema, output=zod-to-json-schema
      - users (1 operation)
        users.list [procedure]
          source: programmatic @ <programmatic>
          bindings: HTTP GET /api/users [rest] | JSON-RPC users.list [request] | WebSocket /api/ws [request]
          policies: auth(required, roles=admin), timeout(1500ms)
          schemas: input=zod-to-json-schema, output=zod-to-json-schema

      Channels
      - presence-users [presence] auth=required
        source: programmatic @ <programmatic>
        transport: WebSocket /api/ws [channel]
        events: none

      Diagnostics (0 errors, 2 warnings, 0 infos)
      - [warning] LEGACY_TRANSPORT_SURFACE operation:pkg.UserService.GetUser
          pkg.UserService.GetUser is registered through the grpc-namespace compatibility surface
          remediation: Prefer contract-first procedures/resources plus transport exposure so inspect, explain, docs, and contract tooling stay aligned.
      - [warning] MISSING_AUTH_POLICY operation:pkg.UserService.GetUser
          pkg.UserService.GetUser is externally exposed without an auth policy
          remediation: Attach a contract auth policy or explicitly mark the route as intentionally public."
    `)
  })

  it('should explain one HTTP binding', () => {
    const result = runCli(['explain', 'GET /api/users', runtimeFixture])

    expect(result.status).toBe(0)
    expect(normalizeCliOutput(result.stdout)).toMatchInlineSnapshot(`
      "Raffel Explain: GET /api/users
      Kind: binding (GET:/api/users)
      Bindings: HTTP GET /api/users [rest]
      Operations: users.list
      Channels: none

      Diagnostics
      - none"
    `)
  })

  it('should explain one UDP transport handler', () => {
    const result = runCli(['explain', 'metrics.ingest', udpFixture])

    expect(result.status).toBe(0)
    expect(normalizeCliOutput(result.stdout)).toMatchInlineSnapshot(`
      "Raffel Explain: metrics.ingest
      Kind: transport-handler (udp:datagram)
      Source: programmatic @ <programmatic>
      Target: 127.0.0.1:9001 (udp4)

      Diagnostics
      - none"
    `)
  })

  it('should explain one TCP transport handler', () => {
    const result = runCli(['explain', 'raw.echo', tcpFixture])

    expect(result.status).toBe(0)
    expect(normalizeCliOutput(result.stdout)).toMatchInlineSnapshot(`
      "Raffel Explain: raw.echo
      Kind: transport-handler (tcp:session)
      Source: programmatic @ <programmatic>
      Target: 127.0.0.1:9002 [framing=delimiter:\"\\n\"]

      Diagnostics
      - none"
    `)
  })

  it('should run doctor diagnostics without failing on warnings by default', () => {
    const result = runCli(['doctor', doctorFixture])

    expect(result.status).toBe(0)
    expect(normalizeCliOutput(result.stdout)).toMatchInlineSnapshot(`
      "Raffel Doctor
      Summary: 0 errors, 5 warnings, 0 infos (5 total)

      Diagnostics
      - [warning] LEGACY_TRANSPORT_SURFACE operation:get:/legacy
          get:/legacy is registered through the http-namespace compatibility surface
          remediation: Prefer contract-first procedures/resources plus transport exposure so inspect, explain, docs, and contract tooling stay aligned.
      - [warning] MISSING_AUTH_POLICY operation:get:/legacy
          get:/legacy is externally exposed without an auth policy
          remediation: Attach a contract auth policy or explicitly mark the route as intentionally public.
      - [warning] MISSING_OUTPUT_SCHEMA operation:get:/legacy
          get:/legacy is externally exposed without an output schema
          remediation: Attach an output schema so docs, tooling, and contract tests can reason about responses.
      - [warning] MISSING_AUTH_POLICY operation:public.ping
          public.ping is externally exposed without an auth policy
          remediation: Attach a contract auth policy or explicitly mark the route as intentionally public.
      - [warning] MISSING_OUTPUT_SCHEMA operation:public.ping
          public.ping is externally exposed without an output schema
          remediation: Attach an output schema so docs, tooling, and contract tests can reason about responses."
    `)
  })

  it('should fail doctor when warnings are promoted', () => {
    const result = runCli(['doctor', doctorFixture, '--fail-on', 'warning'])

    expect(result.status).toBe(1)
    expect(normalizeCliOutput(result.stdout)).toContain('LEGACY_TRANSPORT_SURFACE')
  })

  it('should render contract-test output from runtime metadata', () => {
    const result = runCli(['contract-tests', contractFixture])

    expect(result.status).toBe(0)
    expect(normalizeCliOutput(result.stdout)).toMatchInlineSnapshot(`
      "Raffel Contract Tests
      Summary: 2 authorized, 2 unauthorized, 2 invalid-input, 1 cross-transport (7 total)

      Checks
      - [unauthorized] payments.charge rejects unauthorized HTTP access
        targets: http:POST /api/payments/charge
      - [authorized] payments.charge accepts authorized HTTP access
        targets: http:POST /api/payments/charge
      - [invalid-input] payments.charge rejects invalid input over HTTP
        targets: http:POST /api/payments/charge
      - [unauthorized] payments.charge rejects unauthorized GRPC access
        targets: grpc:billing.Payments.Charge
      - [authorized] payments.charge accepts authorized GRPC access
        targets: grpc:billing.Payments.Charge
      - [invalid-input] payments.charge rejects invalid input over GRPC
        targets: grpc:billing.Payments.Charge
      - [cross-transport] payments.charge stays aligned across transports
        targets: http:POST /api/payments/charge | grpc:billing.Payments.Charge"
    `)
  })

  it('should surface protocol-fusion diagnostics for shared-port and front-door setups', () => {
    const result = runCli(['doctor', fusionFixture, '--fail-on', 'error'])

    expect(result.status).toBe(0)
    expect(normalizeCliOutput(result.stdout)).toMatchInlineSnapshot(`
      "Raffel Doctor
      Summary: 0 errors, 3 warnings, 3 infos (6 total)

      Diagnostics
      - [warning] CONFIG_WARNING server:config-warning:0
          Front-door routing is enabled without http.trustedProxies. Forwarded client IP headers will be ignored until trusted proxies are configured.
      - [warning] CONFIG_WARNING server:config-warning:1
          Front-door routing is enabled with wildcard CORS. Prefer explicit origins before public exposure.
      - [warning] HTTP_FAMILY_BLOCKED_BY_SHARED_PORT server:shared-port-http-family
          sharedPort.protocols excludes http, so HTTP, WebSocket, JSON-RPC, and GraphQL traffic will be rejected at the transport entrypoint
          remediation: Add \`http\` to \`sharedPort.protocols\`, or move HTTP-family transports to another listener before relying on inspect/playground workflows.
      - [info] FRONT_DOOR_OFFLOAD_PROTOCOLS server:front-door-offload
          Front-door exposure includes offloaded protocols: tcp
          remediation: Remember that front-door only parses HTTP-family traffic directly; offloaded protocols still rely on their dedicated adapter/runtime path.
      - [info] PROTOCOL_FUSION_MODE server:protocol-fusion
          Protocol fusion is active in front-door+shared-port mode on the TCP entrypoint
          remediation: Use \`raffel inspect\`, \`raffel explain\`, or \`server.getProtocolFusionState()\` to inspect routing decisions and recent protocol rejections.
      - [info] CUSTOM_PROTOCOL_SNIFFERS server:shared-port-sniffers
          Shared-port protocol fusion runs 1 custom sniffer(s): mqtt
          remediation: Keep custom sniffers deterministic and document their transport mapping so inspect, doctor, and playground workflows stay predictable."
    `)
  })
})
