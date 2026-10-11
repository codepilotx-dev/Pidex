import { expect, test, type Locator } from '@playwright/test'

import { COMPACT_VIEWPORT, prepareVisualTheme, waitForVisualPage } from './VisualTestHelpers.js'

test('Radix dropdown stays anchored and uses a readable opaque surface', async ({ page }) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })
  await page.goto('/?visualCase=rich#/threads/visual-rich')

  const trigger = page.getByRole('button', {
    name: /切换工作模式，当前为/,
  })
  await waitForVisualPage(page, 'dark', trigger)
  const triggerBox = await trigger.boundingBox()
  expect(triggerBox).not.toBeNull()
  await trigger.focus()
  await page.keyboard.press('Enter')

  const content = page.locator('.popover[data-side]').first()
  await expect(content).toBeVisible()
  await expect(content).toHaveAttribute('data-side', 'bottom')
  await expectReadableFloatingSurface(content)

  const item = content.locator('.popover-item').first()
  const [itemBox, itemStyles, scrollStyles] = await Promise.all([
    item.boundingBox(),
    item.evaluate((element) => {
      const computed = getComputedStyle(element)
      return {
        borderRadius: Number.parseFloat(computed.borderRadius),
        fontSize: Number.parseFloat(computed.fontSize),
        lineHeight: Number.parseFloat(computed.lineHeight),
        paddingBlockStart: Number.parseFloat(computed.paddingBlockStart),
        paddingInlineStart: Number.parseFloat(computed.paddingInlineStart),
      }
    }),
    content.locator('.popover-scroll-content').evaluate((element) => {
      const computed = getComputedStyle(element)
      return {
        paddingBlockStart: Number.parseFloat(computed.paddingBlockStart),
        paddingInlineStart: Number.parseFloat(computed.paddingInlineStart),
      }
    }),
  ])
  expect(itemBox).not.toBeNull()
  expect(itemBox!.height).toBeGreaterThanOrEqual(51.5)
  expect(itemBox!.height).toBeLessThanOrEqual(53)
  expect(itemStyles.borderRadius).toBeCloseTo(8, 0)
  expect(itemStyles.fontSize).toBeCloseTo(14, 1)
  expect(itemStyles.lineHeight).toBeCloseTo(20, 1)
  expect(itemStyles.paddingBlockStart).toBeCloseTo(6, 0)
  expect(itemStyles.paddingInlineStart).toBeCloseTo(8, 0)
  expect(scrollStyles.paddingBlockStart).toBeCloseTo(4, 1)
  expect(scrollStyles.paddingInlineStart).toBeCloseTo(4, 1)
  const selectedItem = content.locator('.popover-item[data-state="checked"]').first()
  await expect(selectedItem).toBeVisible()
  await expect(
    selectedItem.evaluate((element) => {
      const probe = document.createElement('span')
      probe.style.background = 'var(--state-selected-fill)'
      element.append(probe)
      const expected = getComputedStyle(probe).backgroundColor
      probe.remove()
      return getComputedStyle(element).backgroundColor === expected
    }),
  ).resolves.toBe(true)
  await page.keyboard.press('ArrowDown')
  const keyboardFocusedItem = content.locator('.popover-item:focus').first()
  await expect(keyboardFocusedItem).toBeVisible()
  const keyboardFocusStyle = await keyboardFocusedItem.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      boxShadow: style.boxShadow,
      outlineStyle: style.outlineStyle,
    }
  })
  expect(keyboardFocusStyle.outlineStyle).toBe('none')
  expect(keyboardFocusStyle.boxShadow).not.toBe('none')

  const contentBox = await content.boundingBox()
  expect(contentBox).not.toBeNull()
  expect(contentBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height - 2)
})

