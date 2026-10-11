import { useCallback, useMemo, useRef, useState } from 'react'
import type { ComposerCapabilities } from './ComposerTypes.js'
import type { ComposerSlashCommand, ComposerSlashCommandId } from './ComposerSlashCommands.js'

type UseComposerSlashCommandsOptions = {
  capabilities: ComposerCapabilities
  planModeActive: boolean
  goalModeEnabled: boolean
  hasConversationMessages: boolean
  hasThread: boolean
  canReview: boolean
  subagentMode: boolean
  sessionBusy: boolean
  reasoningAvailable: boolean
  onOpenModel: () => void
  onOpenReasoning: () => void
  onOpenStatus: () => void
  onOpenMcp?: () => void
  onApprove?: () => void | Promise<void>
  onPlanModeChange?: (active: boolean) => void | Promise<void>
  onGoalModeChange?: (active: boolean) => void
  onOpenReview: () => void
  onCompact?: () => Promise<void>
  onOpenSide?: () => void
  onFork?: () => void
  onArchive?: () => void
  onChooseProject?: () => void
  onClearProject?: () => void
  showThreadActions: boolean
  showNewSessionActions: boolean
  canFork: boolean
  hasProject: boolean
  onError?: (message: string) => void
}

export function useComposerSlashCommands({
  capabilities,
  planModeActive,
  goalModeEnabled,
  hasConversationMessages,
  hasThread,
  canReview,
  subagentMode,
  sessionBusy,
  reasoningAvailable,
  onOpenModel,
  onOpenReasoning,
  onOpenStatus,
  onOpenMcp,
  onApprove,
  onPlanModeChange,
  onGoalModeChange,
  onOpenReview,
  onCompact,
  onOpenSide,
  onFork,
  onArchive,
  onChooseProject,
  onClearProject,
  showThreadActions,
  showNewSessionActions,
  canFork,
  hasProject,
  onError,
}: UseComposerSlashCommandsOptions): {
  commands: ComposerSlashCommand[]
  executingCommandId: ComposerSlashCommandId | null
  executeCommand: (command: ComposerSlashCommand) => Promise<boolean>
} {
  const executingRef = useRef<ComposerSlashCommandId | null>(null)
  const [executingCommandId, setExecutingCommandId] = useState<ComposerSlashCommandId | null>(null)

  const compactEnabled =
    hasThread && hasConversationMessages && !subagentMode && !sessionBusy && Boolean(onCompact)

  const commands = useMemo<ComposerSlashCommand[]>(
    () => [
      command(
        'approve',
        '重试被拒绝的操作',
        '为最近的自动审查拒绝授权一次重试，仍经过 Guardian',
        Boolean(onApprove),
        hasThread && !sessionBusy,
        () => onApprove?.(),
      ),
      command('model', '模型', '选择当前任务使用的模型', true, true, onOpenModel),
      command(
        'reasoning',
        '思考等级',
        '选择当前任务的思考等级',
        reasoningAvailable,
        reasoningAvailable,
        onOpenReasoning,
      ),
      command(
        'plan',
        '计划模式',
        planModeActive ? '关闭计划模式' : '开启计划模式',
        !subagentMode,
        Boolean(onPlanModeChange),
        async () => {
          await onPlanModeChange?.(!planModeActive)
          if (!planModeActive) onGoalModeChange?.(false)
        },
      ),
      command(
        'goal',
        '目标',
        goalModeEnabled ? '目标模式已开启' : '设置持续执行的目标',
        capabilities.goals && !subagentMode,
        Boolean(onGoalModeChange),
        async () => {
          if (planModeActive) await onPlanModeChange?.(false)
          if (!goalModeEnabled) onGoalModeChange?.(true)
        },
      ),
      command(
        'review',
        '代码审查',
        '审查未提交更改或与基础分支比较',
        capabilities.review && !subagentMode && hasThread,
        hasThread && canReview,
        onOpenReview,
        '请先创建任务后再开始代码审查',
      ),
      command(
        'compact',
        '压缩上下文',
        '压缩当前任务的上下文',
        hasThread && !subagentMode,
        compactEnabled,
        async () => onCompact?.(),
        hasThread
          ? hasConversationMessages
            ? sessionBusy
              ? '任务运行期间不能压缩上下文'
              : '当前无法压缩上下文'
            : '当前任务还没有可压缩的消息'
          : '请先创建任务后再压缩上下文',
      ),
      command(
        'mcp',
        'MCP',
        '查看 MCP 服务器状态',
        Boolean(onOpenMcp),
        Boolean(onOpenMcp),
        () => onOpenMcp?.(),
        '当前界面无法打开 MCP 设置',
      ),
      command(
        'status',
        '状态',
        '显示任务 ID、上下文用量和速率限制',
        capabilities.status,
        true,
        onOpenStatus,
      ),
      command(
        'side',
        '侧边聊天',
        '在侧边栏打开一个聊天',
        showThreadActions && Boolean(onOpenSide),
        Boolean(onOpenSide),
        () => onOpenSide?.(),
      ),
      command(
        'fork',
        '在新聊天中继续',
        '从当前任务的最新消息创建分支',
        showThreadActions,
        canFork && Boolean(onFork),
        () => onFork?.(),
        '当前任务还没有可继续的消息',
      ),
      command(
        'archive',
        '归档任务',
        '归档当前任务',
        showThreadActions && Boolean(onArchive),
        Boolean(onArchive),
        () => onArchive?.(),
      ),
      command(
        'project',
        '选择项目',
        '选择新任务关联的项目',
        showNewSessionActions,
        Boolean(onChooseProject),
        () => onChooseProject?.(),
      ),
      command(
        'task',
        '独立任务',
        hasProject ? '不在项目中运行此任务' : '当前已是独立任务',
        showNewSessionActions,
        hasProject && Boolean(onClearProject),
        () => onClearProject?.(),
        '当前已是独立任务',
      ),
    ],
    [
      capabilities.goals,
      capabilities.review,
      capabilities.status,
      canReview,
      compactEnabled,
      goalModeEnabled,
      hasConversationMessages,
      hasThread,
      onCompact,
      onOpenSide,
      onFork,
      onArchive,
      onChooseProject,
      onClearProject,
      onGoalModeChange,
      onOpenMcp,
      onApprove,
      onOpenModel,
      onOpenReasoning,
      onOpenReview,
      onOpenStatus,
      onPlanModeChange,
      planModeActive,
      reasoningAvailable,
      sessionBusy,
      subagentMode,
      showThreadActions,
      showNewSessionActions,
      canFork,
      hasProject,
    ],
  )

  const executeCommand = useCallback(
    async (selected: ComposerSlashCommand) => {
      if (!selected.availability.enabled || executingRef.current) return false
      executingRef.current = selected.id
      setExecutingCommandId(selected.id)
      try {
        await selected.execute()
        return true
      } catch (error) {
        onError?.(error instanceof Error ? error.message : String(error))
        return false
      } finally {
        executingRef.current = null
        setExecutingCommandId(null)
      }
    },
    [onError],
  )

  return { commands, executingCommandId, executeCommand }
}

function command(
  id: ComposerSlashCommandId,
  title: string,
  description: string,
  visible: boolean,
  enabled: boolean,
  execute: () => void | Promise<void>,
  disabledReason?: string,
): ComposerSlashCommand {
  return {
    id,
    trigger: id,
    title,
    description,
    source: 'builtin',
    availability: {
      visible,
      enabled,
      ...(disabledReason ? { disabledReason } : {}),
    },
    execute,
  }
}
