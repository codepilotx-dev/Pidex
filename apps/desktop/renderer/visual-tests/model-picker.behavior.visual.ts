import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  closeTransientErrorToast,
  prepareVisualTheme,
  waitForVisualPage,
} from './VisualTestHelpers.js'

const PICKER_FIXTURE = '?visualCase=permission&visualModelPicker=1'
const CATALOG_FIXTURE = '?visualCase=permission&visualProviderCatalog=logos'

const PANEL = '.composer-model-panel'
const PANEL_CONTENT = '.composer-model-panel-content'
const RAIL_BUTTON = '.composer-provider-btn'
const MODEL_ROW = '.composer-model-row'
const MODEL_ROW_SELECTED = '.composer-model-row.is-selected'
const EFFORT_PILL = '.composer-effort-pill'
const EFFORT_DROPDOWN = '.composer-effort-dropdown'
const EFFORT_ITEM = '.composer-effort-item'
const HUB_TRIGGER = '.composer-hub-trigger-btn'
const HUB_ROW = '.composer-hub-row'
const HUB_BACK = '.composer-hub-back'
const SEARCH_TRIGGER = '.composer-search-trigger'
const SEARCH_INPUT = '.composer-search-input'
const MODELS_TITLE = '.composer-models-title'
const PROVIDER_LOGO = '.composer-provider-logo'
const PROVIDER_LOGO_IMAGE = '.composer-provider-logo .ui-remote-image img'

async function openModelPicker(
  page: Page,
  fixture = PICKER_FIXTURE,
): Promise<{ trigger: Locator; panel: Locator }> {
  await page.goto(`${fixture}#/threads/visual-permission`)
  const trigger = page.locator('.composer-model-chip:visible')
  await waitForVisualPage(page, 'dark', trigger)
  await trigger.click()
  const panel = page.locator(PANEL)
  await expect(panel).toBeVisible()
  return { trigger, panel }
}

test('model picker opens as a provider rail plus model panel above its trigger', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })

  const { trigger, panel } = await openModelPicker(page)

  await expect(page.locator(PANEL_CONTENT)).toHaveAttribute('data-side', 'top')
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')

  const panelBox = await panel.boundingBox()
  const triggerBox = await trigger.boundingBox()
  expect(panelBox).not.toBeNull()
  expect(triggerBox).not.toBeNull()
  expect(Math.round(panelBox!.width)).toBe(416)
  expect(Math.round(panelBox!.height)).toBe(390)
  // The panel rises above the composer and stays inside the viewport.
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(triggerBox!.y + 1)
  expect(panelBox!.y).toBeGreaterThanOrEqual(0)
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(1440)

  // Selection state is carried by the rail and the model rows, not by a
  // collapsed trigger: exactly one row is selected and exactly one rail entry
  // is active.
  await expect(page.locator(MODEL_ROW).first()).toBeVisible()
  await expect(page.locator(MODEL_ROW_SELECTED)).toHaveCount(1)
  await expect(page.locator(`${RAIL_BUTTON}.is-active`)).toHaveCount(1)

  // Provider marks come from the catalogue logo URL. The fixture provider
  // exposes /favicon.png, which is a local asset so it is never in the
  // RemoteImage fallback state.
  await expect(page.locator(`${RAIL_BUTTON} ${PROVIDER_LOGO_IMAGE}`)).toHaveCount(1)
  await expect(page.locator(`${RAIL_BUTTON} ${PROVIDER_LOGO_IMAGE}`).first()).toHaveAttribute(
    'src',
    '/favicon.png',
  )

  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('reasoning effort menu is anchored to its pill and re-targets the trigger badge', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })

  const { trigger, panel } = await openModelPicker(page)
  const selectedRow = page.locator(MODEL_ROW_SELECTED)
  const pill = selectedRow.locator(EFFORT_PILL)
  await expect(pill).toBeVisible()

  const badge = trigger.locator('.composer-model-chip-thinking')
  const initialBadge = (await badge.textContent())?.trim() ?? ''
  expect(initialBadge.length).toBeGreaterThan(0)

  await pill.click()
  const dropdown = selectedRow.locator(EFFORT_DROPDOWN)
  await expect(dropdown).toBeVisible()

  // The menu hangs off the pill inside the selected row instead of floating at
  // a fixed panel position.
  const [pillBox, dropdownBox, rowBox] = await Promise.all([
    pill.boundingBox(),
    dropdown.boundingBox(),
    selectedRow.boundingBox(),
  ])
  expect(pillBox).not.toBeNull()
  expect(dropdownBox).not.toBeNull()
  expect(rowBox).not.toBeNull()
  expect(dropdownBox!.y).toBeGreaterThanOrEqual(pillBox!.y + pillBox!.height - 1)
  expect(
    Math.abs(dropdownBox!.x + dropdownBox!.width - (pillBox!.x + pillBox!.width)),
  ).toBeLessThanOrEqual(2)

  const items = dropdown.locator(EFFORT_ITEM)
  const itemCount = await items.count()
  expect(itemCount).toBeGreaterThanOrEqual(2)

  const alternative = items.filter({ hasNotText: initialBadge }).first()
  await expect(alternative).toBeVisible()
  const alternativeLabel = (await alternative.textContent())?.trim() ?? ''
  expect(alternativeLabel.length).toBeGreaterThan(0)

  await alternative.click()
  await expect(dropdown).toHaveCount(0)
  await expect(badge).toHaveText(alternativeLabel)

  // The panel stays open: switching effort is not a model switch.
  await expect(panel).toBeVisible()
})

