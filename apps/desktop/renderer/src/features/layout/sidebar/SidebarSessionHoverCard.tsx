import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { ThreadPullRequestSummary } from '@pidex/shared/thread'
import {
  sessionDisplayTitle,
  sessionEditableTitle,
  sessionResolvedTitle,
  type SessionListItem,
} from '../../../UiTypes.js'
import { SidebarHoverCard } from './SidebarHoverCard.js'
import { SidebarSessionHoverCardOverlay } from './SidebarSessionHoverCardOverlay.js'
import { refreshThreadPullRequests } from './ThreadPullRequestStore.js'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

const WORKTREE_STATUS_LABEL: Record<string, string> = {
  creating: '创建中',
  ready: '可用',
  'ready-with-setup-error': '可用（初始化有错误）',
  deleting: '清理中',
  cleaned: '已清理',
  restoring: '恢复中',
  'restore-conflict': '恢复冲突',
}

export type SidebarSessionHoverCardModel = {
  title: string
  relativeTime: string
  projectLabel: string
  gitBranch: string | null
  /** 会话执行位置说明；无投影信息时为 null。 */
  environmentLabel: string | null
  environmentKind: 'local' | 'worktree' | null
  pullRequests: readonly ThreadPullRequestSummary[]
  unread: boolean
  isRunning: boolean
}

export function formatSidebarSessionRelativeTime(
  timestamp: string | null | undefined,
  now: number,
): string {
  const time = new Date(timestamp ?? '').getTime()
  if (Number.isNaN(time)) return '刚刚'

  const elapsed = Math.max(0, now - time)
  if (elapsed < MINUTE_MS) return '刚刚'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分`
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 小时`
  if (elapsed < MONTH_MS) return `${Math.floor(elapsed / DAY_MS)} 天`
  if (elapsed < YEAR_MS) return `${Math.floor(elapsed / MONTH_MS)} 月`
  return `${Math.floor(elapsed / YEAR_MS)} 年`
}

export function buildSidebarSessionHoverCardModel(
  session: SessionListItem,
  fallbackTitle: string | undefined,
  now: number,
  pullRequests: readonly ThreadPullRequestSummary[] = [],
): SidebarSessionHoverCardModel {
  const projectLabel = session.standalone ? '会话' : session.workspaceName.trim() || '会话'
  const gitBranch = session.gitBranch?.trim() || null
  const resolved = sessionResolvedTitle(session, fallbackTitle)?.trim()
  const environment = session.executionEnvironment ?? null
  const environmentLabel =
    environment === null
      ? null
      : environment.kind === 'local'
        ? '本地工作区'
        : `工作树 · ${WORKTREE_STATUS_LABEL[environment.status] ?? environment.status}`
  return {
    title: resolved || sessionDisplayTitle(session, fallbackTitle),
    relativeTime: formatSidebarSessionRelativeTime(session.lastMessageAt ?? session.createdAt, now),
    projectLabel,
    gitBranch,
    environmentLabel,
    environmentKind: environment?.kind ?? null,
    pullRequests,
    unread: Boolean(session.unreadAt),
    isRunning: session.status === 'running',
  }
}

type Props = {
  children: React.ReactElement
  fallbackTitle: string | undefined
  now: number
  pullRequests?: readonly ThreadPullRequestSummary[]
  regeneratingTitle: boolean
  session: SessionListItem
  onRename?: (title: string) => Promise<boolean>
  onUnlinkPullRequest?: (item: ThreadPullRequestSummary) => void
  /** 拖动排序期间不弹出悬浮卡，避免遮挡插入提示。 */
  suppressOpen?: boolean
}

export function SidebarSessionHoverCard({
  children,
  fallbackTitle,
  now,
  pullRequests = [],
  regeneratingTitle,
  session,
  onRename,
  onUnlinkPullRequest,
  suppressOpen = false,
}: Props): React.ReactNode {
  const model = buildSidebarSessionHoverCardModel(session, fallbackTitle, now, pullRequests)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [renameValue, setRenameValue] = useState(model.title)
  const [saving, setSaving] = useState(false)
  const [focusRequest, setFocusRequest] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)

  useEffect(() => {
    if (!editing) setRenameValue(model.title)
  }, [editing, model.title])

  // 悬浮卡打开时刷新一次过期数据；打开期间不做周期性刷新。
  useEffect(() => {
    if (!open) return
    void refreshThreadPullRequests([session.id])
  }, [open, session.id])

  // 开始拖动时关闭已打开的悬浮卡；拖动期间不再弹开。
  useEffect(() => {
    if (!suppressOpen) return
    setEditing(false)
    setOpen(false)
  }, [suppressOpen])

  // 标题重生成期间不渲染悬浮卡，但 hooks 必须无条件执行，否则标题状态翻转会改变 hook 顺序。
  if (regeneratingTitle) {
    return children
  }

  function startRename(): void {
    if (!onRename) return
    setRenameValue(sessionEditableTitle(session, fallbackTitle))
    setEditing(true)
    setOpen(true)
    setFocusRequest((current) => current + 1)
  }

  function cancelRename(): void {
    if (savingRef.current) return
    setRenameValue(model.title)
    setEditing(false)
    setOpen(false)
  }

  async function saveRename(returnFocusToAnchor: () => void): Promise<void> {
    const title = renameValue.trim()
    if (!onRename || savingRef.current || !title) return
    savingRef.current = true
    setSaving(true)
    try {
      const success = await onRename(title)
      if (!success) {
        refocusRenameInput(inputRef)
        return
      }
      setEditing(false)
      setOpen(false)
      returnFocusToAnchor()
    } catch {
      refocusRenameInput(inputRef)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <SidebarHoverCard
      lockOpen={editing || suppressOpen}
      open={open}
      onAnchorKeyDown={(event) => {
        if (event.key !== 'F2' || !onRename) return
        event.preventDefault()
        startRename()
      }}
      onOpenChange={setOpen}
      renderOverlay={(interactionProps) => (
        <SidebarSessionHoverCardOverlay
          {...interactionProps}
          editing={editing}
          focusRequest={focusRequest}
          inputRef={inputRef}
          model={model}
          regeneratingTitle={regeneratingTitle}
          renameValue={renameValue}
          saving={saving}
          onCancelRename={cancelRename}
          onFocusRequestHandled={() => setFocusRequest(0)}
          onRenameValueChange={setRenameValue}
          onSaveRename={() => void saveRename(interactionProps.returnFocusToAnchor)}
          onStartRename={startRename}
          onUnlinkPullRequest={onUnlinkPullRequest}
        />
      )}
    >
      {children}
    </SidebarHoverCard>
  )
}

function refocusRenameInput(inputRef: React.RefObject<HTMLInputElement | null>): void {
  requestAnimationFrame(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  })
}
