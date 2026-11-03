import { createCanonicalThreadState, selectRenderTurnEntries } from '@pidex/session-view'
import { decodeEventEnvelope } from '@pidex/agent-protocol'
import { CanonicalThreadIngestionCoordinator } from '../src/features/session/timeline/CanonicalThreadIngestionCoordinator.js'
import { describe, expect, test } from 'bun:test'
import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CanonicalThreadState, RenderTurnEntry } from '@pidex/session-view'
import type { Item } from '@pidex/shared/thread'

import {
  buildProcessActivityModel,
  CanonicalConversationTurn,
  CanonicalProcessGroup,
  resolveTurnElapsedSeconds,
} from '../src/features/session/timeline/CanonicalThreadView.js'
import { QuickChatContext } from '../src/features/session/QuickChatContext.js'
import { ConversationItemContext } from '../src/features/session/timeline/ConversationItemContext.js'
import {
  CanonicalItemRenderer,
  CanonicalUserInput,
} from '../src/features/session/timeline/CanonicalItemRenderer.js'
import { TooltipProvider } from '../src/components/ui/Tooltip.js'
import { liveItemTailStore } from '../src/features/session/state/LiveItemTailStore.js'
import { ReasoningWaitingIndicator } from '../src/features/session/timeline/ReasoningWaitingIndicator.js'
import { createKeyedDisclosureStore } from '../src/components/ui/KeyedDisclosureStore.js'
import {
  isCurrentCanonicalThreadRequest,
  selectVisibleCanonicalState,
} from '../src/features/session/timeline/UseCanonicalThreadConversation.js'
import {
  processItemPathState,
  summarizeTurnProcessItems,
} from '../src/features/session/timeline/SummarizeProcessItems.js'

function disclosureStore(...expandedKeys: string[]) {
  return createKeyedDisclosureStore({ initialExpandedKeys: expandedKeys })
}

test('reasoning nodes survive completion and interruption and preserve expansion', () => {
  for (const status of ['streaming', 'completed', 'interrupted'] as const) {
    const item: Extract<Item, { type: 'reasoning' }> = {
      id: 'reasoning-hidden',
      messageID: 'message',
      turnId: 'turn',
      agentId: 'agent',
      type: 'reasoning',
      text: '**完整思考内容**',
      status,
    }
    const render = (expanded: boolean) =>
      renderToStaticMarkup(
        <CanonicalItemRenderer
          item={item}
          disclosure={{
            id: `process-item:${item.id}`,
            store: disclosureStore(...(expanded ? [`process-item:${item.id}`] : [])),
          }}
          dockedPlanItemId={null}
          onOpenPlanInRightDock={() => {}}
          onOpenSubagent={() => {}}
        />,
      )
    const collapsed = render(false)
    expect(collapsed).toContain(
      status === 'streaming' ? '正在思考' : status === 'interrupted' ? '思考已中断' : '思考',
    )
    expect(collapsed.includes('reasoning-node__preview')).toBe(status === 'streaming')
    const expanded = render(true)
    expect(expanded).toContain('**完整思考内容**')
    expect(expanded).not.toContain('reasoning-node__preview')
    expect(expanded).toContain('aria-expanded="true"')
  }
})

test('reasoning tail reveals the node and removes only its active waiting indicator', () => {
  const item = {
    id: 'reasoning-tail',
    type: 'reasoning',
    text: '',
    status: 'streaming',
  } as Extract<Item, { type: 'reasoning' }>
  const render = () =>
    renderToStaticMarkup(
      <CanonicalItemRenderer
        item={item}
        threadId="reasoning-test"
        dockedPlanItemId={null}
        onOpenPlanInRightDock={() => {}}
        onOpenSubagent={() => {}}
      />,
    )
  const waiting = (reasoning = item) =>
    renderToStaticMarkup(<ReasoningWaitingIndicator item={reasoning} threadId="reasoning-test" />)
  try {
    expect(render()).toBe('')
    expect(waiting()).toContain('正在思考')
    liveItemTailStore.append('reasoning-test', item.id, 'reasoning', '追加内容')
    expect(render()).toContain('追加内容')
    expect(waiting()).toBe('')
    item.text = '已有内容'
    expect(render()).toContain('已有内容追加内容')
    item.text += liveItemTailStore.read('reasoning-test', item.id)
    liveItemTailStore.clearThread('reasoning-test')
    expect(render()).toContain('已有内容追加内容')
    expect(render()).not.toContain('追加内容追加内容')
    expect(waiting({ ...item, status: 'completed' })).toContain('正在思考')
  } finally {
    liveItemTailStore.clearThread('reasoning-test')
  }
})

function CanonicalTestProviders({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <QuickChatContext.Provider value={{} as React.ContextType<typeof QuickChatContext>}>
      <ConversationItemContext.Provider
        value={{
          canCopyFileReferenceContents: () => false,
          onCopyFileReferenceContents: () => undefined,
          onOpenFileReference: () => undefined,
          onSubmitEditedUserMessage: async () => undefined,
          sessionStatus: 'idle',
          workspacePath: null,
        }}
      >
        <TooltipProvider>{children}</TooltipProvider>
      </ConversationItemContext.Provider>
    </QuickChatContext.Provider>
  )
}

