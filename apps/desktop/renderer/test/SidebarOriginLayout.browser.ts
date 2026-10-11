// Run from apps/desktop/renderer: node --experimental-strip-types test/SidebarOriginLayout.browser.ts
import { chromium } from '@playwright/test'
import { strict as assert } from 'node:assert'
import { compileEntryStyles } from './helpers/RendererStyles.js'

const css = await compileEntryStyles()

/*
 * 侧栏外观已迁移到 TSX 的 `tw:` utility，因此这里的固定 DOM 必须使用与组件一致的
 * 类名清单（语义类 + utility），否则测不到真实几何。
 */
const INDICATOR_CLASS =
  'sidebar-indicator tw:inline-flex tw:size-6 tw:flex-none tw:items-center tw:justify-center tw:text-app-text-meta tw:[&>svg]:size-icon-md'
const UNREAD_DOT_CLASS =
  'sidebar-unread-dot tw:size-1.5 tw:flex-none tw:rounded-full tw:bg-app-accent'
const SESSION_ACTIONS_CLASS =
  'sidebar-session-actions tw:flex tw:w-full tw:items-center tw:justify-end tw:gap-1'
const SECTION_ACTIONS_CLASS =
  'sidebar-section-actions tw:flex tw:w-full tw:items-center tw:justify-end tw:gap-1 tw:opacity-0 tw:pointer-events-none tw:transition-opacity tw:duration-feedback tw:ease-out tw:group-hover:opacity-100 tw:group-hover:pointer-events-auto tw:group-has-[:focus-visible]:opacity-100 tw:group-has-[:focus-visible]:pointer-events-auto tw:has-[[data-state=open]]:opacity-100 tw:has-[[data-state=open]]:pointer-events-auto'
