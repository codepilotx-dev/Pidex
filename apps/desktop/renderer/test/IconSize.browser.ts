// Run from apps/desktop/renderer (Node owns Playwright pipes on Windows):
// bun build ./test/IconSize.browser.ts --target=node --external=@playwright/test --external=sass --outdir=./node_modules/.cache --entry-naming=IconSize.browser.mjs
// node node_modules/.cache/IconSize.browser.mjs
import { strict as assert } from 'node:assert'
import { chromium } from '@playwright/test'
import { compileEntryStyles } from './helpers/RendererStyles.js'
import { createElement as h } from 'react'
import { renderToReadableStream, renderToString } from 'react-dom/server'
import {
  Activity,
  Archive,
  ArrowUp,
  CalendarClock,
  ChevronRight,
  Clock3,
  Pin,
  Plus,
  Square,
} from 'lucide-react'
import { Button, type ButtonSize } from '../src/components/ui/Button.js'
import { Spinner } from '../src/components/ui/Spinner.js'
import {
  APP_ICON_SIZE,
  APP_ICON_SIZES,
  APP_ICON_STROKE_WIDTH,
} from '../src/components/ui/IconTokens.js'
import { FileTypeIcon, FolderTypeIcon } from '../src/features/layout/FileTypeIcon.js'
import { SidebarRow } from '../src/features/layout/sidebar/SidebarRow.js'
import { PluginIcon } from '../src/features/plugins/PluginIcon.js'
import { ProviderLogo } from '../src/features/session/composer/ProviderLogos.js'

const css = await compileEntryStyles()
const sizes: [ButtonSize, number, number][] = [
  ['compact', 24, 12],
  ['composer', 28, 16],
  ['composerSm', 28, 12],
  ['composerUtility', 28, 16],
  ['default', 24, 16],
  ['icon', 28, 16],
  ['iconLarge', 36, 20],
  ['iconMd', 20, 12],
  ['iconSm', 16, 12],
  ['large', 36, 20],
  ['medium', 32, 16],
  ['tabStripAction', 36, 16],
  ['toolbar', 28, 16],
  ['toolbarLabel', 28, 16],
]
const expected = (size: number, content: string) =>
  `<div data-expected-icon-size="${size}">${content}</div>`
const buttons = sizes
  .map(([size, , iconSize]) =>
    expected(
      iconSize,
      renderToString(
        h(Button, {
          id: `button-${size}`,
          size,
          children: h(Plus),
        }),
      ),
    ),
  )
  .join('')
const states =
  expected(
    16,
    renderToString(
      h(
        'div',
        null,
        h(Button, { id: 'disabled', disabled: true, children: h(Plus) }),
        h(Button, { id: 'loading', loading: true, children: '加载中' }),
      ),
    ),
  ) +
  (['small', 'medium', 'large'] as const)
    .map((size, index) => expected([12, 16, 20][index], renderToString(h(Spinner, { size }))))
    .join('')
const overrides = Object.entries(APP_ICON_SIZES)
  .map(([iconSize, pixels]) =>
    expected(
      pixels,
      renderToString(
        h(Button, {
          isIconOnly: true,
          iconSize: iconSize as keyof typeof APP_ICON_SIZES,
          size: 'toolbar',
          color: 'primary',
          title: iconSize,
          loading: true,
          children: h(Plus),
        }),
      ),
    ),
  )
  .join('')
const send = [ArrowUp, Square, Activity]
  .map((Icon) =>
    expected(
      20,
      renderToString(
        h(
          'div',
          { className: 'composer' },
          h(Button, {
            isIconOnly: true,
            iconSize: 'lg',
            size: 'composer',
            color: 'primary',
            title: '发送',
            className: 'send-button',
            children: h(Icon),
          }),
        ),
      ),
    ),
  )
  .join('')
