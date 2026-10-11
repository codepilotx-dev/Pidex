import { expect, test, type Locator } from '@playwright/test'
import {
  COMPACT_VIEWPORT,
  DESKTOP_VIEWPORT,
  prepareVisualTheme,
  waitForVisualPage,
} from './VisualTestHelpers.js'

async function expectSearchFitsPopover(surface: Locator, searchInput: Locator): Promise<void> {
  const searchContainer = searchInput.locator('..')
  const widthContainer = searchContainer.locator('..')
  const measurements = await widthContainer.evaluate((container) => {
    const search = container.querySelector(':scope > .search-input')
    if (!(search instanceof HTMLElement)) {
      throw new Error('SearchInput container is not mounted')
    }
    const containerStyle = getComputedStyle(container)
    const searchWidth = search.getBoundingClientRect().width
    const availableWidth =
      container.clientWidth -
      Number.parseFloat(containerStyle.paddingLeft) -
      Number.parseFloat(containerStyle.paddingRight)

    return {
      availableWidth,
      clientWidth: container.clientWidth,
      scrollWidth: container.scrollWidth,
      searchWidth,
    }
  })
  const surfaceOverflow = await surface.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))

  expect(measurements.searchWidth).toBeLessThanOrEqual(measurements.availableWidth + 1)
  expect(measurements.searchWidth).toBeGreaterThanOrEqual(measurements.availableWidth - 3)
  expect(measurements.scrollWidth).toBeLessThanOrEqual(measurements.clientWidth)
  expect(surfaceOverflow.scrollWidth).toBeLessThanOrEqual(surfaceOverflow.clientWidth)
}

test('SettingsDropdown searchable — combobox keyboard and clear behavior', async ({ page }) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await prepareVisualTheme(page, 'light', { reduceMotion: 'off' })
  await page.goto('/?visualCase=empty#/settings/general')

  // Wait for general settings page
  const languageTrigger = page.getByRole('button', { name: '语言' })
  await waitForVisualPage(page, 'light', languageTrigger)

  // Open the language dropdown
  await languageTrigger.click()

  // The search input should be focused
  const searchField = page.getByRole('combobox', { name: '搜索语言' })
  await expect(searchField).toBeVisible()
  await expect(searchField).toBeFocused()

  // aria-controls should point to an existing listbox
  const controlsId = await searchField.getAttribute('aria-controls')
  expect(controlsId).not.toBeNull()
  const listbox = page.locator(`#${controlsId}`)
  await expect(listbox).toBeVisible()
  await expect(listbox).toHaveAttribute('role', 'listbox')

  // aria-expanded should be true when opened
  await expect(searchField).toHaveAttribute('aria-expanded', 'true')
  await expectSearchFitsPopover(page.locator('.settings-dropdown-content'), searchField)

  // Filter items
  await searchField.fill('English')
  await expect(page.getByRole('option', { name: /English/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /中文/ })).not.toBeVisible()

  // Clear button resets the query and restores focus
  const clearButton = page.getByRole('button', { name: '清除搜索' })
  await clearButton.click()
  await expect(searchField).toHaveValue('')
  await expect(searchField).toBeFocused()

  await searchField.fill('English')

  // ArrowDown + Enter selects first option
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(languageTrigger).toContainText('English (US)')

  // Open again and test empty state
  await languageTrigger.click()
  const searchField2 = page.getByRole('combobox', { name: '搜索语言' })
  await searchField2.fill('zzzznotexist')
  // Empty state message
  await expect(page.getByText('未找到匹配项')).toBeVisible()

  // First Escape clears query
  await page.keyboard.press('Escape')
  await expect(searchField2).toHaveValue('')

  // Second Escape closes popover and returns focus to trigger
  await page.keyboard.press('Escape')
  await expect(languageTrigger).toBeFocused()
  await expect(searchField2).not.toBeVisible()
})

test('Popover SearchInput follows the available surface width', async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT)
  await prepareVisualTheme(page, 'light', { reduceMotion: 'off' })
  await page.goto('/?visualCase=empty#/new')

  const projectTrigger = page.getByTitle('选择项目')
  await waitForVisualPage(page, 'light', projectTrigger)
  await projectTrigger.click()

  const surface = page.locator('.popover-project[data-state="open"]')
  const searchInput = surface.getByRole('combobox', { name: '搜索项目' })
  await expect(searchInput).toBeVisible()
  await expectSearchFitsPopover(surface, searchInput)

  await searchInput.fill('一个不会改变弹层宽度的非常长的项目搜索关键词')
  await expectSearchFitsPopover(surface, searchInput)
})

test('Command menu search — forced-colors focus outline', async ({ page }) => {
  await page.setViewportSize(COMPACT_VIEWPORT)
  await prepareVisualTheme(page, 'light', { reduceMotion: 'off' })
  await page.emulateMedia({ forcedColors: 'active' })
  await page.goto('/?visualCase=empty#/new')
  await waitForVisualPage(page, 'light', page.locator('main'))
  await page.keyboard.press('Control+K')

  const searchInput = page.getByRole('searchbox', { name: '搜索任务' })
  await waitForVisualPage(page, 'light', searchInput)

  await expect(searchInput).toBeFocused()

  await expect(searchInput).toHaveCSS('outline-style', 'solid')
})
