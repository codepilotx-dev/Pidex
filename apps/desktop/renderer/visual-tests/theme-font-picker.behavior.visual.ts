import { expect, test } from '@playwright/test'
import {
  COMPACT_VIEWPORT,
  DESKTOP_VIEWPORT,
  expectNoHorizontalOverflow,
  prepareVisualTheme,
  waitForVisualPage,
} from './VisualTestHelpers.js'

const THEME_STORAGE_KEY = 'pidex.desktop.appearance.v8'

const MOCK_FONTS = [
  { family: 'Inter', fullName: 'Inter Regular', postscriptName: 'Inter-Regular', style: 'Regular' },
  { family: 'Inter', fullName: 'Inter Bold', postscriptName: 'Inter-Bold', style: 'Bold' },
  { family: 'Inter', fullName: 'Inter Italic', postscriptName: 'Inter-Italic', style: 'Italic' },
  {
    family: 'PrettySans',
    fullName: 'PrettySans Regular',
    postscriptName: 'PrettySans-Regular',
    style: 'Regular',
  },
  {
    family: 'CodeMono',
    fullName: 'CodeMono Regular',
    postscriptName: 'CodeMono-Regular',
    style: 'Regular',
  },
  { family: 'CodeMono', fullName: 'CodeMono Bold', postscriptName: 'CodeMono-Bold', style: 'Bold' },
] as const

function installFontBridge(
  page: import('@playwright/test').Page,
  options: {
    delayMs?: number
    result?:
      | { ok: true; fonts: readonly (typeof MOCK_FONTS)[number][] }
      | { ok: false; error: 'unsupported' | 'denied' | 'failed' }
  },
): Promise<void> {
  return page.addInitScript(
    ({ fonts, delayMs, result }) => {
      ;(window as unknown as { DesktopBridge?: unknown }).DesktopBridge = {
        listSystemFonts: async () => {
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs))
          }
          if (result && !result.ok) return result
          return { ok: true, fonts }
        },
      }
      // Deterministic canvas glyph measurement: families containing "Mono"
      // behave monospaced, everything else proportional.
      const originalGetContext = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === '2d') {
          const context = { font: '', measureText: () => ({ width: 0 }) }
          context.measureText = (text: string) => ({
            width: /Mono/.test(context.font)
              ? text.length * 8
              : (text.startsWith('m') ? 14 : 5) * text.length,
          })
          return context as unknown as CanvasRenderingContext2D
        }
        return originalGetContext.call(this, type, ...args)
      }
    },
    { fonts: MOCK_FONTS, delayMs: options.delayMs ?? 0, result: options.result },
  )
}

async function expectTriggerContentFits(
  trigger: import('@playwright/test').Locator,
): Promise<void> {
  await expect
    .poll(() =>
      trigger.evaluate((element) => {
        const value = element.querySelector<HTMLElement>('.settings-dropdown-value')!
        return (
          element.scrollWidth === element.clientWidth && value.scrollWidth === value.clientWidth
        )
      }),
    )
    .toBe(true)
}

