// Run: bun apps/desktop/renderer/test/SidebarDragPerformance.browser.ts
import { strict as assert } from 'node:assert'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const modulePath = (name: string) => JSON.stringify(
  resolve(root, 'src/features/layout/sidebar', name).replaceAll('\\', '/'),
)
const harness = `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ContextMenu} from ${JSON.stringify(resolve(root, 'src/components/ui/floating/Menu.tsx').replaceAll('\\', '/'))};
import * as drag from ${modulePath('SidebarDragContext.tsx')};
import {SidebarReorderItem} from ${modulePath('SidebarReorderItem.tsx')};
import {SidebarViewportGateProvider} from ${modulePath('SidebarViewportGate.tsx')};
import {observeActiveSidebarSession} from ${modulePath('SidebarActiveSessionObserver.ts')};
const f = window.fixture = {bodyRenders: 0, rowRenders: 0, commits: []};
f.observeActiveSidebarSession = observeActiveSidebarSession;
const order = Array.from({length: 30}, (_, i) => 'session:' + i);
const list = {key: 'pinned', destination: {kind: 'pinned', index: 0}, order, onReorder() {}};
const select = key => ({keys: [key], sessionKeys: [key], projectKeys: []});
const commit = operation => f.commits.push(operation);
function Row({index}) {
  drag.useOptionalSidebarDrag();
  f.rowRenders++;
  return <button data-sidebar-drag-handle className="sidebar-session-button">Row {index}</button>;
}
function Body() {
  const [revision, setRevision] = useState(0);
  f.rerender = () => setRevision(value => value + 1);
  f.bodyRenders++;
  const state = drag.useSidebarDrag();
  return <>
    <output hidden>{revision}</output>
    <drag.SidebarDragFeedback select={select} commit={commit}/>
    <drag.SidebarDragOverlay model={state.isDragging ? {title: 'Row 0', icon: null, count: 1} : null}/>
    <drag.SidebarDropList list={list}>
      {order.map((key, index) => <ContextMenu.Root key={key}>
        <ContextMenu.Trigger asChild><SidebarReorderItem value={key} reducedMotion>
          <Row index={index}/>
        </SidebarReorderItem></ContextMenu.Trigger>
      </ContextMenu.Root>)}
    </drag.SidebarDropList>
  </>;
}
createRoot(document.getElementById('root')).render(<drag.SidebarDragProvider><Body/></drag.SidebarDragProvider>);
// 视口 gate 场景：滚动容器只露出前几行，其余行应在 IO 报告可见后才可拖动。
const gateFixture = window.gateFixture = {commits: []};
const gateOrder = Array.from({length: 40}, (_, i) => 'gsession:' + i);
const gateSelect = key => ({keys: [key], sessionKeys: [key], projectKeys: []});
function GateBody() {
  return <drag.SidebarDragProvider>
    <SidebarViewportGateProvider>
      <div id="gate-scroll" style={{height: 300, width: 300, overflowY: 'auto'}}>
        <drag.SidebarDragFeedback commit={operation => gateFixture.commits.push(operation)} select={gateSelect}/>
        <drag.SidebarDropList list={{key: 'gate', destination: {kind: 'pinned', index: 0}, order: gateOrder, onReorder() {}}}>
          {gateOrder.map((key, index) => <ContextMenu.Root key={key}>
            <ContextMenu.Trigger asChild><SidebarReorderItem value={key} reducedMotion data-gate-sort-item={key}>
              <button className="sidebar-session-button">Gate {index}</button>
            </SidebarReorderItem></ContextMenu.Trigger>
          </ContextMenu.Root>)}
        </drag.SidebarDropList>
      </div>
    </SidebarViewportGateProvider>
  </drag.SidebarDragProvider>;
}
createRoot(document.getElementById('gate-root')).render(<GateBody/>);
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['sidebar-drag-harness'], target: 'browser', format: 'iife',
    define: {'process.env.NODE_ENV': '"development"'},
    plugins: [{name: 'sidebar-drag-harness', setup(builder) {
      builder.onResolve({filter: /^react(?:-dom)?(?:\/.*)?$/}, args => ({
        path: Bun.resolveSync(args.path, root), namespace: 'file',
      }))
      builder.onResolve({filter: /^sidebar-drag-harness$/}, () => ({path: 'harness', namespace: 'fixture'}))
      builder.onLoad({filter: /^harness$/, namespace: 'fixture'}, () => ({
        contents: harness, loader: 'jsx', resolveDir: root,
      }))
    }}],
  })
  assert.ok(build.success, build.logs.map(String).join('\n'))
  const child = Bun.spawn(['node', '--experimental-strip-types', fileURLToPath(import.meta.url)], {
    stdin: new Blob([await build.outputs[0]!.text()]), stdout: 'inherit', stderr: 'inherit',
  })
  process.exit(await child.exited)
}

let script = ''
for await (const chunk of process.stdin) script += chunk.toString('utf8')
const browser = await chromium.launch({channel: 'chrome', headless: true})
try {
  const page = await browser.newPage({viewport: {width: 900, height: 800}})
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent(`<style>
    body {margin:0} #root {width:300px} button {height:32px;width:300px;display:block}
    .sidebar-drag-overlay {pointer-events:none;width:fit-content;background:white}
    #gate-root {position:fixed;top:0;left:340px;z-index:10;background:white}
  </style><div id="root"></div><div id="gate-root"></div>`)
  await page.evaluate(() => {
    const target = window as any
    target.pointerBindings = 0
    const add = EventTarget.prototype.addEventListener
    EventTarget.prototype.addEventListener = function (...args) {
      if (args[0] === 'pointerdown') target.pointerBindings++
      return add.apply(this, args as Parameters<typeof add>)
    }
  })
  await page.addScriptTag({content: script})
  await page.locator('button').first().waitFor()
  await page.mouse.move(100, 16)
  await page.mouse.down()
  await page.mouse.move(115, 16, {steps: 3})
  await page.locator('[data-dragging="true"]').waitFor()
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const session = await page.context().newCDPSession(page)
  await session.send('Performance.enable')
  const before = await session.send('Performance.getMetrics')
  await page.evaluate(() => {
    const f = (window as any).fixture
    f.bodyRenders = 0
    f.rowRenders = 0
  })
  for (let i = 0; i < 40; i++) await page.mouse.move(120 + i % 20, 16)
  for (let i = 1; i < 10; i++) await page.mouse.move(130, i * 32 + 24, {steps: 3})
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const after = await session.send('Performance.getMetrics')
  const counts = await page.evaluate(() => {
    const f = (window as any).fixture
    return {bodyRenders: f.bodyRenders, rowRenders: f.rowRenders}
  })
  const metric = (metrics: typeof after, name: string) => metrics.metrics.find(item => item.name === name)?.value ?? 0
  console.log(JSON.stringify({...counts,
    scriptMs: (metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) * 1000,
    layoutMs: (metric(after, 'LayoutDuration') - metric(before, 'LayoutDuration')) * 1000,
  }))
  assert.equal(counts.bodyRenders, 0, 'Pointer movement must not rerender the sidebar body')
  assert.equal(counts.rowRenders, 0, 'Pointer movement must not broadcast context updates to every row')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await page.locator('[data-dragging="true"]').waitFor({state: 'detached'})
  assert.deepEqual(await page.evaluate(() => (window as any).fixture.commits), [])
  const sourceBox = await page.locator('[data-sidebar-sort-item="session:0"] button').boundingBox()
  const targetBox = await page.locator('[data-sidebar-sort-item="session:1"] button').boundingBox()
  assert.ok(sourceBox && targetBox)
  await page.mouse.move(sourceBox.x + 100, sourceBox.y + 16)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + 115, sourceBox.y + 16, {steps: 3})
  await page.locator('[data-dragging="true"]').waitFor()
  await page.mouse.move(targetBox.x + 130, targetBox.y + 24, {steps: 5})
  await page.locator('.sidebar-drop-indicator').waitFor({state: 'attached'})
  await page.mouse.up()
  await page.waitForFunction(() => (window as any).fixture.commits.length === 1)
  const operation = await page.evaluate(() => (window as any).fixture.commits[0])
  assert.equal(operation.kind, 'reorder')
  assert.deepEqual(operation.order.slice(0, 3), ['session:1', 'session:0', 'session:2'])
  await page.evaluate(() => {
    (window as any).pointerBindings = 0
    ;(window as any).fixture.rerender()
  })
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  const bindings = await page.evaluate(() => (window as any).pointerBindings)
  console.log(JSON.stringify({pointerBindingsOnRerender: bindings}))
  assert.equal(bindings, 0, 'Stable context-menu refs must not detach and rebind every drag handle')
  const reveal = await page.evaluate(async () => {
    const viewport = document.createElement('div')
    const row = document.createElement('button')
    row.dataset.sidebarSessionId = 'observer-fixture'
    viewport.append(row)
    document.body.append(viewport)
    const programmatic = {current: true}
    const suppressed = {current: null}
    let scrolls = 0
    row.scrollIntoView = () => { scrolls++ }
    const stop = (window as any).fixture.observeActiveSidebarSession({
      activeSessionId: 'observer-fixture', programmaticScrollRef: programmatic,
      suppressedActiveIdRef: suppressed, viewport,
    })
    row.addEventListener('pointerdown', event => event.stopPropagation())
    row.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true}))
    viewport.append(document.createElement('span'))
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    stop()
    viewport.remove()
    return {scrolls, suppressed: suppressed.current}
  })
  assert.deepEqual(reveal, {scrolls: 0, suppressed: 'observer-fixture'})
  // 视口 gate 契约：带 provider 时初始可见行可拖动并按位置提交；
  // 被滚动容器裁剪的行在滚入视口后恢复参与拖放并可激活拖动。
  // dnd-kit 在 drop 后的短暂窗口内不激活新 pointerdown（自愈），助手失败时复位重试。
  const gateDrag = async (source: any, targetBox: any, targetY: number, commitCount: number) => {
    const sourceBox = await source.boundingBox()
    assert.ok(sourceBox)
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.mouse.move(sourceBox.x + 130, sourceBox.y + 16)
      await page.mouse.down()
      await page.mouse.move(sourceBox.x + 145, sourceBox.y + 16, {steps: 3})
      const activated = await page.locator('#gate-root [data-dragging="true"]').first()
        .waitFor({ state: 'attached', timeout: 3000 }).then(() => true).catch(() => false)
      if (activated) {
        // 下半区 = 插到目标之后；上半区 = 插到目标之前，两者都必须产生真实变更。
        await page.mouse.move(targetBox.x + 130, targetBox.y + targetY, {steps: 5})
        // 插入线出现 = 落点解析为条目而非容器追加。
        const anchored = await page.locator('.sidebar-drop-indicator').first()
          .waitFor({ state: 'attached', timeout: 3000 }).then(() => true).catch(() => false)
        if (anchored) {
          await page.mouse.up()
          const committed = await page.waitForFunction(
            (count) => (window as any).gateFixture.commits.length >= count,
            commitCount, {timeout: 3000},
          ).then(() => true).catch(() => false)
          if (committed) return
        }
      }
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await page.evaluate(() => new Promise<void>(r => setTimeout(r, 400)))
    }
    throw new Error('gate drag did not commit')
  }
  await page.locator('[data-gate-sort-item="gsession:0"] button').waitFor()
  const gateTargetBox = await page.locator('[data-gate-sort-item="gsession:1"]').boundingBox()
  assert.ok(gateTargetBox)
  await gateDrag(page.locator('[data-gate-sort-item="gsession:0"]'), gateTargetBox, 24, 1)
  // 滚动使原裁剪行进入视口：激活拖动后取消，不依赖滚动后的位置提交（既有 dnd-kit 怪癖）。
  await page.evaluate(() => new Promise<void>(r => setTimeout(r, 600)))
  await page.locator('#gate-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await page.evaluate(() => new Promise<void>(r => setTimeout(r, 600)))
  const gateLastBox = await page.locator('[data-gate-sort-item="gsession:39"]').boundingBox()
  assert.ok(gateLastBox)
  await page.mouse.move(gateLastBox.x + 130, gateLastBox.y + 16)
  await page.mouse.down()
  await page.mouse.move(gateLastBox.x + 145, gateLastBox.y + 16, {steps: 3})
  await page.locator('#gate-root [data-dragging="true"]').first()
    .waitFor({ state: 'attached', timeout: 5000 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
