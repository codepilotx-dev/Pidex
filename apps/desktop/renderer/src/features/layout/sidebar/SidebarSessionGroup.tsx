import { chooseSessionGroupForThread } from '../../session-groups/SessionGroupActions.js'
import { buildThreadDeepLink } from '@pidex/shared/thread-reference'
import type React from 'react'
import { lazy, memo, Suspense, useEffect, useMemo, useId, useState } from 'react'
import {
  Archive,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  Folder,
  FolderInput,
  GitFork,
  GitPullRequest,
  Link,
  MessageCircle,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Split,
} from 'lucide-react'
import { SidebarDropList, useOptionalSidebarDrag } from './SidebarDragContext.js'
import { resolveSidebarDisplayOrder } from './SidebarDragRules.js'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { ProjectAppearanceGlyph } from '../../projects/ProjectAppearance.js'
import {
  sessionResolvedTitle,
  sessionEditableTitle,
  type SessionListItem,
} from '../../../UiTypes.js'
import { OverflowTitle as SidebarSessionTitle } from '../../../components/ui/OverflowTitle.js'
import { Button } from '../../../components/ui/Button.js'
import { useDisclosureContentExpanded } from '../../../components/ui/DisclosureContent.js'

import { Spinner } from '../../../components/ui/Spinner.js'
import { SkeletonBlock } from '../../../components/ui/Skeleton.js'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import { useHeightTransition } from '../../../hooks/UseHeightTransition.js'
import { sortSessionsForSidebar } from '../../session/state/SessionSorting.js'
import { SidebarRow } from '../../../components/ui/SidebarRow.js'
import { SidebarStatusPill } from './SidebarStatusPill.js'
import { SidebarReorderItem } from './SidebarReorderItem.js'
import {
  createSidebarSessionPagingState,
  setSidebarSessionVisibleLimit,
  syncSidebarSessionPaging,
} from './SidebarSessionPaging.js'
import { useEverOpened } from '../../../hooks/UsePresenceRetention.js'
import { cx } from '../../../utils/Cx.js'
import {
  AppContextMenu as SidebarContextMenu,
  type AppContextMenuAction as ContextMenuAction,
} from '../../../components/ui/AppContextMenu.js'
import type { DesktopSidebarSort } from '../../../../shared/Types.js'
import { deriveSidebarSessionVisualState, sidebarSessionProjectKey } from './SidebarViewModel.js'
import { desktopClient, desktopClipboard } from '../../../services/desktop-client/index.js'
import { InputDialog } from '../../../components/ui/ConfirmationDialog.js'
import { useSidebarActivityPreview } from './UseSidebarActivityPreview.js'
import type { ThreadPullRequestSummary } from '@pidex/shared/thread'
import {
  applyThreadPullRequestList,
  useThreadPullRequestEnvironments,
  useThreadPullRequestLifecycle,
  useThreadPullRequests,
} from './ThreadPullRequestStore.js'
import {
  threadPullRequestIcon,
  threadPullRequestTitle,
  threadPullRequestVisual,
} from './ThreadPullRequestPresentation.js'

const NO_PULL_REQUESTS: readonly ThreadPullRequestSummary[] = []

const SidebarSessionHoverCard = lazy(async () => {
  const module = await import('./SidebarSessionHoverCard.js')
  return { default: module.SidebarSessionHoverCard }
})

const GROUP_LIMIT = 5

type Props = {
  activeSessionId: string | null
  groupKey: string
  now: number
  pendingPermissionSessionIds: ReadonlySet<string>
  titleLoadingIds: ReadonlySet<string>
  sessionFallbackTitles: Record<string, string>
  sessions: SessionListItem[]
  showConversationIcon?: boolean
  /** 'preserve' 表示调用方已排好序，不再重排（时间线优先任务组使用） */
  sort?: DesktopSidebarSort | 'preserve'
  manualOrderByScope?: Record<string, string[]>
  presentation?: 'compact' | 'workspace-meta' | 'activity'
  /** 标准区域会话行统一右缩进；时间线与“最近”分组沿用 8px gutter。 */
  sessionIndent?: 'content' | 'gutter'
  pagination?: 'incremental' | 'all'
  /** 分组内首行的全局拖放序号基准，便于跨容器计算插入位置。 */
  dropIndexBase?: number
  /** 列表默认显示条数；聊天列表 10，项目与自定义分组沿用调用方设置。 */
  initialLimit?: number
  /** 每次展开增加的条数；未指定时沿用默认显示条数。 */
  pageSize?: number
  /** 可供“移动到分组”选择的自定义分组。 */
  customSections?: readonly { id: string; title: string }[]
  /** 当前会话所属的自定义分组；不在任何分组时为 null。 */
  currentSectionId?: string | null
  /** 全部源目录都不可用的项目键集合；命中时标题转灰。 */
  unavailableProjectKeys?: ReadonlySet<string>
  onMoveToSection?: (sessionId: string, sectionId: string) => void
  onMoveToDefault?: (sessionId: string) => void
  onArchiveSessions: (sessions: readonly SessionListItem[]) => Promise<boolean>
  onManualOrderChange?: (scopeKey: string, order: string[]) => void
  onPinSession: (session: SessionListItem) => void
  onSelectSession: (session: SessionListItem) => void
  onToggleSessionUnread: (session: SessionListItem) => void
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>
  onSortChange?: (sort: 'manual') => void
  onUnpinSession: (session: SessionListItem) => void
}

