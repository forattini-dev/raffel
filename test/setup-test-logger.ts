// Keep integration/unit tests clean from noisy debug/info logs.
if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'silent'
}
