import { test } from 'bun:test'
import { runBrowserRegression, BROWSER_REGRESSION_TIMEOUT_MS } from './helpers/BrowserRegression'

test(
  'creation events and RPC completion keep one mounted row per session',
  async () => {
    await runBrowserRegression(
      `${import.meta.dir}/SessionModelSubmission.browser.ts`,
      'creation event/list reconciliation passed',
    )
  },
  BROWSER_REGRESSION_TIMEOUT_MS,
)
