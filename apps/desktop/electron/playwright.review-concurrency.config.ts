import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

export default defineConfig({
  testDir: './smoke-tests',
  testMatch: 'ReviewConcurrency.smoke.ts',
  outputDir: resolve(
    process.env.PIDEX_PLAYWRIGHT_OUTPUT_DIR ?? './test-results/review-concurrency',
  ),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  workers: 1,
  timeout: 600_000,
  expect: {
    timeout: 30_000,
  },
})
