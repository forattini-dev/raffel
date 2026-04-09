import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.unit.test.ts', 'test/**/*.int.test.ts'],
    setupFiles: ['test/setup-test-logger.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Run test files sequentially to avoid port conflicts
    fileParallelism: false,
    // Ensure clean isolation between tests
    isolate: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/**/index.ts',
        'src/mcp/cli.ts',
        'src/mcp/version.ts',
      ],
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
  },
})
