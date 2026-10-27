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
  await page.evaluate(async () => {
    const reactPath = '/node_modules/.vite/deps/react.js'
    const domPath = '/node_modules/.vite/deps/react-dom_client.js'
    const buttonPath = '/src/components/ui/Button.tsx'
    const [
      {
        default: { createElement: h },
      },
      {
        default: { createRoot },
      },
      { Button },
    ] = await Promise.all([import(reactPath), import(domPath), import(buttonPath)])
    const fixture = document.createElement('div')
    fixture.id = 'button-contract-fixture'
    fixture.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;display:flex;gap:4px'
    document.body.append(fixture)
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
    const buttons = sizes.map((size) =>
      h(Button, {
        key: size,
        size,
        isIconOnly: size.startsWith('icon') || size === 'tabStripAction',
        children:
          size.startsWith('icon') || size === 'tabStripAction'
            ? h('svg', { viewBox: '0 0 24 24' }, h('path', { d: 'M4 12h16' }))
            : size,
      }),
    )
    const colors = ['primary', 'secondary', 'outline', 'ghost', 'danger', 'dangerSolid'].map(
      (color) =>
        h(Button, {
          key: color,
          color,
          size: 'toolbar',
          'data-contract-color': color,
          children: color,
        }),
    )
    const iconColors = ['ghost', 'ghostSecondary', 'ghostActive', 'text', 'primary', 'danger'].map(
      (color) =>
        h(Button, {
          key: 'icon-' + color,
          color,
          isIconOnly: true,
          size: 'icon',
          title: 'fixture-' + color,
          'data-contract-icon': color,
          children: h('svg', { viewBox: '0 0 24 24' }, h('path', { d: 'M4 12h16' })),
        }),
    )
    createRoot(fixture).render(
      h(
        'div',
        { style: { display: 'contents' } },
        ...buttons,
        ...colors,
        ...iconColors,
        h('button', {
          className: 'composer-change-summary__return',
          'data-contract': 'return-to-bottom',
        }),
        h(
          'button',
          {
            className:
              'composer-change-summary__changes tw:inline-flex tw:h-full tw:min-h-0 tw:min-w-0 tw:flex-[1_1_auto] tw:items-center tw:gap-2 tw:overflow-hidden tw:rounded-none tw:border-0 tw:bg-transparent tw:py-0 tw:ps-0 tw:pe-4 tw:text-ellipsis tw:text-inherit tw:whitespace-nowrap tw:only:ps-4 tw:only:pe-4 tw:enabled:hover:bg-transparent tw:enabled:hover:text-app-text tw:enabled:hover:shadow-none tw:aria-expanded:bg-transparent tw:aria-expanded:text-app-text tw:aria-expanded:shadow-none',
          },
          '4 个文件已更改',
        ),
      ),
    )
  })
  await expect(page.locator('#button-contract-fixture [data-size="iconSm"]')).toBeVisible()
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
    await page.getByRole('button', { name: '稍后', exact: true }).click()
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
    await expectBox(bySize('iconMd'), 24)
    await expectBox(bySize('iconSm'), 24)
    await expectBox(bySize('tabStripAction'), 36)

    const controlTypography = {
      fontSize: `${uiFontSize - 1}px`,
      lineHeight: `${Number(((uiFontSize - 1) * 1.2).toFixed(1))}px`,
    }
    expect(await metrics(bySize('compact'))).toMatchObject(controlTypography)
    expect(await metrics(bySize('toolbar'))).toMatchObject(controlTypography)
    expect(await metrics(bySize('toolbarLabel'))).toMatchObject(controlTypography)
    expect(await metrics(bySize('composer'))).toMatchObject(controlTypography)
    expect(await metrics(bySize('icon'))).toMatchObject({ iconSize: 16 })
    expect(await metrics(bySize('iconMd'))).toMatchObject({ iconSize: 12 })
    expect(await metrics(bySize('iconSm'))).toMatchObject({ iconSize: 12 })
    expect(await metrics(bySize('tabStripAction'))).toMatchObject({ iconSize: 16 })

    await expect(page.locator('.app-menubar')).toHaveCSS('height', '36px')
    await expect(page.locator('.desktop-workspace-header')).toHaveCSS('height', '46px')
    await expectBox(page.getByRole('button', { name: '搜索任务' }), 36)
    await expectBox(page.getByRole('button', { name: '查看活动 (Ctrl+Alt+U)', exact: true }), 36)
    const help = await metrics(page.getByRole('menuitem', { name: '帮助', exact: true }))
    expect(help.width).toBeGreaterThanOrEqual(24)
    expect(help.height).toBeGreaterThanOrEqual(24)
    await expectBox(page.getByRole('button', { name: '创建任务后可使用底部面板', exact: true }), 28)
    await expectBox(
      page.getByRole('button', { name: '显示标签页 (Ctrl+Shift+B)', exact: true }),
      28,
    )
    await expectBox(fixture.locator('[data-contract="return-to-bottom"]'), 32)

    await page.getByRole('button', { name: '显示标签页 (Ctrl+Shift+B)', exact: true }).click()
    const rightPanel = page.getByRole('complementary', { name: '右侧面板' })
    await expect(rightPanel.locator('.right-dock-header')).toHaveCSS('height', '46px')
    const launcher = rightPanel.getByLabel('可用面板标签', { exact: true })
    await expect(launcher).toBeVisible()
    await launcher.getByRole('button', { name: '变更 Ctrl+Shift+G', exact: true }).click()
    await expect(rightPanel.getByRole('tab', { name: '变更', exact: true })).toBeVisible()
    const tabStripAction = rightPanel.getByRole('button', { name: '添加标签', exact: true })
    await expect(tabStripAction).toHaveAttribute('data-size', 'tabStripAction')
    await expectBox(tabStripAction, 36)

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

