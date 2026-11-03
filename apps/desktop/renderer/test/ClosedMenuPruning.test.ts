import { test } from 'bun:test'
import { runBrowserRegression, BROWSER_REGRESSION_TIMEOUT_MS } from './helpers/BrowserRegression'

test(
  'closed popover and menu pruning eliminates list construction across pickers and command suggestions',
  async () => {
    await runBrowserRegression(
      `${import.meta.dir}/ClosedMenuPruning.browser.ts`,
      'ClosedMenuPruning regression passed',
    )
  },
  BROWSER_REGRESSION_TIMEOUT_MS,
)
