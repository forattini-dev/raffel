/** Minimal Redis-like client interface shared across subsystems */
export interface BaseRedisClient {
  get(key: string): Promise<string | number | null>
  del?(key: string | string[]): Promise<unknown>
}
