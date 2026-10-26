// Bundle with Bun (--target=node), then run with Node, like IconSize.browser.ts.
import { strict as assert } from 'node:assert'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { Palette, Plus, X } from 'lucide-react'
import { Button } from '../src/components/ui/Button.js'
import { Select } from '../src/components/ui/Select.js'
import { SearchInput } from '../src/components/ui/SearchInput.js'
import { Checkbox } from '../src/components/ui/Checkbox.js'
import { RadioGroup, RadioItem } from '../src/components/ui/RadioGroup.js'
import { ToggleSwitch } from '../src/components/ui/ToggleSwitch.js'
import { PopoverItem } from '../src/components/ui/PopoverItem.js'
import { Dropdown } from '../src/components/ui/floating/Dropdown.js'
import { SidebarRow } from '../src/features/layout/sidebar/SidebarRow.js'
import { compileEntryStyles, rendererRoot } from './helpers/RendererStyles.js'

const noop = () => {}
const examples = renderToString(
  h(
    'div',
    { className: 'examples' },
    h(SidebarRow, {
      asChild: true,
      layout: 'flex',
      leading: h(Palette, { className: 'settings-nav-icon' }),
      children: h(
        'button',
        { type: 'button', className: 'settings-nav-item tw:type-row-title' },
        '外观',
      ),
    }),
    h(Button, { leftIcon: h(Plus), children: '新建对话' }),
    h(Button, { leftIcon: h(Plus), children: 'New chat' }),
    ...['guardian-lab', '工作组', 'master'].map((label) =>
      h(Button, { leftIcon: h(Plus), children: label }),
    ),
    h(SearchInput, {
      value: '',
      placeholder: '搜索设置',
      'aria-label': '搜索设置',
      onChange: noop,
    }),
    h(SearchInput, {
      value: '',
      placeholder: 'Search settings',
      'aria-label': 'Search settings',
      onChange: noop,
    }),
    h(Button, { loading: true, children: '正在加载' }),
    h(Select, {
      value: 'one',
      ariaLabel: '选择模型',
      options: [{ value: 'one', label: '模型' }],
      onValueChange: noop,
    }),
    h(Dropdown.Root, {
      mode: 'menu',
      children: h(PopoverItem, { icon: h(Plus), withArrow: true, children: '菜单操作' }),
    }),
    h(
      'div',
      { className: 'nested' },
      h('button', { className: 'entity', type: 'button' }, '附件名称.ts'),
      h(Button, {
        className: 'close',
        isIconOnly: true,
        size: 'iconSm',
        'aria-label': '移除附件',
        children: h(X),
      }),
    ),
    h(Checkbox, { checked: false, ariaLabel: '启用功能', onCheckedChange: noop }),
    h(RadioGroup, {
      value: 'one',
      onValueChange: noop,
      children: h(RadioItem, { value: 'one', label: '选项' }),
    }),
    h(ToggleSwitch, { checked: false, ariaLabel: '开关', onChange: noop }),
    h(Button, { isIconOnly: true, size: 'iconMd', 'aria-label': '独立图标', children: h(Plus) }),
    h(
      'span',
      {
        role: 'button',
        'aria-label': '上下文窗口使用量',
        className:
          'context-usage-chip tw:group tw:relative tw:inline-flex tw:size-3 tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center tw:text-app-text-soft',
      },
      h(
        'svg',
        { className: 'chip-dot tw:size-3', viewBox: '0 0 12 12' },
        h('circle', { className: 'chip-dot-track', cx: 6, cy: 6, r: 5 }),
      ),
    ),
    h(
      'div',
      {
        className: 'sidebar-fixture desktop-sidebar tw:relative tw:flex tw:w-60 tw:flex-col',
      },
      h('div', { className: 'sidebar-resizer', 'aria-hidden': 'true' }),
    ),
  ),
)

const latinFont = (
  await readFile(resolve(rendererRoot, 'public/fonts/misans/MiSans-Regular.latin.woff2'))
).toString('base64')
const css =
  (await compileEntryStyles()) +
  `@font-face{font-family:MiSans;font-weight:100 900;src:url(data:font/woff2;base64,${latinFont}) format('woff2')}`
