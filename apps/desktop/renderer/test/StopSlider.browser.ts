// Run: bun apps/desktop/renderer/test/StopSlider.browser.ts
import { strict as assert } from 'node:assert'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { compileEntryStyles } from './helpers/RendererStyles.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { StopSlider } from ${JSON.stringify(resolve(root, 'src/components/ui/StopSlider.tsx').replaceAll('\\', '/'))};
import { ModelRuntimeParametersContent } from ${JSON.stringify(resolve(root, 'src/features/session/composer/ModelRuntimeParametersPopover.tsx').replaceAll('\\', '/'))};

function Harness() {
  const [thinking, setThinking] = useState(1);
  const [context, setContext] = useState(128000);
  const [commits, setCommits] = useState([]);
  return <div style={{ width: 340, padding: 16, background: 'var(--cpx-sys-color-surface-panel)', color: 'var(--cpx-sys-color-fg-primary)' }}>
    <StopSlider
      labels={['关闭', '低', '高']}
      value={thinking}
      ariaLabel="独立档位滑块"
      ariaValueText={['关闭', '低', '高'][thinking]}
      onCommit={index => { setThinking(index); setCommits(list => [...list, 'thinking:' + index]); }}
    />
    <div style={{ height: 12 }} />
    <ModelRuntimeParametersContent
      physicalWindow={200000}
      maxContextTokens={context}
      onMaxContextTokensChange={tokens => { setContext(tokens); setCommits(list => [...list, 'context:' + tokens]); }}
      thinkingMode="high"
      thinkingOptions={[
        { value: 'disabled', label: '关闭' },
        { value: 'low', label: '低' },
        { value: 'high', label: '高' },
      ]}
      onThinkingChange={() => {}}
    />
    <output id="commits">{JSON.stringify(commits)}</output>
  </div>;
}
createRoot(document.getElementById('root')).render(<Harness />);
`
if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['stop-slider-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, root),
          }))
          builder.onResolve({ filter: /^react-dom\/client$/ }, (args) => ({
            path: Bun.resolveSync(args.path, root),
          }))
          builder.onResolve({ filter: /^stop-slider-harness$/ }, () => ({
            path: 'harness',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: source,
            loader: 'jsx',
            resolveDir: root,
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
const css =
  (await compileEntryStyles()) +
  (await readFile(resolve(root, 'src/components/ui/StopSlider.css'), 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 520 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('http://localhost/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><head><style>${css}</style></head><body><div id="root"></div></body></html>`,
    }),
  )
  await page.goto('http://localhost/')
  await page.addScriptTag({ content: script, type: 'module' })
  // 主题令牌声明在 :root 上，真实应用也设在 documentElement；设在内部 div 会取不到深色变量。
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((next) => {
      document.documentElement.dataset.theme = next
    }, theme)
    await page.waitForTimeout(200)
    await page.screenshot({
      path: resolve(root, `test-artifacts/stop-slider-${theme}.png`),
      fullPage: true,
    })
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await page.waitForTimeout(300)
  if (errors.length > 0 || (await page.locator('#root').innerHTML()).length === 0) {
    const body = await page.locator('#root').innerHTML()
    console.error('page errors:', errors)
    console.error('root html:', body.slice(0, 1200))
    process.exit(1)
  }

  const thinking = page.getByRole('slider', { name: '独立档位滑块', exact: true })
  await expect(thinking).toBeVisible()
  await expect(thinking).toHaveAttribute('aria-valuetext', '低')

  // 键盘：方向键提交一次，Home 回到首档。
  await thinking.focus()
  await page.keyboard.press('ArrowRight')
  await expect(thinking).toHaveAttribute('aria-valuetext', '高')
  await page.keyboard.press('Home')
  await expect(thinking).toHaveAttribute('aria-valuetext', '关闭')

  // 单击轨道尾部：只提交一次，不是拖动中的每帧。
  const contextSlider = page.getByRole('slider', { name: '最大上下文限制', exact: true })
  await expect(contextSlider).toHaveAttribute('aria-valuetext', '128K')
  // thumb 只有 28px 宽，必须取整条轨道的包围盒才能点到末档。
  const contextTrack = page
    .locator('.stop-slider-field')
    .filter({ has: page.getByRole('slider', { name: '最大上下文限制' }) })
  const box = await contextTrack.boundingBox()
  assert.ok(box)
  await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await expect(contextSlider).toHaveAttribute('aria-valuetext', '200K')

  // 档位圆点与轨道都要真的画出来。
  const stops = page.locator('.stop-slider-stop')
  assert.ok((await stops.count()) >= 3)
  const fillWidth = await page
    .locator('.stop-slider-fill')
    .nth(1)
    .evaluate((node) => {
      return getComputedStyle(node).width
    })
  assert.notEqual(fillWidth, '0px')
  const thumbBg = await page
    .locator('.stop-slider-thumb')
    .first()
    .evaluate((node) => getComputedStyle(node).backgroundColor)
  assert.notEqual(thumbBg, 'rgba(0, 0, 0, 0)')

  // 末档时滑块右缘与轨道右缘对齐、档位圆点落在滑块中心；否则填充会溢出或缩进。
  const geometry = await page.evaluate(() => {
    const slider = document.querySelectorAll('.stop-slider')[1]!
    const track = slider.querySelector('.stop-slider-track')!.getBoundingClientRect()
    const thumb = slider.querySelector('.stop-slider-thumb')!.getBoundingClientRect()
    const lastStop = slider.querySelectorAll('.stop-slider-stop')
    const lastDot = lastStop[lastStop.length - 1]!.getBoundingClientRect()
    return {
      trackRight: track.right,
      thumbRight: thumb.right,
      thumbCenter: thumb.left + thumb.width / 2,
      lastDotCenter: lastDot.left + lastDot.width / 2,
    }
  })
  assert.ok(
    Math.abs(geometry.trackRight - geometry.thumbRight) <= 1,
    `thumb should sit flush with track end: ${JSON.stringify(geometry)}`,
  )
  assert.ok(
    Math.abs(geometry.thumbCenter - geometry.lastDotCenter) <= 1,
    `thumb should center on the last stop: ${JSON.stringify(geometry)}`,
  )

  assert.deepEqual(errors, [])
  console.log('stop-slider browser checks passed')
} finally {
  await browser.close()
}
