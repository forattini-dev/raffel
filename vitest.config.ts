import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.unit.test.ts', 'test/**/*.int.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run test files sequentially to avoid port conflicts
    fileParallelism: false,
    // Ensure clean isolation between tests
    isolate: true,
  },
  coverage: {
    provider: 'v8',
    reporter: ['text', 'html'],
    thresholds: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
})