test('Radix popover stays in the viewport and respects reduced motion', async ({ page }) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })
  await page.goto('/?visualCase=empty#/settings/appearance')

  const colorTrigger = page.getByRole('button', {
    name: '深色强调色颜色选择器',
  })
  await waitForVisualPage(page, 'dark', colorTrigger)
  await colorTrigger.click()

  const colorPopover = page.locator('.appearance-color-popover[data-side]')
  await expect(colorPopover).toBeVisible()
  await expectReadableFloatingSurface(colorPopover)
  await expectSurfacePadding(colorPopover, 4)

  await page.keyboard.press('Escape')
  await page.locator('html').evaluate((root) => {
    root.dataset.reduceMotion = 'on'
  })
  await colorTrigger.click()
  await expect(colorPopover).toBeVisible()
  await expect(colorPopover).toHaveCSS('animation-name', 'none')
})

test('Radix context menu follows the pointer and stays in the viewport', async ({ page }) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })
  await page.goto('/?visualCase=rich#/threads/visual-rich')

  const selectionTarget = page.getByText('已完成工作台结构梳理。', {
    exact: true,
  })
  await waitForVisualPage(page, 'dark', selectionTarget)
  await selectionTarget.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      },
    })
    const text = walker.nextNode()
    if (!text) {
      throw new Error('The visual conversation has no selectable text.')
    }
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  })

  const targetBox = await selectionTarget.boundingBox()
  expect(targetBox).not.toBeNull()
  const pointer = {
    x: targetBox!.x + 10,
    y: targetBox!.y + targetBox!.height / 2,
  }
  await page.evaluate(() => {
    document.addEventListener(
      'mousedown',
      (event) => {
        if (event.button === 2) event.preventDefault()
      },
      { capture: true, once: true },
    )
  })
  await page.mouse.click(pointer.x, pointer.y, { button: 'right' })

  const content = page.locator('.sidebar-context-menu-content[data-side]')
  await expect(content).toBeVisible()
  await expectReadableFloatingSurface(content)
  await expect(page.locator('.sidebar-context-menu-content[data-state="open"]')).toHaveCount(1)
  await expect(content.getByText('添加到对话', { exact: true })).toBeVisible()
  await expect(content.getByText('在侧边聊天中提问', { exact: true })).toBeVisible()
  await expect(content.getByText('复制', { exact: true })).toBeVisible()
  await expectSurfacePadding(content, 4)

  const firstItem = content.locator('.sidebar-context-menu-item').first()
  const [contentBox, firstItemBox, firstItemStyles] = await Promise.all([
    content.boundingBox(),
    firstItem.boundingBox(),
    firstItem.evaluate((element) => {
      const computed = getComputedStyle(element)
      return {
        borderRadius: Number.parseFloat(computed.borderRadius),
        fontSize: Number.parseFloat(computed.fontSize),
        lineHeight: Number.parseFloat(computed.lineHeight),
        paddingBlockStart: Number.parseFloat(computed.paddingBlockStart),
        paddingInlineStart: Number.parseFloat(computed.paddingInlineStart),
      }
    }),
  ])
  expect(contentBox).not.toBeNull()
  expect(contentBox!.width).toBeGreaterThanOrEqual(180)
  expect(firstItemBox).not.toBeNull()
  expect(firstItemBox!.height).toBeCloseTo(32, 0)
  expect(firstItemStyles.borderRadius).toBeCloseTo(8, 0)
  expect(firstItemStyles.fontSize).toBeCloseTo(14, 1)
  expect(firstItemStyles.lineHeight).toBeCloseTo(20, 1)
  expect(firstItemStyles.paddingBlockStart).toBeCloseTo(5, 0)
  expect(firstItemStyles.paddingInlineStart).toBeCloseTo(8, 0)
  await firstItem.hover()
  await expect
    .poll(() =>
      firstItem.evaluate((element) => {
        const probe = document.createElement('span')
        probe.style.background = 'var(--color-token-list-hover-background)'
        element.append(probe)
        const expected = getComputedStyle(probe).backgroundColor
        probe.remove()
        return getComputedStyle(element).backgroundColor === expected
      }),
    )
    .toBe(true)
  expect(Math.abs(contentBox!.x - pointer.x)).toBeLessThan(300)
  expect(Math.abs(contentBox!.y - pointer.y)).toBeLessThan(300)

  const submenuMinWidth = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.className = 'sidebar-context-menu-content app-context-menu-sub-content'
    probe.style.position = 'fixed'
    probe.style.visibility = 'hidden'
    document.body.append(probe)
    const width = probe.getBoundingClientRect().width
    probe.remove()
    return width
  })
  expect(submenuMinWidth).toBeGreaterThanOrEqual(200)
})

