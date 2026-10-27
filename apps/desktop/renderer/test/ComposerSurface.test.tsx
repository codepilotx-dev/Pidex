import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesktopThreadGoal, DesktopWorkspace } from '../shared/Types.js'
import { ComposerCard } from '../src/features/session/composer/ComposerCard.js'
import { ModelSelectTrigger } from '../src/features/session/composer/ModelSelectTrigger.js'
import { ComposerStatusOverlay } from '../src/features/session/composer/ComposerStatusOverlay.js'
import {
  ContextUsagePanel,
  ContextUsageStatusPanel,
} from '../src/features/session/composer/ContextUsagePanel.js'
import {
  resolveThinkingLabel,
  resolveThinkingOptions,
} from '../src/features/session/composer/ThinkingLevelPopover.js'
import { resolveComposerCanSubmit } from '../src/features/session/composer/UseDesktopComposerController.js'
import { useComposerSlashCommands } from '../src/features/session/composer/UseComposerSlashCommands.js'
import { DEFAULT_COMPOSER_CAPABILITIES } from '../src/features/session/composer/ComposerTypes.js'

type ComposerCardProps = Parameters<typeof ComposerCard>[0]

const WORKSPACE: DesktopWorkspace = {
  name: 'Alpha 工作区',
  path: 'C:\\alpha',
  branchName: 'feature/working-surface',
}

const GOAL: DesktopThreadGoal = {
  id: 'goal-1',
  threadId: 'thread-1',
  objective: '统一 Composer 顶部托盘',
  status: 'active',
  tokenBudget: 10_000,
  tokensUsed: 1_200,
  timeUsedSeconds: 90,
  version: 1,
  createdAt: 0,
  updatedAt: 0,
}

function composerCardProps(overrides: Partial<ComposerCardProps> = {}): ComposerCardProps {
  return {
    input: '',
    canSubmit: true,
    sessionStatus: 'idle',
    permissionMode: 'default',
    thinkingMode: 'default',
    showThinkingOptions: false,
    deepSeekThinkingControls: false,
    showContextUsage: false,
    selectedProviderID: 'anthropic',
    selectedModelPreset: 'default',
    modelPresets: [],
    providerOptions: [],
    permissionOptions: [
      { value: 'default', label: '默认权限' },
      { value: 'auto-review', label: '自动审查' },
      { value: 'full-access', label: '完全访问' },
      { value: 'custom', label: '自定义' },
    ],
    thinkingOptions: [{ value: 'default', label: '默认' }],
    branchName: 'feature/working-surface',
    branches: ['feature/working-surface'],
    recentWorkspaces: [],
    workspace: null,
    onChooseWorkspace: () => {},
    onInputChange: () => {},
    onInterrupt: () => {},
    onProviderModelChange: () => {},
    onOpenWorkspace: () => {},
    onClearWorkspace: () => {},
    onBranchSelect: () => {},
    onCreateBranch: () => {},
    onPermissionChange: () => {},
    onSubmit: () => {},
    onThinkingChange: () => {},
    placement: 'new-session',
    ...overrides,
  }
}

