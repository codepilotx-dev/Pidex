import { expect, test } from '@playwright/test'
import { prepareVisualTheme, waitForVisualPage } from './VisualTestHelpers.js'

const THEME_STORAGE_KEY = 'pidex.desktop.appearance.v8'

test('theme font inputs preserve rapid edits and keyboard semantics', async ({ page }) => {
  await prepareVisualTheme(page, 'dark')
  await page.goto('/?visualCase=empty#/settings/appearance')
  await page.getByRole('button', { name: '稍后', exact: true }).click()
  await waitForVisualPage(page, 'dark', page.getByRole('heading', { name: '外观' }))

  let uiFont = page.getByRole('textbox', { name: '界面字体' })
  let codeFont = page.getByRole('textbox', { name: '代码字体' })

  await uiFont.fill('Inter, sans-serif')
  await uiFont.press('Tab')
  await uiFont.focus()
  await uiFont.fill('discard before theme prop settles')
  await uiFont.press('Escape')
  await expect(uiFont).toHaveValue('Inter, sans-serif')

  await codeFont.fill('"JetBrains Mono", monospace')
  await codeFont.press('Enter')

  await expect
    .poll(async () =>
      page.evaluate((storageKey) => {
        const raw = localStorage.getItem(storageKey)
        if (!raw) return null
        const settings = JSON.parse(raw)
        return settings.fonts
      }, THEME_STORAGE_KEY),
    )
    .toEqual({
      ui: 'Inter, sans-serif',
      uiFace: null,
      code: '"JetBrains Mono", monospace',
      codeFace: null,
    })

  const restoredPage = await page.context().newPage()
  await restoredPage.goto('/?visualCase=empty#/settings/appearance')
  uiFont = restoredPage.getByRole('textbox', { name: '界面字体' })
  codeFont = restoredPage.getByRole('textbox', { name: '代码字体' })
  await restoredPage.getByRole('button', { name: '稍后', exact: true }).click()
  await waitForVisualPage(restoredPage, 'dark', uiFont)
  await expect(uiFont).toHaveValue('Inter, sans-serif')
  await expect(codeFont).toHaveValue('"JetBrains Mono", monospace')

  await uiFont.focus()
  await uiFont.selectText()
  await expect
    .poll(() =>
      uiFont.evaluate((input) => ({
        end: input.selectionEnd,
        start: input.selectionStart,
      })),
    )
    .toEqual({ start: 0, end: 'Inter, sans-serif'.length })

  await uiFont.fill('discard this value')
  await uiFont.press('Escape')
  await expect(uiFont).toHaveValue('Inter, sans-serif')
})