const files = h(
  'div',
  null,
  h(FileTypeIcon, { path: 'example.ts' }),
  h(FolderTypeIcon, { path: 'src' }),
  ...Object.values(APP_ICON_SIZES).map((size) =>
    h(
      'div',
      { key: size, 'data-expected-icon-size': size },
      h(FileTypeIcon, { path: 'example.ts', size }),
      h(FolderTypeIcon, { path: 'src', size }),
    ),
  ),
)
// Synchronous SSR renders the actual Suspense fallback; allReady resolves the wrapper's lazy module.
const fallback = renderToString(files)
const stream = await renderToReadableStream(files)
await stream.allReady
const resolvedFiles = await new Response(stream).text()
assert.match(fallback, /lucide-file/)
assert.doesNotMatch(resolvedFiles, /lucide-file/)
const icon = renderToString(h(Plus, { size: APP_ICON_SIZE }))
const arrow = renderToString(
  h(ChevronRight, { className: 'popover-item-arrow', size: APP_ICON_SIZES.sm }),
)
const compound = expected(
  16,
  renderToString(
    h(Button, {
      children: [
        h(Plus, { key: 'leading' }),
        '菜单',
        h(ChevronRight, { key: 'trailing', id: 'compound-trailing' }),
      ],
    }),
  ),
)
const forward = expected(
  16,
  renderToString(
    h(Button, {
      isIconOnly: true,
      size: 'toolbar',
      color: 'ghost',
      title: '前进',
      children: h(ChevronRight),
    }),
  ),
)
const empty = renderToString(
  h(
    'div',
    { className: 'automation-empty-state' },
    h(CalendarClock, { size: APP_ICON_SIZES.lg }),
    h('h2', null, '暂无已安排任务'),
  ),
)
const nav = renderToString(
  h(SidebarRow, {
    className: 'sidebar-nav-link',
    layout: 'flex',
    leading: h(Plus, { size: APP_ICON_SIZE }),
    children: '主要导航',
  }),
)
const sidebarActions = [Pin, Archive]
  .map((Icon) =>
    expected(
      16,
      renderToString(
        h(Button, {
          isIconOnly: true,
          className: 'sidebar-session-action-button',
          iconSize: 'md',
          size: 'compact',
          color: 'ghostSecondary',
          title: '行尾操作',
          children: h(Icon, { size: APP_ICON_SIZE }),
        }),
      ),
    ),
  )
  .join('')