const PROJECT_ACTIONS_CLASS =
  'sidebar-project-actions tw:relative tw:flex tw:min-h-6 tw:items-center tw:justify-end tw:gap-1 tw:transition-opacity tw:duration-feedback tw:ease-out tw:group-hover:opacity-100 tw:group-hover:pointer-events-auto tw:group-has-[:focus-visible]:opacity-100 tw:group-has-[:focus-visible]:pointer-events-auto tw:has-[[data-state=open]]:opacity-100 tw:has-[[data-state=open]]:pointer-events-auto tw:opacity-0 tw:pointer-events-none'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  await page.setContent(`<style>${css}
 * {box-sizing:border-box} .desktop-sidebar {--sidebar-current-width:280px;--cpx-sys-motion-micro:0ms; --button-icon-size-xs:14px;} .sidebar-session-meta{display:flex;align-items:center;justify-content:flex-end} .row{height:32px;padding:4px 8px;display:flex;justify-content:flex-end}
 </style><aside class="desktop-sidebar"><header class="sidebar-header tw:mx-2 tw:my-0 tw:flex tw:min-h-13 tw:shrink-0 tw:min-w-0 tw:items-center tw:justify-between"><span>Coding</span><div class="sidebar-header-actions tw:ml-2 tw:flex tw:min-w-0 tw:items-center tw:gap-1 tw:pr-2"><button class="ui-button icon-button" data-size="icon" data-uniform><svg id="search"></svg></button><button class="ui-button icon-button" data-size="icon" data-uniform><svg id="bell"></svg></button></div></header><div class="sidebar-standard-mode tw:flex tw:min-w-0 tw:flex-col tw:gap-4 tw:px-2">
 <div class="row"><div class="sidebar-session-meta tw:min-w-0 tw:gap-1"><span class="${INDICATOR_CLASS}"><svg id="clock"></svg></span><span class="${INDICATOR_CLASS}"><span id="dot" class="${UNREAD_DOT_CLASS}"></span></span></div></div>
 <div class="row"><div class="sidebar-session-meta tw:min-w-0 tw:gap-1"><div class="${SESSION_ACTIONS_CLASS}"><button class="ui-button icon-button" data-size="compact" data-uniform><svg id="pin"></svg></button><button class="ui-button icon-button" data-size="compact" data-uniform><svg id="archive"></svg></button></div></div></div>
 <div class="row"><div class="sidebar-session-meta tw:min-w-0 tw:gap-1"><span class="${INDICATOR_CLASS}"><svg id="idle-clock"></svg></span></div></div>
 <div class="row sidebar-project-header tw:cursor-pointer tw:group"><span class="sidebar-row-trailing"><div class="${PROJECT_ACTIONS_CLASS}"><button id="project-more" class="ui-button icon-button" data-size="compact" data-uniform><svg></svg></button><button id="project-action" class="ui-button icon-button" data-size="compact" data-uniform><svg></svg></button></div><span class="sidebar-project-unread ${INDICATOR_CLASS} tw:pointer-events-none tw:absolute tw:inset-y-0 tw:end-0 tw:my-auto tw:group-hover:hidden tw:group-has-[:focus-visible]:hidden"><span id="project-dot" class="${UNREAD_DOT_CLASS}"></span></span></span></div>
 <div class="row sidebar-section-header tw:sticky tw:top-0 tw:z-local tw:grid tw:min-h-[var(--sidebar-row-height)] tw:w-full tw:grid-cols-[minmax(0,1fr)_var(--sidebar-trailing-width)] tw:items-center tw:gap-x-2 tw:rounded-md tw:px-2 tw:select-none tw:focus-within:outline-none tw:group"><button id="section-title">项目</button><div class="${SECTION_ACTIONS_CLASS}"><button id="section-menu" class="ui-button icon-button" data-size="iconMd" data-uniform data-state="closed"><svg id="section-more"></svg></button><button class="ui-button icon-button" data-size="iconMd" data-uniform><svg id="section-add"></svg></button></div></div>
 </div></aside>`)
  for (const width of [240, 280, 360]) {
    await page
      .locator('aside')
      .evaluate(
        (el, width) =>
          (el as HTMLElement).style.setProperty('--sidebar-current-width', `${width}px`),
        width,
      )
    const centers = await page.evaluate(() =>
      Object.fromEntries(
        [
          'clock',
          'dot',
          'pin',
          'archive',
          'idle-clock',
          'search',
          'bell',
          'section-more',
          'section-add',
        ].map((id) => {
          const b = document.getElementById(id)!.getBoundingClientRect()
          return [id, b.x + b.width / 2]
        }),
      ),
    )
    assert.equal(centers['section-more'], centers.clock)
    assert.equal(centers['section-add'], centers.dot)
    assert.equal(centers.search, centers.clock)
    assert.equal(centers.bell, centers.dot)
    assert.equal(centers.clock, centers.pin)
    assert.equal(centers.dot, centers.archive)
    assert.equal(centers['idle-clock'], centers.archive)
    const projectDot = page.locator('#project-dot')
    const projectAction = page.locator('#project-action')
    const dotBox = await projectDot.boundingBox()
    assert.ok(dotBox)
    assert.equal(dotBox.x + dotBox.width / 2, centers.dot)
    await page.locator('.sidebar-project-header').hover()
    assert.equal(await projectDot.isVisible(), false)
    const actionBox = await projectAction.boundingBox()
    assert.ok(actionBox)
    assert.equal(actionBox.x + actionBox.width / 2, centers.dot)
    const moreBox = await page.locator('#project-more').boundingBox()
    assert.ok(moreBox)
    assert.equal(moreBox.x + moreBox.width / 2, centers.clock)
    await projectAction.click()
    await page.mouse.move(700, 500)
    assert.equal(await projectAction.evaluate((el) => el === document.activeElement), true)
    assert.equal(await projectDot.isVisible(), true)
    await page.keyboard.press('Shift+Tab')
    assert.equal(await projectDot.isVisible(), false)
    await page.mouse.click(700, 500)
    assert.equal(await projectDot.isVisible(), true)
    console.log(JSON.stringify({ width, centers }))
  }
  const title = page.locator('#section-title')
  const actions = page.locator('.sidebar-section-actions')
  const opacity = () => actions.evaluate((el) => getComputedStyle(el).opacity)
  await title.click()
  await page.mouse.move(700, 500)
  assert.equal(await title.evaluate((el) => el === document.activeElement), true)
  assert.equal(await opacity(), '0')
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  assert.equal(await title.evaluate((el) => el.matches(':focus-visible')), true)
  assert.equal(await opacity(), '1')
  await page.locator('#section-menu').evaluate((el) => el.setAttribute('data-state', 'open'))
  await page.mouse.click(700, 500)
  assert.equal(await opacity(), '1')
  await page.locator('#section-menu').evaluate((el) => el.setAttribute('data-state', 'closed'))
  assert.equal(await opacity(), '0')
  console.log('Pointer focus hides actions; keyboard focus and open menus reveal them.')
} finally {
  await browser.close()
}
