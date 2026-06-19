import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.int.test.ts'],
    setupFiles: ['test/setup-test-logger.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Integration tests bind real OS ports. Most use ephemeral ports (`port: 0`),
    // but the single-port multiplex tests (multiplex-combinations.int.test.ts)
    // CANNOT — http + tcp + grpc must share ONE concrete port, so they probe a
    // free port via listen(0)+close and reuse the number. That probe-then-reuse
    // is a TOCTOU race: with parallel files, another worker can grab the same
    // just-freed port before the server binds → flaky `EADDRINUSE`. Running test
    // files sequentially guarantees only one server binds at a time, eliminating
    // the cross-file port race (CI reliability > a few minutes of wall time).
    fileParallelism: false,
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
