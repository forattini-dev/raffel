import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['test/setup-test-logger.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Test files use ephemeral ports (`port: 0`) so they can run in parallel.
    fileParallelism: true,
    isolate: true,
  },
  coverage: {
    provider: 'v8',
    reporter: ['text', 'html'],
    thresholds: {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
})
