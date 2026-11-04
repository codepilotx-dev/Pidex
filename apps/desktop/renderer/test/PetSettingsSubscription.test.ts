import { test } from 'bun:test'
import { runBrowserRegression, BROWSER_REGRESSION_TIMEOUT_MS } from './helpers/BrowserRegression'

test(
  'direct pet settings entry loads the shared catalog once',
  async () => {
    await runBrowserRegression(
      `${import.meta.dir}/PetSettingsSubscription.browser.ts`,
      'Pet settings mounted regression passed',
    )
  },
  BROWSER_REGRESSION_TIMEOUT_MS,
)
