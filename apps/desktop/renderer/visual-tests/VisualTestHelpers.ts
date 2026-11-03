import { expect, type Page } from '@playwright/test'

export const VISUAL_MODES = ['light', 'dark'] as const
export const V6_VISUAL_BASELINES_ENABLED = process.env.PIDEX_VISUAL_BASELINES_V6 === '1'

export type VisualMode = (typeof VISUAL_MODES)[number]

export const DESKTOP_VIEWPORT = { width: 1440, height: 920 } as const
export const COMPACT_VIEWPORT = { width: 960, height: 640 } as const

export const STABLE_SCREENSHOT_OPTIONS = {
  animations: 'disabled',
  caret: 'hide',
  scale: 'css',
} as const

type ThemeOverrides = {
  codeFontSize?: number
  contrast?: number
  reduceMotion?: 'system' | 'on' | 'off'
  uiFontSize?: number
}

export async function prepareVisualTheme(
  page: Page,
  mode: VisualMode,
  overrides: ThemeOverrides = {},
): Promise<void> {
  await page.emulateMedia({
    colorScheme: mode,
    forcedColors: 'none',
    reducedMotion: overrides.reduceMotion === 'off' ? 'no-preference' : 'reduce',
  })
  await page.addInitScript(
    ({ selectedMode, values }) => {
      const light = {
        accent: '#339cff',
        contrast: selectedMode === 'light' ? (values.contrast ?? 45) : 45,
        fonts: { code: null, ui: null },
        ink: '#111111',
        semanticColors: {
          diffAdded: '#00a240',
          diffRemoved: '#ba2623',
          skill: '#924ff7',
        },
        surface: '#f9f9f9',
      }
      const dark = {
        accent: '#339cff',
        contrast: selectedMode === 'dark' ? (values.contrast ?? 60) : 60,
        fonts: { code: null, ui: null },
        ink: '#f7f7f7',
        semanticColors: {
          diffAdded: '#40c977',
          diffRemoved: '#fa423e',
          skill: '#ad7bf9',
        },
        surface: '#111111',
      }
      localStorage.setItem(
        'pidex.desktop.appearance.v8',
        JSON.stringify({
          version: 8,
          mode: selectedMode,
          chromeThemes: { light, dark },
          codeThemeIds: {
            light: 'codex-light',
            dark: 'codex-dark',
          },
          fonts: { code: null, ui: null },
          pointerCursorEnabled: false,
          reduceMotion: values.reduceMotion ?? 'on',
          fontSmoothingEnabled: true,
          fontSizes: {
            code: values.codeFontSize ?? 13,
            ui: values.uiFontSize ?? 14,
          },
        }),
      )
    },
    { selectedMode: mode, values: overrides },
  )
}

export async function waitForVisualPage(
  page: Page,
  mode: VisualMode,
  readyLocator?: ReturnType<Page['locator']>,
): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
  await expect(page.locator('html')).toHaveAttribute(
    'data-code-theme-id',
    mode === 'light' ? 'codex-light' : 'codex-dark',
  )
  if (readyLocator) await expect(readyLocator).toBeVisible()
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      [...document.images]
        .filter((image) => !image.complete)
        .map(
          (image) =>
            new Promise<void>((resolve) => {
              image.addEventListener('load', () => resolve(), { once: true })
              image.addEventListener('error', () => resolve(), { once: true })
            }),
        ),
    )
  })
  await closeTransientErrorToast(page)
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
}

export async function closeTransientErrorToast(page: Page, waitForMilliseconds = 0): Promise<void> {
  const closeButton = page.getByRole('button', { name: '关闭错误提示' })
  const deadline = Date.now() + waitForMilliseconds
  do {
    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click().catch(() => undefined)
    }
    if (Date.now() >= deadline) return
    await page.waitForTimeout(100)
  } while (true)
}
