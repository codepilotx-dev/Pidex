// Run: bun apps/desktop/renderer/test/ConversationStreamingHistoryRender.browser.ts
//
// 回归用例：流式 delta 只更新当前轮次时，历史轮次与其推理/工具条目不得重渲染。
// 用例同时挂载两条补丁回调路径：
// - stable：生产入口 useThreadPatchApplier，只依赖稳定的 reload，引用跨渲染不变。
// - legacy：修复前的写法（依赖整个 canonicalConversation 对象），引用每次渲染都变。
// legacy 路径必须复现历史行与条目的重复渲染，stable 路径必须保持计数不变；任一侧
// 行为变化都说明计数探针或回调稳定性契约被破坏。
import { strict as assert } from 'node:assert'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = (path: string) =>
  JSON.stringify(resolve(rendererRoot, 'src', path).replaceAll('\\', '/'))

const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { useCanonicalThreadConversation } from ${source('features/session/timeline/UseCanonicalThreadConversation.ts')};
import { useThreadPatchApplier } from ${source('features/session/conversation/UseThreadPatchApplier.ts')};
import { CanonicalTurnRow } from ${source('features/session/timeline/CanonicalThreadView.tsx')};
import { CanonicalItemRenderer } from ${source('features/session/timeline/CanonicalItemRenderer.tsx')};
import { ConversationItemContext } from ${source('features/session/timeline/ConversationItemContext.ts')};
import { QuickChatContext } from ${source('features/session/QuickChatContext.ts')};
import { createKeyedDisclosureStore } from ${source('components/ui/KeyedDisclosureStore.ts')};
import { TooltipProvider } from ${source('components/ui/Tooltip.tsx')};

const THREAD_ID = 'streaming-history-thread';
const HISTORY_TURN_ID = 'turn-history';
const CURRENT_TURN_ID = 'turn-current';
const DELTA_ITEM_ID = 'item-current-text';
const permissionConfig = { sandboxMode: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'user' };

const thread = {
  id: THREAD_ID,
  title: '流式历史会话',
  projectID: null,
  gitBranch: null,
  settings: { taskMode: 'chat', permissionConfig },
  createdAt: 1,
  updatedAt: 2,
};
const modelRef = { providerID: 'fixture', id: 'fixture-model' };
const historyInput = {
  id: 'input-history', threadId: THREAD_ID, turnId: HISTORY_TURN_ID, content: '检查历史条目渲染',
  delivery: 'start', mode: 'chat', model: modelRef, permissionConfig, state: 'completed', createdAt: 1,
};
const currentInput = {
  id: 'input-current', threadId: THREAD_ID, turnId: CURRENT_TURN_ID, content: '继续输出',
  delivery: 'start', mode: 'chat', model: modelRef, permissionConfig, state: 'active', createdAt: 2,
};
const historyTurn = {
  id: HISTORY_TURN_ID, threadId: THREAD_ID, sourceInputID: historyInput.id, status: 'completed',
  mode: 'chat', model: modelRef, permissionConfig, rootAgentId: 'agent-history',
  mergedInputIDs: [], startedAt: 1, finishedAt: 4, elapsedSeconds: 3, error: null,
};
const currentTurn = {
  id: CURRENT_TURN_ID, threadId: THREAD_ID, sourceInputID: currentInput.id, status: 'running',
  mode: 'chat', model: modelRef, permissionConfig, rootAgentId: 'agent-current',
  mergedInputIDs: [], startedAt: 2, finishedAt: null, elapsedSeconds: 0, error: null,
};
const historyItems = [
  {
    id: 'item-history-reasoning', messageID: 'message-history', turnId: HISTORY_TURN_ID,
    agentId: 'agent-history', createdAt: 2, type: 'reasoning', status: 'completed',
    text: '已确认历史轮次的数据引用本身是复用的。',
  },
  {
    id: 'item-history-tool', messageID: 'message-history', turnId: HISTORY_TURN_ID,
    agentId: 'agent-history', createdAt: 3, type: 'tool', callID: 'call-history', tool: 'Bash',
    title: '运行会话测试', state: 'completed', input: null, command: 'bun test',
    activity: { type: 'command', kind: 'test' }, output: '通过', error: null,
    startedAt: 3, finishedAt: 4, durationMs: 1,
  },
];
const historyPage = {
  thread,
  subagents: [],
  turns: [
    { turn: historyTurn, inputs: [historyInput], messages: [], agents: [], items: historyItems, approvals: [], attachments: [] },
    { turn: currentTurn, inputs: [currentInput], messages: [], agents: [], items: [], approvals: [], attachments: [] },
  ],
  queue: { version: 0, pauseReason: null, turns: [], inputs: [] },
  olderCursor: null,
  hasOlder: false,
  streamPosition: { streamId: THREAD_ID, sequence: 0 },
};

