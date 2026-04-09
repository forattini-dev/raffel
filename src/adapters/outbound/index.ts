/**
 * Outbound Adapters
 *
 * Concrete implementations of outbound ports (driven adapters).
 * These adapt external infrastructure to the port interfaces
 * defined in ports/outbound/.
 */

// Logger adapters
export { createPinoLoggerAdapter, pinoLoggerFactory, getBasePinoLogger } from './logger/index.js'
