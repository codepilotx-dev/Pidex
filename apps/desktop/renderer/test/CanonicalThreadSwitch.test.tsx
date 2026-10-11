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
import { CanonicalUserInput } from '../src/features/session/timeline/CanonicalItemRenderer.js'
import { TooltipProvider } from '../src/components/ui/Tooltip.js'
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
    expect(markup).not.toContain('skills/mmx-cli/SKILL.md')
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

  test('initializes completed groups collapsed and active groups expanded', () => {
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
    expect(completed).toContain('data-mount-policy="until-exit"')
    expect(completed).toContain('aria-hidden="true"')
    expect(completed).toContain('inert')
    expect(completed).not.toContain('lucide-check')
    expect(completed).toContain('lucide-square-terminal')
    expect(completed).toContain('lucide-chevron-right')
    expect(completed).not.toContain('lucide-chevron-down')
    expect(active).toContain('active-tool-card')
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

  test('uses commentary as a hard boundary and keeps reasoning only with exploration', () => {
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
      {
        kind: 'group',
        items: [{ id: 'command-1' }, { id: 'command-2' }],
      },
    ])
    expect(JSON.stringify(model)).not.toContain('reasoning-1')

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
        {
          kind: 'group',
          items: [{ id: 'read-1' }, { id: 'reasoning-1' }, { id: 'command-after-read' }],
        },
      ],
    })

    expect(
      buildProcessActivityModel([reasoning], { activitySliceClosed: true, turnActive: false }),
    ).toEqual({ activeGroupKey: null, showThinkingFallback: false, units: [] })
    expect(
      buildProcessActivityModel([reasoning], { activitySliceClosed: false, turnActive: true }),
    ).toEqual({ activeGroupKey: null, showThinkingFallback: true, units: [] })

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
      activeGroupKey: 'process-group:running-command',
      showThinkingFallback: false,
      units: [{ kind: 'group', items: [{ id: 'running-command' }] }],
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
              contentBlocks: [],
            } as unknown as RenderTurnEntry
          }
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          rightDockPlanEventId={null}
        />
      </CanonicalTestProviders>,
    )

    expect(markup).not.toContain('折叠后不可见的处理说明')
    expect(markup).toContain('data-mount-policy="until-exit"')
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
    const postAssistantActivity = {
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
      items: [processText, planTool, tool, answer, patch, postAssistantActivity],
      userItems: [],
      attachments: [],
      processItems: [processText, planTool, tool],
      assistantResultItems: [answer],
      patchItems: [patch],
      postAssistantItems: [postAssistantActivity],
      planItem: null,
      executionPlanItems: [],
      blockers: [],
      contentBlocks: [],
    } as unknown as RenderTurnEntry
    const markup = renderToStaticMarkup(
      <CanonicalTestProviders>
        <CanonicalConversationTurn
          disclosureState={disclosureStore('turn-activity:turn-1')}
          entry={entry}
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          rightDockPlanEventId={null}
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
          rightDockPlanEventId={null}
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
            items: [processText, planTool, tool],
            patchItems: [],
            turn: { ...entry.turn, status: 'running' },
          }}
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          rightDockPlanEventId={null}
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
          rightDockPlanEventId={null}
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
          rightDockPlanEventId={null}
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
          rightDockPlanEventId={null}
        />
      </CanonicalTestProviders>,
    )

    const visibleText = markup.replace(/<[^>]*>/g, '')
    const workStatusIndex = visibleText.indexOf('已处理 5m 59s')
    const processTextIndex = visibleText.indexOf('中间处理说明标记')
    const lifecycleIndex = visibleText.indexOf('已更新计划')
    const commandsIndex = visibleText.indexOf('bun test · 1 秒')
    const answerIndex = visibleText.indexOf('最终回复标记')
    const patchIndex = visibleText.indexOf('已编辑 1 个文件')
    const postAssistantIndex = visibleText.indexOf('上下文已自动压缩标记')
    expect(processTextIndex).toBeGreaterThan(-1)
    expect(workStatusIndex).toBeGreaterThan(-1)
    expect(workStatusIndex).toBeLessThan(processTextIndex)
    expect(lifecycleIndex).toBeGreaterThan(processTextIndex)
    expect(commandsIndex).toBeGreaterThan(lifecycleIndex)
    expect(answerIndex).toBeGreaterThan(commandsIndex)
    expect(patchIndex).toBeGreaterThan(answerIndex)
    expect(postAssistantIndex).toBeGreaterThan(patchIndex)
    expect(markup).not.toContain('运行了 1 条命令')
    expect(markup).not.toContain('canonical-process-group--commands')
    expect(markup).toContain('cpx-agent-activity__item')
    expect(markup).toContain('data-presentation="grouped"')
    expect(multiCommandMarkup).toContain('运行命令')
    expect(multiCommandMarkup).not.toContain('cpx-agent-activity__path-step')
    expect(multiCommandMarkup).not.toContain('canonical-process-group--commands')
    expect(multiCommandMarkup).not.toContain('canonical-command-shell')
    expect(activeWithAnswerMarkup).toContain('运行命令')
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
    expect(processSection).toContain('运行命令')
    expect(processSection).toContain('继续处理说明标记')
    expect(processSection).toContain('已更新计划')
    expect(processSection.indexOf('中间处理说明标记')).toBeLessThan(
      processSection.indexOf('运行命令'),
    )
    expect(processSection.indexOf('运行命令')).toBeLessThan(
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

  test('summarizes process items into neutral stage labels and auto-expands active groups', () => {
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
    expect(runningSummary.label).toBe('读取文件、运行命令')
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
    expect(activeMarkup).toContain('data-expanded="true"')
    expect(activeMarkup).toContain('running-step')

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
