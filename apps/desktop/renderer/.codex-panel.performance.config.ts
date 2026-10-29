import { defineConfig } from '@playwright/test'
import base from './playwright.performance.config.js'
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:47175' },
  webServer: { ...(base.webServer as object), command: 'bunx vite build --mode performance && bunx vite preview --host 127.0.0.1 --port 47175 --strictPort', url: 'http://127.0.0.1:47175', reuseExistingServer: false },
})