const html = `<!doctype html><html lang="zh-CN" data-reduce-motion="on"><meta charset="utf-8"><title>Pidex 图标与点击热区对照</title>
<style>${css}</style><style>
body{overflow:auto;padding:24px}main{display:grid;grid-template-columns:1fr 1fr;gap:32px}
.examples{display:flex;flex-direction:column;align-items:start;gap:16px}.examples>.sidebar-row{width:240px}
.nested{display:flex;gap:4px;align-items:center}.entity{padding:4px 12px}.close{flex:none}
.before :is(.settings-nav-icon,.ui-button:not([data-icon-only]) .lucide,.ui-spinner,.popover-item-icon>svg,.popover-item-arrow,.ui-select-trigger>svg){width:16px;height:16px}.before .close{width:16px;height:16px;min-width:16px;min-height:16px}
</style><h1>Pidex 同行图标与热区</h1><p>A 模拟旧固定尺寸；B 使用当前真实组件。独立图标保持原尺寸。</p>
<label>字号 <select id="font"><option>11</option><option selected>14</option><option>16</option></select></label>
<label>字体 <select id="family"><option>MiSans</option><option>Arial</option></select></label>
<label>主题 <select id="theme"><option value="">浅色</option><option value="dark-theme">深色</option></select></label>
<label>界面语言 <select id="locale"><option value="zh-CN">中文</option><option value="en-US">English</option></select></label>
<main><section class="before"><h2>A · 固定尺寸对照</h2>${examples}</section><section class="after"><h2>B · 按界面语言统一尺寸</h2>${examples}</section></main>
<script>
function update(){let d=Number(document.getElementById('font').value)-14;let r=document.documentElement;
for(let [name,base] of Object.entries({xs:12,sm:13,md:14,lg:16,xl:18,'2xl':20,'3xl':24,'4xl':28}))r.style.setProperty('--cpx-sys-font-size-'+name,(base+d)+'px');
r.style.setProperty('--cpx-sys-font-family-sans',document.getElementById('family').value);r.className=document.getElementById('theme').value;r.lang=document.getElementById('locale').value}
document.querySelectorAll('select').forEach(e=>e.addEventListener('change',update));update();
</script></html>`
const output = resolve(rendererRoot, 'test-results/interaction-comparison.html')
await mkdir(resolve(rendererRoot, 'test-results'), { recursive: true })
await writeFile(output, html, 'utf8')

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  await page.setContent(html)
  await page.evaluate(() => document.fonts.ready)
  assert.ok(await page.evaluate(() => document.fonts.check('14px MiSans')))
  for (const family of ['MiSans', 'Arial']) {
    for (const font of ['11', '14', '16']) {
      await page.locator('#family').selectOption(family)
      await page.locator('#font').selectOption(font)
      await page.waitForFunction(
        (font) =>
          getComputedStyle(document.querySelector('.after .settings-nav-icon')!).fontSize ===
          `${font}px`,
        font,
      )
      for (const theme of ['', 'dark-theme']) {
        await page.locator('#theme').selectOption(theme)
        for (const locale of ['zh-CN', 'en-US']) {
          await page.locator('#locale').selectOption(locale)
          await page.waitForFunction(
            () => document.querySelector('.after .settings-nav-icon')!.getAnimations().length === 0,
          )
          const icons = await page
            .locator(
              '.after .settings-nav-icon, .after .search-input-icon, .after .ui-button:not([data-icon-only]) .lucide, .after .ui-button-spinner, .after .popover-item-icon > svg, .after .popover-item-arrow, .after .ui-select-trigger svg',
            )
            .evaluateAll((elements) =>
              elements.map((element) => {
                const probe = document.createElement('span')
                const english = document.documentElement.lang === 'en-US'
                probe.style.cssText = `display:inline-block;width:${english ? '1cap' : '1em'};height:1em`
                probe.style.font = getComputedStyle(element).font
                document.body.append(probe)
                const em = probe.getBoundingClientRect().width
                probe.remove()
                return {
                  name: element.outerHTML.slice(0, 300),
                  locale: document.documentElement.lang,
                  size: parseFloat(getComputedStyle(element).width),
                  em,
                }
              }),
            )
          assert.ok(icons.length >= 6)
          for (const icon of icons)
            assert.ok(
              Math.abs(icon.size - icon.em) < 0.1,
              `${family}/${font}: ${JSON.stringify(icon)}`,
            )
          const targets = await page.locator('.after button').evaluateAll((elements) =>
            elements.map((element) => {
              const { width, height } = element.getBoundingClientRect()
              return { name: element.outerHTML.slice(0, 100), width, height }
            }),
          )
          for (const target of targets)
            assert.ok(target.width >= 24 && target.height >= 24, JSON.stringify(target))
          assert.equal(
            await page
              .locator('.after button[aria-label="独立图标"] svg')
              .evaluate((e) => e.getBoundingClientRect().width),
            12,
          )
          assert.equal(
            await page
              .locator('.after .context-usage-chip')
              .evaluate((e) => e.getBoundingClientRect().width),
            24,
          )
          assert.equal(
            await page
              .locator('.after .context-usage-chip svg')
              .evaluate((e) => e.getBoundingClientRect().width),
            12,
          )
          assert.equal(
            await page
              .locator('.after .sidebar-fixture')
              .evaluate((e) => getComputedStyle(e).paddingRight),
            '0px',
          )
          assert.equal(
            await page
              .locator('.after .sidebar-fixture .sidebar-resizer')
              .evaluate((e) => e.getBoundingClientRect().width),
            24,
          )
          const entity = await page.locator('.after .entity').boundingBox()
          const close = await page.locator('.after .close').boundingBox()
          assert.ok(entity && close && entity.x + entity.width <= close.x)
        }
      }
    }
  }
  const english = page.getByRole('button', { name: 'New chat', exact: true }).last()
  const beforeLabelChange = await english
    .locator('svg')
    .evaluate((e) => e.getBoundingClientRect().width)
  await english.evaluate((element) => {
    element.lastChild!.textContent = '托管 Worktrees'
  })
  assert.equal(
    await page
      .getByRole('button', { name: '托管 Worktrees', exact: true })
      .last()
      .locator('svg')
      .evaluate((e) => e.getBoundingClientRect().width),
    beforeLabelChange,
  )
  const search = page.locator('.after input[placeholder="Search settings"]')
  const beforePlaceholderChange = await search
    .locator('..')
    .locator('svg')
    .evaluate((e) => e.getBoundingClientRect().width)
  await search.evaluate((element) => {
    element.setAttribute('placeholder', '搜索设置 Search')
  })
  assert.equal(
    await page
      .locator('.after input[placeholder="搜索设置 Search"]')
      .locator('..')
      .locator('svg')
      .evaluate((e) => e.getBoundingClientRect().width),
    beforePlaceholderChange,
  )
  const result = await new AxeBuilder({ page })
    .include('.after')
    .withRules(['target-size'])
    .analyze()
  assert.equal(result.violations.length, 0, JSON.stringify(result.violations))
  assert.ok(result.passes.some((rule) => rule.id === 'target-size'))
  assert.equal(result.incomplete.length, 0, JSON.stringify(result.incomplete))
  console.log(`Interaction geometry passed; comparison: ${output}`)
} finally {
  await browser.close()
}
