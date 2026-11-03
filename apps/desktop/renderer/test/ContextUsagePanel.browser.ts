// First: bun run build:renderer
// Run: bun apps/desktop/renderer/test/ContextUsagePanel.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const panelPath = JSON.stringify(
  resolve(rendererRoot, 'src/features/session/composer/ContextUsagePanel.tsx').replaceAll(
    '\\',
    '/',
  ),
)
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextUsagePanel } from ${panelPath};
function Harness() {
  const [view, setView] = useState('bar');
  window.setView = setView;
  const [rate, setRate] = useState(undefined);
  const [usedPercent, setUsedPercent] = useState(14);
  const [limitTokens, setLimitTokens] = useState(undefined);
  window.setLimitTokens = setLimitTokens;
  const [frozen, setFrozen] = useState(false);
  window.setFrozen = setFrozen;
  const [triggerTokens, setTriggerTokens] = useState(160000);
  window.setTriggerTokens = setTriggerTokens;
  window.setRate = setRate;
  window.setUsedPercent = setUsedPercent;
  return <ContextUsagePanel view={view} maxContextTokens={limitTokens} modelContextWindow={1000000} contextUsage={{ usedTokens: usedPercent * 10000, contextWindow: 200000, usedPercent,
    budgetFrozen: frozen, budget: { inputBudgetTokens: 200000, triggerTokens, contextWindowTokens: 1000000, source: 'measured' },
    promptCacheReadTokens: 12000, promptCacheWriteTokens: 300, promptUncachedTokens: 200,
    averageCacheHitRate: rate, breakdown: [{source: 'messages', chars: 999}, {source: 'memory', chars: 1}] }} />;
}
createRoot(document.getElementById('root')).render(<Harness />);
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['context-meter-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'context-meter-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^context-meter-harness$/ }, () => ({
            path: 'harness',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'fixture' }, () => ({
            contents: harness,
            loader: 'jsx',
            resolveDir: rendererRoot,
          }))
        },
      },
    ],
  })
  assert.ok(build.success, build.logs.map(String).join('\n'))
  const child = Bun.spawn(['node', '--experimental-strip-types', fileURLToPath(import.meta.url)], {
    stdin: new Blob([await build.outputs[0]!.text()]),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exit(await child.exited)
}

let script = ''
for await (const chunk of process.stdin) script += chunk.toString('utf8')

const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setContent(
    '<div class="popover-surface" data-popover-size="auto" style="padding:14px"><div id="root"></div></div>',
  )
  // 使用真实构建样式，覆盖浮层通用 role=group 规则与业务布局的层叠冲突。
  const assets = resolve(rendererRoot, '../../../dist/renderer/assets')
  const cssFiles = (await readdir(assets)).filter((name) => /^(index|App)-.*\.css$/.test(name))
  assert.ok(cssFiles.length > 0, '先运行 bun run build:renderer')
  for (const name of cssFiles)
    await page.addStyleTag({ content: await readFile(resolve(assets, name), 'utf8') })
  await page.addScriptTag({ content: script })

  const tab = (name: string) => page.getByRole('tab', { name, exact: true })
  const setView = async (view: 'bar' | 'field') => {
    await page.locator('[role="tab"][aria-selected="true"]').focus()
    await page.evaluate((next) => (window as any).setView(next), view)
    await page.locator(view === 'bar' ? '.context-meter-bar' : '.context-meter-field').waitFor()
  }
  await tab('上下文用量').waitFor()
  assert.equal(
    await page.locator('.context-meter-bar').evaluate((bar) => getComputedStyle(bar).flexDirection),
    'row',
  )
  assert.ok(
    await page.locator('.context-meter-segment').evaluateAll((segments) =>
      segments.every((segment) => {
        const rect = segment.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      }),
    ),
  )
  assert.equal(await page.getByRole('tablist', { name: '展示方式' }).count(), 0)
  await page.evaluate(() => {
    ;(window as any).setUsedPercent(2.81)
    ;(window as any).setLimitTokens(200000)
  })
  await page.getByText('/ 200K tokens', { exact: true }).waitFor()
  await page.waitForFunction(() => {
    const bar = document.querySelector('.context-meter-bar')!.getBoundingClientRect()
    const room = document
      .querySelector('.context-meter-bar [data-source="room"]')!
      .getBoundingClientRect()
    return (
      Math.abs((room.left - bar.left) / bar.width - (0.9 - ((160000 - 28100) / 160000) * 0.2)) <
      0.04
    )
  })
  await page.getByRole('button', { name: /^压缩前剩余/ }).focus()
  assert.match(await page.locator('[aria-live="polite"]').first().innerText(), /131.9K/)
  await page.getByRole('button', { name: '总窗口 1M tokens' }).focus()
  assert.match(await page.locator('[aria-live="polite"]').first().innerText(), /1M/)
  // 到真实阈值时紫色区域必须为零；总窗口参照始终保留。
  await page.evaluate(() => (window as any).setUsedPercent(16))
  await page.waitForFunction(
    () => !document.querySelector('.context-meter-bar [data-source="room"]'),
  )
  assert.equal(await page.locator('[data-source="window"]').count(), 1)
  await setView('field')
  assert.equal(await page.locator('[data-owner="room"]').count(), 0)
  assert.equal(await page.locator('[data-owner="window"]').count(), 20)
  await page.evaluate(() => (window as any).setUsedPercent(2.81))
  await page.waitForFunction(() => document.querySelectorAll('[data-owner="room"]').length > 0)
  const before = await page.locator('[data-owner="room"]').count()
  await page.evaluate(() => (window as any).setTriggerTokens(320000))
  await page.waitForFunction(
    (before) => document.querySelectorAll('[data-owner="room"]').length > before,
    before,
  )
  await page.evaluate(() => {
    ;(window as any).setUsedPercent(14)
    ;(window as any).setLimitTokens(undefined)
    ;(window as any).setTriggerTokens(160000)
  })
  await setView('bar')
  const tabs = await page.getByRole('tablist').evaluateAll((lists) =>
    lists.map((list) => ({
      y: list.getBoundingClientRect().y,
      x: list.getBoundingClientRect().x,
      width: list.clientWidth,
      scroll: list.scrollWidth,
    })),
  )
  assert.equal(tabs.length, 1)
  assert.ok(
    tabs.every((list) => list.scroll <= list.width),
    `两组控件应同排完整显示: ${JSON.stringify(tabs)}`,
  )
  await page
    .getByRole('group', { name: '已用上下文分类构成' })
    .locator('[data-source="room"]')
    .hover()
  assert.match(await page.locator('[aria-live="polite"]').first().innerText(), /20K/)
  assert.equal(await page.getByText('压缩前剩余', { exact: true }).count(), 2)
  assert.equal(await page.locator('details').count(), 0)
  const geometry = await page.locator('.context-meter-bar').evaluate((bar) => {
    const blocks = [...bar.querySelectorAll('.context-meter-segment')].map((element) =>
      element.getBoundingClientRect(),
    )
    return {
      direction: getComputedStyle(bar).flexDirection,
      width: bar.getBoundingClientRect().width,
      styles: [...bar.children].map((el) => ({
        basis: getComputedStyle(el).flexBasis,
        min: getComputedStyle(el).minWidth,
        grow: getComputedStyle(el).flexGrow,
        padding: getComputedStyle(el).padding,
      })),
      blocks: blocks.map((rect) => ({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      })),
    }
  })
  assert.equal(geometry.direction, 'row')
  assert.ok(
    Math.abs(geometry.blocks[2]!.width / geometry.width - 0.025) < 0.02,
    JSON.stringify(geometry),
  )
  assert.equal(geometry.blocks[0]!.y, geometry.blocks[1]!.y)
  assert.ok(
    Math.abs(geometry.blocks[1]!.x - geometry.blocks[0]!.x - geometry.blocks[0]!.width) <= 4,
  )
  assert.ok(geometry.blocks.every((rect) => rect.height > 0))
  assert.equal(await page.getByText('未缓存', { exact: true }).count(), 0)
  assert.equal(await page.getByRole('tab', { name: '预算详情' }).count(), 0)
  await setView('field')
  assert.equal(await page.locator('.context-meter-limit').count(), 0)
  assert.equal(await page.locator('.context-meter-dot').count(), 200)
  assert.equal(await page.locator('[data-owner="room"]').count(), 5)
  await page.getByRole('button', { name: '记忆 0.1%' }).focus()
  assert.match(await page.locator('[role="tabpanel"]').first().textContent(), /1 字符/)
  await setView('bar')
  const bounds = await page.locator('.context-usage-panel').evaluate((panel) => ({
    height: panel.getBoundingClientRect().height,
    overflowY: getComputedStyle(panel).overflowY,
  }))
  assert.ok(bounds.height <= 392)
  assert.equal(bounds.overflowY, 'auto')
  await tab('平均缓存命中率').click()
  assert.equal(await page.locator('.context-meter-limit').count(), 0)
  assert.equal(await page.getByText('暂无缓存命中数据').count(), 1)
  assert.equal(await page.getByText(/输入预算/).count(), 0)
  assert.equal(await page.getByText('未缓存', { exact: true }).count(), 1)
  assert.equal(await page.getByText('读', { exact: true }).count(), 1)
  assert.equal(await page.getByText('写', { exact: true }).count(), 1)
  await page.evaluate(() => (window as any).setRate(0))
  await page.getByRole('button', { name: '未命中 100.0%' }).waitFor()
  assert.equal(await page.getByText('暂无缓存命中数据').count(), 0)
  await setView('field')
  assert.equal(await page.locator('[data-owner="miss"]').count(), 200)
  await page.evaluate(() => (window as any).setRate(1))
  await page.waitForFunction(() => document.querySelectorAll('[data-owner="hit"]').length === 200)
  await tab('上下文用量').click()
  await page.evaluate(() => (window as any).setUsedPercent(100))
  await page.waitForFunction(() => document.querySelectorAll('[data-owner="room"]').length === 0)
  await page.evaluate(() => (window as any).setUsedPercent(0))
  await page.waitForFunction(() => document.querySelectorAll('[data-owner="room"]').length === 180)
  assert.deepEqual(errors, [])
  console.log(
    'Context meter: tabs, keyboard, classification, live updates, cache absent/0/100 passed',
  )
} finally {
  await browser.close()
}
