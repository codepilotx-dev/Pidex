import React from 'react'
import { Square } from 'lucide-react'
import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { formatSidebarSessionRelativeTime } from '../../layout/sidebar/SessionRelativeTime.js'
import {
  WorkbenchPanelError,
  WorkbenchPanelLoading,
} from '../../layout/panels/WorkbenchPanelStates.js'
import { useCanonicalThreadConversation } from '../timeline/UseCanonicalThreadConversation.js'
import { SubagentDockContent } from './SubagentDockContent.js'
import { buildSubagentDirectory, type SubagentDirectoryRow } from './SubagentDirectoryRows.js'
import { subagentAttentionLabel, subagentStatusLabel } from './SubagentStatusLabel.js'
import { SubagentAvatar } from './SubagentAvatar.js'
import { useSubagentRead } from './UseSubagentRead.js'

export type SubagentDirectoryPanelProps = {
  /** 父会话 canonical threadId；目录只展示该 thread 已加载的 projection。 */
  threadId: string
  selectedTaskId?: string
  /** 选中同一父 thread 内的任务；null 表示回到列表。 */
  onSelectTask: (taskId: string | null) => void
  /** 跨父 thread 导航（嵌套任务、父任务），由宿主解析所属目录。 */
  onOpenTask: (taskId: string) => void
  onOpenPatchReview: (path?: string) => void
  onError: (message: string) => void
  onRefreshDiff: () => void
}

/** 运行中每秒推进耗时；无运行项时不挂定时器。 */
function useRunningClock(running: boolean): number {
  const [now, setNow] = React.useState(Date.now)
  React.useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(interval)
  }, [running])
  return now
}

