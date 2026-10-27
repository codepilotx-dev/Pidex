import { expect, test } from '@playwright/test'
import { prepareVisualTheme, waitForVisualPage } from './VisualTestHelpers.js'

test('trigger width follows the selected model with a smooth transition', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })
  await page.goto('?visualCase=permission&visualModelPicker=1#/threads/visual-permission')

  const trigger = page.locator('.composer-model-trigger-capsule:visible')
  await waitForVisualPage(page, 'dark', trigger)

  const shortBox = await trigger.boundingBox()
  expect(shortBox).not.toBeNull()
  expect(Math.round(shortBox!.width)).toBeLessThan(200)

  await trigger.locator('.composer-model-trigger-name-btn').click()
  const panel = page.locator('.composer-model-panel')
  await expect(panel).toBeVisible()

  await page.evaluate(() => {
    const element = document.querySelector('.composer-model-trigger-capsule') as HTMLElement
    const samples: number[] = []
    ;(window as unknown as { __widths: number[] }).__widths = samples
    const start = performance.now()
    const tick = () => {
      samples.push(element.getBoundingClientRect().width)
      if (performance.now() - start < 700) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  await panel
    .locator('.composer-model-row', { hasText: 'workbuddy/deepseek-v4.1-flash' })
    .click()
  await expect(panel).toHaveCount(0)
  await page.waitForTimeout(500)

  const widths = await page.evaluate(
    () => (window as unknown as { __widths: number[] }).__widths,
  )
  console.log('width range', Math.round(Math.min(...widths)), Math.round(Math.max(...widths)))
  expect(Math.max(...widths) - Math.min(...widths)).toBeGreaterThan(40)

  const longState = await trigger.evaluate((element) => {
    const name = element.querySelector('.composer-model-trigger-name') as HTMLElement
    const model = element.querySelector('.composer-model-trigger-name-model') as HTMLElement
    const prefix = element.querySelector('.composer-model-trigger-name-prefix') as HTMLElement | null
    return {
      width: Math.round(element.getBoundingClientRect().width),
      text: name.textContent?.trim() ?? '',
      modelClipped: model.scrollWidth > model.clientWidth + 1,
      prefixClipped: prefix ? prefix.scrollWidth > prefix.clientWidth + 1 : false,
    }
  })
  console.log('long', JSON.stringify(longState))
  expect(longState.text).toBe('workbuddy/deepseek-v4.1-flash')
  expect(longState.modelClipped).toBe(false)
  expect(longState.prefixClipped).toBe(false)
  expect(longState.width).toBeLessThanOrEqual(256)
  await page.screenshot({ path: 'test-results/model-trigger-long.png' })
})
