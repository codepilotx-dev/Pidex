import { expect, test } from '@playwright/test'
import { waitForFixture } from '../PerformanceTestHelpers.js'

type PanelToggleProbe = {
  enabled: boolean
  contextsSeen: number
  menusSeen: number
  changedContextKeys: string[]
  menuUpdates: number
}

async function installPanelToggleProbe(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    type Fiber = {
      memoizedProps: Record<string, unknown> | null
      alternate: Fiber | null
      child: Fiber | null
      sibling: Fiber | null
    }
    const probe = {
      enabled: false,
      contextsSeen: 0,
      menusSeen: 0,
      changedContextKeys: [] as string[],
      menuUpdates: 0,
    }
    Object.assign(window, {
      __panelToggleProbe: probe,
      __REACT_DEVTOOLS_GLOBAL_HOOK__: {
        supportsFiber: true,
        inject: () => 1,
        onCommitFiberUnmount() {},
        onCommitFiberRoot(_id: number, root: { current: Fiber }) {
          if (!probe.enabled) return
          function visit(fiber: Fiber | null): void {
            if (!fiber) return
            const props = fiber.memoizedProps
            const previous = fiber.alternate?.memoizedProps
            const value =
              props && typeof props === 'object'
                ? (props.value as Record<string, unknown> | undefined)
                : undefined
            if (
              value &&
              typeof value === 'object' &&
              'composerProps' in value &&
              'workspacePath' in value
            ) {
              probe.contextsSeen++
              const old =
                previous && typeof previous === 'object'
                  ? (previous.value as Record<string, unknown> | undefined)
                  : undefined
              if (old && old !== value) {
                probe.changedContextKeys.push(
                  ...Object.keys(value).filter((key) => !Object.is(value[key], old[key])),
                )
              }
            }
            if (
              props &&
              typeof props === 'object' &&
              'isFileActionEnabled' in props &&
              'isViewActionEnabled' in props
            ) {
              probe.menusSeen++
              if (previous && props !== previous) probe.menuUpdates++
            }
            visit(fiber.child)
            visit(fiber.sibling)
          }
          visit(root.current)
        },
      },
    })
  })
}

async function enablePanelToggleProbe(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const probe = (window as unknown as { __panelToggleProbe: { enabled: boolean } })
      .__panelToggleProbe
    probe.enabled = true
  })
}

async function readPanelToggleProbe(page: import('@playwright/test').Page): Promise<PanelToggleProbe> {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __panelToggleProbe: PanelToggleProbe
        }
      ).__panelToggleProbe,
  )
}

test('right panel toggle preserves unrelated menu props and chat context', async ({ page }) => {
  test.setTimeout(60_000)
  page.on('pageerror', (error) => console.error(error.message))
  await installPanelToggleProbe(page)
  await waitForFixture(page, 100, 30)
  await enablePanelToggleProbe(page)
  for (let index = 0; index < 4; index++) {
    const button = page.getByRole('button', { name: /^(显示|隐藏)标签页/ })
    const before = await button.getAttribute('aria-pressed')
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')
  }
  const probe = await readPanelToggleProbe(page)
  expect(probe.contextsSeen).toBeGreaterThan(0)
  expect(probe.menusSeen).toBeGreaterThan(0)
  expect(probe.changedContextKeys).toEqual([])
  expect(probe.menuUpdates).toBe(0)
})

test('sidebar toggle preserves chat context for the composer', async ({ page }) => {
  test.setTimeout(60_000)
  page.on('pageerror', (error) => console.error(error.message))
  await installPanelToggleProbe(page)
  await waitForFixture(page, 100, 30)
  await enablePanelToggleProbe(page)
  for (let index = 0; index < 4; index++) {
    const trigger = page.locator('[data-app-shell-sidebar-trigger]')
    const before = await trigger.getAttribute('title')
    await trigger.click()
    await expect(trigger).toHaveAttribute('title', before === '收起侧边栏' ? '展开侧边栏' : '收起侧边栏')
  }
  const probe = await readPanelToggleProbe(page)
  expect(probe.contextsSeen).toBeGreaterThan(0)
  expect(probe.changedContextKeys).toEqual([])
})
