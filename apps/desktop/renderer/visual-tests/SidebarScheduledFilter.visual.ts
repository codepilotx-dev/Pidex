import { expect, test, type Page, type Locator } from '@playwright/test'
import { DESKTOP_VIEWPORT } from './VisualTestHelpers'

async function seedSidebar(page: Page, showScheduledSessions = true) {
  await page.evaluate(async (show) => {
    const clientPath = '/src/services/desktop-client/index.ts'
    const { desktopClient } = await import(clientPath)
    for (const [id, title, scheduled] of [
      ['visual-rich', '独立日程会话', true],
      ['visual-switch-b', '普通日程续跑', false],
      ['visual-switch-c', '普通聊天', false],
    ] as const) {
      const snapshot = await desktopClient.getSession(id)
      Object.assign(snapshot.item, {
        sessionName: title,
        customTitle: title,
        isScheduledSession: scheduled,
        hasScheduledRun: id !== 'visual-switch-c',
        creationSurface: 'coding',
        lastMessageAt: new Date().toISOString(),
      })
    }
    await desktopClient.saveDesktopSettings({
      ...(await desktopClient.getDesktopSettings()),
      sidebarProductMode: 'coding',
      sidebarTimelineEnabled: false,
      sidebarOrganization: 'projects',
      sidebarShowScheduledSessions: show,
      collapsedSidebarSections: [],
      collapsedSidebarProjectPaths: [],
      sidebarActivityCoachmarkDismissed: true,
    })
    await desktopClient.setActiveSession('visual-rich')
  }, showScheduledSessions)
}

async function expectAnchored(page: Page, menu: Locator, trigger: Locator) {
  await expect(menu).toBeVisible()
  await expect
    .poll(async () => {
      const anchor = await trigger.boundingBox()
      const box = await menu.boundingBox()
      return box && anchor ? Math.abs(box.x - anchor.x) : Infinity
    })
    .toBeLessThanOrEqual(1)
  await expect(menu).toHaveAttribute('data-side', 'bottom')
  await expect
    .poll(async () => {
      const anchor = await trigger.boundingBox()
      const box = await menu.boundingBox()
      return box && anchor ? Math.abs(box.y - anchor.y - anchor.height - 4) : Infinity
    })
    .toBeLessThanOrEqual(1)
  const box = await menu.boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
}

const row = (page: Page, name: string) =>
  page.locator('.desktop-sidebar .sidebar-session-button').filter({ hasText: name })

test.use({ reducedMotion: null })
test.setTimeout(45_000)

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await page.goto('/?visualCase=rich&visualSwitchTargets=1#/threads/visual-rich', {
    waitUntil: 'domcontentloaded',
  })
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()
  await seedSidebar(page)
})

