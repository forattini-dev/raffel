import { describe, expect, it, vi } from 'vitest'
import { adaptPinoLogger } from '../../../src/adapters/outbound/logger/pino.js'

describe('adaptPinoLogger', () => {
  it('delegates string and structured log calls without casts', () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const adapter = adaptPinoLogger(logger as never)

    adapter.debug('debug message')
    adapter.info({ requestId: 'req-1' }, 'info message')
    adapter.warn('warn message')
    adapter.error({ requestId: 'req-1', err: 'boom' }, 'error message')

    expect(logger.debug).toHaveBeenCalledWith('debug message')
    expect(logger.info).toHaveBeenCalledWith({ requestId: 'req-1' }, 'info message')
    expect(logger.warn).toHaveBeenCalledWith('warn message')
    expect(logger.error).toHaveBeenCalledWith({ requestId: 'req-1', err: 'boom' }, 'error message')
  })
})
