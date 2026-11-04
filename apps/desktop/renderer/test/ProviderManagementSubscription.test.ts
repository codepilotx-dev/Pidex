import { test } from 'bun:test'
import { runBrowserRegression, BROWSER_REGRESSION_TIMEOUT_MS } from './helpers/BrowserRegression'

test(
  'mounted connection handles empty partitions and usage does not rerender sidebar or gate',
  async () => {
    await runBrowserRegression(
      `${import.meta.dir}/ProviderManagementSubscription.browser.ts`,
      'Provider mounted regression passed',
    )
  },
  BROWSER_REGRESSION_TIMEOUT_MS,
)
