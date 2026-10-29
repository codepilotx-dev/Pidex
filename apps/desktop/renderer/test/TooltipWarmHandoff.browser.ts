// Run: bun apps/desktop/renderer/test/TooltipWarmHandoff.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tooltipPath = JSON.stringify(
  resolve(rendererRoot, 'src/components/ui/Tooltip.tsx').replaceAll('\\', '/'),
)
const segmentedPath = JSON.stringify(
  resolve(rendererRoot, 'src/features/session/composer/ContextUsagePanel.tsx').replaceAll(
    '\\',
    '/',
  ),
)

const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent } from ${tooltipPath};
import { ContextUsageStatusPanel } from ${segmentedPath};

function Pair({ order }) {
  const [openA, setOpenA] = useState(false);
  const [openB, setOpenB] = useState(false);
  window.setPair = (nextA, nextB) => flushSync(() => { setOpenA(nextA); setOpenB(nextB); });
  const render = (id, open, setOpen, label) => (
    <TooltipRoot open={open} onOpenChange={setOpen} delayDuration={120}>
      <TooltipTrigger><button id={id}>{label}</button></TooltipTrigger>
      <TooltipPortal><TooltipContent>{label} content</TooltipContent></TooltipPortal>
    </TooltipRoot>
  );
  const a = render('trigger-a', openA, setOpenA, 'A');
  const b = render('trigger-b', openB, setOpenB, 'B');
  return <div>{order === 'ab' ? <>{a}{b}</> : <>{b}{a}</>}</div>;
}

function WarmSequence() {
  const [openA, setOpenA] = useState(false);
  const [openB, setOpenB] = useState(false);
  window.setWarmPair = (nextA, nextB) => flushSync(() => { setOpenA(nextA); setOpenB(nextB); });
  return (
    <div>
      <TooltipRoot open={openA} onOpenChange={setOpenA} disableHoverableContent={true}>
        <TooltipTrigger><button id="warm-a">WA</button></TooltipTrigger>
        <TooltipPortal><TooltipContent>A body</TooltipContent></TooltipPortal>
      </TooltipRoot>
      <TooltipRoot open={openB} onOpenChange={setOpenB} disableHoverableContent={true}>
        <TooltipTrigger><button id="warm-b">WB</button></TooltipTrigger>
        <TooltipPortal><TooltipContent>B body</TooltipContent></TooltipPortal>
      </TooltipRoot>
    </div>
  );
}

const usage = {
  usedTokens: 4000,
  contextWindow: 10000,
  usedPercent: 40,
  breakdown: [
    { source: 'messages', chars: 1200 },
    { source: 'system_prompt', chars: 400 },
  ],
  averageCacheHitRate: 0.5,
  promptCacheReadTokens: 100,
  promptCacheWriteTokens: 20,
  promptUncachedTokens: 30,
  reasoningTokens: 5,
};

function Segments() {
  return <ContextUsageStatusPanel contextUsage={usage} />;
}

const rootA = createRoot(document.getElementById('root-a'));
const rootB = createRoot(document.getElementById('root-b'));
const rootS = createRoot(document.getElementById('root-s'));
window.renderPair = (order) => flushSync(() => rootA.render(
  <TooltipProvider><Pair order={order} /></TooltipProvider>));