test('model hub lists the provider directory, filters it, and returns to the models view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 920 })
  await prepareVisualTheme(page, 'dark', { reduceMotion: 'off' })

  const { panel } = await openModelPicker(page)
  const modelsTitle = panel.locator(MODELS_TITLE)
  const initialTitle = (await modelsTitle.textContent())?.trim() ?? ''

  await panel.locator(HUB_TRIGGER).click()
  await expect(panel.locator(HUB_ROW).first()).toBeVisible()
  const totalRows = await panel.locator(HUB_ROW).count()
  expect(totalRows).toBeGreaterThanOrEqual(10)

  // Every directory entry renders a provider mark; the tile is filled from the
  // catalogue logo URL rather than a bundled brand glyph.
  await expect(panel.locator(`${HUB_ROW} ${PROVIDER_LOGO}`)).toHaveCount(totalRows)

  const hubSearch = panel.locator(SEARCH_INPUT)
  await hubSearch.fill('OpenRouter')
  await expect(panel.locator(HUB_ROW)).toHaveCount(1)
  await expect(panel.locator(HUB_ROW).first()).toContainText('OpenRouter')

  await panel.locator(HUB_BACK).click()
  await expect(panel.locator(HUB_ROW)).toHaveCount(0)
  await expect(modelsTitle).toHaveText(initialTitle)
})

test('model picker keeps a bounded trigger and stays inside a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 520 })
  await prepareVisualTheme(page, 'light', { reduceMotion: 'off' })

  await page.goto(`${PICKER_FIXTURE}#/threads/visual-permission`)
  const trigger = page.locator('.composer-model-chip:visible')
  await waitForVisualPage(page, 'light', trigger)
  await closeTransientErrorToast(page)
  await expect.poll(async () => (await trigger.boundingBox())?.width ?? 0).toBeLessThan(224)

  await trigger.click()
  const panel = page.locator(PANEL)
  await expect(panel).toBeVisible()

  const panelBox = await panel.boundingBox()
  expect(panelBox).not.toBeNull()
  expect(panelBox!.y).toBeGreaterThanOrEqual(0)
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(520)
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(900)

  // Quick search collapses back to its trigger without leaving the panel.
  await panel.locator(SEARCH_TRIGGER).click()
  await expect(panel.locator(SEARCH_INPUT)).toBeVisible()
  await expect(panel.locator(SEARCH_TRIGGER)).toHaveCount(0)
})