describe('canonical thread switch', () => {
  test('historical assistant action rows show their original timestamp after completion', () => {
    const item: Extract<Item, { type: 'text' }> = {
      id: 'reply-time',
      messageID: 'reply',
      turnId: 'turn',
      agentId: 'agent',
      type: 'text',
      placement: 'result',
      status: 'completed',
      text: '回复正文',
      createdAt: 1234,
    }
    const render = (status: typeof item.status) =>
      renderToStaticMarkup(
        <CanonicalTestProviders>
          <CanonicalItemRenderer
            item={{ ...item, status }}
            showAssistantActions
            dockedPlanItemId={null}
            onOpenPlanInRightDock={() => {}}
            onOpenSubagent={() => {}}
          />
        </CanonicalTestProviders>,
      )
    expect(render('completed')).toContain('dateTime="1970-01-01T00:00:01.234Z"')
    expect(render('streaming')).not.toContain('<time')
  })
  test('historical delivery remains visible outside collapsed main activity', () => {
    const delivery: Item = {
      id: 'delivery',
      messageID: 'message',
      turnId: 'turn',
      agentId: 'agent',
      type: 'tool',
      callID: 'call',
      tool: 'finalize_result',
      title: '提交结果',
      state: 'completed',
      input: null,
      command: null,
      error: null,
      output: '历史完整交付',
      startedAt: 1,
      finishedAt: 2,
    }
    const entry = {
      id: 'turn',
      turn: { id: 'turn', status: 'completed', elapsedSeconds: 1, error: null },
      items: [delivery],
      userItems: [],
      attachments: [],
      contextReferences: [],
      processItems: [delivery],
      assistantResultItems: [],
      patchItems: [],
      postAssistantItems: [],
      planItem: null,
      executionPlanItems: [],
      blockers: [],
      contentBlocks: [],
    } as unknown as RenderTurnEntry
    const render = (isSubagent = false) =>
      renderToStaticMarkup(
        <CanonicalTestProviders>
          <CanonicalConversationTurn
            isSubagent={isSubagent}
            disclosureState={disclosureStore('turn-activity:turn')}
            entry={entry}
            onOpenPlanInRightDock={() => undefined}
            onOpenSubagent={() => undefined}
            dockedPlanItemId={null}
          />
        </CanonicalTestProviders>,
      )
    const main = render()
    expect(main).toContain('canonical-turn__result')
    expect(main).toContain('历史完整交付')
    expect(main).not.toContain('已提交子代理结果')
    expect(main).not.toContain('canonical-result-card')
    const child = render(true)
    expect(child).toContain('已提交子代理结果')
    expect(child).not.toContain('历史完整交付')
    expect(child).not.toContain('canonical-turn__result')
  })

  test('Skill 在 canonical 用户消息正文中展示，不依赖聊天标题', () => {
    const input = {
      id: 'input-skill',
      threadId: 'thread-skill',
      turnId: 'turn-skill',
      content: '你好',
      skills: [
        { name: 'mmx-cli', path: 'skills/mmx-cli/SKILL.md' },
        { name: 'review', path: 'skills/review/SKILL.md' },
      ],
      delivery: 'start',
      mode: 'chat',
      model: { providerID: 'openai', id: 'gpt-5' },
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      state: 'completed',
      createdAt: 1,
    } as React.ComponentProps<typeof CanonicalUserInput>['input']
    const markup = renderToStaticMarkup(
      <CanonicalTestProviders>
        <CanonicalUserInput input={input} attachments={[]} contextReferences={[]} />
      </CanonicalTestProviders>,
    )
    expect(markup).toContain('$mmx-cli')
    expect(markup).toContain('$review')
    expect(markup).toContain('composer-inline-skill-token')
    expect(markup).not.toContain('lucide-box')
    expect(markup).toContain('user-message-markdown__measurement has-inline-prefix')
    expect(markup).toContain('你好')
    expect(markup).toContain('dateTime="1970-01-01T00:00:00.001Z"')
    expect(markup).not.toContain('skills/mmx-cli/SKILL.md')
  })
  test('正式用户消息只保留外壳上的唯一操作栏', () => {
    const input = {
      id: 'input-actions',
      threadId: 'thread-actions',
      turnId: 'turn-actions',
      content: '检查操作栏',
      delivery: 'start',
      mode: 'chat',
      model: { providerID: 'openai', id: 'gpt-5' },
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      state: 'completed',
      createdAt: 1,
    } as React.ComponentProps<typeof CanonicalUserInput>['input']
    const markup = renderToStaticMarkup(
      <CanonicalTestProviders>
        <CanonicalUserInput
          input={input}
          attachments={[]}
          contextReferences={[]}
          registerInputRow={() => undefined}
        />
      </CanonicalTestProviders>,
    )
    expect(markup.match(/aria-label="用户消息操作"/g)).toHaveLength(1)
  })
  test('does not expose state from the previous thread', () => {
    const state = {
      thread: { id: 'thread-a' },
    } as unknown as CanonicalThreadState

    expect(selectVisibleCanonicalState(state, 'thread-a')).toBe(state)
    expect(selectVisibleCanonicalState(state, 'thread-b')).toBeNull()
    expect(selectVisibleCanonicalState(state, null)).toBeNull()
  })

  test('rejects history and live results from an older thread generation', () => {
    expect(isCurrentCanonicalThreadRequest('thread-b', 2, 'thread-b', 2)).toBe(true)
    expect(isCurrentCanonicalThreadRequest('thread-b', 2, 'thread-a', 1)).toBe(false)
    expect(isCurrentCanonicalThreadRequest('thread-a', 2, 'thread-a', 1)).toBe(false)
  })

  test('initializes every process group collapsed and follows manual expansion', () => {
    const completed = renderToStaticMarkup(
      <CanonicalProcessGroup
        active={false}
        failed={false}
        kind="command"
        label="运行了命令"
        summaryKey="completed:command"
      >
        <span data-testid="expensive-tool-card">tool output</span>
      </CanonicalProcessGroup>,
    )
    const active = renderToStaticMarkup(
      <CanonicalProcessGroup
        active
        failed={false}
        kind="command"
        label="正在执行 bun test"
        summaryKey="active:command"
      >
        <span data-testid="active-tool-card">tool output</span>
      </CanonicalProcessGroup>,
    )
    const failed = renderToStaticMarkup(
      <CanonicalProcessGroup
        active={false}
        failed
        kind="failed"
        label="命令失败 bun test"
        summaryKey="failed:command"
      >
        <span data-testid="failed-tool-card">tool output</span>
      </CanonicalProcessGroup>,
    )
    const persisted = renderToStaticMarkup(
      <CanonicalProcessGroup
        active={false}
        defaultExpanded
        failed={false}
        kind="command"
        label="运行了命令"
        summaryKey="completed:command"
      >
        <span data-testid="persisted-tool-card">tool output</span>
      </CanonicalProcessGroup>,
    )
    const unnamed = renderToStaticMarkup(
      <CanonicalProcessGroup
        active={false}
        failed={false}
        kind="tool"
        label=""
        summaryKey="completed:empty"
      >
        <span>tool output</span>
      </CanonicalProcessGroup>,
    )
    const summaryOnly = renderToStaticMarkup(
      <CanonicalProcessGroup
        active
        canExpand={false}
        failed={false}
        kind="thinking"
        label="正在思考"
        summaryKey="active:reasoning"
      />,
    )

    expect(completed).not.toContain('expensive-tool-card')
    expect(completed).toContain('data-state="closed"')
    expect(completed).toContain('aria-hidden="true"')
    expect(completed).toContain('inert')
    expect(completed).not.toContain('lucide-check')
    expect(completed).toContain('lucide-square-terminal')
    expect(completed).toContain('lucide-chevron-right')
    expect(completed).not.toContain('lucide-chevron-down')
    expect(active).not.toContain('active-tool-card')
    expect(active).toContain('data-state="active"')
    expect(active).toContain('lucide-loader-circle')
    expect(active).toContain('lucide-chevron-right')
    expect(failed).not.toContain('failed-tool-card')
    expect(failed).toContain('lucide-circle-alert')
    expect(persisted).toContain('persisted-tool-card')
    expect(persisted).toContain('lucide-chevron-right')
    expect(persisted).toContain('aria-expanded="true"')
    expect(unnamed).toContain('aria-label="处理过程"')
    expect(summaryOnly).toContain('正在思考')
    expect(summaryOnly).not.toContain('<button')
    expect(summaryOnly).not.toContain('lucide-chevron')
  })

  test('isolates subagent items into their own group in both directions', () => {
    const subagent = (
      id: string,
      status: Extract<Item, { type: 'subagent' }>['status'] = 'completed',
    ): Extract<Item, { type: 'subagent' }> => ({
      id,
      messageID: `message-${id}`,
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'subagent',
      subagentTaskId: `task-${id}`,
      runId: `run-${id}`,
      childThreadId: `child-${id}`,
      displayName: id,
      profile: 'explorer',
      task: '审阅仓库',
      status,
      queueReason: null,
      result: null,
      createdAt: 1_000,
    })
    const tool = (id: string): Extract<Item, { type: 'tool' }> => ({
      id,
      messageID: `message-${id}`,
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'tool',
      callID: `call-${id}`,
      tool: 'Bash',
      title: 'Bash',
      state: 'completed',
      input: null,
      command: 'bun test',
      output: null,
      error: null,
      startedAt: 1_000,
      finishedAt: 2_000,
      durationMs: 1_000,
      createdAt: 1_000,
    })
    const model = buildProcessActivityModel(
      [tool('tool-a'), subagent('agent-a'), subagent('agent-b'), tool('tool-b')],
      { activitySliceClosed: true, turnActive: false },
    )

    expect(
      model.units.map((unit) =>
        unit.kind === 'group'
          ? ['group', ...unit.items.map((item) => item.id)]
          : [unit.kind, unit.item.id],
      ),
    ).toEqual([
      ['activity', 'tool-a'],
      ['group', 'agent-a', 'agent-b'],
      ['activity', 'tool-b'],
    ])
  })

  test('renders subagents as a single non-expandable line that opens the directory', () => {
    const subagent = (id: string): Extract<Item, { type: 'subagent' }> => ({
      id,
      messageID: `message-${id}`,
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'subagent',
      subagentTaskId: `task-${id}`,
      runId: `run-${id}`,
      childThreadId: `child-${id}`,
      displayName: id,
      profile: 'explorer',
      task: '审阅仓库',
      status: 'completed',
      queueReason: null,
      result: null,
      createdAt: 1_000,
    })
    const spawned: Item = {
      id: 'spawn',
      messageID: 'message-spawn',
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'tool',
      callID: 'call-spawn',
      tool: 'spawn_agents',
      title: 'spawn_agents',
      state: 'completed',
      input: null,
      command: null,
      error: null,
      output: null,
      startedAt: 1_000,
      finishedAt: 2_000,
    }
    const entry = {
      id: 'turn-1',
      turn: { id: 'turn-1', status: 'completed', elapsedSeconds: 5, error: null },
      items: [spawned, subagent('Frontend'), subagent('Backend')],
      userItems: [],
      attachments: [],
      contextReferences: [],
      processItems: [spawned, subagent('Frontend'), subagent('Backend')],
      assistantResultItems: [],
      patchItems: [],
      postAssistantItems: [],
      planItem: null,
      executionPlanItems: [],
      blockers: [],
      contentBlocks: [],
    } as unknown as RenderTurnEntry

    const html = renderToStaticMarkup(
      <CanonicalTestProviders>
        <CanonicalConversationTurn
          disclosureState={disclosureStore('turn-activity:turn-1')}
          entry={entry}
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          dockedPlanItemId={null}
        />
      </CanonicalTestProviders>,
    )

    // 内联只有一行摘要：没有展开箭头、没有逐任务卡片、没有生命周期行。
    expect(html).toContain('Frontend和Backend 已完成')
    expect(html).toContain('打开子智能体列表')
    expect(html).not.toContain('cpx-agent-activity__chevron')
    expect(html).not.toContain('canonical-subagent-card')
    expect(html).not.toContain('已创建子代理')
  })

  test('folds spawn/wait lifecycle rows into the subagent group instead of extra lines', () => {
    const subagent = (
      id: string,
      status: Extract<Item, { type: 'subagent' }>['status'] = 'completed',
    ): Extract<Item, { type: 'subagent' }> => ({
      id,
      messageID: `message-${id}`,
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'subagent',
      subagentTaskId: `task-${id}`,
      runId: `run-${id}`,
      childThreadId: `child-${id}`,
      displayName: id,
      profile: 'explorer',
      task: '审阅仓库',
      status,
      queueReason: null,
      result: null,
      createdAt: 1_000,
    })
    const lifecycle = (id: string, name: string): Extract<Item, { type: 'tool' }> => ({
      id,
      messageID: `message-${id}`,
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'tool',
      callID: `call-${id}`,
      tool: name,
      title: name,
      state: 'completed',
      input: null,
      command: null,
      output: null,
      error: null,
      startedAt: 1_000,
      finishedAt: 2_000,
      durationMs: 1_000,
      createdAt: 1_000,
    })
    const model = buildProcessActivityModel(
      [
        lifecycle('spawn', 'spawn_agents'),
        subagent('agent-a'),
        subagent('agent-b'),
        lifecycle('wait', 'wait_agents'),
      ],
      { activitySliceClosed: true, turnActive: false },
    )

    // 同轮已有子智能体时，创建与等待行被吸收，只保留一个组。
    expect(model.units).toHaveLength(1)
    const [unit] = model.units
    expect(unit.kind).toBe('group')
    if (unit.kind === 'group') {
      expect(unit.items.map((item) => item.id)).toEqual(['agent-a', 'agent-b'])
      expect(summarizeTurnProcessItems(unit.items, 'completed').label).toBe(
        'agent-a和agent-b 已完成',
      )
    }
  })

  test('groups only consecutive activity and lets lifecycle rows interrupt it', () => {
    const tool = (
      id: string,
      name: string,
      input: unknown = null,
    ): Extract<Item, { type: 'tool' }> => ({
      id,
      messageID: `message-${id}`,
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'tool',
      callID: `call-${id}`,
      tool: name,
      title: name,
      state: 'completed',
      input,
      command: name === 'Bash' ? 'bun test' : null,
      output: null,
      error: null,
      startedAt: 1_000,
      finishedAt: 2_000,
      durationMs: 1_000,
      createdAt: 1_000,
    })
    const model = buildProcessActivityModel(
      [
        tool('tool-1', 'Bash'),
        tool('tool-2', 'workspace.apply_patch', {
          affectedPaths: [{ path: 'src/main.ts', operation: 'update' }],
        }),
        tool('tool-3', 'update_plan'),
        tool('tool-4', 'Read', { file_path: 'src/main.ts' }),
        tool('tool-5', 'request_permissions'),
        tool('tool-6', 'Grep', { pattern: 'fallbackTitle' }),
        tool('tool-7', 'spawn_agents'),
      ],
      { activitySliceClosed: true, turnActive: false },
    )

    expect(
      model.units.map((unit) =>
        unit.kind === 'group'
          ? ['group', ...unit.items.map((item) => item.id)]
          : [unit.kind, unit.item.id],
      ),
    ).toEqual([
      ['group', 'tool-1', 'tool-2'],
      ['standalone', 'tool-3'],
      ['activity', 'tool-4'],
      ['standalone', 'tool-5'],
      ['activity', 'tool-6'],
      ['standalone', 'tool-7'],
    ])

    const active = {
      ...tool('tool-8', 'Bash'),
      state: 'running' as const,
      finishedAt: null,
      durationMs: null,
    }
    expect(
      buildProcessActivityModel([tool('tool-9', 'Read')], {
        activitySliceClosed: true,
        turnActive: false,
      }),
    ).toMatchObject({
      activeGroupKey: null,
      units: [{ kind: 'activity', item: { id: 'tool-9' } }],
    })
    expect(
      buildProcessActivityModel([tool('tool-9', 'Read')], {
        activitySliceClosed: false,
        turnActive: true,
      }),
    ).toMatchObject({
      activeGroupKey: 'process-group:tool-9',
      units: [{ kind: 'group', items: [{ id: 'tool-9' }] }],
    })
    expect(
      buildProcessActivityModel([active], { activitySliceClosed: true, turnActive: false }),
    ).toMatchObject({
      units: [{ kind: 'group', items: [{ id: 'tool-8' }] }],
    })
  })

  test('uses commentary and reasoning as hard boundaries, excluding empty terminal reasoning', () => {
    const tool = (
      id: string,
      state: 'completed' | 'error' = 'completed',
    ): Extract<Item, { type: 'tool' }> => ({
      id,
      messageID: `message-${id}`,
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'tool',
      callID: `call-${id}`,
      tool: 'Bash',
      title: 'Bash',
      state,
      input: null,
      command: `echo ${id}`,
      output: null,
      error: state === 'error' ? 'failed' : null,
      startedAt: 1_000,
      finishedAt: 2_000,
      durationMs: 1_000,
      createdAt: 1_000,
    })
    const commentary = {
      id: 'commentary-1',
      type: 'text',
      placement: 'process',
      text: '先检查相关文件。',
      status: 'completed',
    } as unknown as Extract<Item, { type: 'text' }>
    const reasoning = {
      id: 'reasoning-1',
      type: 'reasoning',
      text: '分析下一步',
      status: 'streaming',
    } as unknown as Extract<Item, { type: 'reasoning' }>
    const model = buildProcessActivityModel(
      [tool('failed-edit', 'error'), commentary, tool('command-1'), reasoning, tool('command-2')],
      { activitySliceClosed: true, turnActive: false },
    )

    expect(model.units).toMatchObject([
      { kind: 'activity', item: { id: 'failed-edit' } },
      { kind: 'standalone', item: { id: 'commentary-1' } },
      { kind: 'activity', item: { id: 'command-1' } },
      { kind: 'standalone', item: { id: 'reasoning-1' } },
      { kind: 'activity', item: { id: 'command-2' } },
    ])

    const exploration = {
      ...tool('read-1'),
      activity: {
        type: 'read' as const,
        subject: 'file' as const,
        target: { displayLabel: 'src/a.ts', workspacePath: 'src/a.ts' },
      },
      command: null,
      tool: 'Read',
    }
    expect(processItemPathState({ ...exploration, state: 'running' })).toBe('running')
    expect(processItemPathState(exploration)).toBe('completed')
    expect(
      buildProcessActivityModel([exploration, reasoning, tool('command-after-read')], {
        activitySliceClosed: true,
        turnActive: false,
      }),
    ).toMatchObject({
      units: [
        { kind: 'activity', item: { id: 'read-1' } },
        { kind: 'standalone', item: { id: 'reasoning-1' } },
        { kind: 'activity', item: { id: 'command-after-read' } },
      ],
    })

    expect(
      buildProcessActivityModel([reasoning], { activitySliceClosed: true, turnActive: false }),
    ).toMatchObject({
      activeGroupKey: null,
      showThinkingFallback: false,
      units: [{ kind: 'standalone', item: reasoning }],
    })
    expect(
      buildProcessActivityModel([reasoning], { activitySliceClosed: false, turnActive: true }),
    ).toMatchObject({
      activeGroupKey: null,
      showThinkingFallback: true,
      units: [{ kind: 'standalone', item: reasoning }],
    })

    for (const status of ['completed', 'interrupted'] as const) {
      const empty = { ...reasoning, text: ' \n', status }
      expect(
        buildProcessActivityModel([tool('before'), empty, tool('after')], {
          activitySliceClosed: true,
          turnActive: false,
        }).units,
      ).toMatchObject([{ kind: 'group', items: [{ id: 'before' }, { id: 'after' }] }])
    }

    const runningCommand = {
      ...tool('running-command'),
      durationMs: null,
      finishedAt: null,
      state: 'running' as const,
    }
    expect(
      buildProcessActivityModel([runningCommand, reasoning], {
        activitySliceClosed: false,
        turnActive: true,
      }),
    ).toMatchObject({
      activeGroupKey: null,
      showThinkingFallback: true,
      units: [
        { kind: 'group', items: [{ id: 'running-command' }] },
        { kind: 'standalone', item: reasoning },
      ],
    })

    expect(
      buildProcessActivityModel([commentary], { activitySliceClosed: false, turnActive: true }),
    ).toMatchObject({
      activeGroupKey: null,
      showThinkingFallback: true,
    })
    expect(
      buildProcessActivityModel([commentary], {
        activitySliceClosed: false,
        hasBlockingRequest: true,
        turnActive: true,
      }),
    ).toMatchObject({
      activeGroupKey: null,
      showThinkingFallback: false,
    })

    const contextCompression = {
      id: 'context-compression-1',
      messageID: 'message-context-compression-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'activity',
      activity: 'context-compression',
      title: '上下文已自动压缩',
      status: 'completed',
      createdAt: 1_500,
    } as const
    expect(
      buildProcessActivityModel(
        [tool('command-before-compression'), contextCompression, tool('command-after-compression')],
        { activitySliceClosed: true, turnActive: false },
      ),
    ).toMatchObject({
      units: [
        { kind: 'activity', item: { id: 'command-before-compression' } },
        { kind: 'standalone', item: { id: 'context-compression-1' } },
        { kind: 'activity', item: { id: 'command-after-compression' } },
      ],
    })
  })

  test('keeps active elapsed time monotonic and freezes terminal elapsed time', () => {
    const turn = {
      id: 'turn-1',
      elapsedSeconds: 12,
      startedAt: 10_000,
    } as RenderTurnEntry['turn']

    expect(resolveTurnElapsedSeconds(turn, true, 25_900)).toBe(15)
    expect(resolveTurnElapsedSeconds(turn, true, 15_000)).toBe(12)
    expect(resolveTurnElapsedSeconds(turn, false, 99_000)).toBe(12)
    expect(
      resolveTurnElapsedSeconds(
        {
          ...turn,
          elapsedSeconds: 3,
          finishedAt: 18_900,
        },
        false,
        99_000,
      ),
    ).toBe(8)
  })

  test('keeps pending blockers visible when completed activity is collapsed', () => {
    const commentary = {
      id: 'process-text-blocked',
      messageID: 'message-process-blocked',
      turnId: 'turn-blocked',
      agentId: 'agent-1',
      type: 'text',
      placement: 'process',
      text: '折叠后不可见的处理说明',
      status: 'completed',
      createdAt: 500,
    } as const
    const answer = {
      ...commentary,
      id: 'answer-blocked',
      messageID: 'message-answer-blocked',
      placement: 'result',
      text: '折叠外的最终回复',
    } as const
    const question = {
      id: 'question-1',
      messageID: 'message-question-1',
      turnId: 'turn-blocked',
      agentId: 'agent-1',
      type: 'question',
      prompt: '请选择发布方式',
      choices: [{ id: 'safe', label: '安全发布', recommended: true }],
      status: 'pending',
      answer: null,
      createdAt: 1_500,
    } as const
    const markup = renderToStaticMarkup(
      <CanonicalTestProviders>
        <CanonicalConversationTurn
          disclosureState={disclosureStore()}
          entry={
            {
              id: 'turn-blocked',
              turn: {
                id: 'turn-blocked',
                status: 'completed',
                elapsedSeconds: 5,
                error: null,
              },
              items: [commentary, answer, question],
              userItems: [],
              attachments: [],
              processItems: [commentary],
              assistantResultItems: [answer],
              patchItems: [],
              postAssistantItems: [],
              planItem: null,
              executionPlanItems: [],
              blockers: [
                {
                  kind: 'question',
                  id: 'question:question-1',
                  createdAt: 1_500,
                  question,
                },
              ],
              contentBlocks: [{ kind: 'assistant', id: `assistant:${answer.id}`, items: [answer] }],
            } as unknown as RenderTurnEntry
          }
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          dockedPlanItemId={null}
        />
      </CanonicalTestProviders>,
    )

    expect(markup).not.toContain('折叠后不可见的处理说明')
    expect(markup).toContain('data-state="closed"')
    expect(markup).toContain('aria-hidden="true"')
    // 折叠活动外仍展示询问与等待状态；问题正文由输入区域承载，时间线不再回显。
    expect(markup).toContain('canonical-turn__blockers')
    expect(markup).toContain('正在询问问题')
    expect(markup).toContain('等待你的回答')
    expect(markup).toContain('折叠外的最终回复')
  })

  test('renders process before the final answer and keeps file changes after it', () => {
    const processText = {
      id: 'process-text-1',
      messageID: 'message-process',
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'text',
      // Historical projection can classify an old result-placement item as process content.
      placement: 'result',
      text: '中间处理说明标记',
      status: 'completed',
      createdAt: 500,
    } as const
    const processTextAfterCommands = {
      ...processText,
      id: 'process-text-2',
      messageID: 'message-process-2',
      text: '继续处理说明标记',
      createdAt: 1_500,
    } as const
    const tool = {
      id: 'tool-1',
      messageID: 'message-tool',
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'tool',
      callID: 'call-1',
      tool: 'Bash',
      title: '运行测试',
      state: 'completed',
      input: null,
      command: 'bun test',
      output: 'pass',
      error: null,
      startedAt: 1_000,
      finishedAt: 2_000,
      durationMs: 1_000,
      createdAt: 1_000,
    } as const
    const planTool = {
      ...tool,
      id: 'tool-plan',
      messageID: 'message-plan-tool',
      callID: 'call-plan',
      tool: 'update_plan',
      title: 'update_plan',
      input: {
        plan: [{ step: '检查实现', status: 'completed' }],
      },
      command: null,
      output: JSON.stringify({ status: 'updated' }),
      createdAt: 750,
    } as const
    const answer = {
      id: 'answer-1',
      messageID: 'message-answer',
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'text',
      placement: 'result',
      text: '最终回复标记',
      status: 'completed',
      createdAt: 2_000,
    } as const
    const patch = {
      id: 'patch-1',
      messageID: 'message-patch',
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'patch',
      files: [
        {
          path: 'src/main.ts',
          additions: 1,
          deletions: 0,
          patch: null,
        },
      ],
      totalAdditions: 1,
      totalDeletions: 0,
      createdAt: 3_000,
    } as const
    const compactionActivity = {
      id: 'context-compression-post',
      messageID: 'message-context-compression-post',
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'activity',
      activity: 'context-compression',
      title: '上下文已自动压缩标记',
      status: 'completed',
      createdAt: 4_000,
    } as const
    const entry = {
      id: 'turn-1',
      turn: {
        id: 'turn-1',
        status: 'completed',
        elapsedSeconds: 359,
        error: null,
      },
      items: [processText, planTool, tool, answer, patch, compactionActivity],
      userItems: [],
      attachments: [],
      processItems: [processText, planTool, tool, compactionActivity],
      assistantResultItems: [answer],
      patchItems: [patch],
      postAssistantItems: [],
      planItem: null,
      executionPlanItems: [],
      blockers: [],
      contentBlocks: [{ kind: 'assistant', id: `assistant:${answer.id}`, items: [answer] }],
    } as unknown as RenderTurnEntry
    const markup = renderToStaticMarkup(
      <CanonicalTestProviders>
        <CanonicalConversationTurn
          disclosureState={disclosureStore('turn-activity:turn-1')}
          entry={entry}
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          dockedPlanItemId={null}
        />
      </CanonicalTestProviders>,
    )
    const collapsedMarkup = renderToStaticMarkup(
      <CanonicalTestProviders>
        <CanonicalConversationTurn
          disclosureState={disclosureStore()}
          entry={entry}
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          dockedPlanItemId={null}
        />
      </CanonicalTestProviders>,
    )
    const activeMarkup = renderToStaticMarkup(
      <CanonicalTestProviders>
        <CanonicalConversationTurn
          disclosureState={disclosureStore()}
          entry={{
            ...entry,
            assistantResultItems: [],
            contentBlocks: [],
            items: [processText, planTool, tool],
            patchItems: [],
            turn: { ...entry.turn, status: 'running' },
          }}
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          dockedPlanItemId={null}
        />
      </CanonicalTestProviders>,
    )
    const secondTool = {
      ...tool,
      id: 'tool-2',
      messageID: 'message-tool-2',
      callID: 'call-2',
      command: 'bun run typecheck',
      createdAt: 1_100,
    } as const
    const multiCommandMarkup = renderToStaticMarkup(
      <CanonicalTestProviders>
        <CanonicalConversationTurn
          disclosureState={disclosureStore('turn-activity:turn-1')}
          entry={{
            ...entry,
            items: [tool, secondTool, answer],
            processItems: [tool, secondTool],
            patchItems: [],
          }}
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          dockedPlanItemId={null}
        />
      </CanonicalTestProviders>,
    )
    const nestedBoundaryMarkup = renderToStaticMarkup(
      <CanonicalTestProviders>
        <CanonicalConversationTurn
          disclosureState={disclosureStore('turn-activity:turn-1')}
          entry={{
            ...entry,
            items: [processText, tool, secondTool, processTextAfterCommands, planTool, answer],
            processItems: [processText, tool, secondTool, processTextAfterCommands, planTool],
            patchItems: [],
          }}
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          dockedPlanItemId={null}
        />
      </CanonicalTestProviders>,
    )
    const activeWithAnswerMarkup = renderToStaticMarkup(
      <CanonicalTestProviders>
        <CanonicalConversationTurn
          disclosureState={disclosureStore('turn-activity:turn-1')}
          entry={{
            ...entry,
            items: [tool, secondTool, answer],
            patchItems: [],
            postAssistantItems: [],
            processItems: [tool, secondTool],
            turn: { ...entry.turn, status: 'running' },
          }}
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          dockedPlanItemId={null}
        />
      </CanonicalTestProviders>,
    )

    const visibleText = markup.replace(/<[^>]*>/g, '')
    const workStatusIndex = visibleText.indexOf('已处理 5m 59s')
    const processTextIndex = visibleText.indexOf('中间处理说明标记')
    const lifecycleIndex = visibleText.indexOf('已更新计划')
    const commandsIndex = visibleText.indexOf('bun test')
    const answerIndex = visibleText.indexOf('最终回复标记')
    const patchIndex = visibleText.indexOf('已编辑 1 个文件')
    const compactionIndex = visibleText.indexOf('上下文已自动压缩标记')
    expect(processTextIndex).toBeGreaterThan(-1)
    expect(workStatusIndex).toBeGreaterThan(-1)
    expect(workStatusIndex).toBeLessThan(processTextIndex)
    expect(lifecycleIndex).toBeGreaterThan(processTextIndex)
    expect(commandsIndex).toBeGreaterThan(lifecycleIndex)
    expect(answerIndex).toBeGreaterThan(commandsIndex)
    expect(patchIndex).toBeGreaterThan(answerIndex)
    expect(compactionIndex).toBeGreaterThan(commandsIndex)
    expect(compactionIndex).toBeLessThan(answerIndex)
    expect(
      markup.slice(
        markup.indexOf('canonical-turn__process'),
        markup.indexOf('canonical-turn__result'),
      ),
    ).toContain('上下文已自动压缩标记')
    expect(markup).not.toContain('运行了 1 条命令')
    expect(markup).not.toContain('canonical-process-group--commands')
    expect(markup).toContain('cpx-agent-activity__item')
    expect(markup).toContain('data-presentation="grouped"')
    expect(multiCommandMarkup).toContain('运行了命令')
    expect(multiCommandMarkup).not.toContain('cpx-agent-activity__path-step')
    expect(multiCommandMarkup).not.toContain('canonical-process-group--commands')
    expect(multiCommandMarkup).not.toContain('canonical-command-shell')
    expect(activeWithAnswerMarkup).toContain('运行了命令')
    expect(activeWithAnswerMarkup).not.toContain('正在思考')
    expect(activeWithAnswerMarkup).not.toContain('lucide-loader-circle')
    expect(activeWithAnswerMarkup).toContain('data-expandable="true"')
    const processSectionStart = nestedBoundaryMarkup.indexOf(
      '<section class="canonical-turn__process"',
    )
    const processSectionEnd = nestedBoundaryMarkup.indexOf(
      '<section class="canonical-turn__result"',
      processSectionStart,
    )
    const processSection = nestedBoundaryMarkup.slice(processSectionStart, processSectionEnd)
    expect(processSection).toContain('中间处理说明标记')
    expect(processSection).toContain('运行了命令')
    expect(processSection).toContain('继续处理说明标记')
    expect(processSection).toContain('已更新计划')
    expect(processSection.indexOf('中间处理说明标记')).toBeLessThan(
      processSection.indexOf('运行了命令'),
    )
    expect(processSection.indexOf('运行了命令')).toBeLessThan(
      processSection.indexOf('继续处理说明标记'),
    )
    expect(processSection.indexOf('继续处理说明标记')).toBeLessThan(
      processSection.indexOf('已更新计划'),
    )
    expect(processSection.match(/中间处理说明标记/g)).toHaveLength(1)
    expect(processSection.match(/已更新计划/g)).toHaveLength(1)
    expect(markup).toContain('class="canonical-turn-activity"')
    expect(markup).toContain('aria-expanded="true"')
    expect(collapsedMarkup).toContain('aria-expanded="false"')
    expect(collapsedMarkup).not.toContain('中间处理说明标记')
    expect(collapsedMarkup).not.toContain('bun test')
    expect(collapsedMarkup).not.toContain('上下文已自动压缩标记')
    expect(collapsedMarkup).toContain('aria-hidden="true"')
    expect(collapsedMarkup).toContain('inert')
    expect(collapsedMarkup).toContain('最终回复标记')
    expect(collapsedMarkup).toContain('已编辑 1 个文件')
    expect(activeMarkup).toContain('中间处理说明标记')
    expect(activeMarkup).not.toContain('canonical-turn-activity__chevron')
    expect(activeMarkup).toContain('data-expandable="false"')
    expect(activeMarkup).not.toContain('已编辑 1 个文件')
    expect(activeMarkup).toContain('已处理 5m 59s')
    expect(markup.match(/canonical-message-actions--assistant/g)).toHaveLength(1)
  })

  test('summarizes process items into neutral stage labels and keeps groups collapsed', () => {
    const tool = (
      id: string,
      activity: Extract<Item, { type: 'tool' }>['activity'],
      state: 'running' | 'completed' = 'completed',
    ): Extract<Item, { type: 'tool' }> => ({
      id,
      messageID: `message-${id}`,
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'tool',
      callID: `call-${id}`,
      tool: 'Bash',
      title: id,
      state,
      input: null,
      command: null,
      activity,
      output: null,
      error: null,
      startedAt: 1_000,
      finishedAt: 2_000,
      durationMs: 1_000,
      createdAt: 1_000,
    })

    const readTool = tool('read-1', { type: 'read', subject: 'file' })
    const cmdTool = tool('cmd-1', { type: 'command', kind: 'test' }, 'running')
    const integrationTool = tool('gh-1', { type: 'integration', source: 'GitHub' })

    const runningSummary = summarizeTurnProcessItems([readTool, cmdTool], 'running')
    expect(runningSummary.label).toBe('正在查阅代码并执行命令…')
    expect(runningSummary.active).toBe(true)

    const integrationSummary = summarizeTurnProcessItems([integrationTool], 'completed')
    expect(integrationSummary.label).toBe('使用 GitHub')
    expect(integrationSummary.active).toBe(false)

    const activeMarkup = renderToStaticMarkup(
      <CanonicalProcessGroup
        active={true}
        failed={false}
        kind="command"
        label="读取文件、运行命令"
        summaryKey="active:read-1|cmd-1:read-cmd"
      >
        <span data-testid="running-step">step output</span>
      </CanonicalProcessGroup>,
    )
    expect(activeMarkup).toContain('data-expanded="false"')
    expect(activeMarkup).not.toContain('running-step')

    const completedMarkup = renderToStaticMarkup(
      <CanonicalProcessGroup
        active={false}
        failed={false}
        kind="command"
        label="读取文件、运行命令"
        summaryKey="completed:read-1|cmd-1:read-cmd"
      >
        <span data-testid="completed-step">step output</span>
      </CanonicalProcessGroup>,
    )
    expect(completedMarkup).toContain('data-expanded="false"')
    expect(processItemPathState(cmdTool)).toBe('running')
    expect(processItemPathState({ ...cmdTool, state: 'error' })).toBe('failed')
  })
})