for (const mode of ['light', 'dark'] as const) {
  test(`icon buttons follow their current theme hover, active and focus styles (${mode})`, async ({
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
    await page.getByRole('button', { name: '稍后', exact: true }).click()
    const colors = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--cpx-sys-color-fg-primary)'
      probe.style.background = 'var(--cpx-sys-color-selected)'
      document.body.append(probe)
      const style = getComputedStyle(probe)
      const result = { primary: style.color, selected: style.backgroundColor }
      probe.style.background = 'var(--cpx-sys-color-hover)'
      const hover = getComputedStyle(probe).backgroundColor
      probe.style.color = 'var(--cpx-sys-color-fg-secondary)'
      const secondary = getComputedStyle(probe).color
      probe.remove()
      return { ...result, secondary, hover }
    })
    const transparent = 'rgba(0, 0, 0, 0)'
    const expectHover = async (button: Locator, background = colors.hover) => {
      await button.hover()
      await expect(button).toHaveCSS('background-color', background)
      await expect(button).toHaveCSS('color', colors.primary)
    }

    const composerAction = page.getByRole('button', { name: '添加文件等内容', exact: true })
    await expectHover(composerAction)
    await composerAction.click()
    await expect(composerAction).toHaveAttribute('data-active', 'true')
    await expect(composerAction).toHaveCSS('background-color', colors.hover)
    await composerAction.click()
    await expect(page.getByRole('button', { name: '切换默认打开目标', exact: true })).toHaveCount(0)
    await expect(page.locator('.open-target-split-button')).toHaveCount(0)
    const table = page.locator('.md-table-block').first()
    await table.hover()
    await expectHover(table.locator('.md-table-copy'), transparent)
    const panelActions = page.locator(
      '.chat-session-actions > .icon-button, .workspace-shell-controls > .icon-button',
    )
    await expect(panelActions).toHaveCount(3)
    for (const action of await panelActions.all()) {
      if (await action.isDisabled()) {
        await action.hover({ force: true })
        await expect(action).toBeDisabled()
        await expect(action).toHaveCSS('background-color', transparent)
      } else {
        await expectHover(action)
      }
    }
    const panelToggle = page.locator('.workspace-shell-control-button').last()
    if ((await panelToggle.getAttribute('aria-pressed')) !== 'true') await panelToggle.click()
    await expect(panelToggle).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(1400, 900)
    await expect(panelToggle).toHaveCSS('background-color', colors.selected)
    await expectHover(panelToggle)

    await installPrimitiveFixture(page)
    const fixture = page.locator('#button-contract-fixture')
    const changes = fixture.locator('.composer-change-summary__changes')
    await expectHover(changes, transparent)
    await changes.evaluate((element) => element.setAttribute('aria-expanded', 'true'))
    await page.mouse.move(1400, 900)
    await expect(changes).toHaveCSS('background-color', transparent)
    await expect(changes).toHaveCSS('color', colors.primary)
    const icon = fixture.locator('[data-contract-icon="ghostSecondary"]')
    const originalSize = await icon.boundingBox()
    for (const color of ['ghost', 'ghostSecondary', 'ghostActive']) {
      const button = fixture.locator(`[data-contract-icon="${color}"]`)
      await page.mouse.move(1400, 900)
      await expect(button).toHaveCSS('background-color', transparent)
      await expectHover(button)
      await page.mouse.move(1400, 900)
      for (const attribute of ['data-state', 'data-active']) {
        await button.evaluate(
          (element, key) => element.setAttribute(key, key === 'data-state' ? 'open' : 'true'),
          attribute,
        )
        await expect(button).toHaveCSS('background-color', colors.hover)
        await expect(button).toHaveCSS('color', colors.secondary)
        await button.evaluate((element, key) => element.removeAttribute(key), attribute)
      }
    }
    await page.mouse.move(1400, 900)
    await expect(icon).toHaveCSS('color', colors.secondary)
    const restingColor = colors.secondary
    for (const attribute of ['disabled', 'aria-disabled']) {
      await icon.evaluate((element, key) => element.setAttribute(key, 'true'), attribute)
      await icon.hover({ force: true })
      await expect(icon).toHaveCSS('color', restingColor)
      await expect(icon).toHaveCSS('background-color', transparent)
      await page.mouse.move(1400, 900)
      await icon.evaluate((element, key) => element.removeAttribute(key), attribute)
    }
    await icon.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(icon).toBeFocused()
    await expect(icon).not.toHaveCSS('box-shadow', 'none')
    const finalSize = await icon.boundingBox()
    expect(finalSize?.width).toBe(originalSize?.width)
    expect(finalSize?.height).toBe(originalSize?.height)
    const textGhost = fixture.locator('[data-contract-color="ghost"]')
    await textGhost.hover()
    await expect(textGhost).not.toHaveCSS('background-color', transparent)
    for (const color of ['primary', 'danger']) {
      const emphasizedIcon = fixture.locator(`[data-contract-icon="${color}"]`)
      await emphasizedIcon.hover()
      await expect(emphasizedIcon).not.toHaveCSS('background-color', transparent)
      await expect(emphasizedIcon).not.toHaveCSS('color', colors.primary)
    }

    await page.evaluate(() => {
      location.hash = '/automations'
    })
    const taskSidebar = page.getByRole('complementary', { name: '任务侧栏' })
    await taskSidebar.getByRole('button', { name: '搜索已安排任务', exact: true }).click()
    const search = taskSidebar.getByPlaceholder('搜索已安排任务')
    await search.fill('测试')
    const clear = search.locator('..').locator('.search-input-clear')
    await expectHover(clear)
    await clear.click()
    await expect(search).toHaveValue('')
  })
}
