import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  COMPACT_VIEWPORT,
  DESKTOP_VIEWPORT,
  STABLE_SCREENSHOT_OPTIONS,
  V6_VISUAL_BASELINES_ENABLED,
  VISUAL_MODES,
  expectNoHorizontalOverflow,
  prepareVisualTheme,
  waitForVisualPage,
  type VisualMode,
} from './VisualTestHelpers.js'

const visualTest = V6_VISUAL_BASELINES_ENABLED ? test : test.skip

const SETTINGS_TABS = [
  { id: 'general', label: '常规' },
  { id: 'profile', label: '个人资料' },
  { id: 'appearance', label: '外观' },
  { id: 'pets', label: '宠物' },
  { id: 'config', label: '配置' },
  { id: 'personalization', label: '个性化' },
  { id: 'memory', label: '记忆' },
  { id: 'shortcuts', label: '键盘快捷键' },
  { id: 'billing', label: '用量与成本' },
  { id: 'plugins', label: '插件' },
  { id: 'browser', label: '浏览器' },
  { id: 'git', label: 'Git' },
  { id: 'archived', label: '已归档对话' },
] as const

type ButtonVisualContract = {
  height: string
  borderRadius: string
  paddingInline: string
  fontSize: string
  borderWidth: string
  borderStyle: string
  borderColor: string
  backgroundColor: string
  color: string
  boxShadow: string
}

async function readButtonVisualContract(locator: Locator): Promise<ButtonVisualContract> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      height: style.height,
      borderRadius: style.borderRadius,
      paddingInline: `${style.paddingLeft} ${style.paddingRight}`,
      fontSize: style.fontSize,
      borderWidth: `${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth}`,
      borderStyle: `${style.borderTopStyle} ${style.borderRightStyle} ${style.borderBottomStyle} ${style.borderLeftStyle}`,
      borderColor: `${style.borderTopColor} ${style.borderRightColor} ${style.borderBottomColor} ${style.borderLeftColor}`,
      backgroundColor: style.backgroundColor,
      color: style.color,
      boxShadow: style.boxShadow,
    }
  })
}

async function resolveColorToken(page: Page, token: string): Promise<string> {
  return page.evaluate((customProperty) => {
    const probe = document.createElement('span')
    probe.style.backgroundColor = `var(${customProperty})`
    document.body.append(probe)
    const value = getComputedStyle(probe).backgroundColor
    probe.remove()
    return value
  }, token)
}

async function resolveTextColorToken(page: Page, token: string): Promise<string> {
  return page.evaluate((customProperty) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${customProperty})`
    document.body.append(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  }, token)
}

test('appearance cards share the settings content grid', async ({ page }) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await prepareVisualTheme(page, 'light')
  await page.goto('/?visualCase=empty#/settings/appearance')
  await waitForVisualPage(page, 'light', page.getByRole('heading', { name: '外观' }))
  await page.getByRole('button', { name: '高级', exact: true }).click()

  const cardAlignment = await page.evaluate(() => {
    const themeCard = document.querySelector<HTMLElement>('.appearance-theme-editor')!
    const preferenceCard = document.querySelector<HTMLElement>(
      '.appearance-settings > .settings-section:last-child .settings-card',
    )!
    const themeRows = [
      themeCard.querySelector<HTMLElement>(':scope > .settings-row')!,
      themeCard.querySelector<HTMLElement>('.appearance-theme-editor-rows > .settings-row')!,
    ]
    const preferenceRow = preferenceCard.querySelector<HTMLElement>('.settings-row')!
    const themeBounds = themeCard.getBoundingClientRect()
    const preferenceBounds = preferenceCard.getBoundingClientRect()
    return {
      leftDelta: Math.abs(themeBounds.left - preferenceBounds.left),
      widthDelta: Math.abs(themeBounds.width - preferenceBounds.width),
      themePadding: themeRows.map((row) => getComputedStyle(row).paddingInline),
      preferencePadding: getComputedStyle(preferenceRow).paddingInline,
    }
  })
  expect(cardAlignment.leftDelta).toBeLessThan(0.5)
  expect(cardAlignment.widthDelta).toBeLessThan(0.5)
  expect(cardAlignment.themePadding).toEqual(['16px', '16px'])
  expect(cardAlignment.preferencePadding).toBe('16px')
})

for (const mode of VISUAL_MODES) {
  for (const tab of SETTINGS_TABS) {
    visualTest(`settings ${tab.id} ${mode}`, async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT)
      await prepareVisualTheme(page, mode)
      await page.goto(`/?visualCase=empty#/settings/${tab.id}`)
      const activeTab = page.locator('.settings-nav-item').filter({ hasText: tab.label })
      await waitForVisualPage(page, mode, activeTab)
      await expect(activeTab).toHaveClass(/\bactive\b/)
      await expect(page.locator('.settings-content-scroll-area')).toBeVisible()
      await expect(page.locator('body')).toHaveScreenshot(
        `settings-${tab.id}-${mode}-1440x920.png`,
        {
          ...STABLE_SCREENSHOT_OPTIONS,
          fullPage: true,
        },
      )
      await expectNoHorizontalOverflow(page)
    })
  }
}