test('Radix 强制展开不覆盖保存选择，结束后恢复且内层分组共用 keyed store', () => {
  const store = disclosureStore()
  const process = {
    id: 'process',
    messageID: 'm',
    turnId: 'turn',
    agentId: 'agent',
    type: 'text',
    placement: 'process',
    phase: 'commentary',
    text: '过程标记',
    status: 'completed',
    createdAt: 1,
  } as const
  const final = {
    ...process,
    id: 'final',
    placement: 'result',
    phase: 'final_answer',
    text: '回答标记',
    status: 'streaming',
  } as const
  const render = (force: boolean) =>
    renderToStaticMarkup(
      <CanonicalTestProviders>
        <CanonicalConversationTurn
          disclosureState={store}
          entry={
            {
              id: 'turn',
              turn: { id: 'turn', status: 'running', elapsedSeconds: 2, error: null },
              items: [process, final],
              userItems: [],
              attachments: [],
              processItems: [process],
              assistantResultItems: [final],
              patchItems: [],
              postAssistantItems: [],
              planItem: null,
              executionPlanItems: [],
              blockers: [],
              contentBlocks: [{ kind: 'assistant', id: `assistant:${final.id}`, items: [final] }],
              forceExpandActivity: force,
            } as unknown as RenderTurnEntry
          }
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          dockedPlanItemId={null}
        />
      </CanonicalTestProviders>,
    )
  expect(render(false)).not.toContain('过程标记')
  expect(render(false)).toContain('回答标记')
  expect(render(true)).toContain('过程标记')
  expect(store.getSnapshot('turn-activity:turn')).toBe(false)
  expect(render(false)).not.toContain('过程标记')
  store.setExpanded('turn-activity:turn', true)
  expect(render(false)).toContain('过程标记')
  const group = (active: boolean) =>
    renderToStaticMarkup(
      <CanonicalProcessGroup
        active={active}
        failed={false}
        kind="command"
        label="运行命令"
        summaryKey="group"
        disclosure={{ store, id: 'process-group:turn:group' }}
      >
        <span>内层标记</span>
      </CanonicalProcessGroup>,
    )
  expect(group(false)).not.toContain('内层标记')
  expect(group(true)).not.toContain('内层标记')
  expect(store.getSnapshot('process-group:turn:group')).toBe(false)
  store.setExpanded('process-group:turn:group', true)
  expect(group(true)).toContain('内层标记')
})