test('theme font picker enumerates, filters, searches, and persists family + face', async ({
  page,
}) => {
  await installFontBridge(page, { delayMs: 400 })
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await prepareVisualTheme(page, 'dark')
  await page.goto('/?visualCase=empty#/settings/appearance')
  await waitForVisualPage(page, 'dark', page.getByRole('heading', { name: '外观' }))

  const familyTrigger = page.getByRole('button', {
    name: '界面字体字体家族',
  })
  await expect(familyTrigger).toBeVisible()
  await expect(familyTrigger).toHaveCSS('height', '28px')
  await expect(familyTrigger).toHaveText('系统默认')
  const defaultFamilyWidth = (await familyTrigger.boundingBox())!.width
  await expectTriggerContentFits(familyTrigger)

  // Opening the dropdown fetches the enumeration and shows a busy state.
  await familyTrigger.click()
  await expect(page.getByText('正在加载字体…')).toBeVisible()
  await expect(page.getByRole('option', { name: '系统默认' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Inter' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'PrettySans' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'CodeMono' })).toBeVisible()

  // Keyboard search narrows the list; Enter commits and returns focus.
  await page.keyboard.type('Code')
  await expect(page.getByRole('option', { name: 'CodeMono' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Inter' })).toHaveCount(0)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(familyTrigger).toHaveText('CodeMono')
  await expect(familyTrigger).toBeFocused()
  await expect
    .poll(async () => (await familyTrigger.boundingBox())!.width)
    .not.toBe(defaultFamilyWidth)
  await expectTriggerContentFits(familyTrigger)

  // Selecting a family with several faces enables the style dropdown.
  const styleTrigger = page.getByRole('combobox', {
    name: '界面字体字体样式',
  })
  await expect(styleTrigger).toBeEnabled()
  await expect(styleTrigger).toHaveText('常规')
  await expectTriggerContentFits(styleTrigger)
  await styleTrigger.click()
  await expect(page.getByRole('option', { name: '粗体' })).toBeVisible()
  await expect(page.getByRole('option', { name: '斜体' })).toBeVisible()
  await page.getByRole('option', { name: '粗体' }).click()

  // The non-default face is persisted with its postscript identity.
  await expect
    .poll(() =>
      page.evaluate((storageKey) => {
        const raw = localStorage.getItem(storageKey)
        if (!raw) return null
        return JSON.parse(raw).fonts
      }, THEME_STORAGE_KEY),
    )
    .toEqual({
      ui: 'CodeMono',
      uiFace: {
        family: 'CodeMono',
        fullName: 'CodeMono Bold',
        postscriptName: 'CodeMono-Bold',
      },
      code: null,
      codeFace: null,
    })

  // Switching back to the default face saves family-only.
  await styleTrigger.click()
  await page.getByRole('option', { name: '常规', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate((storageKey) => {
        const raw = localStorage.getItem(storageKey)
        if (!raw) return null
        return JSON.parse(raw).fonts
      }, THEME_STORAGE_KEY),
    )
    .toEqual({
      ui: 'CodeMono',
      uiFace: null,
      code: null,
      codeFace: null,
    })

  // A family with a single face keeps the style dropdown disabled.
  await familyTrigger.click()
  await page.getByRole('option', { name: 'PrettySans' }).click()
  await expect(styleTrigger).toBeDisabled()
  await familyTrigger.click()
  await page.getByRole('option', { name: 'CodeMono' }).click()
  await expect(styleTrigger).toBeEnabled()

  // Code font families are filtered to monospace ones only.
  const codeTrigger = page.getByRole('button', {
    name: '代码字体字体家族',
  })
  await codeTrigger.click()
  await expect(page.getByRole('option', { name: 'CodeMono' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Inter' })).toHaveCount(0)
  await expect(page.getByRole('option', { name: 'PrettySans' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(codeTrigger).toBeFocused()

  // The font is shared: switching the mode does not fork the value, and both
  // variants keep mirroring the single shared setting.
  await page
    .getByRole('radiogroup', { name: '外观模式' })
    .getByRole('radio', { name: '浅色' })
    .click()
  const lightFamilyTrigger = page.getByRole('button', {
    name: '界面字体字体家族',
  })
  await expect(lightFamilyTrigger).toHaveText('CodeMono')
  await lightFamilyTrigger.click()
  await page.getByRole('option', { name: 'Inter' }).click()
  await expect
    .poll(() =>
      page.evaluate((storageKey) => {
        const raw = localStorage.getItem(storageKey)
        if (!raw) return null
        const settings = JSON.parse(raw)
        return {
          shared: settings.fonts,
          light: settings.chromeThemes.light.fonts,
          dark: settings.chromeThemes.dark.fonts,
        }
      }, THEME_STORAGE_KEY),
    )
    .toEqual({
      shared: {
        code: null,
        codeFace: null,
        ui: 'Inter',
        uiFace: null,
      },
      light: {
        code: null,
        codeFace: null,
        ui: 'Inter',
        uiFace: null,
      },
      dark: {
        code: null,
        codeFace: null,
        ui: 'Inter',
        uiFace: null,
      },
    })

  // System default clears the family and any face.
  await lightFamilyTrigger.click()
  await page.getByRole('option', { name: '系统默认' }).click()
  await expect
    .poll(() =>
      page.evaluate((storageKey) => {
        const raw = localStorage.getItem(storageKey)
        if (!raw) return null
        return JSON.parse(raw).fonts
      }, THEME_STORAGE_KEY),
    )
    .toEqual({
      ui: null,
      uiFace: null,
      code: null,
      codeFace: null,
    })

  await expectNoHorizontalOverflow(page)
})

test('theme font picker keeps its compact layout on narrow windows', async ({ page }) => {
  await installFontBridge(page, {})
  await page.setViewportSize(COMPACT_VIEWPORT)
  await prepareVisualTheme(page, 'dark')
  await page.goto('/?visualCase=empty#/settings/appearance')
  await waitForVisualPage(page, 'dark', page.getByRole('heading', { name: '外观' }))

  await page.getByRole('button', { name: '界面字体字体家族' }).click()
  await expect(page.getByRole('option', { name: 'Inter' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('theme font picker degrades to the free-text input when enumeration fails', async ({
  page,
}) => {
  await installFontBridge(page, {
    result: { ok: false, error: 'denied' },
  })
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await prepareVisualTheme(page, 'dark')
  await page.goto('/?visualCase=empty#/settings/appearance')
  await waitForVisualPage(page, 'dark', page.getByRole('heading', { name: '外观' }))

  await page.getByRole('button', { name: '界面字体字体家族' }).click()
  const textInput = page.getByRole('textbox', { name: '界面字体' })
  await expect(textInput).toBeVisible()
  await textInput.fill('Inter, sans-serif')
  await textInput.press('Enter')
  await expect
    .poll(() =>
      page.evaluate((storageKey) => {
        const raw = localStorage.getItem(storageKey)
        if (!raw) return null
        return JSON.parse(raw).fonts
      }, THEME_STORAGE_KEY),
    )
    .toEqual({
      ui: 'Inter, sans-serif',
      uiFace: null,
      code: null,
      codeFace: null,
    })
  await expectNoHorizontalOverflow(page)
})