for (const mode of VISUAL_MODES) {
  visualTest(`action buttons use one visual contract ${mode}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await prepareVisualTheme(page, mode)

    const cases = [
      {
        route: '/?visualCase=empty#/settings/general',
        name: '导入',
      },
      {
        route: '/?visualCase=empty#/settings/pets',
        name: '打开宠物商店',
      },
      {
        route: '/?visualCase=empty#/settings/providers',
        name: '新增自定义 Provider',
      },
    ] as const

    const contracts: ButtonVisualContract[] = []
    for (const item of cases) {
      await page.goto(item.route)
      const button = page.getByRole('button', { name: item.name, exact: true })
      await waitForVisualPage(page, mode, button)
      await expect(button).toBeVisible()
      contracts.push(await readButtonVisualContract(button))
    }

    expect(contracts[1]).toEqual(contracts[0])
    expect(contracts[2]).toEqual(contracts[0])

    const normalButton = page.getByRole('button', {
      name: '新增自定义 Provider',
      exact: true,
    })
    const neutralBackground = await resolveColorToken(page, '--color-background-button-secondary')
    const oldPrimaryBackground = await resolveColorToken(page, '--color-background-button-primary')
    const foreground = await resolveTextColorToken(page, '--color-token-foreground')
    expect(contracts[2]?.backgroundColor).toBe(neutralBackground)
    expect(contracts[2]?.color).toBe(foreground)
    expect(contracts[2]?.boxShadow).toBe('none')
    if (mode === 'light') {
      expect(contracts[2]?.backgroundColor).not.toBe(oldPrimaryBackground)
    }

    const restingBackground = contracts[2]?.backgroundColor
    await normalButton.hover()
    await expect
      .poll(async () => (await readButtonVisualContract(normalButton)).backgroundColor)
      .not.toBe(restingBackground)
    const hoverContract = await readButtonVisualContract(normalButton)
    expect(hoverContract.color).toBe(foreground)
    expect(hoverContract.boxShadow).toBe('none')

    await normalButton.focus()
    const focusOutline = await normalButton.evaluate((element) => {
      const style = getComputedStyle(element)
      return `${style.outlineStyle} ${style.outlineWidth}`
    })
    expect(focusOutline).not.toBe('none 0px')
    const focusContract = await readButtonVisualContract(normalButton)
    expect(focusContract.color).toBe(foreground)
    expect(focusContract.boxShadow).toBe('none')

    await normalButton.evaluate((element) => {
      element.setAttribute('data-selected', 'true')
    })
    const selectedContract = await readButtonVisualContract(normalButton)
    expect(selectedContract.color).toBe(foreground)
    expect(selectedContract.boxShadow).toBe('none')

    await normalButton.evaluate((element) => {
      element.removeAttribute('data-selected')
      element.setAttribute('data-tone', 'danger')
    })
    const dangerContract = await readButtonVisualContract(normalButton)
    expect(dangerContract.borderColor).not.toBe(contracts[2]?.borderColor)
    expect(dangerContract.boxShadow).toBe('none')

    await normalButton.evaluate((element) => {
      element.removeAttribute('data-tone')
      ;(element as HTMLButtonElement).disabled = true
    })
    const disabledOpacity = await normalButton.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).opacity),
    )
    expect(disabledOpacity).toBeLessThan(1)
    expect((await readButtonVisualContract(normalButton)).boxShadow).toBe('none')
  })
}
for (const mode of VISUAL_MODES) {
  visualTest(`settings appearance ${mode} compact`, async ({ page }) => {
    await page.setViewportSize(COMPACT_VIEWPORT)
    await prepareVisualTheme(page, mode)
    await page.goto('/?visualCase=empty#/settings/appearance')
    await waitForVisualPage(page, mode, page.getByRole('heading', { name: '外观' }))

    const selectedThemeVisual = page.locator(
      '.appearance-mode-card[data-state="checked"] .appearance-mode-visual',
    )
    await expect(selectedThemeVisual).toHaveCSS('border-top-width', '2px')
    await expect(selectedThemeVisual).toHaveCSS('box-shadow', 'none')
    await page.getByRole('button', { name: '高级', exact: true }).click()

    const diffMarkerGroup = page.getByRole('radiogroup', {
      name: '差异标记选项',
    })
    await expect(diffMarkerGroup).toHaveAttribute('data-variant', 'default')
    const diffMarkerChrome = await diffMarkerGroup.evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        paddingTop: style.paddingTop,
      }
    })
    expect(diffMarkerChrome.paddingTop).toBe('0px')
    expect(diffMarkerChrome.backgroundColor).toBe('rgba(0, 0, 0, 0)')

    const selectedDiffMarker = diffMarkerGroup.locator('.segmented-control-item[data-state="on"]')
    await expect(selectedDiffMarker).toHaveCSS('border-radius', '8px')
    await expect(selectedDiffMarker).toHaveCSS(
      'background-color',
      await resolveColorToken(page, '--color-token-list-active-selection-background'),
    )
    await expect(selectedDiffMarker).toHaveCSS('box-shadow', 'none')

    const pointerSwitchThumb = page
      .getByRole('switch', { name: '使用指针光标' })
      .locator('.toggle-knob')
    await expect
      .poll(() => pointerSwitchThumb.evaluate((element) => getComputedStyle(element).boxShadow))
      .not.toBe('none')

    await expect(page.locator('body')).toHaveScreenshot(`settings-appearance-${mode}-960x640.png`, {
      ...STABLE_SCREENSHOT_OPTIONS,
      fullPage: true,
    })
    await expectNoHorizontalOverflow(page)
  })
}

for (const mode of VISUAL_MODES) {
  visualTest(`appearance controls and previews stay stable ${mode}`, async ({ page }) => {
    await page.setViewportSize(COMPACT_VIEWPORT)
    await prepareVisualTheme(page, mode)
    await page.goto('/?visualCase=empty#/settings/appearance')
    await waitForVisualPage(page, mode, page.getByRole('heading', { name: '外观' }))

    const modeCards = page.locator('.appearance-mode-card')
    await expect(modeCards).toHaveCount(3)
    for (let index = 0; index < 3; index += 1) {
      const card = modeCards.nth(index)
      const beforeHover = await card.evaluate((element) => {
        const visual = element.querySelector<HTMLElement>('.appearance-mode-visual')!
        const label = element.querySelector<HTMLElement>('.appearance-mode-label')!
        const visualStyle = getComputedStyle(visual)
        return {
          backgroundColor: visualStyle.backgroundColor,
          backgroundImage: visualStyle.backgroundImage,
          borderColor: visualStyle.borderColor,
          labelColor: getComputedStyle(label).color,
        }
      })
      await card.hover()
      await expect
        .poll(() =>
          card.evaluate((element) => {
            const visual = element.querySelector<HTMLElement>('.appearance-mode-visual')!
            const label = element.querySelector<HTMLElement>('.appearance-mode-label')!
            const visualStyle = getComputedStyle(visual)
            return {
              backgroundColor: visualStyle.backgroundColor,
              backgroundImage: visualStyle.backgroundImage,
              borderColor: visualStyle.borderColor,
              labelColor: getComputedStyle(label).color,
            }
          }),
        )
        .toEqual(beforeHover)
    }

    const pointerSwitch = page.getByRole('switch', { name: '使用指针光标' })
    await page.getByRole('button', { name: '高级', exact: true }).click()
    const pointerSwitchThumb = pointerSwitch.locator('.toggle-knob')
    const expectCenteredThumb = async (): Promise<void> => {
      await expect
        .poll(() =>
          pointerSwitch.evaluate((element) => {
            const track = element.getBoundingClientRect()
            const thumb = element
              .querySelector<HTMLElement>('.toggle-knob')!
              .getBoundingClientRect()
            const checked = element.getAttribute('data-state') === 'checked'
            return {
              edgeGap: checked ? track.right - thumb.right : thumb.left - track.left,
              topGap: thumb.top - track.top,
              bottomGap: track.bottom - thumb.bottom,
            }
          }),
        )
        .toEqual({
          edgeGap: 2,
          topGap: 2,
          bottomGap: 2,
        })
    }
    const expectedThumbColor = 'rgb(255, 255, 255)'
    await expect(pointerSwitchThumb).toHaveCSS('background-color', expectedThumbColor)
    await expectCenteredThumb()
    await pointerSwitch.click()
    await expect(pointerSwitch).toHaveAttribute('data-state', 'checked')
    await expect(pointerSwitchThumb).toHaveCSS('background-color', expectedThumbColor)
    await expectCenteredThumb()

    const contrastSlider = page.getByRole('slider', {
      name: mode === 'light' ? '浅色对比度' : '深色对比度',
    })
    await expect
      .poll(() =>
        contrastSlider.evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--control-thumb-fill').trim(),
        ),
      )
      .toBe('#ffffff')
  })
}

const CONTRAST_BOUNDARIES = [0, 45, 60, 100] as const

for (const contrast of CONTRAST_BOUNDARIES) {
  visualTest(`appearance contrast ${contrast}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await prepareVisualTheme(page, 'dark', { contrast })
    await page.goto('/?visualCase=empty#/settings/appearance')
    await page.getByRole('button', { name: '高级', exact: true }).click()
    await waitForVisualPage(page, 'dark', page.getByRole('slider', { name: '深色对比度' }))
    await expect(page.getByRole('slider', { name: '深色对比度' })).toHaveValue(String(contrast))
    await expect(page.locator('body')).toHaveScreenshot(
      `settings-appearance-dark-contrast-${contrast}.png`,
      {
        ...STABLE_SCREENSHOT_OPTIONS,
        fullPage: true,
      },
    )
  })
}

