import { expect, test } from '@playwright/test'
import { prepareVisualTheme, waitForVisualPage } from './VisualTestHelpers.js'

test('appearance mode changes from cards and keyboard and persists', async ({ page }) => {
  await prepareVisualTheme(page, 'dark')
  await page.goto('/?visualCase=empty#/settings/appearance')
  await page.getByRole('button', { name: '稍后', exact: true }).click()
  await waitForVisualPage(page, 'dark', page.getByRole('heading', { name: '外观' }))

  const group = page.getByRole('radiogroup', { name: '外观模式' })
  for (const target of ['.appearance-mode-label', '.appearance-mode-visual']) {
    for (const mode of ['light', 'dark', 'system'] as const) {
      const card = group.locator(`[data-mode="${mode}"]`)
      const cardBounds = await card.boundingBox()
      const inputBounds = await card.locator('input').boundingBox()
      expect(inputBounds).toEqual(cardBounds)
      const targetBounds = await card.locator(target).boundingBox()
      await card.click({
        position: {
          x: targetBounds!.x + targetBounds!.width / 2 - cardBounds!.x,
          y: targetBounds!.y + targetBounds!.height / 2 - cardBounds!.y,
        },
      })
      await expect(card.locator('input')).toBeChecked()
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        mode === 'system' ? 'dark' : mode,
      )
      await expect
        .poll(() =>
          page.evaluate(
            () => JSON.parse(localStorage.getItem('pidex.desktop.appearance.v6') ?? '{}').mode,
          ),
        )
        .toBe(mode)
    }
  }

  await group.getByRole('radio', { name: '系统', exact: true }).press('ArrowRight')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(group.getByRole('radio', { name: '浅色', exact: true })).toBeFocused()
})
