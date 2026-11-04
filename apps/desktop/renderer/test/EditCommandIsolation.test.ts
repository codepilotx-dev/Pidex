import { test } from 'bun:test'
import { runBrowserRegression, BROWSER_REGRESSION_TIMEOUT_MS } from './helpers/BrowserRegression'

test(
  'edit command actions consumers are isolated from typing and selection events',
  async () => {
    await runBrowserRegression(
      `${import.meta.dir}/EditCommandIsolation.browser.ts`,
      'EditCommandIsolation regression passed',
    )
  },
  BROWSER_REGRESSION_TIMEOUT_MS,
)
