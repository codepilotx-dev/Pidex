// Run: bun apps/desktop/renderer/test/ModelSwitchDivider.browser.ts
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { compileEntryStyles } from './helpers/RendererStyles.js'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))
const harness = `
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CanonicalThreadView } from ${source('features/session/timeline/CanonicalThreadView.tsx')};
import { CanonicalItemRenderer } from ${source('features/session/timeline/CanonicalItemRenderer.tsx')};
import { ModelSwitchDivider } from ${source('features/session/timeline/ModelSwitchDivider.tsx')};
import { ConversationItemContext } from ${source('features/session/timeline/ConversationItemContext.ts')};
import { TooltipProvider } from ${source('components/ui/Tooltip.tsx')};
import { deriveThemeVariables } from ${source('features/theme/ThemeVariables.ts')};
import { DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME } from ${source('../shared/Theme.ts')};
const a = { providerID: 'minimax', id: 'MiniMax-M3' };
const b = { providerID: 'deepseek', id: 'deepseek-v4-pro' };
const permissionConfig = { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' };
const noop = () => {};
const context = { modelProviderNames: { minimax: 'MiniMax', deepseek: 'DeepSeek' }, canCopyFileReferenceContents: () => false,
  onCopyFileReferenceContents: noop, onOpenFileReference: noop, onSubmitEditedUserMessage: async () => {}, sessionStatus: 'idle', workspacePath: null };
function entry(index, model) {
  const id = 'turn-' + index;
  const input = { id: 'input-' + index, threadId: 'main', turnId: id, content: '用户消息 ' + index, delivery: 'start', mode: 'chat', model, permissionConfig, state: 'completed', createdAt: index };
  return { id, turn: { id, threadId: 'main', sourceInputID: input.id, status: index === 3 ? 'failed' : 'completed', mode: 'chat', model,
    permissionConfig, rootAgentId: 'agent', mergedInputIDs: [], startedAt: index, finishedAt: index + 1, elapsedSeconds: 1, error: index === 3 ? '测试请求失败' : null },
    userItems: [input], userInputs: [input], agents: [], items: [], approvals: [], attachments: [], contextReferences: [], processItems: [],
    assistantResultItems: [], postAssistantItems: [], patchItems: [], planItem: null, executionPlanItems: [], contentBlocks: [], blockers: [], systemItems: [] };
}
const all = [a, b, b, a].map((model, index) => entry(index, model));
const baseItem = { messageID: 'message', turnId: 'turn', agentId: 'agent', createdAt: 1 };
const alignmentItems = [
  { ...baseItem, id: 'tool', type: 'tool', callID: 'call', tool: 'Bash', title: '运行命令', state: 'completed',
    input: null, command: 'bun test', activity: { type: 'command', kind: 'test' }, output: 'pass', error: null, startedAt: 1, finishedAt: 2, durationMs: 1 },
  { ...baseItem, id: 'reasoning', type: 'reasoning', status: 'completed', text: '检查现有实现。' },
  { ...baseItem, id: 'answered', type: 'question', prompt: '导出什么？', choices: [], status: 'answered', answer: '项目列表' },
  { ...baseItem, id: 'pending', type: 'question', prompt: '选择格式', choices: [], status: 'pending', answer: null },
];
function Alignment({ narrow, grouped }) {
  return <section data-alignment style={{ width: narrow ? 360 : 880, containerType: 'inline-size' }}>
    <div className={grouped ? 'cpx-agent-activity__list' : 'canonical-turn__process'}>
      {alignmentItems.map(item => <CanonicalItemRenderer key={item.id} item={item}
        onOpenPlanInRightDock={noop} onOpenSubagent={noop} rightDockPlanEventId={null} />)}
    </div>
  </section>;
}
function Timeline({ side }) {
  const [older, setOlder] = useState(false);
  const [generation, setGeneration] = useState(0);
  const listRef = useRef(null), navigationRef = useRef(null), scrollRef = useRef(null);
  const turns = older ? all : all.slice(1);
  return <section id={side ? 'side' : 'main'} className={side ? 'right-dock-side-chat' : ''} style={{ width: side ? 360 : 880 }}>
    <button onClick={() => setGeneration(value => value + 1)}>重新加载</button>
    <button onClick={() => navigationRef.current.revealTurn(turns.length - 1, 'instant')}>跳转末轮</button>
    <div ref={scrollRef} data-scroll-container style={{ height: 600, overflow: 'auto' }}>
      <CanonicalThreadView key={generation} turns={turns} threadId={side ? 'side' : 'main'} active={false} loading={false} loadingOlder={false}
        hasOlder={!older && !side} error={null} listRef={listRef} navigationRef={navigationRef} scrollRef={scrollRef}
        onCanReturnToBottomChange={noop} onLoadOlder={async () => setOlder(true)} onReload={async () => {}}
        onOpenPlanInRightDock={noop} onOpenSubagent={noop} rightDockPlanEventId={null} />
    </div>
  </section>;
}
function Harness() {
  return <TooltipProvider><ConversationItemContext.Provider value={context}>
    {[DEFAULT_LIGHT_THEME, DEFAULT_DARK_THEME].map(config => <button key={config.variant} onClick={() => {
      document.documentElement.classList.toggle('dark-theme', config.variant === 'dark');
      document.documentElement.style.colorScheme = config.variant;
      Object.entries(deriveThemeVariables(config)).forEach(([key, value]) => document.documentElement.style.setProperty(key, value));
    }}>{config.variant}</button>)}
    <Timeline /><Timeline side />
    <Alignment /><Alignment narrow /><Alignment narrow grouped />
    <section id="long" style={{ width: 360 }}><ModelSwitchDivider previousModel={{ ...a, id: 'very-long-model-name-'.repeat(10) }} model={b} /></section>
  </ConversationItemContext.Provider></TooltipProvider>;
}
createRoot(document.getElementById('root')).render(<Harness />);
`
if (process.versions.bun) {
  const result = await Bun.build({
    entrypoints: ['model-switch-harness'],
    target: 'browser',
    format: 'esm',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'model-switch-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:\/.*)?$|^react-dom\/client$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^model-switch-harness$/ }, () => ({
            path: 'harness',
            namespace: 'model-switch',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'model-switch' }, () => ({
            contents: harness,
            loader: 'jsx',
            resolveDir: rendererRoot,
          }))
        },
      },
    ],
  })
  assert.ok(result.success, result.logs.map(String).join('\n'))
  const child = Bun.spawn(['node', '--experimental-strip-types', fileURLToPath(import.meta.url)], {
    stdin: new Blob([await result.outputs[0]!.text()]),
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exit(await child.exited)
}
let script = ''
for await (const chunk of process.stdin) script += chunk.toString('utf8')
const css = await compileEntryStyles()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const errors: string[] = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(message.text())
  })
  await page.route('http://localhost/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<html><head><style>${css}</style></head><body><div id="root"></div></body></html>`,
    }),
  )
  await page.goto('http://localhost/')
  await page.addScriptTag({ content: script, type: 'module' })
  const divider = '.canonical-model-switch-divider'
  await expect(page.locator('#main ' + divider)).toHaveCount(1)
  await expect(page.locator('#side ' + divider)).toHaveCount(1)
  await page.locator('#main').getByRole('button', { name: '加载更早的对话' }).click()
  await expect(page.locator('#main ' + divider)).toHaveCount(2)
  await expect(page.locator('#side ' + divider)).toHaveCount(1)
  const expected = [
    '模型已切换 MiniMax/MiniMax-M3 → DeepSeek/deepseek-v4-pro',
    '模型已切换 DeepSeek/deepseek-v4-pro → MiniMax/MiniMax-M3',
  ]
  await expect(page.locator('#main ' + divider)).toHaveText(expected)
  for (const id of ['main', 'side']) {
    const section = page.locator('#' + id)
    await section.getByRole('button', { name: '重新加载' }).click()
    await expect(section.locator(divider)).toHaveText(id === 'main' ? expected : expected.slice(1))
    assert.equal(
      await section.locator(divider).evaluateAll((elements) =>
        elements.every((element) => {
          const row = element.closest('[data-turn-navigation-id]')
          const user = row?.querySelector('.canonical-user-message')
          return (
            !!user && !!(element.compareDocumentPosition(user) & Node.DOCUMENT_POSITION_FOLLOWING)
          )
        }),
      ),
      true,
      id + ': divider must precede its user message',
    )
    await section.locator('[data-scroll-container]').evaluate((element) => {
      element.style.height = '240px'
    })
    await section.getByRole('button', { name: '跳转末轮' }).click()
    await expect(section.getByText('用户消息 3', { exact: true })).toBeVisible()
    await expect
      .poll(() =>
        section.locator('[data-turn-navigation-id="turn-3"]').evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const scrollRect = element.closest('[data-scroll-container]')!.getBoundingClientRect()
          return rect.top < scrollRect.bottom && rect.bottom > scrollRect.top
        }),
      )
      .toBe(true)
    await section.locator('[data-scroll-container]').evaluate((element) => {
      element.style.height = '600px'
    })
  }
  const themeColors: string[] = []
  for (const section of await page.locator('[data-alignment]').all()) {
    await section.getByRole('button', { name: '思考过程', exact: true }).click()
    await section.getByRole('button', { name: '已回答', exact: true }).click()
  }
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: theme, exact: true }).click()
    for (const section of await page.locator('[data-alignment]').all()) {
      const geometry = await section.evaluate((element) => {
        const rows = [
          ...element.querySelectorAll(
            '.cpx-agent-activity__item-header, .canonical-process-card__summary, .canonical-lifecycle-tool',
          ),
        ]
        return {
          icons: rows.map((row) => row.querySelector('svg')!.getBoundingClientRect().left),
          labels: rows.map((row) => row.querySelector('span')!.getBoundingClientRect().left),
          headers: rows
            .filter((row) => !row.classList.contains('canonical-lifecycle-tool'))
            .map((row) => ({
              height: row.getBoundingClientRect().height,
              radius: getComputedStyle(row).borderRadius,
            })),
          bodies: [...element.querySelectorAll('.canonical-process-card__body')].map(
            (body) => body.firstElementChild!.getBoundingClientRect().left,
          ),
        }
      })
      assert.equal(
        geometry.icons.length,
        5,
        'tool, reasoning, answer and two pending rows are rendered',
      )
      assert.ok(
        Math.max(...geometry.icons) - Math.min(...geometry.icons) < 1,
        'same-level icons align',
      )
      assert.ok(
        Math.max(...geometry.labels) - Math.min(...geometry.labels) < 1,
        'same-level labels align',
      )
      assert.equal(geometry.headers.length, 3)
      assert.ok(
        geometry.headers.every(
          (header) =>
            Math.abs(header.height - geometry.headers[0]!.height) < 1 &&
            header.radius === geometry.headers[0]!.radius,
        ),
        'tool, reasoning and answer hover surfaces share height and radius',
      )
      assert.equal(geometry.bodies.length, 2)
      assert.ok(
        geometry.bodies.every((left) => Math.abs(left - geometry.labels[0]!) < 1),
        'expanded prose aligns with its heading at both widths',
      )
    }
    const metrics = await page.locator(divider).evaluateAll((elements) =>
      elements.map((element) => {
        const before = getComputedStyle(element, '::before'),
          after = getComputedStyle(element, '::after')
        const style = getComputedStyle(element)
        const parent = element.closest('section')!
        return {
          overflow: parent.scrollWidth > parent.clientWidth,
          before: before.borderTopWidth,
          after: after.borderTopWidth,
          beforeWidth: parseFloat(before.width),
          afterWidth: parseFloat(after.width),
          color: style.color,
          hiddenIcon: element.querySelector('svg')?.getAttribute('aria-hidden'),
        }
      }),
    )
    themeColors.push(metrics[0]!.color)
    for (const metric of metrics) {
      assert.equal(metric.overflow, false, 'long models must not overflow a narrow side chat')
      assert.equal(metric.before, '1px')
      assert.equal(metric.after, '1px')
      assert.ok(
        Math.abs(metric.beforeWidth - metric.afterWidth) < 1,
        'divider lines have equal widths',
      )
      assert.equal(metric.hiddenIcon, 'true')
      assert.notEqual(metric.color, '')
    }
  }
  assert.notEqual(themeColors[0], themeColors[1], 'divider foreground follows the active theme')
  assert.deepEqual(errors, [])
  if (process.env.TIMELINE_ALIGNMENT_SCREENSHOT) {
    await page
      .locator('[data-alignment]')
      .first()
      .screenshot({ path: process.env.TIMELINE_ALIGNMENT_SCREENSHOT })
  }
  if (process.env.MODEL_SWITCH_SCREENSHOT) {
    await page.screenshot({ path: process.env.MODEL_SWITCH_SCREENSHOT, fullPage: true })
  }
  console.log(
    'Timeline: model switch boundaries, history, navigation, and tool/reasoning/question alignment at main/side widths in light/dark themes passed.',
  )
} finally {
  await browser.close()
}
