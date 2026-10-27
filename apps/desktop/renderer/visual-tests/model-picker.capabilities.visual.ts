import { expect, test } from '@playwright/test'
import { prepareVisualTheme, waitForVisualPage } from './VisualTestHelpers.js'

test('hover turns the selected row into capability tags and hides its check', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 760 })
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })
  await page.goto('?visualCase=permission&visualModelPicker=1#/threads/visual-permission')

  const trigger = page.locator('.composer-model-trigger-capsule:visible')
  await waitForVisualPage(page, 'dark', trigger)

  // 触发器宽度跟随内容、封顶 16rem；短名称不撑出空白。
  const capsuleBox = await trigger.boundingBox()
  expect(capsuleBox).not.toBeNull()
  expect(Math.round(capsuleBox!.width)).toBeLessThan(256)
  expect(Math.round(capsuleBox!.width)).toBeGreaterThan(0)
  await expect(trigger).toHaveCSS('max-width', '256px')

  await trigger.locator('.composer-model-trigger-name-btn').click()
  const panel = page.locator('.composer-model-panel')
  await expect(panel).toBeVisible()

  const row = panel.locator('.composer-model-row').first()
  const tags = row.locator('.composer-model-capabilities')
  const chips = tags.locator('.composer-model-capability')

  // 推理强度只在输入框触发器上调整，行内不再重复渲染胶囊。
  await expect(panel.locator('.composer-effort-pill')).toHaveCount(0)

  // 静止状态保留选中勾，能力标签不占位。
  await expect(tags).toBeHidden()
  await expect(row.locator('.composer-model-row-mark')).toBeVisible()

  const rowGeometry = () =>
    panel.locator('.composer-model-row').evaluateAll((rows) =>
      rows.map((element) => {
        const rect = element.getBoundingClientRect()
        return { top: Math.round(rect.top), height: Math.round(rect.height) }
      }),
    )
  // 等浮层入场动画结束后再取基准，避免把动画位移当成悬停抖动。
  await page.waitForTimeout(300)
  const restingRows = await rowGeometry()
  // 所有行（选中/未选中）保持同一高度，悬停时不能推动后续行。
  expect(new Set(restingRows.map((item) => item.height)).size).toBe(1)

  await row.hover()

  // 悬停时能力标签出现，勾选让位，但行高与位置保持不变。
  await expect(tags).toBeVisible()
  await expect(chips).toHaveCount(3)
  await expect(chips.nth(0)).toHaveText('1M')
  await expect(chips.nth(1)).toHaveAttribute('aria-label', '视觉')
  await expect(chips.nth(2)).toHaveAttribute('aria-label', '推理')
  await expect(row.locator('.composer-model-row-mark')).toBeHidden()
  expect(await rowGeometry()).toEqual(restingRows)

  await page.screenshot({ path: 'test-results/model-picker-capabilities.png' })
})
