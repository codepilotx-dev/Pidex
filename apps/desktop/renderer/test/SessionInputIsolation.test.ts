import { test } from 'bun:test'
import { runBrowserRegression, BROWSER_REGRESSION_TIMEOUT_MS } from './helpers/BrowserRegression'

test('session input updates isolate from DesktopLayout, sidebar, and context menus across routes', async () => {
  await runBrowserRegression(`${import.meta.dir}/SessionInputIsolation.browser.ts`, 'SessionInputIsolation regression passed')
}, BROWSER_REGRESSION_TIMEOUT_MS)