test.each(['idle-manual', 'active-manual', 'automatic', 'reactive'] as const)(
  '真实会话组件按 Codex 归属显示压缩，默认折叠不吞空闲手动节点：%s',
  async (scenario) => {
    const idle = scenario === 'idle-manual'
    const manual = scenario === 'idle-manual' || scenario === 'active-manual'
    const config = {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    } as const
    const turn = {
      id: 'compression-turn',
      threadId: 'compression-thread',
      sourceInputID: 'input',
      status: idle ? ('completed' as const) : ('running' as const),
      mode: 'chat' as const,
      model: { providerID: 'openai', id: 'test' },
      permissionConfig: config,
      rootAgentId: 'agent',
      mergedInputIDs: [],
      startedAt: 1,
      finishedAt: idle ? 2 : null,
      elapsedSeconds: 1,
      error: null,
    }
    const answer = {
      id: 'answer',
      messageID: 'message',
      turnId: turn.id,
      agentId: 'agent',
      type: 'text',
      placement: 'result',
      phase: 'final_answer',
      status: 'completed',
      text: '原有回复',
      createdAt: 2,
    } as const
    const state = createCanonicalThreadState({
      thread: {
        id: turn.threadId,
        title: 'test',
        projectID: null,
        gitBranch: null,
        settings: { taskMode: 'chat', permissionConfig: config },
        createdAt: 1,
        updatedAt: 1,
      },
      subagents: [],
      olderCursor: null,
      hasOlder: false,
      streamPosition: { streamId: turn.threadId, sequence: 0 },
      turns: [
        {
          turn,
          inputs: [],
          agents: [],
          messages: [],
          approvals: [],
          items: [
            {
              id: 'thought',
              messageID: 'thought-message',
              turnId: turn.id,
              agentId: 'agent',
              type: 'reasoning',
              text: '原有思考',
              status: 'completed',
              createdAt: 1,
            },
            ...(idle ? [answer] : []),
          ],
        },
      ],
    })
    const coordinator = new CanonicalThreadIngestionCoordinator({
      threadId: turn.threadId,
      initialState: state,
    })
    const operation = {
      operationId: 'operation',
      threadId: turn.threadId,
      turnId: idle ? null : turn.id,
      sessionId: null,
      agentId: 'agent',
      trigger: manual
        ? ('manual' as const)
        : scenario === 'reactive'
          ? ('reactive' as const)
          : ('automatic' as const),
      phase: 'settled' as const,
      status: 'running' as const,
      compactionId: null,
      reason: null,
      createdAt: Date.now() - 11_000,
      updatedAt: Date.now(),
    }
    const envelope = (sequence: number, type: string, payload: unknown) =>
      decodeEventEnvelope({
        eventId: String(sequence),
        streamId: turn.threadId,
        threadId: turn.threadId,
        type,
        version: type === 'turn/completed' ? 2 : 1,
        durability: 'durable',
        sequence,
        occurredAt: Date.now(),
        payload,
      })
    const render = () =>
      renderToStaticMarkup(
        <CanonicalTestProviders>
          {selectRenderTurnEntries(coordinator.getSnapshot()!).map((entry) => (
            <CanonicalConversationTurn
              key={entry.id}
              entry={entry}
              disclosureState={disclosureStore()}
              dockedPlanItemId={null}
              onOpenPlanInRightDock={() => {}}
              onOpenSubagent={() => {}}
            />
          ))}
        </CanonicalTestProviders>,
      )
    try {
      await coordinator.deliverBatch([envelope(1, 'context/compactionUpdated', { operation })])
      const running = render()
      if (idle) {
        expect(running).toContain('正在压缩上下文 · 可能需要几分钟')
        expect(running.indexOf('原有回复')).toBeLessThan(running.indexOf('正在压缩上下文'))
        expect(selectRenderTurnEntries(coordinator.getSnapshot()!)).toHaveLength(2)
      } else {
        expect(running).toContain('正在压缩上下文')
        expect(selectRenderTurnEntries(coordinator.getSnapshot()!)).toHaveLength(1)
      }
      await coordinator.deliverBatch([
        envelope(2, 'context/compacted', {
          compactionId: 'result',
          trigger: operation.trigger,
          beforeCount: 3,
          afterCount: 1,
          beforeTokens: 20_000,
          afterTokens: 10_000,
          targetTokens: 16_000,
          baselineVersion: 1,
          usageSampleId: 'sample',
        }),
        envelope(3, 'context/compactionUpdated', {
          operation: { ...operation, status: 'completed', compactionId: 'result' },
        }),
      ])
      if (!idle)
        await coordinator.deliverBatch([
          envelope(4, 'item/completed', { item: answer }),
          envelope(5, 'turn/completed', {
            turn: { ...turn, status: 'completed', finishedAt: Date.now() },
          }),
        ])
      expect(coordinator.getSnapshot()!.itemsById.size).toBe(3)
      const completed = render()
      if (idle) {
        expect(completed.match(/上下文已压缩/g)).toHaveLength(1)
        expect(completed).not.toContain('正在压缩上下文')
        expect(completed.indexOf('原有回复')).toBeLessThan(completed.indexOf('上下文已压缩'))
        const nodeTurn = completed.slice(completed.lastIndexOf('<article class="canonical-turn"'))
        expect(nodeTurn).not.toContain('canonical-turn-activity__summary')
        expect(nodeTurn).not.toContain('aria-expanded')
        expect(nodeTurn).not.toContain('Token ')
      }
      if (!idle) expect(completed).not.toContain(manual ? '上下文已压缩' : '上下文已自动压缩')
      const entries = selectRenderTurnEntries(coordinator.getSnapshot()!)
      const nodeEntry = entries.at(-1)!
      const expanded = renderToStaticMarkup(
        <CanonicalTestProviders>
          <CanonicalConversationTurn
            entry={nodeEntry}
            disclosureState={disclosureStore(`turn-activity:${nodeEntry.id}`)}
            dockedPlanItemId={null}
            onOpenPlanInRightDock={() => {}}
            onOpenSubagent={() => {}}
          />
        </CanonicalTestProviders>,
      )
      expect(expanded).toContain(manual ? '上下文已压缩' : '上下文已自动压缩')
    } finally {
      coordinator.dispose()
    }
  },
)