for (const preset of [
  { id: 'font-min', uiFontSize: 11, codeFontSize: 8 },
  { id: 'font-max', uiFontSize: 16, codeFontSize: 24 },
] as const) {
  visualTest(`appearance ${preset.id}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await prepareVisualTheme(page, 'light', preset)
    await page.goto('/?visualCase=empty#/settings/appearance')
    await page.getByRole('button', { name: '高级', exact: true }).click()
    await waitForVisualPage(page, 'light', page.getByRole('spinbutton', { name: '界面字号' }))
    await expect(page.getByRole('spinbutton', { name: '界面字号' })).toHaveValue(
      String(preset.uiFontSize),
    )
    await expect(page.getByRole('spinbutton', { name: '代码字号' })).toHaveValue(
      String(preset.codeFontSize),
    )
    await expect(page.locator('body')).toHaveScreenshot(
      `settings-appearance-light-${preset.id}.png`,
      {
        ...STABLE_SCREENSHOT_OPTIONS,
        fullPage: true,
      },
    )
  })
}

for (const reduceMotion of ['on', 'off'] as const) {
  visualTest(`appearance reduced motion ${reduceMotion}`, async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await prepareVisualTheme(page, 'dark', { reduceMotion })
    await page.goto('/?visualCase=empty#/settings/appearance')
    await page.getByRole('button', { name: '高级', exact: true }).click()
    await waitForVisualPage(page, 'dark', page.getByRole('group', { name: '减少动态效果选项' }))
    await expect(page.locator('html')).toHaveAttribute('data-reduce-motion', reduceMotion)
    await expect(page.locator('body')).toHaveScreenshot(
      `settings-appearance-dark-motion-${reduceMotion}.png`,
      {
        ...STABLE_SCREENSHOT_OPTIONS,
        fullPage: true,
      },
    )
  })
}