describe('composer surface variant', () => {
  test('紧凑模型入口只显示图标但保留模型与推理的完整无障碍名称', () => {
    const html = renderToStaticMarkup(
      <ModelSelectTrigger
        compact
        modelName="provider/long-model"
        showThinkingOptions
        thinkingLabel="高"
      />,
    )
    expect(html).toContain('data-compact="true"')
    expect(html).toContain('aria-label="模型与推理设置：provider/long-model，高"')
    expect(html).not.toContain('composer-model-trigger-name-model')
    expect(html).not.toContain('composer-model-trigger-effort-btn')
  })
  test('发送、入队及模式切换不把整个输入区设为 inert', async () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ submitting: true, canSubmit: false })} />,
    )
    expect(html).not.toContain('inert=""')
    const source = await Bun.file(
      new URL('../src/features/session/composer/ComposerCard.tsx', import.meta.url),
    ).text()
    expect(source).not.toContain('inert={')
    expect(source).toContain("picker?.addEventListener('cancel', restoreFocus)")
    expect(source).toContain("picker?.addEventListener('change', restoreFocus)")
  })
  test('没有上下文统计时不渲染用量圆环与空面板', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ showContextUsage: true })} />,
    )
    expect(html).not.toContain('aria-label="上下文窗口使用量')
    expect(html).not.toContain('chip-dot')
    expect(html).not.toContain('暂无上下文统计')
    expect(renderToStaticMarkup(<ContextUsagePanel contextUsage={null} />)).toBe('')
  })

  test('有上下文统计时圆环标注已用与剩余比例', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          showContextUsage: true,
          contextUsage: { usedTokens: 12_000, contextWindow: 200_000, usedPercent: 6 },
        })}
      />,
    )
    expect(html).toContain('已用 6%，剩余 94%')
    expect(html).toContain('chip-dot tw:size-3')
  })

  test('Composer 圆环保留纵向来源、缓存和读写明细布局', () => {
    const html = renderToStaticMarkup(
      <ContextUsagePanel
        contextUsage={{
          usedTokens: 135_168,
          contextWindow: 1_000_000,
          usedPercent: 13.5,
          breakdown: [
            { source: 'messages', chars: 800 },
            { source: 'skills', chars: 200 },
          ],
          averageCacheHitRate: 0.597,
          promptCacheReadTokens: 131_072,
          promptCacheWriteTokens: 0,
          promptUncachedTokens: 597,
        }}
      />,
    )
    expect(html.split('context-usage-panel-segment').length - 1).toBe(2)
    expect(html).toContain('context-usage-panel-divider')
    expect(html.split('context-usage-panel-detail-item').length - 1).toBe(3)
    expect(html.split('context-usage-panel-detail-chip').length - 1).toBe(3)
    expect(html).toContain('平均缓存命中率')
    expect(html).toContain('59.7%')
    expect(html).toContain('未缓存')
    expect(html).not.toContain('data-usage-layout="title-bar-value"')
    expect(html).not.toContain('data-usage-bar-source')
  })

  test('发送中使用侧栏运行会话同款的圆环加载指示', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ submitting: true, canSubmit: false })} />,
    )
    expect(html).toContain('send-button-session-spinner')
    expect(html).not.toContain('lucide-activity')
  })

  test('状态与用量面板使用标题、状态条和数据的可聚焦色块布局', () => {
    const html = renderToStaticMarkup(
      <ContextUsageStatusPanel
        contextUsage={{
          usedTokens: 135_168,
          contextWindow: 1_000_000,
          usedPercent: 13.5,
          breakdown: [
            { source: 'messages', chars: 800 },
            { source: 'skills', chars: 200 },
          ],
          averageCacheHitRate: 0.597,
        }}
      />,
    )
    expect(html).toContain('平均缓存命中率')
    expect(html.split('data-usage-layout="title-bar-value"').length - 1).toBe(2)
    expect(html).toContain('59.7%')
    expect(html).toContain('data-usage-bar-source="messages"')
    expect(html).toContain('data-usage-bar-source="skills"')
    expect(html).toContain('data-usage-bar-source="cache-hit"')
    expect(html).not.toContain('data-usage-bar-source="cache-miss"')
    expect(html).toContain('aria-label="缓存命中：59.7%"')
    expect(html).toContain('width:59.70%')
    expect(html).not.toContain('context-usage-panel-row')
    expect(html).not.toContain('context-usage-panel-detail')
  })

  test('Plan 仅开启后显示可退出标记，子 Agent 不展示', () => {
    const render = (planModeActive: boolean, subagentMode = false) =>
      renderToStaticMarkup(
        <ComposerCard
          {...composerCardProps({
            planModeActive,
            placement: subagentMode ? 'side-task' : 'new-session',
            onPlanModeChange: () => {},
          })}
        />,
      )
    expect(render(false)).not.toContain('title="退出计划模式"')
    expect(render(true)).toContain('aria-pressed="true"')
    expect(render(true)).toContain('aria-label="退出计划模式"')
    expect(render(true, true)).not.toContain('title="退出计划模式"')
  })
  test('Goal 与 Plan 输入状态互斥，动作不删除持久化目标', async () => {
    const changes: string[] = []
    let commands: ReturnType<typeof useComposerSlashCommands>['commands'] = []
    let executeCommand: ReturnType<typeof useComposerSlashCommands>['executeCommand']
    let failPlan = false
    function Harness({ plan }: { plan: boolean }) {
      const controls = useComposerSlashCommands({
        capabilities: DEFAULT_COMPOSER_CAPABILITIES,
        planModeActive: plan,
        goalModeEnabled: !plan,
        hasConversationMessages: true,
        hasThread: true,
        canReview: false,
        subagentMode: false,
        sessionBusy: false,
        reasoningAvailable: false,
        showThreadActions: false,
        showNewSessionActions: false,
        canFork: false,
        hasProject: false,
        onOpenModel: () => {},
        onOpenReasoning: () => {},
        onOpenStatus: () => {},
        onOpenReview: () => {},
        onGoalModeChange: (active) => {
          changes.push(`goal:${active}`)
        },
        onPlanModeChange: (active) => {
          if (failPlan) throw new Error('切换失败')
          changes.push(`plan:${active}`)
        },
      })
      commands = controls.commands
      executeCommand = controls.executeCommand
      return null
    }
    renderToStaticMarkup(<Harness plan />)
    await commands.find((command) => command.id === 'goal')?.execute()
    expect(changes).toEqual(['plan:false', 'goal:true'])
    changes.length = 0
    renderToStaticMarkup(<Harness plan={false} />)
    await commands.find((command) => command.id === 'plan')?.execute()
    expect(changes).toEqual(['plan:true', 'goal:false'])
    changes.length = 0
    failPlan = true
    expect(await executeCommand!(commands.find((command) => command.id === 'plan')!)).toBe(false)
    expect(changes).toEqual([])
  })
  test('Coding、Working 与 Chat 输出各自的 data-surface 标记', () => {
    const coding = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'coding' })} />,
    )
    const working = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'working' })} />,
    )
    const chat = renderToStaticMarkup(<ComposerCard {...composerCardProps({ surface: 'chat' })} />)
    expect(coding).toContain('data-surface="coding"')
    expect(working).toContain('data-surface="working"')
    expect(working).toContain('data-placement="new-session"')
    expect(chat).toContain('data-surface="chat"')
  })

  test('Composer 独立投影首页外壳、实际布局与圆角角色', () => {
    const defaults = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ placement: 'thread' })} />,
    )
    const home = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          layout: 'multiline',
          radiusVariant: 'default',
          utilityBarVariant: 'home',
        })}
      />,
    )
    const singleLine = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          layout: 'single-line',
          radiusVariant: 'single-line',
        })}
      />,
    )
    const compact = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ radiusVariant: 'compact' })} />,
    )

    expect(defaults).toContain('data-composer-layout="multiline"')
    expect(defaults).toContain('data-composer-radius-variant="default"')
    expect(defaults).toContain('data-composer-utility-bar-variant="default"')
    expect(home).toContain('data-composer-layout="multiline"')
    expect(home).toContain('data-composer-radius-variant="default"')
    expect(home).toContain('data-composer-utility-bar-variant="home"')
    const surfaceClass = /class="(composer composer-input-surface composer-top[^"]*)"/
    const defaultSurface = defaults.match(surfaceClass)?.[1]
    expect(defaultSurface).toBeDefined()
    expect(home.match(surfaceClass)?.[1]).toBe(defaultSurface)
    expect(defaultSurface).toContain('tw:border-0 tw:bg-app-control tw:[backdrop-filter:none]')
    expect(defaultSurface).toContain('tw:shadow-prominent')
    expect(singleLine).toContain('data-composer-layout="single-line"')
    expect(singleLine).toContain('data-composer-radius-variant="single-line"')
    expect(compact).toContain('data-composer-radius-variant="compact"')
  })

  test('首页与会话共享编辑区基础高度及底部留白', async () => {
    const shell = await Bun.file(
      new URL('../src/styles/features/composer-shell.css', import.meta.url),
    ).text()
    const home = await Bun.file(
      new URL('../src/features/session/QuickChatView.tsx', import.meta.url),
    ).text()
    const thread = await Bun.file(
      new URL('../src/features/session/conversation/ConversationPage.tsx', import.meta.url),
    ).text()
    expect(shell).toMatch(/\.composer-stack \.composer-editor-content\s*\{\s*min-height: 44px;/)
    expect(home).toContain('tw:pb-4')
    expect(thread).toContain('footerClassName="workflow-main-scroll-footer tw:px-0 tw:pb-4"')
  })

  test('Composer utility bar 只在有内容时渲染，首页默认显示项目、工作组和分支', () => {
    const emptyThread = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ placement: 'thread' })} />,
    )
    expect(emptyThread).not.toContain('composer-bottom composer-utility-bar')

    const home = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          surface: 'coding',
          utilityBarVariant: 'home',
          workspace: WORKSPACE,
        })}
      />,
    )
    expect(home.split('composer-bottom composer-utility-bar').length - 1).toBe(1)
    expect(home).toContain(WORKSPACE.name)
    expect(home).toContain('工作组')
    expect(home).toContain(WORKSPACE.branchName)
  })

  test('暂停队列与 thread Goal 共用一个 utility bar，且队列不再显示数量头', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          placement: 'thread',
          routedSessionId: 'thread-1',
          workspace: WORKSPACE,
          threadGoal: GOAL,
          queuedFollowUps: [
            {
              id: 'queue-1',
              input: { text: '继续补齐验收' },
              previewText: '继续补齐验收',
              createdAt: '2026-10-26T00:00:00.000Z',
            },
          ],
          queuePauseReason: 'interrupted',
        })}
      />,
    )

    expect(html.split('composer-bottom composer-utility-bar').length - 1).toBe(1)
    expect(html).toContain('aria-label="Composer 顶部托盘"')
    expect(html).toContain('data-composer-utility-item="queue"')
    expect(html).not.toContain('session-follow-up-header')
    expect(html).not.toContain('待发送')
    expect(html).toContain('继续补齐验收')
    expect(html).not.toContain('1 条')
    expect(html).not.toContain('已排队 1 条')
    expect(html).toContain('队列因你中断了任务而暂停')
    expect(html).toContain('继续队列')
    expect(html).toContain('data-composer-utility-item="goal"')
    expect(html).toContain('目标')
    expect(html).toContain(GOAL.objective)
    expect(html).toContain('aria-label="目标操作"')
    expect(html).not.toContain(WORKSPACE.name)

    const complete = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          placement: 'thread',
          routedSessionId: 'thread-1',
          threadGoal: { ...GOAL, status: 'complete' },
        })}
      />,
    )
    expect(complete).not.toContain('data-composer-utility-item="goal"')
    expect(complete).not.toContain('composer-bottom composer-utility-bar')
  })

  test('/status is a command that opens the transient status panel', async () => {
    let commands: ReturnType<typeof useComposerSlashCommands>['commands'] = []
    let executeCommand: ReturnType<typeof useComposerSlashCommands>['executeCommand']
    let opens = 0

    function Harness() {
      const controls = useComposerSlashCommands({
        capabilities: DEFAULT_COMPOSER_CAPABILITIES,
        planModeActive: false,
        goalModeEnabled: false,
        hasConversationMessages: false,
        hasThread: false,
        canReview: false,
        subagentMode: false,
        sessionBusy: false,
        reasoningAvailable: false,
        showThreadActions: false,
        showNewSessionActions: true,
        canFork: false,
        hasProject: false,
        onOpenModel: () => {},
        onOpenReasoning: () => {},
        onOpenStatus: () => {
          opens += 1
        },
        onOpenReview: () => {},
      })
      commands = controls.commands
      executeCommand = controls.executeCommand
      return null
    }

    renderToStaticMarkup(<Harness />)
    const status = commands.find((command) => command.id === 'status')
    expect(status?.trigger).toBe('status')
    expect(await executeCommand!(status!)).toBe(true)
    expect(opens).toBe(1)
  })

  test('status panel renders its content only when mounted', () => {
    const html = renderToStaticMarkup(
      <ComposerStatusOverlay
        contextUsage={{ usedTokens: 20_000, contextWindow: 100_000, usedPercent: 20 }}
        routedSessionId="thread-1"
        selectedProviderID="anthropic"
        onClose={() => {}}
      />,
    )
    expect(html).toContain('状态与用量')
    expect(html).toContain('thread-1')
    expect(html).toContain('上下文容量')
    expect(html).not.toContain('上下文 · 剩余')
    expect(html).toContain('关闭')
    expect(html).not.toContain('lucide-x')
  })

  test('Coding 未选 workspace 时保留进入项目工作入口', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'coding' })} />,
    )
    expect(html).toContain('进入项目工作')
    expect(html).not.toContain('选择文件夹')
  })

  test('Coding 选中 workspace 后显示工作组、分支与项目行为', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'coding', workspace: WORKSPACE })} />,
    )
    expect(html).toContain('Alpha 工作区')
    expect(html).toContain('工作组')
    expect(html).toContain('feature/working-surface')
    expect(html).toContain('选择分支')
  })

  test('Chat 不渲染项目选择，但保留工作组、输入与提交结构', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'chat', workspace: WORKSPACE })} />,
    )
    expect(html).toContain('class="composer-bottom composer-utility-bar')
    expect(html).not.toContain('Alpha 工作区')
    expect(html).toContain('工作组')
    expect(html).toContain('composer-input-surface')
    expect(html).toContain('aria-label="发送"')
  })

  test('未协商 dictation capability 时不渲染听写入口', () => {
    const html = renderToStaticMarkup(<ComposerCard {...composerCardProps({ surface: 'chat' })} />)
    // The SSR shell never negotiates dictation; the enabled path is covered by
    // the dedicated dictation suite instead of a disabled SSR stub.
    expect(html).not.toContain('composer-mic-button')
    expect(html).not.toContain('语音输入尚未可用')
  })

  test('模型配置异常时只保留一个安静的配置入口', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          modelConfigured: false,
          modelPresets: [],
          providerOptions: [],
        })}
      />,
    )

    expect(html).not.toContain('未配置模型')
    expect(html).toContain('>配置模型<')
    expect(html).not.toContain('class="rm-empty"')
  })

  test('模型与推理强度渲染为统一入口', () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          modelConfigured: true,
          modelPresets: [{ id: 'claude-sonnet', label: 'Claude Sonnet', value: 'claude-sonnet' }],
          selectedModelPreset: 'claude-sonnet',
          showThinkingOptions: true,
          thinkingMode: 'adaptive',
          thinkingOptions: [
            { value: 'disabled', label: '低' },
            { value: 'default', label: '中' },
            { value: 'adaptive', label: '高' },
            { value: 'enabled', label: '超高' },
          ],
        })}
      />,
    )

    expect(html).toContain('composer-model-trigger-capsule')
    expect(html).toContain('>Claude Sonnet</span>')
    expect(html).toContain('composer-model-trigger-effort-wrap')
    expect(html).toContain('>高</span>')
    expect(html).toContain('aria-label="模型与推理设置：Claude Sonnet，高"')
    expect(html).not.toContain('composer-thinking-chip')
  })

  test('不支持思考等级时隐藏等级按钮并保留现有等级映射', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ showThinkingOptions: false })} />,
    )
    const regularOptions = composerCardProps().thinkingOptions
    const deepSeekOptions = resolveThinkingOptions(true, regularOptions)

    expect(html).not.toContain('composer-thinking-chip')
    expect(html).not.toContain('composer-model-trigger-effort-wrap')
    expect(resolveThinkingLabel(regularOptions, 'default')).toBe('默认')
    expect(deepSeekOptions.map((option) => option.label)).toEqual(['关闭', '高', '超高'])
    expect(resolveThinkingLabel(deepSeekOptions, 'enabled')).toBe('超高')
  })

  test('Working 选中 workspace 后显示工作区名称并隐藏 Local 和分支', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ surface: 'working', workspace: WORKSPACE })} />,
    )
    expect(html).toContain('Alpha 工作区')
    expect(html).not.toContain('本地')
    expect(html).not.toContain('feature/working-surface')
    expect(html).not.toContain('选择分支')
  })

  test('隐藏的已配置预设显示实际标签与不可用原因', () => {
    const reason = '“帮我批准”预设已在设置中关闭；当前配置保持不变。'
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          permissionMode: 'auto-review',
          permissionOptions: [
            { value: 'default', label: '请求批准' },
            {
              value: 'auto-review',
              label: '帮我批准',
              detail: reason,
              disabled: true,
            },
            { value: 'custom', label: '自定义' },
          ],
          permissionUnavailableReason: reason,
        })}
      />,
    )
    expect(html).toContain('帮我批准')
    expect(html).toContain('aria-label="选择权限模式"')
    expect(html).toContain(reason)
  })

  test('Composer 发送门禁不依赖 Git/Review 状态，非 Git 项目仍可提交', () => {
    expect(resolveComposerCanSubmit(canSubmitInput())).toBe(true)
    expect(
      resolveComposerCanSubmit(canSubmitInput({ placement: 'new-session', routedSessionId: null })),
    ).toBe(true)
    expect(
      resolveComposerCanSubmit(
        canSubmitInput({
          workingPluginSkillUnavailable: true,
          placement: 'new-session',
          routedSessionId: null,
        }),
      ),
    ).toBe(false)
  })

  test('模型未配置与空输入仍禁止提交', () => {
    expect(resolveComposerCanSubmit(canSubmitInput({ hasContent: false }))).toBe(false)
    expect(resolveComposerCanSubmit(canSubmitInput({ modelConfigured: false }))).toBe(false)
    expect(
      resolveComposerCanSubmit(canSubmitInput({ placement: 'thread', routedSessionId: null })),
    ).toBe(false)
    expect(resolveComposerCanSubmit(canSubmitInput({ isSubmitting: true }))).toBe(false)
    expect(resolveComposerCanSubmit(canSubmitInput({ hasAttachmentErrors: true }))).toBe(false)
  })

  test('submitDisabledReason 透传给发送按钮 title，且无内联错误 alert', () => {
    const errorMsg = '当前会话模型不可用：deepseek/deepseek-v4-flash，请检查提供商配置'
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          canSubmit: false,
          submitDisabledReason: errorMsg,
        })}
      />,
    )
    expect(html).toContain(errorMsg)
    expect(html).not.toContain('重新加载模型')
  })

  test('ComposerCard 底栏不再渲染模式切换、本地路由与电脑控制入口', () => {
    const html = renderToStaticMarkup(
      <ComposerCard {...composerCardProps({ routedSessionId: 'thread-1' })} />,
    )
    expect(html).not.toContain('composer-mode-trigger')
    expect(html).not.toContain('Pareto')
    expect(html).not.toContain('Fusion')
    expect(html).not.toContain('电脑控制中')
  })

  test('底栏断点读取 composer-footer 容器宽度并保留图标入口的无障碍名称', async () => {
    const html = renderToStaticMarkup(
      <ComposerCard
        {...composerCardProps({
          planModeActive: true,
          onPlanModeChange: () => {},
          showContextUsage: true,
          contextUsage: { usedTokens: 12_000, contextWindow: 200_000, usedPercent: 6 },
        })}
      />,
    )
    // 命名容器在工具栏自身，断点按底栏内容宽度生效。
    expect(html).toContain('tw:@container/composer-footer')
    // 权限与计划文字在 ≤475px 隐藏；次级箭头在 ≤420px 隐藏。
    const shell = await Bun.file(
      new URL('../src/styles/features/composer-shell.css', import.meta.url),
    ).text()
    expect(shell).toMatch(/@container composer-footer \(width <= 475px\)\s*\{\s*\.composer-footer-label\s*\{\s*display: none;/)
    expect(shell).toMatch(/@container composer-footer \(width <= 420px\)\s*\{\s*\.composer-footer-secondary-chevron\s*\{\s*display: none;/)
    expect(html).toContain('composer-footer-label')
    expect(html).toContain('composer-footer-secondary-chevron')
    // 隐藏文字后图标入口仍可操作且有无障碍名称。
    expect(html).toContain('aria-label="选择权限模式"')
    expect(html).toContain('aria-label="退出计划模式"')
    expect(html).toContain('aria-label="上下文窗口使用量：已用 6%，剩余 94%"')
    expect(html).toContain('aria-label="模型：未选择模型"')
  })
})

function canSubmitInput(
  overrides: Partial<Parameters<typeof resolveComposerCanSubmit>[0]> = {},
): Parameters<typeof resolveComposerCanSubmit>[0] {
  return {
    workingPluginSkillUnavailable: false,
    hasContent: true,
    hasAttachmentErrors: false,
    unsupportedAttachmentReason: null,
    modelConfigured: true,
    isSubmitting: false,
    placement: 'thread',
    routedSessionId: 'session-1',
    ...overrides,
  }
}