test('global context menu exposes editor commands and skips blank areas', async ({ page }) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })
  await page.goto('/?visualCase=rich#/threads/visual-rich')

  const editor = page.getByRole('combobox', { name: '消息输入框' })
  await waitForVisualPage(page, 'dark', editor)
  await editor.click()
  await editor.fill('context menu edit')
  await page.keyboard.press('Control+A')
  await editor.click({ button: 'right' })

  const content = page.locator('.sidebar-context-menu-content[data-state="open"]')
  await expect(content).toBeVisible()
  for (const label of ['撤销', '重做', '剪切', '复制', '粘贴', '删除', '全选']) {
    await expect(content.getByText(label, { exact: true })).toBeVisible()
  }
  const disabledRedoItem = content.getByText('重做', { exact: true }).locator('..')
  await expect(disabledRedoItem).toHaveAttribute('data-disabled')
  await expect(content.getByText('全选', { exact: true }).locator('..')).toHaveAttribute(
    'data-disabled',
  )
  await expect(
    disabledRedoItem.evaluate((element) => {
      const style = getComputedStyle(element)
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-token-disabled-foreground)'
      element.append(probe)
      const expectedColor = getComputedStyle(probe).color
      probe.remove()
      return {
        colorMatchesDisabled: style.color === expectedColor,
        cursor: style.cursor,
        opacity: Number.parseFloat(style.opacity),
      }
    }),
  ).resolves.toEqual({
    colorMatchesDisabled: true,
    cursor: 'not-allowed',
    opacity: 0.55,
  })

  await content.getByText('删除', { exact: true }).click()
  await expect(editor).not.toContainText('context menu edit')

  await editor.fill('top edit menu')
  const editMenuTrigger = page.locator('.menubar-trigger').filter({ hasText: /^编辑$/ })
  const viewMenuTrigger = page.locator('.menubar-trigger').filter({ hasText: /^查看$/ })
  await editMenuTrigger.click()
  const editMenu = page.locator('.menubar-content[data-state="open"]')
  await expect(editMenu).toBeVisible()

  await editMenuTrigger.click()
  await expect(editMenu).toHaveCount(0)

  await editMenuTrigger.click()
  await page.locator('.conversation-page').click({ position: { x: 16, y: 16 } })
  await expect(editMenu).toHaveCount(0)

  await editMenuTrigger.click()
  await page.keyboard.press('Escape')
  await expect(editMenu).toHaveCount(0)
  await expect(editMenuTrigger).toBeFocused()

  await viewMenuTrigger.click()
  await expect(editMenu).toContainText('切换侧边栏')
  await editMenuTrigger.hover()
  await expect(editMenu).toContainText('全选')
  await expect(page.locator('.menubar-content[data-state="open"]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await editor.focus()
  await editMenuTrigger.click()
  await editMenu.getByText('全选', { exact: true }).click()
  await expect(editMenu).toHaveCount(0)
  await editMenuTrigger.focus()
  await editMenuTrigger.press('ArrowDown')
  await expect(editMenu).toBeVisible()
  await page
    .locator('.menubar-content[data-state="open"]')
    .getByText('删除', { exact: true })
    .click()
  await expect(editor).not.toContainText('top edit menu')

  await page.locator('.app-menubar').click({ button: 'right' })
  await expect(page.locator('.sidebar-context-menu-content[data-state="open"]')).toHaveCount(0)
  const trigger = (name: string) => page.locator('.menubar-trigger').filter({ hasText: name })
  const menu = page.locator('.menubar-content[data-state="open"]')
  await editor.focus()
  await page.keyboard.press('F10')
  await expect(trigger('文件')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(editor).toBeFocused()
  await page.keyboard.press('Alt+h')
  await expect(menu.getByText('新特性', { exact: true })).toBeVisible()
  await expect(menu.getByText('启动性能追踪', { exact: true }).locator('..')).toHaveAttribute(
    'data-disabled',
  )
  await menu.getByText('新特性', { exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Control+,')
  await expect(page).toHaveURL(/#\/threads\/visual-rich$/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger('帮助')).toBeFocused()
  await trigger('查看').click()
  for (const label of ['查找', '上一个聊天', '下一个聊天', '切换全屏']) {
    await expect(menu.getByText(label, { exact: true }).locator('..')).toHaveAttribute(
      'data-disabled',
    )
  }
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await trigger('文件').focus()
  await trigger('文件').press('ArrowDown')
  await menu.getByText('设置...', { exact: true }).click()
  await expect(page).toHaveURL(/#\/settings\/general$/)
  await page.keyboard.press('Control+Shift+Slash')
  await expect(page).toHaveURL(/#\/settings\/shortcuts$/)
  await trigger('帮助').click()
  await menu.getByText('技能', { exact: true }).click()
  await expect(page).toHaveURL(/#\/settings\/plugins\?tab=skills$/)
  await trigger('帮助').click()
  await menu.getByText('模型上下文协议', { exact: true }).click()
  await expect(page).toHaveURL(/#\/settings\/plugins\?tab=mcps$/)
})

async function expectReadableFloatingSurface(content: Locator): Promise<void> {
  const [contentBox, styles] = await Promise.all([
    content.boundingBox(),
    content.evaluate((element) => {
      const computed = getComputedStyle(element)
      const alphaToken = computed.backgroundColor.match(/\/\s*([\d.]+%?)/)?.[1]
      const legacyChannels = computed.backgroundColor.match(/[\d.]+%?/g)
      const parsedAlpha =
        alphaToken ??
        (computed.backgroundColor.startsWith('rgba') ? legacyChannels?.[3] : undefined)
      const backgroundAlpha = parsedAlpha?.endsWith('%')
        ? Number.parseFloat(parsedAlpha) / 100
        : Number.parseFloat(parsedAlpha ?? '1')
      return {
        animationName: computed.animationName,
        backdropFilter: computed.backdropFilter,
        backgroundAlpha,
        backgroundColor: computed.backgroundColor,
        borderRadius: computed.borderRadius,
        borderTopWidth: computed.borderTopWidth,
        boxShadow: computed.boxShadow,
        position: computed.position,
      }
    }),
  ])

  expect(contentBox).not.toBeNull()
  expect(contentBox!.x).toBeGreaterThanOrEqual(0)
  expect(contentBox!.y).toBeGreaterThanOrEqual(0)
  expect(contentBox!.x + contentBox!.width).toBeLessThanOrEqual(COMPACT_VIEWPORT.width + 1)
  expect(contentBox!.y + contentBox!.height).toBeLessThanOrEqual(COMPACT_VIEWPORT.height + 1)
  expect(styles.position).not.toBe('absolute')
  expect(styles.backdropFilter).toBe('none')
  expect(styles.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(styles.backgroundAlpha).toBe(1)
  expect(styles.borderRadius).toBe('16px')
  expect(styles.borderTopWidth).toBe('1px')
  expect(styles.boxShadow).not.toBe('none')
  expect(styles.animationName).not.toBe('none')
}

async function expectSurfacePadding(content: Locator, expected: number): Promise<void> {
  const padding = await content.evaluate((element) => {
    const computed = getComputedStyle(element)
    return {
      blockStart: Number.parseFloat(computed.paddingBlockStart),
      inlineStart: Number.parseFloat(computed.paddingInlineStart),
    }
  })
  expect(padding.blockStart).toBeCloseTo(expected, 1)
  expect(padding.inlineStart).toBeCloseTo(expected, 1)
}