function formatElapsed(since: number | null, now: number): string {
  if (since == null) return '运行中'
  const seconds = Math.max(0, Math.floor((now - since) / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const ROW_CLASS =
  'tw:grid tw:min-w-0 tw:grid-cols-[24px_minmax(0,1fr)_max-content] tw:items-center tw:gap-2 tw:rounded-md tw:border-0 tw:bg-transparent tw:px-2 tw:py-2 tw:text-left tw:text-app-text tw:type-body tw:cursor-pointer tw:hover:bg-app-hover tw:focus-visible:outline-1 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus'

function DirectoryListRow({
  now,
  onOpen,
  onStop,
  row,
}: {
  now: number
  onOpen: (taskId: string) => void
  onStop: (taskId: string) => void
  row: SubagentDirectoryRow
}): React.ReactNode {
  // 头像取代了 Spinner/圆点，运行中状态改用文字表达。
  const attention = row.terminal
    ? subagentAttentionLabel(row.status)
    : (subagentAttentionLabel(row.status) ?? subagentStatusLabel(row.status))
  const trailing = row.terminal
    ? formatSidebarSessionRelativeTime(new Date(row.sortKey).toISOString(), now)
    : formatElapsed(row.runningSince, now)
  return (
    <div className="tw:grid tw:w-[calc(100%+16px)] tw:-mx-2 tw:grid-cols-[minmax(0,1fr)_max-content]">
      <button className={ROW_CLASS} type="button" onClick={() => onOpen(row.taskId)}>
        <SubagentAvatar role={row.role} size="md" />
        <span className="tw:grid tw:min-w-0">
          <span className="tw:flex tw:min-w-0 tw:items-baseline tw:gap-2">
            <strong className="tw:min-w-0 tw:truncate tw:type-weight-body">{row.name}</strong>
            {attention ? (
              <em className="tw:flex-none tw:not-italic tw:text-app-warning-fg tw:type-caption">
                {attention}
              </em>
            ) : null}
          </span>
          <small className="tw:min-w-0 tw:truncate tw:text-app-text-meta tw:type-caption">
            {row.summary}
          </small>
        </span>
        <small className="tw:flex-none tw:whitespace-nowrap tw:text-app-text-meta tw:tabular-nums tw:type-caption">
          {trailing}
        </small>
      </button>
      {row.terminal ? null : (
        <Tooltip content="停止该子智能体">
          <button
            aria-label={`停止 ${row.name}`}
            className="tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-app-text-meta tw:[font:inherit] tw:cursor-pointer tw:outline-none tw:hover:bg-app-hover tw:hover:text-app-danger tw:focus-visible:outline-1 tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus"
            type="button"
            onClick={() => onStop(row.taskId)}
          >
            <Square aria-hidden="true" size={APP_ICON_SIZES.sm} />
          </button>
        </Tooltip>
      )}
    </div>
  )
}

function DirectorySection({
  emptyText,
  now,
  onOpen,
  onStop,
  rows,
  title,
}: {
  emptyText: string
  now: number
  onOpen: (taskId: string) => void
  onStop: (taskId: string) => void
  rows: readonly SubagentDirectoryRow[]
  title: string
}): React.ReactNode {
  return (
    <section className="tw:grid tw:min-w-0 tw:gap-1 tw:pb-3">
      <h3 className="tw:m-0 tw:px-2 tw:py-1 tw:text-app-text-meta tw:type-caption">{title}</h3>
      {rows.length === 0 ? (
        <p className="tw:m-0 tw:px-2 tw:py-1 tw:text-app-text-meta tw:type-caption">{emptyText}</p>
      ) : (
        rows.map((row) => (
          <DirectoryListRow key={row.taskId} now={now} onOpen={onOpen} onStop={onStop} row={row} />
        ))
      )}
    </section>
  )
}

export function SubagentDirectoryPanel({
  threadId,
  selectedTaskId,
  onSelectTask,
  onOpenTask,
  onOpenPatchReview,
  onError,
  onRefreshDiff,
}: SubagentDirectoryPanelProps): React.ReactNode {
  const conversation = useCanonicalThreadConversation(threadId)
  const rows = React.useMemo(() => {
    const state = conversation.state
    if (!state) return { running: [], finished: [] }
    return buildSubagentDirectory([...state.subagentsByTaskId.values()], threadId)
  }, [conversation.state, threadId])
  const { running, finished } = rows
  const now = useRunningClock(running.length > 0)

  const detail = useSubagentRead(selectedTaskId ?? null)
  const { refresh } = detail

  const handleStop = React.useCallback(
    (taskId: string): void => {
      const stop = desktopClient.stopSubagent
      if (!stop) {
        onError('当前 Agent 不支持停止子智能体。')
        return
      }
      void stop.call(desktopClient, taskId)
        .then(() => refresh())
        .catch((error) => onError(error instanceof Error ? error.message : String(error)))
    },
    [onError, refresh],
  )

  if (selectedTaskId) {
    return (
      <SubagentDockContent
        availability={detail.availability}
        error={detail.error}
        onBack={() => onSelectTask(null)}
        onError={onError}
        onOpenParentSubagent={onOpenTask}
        onOpenPatchReview={onOpenPatchReview}
        onOpenSubagent={(item) => onOpenTask(item.subagentTaskId)}
        onPatchApplied={onRefreshDiff}
        onRefresh={refresh}
        read={detail.read}
        taskId={selectedTaskId}
      />
    )
  }

  if (conversation.error) {
    return (
      <WorkbenchPanelError
        message={conversation.error}
        retryable
        title="无法加载子智能体目录"
        onRetry={() => void conversation.reload().catch(() => undefined)}
      />
    )
  }
  if (conversation.loading && running.length + finished.length === 0) {
    return <WorkbenchPanelLoading label="正在加载子智能体…" />
  }

  return (
    <section
      aria-label="子智能体目录"
      className="tw:flex tw:w-full tw:h-full tw:min-h-0 tw:flex-col tw:overflow-y-auto tw:bg-app-panel tw:px-3 tw:py-3 tw:text-app-text"
    >
      <DirectorySection
        emptyText="没有正在运行的子智能体"
        now={now}
        onOpen={onSelectTask}
        onStop={handleStop}
        rows={running}
        title={`运行中 · ${running.length}`}
      />
      <DirectorySection
        emptyText="没有已结束的子智能体"
        now={now}
        onOpen={onSelectTask}
        onStop={handleStop}
        rows={finished}
        title={`已结束 · ${finished.length}`}
      />
    </section>
  )
}
