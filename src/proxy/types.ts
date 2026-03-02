/**
 * Shared types for the Raffel proxy module.
 */

export interface ProxyCredentials {
  username: string
  password: string
}

export type ProxyAuthVerifier = (creds: ProxyCredentials) => boolean | Promise<boolean>

export interface ProxyAuth {
  /** Static credentials to match against */
  credentials?: ProxyCredentials
  /** Custom verifier function (takes precedence over credentials) */
  verify?: ProxyAuthVerifier
}

export interface ProxyStats {
  readonly connectionsTotal: number
  readonly connectionsActive: number
  readonly bytesFromClient: number
  readonly bytesToClient: number
  readonly connectionsErrored: number
  readonly authFailures: number
}

export interface ProxyServer {
  /** Start listening. Resolves with the actual bound port. */
  start(): Promise<number>
  /** Stop the server. */
  stop(drainTimeoutMs?: number): Promise<void>
  readonly stats: ProxyStats
  readonly boundPort: number | null
  readonly isRunning: boolean
}
