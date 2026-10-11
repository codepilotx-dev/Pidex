import type React from 'react'
import type { DesktopSubagentRead } from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import {
  WorkbenchPanelError,
  WorkbenchPanelLoading,
  WorkbenchPanelUnavailable,
} from '../../layout/panels/WorkbenchPanelStates.js'
import { SubagentThreadPanel, type SubagentThreadCallbacks } from './SubagentThreadPanel.js'

type Props = {
  availability: 'loading' | 'available' | 'unavailable'
  error: string | null
  read: DesktopSubagentRead | null
  taskId: string | null
  onBack: () => void
  onOpenParentSubagent?: (taskId: string) => void
  onError: (message: string) => void
  onOpenPatchReview: (path?: string) => void
  onOpenSubagent: NonNullable<SubagentThreadCallbacks['onOpenSubagent']>
  onPatchApplied: () => void
  onRefresh: () => Promise<void>
}

export function SubagentDockContent({
  availability,
  error,
  read,
  taskId,
  onBack,
  onOpenParentSubagent,
  onError,
  onOpenPatchReview,
  onOpenSubagent,
  onPatchApplied,
  onRefresh,
}: Props): React.ReactNode {
  const runAction = async (
    action: (() => Promise<unknown>) | undefined,
    unavailableMessage: string,
  ): Promise<void> => {
    if (!action) {
      onError(unavailableMessage)
      return
    }
    try {
      await action()
      await onRefresh()
    } catch (actionError) {
      onError(actionError instanceof Error ? actionError.message : String(actionError))
    }
  }

  if (!taskId) return null
  if (availability === 'unavailable') {
    return (
      <WorkbenchPanelUnavailable
        title="子智能体工作台不可用"
        description="当前 Agent 没有协作子智能体能力。"
      />
    )
  }
  if (error) {
    return (
      <WorkbenchPanelError
        title="无法加载子智能体"
        message={error}
        retryable
        onRetry={() => void onRefresh().catch(() => undefined)}
      />
    )
  }
  if (!read?.currentRun) {
    return <WorkbenchPanelLoading label="正在加载子智能体…" />
  }

  const callbacks: SubagentThreadCallbacks = {
    onSend: async (message) => {
      if (!desktopClient.sendSubagent) throw new Error('当前 Agent 不支持补充要求。')
      await desktopClient.sendSubagent(read.task.id, message)
      await onRefresh()
    },
    onFollowup: async (message) => {
      if (!desktopClient.followupSubagent) throw new Error('当前 Agent 不支持后续任务。')
      await desktopClient.followupSubagent(read.task.id, message)
      await onRefresh()
    },
    onPatchApplied: async () => {
      await onRefresh()
      onPatchApplied()
    },
    onStop: (task) =>
      void runAction(
        desktopClient.stopSubagent ? () => desktopClient.stopSubagent!(task.id) : undefined,
        '当前 Agent 不支持停止子智能体。',
      ),
    onRetry: (task) =>
      void runAction(
        desktopClient.retrySubagent ? () => desktopClient.retrySubagent!(task.id) : undefined,
        '当前 Agent 不支持重试子智能体。',
      ),
    onApplyWorktree: (task) =>
      void runAction(
        desktopClient.applySubagentWorktree
          ? () => desktopClient.applySubagentWorktree!(task.id)
          : undefined,
        '当前 Agent 不支持应用子智能体工作树。',
      ),
    onDiscardWorktree: (task) =>
      void runAction(
        desktopClient.discardSubagentWorktree
          ? () => desktopClient.discardSubagentWorktree!(task.id)
          : undefined,
        '当前 Agent 不支持丢弃子智能体工作树。',
      ),
    onRestoreWorkspace: (task) =>
      void runAction(
        desktopClient.restoreSubagentWorkspace
          ? () => desktopClient.restoreSubagentWorkspace!(task.id)
          : undefined,
        '当前 Agent 不支持恢复子智能体工作区。',
      ),
    onOpenSubagent,
    onOpenPatchReview,
    onRequestRespond: async (request, behavior, alwaysAllow, updatedInput, extras) => {
      try {
        await desktopClient.respondToPermission(read.task.childThreadId, request.requestId, {
          behavior,
          alwaysAllow,
          updatedInput,
          ...extras,
        })
        await onRefresh()
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error))
        throw error
      }
    },
    onInterrupt: async () => {
      if (!desktopClient.stopSubagent) throw new Error('当前 Agent 不支持停止子智能体。')
      await desktopClient.stopSubagent(read.task.id)
      await onRefresh()
    },
  }

  return (
    <SubagentThreadPanel
      task={read.task}
      run={read.currentRun}
      snapshot={read.snapshot}
      capabilities={read.capabilities}
      callbacks={callbacks}
      onBackToParent={
        read.task.parentTaskId && onOpenParentSubagent
          ? () => onOpenParentSubagent(read.task.parentTaskId!)
          : onBack
      }
    />
  )
}
