import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const rendererRoot = fileURLToPath(new URL('.', import.meta.url))
const localNoProxy = ['127.0.0.1', 'localhost']
const inheritedNoProxy = process.env.NO_PROXY?.split(',').filter(Boolean) ?? []
process.env.NO_PROXY = [...new Set([...inheritedNoProxy, ...localNoProxy])].join(',')
process.env.no_proxy = process.env.NO_PROXY

export default defineConfig({
  testDir: './performance-tests',
  testMatch: '**/*.performance.ts',
  outputDir: './test-results/performance',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 30_000,
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:47174',
    channel: 'chrome',
    launchOptions: {
      args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
    },
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  webServer: {
    command:
      'bunx vite build --mode performance && bunx vite preview --host 127.0.0.1 --port 47174 --strictPort',
    cwd: rendererRoot,
    reuseExistingServer: process.env.PIDEX_PERFORMANCE_REUSE_SERVER === '1',
    timeout: 120_000,
    url: 'http://127.0.0.1:47174',
  },
})
