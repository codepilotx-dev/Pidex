import { expect, test, type Locator, type Page } from '@playwright/test'
import { prepareVisualTheme, waitForVisualPage } from './VisualTestHelpers.js'

type Metrics = {
  background: string
  border: string
  color: string
  fontSize: string
  height: number
  iconSize: number | null
  lineHeight: string
  width: number
}

async function metrics(locator: Locator): Promise<Metrics> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    const icon = element.querySelector(':scope > svg')?.getBoundingClientRect()
    return {
      background: style.backgroundColor,
      border: style.borderTopColor,
      color: style.color,
      fontSize: style.fontSize,
      height: box.height,
      iconSize: icon?.width ?? null,
      lineHeight: style.lineHeight,
      width: box.width,
    }
  })
}

async function installPrimitiveFixture(page: Page): Promise<void> {
  await page.evaluate(() => {
    const fixture = document.createElement('div')
    fixture.id = 'button-contract-fixture'
    fixture.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;display:flex;gap:4px'
    const sizes = [
      'default',
      'compact',
      'medium',
      'toolbar',
      'toolbarLabel',
      'composer',
      'icon',
      'iconMd',
      'iconSm',
      'tabStripAction',
    ]
    for (const size of sizes) {
      const button = document.createElement('button')
      button.className = 'ui-button icon-button'
      button.dataset.color = 'secondary'
      button.dataset.contentLayout = 'default'
      button.dataset.radius = 'default'
      button.dataset.size = size
      if (size.startsWith('icon') || size === 'tabStripAction') {
        button.dataset.uniform = 'true'
      }
      button.textContent = size
      if (size.startsWith('icon') || size === 'tabStripAction') {
        button.textContent = ''
        button.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 12h16" /></svg>'
      }
      fixture.append(button)
    }
    for (const color of ['primary', 'secondary', 'outline', 'ghost', 'danger', 'dangerSolid']) {
      const button = document.createElement('button')
      button.className = 'ui-button'
      button.dataset.color = color
      button.dataset.contractColor = color
      button.dataset.contentLayout = 'default'
      button.dataset.radius = 'default'
      button.dataset.size = 'toolbar'
      button.textContent = color
      fixture.append(button)
    }
    const returnButton = document.createElement('button')
    returnButton.className = 'composer-change-summary__return'
    returnButton.dataset.contract = 'return-to-bottom'
    fixture.append(returnButton)
    const changes = document.createElement('button')
    changes.className = 'composer-change-summary__changes'
    changes.textContent = '4 个文件已更改'
    fixture.append(changes)
    document.body.append(fixture)
  })
}

async function expectBox(locator: Locator, width: number, height = width): Promise<void> {
  const value = await metrics(locator)
  expect(value.width).toBe(width)
  expect(value.height).toBe(height)
}

