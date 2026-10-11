import { expect, test, type Locator } from '@playwright/test'
import { expectNoHorizontalOverflow } from './VisualTestHelpers.js'

// 当前 visual fixture 在 reduce 模式下初始化超时；此用例验证普通动效下的宽度与保存。
test.use({ reducedMotion: 'no-preference' })

async function iconGeometry(button: Locator) {
  return button.evaluate((element) => {
    const buttonBox = element.getBoundingClientRect()
    const icon = element.querySelector('svg')!
    const iconBox = icon.getBoundingClientRect()
    return {
      width: buttonBox.width,
      height: buttonBox.height,
      iconHeight: iconBox.height,
      center: iconBox.x + iconBox.width / 2 - (buttonBox.x + buttonBox.width / 2),
      lines: Array.from(icon.querySelectorAll('line'), (line) => {
        const box = line.getBoundingClientRect()
        return {
          width: box.width,
          y: box.y - iconBox.y,
          center: box.x + box.width / 2 - (iconBox.x + iconBox.width / 2),
          stroke: getComputedStyle(line).strokeWidth,
        }
      }),
    }
  })
}

async function expectContentWidth(locator: Locator, expected: number, tolerance = 1.5) {
  await expect(locator).toBeVisible()
  await expect
    .poll(async () => {
      const box = await locator.boundingBox()
      return box ? Math.abs(box.width - expected) : 999
    })
    .toBeLessThanOrEqual(tolerance)
}

async function expectControlOnRight(row: Locator) {
  await expect(row).toBeVisible()
  await expect
    .poll(() =>
      row.evaluate((element) => {
        const info = element.querySelector('.settings-row-info')!.getBoundingClientRect()
        const control = element.querySelector('.settings-row-control')!.getBoundingClientRect()
        const bounds = element.getBoundingClientRect()
        return (
          control.width > 0 &&
          control.left >= info.right &&
          Math.abs(control.top + control.height / 2 - bounds.top - bounds.height / 2) < 1 &&
          control.right <= bounds.right
        )
      }),
    )
    .toBe(true)
}