const counts = {};
const tick = (key) => { counts[key] = (counts[key] || 0) + 1; };
const fixture = window.fixture = {
  counts,
  identities: { stable: new Set(), legacy: new Set() },
  historyReads: 0,
  patchCalls: [],
  diffRefreshes: 0,
  deliver: null,
  pushDelta: null,
  applyPatch: null,
  state: null,
};
window.readThreadHistoryPage = async () => { fixture.historyReads += 1; return historyPage; };

const noop = () => {};
const refreshDiff = () => { fixture.diffRefreshes += 1; };
const testDisclosure = createKeyedDisclosureStore({
  initialExpandedKeys: ['turn-activity:' + HISTORY_TURN_ID, 'process-item:item-history-reasoning'],
});
const itemContext = {
  canCopyFileReferenceContents: () => false,
  onCopyFileReferenceContents: noop,
  onOpenFileReference: noop,
  onSubmitEditedUserMessage: async () => {},
  sessionStatus: 'running',
  workspacePath: null,
};

// memo 包装层的浅比较等价于真实 CanonicalTurnRow 的默认比较：包装层不渲染，内层行
// 就不会渲染，因此计数等于真实行的渲染次数。
const CountedTurnRow = React.memo(function CountedTurnRow({ label, entry, onApplyPatch }) {
  tick(label + ':row:' + entry.id);
  return <CanonicalTurnRow
    diffMarkerStyle="color"
    disclosureState={testDisclosure}
    entry={entry}
    onApplyPatch={onApplyPatch}
    onOpenPlanInRightDock={noop}
    onOpenSubagent={noop}
    dockedPlanItemId={null}
    threadId={THREAD_ID}
  />;
});

// 同理：item 引用与 onApplyPatch 正是 CanonicalItemRendererContent 的比较项。
const CountedHistoryItem = React.memo(function CountedHistoryItem({ label, item, onApplyPatch }) {
  tick(label + ':item:' + item.id);
  return <CanonicalItemRenderer
    item={item}
    disclosure={{ id: 'process-item:' + item.id, store: testDisclosure }}
    onApplyPatch={onApplyPatch}
    dockedPlanItemId={null}
    onOpenPlanInRightDock={noop}
    onOpenSubagent={noop}
    threadId={THREAD_ID}
  />;
});

let deltaIndex = 0;
function App() {
  const conversation = useCanonicalThreadConversation(THREAD_ID);
  const stableApplyPatch = useThreadPatchApplier(THREAD_ID, conversation.reload, refreshDiff);
  // 修复前的依赖写法：整个 canonicalConversation 每次渲染都是新对象。
  const legacyApplyPatch = React.useCallback(async () => {}, [conversation]);
  fixture.identities.stable.add(stableApplyPatch);
  fixture.identities.legacy.add(legacyApplyPatch);
  fixture.state = conversation.state;
  fixture.applyPatch = stableApplyPatch;
  fixture.pushDelta = async (text) => {
    const sequence = fixture.state ? fixture.state.stream.appliedSequence : 0;
    deltaIndex += 1;
    await fixture.deliver([{
      eventId: 'delta-' + deltaIndex,
      streamId: THREAD_ID,
      type: 'item/agentMessage/delta',
      version: 1,
      occurredAt: 10 + deltaIndex,
      threadId: THREAD_ID,
      turnId: CURRENT_TURN_ID,
      durability: 'live',
      sequence: null,
      afterSequence: sequence,
      payload: { itemId: DELTA_ITEM_ID, turnId: CURRENT_TURN_ID, agentId: 'agent-current', delta: text },
    }]);
  };

  const entries = conversation.turns;
  const historyEntry = entries.find((entry) => entry.id === HISTORY_TURN_ID) || null;
  const historyRenderItems = historyEntry
    ? historyEntry.items.filter((item) => item.type === 'reasoning' || item.type === 'tool')
    : [];

  return <div>
    <section data-panel="stable">
      {entries.map((entry) => <CountedTurnRow key={'stable-' + entry.id} label="stable" entry={entry} onApplyPatch={stableApplyPatch} />)}
    </section>
    <section data-panel="legacy">
      {entries.map((entry) => <CountedTurnRow key={'legacy-' + entry.id} label="legacy" entry={entry} onApplyPatch={legacyApplyPatch} />)}
    </section>
    <section data-panel="items">
      {historyRenderItems.map((item) => <React.Fragment key={'history-items-' + item.id}>
        <CountedHistoryItem label="stable" item={item} onApplyPatch={stableApplyPatch} />
        <CountedHistoryItem label="legacy" item={item} onApplyPatch={legacyApplyPatch} />
      </React.Fragment>)}
    </section>
  </div>;
}

