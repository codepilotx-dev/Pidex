import { test } from 'bun:test'
import { runBrowserRegression, BROWSER_REGRESSION_TIMEOUT_MS } from './helpers/BrowserRegression'

test(
  'mounted Composer draft subscriptions settle and preserve edits and draft isolation',
  async () => {
    await runBrowserRegression(
      `${import.meta.dir}/ComposerDraftSubscription.browser.ts`,
      'Composer mounted regression passed',
    )
  },
  BROWSER_REGRESSION_TIMEOUT_MS,
)