test('项目和最近菜单跟随按钮向右下展开，日程过滤经设置边界保存并恢复', async ({ page }) => {
  const organizeTrigger = (section: string) =>
    page
      .locator(`.sidebar-section:has([data-sidebar-section-id="${section}"])`)
      .getByRole('button', { name: '整理侧栏', exact: true })
  let trigger = organizeTrigger('projects')
  const menu = page.locator('.popover-sidebar-organize[data-state="open"]')
  await expect(row(page, '独立日程会话')).toBeVisible()
  await trigger.locator('xpath=ancestor::*[contains(@class, "sidebar-section-header")][1]').hover()
  await trigger.click()
  await expectAnchored(page, menu, trigger)
  const checkbox = menu.getByRole('menuitemcheckbox', { name: '显示日程会话' })
  await expect(checkbox).toHaveAttribute('aria-checked', 'true')
  await checkbox.click()
  await expect(menu).toBeVisible()
  await expect(row(page, '独立日程会话')).toHaveCount(0)
  await expect(row(page, '普通日程续跑')).toBeVisible()
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const clientPath = '/src/services/desktop-client/index.ts'
        const { desktopClient } = await import(clientPath)
        return (await desktopClient.getDesktopSettings()).sidebarShowScheduledSessions
      }),
    )
    .toBe(false)
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  const separator = page.getByRole('separator', { name: '调整任务侧栏宽度' })
  const widthBefore = (await page.locator('.desktop-sidebar').boundingBox())!.width
  await separator.focus()
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(async () => (await page.locator('.desktop-sidebar').boundingBox())!.width)
    .toBeGreaterThan(widthBefore)
  await trigger.locator('xpath=ancestor::*[contains(@class, "sidebar-section-header")][1]').hover()
  await trigger.click()
  await expectAnchored(page, menu, trigger)
  await menu.getByRole('menuitemradio', { name: '在一个列表中' }).click()
  await page.keyboard.press('Escape')
  trigger = organizeTrigger('recent')
  await trigger.locator('xpath=ancestor::*[contains(@class, "sidebar-section-header")][1]').hover()
  await trigger.click()
  await expectAnchored(page, menu, trigger)
  // Simulate a near-bottom anchor without depending on the number of projects.
  await page.keyboard.press('Escape')
  await trigger
    .locator('xpath=ancestor::*[contains(@class, "sidebar-section-header")][1]')
    .evaluate((element) => {
      const header = element as HTMLElement
      header.style.position = 'fixed'
      header.style.bottom = '160px'
      header.style.width = '240px'
    })
  await trigger.locator('xpath=ancestor::*[contains(@class, "sidebar-section-header")][1]').hover()
  await trigger.focus()
  await trigger.press('Enter')
  await expectAnchored(page, menu, trigger)
  expect(
    await menu.evaluate((element) =>
      [element, ...element.querySelectorAll('.popover-scroll-content')].some(
        (container) => container.scrollHeight > container.clientHeight,
      ),
    ),
  ).toBe(true)
  const bottomFilter = menu.getByRole('menuitemcheckbox', { name: '显示日程会话' })
  await bottomFilter.scrollIntoViewIfNeeded()
  await bottomFilter.click()
  await expect(row(page, '独立日程会话')).toBeVisible()
  await bottomFilter.click()
  await expect(row(page, '独立日程会话')).toHaveCount(0)
  await page.keyboard.press('Escape')
  // The browser mock is in-memory; restore its saved service result after reload,
  // as Electron's durable settings service does in the actual application.
  const savedShow = await page.evaluate(async () => {
    const clientPath = '/src/services/desktop-client/index.ts'
    const { desktopClient } = await import(clientPath)
    return (await desktopClient.getDesktopSettings()).sidebarShowScheduledSessions
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('已完成工作台结构梳理。', { exact: true })).toBeVisible()
  await seedSidebar(page, savedShow)
  trigger = organizeTrigger('projects')
  await expect(row(page, '独立日程会话')).toHaveCount(0)
  await trigger.locator('xpath=ancestor::*[contains(@class, "sidebar-section-header")][1]').hover()
  await trigger.click()
  await expect(menu.getByRole('menuitemcheckbox', { name: '显示日程会话' })).toHaveAttribute(
    'aria-checked',
    'false',
  )
  await menu.getByRole('menuitemcheckbox', { name: '显示日程会话' }).click()
  await expect(row(page, '独立日程会话')).toBeVisible()
})

test('活动过滤全部会话后仍能从空状态重新开启显示', async ({ page }) => {
  await page.evaluate(async () => {
    const clientPath = '/src/services/desktop-client/index.ts'
    const { desktopClient } = await import(clientPath)
    for (const snapshot of await desktopClient.listSessions())
      snapshot.item.isScheduledSession = true
    await desktopClient.setActiveSession('visual-rich')
    await desktopClient.saveDesktopSettings({
      ...(await desktopClient.getDesktopSettings()),
      sidebarTimelineEnabled: true,
    })
  })
  const trigger = page.getByRole('button', { name: '优先级显示选项', exact: true }).first()
  const menu = page.locator('.sidebar-timeline-menu[data-state="open"]')
  await trigger.locator('xpath=ancestor::*[contains(@class, "sidebar-section-header")][1]').hover()
  await trigger.click()
  await expectAnchored(page, menu, trigger)
  await menu.getByRole('menuitemcheckbox', { name: '显示日程会话' }).click()
  await expect(page.getByText('当前筛选下没有活动', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await trigger.locator('xpath=ancestor::*[contains(@class, "sidebar-section-header")][1]').hover()
  await trigger.click()
  await expectAnchored(page, menu, trigger)
  await menu.getByRole('menuitemcheckbox', { name: '显示日程会话' }).click()
  await expect(page.getByText('当前筛选下没有活动', { exact: true })).toHaveCount(0)
})
