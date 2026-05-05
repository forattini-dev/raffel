import type { PatternDoc } from '../types.js'
import { advancedPatterns } from './patterns-advanced-data.js'
import { corePatterns } from './patterns-core-data.js'

export const patterns: PatternDoc[] = [...corePatterns, ...advancedPatterns]