function SidebarSessionGroupComponent({
  activeSessionId,
  groupKey,
  now,
  pendingPermissionSessionIds,
  titleLoadingIds,
  sessionFallbackTitles,
  sessions,
  showConversationIcon = false,
  sort = 'priority',
  manualOrderByScope = {},
  presentation = 'compact',
  sessionIndent = 'content',
  pagination = 'incremental',
  dropIndexBase = 0,
  initialLimit = GROUP_LIMIT,
  pageSize = initialLimit,
  customSections = [],
  currentSectionId = null,
  unavailableProjectKeys,
  onMoveToSection,
  onMoveToDefault,
  onArchiveSessions,
  onManualOrderChange,
  onPinSession,
  onSelectSession,
  onToggleSessionUnread,
  onRenameSession,
  onSortChange,
  onUnpinSession,
}: Props): React.ReactNode {
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null)
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null)
  const [confirmArchiveSessionId, setConfirmArchiveSessionId] = useState<string | null>(null)
  const [paging, setPaging] = useState(() =>
    createSidebarSessionPagingState({ groupKey, initialLimit }),
  )
  const visibleLimit = paging.visibleLimit
  const [renameSession, setRenameSession] = useState<SessionListItem | null>(null)
  const renameDialogMounted = useEverOpened(renameSession !== null)
  const [renameValue, setRenameValue] = useState('')
  const [renaming, setRenaming] = useState(false)
  const drag = useOptionalSidebarDrag()
  const instanceId = useId()
  const [linkSessionId, setLinkSessionId] = useState<string | null>(null)
  const [linkValue, setLinkValue] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const reducedMotion = usePrefersReducedMotion()
  const needsInputSessionIds = pendingPermissionSessionIds
  const unreadSessionIds = useMemo(
    () => new Set(sessions.filter((session) => session.unreadAt).map((session) => session.id)),
    [sessions],
  )
  const sortedSessions = useMemo(
    () =>
      sort === 'preserve'
        ? sessions
        : sortSessionsForSidebar(sessions, {
            sort,
            needsInputSessionIds,
            unreadSessionIds,
            scopeKey: groupKey,
            manualOrderByScope,
          }),
    [groupKey, manualOrderByScope, needsInputSessionIds, sessions, sort, unreadSessionIds],
  )
  const orderKeys = resolveSidebarDisplayOrder(drag?.session ?? null, {
    containerKey: groupKey,
    order: sortedSessions.map((session) => `session:${session.id}`),
  })
  const orderedSessions = [...sortedSessions].sort(
    (left, right) =>
      orderKeys.indexOf(`session:${left.id}`) - orderKeys.indexOf(`session:${right.id}`),
  )
  const { baseSessions, canCollapse, canShowMore, extraSessions, hasOverflow } =
    getSidebarSessionDisplayGroups(orderedSessions, visibleLimit, initialLimit)
  const extraSessionIds = useMemo(
    () => new Set(extraSessions.map((session) => session.id)),
    [extraSessions],
  )
  /** 所在折叠区域收起时回到默认分页；不在折叠区域内（例如独立渲染）时按展开处理。 */
  const disclosureExpanded = useDisclosureContentExpanded() ?? true
  const visibleSessions =
    pagination === 'all' ? orderedSessions : [...baseSessions, ...extraSessions]
  /**
   * 只订阅展开且处于当前分页内的会话：折叠区域收起或会话被分页隐藏时
   * 不再请求 PR 状态，也不会占用后台刷新周期。
   */
  const displayedSessions = useMemo(
    () =>
      displayedSidebarSessions(
        disclosureExpanded,
        { baseSessions, extraSessions },
        pagination === 'all' ? orderedSessions : undefined,
      ),
    [baseSessions, disclosureExpanded, extraSessions, orderedSessions, pagination],
  )
  const displayedSessionIds = useMemo(
    () => displayedSessions.map((session) => session.id),
    [displayedSessions],
  )
  const pullRequests = useThreadPullRequests(displayedSessionIds)
  useThreadPullRequestLifecycle()
  useThreadPullRequestEnvironments(
    useMemo(
      () =>
        displayedSessions.map((session) => ({
          threadId: session.id,
          cwd: session.executionEnvironment?.cwd ?? session.workspacePath,
          revision: session.executionEnvironment?.revision,
          branch: session.gitBranch,
        })),
      [displayedSessions],
    ),
  )

  function updateVisibleLimit(resolution: number | ((visibleLimit: number) => number)): void {
    setPaging((current) => setSidebarSessionVisibleLimit(current, resolution))
  }

  useEffect(() => {
    if (pagination === 'all') return
    setPaging((current) =>
      syncSidebarSessionPaging(current, { disclosureExpanded, groupKey, initialLimit }),
    )
  }, [disclosureExpanded, groupKey, initialLimit, pagination])

  async function unlinkPullRequest(
    threadId: string,
    item: ThreadPullRequestSummary,
  ): Promise<void> {
    const result = await desktopClient.unlinkThreadPullRequest({
      threadId,
      owner: item.owner,
      repository: item.repository,
      number: item.number,
    })
    if (result.ok === true) applyThreadPullRequestList(result.thread)
  }

  async function submitPullRequestLink(): Promise<void> {
    if (!linkSessionId || linking) return
    const url = linkValue.trim()
    if (!url) return
    setLinking(true)
    setLinkError(null)
    try {
      const result = await desktopClient.linkThreadPullRequest({ threadId: linkSessionId, url })
      if (result.ok === false) {
        setLinkError(result.error)
        return
      }
      applyThreadPullRequestList(result.thread)
      setLinkSessionId(null)
    } finally {
      setLinking(false)
    }
  }

  function persistManualOrder(order: string[]): void {
    if (!onManualOrderChange) return
    onManualOrderChange(groupKey, order)
    if (sort !== 'manual') onSortChange?.('manual')
  }

  function moveSessionByKeyboard(sessionId: string, offset: -1 | 1): void {
    if (!onManualOrderChange) return
    const order = orderedSessions.map((session) => session.id)
    const currentIndex = order.indexOf(sessionId)
    const nextIndex = currentIndex + offset
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= order.length) {
      return
    }
    const [moved] = order.splice(currentIndex, 1)
    if (!moved) return
    order.splice(nextIndex, 0, moved)
    updateVisibleLimit((current) => Math.max(current, nextIndex + 1))
    persistManualOrder(order)
  }

  function getSessionContextMenuActions(session: SessionListItem): ContextMenuAction[] {
    const actions: Array<ContextMenuAction | null> = [
      {
        kind: 'item',
        label:
          session.status === 'running' ||
          session.status === 'waiting' ||
          session.status === 'queued'
            ? '当前 Turn 结束后可切换'
            : (session.workflowId ?? session.sessionGroupId)
              ? '切换或移出工作组'
              : '加入工作组',
        disabled:
          session.status === 'running' ||
          session.status === 'waiting' ||
          session.status === 'queued',
        onSelect: () => {
          void chooseSessionGroupForThread(session.id)
        },
      },
      { kind: 'separator' },
      {
        kind: 'item',
        label: '重命名',
        icon: <Pencil size={APP_ICON_SIZE} />,
        onSelect: () => {
          setRenameSession(session)
          setRenameValue(sessionEditableTitle(session, sessionFallbackTitles[session.id]))
        },
      },
      {
        kind: 'item',
        label: '复制会话 ID',
        icon: <Copy size={APP_ICON_SIZE} />,
        onSelect: () => {
          void desktopClipboard.writeText(session.id)
        },
      },
      {
        kind: 'item',
        label: '复制会话链接',
        icon: <Link size={APP_ICON_SIZE} />,
        onSelect: () => {
          void desktopClipboard.writeText(buildThreadDeepLink(session.id))
        },
      },
      session.workspacePath
        ? {
            kind: 'item' as const,
            label: '复制工作目录',
            icon: <Folder size={APP_ICON_SIZE} />,
            onSelect: () => {
              void desktopClipboard.writeText(session.workspacePath)
            },
          }
        : null,
      {
        kind: 'item',
        label: sessionReadStatusActionLabel(session),
        icon: session.unreadAt ? <Eye size={APP_ICON_SIZE} /> : <EyeOff size={APP_ICON_SIZE} />,
        onSelect: () => onToggleSessionUnread(session),
      },
      pullRequests.supported === false
        ? null
        : {
            kind: 'item' as const,
            label: '关联 Pull Request',
            icon: <GitPullRequest size={APP_ICON_SIZE} />,
            onSelect: () => {
              setLinkValue('')
              setLinkError(null)
              setLinkSessionId(session.id)
            },
          },
      { kind: 'separator' },
      session.pinnedAt
        ? {
            kind: 'item' as const,
            label: '取消置顶',
            icon: <PinOff size={APP_ICON_SIZE} />,
            onSelect: () => onUnpinSession(session),
          }
        : {
            kind: 'item' as const,
            label: '置顶',
            icon: <Pin size={APP_ICON_SIZE} />,
            onSelect: () => onPinSession(session),
          },
      {
        kind: 'item',
        label: '归档',
        icon: <Archive size={APP_ICON_SIZE} />,
        onSelect: () => setConfirmArchiveSessionId(session.id),
      },
      { kind: 'separator' },
      {
        kind: 'sub',
        label: '移动到分组',
        icon: <FolderInput size={APP_ICON_SIZE} />,
        layout: 'flex',
        children: buildMoveToSectionActions(session),
      },
    ]
    return actions.filter((action): action is ContextMenuAction => action !== null)
  }

  function buildMoveToSectionActions(session: SessionListItem): ContextMenuAction[] {
    const actions: ContextMenuAction[] = [
      {
        kind: 'item',
        label: session.pinnedAt ? '已置顶' : '置顶',
        disabled: Boolean(session.pinnedAt),
        onSelect: () => onPinSession(session),
      },
    ]
    for (const section of customSections) {
      actions.push({
        kind: 'item',
        label: section.title,
        disabled: currentSectionId === section.id,
        onSelect: () => onMoveToSection?.(session.id, section.id),
      })
    }
    actions.push({
      kind: 'item',
      label: '默认区域',
      disabled: !currentSectionId && !session.pinnedAt,
      onSelect: () => {
        if (session.pinnedAt) onUnpinSession(session)
        onMoveToDefault?.(session.id)
      },
    })
    return actions
  }

  function renderSessionRow(session: SessionListItem, rowIndex: number): React.ReactNode {
    const regeneratingTitle = titleLoadingIds.has(session.id)
    const visualState = deriveSidebarSessionVisualState(session, pendingPermissionSessionIds)
    const pullRequestItems = pullRequests.byThread.get(session.id) ?? NO_PULL_REQUESTS
    const primaryPullRequest =
      pullRequestItems.find((item) => item.primary) ?? pullRequestItems[0] ?? null
    const primaryPullRequestVisual = primaryPullRequest
      ? threadPullRequestVisual(primaryPullRequest.status)
      : null
    const PrimaryPullRequestIcon = primaryPullRequest
      ? threadPullRequestIcon(primaryPullRequest.status)
      : null
    const waitingForInput =
      visualState === 'needs-input' &&
      !pendingPermissionSessionIds.has(session.id) &&
      session.latestTurnStatus === 'waiting-question'
    const hideInputPill = waitingForInput && session.id === activeSessionId
    const indicatorState = hideInputPill ? (session.unreadAt ? 'unread' : 'idle') : visualState
    const showActions = hoveredSessionId === session.id || focusedSessionId === session.id
    const showIndicators = !showActions && confirmArchiveSessionId !== session.id
    const projectUnavailable = Boolean(
      unavailableProjectKeys?.has(sidebarSessionProjectKey(session)),
    )
    const metaClassName = cx(
      'sidebar-session-meta',
      'tw:flex',
      'tw:items-center',
      'tw:justify-end',
      'tw:w-auto',
      'tw:min-w-0 tw:gap-1',
      indicatorState === 'needs-input' && 'sidebar-session-meta--approval',
      confirmArchiveSessionId === session.id && 'confirming-archive',
    )
    // 双行（标题 + 工作区）行高由两行内容决定，时间线行沿用 48px 基准。
    const rowHeightClass = presentation !== 'compact' ? 'tw:[--sidebar-row-height:48px]' : null
    const sessionButton = (
      <button
        aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
        className="sidebar-session-button tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2 tw:bg-transparent tw:py-1 tw:text-left tw:text-inherit tw:focus-visible:outline-none"
        onClick={() => {
          onSelectSession(session)
        }}
        onKeyDown={(event) => {
          if (
            drag?.isDragging ||
            !event.altKey ||
            (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')
          ) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          moveSessionByKeyboard(session.id, event.key === 'ArrowUp' ? -1 : 1)
        }}
        type="button"
      >
        <span
          className={cx(
            'sidebar-session-button-lines tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:items-stretch tw:justify-center',
            presentation !== 'compact' && 'sidebar-session-button-lines--meta tw:gap-1',
          )}
        >
          {regeneratingTitle ? (
            <SkeletonBlock
              className="sidebar-session-title sidebar-session-title--loading tw:h-[var(--cpx-sys-font-size-sm)] tw:max-h-[var(--cpx-sys-font-size-sm)] tw:min-h-[var(--cpx-sys-font-size-sm)] tw:w-[min(7.5rem,72%)] tw:flex-none tw:rounded-sm"
              label="正在更新会话标题"
            />
          ) : (
            <SidebarSessionTitle
              active={hoveredSessionId === session.id || focusedSessionId === session.id}
              presentation={presentation}
              reducedMotion={reducedMotion}
            >
              {sessionResolvedTitle(session, sessionFallbackTitles[session.id])}
            </SidebarSessionTitle>
          )}
          {presentation === 'workspace-meta' ? <SidebarSessionSubtitle session={session} /> : null}
          {presentation === 'activity' ? <SidebarActivitySubtitle session={session} /> : null}
        </span>
      </button>
    )
    const rowContent = (
      <Suspense fallback={sessionButton}>
        {regeneratingTitle ? (
          sessionButton
        ) : (
          <SidebarSessionHoverCard
            fallbackTitle={sessionFallbackTitles[session.id]}
            now={now}
            pullRequests={pullRequestItems}
            regeneratingTitle={regeneratingTitle}
            session={session}
            onRename={(title) => onRenameSession(session.id, title)}
            onUnlinkPullRequest={(item) => void unlinkPullRequest(session.id, item)}
            suppressOpen={drag?.isDragging ?? false}
          >
            {sessionButton}
          </SidebarSessionHoverCard>
        )}
      </Suspense>
    )
    const row = (
      <SidebarRow
        active={session.id === activeSessionId}
        asChild
        className={cx(
          'sidebar-session-row tw:[&>.sidebar-row-trailing]:w-auto',
          rowHeightClass,
          projectUnavailable &&
            'sidebar-session-row--project-unavailable tw:[&_.sidebar-session-title]:text-app-text-disabled',
        )}
        data-sidebar-session-id={session.id}
        indent={showConversationIcon || sessionIndent === 'gutter' ? 'none' : 'session'}
        layout="grid"
        leading={
          showConversationIcon ? (
            <MessageCircle aria-hidden="true" size={APP_ICON_SIZE} />
          ) : undefined
        }
        leadingMode={showConversationIcon ? 'icon' : sessionIndent === 'gutter' ? 'none' : 'spacer'}
        onMouseOver={(event) => {
          if (!event.currentTarget.contains(event.target as Node)) return
          setHoveredSessionId(session.id)
        }}
        onMouseOut={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setHoveredSessionId((current) => (current === session.id ? null : current))
          setConfirmArchiveSessionId((current) => (current === session.id ? null : current))
        }}
        onFocusCapture={(event) => {
          if (!event.currentTarget.contains(event.target as Node)) return
          setFocusedSessionId(event.target.matches(':focus-visible') ? session.id : null)
        }}
        onBlurCapture={(event) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
          setFocusedSessionId((current) => (current === session.id ? null : current))
        }}
        trailing={
          <div className={metaClassName}>
            {showIndicators && session.executionEnvironment?.kind === 'worktree' && (
              <span
                className="sidebar-indicator tw:inline-flex tw:size-6 tw:flex-none tw:items-center tw:justify-center tw:text-app-text-meta tw:[&>svg]:size-icon-md"
                role="img"
                aria-label="工作树会话"
                title="工作树会话"
              >
                <GitFork aria-hidden="true" size={APP_ICON_SIZE} />
              </span>
            )}
            {showIndicators && session.isFork && (
              <span
                className="sidebar-indicator tw:inline-flex tw:size-6 tw:flex-none tw:items-center tw:justify-center tw:text-app-text-meta tw:[&>svg]:size-icon-md"
                role="img"
                aria-label="分叉会话"
                title="分叉会话"
              >
                <Split aria-hidden="true" size={APP_ICON_SIZE} />
              </span>
            )}
            {showIndicators && session.hasScheduledRun && (
              <span
                className="sidebar-indicator tw:inline-flex tw:size-6 tw:flex-none tw:items-center tw:justify-center tw:text-app-text-meta tw:[&>svg]:size-icon-md"
                role="img"
                aria-label="日程运行过的会话"
                title="日程运行过的会话"
              >
                <Clock3 aria-hidden="true" size={APP_ICON_SIZE} />
              </span>
            )}
            {showIndicators && primaryPullRequest && PrimaryPullRequestIcon && (
              <button
                aria-label={`Pull Request #${primaryPullRequest.number}`}
                className={cx(
                  'sidebar-indicator sidebar-pull-request tw:inline-flex tw:size-6 tw:flex-none tw:cursor-pointer tw:items-center tw:justify-center tw:border-0 tw:bg-transparent tw:p-0 tw:[&>svg]:size-icon-md',
                  primaryPullRequestVisual?.className,
                )}
                title={threadPullRequestTitle(
                  primaryPullRequest.number,
                  primaryPullRequest.title,
                  primaryPullRequest.status,
                )}
                type="button"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void desktopClient.openExternalURL(primaryPullRequest.url)
                }}
              >
                <PrimaryPullRequestIcon aria-hidden="true" size={APP_ICON_SIZE} />
              </button>
            )}
            {confirmArchiveSessionId === session.id ? (
              <button
                className="sidebar-session-confirm-archive-button tw:w-full tw:rounded-md tw:bg-app-danger-subtle tw:px-2 tw:text-app-danger tw:whitespace-nowrap tw:[line-height:var(--cpx-sys-line-height-tight)]"
                onClick={() => void onArchiveSessions([session])}
                title="确认归档"
                type="button"
              >
                确认
              </button>
            ) : showActions ? (
              <div className="sidebar-session-actions tw:flex tw:w-full tw:items-center tw:justify-end tw:gap-1">
                {session.pinnedAt ? (
                  <Button
                    isIconOnly
                    className="sidebar-session-action-button"
                    variant="text"
                    iconSize="md"
                    onClick={() => onUnpinSession(session)}
                    size="compact"
                    title="取消置顶"
                  >
                    <PinOff size={APP_ICON_SIZE} />
                  </Button>
                ) : (
                  <Button
                    isIconOnly
                    className="sidebar-session-action-button"
                    variant="text"
                    iconSize="md"
                    onClick={() => onPinSession(session)}
                    size="compact"
                    title="置顶"
                  >
                    <Pin size={APP_ICON_SIZE} />
                  </Button>
                )}
                <Button
                  isIconOnly
                  className="sidebar-session-action-button"
                  variant="text"
                  iconSize="md"
                  onClick={() => setConfirmArchiveSessionId(session.id)}
                  size="compact"
                  title="归档"
                >
                  <Archive size={APP_ICON_SIZE} />
                </Button>
              </div>
            ) : indicatorState === 'needs-input' ? (
              <SidebarStatusPill kind={waitingForInput ? 'input' : 'approval'} />
            ) : indicatorState === 'unread' || indicatorState === 'running' ? (
              <span className="sidebar-indicator tw:inline-flex tw:size-6 tw:flex-none tw:items-center tw:justify-center tw:text-app-text-meta tw:[&>svg]:size-icon-md">
                <span className="sidebar-status-icon tw:inline-flex tw:size-5 tw:shrink-0 tw:items-center tw:justify-center">
                  {indicatorState === 'unread' ? (
                    <span
                      aria-label="未读"
                      className="sidebar-unread-dot tw:size-2 tw:flex-none tw:rounded-full tw:bg-app-accent"
                    />
                  ) : indicatorState === 'running' ? (
                    <Spinner
                      className={cx(
                        'sidebar-session-spinner tw:text-app-text/70',
                        reducedMotion && 'tw:animate-none',
                      )}
                      label="处理中"
                      size="medium"
                    />
                  ) : null}
                </span>
              </span>
            ) : null}
          </div>
        }
      >
        {onManualOrderChange ? (
          <SidebarReorderItem
            as="li"
            value={`session:${session.id}`}
            {...{
              'data-sidebar-drop-index': dropIndexBase + rowIndex,
              'data-sidebar-session-extra': extraSessionIds.has(session.id) || undefined,
            }}
            reducedMotion={reducedMotion}
          >
            {rowContent}
          </SidebarReorderItem>
        ) : (
          <li>{rowContent}</li>
        )}
      </SidebarRow>
    )
    return (
      <SidebarContextMenu
        key={session.id}
        actions={getSessionContextMenuActions(session)}
        layout="grid"
        size="sm"
        trigger={row}
      />
    )
  }

  const sessionListClassName =
    'sidebar-session-list tw:m-0 tw:flex tw:list-none tw:flex-col tw:sidebar-row-gap tw:p-0'
  const sessionRows = visibleSessions.map((session, index) => renderSessionRow(session, index))
  const visibleSessionKey = visibleSessions.map((session) => session.id).join('\u0000')
  const heightTransition = useHeightTransition([
    visibleSessionKey,
    hasOverflow,
    canShowMore,
    canCollapse,
  ])

  return (
    <div
      className="sidebar-session-group tw:min-w-0 tw:transition-[height] tw:duration-disclosure tw:ease-disclosure"
      ref={heightTransition.ref}
      style={heightTransition.style}
    >
      {onManualOrderChange && drag ? (
        <SidebarDropList
          as="ul"
          className={sessionListClassName}
          list={{
            key: groupKey,
            instanceId,
            destination: groupKey.startsWith('project:')
              ? { kind: 'project', projectKey: groupKey.slice(8), index: 0 }
              : { kind: 'default', index: 0 },
            order: orderedSessions.map((session) => `session:${session.id}`),
            sessionKeys: groupKey.startsWith('project:')
              ? sessions.map((session) => `session:${session.id}`)
              : undefined,
            onReorder: (order) =>
              persistManualOrder(
                order.filter((key) => key.startsWith('session:')).map((key) => key.slice(8)),
              ),
          }}
        >
          {sessionRows}
        </SidebarDropList>
      ) : (
        <ul className={sessionListClassName}>{sessionRows}</ul>
      )}
      {pagination !== 'all' ? (
        <>
          {hasOverflow ? (
            <div
              className={cx(
                'sidebar-show-more-actions tw:grid tw:w-full tw:box-border tw:min-h-7 tw:items-center tw:gap-x-2 tw:rounded-md tw:px-2 tw:py-1 tw:text-left tw:text-app-text-meta tw:type-control tw:no-underline tw:transition-[background-color,box-shadow,color] tw:duration-feedback tw:ease-standard',
                sessionIndent === 'gutter' && !showConversationIcon
                  ? 'tw:grid-cols-[minmax(0,1fr)_auto]'
                  : 'tw:grid-cols-[var(--sidebar-row-columns)]',
              )}
            >
              {sessionIndent !== 'gutter' || showConversationIcon ? (
                <span
                  aria-hidden="true"
                  className="sidebar-row-leading sidebar-row-leading-spacer tw:flex tw:size-6 tw:w-6 tw:min-w-6 tw:shrink-0 tw:grow-0 tw:basis-6 tw:items-center tw:justify-center"
                />
              ) : null}
              <div
                className={cx(
                  'sidebar-row-main',
                  'tw:min-w-0',
                  'tw:flex',
                  'tw:items-center',
                  'tw:gap-4',
                )}
              >
                {canShowMore ? (
                  <Button
                    aria-expanded={canCollapse}
                    className="tw:w-auto sidebar-show-more-button tw:first:-ml-2 tw:min-w-0 tw:border-0 tw:[font:inherit]"
                    variant="text"
                    onClick={() =>
                      updateVisibleLimit((current) => Math.min(current + pageSize, sessions.length))
                    }
                    size="compact"
                    type="button"
                  >
                    <span className="tw:block tw:overflow-hidden tw:whitespace-nowrap">
                      展开显示
                    </span>
                  </Button>
                ) : null}
                {canCollapse ? (
                  <Button
                    className="tw:w-auto sidebar-show-more-button tw:first:-ml-2 tw:min-w-0 tw:border-0 tw:[font:inherit]"
                    onClick={() => updateVisibleLimit(initialLimit)}
                    variant="text"
                    size="compact"
                    type="button"
                  >
                    <span className="tw:block tw:overflow-hidden tw:whitespace-nowrap">
                      折叠显示
                    </span>
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {linkSessionId !== null ? (
        <Suspense fallback={null}>
          <InputDialog
            actionDisabled={linking || linkValue.trim().length === 0}
            actionLabel={linking ? '关联中…' : '关联'}
            description={linkError ?? '输入 github.com 上的 Pull Request 链接。'}
            input={{
              value: linkValue,
              onChange: setLinkValue,
              maxLength: 500,
              placeholder: 'https://github.com/owner/repo/pull/123',
            }}
            open
            title="关联 Pull Request"
            onAction={() => void submitPullRequestLink()}
            onCancel={() => {
              if (linking) return
              setLinkSessionId(null)
              setLinkError(null)
            }}
          />
        </Suspense>
      ) : null}
      {renameDialogMounted ? (
        <Suspense fallback={null}>
          <InputDialog
            actionDisabled={renaming || renameValue.trim().length === 0}
            actionLabel={renaming ? '重命名中…' : '重命名'}
            description="输入新的对话名称。"
            input={{
              value: renameValue,
              onChange: setRenameValue,
              maxLength: 160,
              placeholder: '输入对话名称',
            }}
            open={renameSession !== null}
            title="重命名对话"
            onAction={() => {
              if (!renameSession || renaming) return
              setRenaming(true)
              void onRenameSession(renameSession.id, renameValue).then((success) => {
                setRenaming(false)
                if (success) setRenameSession(null)
              })
            }}
            onCancel={() => {
              if (renaming) return
              setRenameSession(null)
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

export const SidebarSessionGroup = memo(SidebarSessionGroupComponent)

/**
 * 当前展示范围：折叠区域收起时为空。侧栏 PR 标记只为这里的会话订阅刷新，
 * 被分页隐藏或折叠的会话不请求、也不占用后台周期。
 */
export function displayedSidebarSessions<T>(
  expanded: boolean,
  paged: { baseSessions: readonly T[]; extraSessions: readonly T[] },
  paginationAll?: readonly T[],
): readonly T[] {
  if (!expanded) return []
  return paginationAll ?? [...paged.baseSessions, ...paged.extraSessions]
}

export function sessionReadStatusActionLabel(
  session: Pick<SessionListItem, 'unreadAt'>,
): '标记为已读' | '标记为未读' {
  return session.unreadAt ? '标记为已读' : '标记为未读'
}

export function getSidebarSessionDisplayGroups<T>(
  sessions: readonly T[],
  visibleLimit: number,
  baseLimit = GROUP_LIMIT,
): {
  baseSessions: T[]
  canCollapse: boolean
  canShowMore: boolean
  extraSessions: T[]
  hasOverflow: boolean
} {
  const hasOverflow = sessions.length > baseLimit
  const clampedVisibleLimit = Math.min(Math.max(baseLimit, visibleLimit), sessions.length)
  return {
    baseSessions: sessions.slice(0, baseLimit),
    canCollapse: clampedVisibleLimit > baseLimit,
    canShowMore: clampedVisibleLimit < sessions.length,
    extraSessions: hasOverflow ? sessions.slice(baseLimit, clampedVisibleLimit) : [],
    hasOverflow,
  }
}

function SidebarSessionSubtitle({ session }: { session: SessionListItem }): React.ReactNode {
  return <SidebarSessionWorkspaceMeta session={session} />
}

function SidebarActivitySubtitle({ session }: { session: SessionListItem }): React.ReactNode {
  const preview = useSidebarActivityPreview(session)
  return preview ? (
    <span className="tw:block tw:min-w-0 tw:truncate tw:type-caption tw:text-app-text-meta">
      {preview}
    </span>
  ) : (
    <SidebarSessionWorkspaceMeta session={session} />
  )
}

function SidebarSessionWorkspaceMeta({ session }: { session: SessionListItem }): React.ReactNode {
  if (session.standalone) {
    return (
      <span className="sidebar-session-workspace-meta tw:flex tw:min-w-0 tw:items-center tw:gap-1 tw:text-app-text-meta tw:type-caption">
        <MessageSquare
          className="sidebar-session-workspace-meta__icon tw:flex-none"
          size="var(--inline-icon-size, 1em)"
        />
        <span className="sidebar-session-workspace-meta__name tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap">
          会话
        </span>
      </span>
    )
  }
  if (session.projectId) {
    return (
      <span className="sidebar-session-workspace-meta tw:flex tw:min-w-0 tw:items-center tw:gap-1 tw:text-app-text-meta tw:type-caption">
        <ProjectAppearanceGlyph
          className="sidebar-session-workspace-meta__glyph tw:flex-none"
          size={APP_ICON_SIZES.sm}
        />
        <span className="sidebar-session-workspace-meta__name tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap">
          {session.workspaceName}
        </span>
      </span>
    )
  }
  return (
    <span className="sidebar-session-workspace-meta tw:flex tw:min-w-0 tw:items-center tw:gap-1 tw:text-app-text-meta tw:type-caption">
      <Folder
        className="sidebar-session-workspace-meta__icon tw:flex-none"
        size="var(--inline-icon-size, 1em)"
      />
      <span className="sidebar-session-workspace-meta__name tw:min-w-0 tw:overflow-hidden tw:whitespace-nowrap">
        {session.workspaceName}
      </span>
    </span>
  )
}
