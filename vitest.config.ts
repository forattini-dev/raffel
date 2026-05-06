import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.unit.test.ts', 'test/**/*.int.test.ts'],
    setupFiles: ['test/setup-test-logger.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Test files use ephemeral ports (`port: 0`) so they can run in parallel
    // safely. Workers default to ~half of CPU cores.
    fileParallelism: true,
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