test.each(['running', 'completed'] as const)('只有压缩活动时不显示过程折叠入口：%s', (status) => {
  const item: Extract<Item, { type: 'activity' }> = {
    id: 'sole-compaction',
    messageID: 'message',
    turnId: 'sole-turn',
    agentId: 'agent',
    type: 'activity',
    activity: 'context-compression',
    title: status === 'running' ? '正在压缩上下文' : '上下文已自动压缩',
    status,
    createdAt: Date.now(),
  }
  const entry = {
    id: item.turnId,
    turn: { id: item.turnId, status: 'completed', startedAt: 1, elapsedSeconds: 1, error: null },
    items: [item],
    userItems: [],
    attachments: [],
    contextReferences: [],
    processItems: [item],
    assistantResultItems: [],
    patchItems: [],
    postAssistantItems: [],
    planItem: null,
    executionPlanItems: [],
    blockers: [],
    contentBlocks: [],
  } as unknown as RenderTurnEntry
  const markup = renderToStaticMarkup(
    <CanonicalTestProviders>
      <CanonicalConversationTurn
        entry={entry}
        disclosureState={disclosureStore()}
        dockedPlanItemId={null}
        onOpenPlanInRightDock={() => {}}
        onOpenSubagent={() => {}}
      />
    </CanonicalTestProviders>,
  )
  expect(markup).toContain(item.title)
  expect(markup).not.toContain('canonical-turn-activity__summary')
  expect(markup).not.toContain('aria-expanded')
})