createRoot(document.getElementById('root')).render(
  <QuickChatContext.Provider value={{}}>
    <ConversationItemContext.Provider value={itemContext}>
      <TooltipProvider><App /></TooltipProvider>
    </ConversationItemContext.Provider>
  </QuickChatContext.Provider>,
);
`

const clientMock = `
export const desktopClient = {
  readThreadHistoryPage: () => window.readThreadHistoryPage(),
  listPendingAgentInteractions: async () => ({ interactions: [] }),
  subscribeAgentEventEnvelopes: (options, onBatch) => {
    window.fixture.deliver = onBatch;
    return () => { window.fixture.deliver = null; };
  },
  applyThreadPatch: async (params) => { window.fixture.patchCalls.push(params); return {}; },
  supportsMessageEditing: () => false,
};
export const desktopClipboard = { writeText: async () => {} };
export const CONFIG_UPDATED_EVENT = 'fixture-config';
export const WORKSPACE_FILE_CHANGED_EVENT = 'fixture-workspace-file';
export const WORKSPACE_GIT_CHANGED_EVENT = 'fixture-workspace-git';
`

if (process.versions.bun) {
  const build = await Bun.build({
    entrypoints: ['streaming-history-render-harness'],
    target: 'browser',
    format: 'esm',
    define: {
      'process.env.NODE_ENV': '"development"',
      'import.meta.env': '{"DEV":true,"MODE":"development"}',
      'import.meta.hot': 'undefined',
    },
    plugins: [
      {
        name: 'streaming-history-render-harness',
        setup(builder) {
          builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, (args) => ({
            path: Bun.resolveSync(args.path, rendererRoot),
            namespace: 'file',
          }))
          builder.onResolve({ filter: /^streaming-history-render-harness$/ }, () => ({
            path: 'harness',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /^harness$/, namespace: 'fixture' }, () => ({
            contents: harness,
            loader: 'jsx',
            resolveDir: rendererRoot,
          }))
          builder.onResolve({ filter: /services\/desktop-client\/index\.js$/ }, () => ({
            path: 'client',
            namespace: 'fixture',
          }))
          builder.onLoad({ filter: /^client$/, namespace: 'fixture' }, () => ({
            contents: clientMock,
            loader: 'js',
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
const chrome = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await chrome.newPage({ viewport: { width: 1280, height: 1000 }, locale: 'zh-CN' })
  const errors: string[] = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error(error.message)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.setContent('<div id="root"></div>')
  await page.route('http://localhost/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><body><div id="root"></div></body></html>',
    }),
  )
  await page.goto('http://localhost/')
  await page.addScriptTag({ content: script, type: 'module' })

  const historyRowKey = 'stable:row:turn-history'
  const legacyHistoryRowKey = 'legacy:row:turn-history'
  const currentRowKey = 'stable:row:turn-current'
  const historyItemKeys = ['item-history-reasoning', 'item-history-tool'].flatMap((id) => [
    `stable:item:${id}`,
    `legacy:item:${id}`,
  ])
  await page.waitForFunction(
    () => {
      const { counts } = (window as any).fixture as { counts: Record<string, number> }
      return (
        counts['stable:row:turn-history'] >= 1 && counts['stable:item:item-history-reasoning'] >= 1
      )
    },
    undefined,
    { timeout: 30_000 },
  )

  const baseline = (await page.evaluate(() => ({ ...(window as any).fixture.counts }))) as Record<
    string,
    number
  >
  assert.ok(baseline[historyRowKey]! >= 1, 'historical row must render on mount')
  assert.ok(baseline[legacyHistoryRowKey]! >= 1, 'legacy historical row must render on mount')
  assert.ok(baseline[currentRowKey]! >= 1, 'current row must render on mount')
  for (const key of historyItemKeys) assert.ok(baseline[key]! >= 1, `${key} must render on mount`)

  const deltas = ['第一段增量。', '第二段增量。', '第三段增量。', '第四段增量。']
  let streamed = ''
  for (const delta of deltas) {
    await page.evaluate(`fixture.pushDelta(${JSON.stringify(delta)})`)
    streamed += delta
  }
  await page.waitForFunction(
    (text) =>
      (
        document.querySelector('[data-panel="stable"]') as HTMLElement | null
      )?.textContent?.includes(text) === true,
    streamed,
  )

  const after = (await page.evaluate(() => ({ ...(window as any).fixture.counts }))) as Record<
    string,
    number
  >
  const identities = (await page.evaluate(() => ({
    stable: (window as any).fixture.identities.stable.size,
    legacy: (window as any).fixture.identities.legacy.size,
  }))) as { stable: number; legacy: number }

  // 生产回调的引用跨流式渲染保持不变，历史行与条目一次都不重渲染。
  assert.equal(identities.stable, 1, 'production patch callback must keep a stable identity')
  assert.equal(
    after[historyRowKey],
    baseline[historyRowKey],
    'historical turn must not re-render while the current turn streams',
  )
  for (const key of historyItemKeys.filter((key) => key.startsWith('stable:'))) {
    assert.equal(after[key], baseline[key], `${key} must not re-render while streaming`)
  }

  // 修复前的依赖写法必须复现历史行与条目的重复渲染，证明探针能捕获该问题。
  assert.ok(identities.legacy > 1, 'legacy callback identity must change on every render')
  assert.ok(
    after[legacyHistoryRowKey]! > baseline[legacyHistoryRowKey]!,
    'legacy wiring must reproduce historical row re-renders',
  )
  for (const key of historyItemKeys.filter((key) => key.startsWith('legacy:'))) {
    assert.ok(after[key]! > baseline[key]!, `${key} must reproduce item re-renders`)
  }

  // 当前轮次仍然按既有路径追加文本并重渲染。
  assert.ok(
    after[currentRowKey]! > baseline[currentRowKey]!,
    'current turn must keep re-rendering as deltas arrive',
  )
  const currentText = (await page.evaluate(
    () => document.querySelector('[data-panel="stable"]')?.textContent ?? '',
  )) as string
  assert.ok(currentText.includes(streamed), 'streamed text must be appended to the current turn')

  // 补丁调用、重载与 diff 刷新沿用原有路径。
  const readsBeforePatch = (await page.evaluate(
    () => (window as any).fixture.historyReads,
  )) as number
  await page.evaluate(() => (window as any).fixture.applyPatch('item-history-tool', 'undo', 7))
  const patchState = (await page.evaluate(() => ({
    calls: (window as any).fixture.patchCalls,
    refreshes: (window as any).fixture.diffRefreshes,
    reads: (window as any).fixture.historyReads,
  }))) as { calls: Array<Record<string, unknown>>; refreshes: number; reads: number }
  assert.deepEqual(patchState.calls, [
    {
      threadId: 'streaming-history-thread',
      itemId: 'item-history-tool',
      action: 'undo',
      expectedVersion: 7,
    },
  ])
  assert.equal(patchState.refreshes, 1, 'patch application must refresh the diff once')
  assert.equal(patchState.reads, readsBeforePatch + 1, 'patch application must reload the thread')

  assert.deepEqual(errors, [])
  console.log(
    'Streaming history render regression: historical rows/items stay put while the current turn streams.',
  )
} finally {
  await chrome.close()
}