for (const mode of ['light', 'dark'] as const) {
  test(`页面宽度全局自动保存与各页面布局 ${mode}`, async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.emulateMedia({ colorScheme: mode, reducedMotion: 'no-preference' })
    await page.goto('/?visualCase=rich#/settings/appearance', { waitUntil: 'commit' })

    // 安装测试 fixture 数据（模拟会话组与详情以便测量独立详情容器宽度）
    await page.evaluate(async () => {
      const modulePath = '/src/services/desktop-client/index.ts'
      const { desktopClient } = await import(modulePath)
      desktopClient.listSessionGroups = async () => [
        {
          id: 'visual-group',
          name: '可视化测试会话组',
          description: '用于测试会话组详情容器宽度',
          version: 1,
          memberCount: 0,
          projectLabels: [],
          latestStepAt: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ]
      desktopClient.readSessionGroup = async () => ({
        group: {
          id: 'visual-group',
          name: '可视化测试会话组',
          description: '用于测试会话组详情容器宽度',
          version: 1,
          memberCount: 0,
          projectLabels: [],
          latestStepAt: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        members: [],
        contextEntries: [],
      })
      desktopClient.listSessionGroupSteps = async () => []
    })

    const group = page.locator('.segmented-control[aria-label="页面宽度"]')
    const option = (label: string) => group.getByRole('radio', { name: label, exact: true })
    await group.waitFor({ state: 'visible', timeout: 15_000 })
    await expect(option('默认')).toHaveAttribute('data-state', 'on')

    const mainRoute = page.locator('.desktop-main-route')

    // 1. 验证外观设置初始为默认档（1009px）
    await expect(mainRoute).toHaveAttribute('data-page-width', 'default')
    await expectContentWidth(
      page.locator('.settings-content-inner .settings-page-header').first(),
      1009,
    )
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)

    // 2. 在外观设置中切换为“窄”（768px），验证即时生效
    await option('窄').focus()
    await page.keyboard.press('Space')
    await expect(option('窄')).toHaveAttribute('data-state', 'on')
    await expect(mainRoute).toHaveAttribute('data-page-width', 'narrow')
    await expectContentWidth(
      page.locator('.settings-content-inner .settings-page-header').first(),
      768,
    )

    // 设置行始终保持左右两列，包含实际触发旧 42rem 容器断点的尺寸。
    await page.evaluate(() => {
      window.location.hash = '#/settings/general'
    })
    const permissionRows = ['默认权限', '自动审核', '完全访问权限'].map((title) =>
      page
        .locator('.settings-row')
        .filter({ has: page.getByRole('heading', { name: title, exact: true }) }),
    )
    for (const row of permissionRows) await expectControlOnRight(row)
    const switchBox = await permissionRows[1].getByRole('switch').boundingBox()
    await page.setViewportSize({ width: 900, height: 1080 })
    await expect
      .poll(() =>
        page.locator('.settings-content-inner').evaluate((element) => {
          const style = getComputedStyle(element)
          const width =
            element.getBoundingClientRect().width -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight)
          return width < 42 * parseFloat(getComputedStyle(document.documentElement).fontSize)
        }),
      )
      .toBe(true)
    for (const row of permissionRows) await expectControlOnRight(row)
    const narrowSwitchBox = await permissionRows[1].getByRole('switch').boundingBox()
    expect(narrowSwitchBox!.width).toBeCloseTo(switchBox!.width, 1)
    expect(narrowSwitchBox!.height).toBeCloseTo(switchBox!.height, 1)
    const description = permissionRows[2].locator('.settings-row-desc')
    await expect(description).toHaveCSS('white-space', 'normal')
    await expect
      .poll(() =>
        description.evaluate((element) => {
          return (
            element.getBoundingClientRect().height >
              parseFloat(getComputedStyle(element).lineHeight) &&
            element.scrollHeight <= element.clientHeight + 1 &&
            element.scrollWidth <= element.clientWidth + 1
          )
        }),
      )
      .toBe(true)
    await expectNoHorizontalOverflow(page)
    await page.evaluate(() => {
      window.location.hash = '#/settings/appearance'
    })
    for (const title of ['页面宽度', '减少动态效果']) {
      await expectControlOnRight(
        page.locator('.settings-row').filter({
          has: page.getByRole('heading', { name: title, exact: true }),
        }),
      )
    }
    await expect(option('窄')).toHaveAttribute('data-state', 'on')
    await expectNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 1920, height: 1080 })

    // 3. 导航到聊天页，确认继承“窄”档位，Menu 快捷按钮可见
    await page.evaluate(() => {
      window.location.hash = '#/threads/visual-rich'
    })
    const conversation = page.locator('.conversation-page')
    await expect(conversation).toBeVisible()
    await expect(mainRoute).toHaveAttribute('data-page-width', 'narrow')

    const widthButton = page.getByRole('button', { name: /^页面宽度：/ })
    await expect(widthButton).toBeVisible()
    await expect(widthButton).toHaveAccessibleName('页面宽度：窄，点击切换为宽')

    // 4. 从聊天页通过 Menu 按钮轮换三档（窄 -> 宽 -> 默认 -> 窄），验证几何动效反馈
    const states = {
      default: { next: 'narrow', label: '默认', scale: 1 },
      narrow: { next: 'wide', label: '窄', scale: 0.75 },
      wide: { next: 'default', label: '宽', scale: 1.25 },
    } as const

    const initial = await iconGeometry(widthButton)
    expect(initial.lines).toHaveLength(3)

    // a. 点击 Menu 按钮切换为“宽”
    await widthButton.click()
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await expect(widthButton).toHaveAccessibleName('页面宽度：宽，点击切换为默认')
    await expect(widthButton.locator('svg')).toHaveAttribute('data-width', 'wide')
    const geoWide = await iconGeometry(widthButton)
    expect(geoWide.lines[0].width / initial.lines[0].width).toBeCloseTo(
      states.wide.scale / states.narrow.scale,
      2,
    )

    // b. 按 Enter 键切换为“默认”
    await page.keyboard.press('Enter')
    await expect(mainRoute).toHaveAttribute('data-page-width', 'default')
    await expect(widthButton).toHaveAccessibleName('页面宽度：默认，点击切换为窄')
    await expect(widthButton.locator('svg')).toHaveAttribute('data-width', 'default')
    const geoDefault = await iconGeometry(widthButton)
    expect(geoDefault.lines[0].width / initial.lines[0].width).toBeCloseTo(
      states.default.scale / states.narrow.scale,
      2,
    )

    // c. 按 Space 键切换回“窄”
    await page.keyboard.press('Space')
    await expect(mainRoute).toHaveAttribute('data-page-width', 'narrow')
    await expect(widthButton).toHaveAccessibleName('页面宽度：窄，点击切换为宽')
    await expect(widthButton.locator('svg')).toHaveAttribute('data-width', 'narrow')

    // 5. 在窄档（768px）下验证各布局类型
    const turn = page.locator('.canonical-turn').first()
    await expect(turn).toHaveCSS('max-width', '768px')
    await expect(page.locator('.workflow-page__composer-inner')).toHaveCSS('max-width', '768px')
    const body = turn.locator('.canonical-text-item--result > .md-body').first()
    await expect(body).toHaveCSS('max-width', 'none')
    await expect
      .poll(async () => {
        const bodyBox = await body.boundingBox()
        const outerBox = await turn.boundingBox()
        return Math.abs(bodyBox!.width - outerBox!.width)
      })
      .toBeLessThan(1)
    await expectNoHorizontalOverflow(page)

    // 窄档下验证 PrimaryPageLayout
    await page.evaluate(() => {
      window.location.hash = '#/plugins'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'narrow')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(page.locator('.primary-page-layout__header'), 768)
    await expectContentWidth(page.locator('.primary-page-layout__body'), 768)

    // 窄档下验证 ModelCenter
    await page.evaluate(() => {
      window.location.hash = '#/settings/providers'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'narrow')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(page.locator('.model-center-shell .settings-page-header').first(), 768)

    // 窄档下验证 QuickChat
    await page.evaluate(() => {
      window.location.hash = '#/new'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'narrow')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(page.locator('.quick-chat-view .chat-composer'), 768)

    // 6. 回到聊天页切换为“默认档”（1009px），验证跨页面生效
    await page.evaluate(() => {
      window.location.hash = '#/threads/visual-rich'
    })
    await expect(conversation).toBeVisible()
    await expect(widthButton).toBeVisible()
    await widthButton.click() // 窄 -> 宽
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await widthButton.click() // 宽 -> 默认
    await expect(mainRoute).toHaveAttribute('data-page-width', 'default')
    await expect(turn).toHaveCSS('max-width', '1009px')
    await expect(page.locator('.workflow-page__composer-inner')).toHaveCSS('max-width', '1009px')

    // 默认档下验证 SettingsLayout 与 PrimaryPageLayout
    await page.evaluate(() => {
      window.location.hash = '#/settings/appearance'
    })
    await expect(option('默认')).toHaveAttribute('data-state', 'on')
    await expectContentWidth(
      page.locator('.settings-content-inner .settings-page-header').first(),
      1009,
    )

    await page.evaluate(() => {
      window.location.hash = '#/session-groups'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'default')
    await expectContentWidth(page.locator('.primary-page-layout__header'), 1009)

    await page.evaluate(() => {
      window.location.hash = '#/new'
    })
    await expectContentWidth(page.locator('.quick-chat-view .chat-composer'), 1009)

    // 7. 回到聊天页切换为“宽档”（1250px），验证全部一级页面及独立详情
    await page.evaluate(() => {
      window.location.hash = '#/threads/visual-rich'
    })
    await expect(conversation).toBeVisible()
    await expect(widthButton).toBeVisible()
    await widthButton.click() // 默认 -> 窄
    await expect(mainRoute).toHaveAttribute('data-page-width', 'narrow')
    await widthButton.click() // 窄 -> 宽
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await expect(turn).toHaveCSS('max-width', '1250px')
    await expect(page.locator('.workflow-page__composer-inner')).toHaveCSS('max-width', '1250px')

    // 宽档下验证右侧面板展开与视口收缩时的自适应
    await page.getByRole('button', { name: '显示右侧面板', exact: true }).click()
    await page.setViewportSize({ width: 1100, height: 800 })
    await expectNoHorizontalOverflow(page)
    await expect(widthButton).toBeInViewport()
    const available = await conversation.boundingBox()
    const compact = await turn.boundingBox()
    expect(compact!.width).toBeLessThanOrEqual(available!.width)
    await page.getByRole('button', { name: '关闭右侧面板', exact: true }).click()
    await page.setViewportSize({ width: 1920, height: 1080 })

    // 宽档下全面覆盖所有一级路由与详情：
    // 项目 (PrimaryPageLayout)
    await page.evaluate(() => {
      window.location.hash = '#/projects'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(page.locator('.primary-page-layout__header'), 1250)
    await expectContentWidth(page.locator('.primary-page-layout__body'), 1250)
    await expectNoHorizontalOverflow(page)

    // 模型中心 (ModelCenter)
    await page.evaluate(() => {
      window.location.hash = '#/settings/providers'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(
      page.locator('.model-center-shell .settings-page-header').first(),
      1250,
    )
    await expectNoHorizontalOverflow(page)

    // 插件列表及独立详情
    await page.evaluate(() => {
      window.location.hash = '#/plugins'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(page.locator('.primary-page-layout__header'), 1250)
    await expectContentWidth(page.locator('.primary-page-layout__body'), 1250)
    await expectNoHorizontalOverflow(page)

    const pluginCard = page.locator('.plugin-catalog-card__main').first()
    await pluginCard.click()
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(page.locator('.catalog-details-view'), 1250)
    await expectNoHorizontalOverflow(page)
    await page.evaluate(() => {
      window.location.hash = '#/plugins'
    })
    await expect(page.locator('.catalog-details-view')).toHaveCount(0)

    // 会话组列表及独立详情
    await page.evaluate(() => {
      window.location.hash = '#/session-groups'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(page.locator('.primary-page-layout__header'), 1250)
    await expectContentWidth(page.locator('.primary-page-layout__body'), 1250)
    await expectNoHorizontalOverflow(page)

    await page.evaluate(() => {
      window.location.hash = '#/session-groups/visual-group'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(page.locator('.session-group-detail__inner'), 1250)
    await expectNoHorizontalOverflow(page)

    // 自动化
    await page.evaluate(() => {
      window.location.hash = '#/automations'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(page.locator('.primary-page-layout__header'), 1250)
    await expectContentWidth(page.locator('.primary-page-layout__body'), 1250)
    await expectNoHorizontalOverflow(page)

    // 宠物
    await page.evaluate(() => {
      window.location.hash = '#/pets'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(page.locator('.primary-page-layout__header'), 1250)
    await expectContentWidth(page.locator('.primary-page-layout__body'), 1250)
    await expectNoHorizontalOverflow(page)

    // Pull Requests
    await page.evaluate(() => {
      window.location.hash = '#/pull-requests'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(page.locator('.primary-page-layout__header'), 1250)
    await expectContentWidth(page.locator('.primary-page-layout__body'), 1250)
    await expectNoHorizontalOverflow(page)

    // 新建聊天
    await page.evaluate(() => {
      window.location.hash = '#/new'
    })
    await expect(mainRoute).toHaveAttribute('data-page-width', 'wide')
    await expect(page.getByRole('button', { name: /^页面宽度：/ })).toHaveCount(0)
    await expectContentWidth(page.locator('.quick-chat-view .chat-composer'), 1250)
    await expectNoHorizontalOverflow(page)

    // 8. 重新回到外观设置，验证选择持久化保留为“宽”档
    await page.evaluate(() => {
      window.location.hash = '#/settings/appearance'
    })
    await expect(option('宽')).toHaveAttribute('data-state', 'on')
    await expectContentWidth(
      page.locator('.settings-content-inner .settings-page-header').first(),
      1250,
    )
    await expectNoHorizontalOverflow(page)
  })
}