const sidebarStatus = renderToString(h(Clock3, { size: APP_ICON_SIZE }))
const logo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="green"/></svg>')}`
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await page.setContent(`<html data-reduce-motion="on"><head><style>${css}</style></head><body>
    <section id="buttons">${buttons}${states}${overrides}${send}${compound}${forward}</section>
    <div style="position:relative;height:32px;width:280px"><aside class="desktop-sidebar" style="--sidebar-current-width:280px">${expected(16, `<span class="sidebar-indicator">${sidebarStatus}</span>`)}${expected(16, nav)}${sidebarActions}${expected(20, renderToString(h(Button, { isIconOnly: true, iconSize: 'lg', size: 'toolbar', color: 'ghost', title: '显式尺寸', children: h(Plus) })))}</aside></div>
    <div class="popover-menu popover-menu--grid">
      ${['', 'rich'].map((kind) => `<div class="popover-item ${kind}"><span class="popover-item-leading"><span class="popover-item-icon" data-expected-icon-size="16">${icon}</span></span><span class="popover-item-label">菜单</span><span class="popover-item-trailing" data-expected-icon-size="12">${arrow}</span></div>`).join('')}
    </div>
    <div id="fallback" data-expected-icon-size="16">${fallback}</div><div id="resolved" data-expected-icon-size="16">${resolvedFiles}</div>
    ${expected(20, empty)}
    <div id="lazy"></div>
    <svg id="content-graphic" width="120" height="70" stroke-width="3"><rect width="120" height="70"/></svg>
    <aside class="desktop-sidebar" style="position:relative;width:64px;height:64px"><svg id="brand-graphic" width="64" height="64"><rect width="64" height="64"/></svg></aside>
    <span class="model-center-provider-identity-logo" id="provider-logo" style="display:inline-flex">${renderToString(h(Plus, { 'data-icon-kind': 'artwork', size: 14 }))}</span>
    <div id="artwork">${renderToString(h(PluginIcon, { name: 'plugin' }))}${renderToString(h(ProviderLogo))}</div>
  </body></html>`)
  const checkIcons = async () => {
    const dimensions = await page
      .locator('[data-expected-icon-size] svg, [data-expected-icon-size] .ui-spinner')
      .evaluateAll((elements) =>
        elements.map((element) => {
          const { width, height } = element.getBoundingClientRect()
          const expectedSize =
            element.id === 'compound-trailing'
              ? 12
              : Number(
                  element
                    .closest('[data-expected-icon-size]')
                    ?.getAttribute('data-expected-icon-size'),
                )
          return {
            name: `${element.parentElement?.outerHTML.slice(0, 120)} / ${element.tagName}`,
            width,
            height,
            expectedSize,
          }
        }),
      )
    assert.ok(dimensions.length > 20)
    for (const { name, width, height, expectedSize } of dimensions) {
      assert.equal(width, expectedSize, `${name}: width`)
      assert.equal(height, expectedSize, `${name}: height`)
    }
    const strokes = await page.locator('.lucide').evaluateAll((elements) =>
      elements.map((element) => ({
        artwork: element.getAttribute('data-icon-kind') === 'artwork',
        stroke: parseFloat(getComputedStyle(element).strokeWidth),
      })),
    )
    for (const { artwork, stroke } of strokes) {
      assert.equal(
        stroke,
        artwork ? 2 : APP_ICON_STROKE_WIDTH,
        'Lucide stroke: artwork retains its original weight',
      )
    }
    assert.equal(
      await page
        .locator('#content-graphic')
        .evaluate((element) => getComputedStyle(element).strokeWidth),
      '3px',
    )
    // 品牌/插件 Logo 使用独立槽位，不参与功能图标刻度。
    const logos = await page.locator('.plugin-logo__image:visible').evaluateAll((elements) =>
      elements.map((element) => {
        const { width, height } = element.getBoundingClientRect()
        const slot = element.parentElement!.getBoundingClientRect()
        return {
          name: element.parentElement?.parentElement?.outerHTML.slice(0, 120) ?? '',
          width,
          height,
          slotWidth: slot.width,
          slotHeight: slot.height,
        }
      }),
    )
    for (const { name, width, height, slotWidth, slotHeight } of logos) {
      assert.equal(width, slotWidth, `${name}: logo slot width`)
      assert.equal(height, slotHeight, `${name}: logo slot height`)
      assert.ok(width > 14 && height > 14, `${name}: logo retains its independent slot`)
    }
    for (const [size, height] of sizes) {
      assert.equal(
        await page
          .locator(`#button-${size}`)
          .evaluate((element) => element.getBoundingClientRect().height),
        height,
        `${size}: click target height`,
      )
    }
    assert.deepEqual(
      await page.locator('#content-graphic').evaluate((element) => {
        const { width, height } = element.getBoundingClientRect()
        return [width, height]
      }),
      [120, 70],
    )
    assert.deepEqual(
      await page.locator('#brand-graphic').evaluate((element) => {
        const { width, height } = element.getBoundingClientRect()
        return [width, height]
      }),
      [64, 64],
    )
    assert.deepEqual(
      await page.locator('#provider-logo').evaluate((element) => {
        const { width, height } = element.getBoundingClientRect()
        return [width, height]
      }),
      [14, 14],
    )
    for (const button of await page.locator('.send-button').all()) {
      assert.equal(await button.evaluate((element) => element.getBoundingClientRect().width), 28)
      assert.equal(await button.evaluate((element) => element.getBoundingClientRect().height), 28)
    }
  }
  await checkIcons()
  await page.locator('#button-default').hover()
  await checkIcons()
  await page.locator('#button-default').focus()
  assert.equal(
    await page.locator('#button-default').evaluate((element) => element.matches(':focus-visible')),
    true,
  )
  // Load the actual feature entries after initial paint, preserving their production cascade layers.

  await page.locator('#lazy').evaluate((element, source) => {
    element.innerHTML = `<span class="plugin-catalog-card__icon"><span class="plugin-logo plugin-logo--themed"><img alt="" class="plugin-logo__image plugin-logo__image--light" src="${source}"><img alt="" class="plugin-logo__image plugin-logo__image--dark" src="${source}"></span></span>`
  }, logo)
  for (const theme of ['', 'dark-theme']) {
    await page.locator('html').evaluate((element, theme) => {
      element.className = theme
    }, theme)
    await checkIcons()
    assert.equal(
      await page.locator('.plugin-logo__image--dark').isVisible(),
      theme === 'dark-theme',
    )
    assert.equal(
      await page
        .locator('.plugin-logo__image:visible')
        .evaluate((element) => getComputedStyle(element).objectFit),
      'contain',
    )
  }
  console.log(
    '12/16/20px icons and 1.6 Lucide stroke verified: button variants/overrides/loading, send states, sidebar navigation, menu leading/trailing, file fallback/lazy wrapper and empty state; artwork stroke, brand/content geometry and click target heights retained.',
  )
} finally {
  await browser.close()
}
