import { expect, test } from '@playwright/test'
import { prepareVisualTheme, waitForVisualPage } from './VisualTestHelpers.js'

test('command menu opens from the sidebar, filters tasks, and selects a numbered result', async ({
  page,
}) => {
  await prepareVisualTheme(page, 'dark')
  await page.goto('/?visualCase=rich&visualSwitchTargets=1#/new')
  await waitForVisualPage(page, 'dark', page.locator('main'))

  const trigger = page.getByRole('button', { name: '搜索任务' })
  await trigger.click()

  const backdrop = page.locator('.command-menu-backdrop')
  const dialog = page.getByRole('dialog', { name: '任务命令菜单' })
  const input = page.getByRole('searchbox', { name: '搜索任务' })
  await expect(backdrop).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.48)')
  await expect(input).toBeFocused()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Codex 富消息工作台', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('img', { name: '任务正在运行' })).toBeVisible()

  await page.keyboard.press('ArrowDown')
  await expect(dialog.locator('[cmdk-item][data-value="task:visual-switch-c"]')).toHaveAttribute(
    'data-selected',
    'true',
  )

  await input.fill('B')
  await expect(input).toHaveValue('B')
  await expect(dialog.getByText('切换目标 B', { exact: true })).toBeVisible()
  await expect(dialog.getByText('新建对话', { exact: true })).toHaveCount(0)

  await page.keyboard.press('Control+1')
  await expect(page).toHaveURL(/#\/threads\/visual-switch-b$/u)
  await expect(page.getByRole('dialog', { name: '任务命令菜单' })).toHaveCount(0)
})

test('command menu restores focus and disables file search without a workspace', async ({
  page,
}) => {
  await prepareVisualTheme(page, 'light', { reduceMotion: 'off' })
  await page.goto('/?visualCase=empty#/new')
  await waitForVisualPage(page, 'light', page.locator('main'))

  const trigger = page.getByRole('button', { name: '搜索任务' })
  await trigger.click()
  const backdrop = page.locator('.command-menu-backdrop')
  const dialog = page.getByRole('dialog', { name: '任务命令菜单' })
  await expect(backdrop).toHaveCSS('background-color', 'rgba(0, 0, 0, 0.48)')
  await expect(dialog.getByText('暂无任务', { exact: true })).toBeVisible()
  const searchFiles = page.locator('[cmdk-item][data-value="recommendation:search-files"]')
  await expect(searchFiles).toHaveAttribute('data-disabled', 'true')
  await expect(searchFiles).toContainText('请先打开文件夹')

  await armClosedDialogLifecycleProbe(page)
  await page.keyboard.press('Escape')
  await expectClosedDialogLifecycle(page)
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await page.keyboard.press('Control+Shift+P')
  await expect(page.getByRole('searchbox', { name: '搜索任务' })).toBeFocused()

  await armClosedDialogLifecycleProbe(page)
  await backdrop.click({
    position: { x: 4, y: 4 },
  })
  await expectClosedDialogLifecycle(page)
  await expect(dialog).toHaveCount(0)
})

test('command menu supports hover, Enter, and the file-search shortcut', async ({ page }) => {
  await prepareVisualTheme(page, 'dark')
  await page.goto('/?visualCase=rich&visualSwitchTargets=1#/new')
  await waitForVisualPage(page, 'dark', page.locator('main'))

  await page.keyboard.press('Control+K')
  const target = page.locator('[cmdk-item][data-value="task:visual-switch-b"]')
  await target.hover()
  await expect(target).toHaveAttribute('data-selected', 'true')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/threads\/visual-switch-b$/u)

  await page.keyboard.press('Control+K')
  await expect(
    page.locator('[cmdk-item][data-value="recommendation:search-files"]'),
  ).not.toHaveAttribute('data-disabled', 'true')
  await page.keyboard.press('Control+P')
  await expect(page.getByRole('searchbox', { name: '筛选文件' })).toBeFocused()
})

type DialogLifecycleProbe = {
  backdropAnimationName: string
  backdropState: string | null
  dialogAnimationName: string
  dialogState: string | null
}

async function armClosedDialogLifecycleProbe(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const probeWindow = window as typeof window & {
      __dialogLifecycleProbe?: DialogLifecycleProbe
    }
    delete probeWindow.__dialogLifecycleProbe
    const dialog = document.querySelector('.command-menu-dialog')
    const backdrop = document.querySelector('.command-menu-backdrop')
    if (!dialog || !backdrop) throw new Error('命令菜单未打开')
    let dialogExitAnimationName = ''
    dialog.addEventListener('animationstart', (event) => {
      if (event.animationName === 'radix-floating-surface-out') {
        dialogExitAnimationName = event.animationName
        if (probeWindow.__dialogLifecycleProbe) {
          probeWindow.__dialogLifecycleProbe.dialogAnimationName = event.animationName
        }
      }
    })
    const observer = new MutationObserver(() => {
      if (
        dialog.getAttribute('data-state') !== 'closed' ||
        backdrop.getAttribute('data-state') !== 'closed'
      )
        return
      probeWindow.__dialogLifecycleProbe = {
        backdropAnimationName: getComputedStyle(backdrop).animationName,
        backdropState: backdrop.getAttribute('data-state'),
        dialogAnimationName: getComputedStyle(dialog).animationName || dialogExitAnimationName,
        dialogState: dialog.getAttribute('data-state'),
      }
      observer.disconnect()
    })
    observer.observe(dialog, {
      attributeFilter: ['data-state'],
      attributes: true,
    })
    observer.observe(backdrop, {
      attributeFilter: ['data-state'],
      attributes: true,
    })
  })
}

async function expectClosedDialogLifecycle(page: import('@playwright/test').Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __dialogLifecycleProbe?: DialogLifecycleProbe
            }
          ).__dialogLifecycleProbe,
      ),
    )
    .toEqual({
      backdropAnimationName: 'ui-dialog-backdrop-out',
      backdropState: 'closed',
      dialogAnimationName: 'radix-floating-surface-out',
      dialogState: 'closed',
    })
}