test('assistant actions align to the left in Codex order with optional goal status and divider', () => {
  const textItem = {
    id: 'text-1',
    messageID: 'msg-1',
    turnId: 'turn-1',
    agentId: 'agent-1',
    type: 'text',
    text: '你好，你好。',
    status: 'completed',
    createdAt: 1730547240000,
    placement: 'result',
  } as Extract<Item, { type: 'text' }>

  // 1. With goal duration
  const markupWithGoal = renderToStaticMarkup(
    <CanonicalTestProviders>
      <CanonicalItemRenderer
        item={textItem}
        showAssistantActions={true}
        goalAchievedDuration="12s"
        dockedPlanItemId={null}
        onOpenPlanInRightDock={() => {}}
        onOpenSubagent={() => {}}
      />
    </CanonicalTestProviders>,
  )

  expect(markupWithGoal).toContain('canonical-message-actions--assistant')
  expect(markupWithGoal).toContain('toolbar-divider')
  expect(markupWithGoal).toContain('canonical-goal-achieved')
  expect(markupWithGoal).toContain('已在 12s 内达成目标')
  expect(markupWithGoal).toContain('lucide-circle-check')

  // Verify order: copy button -> divider -> goal achieved -> sent time
  const copyIdx = markupWithGoal.indexOf('aria-label="复制"')
  const dividerIdx = markupWithGoal.indexOf('toolbar-divider')
  const goalIdx = markupWithGoal.indexOf('canonical-goal-achieved')
  const timeIdx = markupWithGoal.indexOf('<time')
  expect(copyIdx).toBeGreaterThan(-1)
  expect(dividerIdx).toBeGreaterThan(copyIdx)
  expect(goalIdx).toBeGreaterThan(dividerIdx)
  expect(timeIdx).toBeGreaterThan(goalIdx)

  // 2. Without goal duration
  const markupWithoutGoal = renderToStaticMarkup(
    <CanonicalTestProviders>
      <CanonicalItemRenderer
        item={textItem}
        showAssistantActions={true}
        goalAchievedDuration={null}
        dockedPlanItemId={null}
        onOpenPlanInRightDock={() => {}}
        onOpenSubagent={() => {}}
      />
    </CanonicalTestProviders>,
  )
  expect(markupWithoutGoal).not.toContain('toolbar-divider')
  expect(markupWithoutGoal).not.toContain('canonical-goal-achieved')
  const noGoalCopyIdx = markupWithoutGoal.indexOf('aria-label="复制"')
  const noGoalTimeIdx = markupWithoutGoal.indexOf('<time')
  expect(noGoalCopyIdx).toBeGreaterThan(-1)
  expect(noGoalTimeIdx).toBeGreaterThan(noGoalCopyIdx)
})