for (const uiFontSize of [11, 16]) {
  test(`Codex button and chrome contracts stay fixed at UI ${uiFontSize}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 920 })
    await prepareVisualTheme(page, 'dark', { uiFontSize })
    await page.goto('/?visualCase=rich#/threads/visual-rich')
    await waitForVisualPage(page, 'dark', page.locator('[data-canonical-thread-id="visual-rich"]'))
    await installPrimitiveFixture(page)

    const fixture = page.locator('#button-contract-fixture')
    const bySize = (size: string) => fixture.locator(`[data-size="${size}"]`).first()
    await expectBox(
      bySize('default'),
      await bySize('default').evaluate((element) => element.getBoundingClientRect().width),
      24,
    )
    await expectBox(
      bySize('compact'),
      await bySize('compact').evaluate((element) => element.getBoundingClientRect().width),
      24,
    )
    await expectBox(
      bySize('medium'),
      await bySize('medium').evaluate((element) => element.getBoundingClientRect().width),
      32,
    )
    await expectBox(
      bySize('toolbar'),
      await bySize('toolbar').evaluate((element) => element.getBoundingClientRect().width),
      28,
    )
    await expectBox(
      bySize('toolbarLabel'),
      await bySize('toolbarLabel').evaluate((element) => element.getBoundingClientRect().width),
      28,
    )
    await expectBox(
      bySize('composer'),
      await bySize('composer').evaluate((element) => element.getBoundingClientRect().width),
      28,
    )
    await expectBox(bySize('icon'), 28)
    await expectBox(bySize('iconMd'), 20)
    await expectBox(bySize('iconSm'), 16)
    await expectBox(bySize('tabStripAction'), 34)

    const controlTypography = {
      fontSize: `${uiFontSize - 1}px`,
      lineHeight: `${uiFontSize + 4}px`,
    }
    expect(await metrics(bySize('compact'))).toMatchObject(controlTypography)
    expect(await metrics(bySize('toolbar'))).toMatchObject(controlTypography)
    expect(await metrics(bySize('toolbarLabel'))).toMatchObject(controlTypography)
    expect(await metrics(bySize('composer'))).toMatchObject(controlTypography)
    expect(await metrics(bySize('icon'))).toMatchObject({ iconSize: 18 })
    expect(await metrics(bySize('iconMd'))).toMatchObject({ iconSize: 14 })
    expect(await metrics(bySize('iconSm'))).toMatchObject({ iconSize: 14 })
    expect(await metrics(bySize('tabStripAction'))).toMatchObject({ iconSize: 16 })

    await expect(page.locator('.app-menubar')).toHaveCSS('height', '36px')
    await expect(page.locator('.desktop-workspace-header')).toHaveCSS('height', '46px')
    const productModeTrigger = page.locator('.sidebar-product-mode-trigger')
    const sidebarTitleRadius = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.borderRadius = 'var(--cpx-sys-radius-xl)'
      document.body.append(probe)
      const radius = getComputedStyle(probe).borderRadius
      probe.remove()
      return radius
    })
    await expect(productModeTrigger).toHaveCSS('height', '32px')
    await expect(productModeTrigger).toHaveCSS('border-radius', sidebarTitleRadius)
    await expect(productModeTrigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
    await expect(productModeTrigger).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
    await expect(productModeTrigger).not.toHaveClass(/settings-dropdown/)
    expect(await productModeTrigger.evaluate((element) => element.tagName)).toBe('BUTTON')

    await expectBox(page.getByRole('button', { name: '搜索任务' }), 28)
    await expectBox(page.locator('.sidebar-timeline-toggle-button'), 28)
    await expectBox(page.getByRole('button', { name: '帮助' }), 28)
    await expectBox(page.getByRole('button', { name: /集成终端/u }), 28)
    await expectBox(page.getByRole('button', { name: /右侧面板/u }), 28)
    await expectBox(fixture.locator('[data-contract="return-to-bottom"]'), 32)

    await page.getByRole('button', { name: '显示右侧面板' }).click()
    await expect(page.locator('.right-dock-header')).toHaveCSS('height', '40px')
    const tabStripAction = page
      .locator('.right-dock-header .ui-button[data-size="tabStripAction"]')
      .first()
    await expect(tabStripAction).toBeVisible()
    await expectBox(tabStripAction, 34)

    const primary = await metrics(fixture.locator('[data-contract-color="primary"]'))
    const secondary = await metrics(fixture.locator('[data-contract-color="secondary"]'))
    const outline = await metrics(fixture.locator('[data-contract-color="outline"]'))
    const ghost = await metrics(fixture.locator('[data-contract-color="ghost"]'))
    const danger = await metrics(fixture.locator('[data-contract-color="danger"]'))
    const dangerSolid = await metrics(fixture.locator('[data-contract-color="dangerSolid"]'))
    expect(primary.background).not.toBe('rgba(0, 0, 0, 0)')
    expect(primary.background).not.toBe(secondary.background)
    expect(secondary.border).toBe('rgba(0, 0, 0, 0)')
    expect(outline.border).not.toBe('rgba(0, 0, 0, 0)')
    expect(ghost.background).toBe('rgba(0, 0, 0, 0)')
    expect(ghost.border).toBe('rgba(0, 0, 0, 0)')
    expect(danger.background).not.toBe(dangerSolid.background)
    expect(danger.color).not.toBe(dangerSolid.color)
  })
}

test('sidebar product mode uses the Codex title trigger and radio menu', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await page.goto('/?visualCase=rich#/threads/visual-rich', {
    waitUntil: 'domcontentloaded',
  })

  const productModeTrigger = page.getByRole('button', {
    name: '切换工作模式，当前为 Coding',
  })
  const sidebarTitleRadius = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.borderRadius = 'var(--cpx-sys-radius-xl)'
    document.body.append(probe)
    const radius = getComputedStyle(probe).borderRadius
    probe.remove()
    return radius
  })
  await expect(productModeTrigger).toHaveCSS('height', '32px')
  await expect(productModeTrigger).toHaveCSS('border-radius', sidebarTitleRadius)
  await expect(productModeTrigger).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(productModeTrigger).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  expect(await productModeTrigger.evaluate((element) => element.tagName)).toBe('BUTTON')

  await productModeTrigger.click()
  const productModeMenu = page.locator('.sidebar-product-mode-menu')
  await expect(productModeMenu).toBeVisible()
  const sidebarHoverBackground = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--cpx-sys-color-hover)'
    document.body.append(probe)
    const background = getComputedStyle(probe).backgroundColor
    probe.remove()
    return background
  })
  await expect(productModeTrigger).toHaveCSS('background-color', sidebarHoverBackground)
  await expect(productModeMenu.getByText('Coding', { exact: true })).toBeVisible()
  await expect(productModeMenu.getByText('Working', { exact: true })).toBeVisible()
  await expect(productModeMenu.getByText('Chat', { exact: true })).toBeVisible()
  await expect(productModeMenu.getByText('构建、调试并发布', { exact: true })).toBeVisible()

  await productModeMenu.getByRole('menuitemradio', { name: /Working/u }).click()
  await expect(productModeMenu).toHaveCount(0)
  await expect(page).toHaveURL(/#\/new\?surface=working$/u)
  await expect(
    page.getByRole('button', {
      name: '切换工作模式，当前为 Working',
    }),
  ).toBeVisible()
})

for (const mode of ['light', 'dark'] as const) {
  test(`ordinary icon buttons keep transparent interaction backgrounds (${mode})`, async ({
    page,
  }) => {
    await prepareVisualTheme(page, mode, { reduceMotion: 'off' })
    await page.setViewportSize({ width: 1440, height: 920 })
    test.setTimeout(90_000)
    await page.goto('/?visualCase=rich#/threads/visual-rich', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-canonical-thread-id="visual-rich"]')).toBeVisible({
      timeout: 60_000,
    })
    await waitForVisualPage(page, mode, page.locator('[data-canonical-thread-id="visual-rich"]'))
    const colors = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--cpx-sys-color-fg-primary)'
      probe.style.background = 'var(--cpx-sys-color-selected)'
      document.body.append(probe)
      const style = getComputedStyle(probe)
      const result = { primary: style.color, selected: style.backgroundColor }
      probe.style.color = 'var(--cpx-sys-color-fg-secondary)'
      const secondary = getComputedStyle(probe).color
      probe.remove()
      return { ...result, secondary }
    })
    const transparent = 'rgba(0, 0, 0, 0)'
    const expectHover = async (button: Locator) => {
      await button.hover()
      await expect(button).toHaveCSS('background-color', transparent)
      await expect(button).toHaveCSS('color', colors.primary)
    }

    const composerAction = page.getByRole('button', { name: '添加文件等内容', exact: true })
    await expectHover(composerAction)
    await composerAction.click()
    await expect(composerAction).toHaveAttribute('data-active', 'true')
    await expect(composerAction).toHaveCSS('background-color', transparent)
    await composerAction.click()
    await expect(page.getByRole('button', { name: '切换默认打开目标', exact: true })).toHaveCount(0)
    await expect(page.locator('.open-target-split-button')).toHaveCount(0)
    const table = page.locator('.md-table-block').first()
    await table.hover()
    await expectHover(table.locator('.md-table-copy'))
    const panelActions = page.locator(
      '.chat-session-actions > .icon-button, .workspace-shell-controls > .icon-button',
    )
    await expect(panelActions).toHaveCount(4)
    for (const action of await panelActions.all()) {
      const disabled = await action.isDisabled()
      if (disabled) {
        await action.hover()
        await expect(action).toHaveCSS('background-color', transparent)
        await action.evaluate((element: HTMLButtonElement) => {
          element.disabled = false
        })
      }
      await action.hover()
      await expect(action).not.toHaveCSS('background-color', transparent)
      if (disabled)
        await action.evaluate((element: HTMLButtonElement) => {
          element.disabled = true
        })
    }
    const panelToggle = page.locator('.workspace-shell-control-button').last()
    if ((await panelToggle.getAttribute('aria-pressed')) !== 'true') await panelToggle.click()
    await panelToggle.hover()
    await expect(panelToggle).toHaveCSS('background-color', colors.selected)

    await installPrimitiveFixture(page)
    const fixture = page.locator('#button-contract-fixture')
    const changes = fixture.locator('.composer-change-summary__changes')
    await expectHover(changes)
    await changes.evaluate((element) => element.setAttribute('aria-expanded', 'true'))
    await page.mouse.move(1400, 900)
    await expect(changes).toHaveCSS('background-color', transparent)
    await expect(changes).toHaveCSS('color', colors.primary)
    const icon = fixture.locator('.icon-button[data-size="icon"]')
    const originalSize = await icon.boundingBox()
    for (const color of ['ghost', 'ghostSecondary', 'ghostActive']) {
      await icon.evaluate((element, value) => {
        element.setAttribute('data-color', value)
      }, color)
      await page.mouse.move(1400, 900)
      await expect(icon).toHaveCSS('background-color', transparent)
      await expectHover(icon)
      await page.mouse.move(1400, 900)
      for (const attribute of ['data-state', 'data-active']) {
        await icon.evaluate(
          (element, key) => element.setAttribute(key, key === 'data-state' ? 'open' : 'true'),
          attribute,
        )
        await expect(icon).toHaveCSS('background-color', transparent)
        await expect(icon).toHaveCSS('color', colors.primary)
        await icon.evaluate((element, key) => element.removeAttribute(key), attribute)
      }
    }
    await icon.evaluate((element) => element.setAttribute('data-color', 'ghostSecondary'))
    await page.mouse.move(1400, 900)
    await expect(icon).toHaveCSS('color', colors.secondary)
    for (const attribute of ['disabled', 'aria-disabled']) {
      await icon.evaluate((element, key) => element.setAttribute(key, 'true'), attribute)
      await icon.hover()
      await expect(icon).toHaveCSS('color', colors.secondary)
      await expect(icon).toHaveCSS('background-color', transparent)
      await page.mouse.move(1400, 900)
      await icon.evaluate((element, key) => element.removeAttribute(key), attribute)
    }
    await icon.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(icon).toBeFocused()
    await expect(icon).toHaveCSS('outline-style', 'solid')
    await expect(icon).toHaveCSS('outline-width', '2px')
    const finalSize = await icon.boundingBox()
    expect(finalSize?.width).toBe(originalSize?.width)
    expect(finalSize?.height).toBe(originalSize?.height)
    const textGhost = fixture.locator('[data-contract-color="ghost"]')
    await textGhost.hover()
    await expect(textGhost).not.toHaveCSS('background-color', transparent)
    for (const color of ['primary', 'danger']) {
      await icon.evaluate((element, value) => element.setAttribute('data-color', value), color)
      await icon.hover()
      await expect(icon).not.toHaveCSS('background-color', transparent)
      await expect(icon).not.toHaveCSS('color', colors.primary)
    }

    await page.evaluate(() => {
      location.hash = '/automations'
    })
    const search = page.getByPlaceholder('搜索已安排任务')
    await search.fill('测试')
    const clear = page.locator('.search-input-clear')
    await expectHover(clear)
    await clear.click()
    await expect(search).toHaveValue('')
  })
}
