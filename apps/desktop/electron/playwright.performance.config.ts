import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'

export default defineConfig({
  testDir: './performance-tests',
  testMatch: 'DesktopUx.performance.ts',
  outputDir: resolve('./test-results/performance'),
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  repeatEach: 3,
  reporter: 'line',
  workers: 1,
  timeout: 360_000,
  expect: {
    timeout: 60_000,
  },
})
