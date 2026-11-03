import { test } from 'bun:test'
import { runBrowserRegression, BROWSER_REGRESSION_TIMEOUT_MS } from './helpers/BrowserRegression'

test('shared business stores isolate mounted field subscriptions and persist settings', async () => {
  await runBrowserRegression(`${import.meta.dir}/SharedBusinessSubscription.browser.ts`, 'Shared business mounted subscriptions passed')
}, BROWSER_REGRESSION_TIMEOUT_MS)
