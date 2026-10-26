import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { prepareVisualTheme, waitForVisualPage } from '../visual-tests/VisualTestHelpers.js'

const routes = [
  ['会话', '/?visualCase=rich#/threads/visual-rich'],
  ['审批', '/?visualCase=permission#/threads/visual-permission'],
  ['Review', '/?visualCase=review#/threads/visual-review'],
  ['新对话', '/?visualCase=empty#/new'],
  ['项目', '/?visualCase=empty#/projects'],
  ['Git', '/?visualCase=empty#/git'],
  ['工作流', '/?visualCase=empty#/workflows'],
  ['插件', '/?visualCase=empty#/plugins'],
  ['定时任务', '/?visualCase=empty#/automations'],
  ['宠物', '/?visualCase=empty#/pets'],
  ['外观', '/?visualCase=empty#/settings/appearance'],
  ['常规设置', '/?visualCase=empty#/settings/general'],
  ['Provider', '/?visualCase=empty#/settings/providers'],
  ['MCP', '/?visualCase=empty#/settings/plugins'],
  ['Worktree', '/?visualCase=empty#/settings/worktrees?tab=environments'],
] as const

async function checkTargets(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withRules(['target-size']).analyze()
  expect(results.violations).toEqual([])
  // A disabled or silently skipped rule must not produce a false green result.
  expect(results.passes.some(rule => rule.id === 'target-size')).toBe(true)
  expect(results.incomplete).toEqual([])
}

async function prepare(page: Page, route: string): Promise<void> {
  await prepareVisualTheme(page, 'light')
  await page.goto(route, { waitUntil: 'networkidle' })
  const later = page.getByRole('button', { name: '稍后', exact: true })
  if (await later.isVisible()) await later.click()
  await waitForVisualPage(page, 'light', page.locator('body'))
}

for (const [name, route] of routes) {
  test(`target-size: ${name}`, async ({ page }) => {
    await prepare(page, route)
    await checkTargets(page)
  })
}

test('target-size: opened command, product-mode and model menus', async ({ page }) => {
  await prepare(page, '/?visualCase=rich#/threads/visual-rich')
  await page.keyboard.press('Control+K')
  await expect(page.getByRole('searchbox', { name: '搜索任务' })).toBeVisible()
  await checkTargets(page)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /切换工作模式，当前为/ }).click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await checkTargets(page)
  await page.keyboard.press('Escape')
  await page.locator('.composer-model-trigger-name-btn').click()
  await expect(page.locator('.composer-model-panel-content')).toBeVisible()
  await checkTargets(page)
})

test('target-size: opened color picker', async ({ page }) => {
  await prepare(page, '/?visualCase=empty#/settings/appearance')
  await page.getByRole('button', { name: '浅色强调色颜色选择器' }).click()
  await expect(page.getByRole('dialog', { name: /浅色强调色/ })).toBeVisible()
  await checkTargets(page)
})
