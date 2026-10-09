import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const rendererRoot = fileURLToPath(new URL('.', import.meta.url))
const configuredVisualPort = process.env.PIDEX_VISUAL_PORT?.trim()
const visualPort = configuredVisualPort ? Number(configuredVisualPort) : 47173
if (!Number.isInteger(visualPort) || visualPort < 1 || visualPort > 65535) {
  throw new Error('PIDEX_VISUAL_PORT 必须是 1 到 65535 的整数')
}
const visualURL = `http://127.0.0.1:${visualPort}`
const localNoProxy = ['127.0.0.1', 'localhost']
const inheritedNoProxy = process.env.NO_PROXY?.split(',').filter(Boolean) ?? []
process.env.NO_PROXY = [...new Set([...inheritedNoProxy, ...localNoProxy])].join(',')
process.env.no_proxy = process.env.NO_PROXY

export default defineConfig({
  testDir: './visual-tests',
  testMatch: '**/*.visual.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'line',
  workers: 2,
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: visualURL,
    channel: 'chrome',
    locale: 'zh-CN',
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `bun run dev:visual -- --port ${visualPort} --strictPort`,
    cwd: rendererRoot,
    reuseExistingServer: process.env.PIDEX_VISUAL_REUSE_SERVER === '1',
    timeout: 120_000,
    url: visualURL,
  },
})