window.renderWarm = () => flushSync(() => rootB.render(<TooltipProvider><WarmSequence /></TooltipProvider>));
window.renderSegments = () => flushSync(() => rootS.render(<TooltipProvider><Segments /></TooltipProvider>));
window.unmountAll = () => flushSync(() => { rootA.render(null); rootB.render(null); rootS.render(null); });
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['tooltip-warm-harness'],
    target: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'tooltip-warm-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^tooltip-warm-harness$/ }, () => ({
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
    '<div id="root-a"></div><div id="root-b"></div><div id="root-s"></div>',
  )
  await page.addScriptTag({ content: script })

  // 风险 1：冷启动不被自身改写污染，打开期间父组件重渲染仍保持 cold。
  const cold = await page.evaluate(() => {
    const fixture = window
    fixture.renderPair('ab')
    fixture.setPair(true, false)
    const first = document.querySelector('#trigger-a + * [role="tooltip"], [role="tooltip"]')
    const warmOnOpen = first?.getAttribute('data-warm-handoff') ?? null
    // 打开期间再次提交（父组件重渲染）不应把快照改成 warm。
    fixture.setPair(true, false)
    const afterRerender =
      document.querySelector('[role="tooltip"]')?.getAttribute('data-warm-handoff') ?? null
    return { warmOnOpen, afterRerender, count: document.querySelectorAll('[role="tooltip"]').length }
  })
  assert.deepEqual(cold, { warmOnOpen: null, afterRerender: null, count: 1 })

  // 风险 2a：正常关闭时退场期间 DOM 仍驻留。
  const exitResident = await page.evaluate(async () => {
    const fixture = window
    fixture.setPair(false, false)
    const immediate = document.querySelectorAll('[role="tooltip"]').length
    await new Promise((done) => setTimeout(done, 400))
    return { immediate, settled: document.querySelectorAll('[role="tooltip"]').length }
  })
  assert.deepEqual(exitResident, { immediate: 1, settled: 0 })

  // 风险 2b：退场动画中途被新浮层抢占时，旧 DOM 必须同步卸载而不是继续退场。
  const midExit = await page.evaluate(() => {
    const fixture = window
    fixture.unmountAll()
    fixture.renderPair('ab')
    fixture.setPair(true, false)
    fixture.setPair(false, false)
    // 关闭后立即在同一帧抢占：旧浮层还处在退场中。
    fixture.setPair(false, true)
    const nodes = [...document.querySelectorAll('[role="tooltip"]')]
    return {
      count: nodes.length,
      text: nodes[0]?.textContent ?? '',
      warm: nodes[0]?.getAttribute('data-warm-handoff') ?? null,
    }
  })
  assert.deepEqual(midExit, { count: 1, text: 'B content', warm: 'true' })

  // 风险 2b：同一批提交抢占（A 在 B 之前 / B 在 A 之前两种树顺序）都只剩一个新浮层。
  for (const order of ['ab', 'ba']) {
    const preempted = await page.evaluate((treeOrder) => {
      const fixture = window
      fixture.unmountAll()
      fixture.renderPair(treeOrder)
      fixture.setPair(true, false)
      fixture.setPair(false, true)
      const nodes = [...document.querySelectorAll('[role="tooltip"]')]
      return {
        count: nodes.length,
        warm: nodes[0]?.getAttribute('data-warm-handoff') ?? null,
        text: nodes[0]?.textContent ?? '',
      }
    }, order)
    assert.equal(preempted.count, 1, `${order}: 同提交抢占后只能剩一个 tooltip`)
    assert.equal(preempted.text, 'B content')
    assert.equal(preempted.warm, 'true')
  }

  // 风险 2c：预热关闭（A 打开 -> B 打开 -> A 关闭）后只剩 B 且 B 保持可见。
  const handoff = await page.evaluate(() => {
    const fixture = window
    fixture.unmountAll()
    fixture.renderWarm()
    fixture.setWarmPair(true, false)
    fixture.setWarmPair(false, true)
    const nodes = [...document.querySelectorAll('[role="tooltip"]')]
    return {
      count: nodes.length,
      opacity: nodes[0] ? getComputedStyle(nodes[0]).opacity : null,
      warm: nodes[0]?.getAttribute('data-warm-handoff') ?? null,
    }
  })
  assert.deepEqual(handoff, { count: 1, opacity: '1', warm: 'true' })

  // 风险 3：分段即时高亮与受控浮层分离，且旧分段的关闭回调不清空新分段。
  const segments = await page.evaluate(async () => {
    const fixture = window
    fixture.unmountAll()
    fixture.renderSegments()
    const buttons = [...document.querySelectorAll('[data-usage-bar-source]')]
    const first = buttons[0]
    const second = buttons[1]
    if (!first || !second) return { missing: true }
    // React 的 onMouseEnter/onMouseLeave 由 mouseover/mouseout 委托合成。
    const enter = (el) =>
      el.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true, cancelable: true, relatedTarget: document.body }),
      )
    const leave = (el) =>
      el.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, cancelable: true, relatedTarget: document.body }),
      )
    const frame = () => new Promise((done) => requestAnimationFrame(() => done(null)))
    enter(first)
    await frame()
    const immediate = {
      active: first.getAttribute('data-active'),
      dimmed: getComputedStyle(second).opacity,
      tooltips: document.querySelectorAll('[role="tooltip"]').length,
    }
    await new Promise((done) => setTimeout(done, 260))
    const afterDelay = document.querySelectorAll('[role="tooltip"]').length
    enter(second)
    await frame()
    const switched = {
      secondActive: second.getAttribute('data-active'),
      firstActive: first.getAttribute('data-active'),
      tooltipText: document.querySelector('[role="tooltip"]')?.textContent ?? '',
    }
    leave(second)
    await frame()
    const cleared = buttons.map((b) => b.getAttribute('data-active'))
    return { immediate, afterDelay, switched, cleared }
  })
  assert.equal(segments.immediate?.active, 'true')
  assert.equal(segments.immediate?.dimmed, '0.3')
  assert.equal(segments.immediate?.tooltips, 0)
  assert.equal(segments.afterDelay, 1)
  assert.equal(segments.switched?.secondActive, 'true')
  assert.equal(segments.switched?.firstActive, 'false')
  assert.match(segments.switched?.tooltipText ?? '', /系统提示词/)
  assert.ok(
    (segments.cleared ?? []).every((value) => value === 'false'),
    '离开后所有分段都应恢复非激活',
  )

  assert.deepEqual(errors, [])
  console.log('Tooltip warm handoff: cold snapshot, sync preemption, segment highlight split passed')
} finally {
  await browser.close()
}