import { chooseSessionGroupForThread } from '../../session-groups/SessionGroupActions.js'
import React from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { Dropdown as DropdownMenu } from '../../../components/ui/floating/Dropdown.js'
import { commandMenuActionStore } from '../../search/CommandMenuActionStore.js'
import {
  AppWindow,
  Archive,
  Bot,
  ChevronRight,
  Copy,
  Split,
  LayoutList,
  MessagesSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Pin,
  Sparkles,
  Workflow,
} from 'lucide-react'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import type { DesktopPermissionRequest, DesktopSessionStatus } from '../../../../shared/Types.js'
import { useQuickChatContext } from '../QuickChatContext.js'
import { useDesktopSettings } from '../../settings/UseDesktopSettings.js'
import { WorkspaceHeaderItem } from '../../layout/workspace-header/index.js'
import { useHeightTransition } from '../../../hooks/UseHeightTransition.js'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import { enterTween, exitTween, motionTransition } from '../../motion/MotionTransitions.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { InlineApprovalCard } from '../approvals/InlineApprovalCard.js'
import {
  ComposerChangeSummary,
  findLatestExecutionPlan,
} from '../composer/ComposerChangeSummary.js'
import { deriveConversationChangeSummary } from '../composer/ConversationChangeSummary.js'
import {
  clearConversationSelectionHighlight,
  createConversationSelectionSnapshot,
  installConversationSelectionHighlight,
} from './ConversationSelectionHighlight.js'
import {
  PopoverCheckboxItem,
  PopoverItem,
  PopoverSeparator,
} from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { AppContextMenu } from '../../../components/ui/AppContextMenu.js'
import { FullScreenWhaleLoading } from '../../../components/ui/FullScreenWhaleLoading.js'
import { buildPopoverSizingStyle } from '../../../components/ui/PopoverSizing.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { InputDialog } from '../../../components/ui/ConfirmationDialog.js'
import { SkeletonBlock } from '../../../components/ui/Skeleton.js'
import {
  loadConversationUiState,
  patchConversationUiState,
} from '../../layout/tabs/ConversationUiState.js'
import { CanonicalThreadView } from '../timeline/CanonicalThreadView.js'
import { normalizePatchActionError } from '../timeline/PatchActionError.js'
import { subagentStatusLabel } from '../subagents/SubagentStatusLabel.js'
import { ConversationItemContext } from '../timeline/ConversationItemContext.js'
import type { ThreadTimelineNavigationHandle } from '../timeline/SessionTimelineView.js'
import { ThreadComposerDock } from './ThreadComposerDock.js'
import { ThreadScrollLayout } from './ThreadScrollLayout.js'
import { ConversationTurnNavRail, type TurnNavigationReason } from './ConversationTurnNavRail.js'
import { useConversationTurnRowVisibility } from './UseConversationTurnRowVisibility.js'
import { useThreadBookmarks } from './UseThreadBookmarks.js'
import {
  ThreadSummaryErrorBoundary,
  ThreadSummaryPanel,
  ThreadSummaryPopover,
  type ThreadSummarySectionId,
} from '../summary/ThreadSummaryPanel.js'
import { useThreadSummaryController } from '../summary/ThreadSummaryState.js'
import {
  resolveThreadSummaryAgentsAutoCollapse,
  THREAD_SUMMARY_AGENTS_AUTO_COLLAPSE_DELAY_MS,
} from '../summary/ThreadSummaryState.js'
import { useBranchReviewSummary } from '../summary/UseBranchReviewSummary.js'
import { deriveThreadSummaryViewModel } from '../summary/ThreadSummaryViewModel.js'
import type { Item } from '@pidex/shared/thread'
import {
  deriveConversationTurnNavItems,
  type ConversationTurnNavItem,
} from './TurnNavigationModel.js'
import { useCanonicalThreadConversation } from '../timeline/UseCanonicalThreadConversation.js'
import { PlanApprovalCard } from '../approvals/PlanApprovalCard.js'
import { usePlanApprovalResponse } from '../approvals/UsePlanApprovalResponse.js'
import {
  selectCanonicalConversationAuxiliaryState,
  selectCanonicalSessionLifecycle,
} from './CanonicalConversationSelectors.js'
import {
  canInlineEditConversationTitle,
  canRegenerateConversationTitle,
  normalizeConversationTitle,
  shouldCloseConversationRenameDialog,
} from './ConversationTitleActions.js'
import { useConversationForkController } from '../workflow/fork/UseConversationForkController.js'
import { findLatestConversationForkPoint } from '../workflow/fork/LatestConversationForkPoint.js'
import {
  copySessionReference,
  copyThreadDeepLink,
  copyThreadId,
  copyWorkspaceCwd,
  resolveSessionReferenceShortcut,
  type SessionReferenceContext,
} from './SessionReferenceActions.js'
export { deriveConversationTurnNavItems } from './TurnNavigationModel.js'
export type { ConversationTurnNavItem } from './TurnNavigationModel.js'
import { DesktopComposer } from '../composer/DesktopComposer.js'

const ConversationEnvironmentControls = React.lazy(() =>
  import('../workflow/ConversationEnvironmentControls.js').then((module) => ({
    default: module.ConversationEnvironmentControls,
  })),
)

const WORKSPACE_HEADER_ICON_SIZE = APP_ICON_SIZE

function isFinishedSubagentStatus(status: string | null | undefined): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'stopped' ||
    status === 'interrupted'
  )
}

export function ConversationPage(): React.ReactNode {
  const navigate = useNavigate()
  const {
    isConversationLoading,
    activeSessionId,
    activeSessionPinnedAt,
    sessionTitle,
    editableSessionTitle,
    titleRegenerating,
    sessionStatus,
    projectDetailsTrigger,
    workspaceName,
    workspacePath,
    activeProjectId,
    branchName,
    branches,
    gitStatus,
    gitDetection,
    reviewSource,
    reviewSummary,
    browserTabs,
    threadGoal,
    onGoalPause,
    onGoalResume,
    onOpenArtifact,
    onActivateBrowserTab,
    onArchiveSession,
    onCreateBranch,
    onOpenAutomation,
    onOpenWorkspacePath,
    onOpenPatchReview,
    onRefreshDiff,
    onRenameSession,
    onRefreshSessionTitle,
    onToggleSessionPinned,
    onBranchSelect,
    onCommitOrPush,
    onGitOperation,
    onOpenTerminal,
    onCreatePullRequest,
    onDecidePermission,
    onOpenRightDock,
    onOpenPlanInRightDock,
    onOpenLocalContext,
    canCopyFileReferenceContents,
    onCopyFileReferenceContents,
    onOpenFileReference,
    onOpenAttachment,
    onSubmitEditedUserMessage,
    onAppendComposerText,
    onAppendSideChatText,
    onOpenSideChat,
    sideChatAvailable,
    onOpenSubagent,
    permissionMode,
    composerProps,
    layoutResizeActive,
    rightDockPlanEventId,
  } = useQuickChatContext()
  const {
    diffMarkerStyle,
    reviewView,
    draft: settingsDraft,
    setSidebarSessionPins,
  } = useDesktopSettings()
  const canonicalConversation = useCanonicalThreadConversation(activeSessionId)
  const environmentActions = React.useSyncExternalStore(
    commandMenuActionStore.subscribe,
    commandMenuActionStore.getSnapshot,
    commandMenuActionStore.getServerSnapshot,
  )
  const [selectedLaunchActionId, setSelectedLaunchActionId] = React.useState('')
  const launchActions = environmentActions.filter(
    (action) =>
      action.id.startsWith(`environment.action.${activeSessionId}.`) &&
      !action.id.endsWith('.loading'),
  )
  const environmentChoices = environmentActions.filter((action) =>
    action.id.startsWith(`environment.choice.${activeSessionId}.`),
  )
  const handoffAction = environmentActions.find(
    (action) =>
      action.id === `environment.handoff.${activeSessionId}` && action.availability === 'available',
  )
  const pendingPlanApproval = canonicalConversation.state?.pendingPlanApproval
  const [dismissedPlan, setDismissedPlan] = React.useState<string | null>(null)
  const planKey = pendingPlanApproval
    ? `${pendingPlanApproval.id}:${pendingPlanApproval.version}`
    : null
  const showPlanApproval = Boolean(pendingPlanApproval && dismissedPlan !== planKey)
  const planModel =
    composerProps?.selectedModelMetadata?.id ??
    composerProps?.modelPresets.find((preset) => preset.id === composerProps.selectedModelPreset)
      ?.value
  const planApproval = usePlanApprovalResponse(
    pendingPlanApproval,
    canonicalConversation.reload,
    composerProps?.selectedProviderID && planModel
      ? {
          providerID: composerProps.selectedProviderID,
          model: planModel,
          variant: composerProps.modelVariant,
        }
      : undefined,
    (threadId) => navigate(`/threads/${encodeURIComponent(threadId)}`),
  )
  const subagents = React.useMemo(
    () =>
      canonicalConversation.state
        ? [...canonicalConversation.state.subagentsByTaskId.values()]
        : [],
    [canonicalConversation.state],
  )
  const canonicalAuxiliary = React.useMemo(
    () => selectCanonicalConversationAuxiliaryState(canonicalConversation.state),
    [canonicalConversation.state],
  )
  const canonicalLifecycle = React.useMemo(
    () => selectCanonicalSessionLifecycle(canonicalConversation.state),
    [canonicalConversation.state],
  )
  // The canonical projection cannot be read by list surfaces such as the
  // sidebar, so publish it for the thread it covers; the session store change
  // then carries the merged status to every consumer. Clearing it on unmount or
  // thread switch hands that thread back to the catalog status.
  React.useEffect(() => {
    if (!activeSessionId) return
    desktopClient.publishCanonicalSessionStatus(activeSessionId, canonicalLifecycle)
  }, [activeSessionId, canonicalLifecycle])
  React.useEffect(() => {
    if (!activeSessionId) return
    return () => desktopClient.publishCanonicalSessionStatus(activeSessionId, null)
  }, [activeSessionId])
  const isThreadLoading =
    isConversationLoading ||
    (canonicalConversation.loading && canonicalConversation.turns.length === 0)
  const effectiveSessionStatus = canonicalAuxiliary.sessionStatus ?? sessionStatus
  const navigateToForkTarget = React.useCallback(
    (targetThreadId: string) => {
      navigate(`/threads/${encodeURIComponent(targetThreadId)}`)
    },
    [navigate],
  )
  const conversationFork = useConversationForkController({
    canUseNewWorktree: Boolean(workspacePath && (branchName || gitStatus)),
    sourceRunning:
      effectiveSessionStatus === 'running' ||
      effectiveSessionStatus === 'waiting' ||
      effectiveSessionStatus === 'queued',
    sourceThreadId: activeSessionId,
    onNavigateTarget: navigateToForkTarget,
  })
  const pendingPermissions = canonicalAuxiliary.pendingPermissions
  const reduceMotion = usePrefersReducedMotion()
  const turnNavItems = React.useMemo<ConversationTurnNavItem[]>(
    () => deriveConversationTurnNavItems(canonicalConversation.turns),
    [canonicalConversation.turns],
  )
  const { bookmarks: threadBookmarks, toggle: toggleThreadBookmark } = useThreadBookmarks(
    activeSessionId ?? '',
  )
  const latestConversationForkPoint = React.useMemo(
    () => findLatestConversationForkPoint(canonicalConversation.turns),
    [canonicalConversation.turns],
  )
  const [sessionMenuOpen, setSessionMenuOpen] = React.useState(false)
  const [renameDialogOpen, setRenameDialogOpen] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState('')
  const [renamingSession, setRenamingSession] = React.useState(false)
  const [isInlineEditing, setIsInlineEditing] = React.useState(false)
  const [inlineTitleValue, setInlineTitleValue] = React.useState('')
  const isComposingRef = React.useRef(false)
  const skipNextBlurSaveRef = React.useRef(false)
  const editStartTimeRef = React.useRef(0)
  const inlineInputRef = React.useRef<HTMLInputElement | null>(null)
  const activeSessionIdRef = React.useRef(activeSessionId)
  activeSessionIdRef.current = activeSessionId

  React.useEffect(() => {
    setIsInlineEditing(false)
    skipNextBlurSaveRef.current = false
  }, [activeSessionId])

  const handleInlineInputRef = React.useCallback((node: HTMLInputElement | null) => {
    inlineInputRef.current = node
    if (node) {
      node.focus()
      node.select()
      const frame = requestAnimationFrame(() => {
        node.focus()
        node.select()
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [])

  const [conversationSelectedText, setConversationSelectedText] = React.useState('')
  React.useEffect(() => {
    return () => {
      clearConversationSelectionHighlight()
    }
  }, [])
  const [isRefreshingDiff, setIsRefreshingDiff] = React.useState(false)
  const timelineListRef = React.useRef<import('virtua').VirtualizerHandle | null>(null)
  const timelineNavigationRef = React.useRef<ThreadTimelineNavigationHandle | null>(null)
  const [hasRailInlineClearance, setHasRailInlineClearance] = React.useState(false)
  const directoryAttemptRef = React.useRef<string | null>(null)
  const loadDirectoryPreservingAnchor = React.useCallback(
    () =>
      canonicalConversation.loadAllOlder(
        () => timelineNavigationRef.current?.captureHistoryAnchor() ?? (() => undefined),
      ),
    [canonicalConversation.loadAllOlder],
  )
  const historyGeneration = canonicalConversation.state?.history.generation
  const loadOlderPreservingAnchor = React.useCallback(
    () =>
      canonicalConversation.loadOlder(
        () => timelineNavigationRef.current?.captureHistoryAnchor() ?? (() => undefined),
      ),
    [canonicalConversation.loadOlder],
  )
  const historyCursor = canonicalConversation.state?.history.olderCursor
  React.useEffect(() => {
    if (
      !hasRailInlineClearance ||
      !canonicalConversation.hasOlder ||
      canonicalConversation.loadingOlder ||
      canonicalConversation.loadingDirectory
    )
      return
    const key = `${activeSessionId}:${historyGeneration}:${historyCursor}`
    if (directoryAttemptRef.current === key) return
    directoryAttemptRef.current = key
    void loadDirectoryPreservingAnchor()
  }, [
    activeSessionId,
    canonicalConversation.hasOlder,
    canonicalConversation.loadingOlder,
    canonicalConversation.loadingDirectory,
    hasRailInlineClearance,
    historyCursor,
    historyGeneration,
    loadDirectoryPreservingAnchor,
  ])
  const [timelineBottomState, setTimelineBottomState] = React.useState<{
    sessionId: string | null
    canReturnToBottom: boolean
  }>({
    sessionId: null,
    canReturnToBottom: false,
  })
  const canReturnTimelineToBottom =
    timelineBottomState.sessionId === activeSessionId && timelineBottomState.canReturnToBottom
  const handleCanReturnToBottomChange = React.useCallback(
    (canReturnToBottom: boolean): void => {
      setTimelineBottomState({
        sessionId: activeSessionId,
        canReturnToBottom,
      })
    },
    [activeSessionId],
  )
  const returnTimelineToBottom = React.useCallback((): void => {
    timelineNavigationRef.current?.returnToBottom()
  }, [])
  const threadScrollRef = React.useRef<HTMLDivElement | null>(null)
  const turnNavItemIds = React.useMemo(() => turnNavItems.map((item) => item.id), [turnNavItems])
  const { registerTurnRow, visibilityStore } = useConversationTurnRowVisibility(
    turnNavItemIds,
    threadScrollRef,
  )
  const threadFooterRef = React.useRef<HTMLElement | null>(null)
  const initialTimelineScrollTop = React.useMemo(
    () => (activeSessionId ? (loadConversationUiState(activeSessionId)?.mainScrollTop ?? 0) : 0),
    [activeSessionId],
  )
  const mainScrollTopRef = React.useRef(0)
  const scrollRestoredRef = React.useRef<string | null>(null)

  const handleTimelineScroll = React.useCallback((scrollTop: number) => {
    mainScrollTopRef.current = scrollTop
  }, [])

  const handleTurnNavigate = React.useCallback(
    (item: ConversationTurnNavItem, reason: TurnNavigationReason): void => {
      timelineNavigationRef.current?.revealInput(
        { turnId: item.turnId, inputId: item.id, rowIndex: item.rowIndex },
        reduceMotion || reason === 'scrub' ? 'instant' : 'smooth',
      )
    },
    [reduceMotion],
  )

  React.useEffect(() => {
    const sessionId = activeSessionId

    return () => {
      if (!sessionId) return
      patchConversationUiState(sessionId, {
        mainScrollTop: mainScrollTopRef.current,
      })
    }
  }, [activeSessionId])

  React.useEffect(() => {
    if (
      isConversationLoading ||
      canonicalConversation.loading ||
      canonicalConversation.state?.thread.id !== activeSessionId ||
      !activeSessionId
    ) {
      return
    }
    if (scrollRestoredRef.current === activeSessionId) return
    const saved = loadConversationUiState(activeSessionId)
    if (saved?.mainScrollTop && !timelineListRef.current) return
    scrollRestoredRef.current = activeSessionId
    mainScrollTopRef.current = saved?.mainScrollTop ?? 0
    if (saved?.mainScrollTop && timelineListRef.current) {
      requestAnimationFrame(() => {
        try {
          timelineListRef.current?.scrollTo(saved.mainScrollTop)
        } catch {
          // VList may not be ready yet; silently ignore
        }
      })
    }
  }, [
    activeSessionId,
    canonicalConversation.loading,
    canonicalConversation.state,
    isConversationLoading,
  ])

  const handleRefreshDiff = React.useCallback(() => {
    if (isRefreshingDiff) return
    setIsRefreshingDiff(true)
    try {
      onRefreshDiff()
    } finally {
      window.setTimeout(() => setIsRefreshingDiff(false), 600)
    }
  }, [isRefreshingDiff, onRefreshDiff])
  const workspaceChangedFileCount = workspacePath ? (gitStatus?.files.length ?? 0) : 0
  const composerExecutionPlan = findLatestExecutionPlan(canonicalConversation.turns)
  const conversationChangeSummary = React.useMemo(
    () => deriveConversationChangeSummary(canonicalConversation.turns, gitStatus),
    [canonicalConversation.turns, gitStatus],
  )
  const showComposerStatusSummary = shouldShowComposerStatusSummary({
    hasPlan: composerExecutionPlan !== null,
    changedFileCount: conversationChangeSummary.files.length,
  })
  const branchReviewState = useBranchReviewSummary(
    workspacePath,
    gitStatus,
    reviewSource,
    reviewSummary,
    activeProjectId,
  )
  const branchReviewSummary = branchReviewState.snapshot
  const sourceLinks = canonicalAuxiliary.sourceLinks
  const canonicalAttachments = React.useMemo(
    () =>
      canonicalConversation.state ? [...canonicalConversation.state.attachmentsById.values()] : [],
    [canonicalConversation.state],
  )
  const canonicalContextReferences = React.useMemo(
    () =>
      canonicalConversation.state
        ? [...canonicalConversation.state.contextReferencesById.values()]
        : [],
    [canonicalConversation.state],
  )
  const canonicalTools = React.useMemo(() => {
    const state = canonicalConversation.state
    if (!state) return []
    const tools: Extract<Item, { type: 'tool' }>[] = []
    for (const item of state.itemsById.values()) {
      if (item.type === 'tool') tools.push(item)
    }
    return tools
  }, [canonicalConversation.state])
  const threadSummaryModel = React.useMemo(
    () =>
      deriveThreadSummaryViewModel({
        repositoryRoot: branchReviewSummary?.repositoryRoot,
        gitDetection,
        sessionId: activeSessionId,
        workspaceName,
        workspacePath,
        branchName,
        hasGitRepository: Boolean(gitStatus),
        changedFileCount: workspaceChangedFileCount,
        additions: 0,
        deletions: 0,
        branchChanges: branchReviewSummary
          ? {
              fileCount: branchReviewSummary.totals.files,
              additions: branchReviewSummary.totals.additions,
              deletions: branchReviewSummary.totals.deletions,
            }
          : null,
        goal: threadGoal,
        attachments: canonicalAttachments,
        contextReferences: canonicalContextReferences,
        tools: canonicalTools,
        sourceLinks,
        subagents,
        browserTabs,
      }),
    [
      activeSessionId,
      workspaceName,
      branchName,
      gitStatus,
      gitDetection,
      workspaceChangedFileCount,
      branchReviewSummary,
      threadGoal,
      canonicalAttachments,
      canonicalContextReferences,
      canonicalTools,
      sourceLinks,
      subagents,
      browserTabs,
      workspacePath,
    ],
  )
  const workflowMainRef = React.useRef<HTMLElement>(null)
  const threadSummary = useThreadSummaryController(workflowMainRef)
  // 切换会话时关闭浮层，保留置顶偏好；分区折叠状态按会话保留在内存里。
  const closeSummaryPopover = threadSummary.setPopoverOpen
  const EMPTY_COLLAPSED_SECTIONS = React.useMemo<ReadonlySet<ThreadSummarySectionId>>(
    () => new Set(),
    [],
  )
  const [collapsedSectionsByThread, setCollapsedSectionsByThread] = React.useState(
    () => new Map<string, ReadonlySet<ThreadSummarySectionId>>(),
  )
  const agentsManualOverrideRef = React.useRef(false)
  const agentsAutoCollapseTimerRef = React.useRef<number | null>(null)
  const collapsedSections =
    (activeSessionId ? collapsedSectionsByThread.get(activeSessionId) : undefined) ??
    EMPTY_COLLAPSED_SECTIONS
  React.useEffect(() => {
    closeSummaryPopover(false)
    agentsManualOverrideRef.current = false
    if (agentsAutoCollapseTimerRef.current !== null) {
      window.clearTimeout(agentsAutoCollapseTimerRef.current)
      agentsAutoCollapseTimerRef.current = null
    }
  }, [activeSessionId, closeSummaryPopover])
  const toggleSummarySection = React.useCallback((id: ThreadSummarySectionId): void => {
    const threadId = activeSessionIdRef.current
    if (!threadId) return
    if (id === 'agents') {
      // 手动折叠选择优先：用户动过 Agent 分区后不再自动折叠。
      agentsManualOverrideRef.current = true
      if (agentsAutoCollapseTimerRef.current !== null) {
        window.clearTimeout(agentsAutoCollapseTimerRef.current)
        agentsAutoCollapseTimerRef.current = null
      }
    }
    setCollapsedSectionsByThread((current) => {
      const collapsed = new Set(current.get(threadId) ?? [])
      if (collapsed.has(id)) collapsed.delete(id)
      else collapsed.add(id)
      const next = new Map(current)
      next.set(threadId, collapsed)
      return next
    })
  }, [])
  const agentsActiveCount = React.useMemo(
    () =>
      subagents.filter(({ currentRun }) => !isFinishedSubagentStatus(currentRun?.status)).length,
    [subagents],
  )
  React.useEffect(() => {
    if (!activeSessionId) return
    const decision = resolveThreadSummaryAgentsAutoCollapse({
      activeCount: agentsActiveCount,
      manualOverride: agentsManualOverrideRef.current,
      totalCount: subagents.length,
    })
    if (decision === 'idle') return
    if (decision === 'reset-override') {
      agentsManualOverrideRef.current = false
      return
    }
    // Agent 全部结束后延迟 30 秒自动折叠该分区。
    agentsAutoCollapseTimerRef.current = window.setTimeout(() => {
      agentsAutoCollapseTimerRef.current = null
      if (agentsManualOverrideRef.current) return
      setCollapsedSectionsByThread((current) => {
        const threadId = activeSessionIdRef.current
        if (!threadId || current.get(threadId)?.has('agents')) return current
        const next = new Map(current)
        next.set(threadId, new Set(next.get(threadId) ?? []).add('agents'))
        return next
      })
    }, THREAD_SUMMARY_AGENTS_AUTO_COLLAPSE_DELAY_MS)
    return () => {
      if (agentsAutoCollapseTimerRef.current !== null) {
        window.clearTimeout(agentsAutoCollapseTimerRef.current)
        agentsAutoCollapseTimerRef.current = null
      }
    }
  }, [activeSessionId, agentsActiveCount, subagents.length])
  const handleStopSubagent = React.useCallback((taskId: string): void => {
    // 不做乐观状态变更：等待 subagent 投影事件更新后再改变行状态。
    desktopClient.stopSubagent(taskId).catch(() => undefined)
  }, [])
  const fallbackTitle = canonicalAuxiliary.fallbackTitle ?? '新对话'
  const renderedSessionTitle = sessionTitle ?? fallbackTitle
  const hasActiveSession = Boolean(activeSessionId)
  const isSessionPinned = Boolean(activeSessionPinnedAt)
  const canRegenerateSessionTitle = canRegenerateConversationTitle({
    hasActiveSession,
    hasFirstMessage: canonicalAuxiliary.fallbackTitle !== null,
    pending: titleRegenerating,
    status: effectiveSessionStatus,
  })
  const canInlineEdit = canInlineEditConversationTitle({
    hasActiveSession,
    isLoading: isThreadLoading,
    isRegenerating: titleRegenerating,
    isRenaming: renamingSession,
  })

  React.useEffect(() => {
    if (isInlineEditing && !canInlineEdit && !renamingSession) {
      setIsInlineEditing(false)
      skipNextBlurSaveRef.current = false
    }
  }, [canInlineEdit, isInlineEditing, renamingSession])

  const activePermissionRequest = pendingPermissions[0] ?? null
  const composerMode = workflowComposerMode(activePermissionRequest)
  const composerTransition = useHeightTransition([
    composerMode,
    activePermissionRequest?.requestId ?? '',
    showComposerStatusSummary,
    composerExecutionPlan,
    composerProps ? 'mounted' : 'unmounted',
  ])

  const workflowPageRef = React.useRef<HTMLElement>(null)
  React.useEffect(() => {
    let hiddenRoot: HTMLElement | null = null
    let observer: MutationObserver | null = null
    let revealTimeout: number | null = null

    const clearHiddenRoot = (): void => {
      observer?.disconnect()
      observer = null
      if (revealTimeout !== null) {
        window.clearTimeout(revealTimeout)
        revealTimeout = null
      }
      hiddenRoot?.style.removeProperty('visibility')
      hiddenRoot = null
    }
    const hideUntilTimelineChanges = (): void => {
      clearHiddenRoot()
      const root = workflowPageRef.current?.querySelector<HTMLElement>('.canonical-thread-view')
      if (!root) return
      const previousThreadId = root.dataset.canonicalThreadId
      hiddenRoot = root
      root.style.visibility = 'hidden'
      const revealReplacement = (): void => {
        const current =
          workflowPageRef.current?.querySelector<HTMLElement>('.canonical-thread-view')
        if (
          !hiddenRoot?.isConnected ||
          current !== hiddenRoot ||
          current.dataset.canonicalThreadId !== previousThreadId
        ) {
          clearHiddenRoot()
        }
      }
      observer = new MutationObserver(revealReplacement)
      observer.observe(root, {
        attributeFilter: ['data-canonical-thread-id'],
        attributes: true,
      })
      if (root.parentElement) {
        observer.observe(root.parentElement, {
          childList: true,
        })
      }
      revealTimeout = window.setTimeout(clearHiddenRoot, 1_000)
    }

    window.addEventListener('hashchange', hideUntilTimelineChanges)
    return () => {
      window.removeEventListener('hashchange', hideUntilTimelineChanges)
      clearHiddenRoot()
    }
  }, [])
  function closeSessionMenu(): void {
    setSessionMenuOpen(false)
  }

  const sessionReferenceContext = React.useMemo<SessionReferenceContext>(
    () => ({
      workspaceCwd: workspacePath ?? '',
      threadId: activeSessionId ?? '',
    }),
    [activeSessionId, workspacePath],
  )

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const payload = resolveSessionReferenceShortcut(event, sessionReferenceContext)
      if (!payload) return
      const value = payload.kind === 'workspaceCwd' ? payload.workspaceCwd : payload.threadId
      if (!value) return
      event.preventDefault()
      void copySessionReference(payload)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sessionReferenceContext])

  const openRenameSessionDialog = React.useCallback((): void => {
    if (!hasActiveSession || renameDialogOpen || renamingSession) return
    if (isInlineEditing) {
      setIsInlineEditing(false)
      skipNextBlurSaveRef.current = true
    }
    setSessionMenuOpen(false)
    setRenameValue(editableSessionTitle ?? renderedSessionTitle)
    setRenameDialogOpen(true)
  }, [
    editableSessionTitle,
    hasActiveSession,
    isInlineEditing,
    renameDialogOpen,
    renderedSessionTitle,
    renamingSession,
  ])

  async function submitSessionRename(): Promise<void> {
    const title = renameValue.trim()
    if (!activeSessionId || renamingSession || !title) return
    const requestedSessionId = activeSessionId
    setRenamingSession(true)
    try {
      const renamed = await onRenameSession(title)
      if (
        shouldCloseConversationRenameDialog({
          activeSessionId: activeSessionIdRef.current,
          requestedSessionId,
          succeeded: renamed,
        })
      ) {
        setRenameDialogOpen(false)
      }
    } finally {
      setRenamingSession(false)
    }
  }

  const startInlineEdit = React.useCallback((): void => {
    if (!canInlineEdit || isInlineEditing) return
    editStartTimeRef.current = Date.now()
    setInlineTitleValue(editableSessionTitle ?? renderedSessionTitle)
    setIsInlineEditing(true)
    skipNextBlurSaveRef.current = false
  }, [canInlineEdit, editableSessionTitle, isInlineEditing, renderedSessionTitle])

  const submitInlineRename = React.useCallback(
    async (options?: { fromBlur?: boolean }): Promise<void> => {
      if (options?.fromBlur) {
        if (skipNextBlurSaveRef.current) {
          skipNextBlurSaveRef.current = false
          return
        }
        if (Date.now() - editStartTimeRef.current < 200) {
          return
        }
      }

      if (!activeSessionId || renamingSession || isComposingRef.current) return

      const currentTitle = editableSessionTitle ?? renderedSessionTitle
      const trimmed = normalizeConversationTitle(inlineTitleValue)

      // Empty title: cancel and revert to original
      if (!trimmed) {
        setIsInlineEditing(false)
        setInlineTitleValue(currentTitle)
        skipNextBlurSaveRef.current = false
        return
      }

      // Name unchanged: exit without request
      if (trimmed === normalizeConversationTitle(currentTitle)) {
        setIsInlineEditing(false)
        skipNextBlurSaveRef.current = false
        return
      }

      const requestedSessionId = activeSessionId
      setRenamingSession(true)
      try {
        const renamed = await onRenameSession(trimmed)
        if (
          shouldCloseConversationRenameDialog({
            activeSessionId: activeSessionIdRef.current,
            requestedSessionId,
            succeeded: Boolean(renamed),
          })
        ) {
          setIsInlineEditing(false)
          skipNextBlurSaveRef.current = false
        } else {
          // Save failed: keep isInlineEditing = true, retain input value
          skipNextBlurSaveRef.current = false
        }
      } catch {
        // Save failed: keep isInlineEditing = true, retain input value
        skipNextBlurSaveRef.current = false
      } finally {
        setRenamingSession(false)
      }
    },
    [
      activeSessionId,
      editableSessionTitle,
      inlineTitleValue,
      onRenameSession,
      renamingSession,
      renderedSessionTitle,
    ],
  )

  const handleInlineKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      skipNextBlurSaveRef.current = true
      setIsInlineEditing(false)
      setInlineTitleValue(editableSessionTitle ?? renderedSessionTitle)
      return
    }

    if (event.key === 'Enter') {
      if (
        isComposingRef.current ||
        (event.nativeEvent as KeyboardEvent).isComposing ||
        event.keyCode === 229
      ) {
        return
      }
      event.preventDefault()
      skipNextBlurSaveRef.current = true
      void submitInlineRename()
    }
  }

  const handleInlineBlur = (): void => {
    void submitInlineRename({ fromBlur: true })
  }

  const handleTitleKeyDown = (event: React.KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      startInlineEdit()
    }
  }

  const regenerateCurrentSessionTitle = React.useCallback(async (): Promise<void> => {
    if (!canRegenerateSessionTitle) return
    setSessionMenuOpen(false)
    try {
      await onRefreshSessionTitle()
    } catch (error) {
      window.dispatchEvent(new CustomEvent('desktop:error', { detail: error }))
    }
  }, [canRegenerateSessionTitle, onRefreshSessionTitle])

  const openConversationInNewWindow = React.useCallback((): void => {
    if (!activeSessionId) return
    setSessionMenuOpen(false)
    void desktopClient
      .openWindow({
        kind: 'thread',
        threadId: activeSessionId,
      })
      .catch((error) => {
        window.dispatchEvent(new CustomEvent('desktop:error', { detail: error }))
      })
  }, [activeSessionId])

  React.useEffect(() => {
    setRenameDialogOpen(false)
    setRenameValue('')
  }, [activeSessionId])

  function copyWorkspaceReference(): void {
    closeSessionMenu()
    if (!workspacePath) return
    void copyWorkspaceCwd(workspacePath)
  }

  function copyThreadReference(): void {
    closeSessionMenu()
    if (!activeSessionId) return
    void copyThreadId(activeSessionId)
  }

  function copyThreadDeepLinkReference(): void {
    closeSessionMenu()
    if (!activeSessionId) return
    void copyThreadDeepLink(activeSessionId)
  }

  function continueInNewConversation(): void {
    closeSessionMenu()
    if (!latestConversationForkPoint) return
    conversationFork.onForkFromMessage?.(latestConversationForkPoint)
  }

  function openAutomationView(): void {
    closeSessionMenu()
    onOpenAutomation()
  }

  function toggleSessionPinned(): void {
    closeSessionMenu()
    onToggleSessionPinned()
  }

  function archiveCurrentSession(): void {
    closeSessionMenu()
    onArchiveSession()
  }

  const openBranchReview = React.useCallback((): void => {
    onOpenRightDock('review', { kind: 'branch', baseBranch: branchReviewState.source.baseBranch })
  }, [onOpenRightDock, branchReviewState.source.baseBranch])

  const openReviewSidebar = React.useCallback((): void => {
    onRefreshDiff()
    onOpenRightDock('review')
  }, [onOpenRightDock, onRefreshDiff])

  const applyThreadPatch = React.useCallback(
    async (itemId: string, action: 'undo' | 'reapply', expectedVersion: number): Promise<void> => {
      if (!activeSessionId) return
      try {
        await desktopClient.applyThreadPatch({
          threadId: activeSessionId,
          itemId,
          action,
          expectedVersion,
        })
        await canonicalConversation.reload()
        onRefreshDiff()
      } catch (error) {
        throw normalizePatchActionError(error, action)
      }
    },
    [activeSessionId, canonicalConversation, onRefreshDiff],
  )

  function handleConversationContextMenu(): void {
    clearConversationSelectionHighlight()
    const snapshot = createConversationSelectionSnapshot(window.getSelection())
    setConversationSelectedText(snapshot?.text ?? '')
    if (snapshot) {
      installConversationSelectionHighlight(snapshot.range)
    }
  }

  function handleAddToConversation(): void {
    const text = conversationSelectedText.trim()
    if (!text) return
    onAppendComposerText(text)
    clearConversationSelectionHighlight()
    setConversationSelectedText('')
  }

  function handleAskInSideChat(): void {
    const text = conversationSelectedText.trim()
    if (!text) return
    onAppendSideChatText(text)
    clearConversationSelectionHighlight()
    setConversationSelectedText('')
  }

  const showConversationContextMenu = conversationSelectedText.trim().length > 0

  const workspaceHeaderTitle = React.useMemo(() => {
    return (
      <div className="chat-session-title tw:flex tw:min-w-0 tw:flex-[1_1_auto] tw:items-center tw:gap-2 tw:text-app-text tw:type-control">
        {projectDetailsTrigger}
        {isInlineEditing ? (
          <input
            autoFocus
            ref={handleInlineInputRef}
            aria-label="重命名对话"
            className="chat-session-title__input tw:box-border tw:h-[26px] tw:w-full tw:min-w-30 tw:max-w-90 tw:flex-[0_1_360px] tw:rounded-sm tw:border tw:border-app-border-subtle tw:bg-app-canvas tw:px-2 tw:py-0 tw:text-app-text tw:shadow-none tw:outline-none tw:[font:inherit] tw:focus-visible:border-app-focus tw:focus-visible:outline-2 tw:focus-visible:outline-offset-1 tw:disabled:cursor-not-allowed tw:disabled:opacity-60"
            disabled={renamingSession}
            maxLength={160}
            type="text"
            value={inlineTitleValue}
            onBlur={handleInlineBlur}
            onChange={(e) => setInlineTitleValue(e.target.value)}
            onCompositionEnd={() => {
              isComposingRef.current = false
            }}
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onKeyDown={handleInlineKeyDown}
          />
        ) : (
          <span
            aria-busy={titleRegenerating}
            aria-label={canInlineEdit ? `重命名对话：${renderedSessionTitle}` : undefined}
            aria-live="polite"
            className={
              canInlineEdit
                ? 'chat-session-title__text tw:inline-flex tw:min-w-0 tw:items-center tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:cursor-pointer tw:rounded-sm tw:hover:underline'
                : 'chat-session-title__text tw:inline-flex tw:min-w-0 tw:items-center tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap'
            }
            role={canInlineEdit ? 'button' : undefined}
            tabIndex={canInlineEdit ? 0 : undefined}
            title={renderedSessionTitle}
            onClick={canInlineEdit ? startInlineEdit : undefined}
            onKeyDown={canInlineEdit ? handleTitleKeyDown : undefined}
          >
            {isThreadLoading ? (
              '加载对话中'
            ) : titleRegenerating ? (
              <>
                <SkeletonBlock className="chat-session-title__skeleton tw:h-[1em] tw:w-[clamp(6rem,18vw,11.25rem)] tw:rounded-md" />
                <span className="tw:sr-only">正在更新会话标题</span>
              </>
            ) : (
              renderedSessionTitle
            )}
          </span>
        )}
        <PopoverMenu
          align="start"
          className="popover-session-actions popover-menu--grid"
          open={sessionMenuOpen}
          size="sm"
          trigger={
            <Button isIconOnly color="ghostSecondary" size="toolbar" title="更多会话操作">
              <MoreHorizontal
                size={WORKSPACE_HEADER_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </Button>
          }
          onOpenChange={setSessionMenuOpen}
        >
          <PopoverCheckboxItem
            checked={isSessionPinned}
            icon={<Pin size={APP_ICON_SIZE} />}
            shortcut="Ctrl+Alt+P"
            disabled={!hasActiveSession}
            onCheckedChange={toggleSessionPinned}
          >
            置顶对话
          </PopoverCheckboxItem>
          <PopoverItem
            disabled={!hasActiveSession || renamingSession}
            icon={<Pencil size={APP_ICON_SIZE} />}
            onClick={openRenameSessionDialog}
          >
            重命名对话
          </PopoverItem>
          <PopoverItem
            disabled={!canRegenerateSessionTitle}
            icon={<Sparkles size={APP_ICON_SIZE} />}
            onClick={() => void regenerateCurrentSessionTitle()}
          >
            {titleRegenerating ? '正在更新会话标题…' : '更新会话标题'}
          </PopoverItem>
          <PopoverItem
            disabled={!hasActiveSession}
            icon={<Archive size={APP_ICON_SIZE} />}
            shortcut="Ctrl+Shift+A"
            onClick={archiveCurrentSession}
          >
            归档对话
          </PopoverItem>
          <PopoverSeparator />
          <PopoverItem
            disabled={
              !activeSessionId ||
              effectiveSessionStatus === 'running' ||
              effectiveSessionStatus === 'waiting' ||
              effectiveSessionStatus === 'queued'
            }
            icon={<MessagesSquare size={APP_ICON_SIZE} />}
            onClick={() => {
              closeSessionMenu()
              if (activeSessionId) void chooseSessionGroupForThread(activeSessionId)
            }}
          >
            {effectiveSessionStatus === 'running' ||
            effectiveSessionStatus === 'waiting' ||
            effectiveSessionStatus === 'queued'
              ? '当前 Turn 结束后可切换'
              : '加入或切换工作流'}
          </PopoverItem>
          <PopoverSeparator />
          <PopoverItem
            disabled={!hasActiveSession || !sideChatAvailable}
            icon={<MessageSquarePlus size={APP_ICON_SIZE} />}
            onClick={onOpenSideChat}
          >
            打开侧边聊天
          </PopoverItem>
          <SessionSubmenu
            disabled={!hasActiveSession && !workspacePath}
            icon={<Copy size={APP_ICON_SIZE} />}
            label="复制"
          >
            <PopoverItem
              disabled={!workspacePath}
              icon={<Copy size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Shift+C"
              onClick={copyWorkspaceReference}
            >
              复制工作目录
            </PopoverItem>
            <PopoverItem
              disabled={!hasActiveSession}
              icon={<Copy size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Alt+C"
              onClick={copyThreadReference}
            >
              复制会话 ID
            </PopoverItem>
            <PopoverItem
              disabled={!hasActiveSession}
              icon={<Copy size={APP_ICON_SIZE} />}
              shortcut="Ctrl+Alt+L"
              onClick={copyThreadDeepLinkReference}
            >
              复制深度链接
            </PopoverItem>
          </SessionSubmenu>
          <SessionSubmenu
            disabled={!conversationFork.onForkFromMessage || !latestConversationForkPoint}
            icon={<Split size={APP_ICON_SIZE} />}
            label="继续到…"
          >
            <PopoverItem
              disabled={!conversationFork.onForkFromMessage || !latestConversationForkPoint}
              icon={<Split size={APP_ICON_SIZE} />}
              onClick={continueInNewConversation}
            >
              在新聊天中继续
            </PopoverItem>
          </SessionSubmenu>
          <PopoverItem icon={<Workflow size={APP_ICON_SIZE} />} onClick={openAutomationView}>
            添加自动化...
          </PopoverItem>
          <PopoverSeparator />
          <PopoverItem
            disabled={!activeSessionId}
            icon={<AppWindow size={APP_ICON_SIZE} />}
            onClick={openConversationInNewWindow}
          >
            在新窗口中打开
          </PopoverItem>
        </PopoverMenu>
      </div>
    )
  }, [
    activeSessionId,
    canInlineEdit,
    canRegenerateSessionTitle,
    conversationFork.onForkFromMessage,
    handleInlineBlur,
    handleInlineInputRef,
    handleInlineKeyDown,
    handleTitleKeyDown,
    hasActiveSession,
    inlineTitleValue,
    isInlineEditing,
    isThreadLoading,
    isSessionPinned,
    latestConversationForkPoint,
    openRenameSessionDialog,
    openConversationInNewWindow,
    regenerateCurrentSessionTitle,
    startInlineEdit,
    titleRegenerating,
    renamingSession,
    renderedSessionTitle,
    sessionMenuOpen,
    projectDetailsTrigger,
    workspacePath,
  ])

  const workspaceHeaderActions = React.useMemo(() => {
    const summaryAvailable = !isThreadLoading && threadSummaryModel.hasContent
    const summaryPanel = (
      <ThreadSummaryErrorBoundary>
        <ThreadSummaryPanel
          key={activeSessionId ?? 'thread-summary'}
          branches={branches}
          collapsedSections={collapsedSections}
          model={threadSummaryModel}
          workspaceActions={launchActions}
          environmentChoices={environmentChoices}
          selectedActionId={selectedLaunchActionId}
          onSelectAction={setSelectedLaunchActionId}
          onActivateBrowserTab={onActivateBrowserTab}
          onBranchSelect={onBranchSelect}
          onCommitOrPush={onCommitOrPush}
          onCreateBranch={onCreateBranch}
          onCreatePullRequest={onCreatePullRequest}
          onCreateOutput={() => onAppendComposerText('请帮我创建文件或站点：')}
          onGitOperation={onGitOperation}
          onAddEnvironmentAction={() =>
            navigate(
              `/settings/worktrees?tab=environments&threadId=${encodeURIComponent(activeSessionId ?? '')}&mode=edit`,
            )
          }
          onOpenEnvironmentSettings={() =>
            navigate(
              `/settings/worktrees?tab=environments&threadId=${encodeURIComponent(activeSessionId ?? '')}`,
            )
          }
          onOpenTerminal={onOpenTerminal}
          pushEnabled={Boolean(
            gitStatus?.branchName && (!gitStatus.upstream || gitStatus.ahead > 0),
          )}
          onMoveToWorktree={
            handoffAction
              ? () => {
                  void handoffAction.execute()
                }
              : undefined
          }
          onGoalPause={onGoalPause}
          onGoalResume={onGoalResume}
          onOpenArtifact={onOpenArtifact}
          onOpenAttachment={onOpenAttachment}
          onOpenLocalContext={onOpenLocalContext}
          onOpenReview={openBranchReview}
          onRetryGitDetection={onRefreshDiff}
          changesLoading={branchReviewState.loading}
          onOpenSubagent={onOpenSubagent}
          onOpenWorkspacePath={onOpenWorkspacePath}
          onStopSubagent={handleStopSubagent}
          onToggleSection={toggleSummarySection}
        />
      </ThreadSummaryErrorBoundary>
    )
    const summaryToggle = (
      <Button
        isIconOnly
        color={
          threadSummary.displayMode === 'overlay'
            ? threadSummary.isPopoverOpen
              ? 'ghostActive'
              : 'ghostSecondary'
            : threadSummary.isPinned
              ? 'ghostActive'
              : 'ghostSecondary'
        }
        title={
          threadSummary.displayMode === 'overlay'
            ? threadSummary.isPopoverOpen
              ? '关闭置顶摘要'
              : '打开置顶摘要'
            : threadSummary.isPinned
              ? '取消置顶摘要'
              : '置顶摘要'
        }
        aria-pressed={
          threadSummary.displayMode === 'overlay'
            ? threadSummary.isPopoverOpen
            : threadSummary.isPinned
        }
        size="toolbar"
        onClick={threadSummary.displayMode === 'overlay' ? undefined : threadSummary.toggle}
      >
        <LayoutList size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      </Button>
    )

    return (
      <div className="chat-session-actions tw:inline-flex tw:flex-none tw:items-center tw:gap-1 tw:whitespace-nowrap">
        {threadSummary.displayMode === 'overlay' ? (
          summaryAvailable ? (
            <ThreadSummaryPopover
              open={threadSummary.isPopoverOpen}
              panel={summaryPanel}
              onOpenChange={threadSummary.setPopoverOpen}
            >
              {summaryToggle}
            </ThreadSummaryPopover>
          ) : (
            <Tooltip content="当前对话暂无可展示的摘要">{summaryToggle}</Tooltip>
          )
        ) : (
          <Tooltip content="置顶摘要">{summaryToggle}</Tooltip>
        )}
      </div>
    )
  }, [
    branches,
    activeSessionId,
    collapsedSections,
    toggleSummarySection,
    isThreadLoading,
    onRefreshDiff,
    openBranchReview,
    branchReviewState.loading,
    onGitOperation,
    onOpenTerminal,
    gitStatus,
    gitDetection,
    handoffAction,
    onAppendComposerText,
    handleStopSubagent,
    browserTabs,
    threadGoal,
    onGoalPause,
    onGoalResume,
    onOpenArtifact,
    onActivateBrowserTab,
    onOpenAttachment,
    onOpenLocalContext,
    onBranchSelect,
    onCommitOrPush,
    onCreateBranch,
    onCreatePullRequest,
    onOpenPlanInRightDock,
    onOpenSubagent,
    onOpenWorkspacePath,
    navigate,
    settingsDraft.setValue,
    settingsDraft.values.terminalProfileId,
    setSidebarSessionPins,
    threadSummary,
    threadSummaryModel,
    launchActions,
    environmentChoices,
    selectedLaunchActionId,
    workspacePath,
  ])

  const composerFooter =
    !isThreadLoading && composerProps ? (
      <ThreadComposerDock ref={composerTransition.ref} style={composerTransition.style}>
        <AnimatePresence initial={false}>
          {showComposerStatusSummary ? (
            <ComposerFooterPresence key="composer-change-summary" reducedMotion={reduceMotion}>
              <ComposerChangeSummary
                active={
                  effectiveSessionStatus === 'running' || effectiveSessionStatus === 'waiting'
                }
                additions={conversationChangeSummary.additions}
                canReturnToBottom={canReturnTimelineToBottom}
                changedFiles={conversationChangeSummary.files}
                deletions={conversationChangeSummary.deletions}
                executionPlan={composerExecutionPlan}
                failed={effectiveSessionStatus === 'error'}
                onOpenReview={openReviewSidebar}
                onOpenReviewFile={onOpenPatchReview}
                onReturnToBottom={returnTimelineToBottom}
              />
            </ComposerFooterPresence>
          ) : null}
        </AnimatePresence>
        <AnimatePresence initial={false}>
          {activePermissionRequest ? (
            <ComposerFooterPresence
              key={activePermissionRequest.requestId}
              reducedMotion={reduceMotion}
            >
              <InlineApprovalCard
                request={activePermissionRequest}
                currentPermissionMode={permissionMode}
                onDecide={onDecidePermission}
                onInterrupt={composerProps.onInterrupt}
              />
            </ComposerFooterPresence>
          ) : pendingPlanApproval && showPlanApproval ? (
            <ComposerFooterPresence key={pendingPlanApproval.id} reducedMotion={reduceMotion}>
              <PlanApprovalCard
                approval={pendingPlanApproval}
                disabledReason={planApproval.disabledReason}
                onRespond={planApproval.respond}
                freshAvailable={planApproval.freshAvailable}
                onContinue={() => setDismissedPlan(planKey)}
              />
            </ComposerFooterPresence>
          ) : null}
        </AnimatePresence>
        {!activePermissionRequest && (!pendingPlanApproval || !showPlanApproval) ? (
          <>
            {pendingPlanApproval ? (
              <Button onClick={() => setDismissedPlan(null)}>查看计划批准操作</Button>
            ) : null}
            <DesktopComposer
              {...composerProps}
              canForkConversation={Boolean(
                conversationFork.onForkFromMessage && latestConversationForkPoint,
              )}
              onArchiveConversation={archiveCurrentSession}
              onForkConversation={continueInNewConversation}
              sessionStatus={effectiveSessionStatus}
              contextUsage={canonicalAuxiliary.contextUsage}
              queuedFollowUps={canonicalAuxiliary.queuedFollowUps}
              queuePauseReason={canonicalAuxiliary.queuePauseReason}
              hasConversationMessages={canonicalAuxiliary.hasConversationMessages}
              messages={[]}
            />
          </>
        ) : null}
      </ThreadComposerDock>
    ) : null
  const conversationItemContextValue = React.useMemo(
    () => ({
      modelProviderNames: Object.fromEntries(
        (composerProps?.providerOptions ?? []).map((provider) => [
          provider.providerID,
          provider.displayName,
        ]),
      ),
      canCopyFileReferenceContents,
      onCopyFileReferenceContents,
      onOpenFileReference,
      onOpenAttachment,
      onForkFromMessage: conversationFork.onForkFromMessage,
      onSubmitEditedUserMessage,
      sessionStatus: effectiveSessionStatus,
      workspacePath,
    }),
    [
      composerProps?.providerOptions,
      canCopyFileReferenceContents,
      onCopyFileReferenceContents,
      onOpenFileReference,
      onOpenAttachment,
      conversationFork.onForkFromMessage,
      onSubmitEditedUserMessage,
      effectiveSessionStatus,
      workspacePath,
    ],
  )
  const canonicalThreadView = activeSessionId ? (
    <ConversationItemContext.Provider value={conversationItemContextValue}>
      <CanonicalThreadView
        active={effectiveSessionStatus === 'running' || effectiveSessionStatus === 'waiting'}
        diffMarkerStyle={diffMarkerStyle}
        error={canonicalConversation.error}
        hasOlder={canonicalConversation.hasOlder}
        initialScrollOffset={initialTimelineScrollTop}
        layoutResizeActive={layoutResizeActive}
        listRef={timelineListRef}
        navigationRef={timelineNavigationRef}
        loading={canonicalConversation.loading}
        loadingOlder={canonicalConversation.loadingOlder || canonicalConversation.loadingDirectory}
        historyError={canonicalConversation.directoryError}
        onCanReturnToBottomChange={handleCanReturnToBottomChange}
        onApplyPatch={applyThreadPatch}
        onLoadOlder={
          canonicalConversation.directoryError
            ? loadDirectoryPreservingAnchor
            : loadOlderPreservingAnchor
        }
        onOpenPatchReview={onOpenPatchReview}
        onOpenPlanInRightDock={onOpenPlanInRightDock}
        onOpenSubagent={onOpenSubagent}
        onReload={canonicalConversation.reload}
        onScroll={handleTimelineScroll}
        registerTurnRow={registerTurnRow}
        rightDockPlanEventId={rightDockPlanEventId}
        readThreadPatchDiff={desktopClient.readThreadPatchDiff}
        scrollRef={threadScrollRef}
        threadId={activeSessionId}
        turns={canonicalConversation.turns}
      />
    </ConversationItemContext.Provider>
  ) : null
  return (
    <section
      ref={workflowPageRef}
      className={
        activePermissionRequest
          ? 'conversation-page workflow-page approval-active tw:relative tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-col tw:overflow-hidden tw:bg-app-canvas tw:text-app-text'
          : 'conversation-page workflow-page tw:relative tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-col tw:overflow-hidden tw:bg-app-canvas tw:text-app-text'
      }
    >
      <WorkspaceHeaderItem align="start" id="conversation.title" order={0} slot="left">
        {workspaceHeaderTitle}
      </WorkspaceHeaderItem>
      <WorkspaceHeaderItem align="end" id="conversation.actions" order={100} slot="right">
        {workspaceHeaderActions}
      </WorkspaceHeaderItem>
      <InputDialog
        actionDisabled={renamingSession || renameValue.trim().length === 0}
        actionLabel={renamingSession ? '重命名中…' : '重命名'}
        description="输入新的对话名称。"
        input={{
          value: renameValue,
          onChange: setRenameValue,
          maxLength: 160,
          placeholder: '输入对话名称',
        }}
        open={renameDialogOpen}
        title="重命名对话"
        onAction={() => void submitSessionRename()}
        onCancel={() => {
          if (!renamingSession) setRenameDialogOpen(false)
        }}
      />
      {conversationFork.dialog}
      {activeSessionId && workspacePath ? (
        <React.Suspense fallback={null}>
          <ConversationEnvironmentControls
            gitAvailable={Boolean(gitStatus)}
            terminalProfileId={settingsDraft.values.terminalProfileId}
            threadId={activeSessionId}
            workspacePath={workspacePath}
            onOpenEnvironmentSettings={() => {
              navigate(
                `/settings/worktrees?tab=environments&threadId=${encodeURIComponent(activeSessionId)}`,
              )
            }}
            onOpenWorktreeSettings={(projectId) => {
              navigate(`/settings/worktrees?projectId=${encodeURIComponent(projectId)}`)
            }}
            onTransferAuxiliaryState={(targetThreadId) => {
              setSidebarSessionPins((current) => {
                const pinnedAt = current[activeSessionId]
                return pinnedAt ? { ...current, [targetThreadId]: pinnedAt } : current
              })
            }}
            onNavigateTarget={(targetThreadId) => {
              navigate(`/threads/${encodeURIComponent(targetThreadId)}`)
            }}
          />
        </React.Suspense>
      ) : null}
      <div className="workflow-page__body tw:flex tw:w-full tw:min-h-0 tw:flex-1 tw:overflow-hidden">
        <main
          ref={workflowMainRef}
          className="workflow-page__main tw:relative tw:flex tw:min-w-0 tw:min-h-0 tw:flex-1 tw:flex-col tw:bg-transparent"
          data-thread-summary-inline={
            (!isThreadLoading && threadSummary.shouldShowInline && threadSummaryModel.hasContent) ||
            undefined
          }
          data-thread-summary-mode={threadSummary.displayMode}
        >
          <div className="workflow-main-scroll-frame tw:relative tw:flex tw:min-w-0 tw:min-h-0 tw:flex-1 tw:overflow-hidden">
            <ConversationTurnNavRail
              key={activeSessionId}
              items={turnNavItems}
              onNavigate={handleTurnNavigate}
              visibilityStore={visibilityStore}
              onInlineClearanceChange={setHasRailInlineClearance}
              bookmarkedInputIds={threadBookmarks?.inputIds ?? null}
              onToggleBookmark={toggleThreadBookmark}
            />
            <ThreadScrollLayout
              className="workflow-main-scroll-area tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:overflow-hidden"
              footer={composerFooter}
              footerClassName="workflow-main-scroll-footer tw:px-0 tw:pb-3"
              footerRef={threadFooterRef}
              scrollRef={threadScrollRef}
            >
              <AppContextMenu
                actions={
                  showConversationContextMenu
                    ? [
                        {
                          kind: 'item',
                          label: '添加到对话',
                          onSelect: handleAddToConversation,
                        },
                        {
                          kind: 'item',
                          label: '在侧边聊天中提问',
                          disabled: !sideChatAvailable,
                          onSelect: handleAskInSideChat,
                        },
                      ]
                    : []
                }
                layout="flex"
                onOpenChange={(open) => {
                  if (!open) {
                    clearConversationSelectionHighlight()
                  }
                }}
                trigger={
                  <div
                    className="session-timeline-wrapper tw:relative tw:mx-auto tw:flex tw:h-auto tw:w-full tw:min-h-0 tw:flex-[1_0_auto] tw:flex-col tw:[container-type:inline-size]"
                    onContextMenu={handleConversationContextMenu}
                  >
                    <div className="session-timeline-main tw:flex tw:min-w-0 tw:min-h-0 tw:flex-[1_0_auto] tw:flex-col tw:overflow-visible">
                      {isThreadLoading ? (
                        <FullScreenWhaleLoading label="正在加载会话内容…" variant="contained" />
                      ) : (
                        <div className="session-timeline-loaded-presence tw:flex tw:w-full tw:min-h-0 tw:flex-[1_0_auto] tw:flex-col tw:animate-[session-timeline-fade-in_var(--cpx-sys-motion-panel)_var(--cpx-sys-ease-out)_both]">
                          {subagents.length ? (
                            <div
                              className="subagent-timeline-summary tw:mx-auto tw:my-2 tw:flex tw:w-[min(760px,calc(100%-32px))] tw:flex-col tw:gap-1"
                              aria-label="子智能体任务"
                            >
                              {subagents.map(({ task, currentRun }) => (
                                <button
                                  key={task.id}
                                  type="button"
                                  onClick={() => onOpenSubagent(task.id)}
                                  className="tw:grid tw:min-h-[34px] tw:grid-cols-[18px_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:rounded-md tw:border-0 tw:bg-app-editor tw:px-3 tw:py-2 tw:text-left tw:text-app-text tw:cursor-pointer tw:hover:bg-app-hover"
                                >
                                  <Bot size={APP_ICON_SIZE} />
                                  <span className="tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                                    {task.displayName}
                                  </span>
                                  <small className="tw:whitespace-nowrap tw:text-app-text-soft">
                                    {subagentStatusLabel(currentRun?.status ?? 'interrupted')}
                                  </small>
                                </button>
                              ))}
                            </div>
                          ) : null}
                          {canonicalThreadView}
                        </div>
                      )}
                    </div>
                  </div>
                }
                size="md"
              />
            </ThreadScrollLayout>
          </div>
          <AnimatePresence initial={false}>
            {!isThreadLoading && threadSummary.shouldShowInline && threadSummaryModel.hasContent ? (
              <ThreadSummaryInlinePresence key="thread-summary-inline" reducedMotion={reduceMotion}>
                <ThreadSummaryErrorBoundary>
                  <ThreadSummaryPanel
                    key={activeSessionId ?? 'thread-summary'}
                    branches={branches}
                    collapsedSections={collapsedSections}
                    model={threadSummaryModel}
                    workspaceActions={launchActions}
                    environmentChoices={environmentChoices}
                    selectedActionId={selectedLaunchActionId}
                    onSelectAction={setSelectedLaunchActionId}
                    onActivateBrowserTab={onActivateBrowserTab}
                    onBranchSelect={onBranchSelect}
                    onCommitOrPush={onCommitOrPush}
                    onCreateBranch={onCreateBranch}
                    onCreatePullRequest={onCreatePullRequest}
                    onCreateOutput={() => onAppendComposerText('请帮我创建文件或站点：')}
                    onGitOperation={onGitOperation}
                    onAddEnvironmentAction={() =>
                      navigate(
                        `/settings/worktrees?tab=environments&threadId=${encodeURIComponent(activeSessionId ?? '')}&mode=edit`,
                      )
                    }
                    onOpenEnvironmentSettings={() =>
                      navigate(
                        `/settings/worktrees?tab=environments&threadId=${encodeURIComponent(activeSessionId ?? '')}`,
                      )
                    }
                    onOpenTerminal={onOpenTerminal}
                    pushEnabled={Boolean(
                      gitStatus?.branchName && (!gitStatus.upstream || gitStatus.ahead > 0),
                    )}
                    onMoveToWorktree={
                      handoffAction
                        ? () => {
                            void handoffAction.execute()
                          }
                        : undefined
                    }
                    onGoalPause={onGoalPause}
                    onGoalResume={onGoalResume}
                    onOpenArtifact={onOpenArtifact}
                    onOpenAttachment={onOpenAttachment}
                    onOpenLocalContext={onOpenLocalContext}
                    onOpenReview={openBranchReview}
                    onRetryGitDetection={onRefreshDiff}
                    changesLoading={branchReviewState.loading}
                    onOpenSubagent={onOpenSubagent}
                    onOpenWorkspacePath={onOpenWorkspacePath}
                    onStopSubagent={handleStopSubagent}
                    onToggleSection={toggleSummarySection}
                  />
                </ThreadSummaryErrorBoundary>
              </ThreadSummaryInlinePresence>
            ) : null}
          </AnimatePresence>
        </main>
      </div>
    </section>
  )
}

function ComposerFooterPresence({
  children,
  reducedMotion,
}: {
  children: React.ReactNode
  reducedMotion: boolean
}): React.ReactNode {
  const isPresent = useIsPresent()

  return (
    <motion.div
      animate={{ opacity: 1, scale: 1, y: 0 }}
      aria-hidden={!isPresent ? true : undefined}
      className="composer-lifecycle-presence tw:flex tw:w-full tw:max-w-full tw:justify-center"
      data-presence={isPresent ? 'present' : 'exiting'}
      exit={{
        opacity: 0,
        scale: 0.985,
        y: 4,
        transition: motionTransition(reducedMotion, exitTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.985, y: 4 }}
      style={{ pointerEvents: isPresent ? undefined : 'none' }}
      transition={motionTransition(reducedMotion, enterTween)}
    >
      {children}
    </motion.div>
  )
}

function ThreadSummaryInlinePresence({
  children,
  reducedMotion,
}: {
  children: React.ReactNode
  reducedMotion: boolean
}): React.ReactNode {
  const isPresent = useIsPresent()

  return (
    <motion.div
      animate={{ opacity: 1, x: 0 }}
      aria-hidden={!isPresent ? true : undefined}
      className="thread-summary-inline tw:absolute tw:top-4 tw:bottom-4 tw:end-[var(--thread-summary-inline-edge)] tw:z-sticky tw:w-[var(--thread-summary-inline-width)] tw:min-h-0 tw:origin-right"
      data-presence={isPresent ? 'present' : 'exiting'}
      data-testid="thread-summary-inline"
      exit={{
        opacity: 0,
        x: 6,
        transition: motionTransition(reducedMotion, exitTween),
      }}
      inert={!isPresent ? true : undefined}
      initial={reducedMotion ? false : { opacity: 0, x: 6 }}
      style={{ pointerEvents: isPresent ? undefined : 'none' }}
      transition={motionTransition(reducedMotion, enterTween)}
    >
      {children}
    </motion.div>
  )
}

function SessionSubmenu({
  children,
  disabled,
  icon,
  label,
}: {
  children: React.ReactNode
  disabled?: boolean
  icon: React.ReactNode
  label: string
}): React.ReactNode {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        className="popover-item popover-sub-trigger"
        disabled={disabled}
        tabIndex={-1}
      >
        <span className="popover-item-leading">
          <span className="popover-item-icon">{icon}</span>
        </span>
        <span className="popover-item-label">{label}</span>
        <span className="popover-item-trailing">
          <ChevronRight className="popover-item-arrow" size={APP_ICON_SIZES.sm} />
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          size="sm"
          data-theme-component="dropdown-surface"
          className="popover-surface popover popover-sub-content popover-menu--grid"
          collisionPadding={6}
          sideOffset={4}
          style={buildPopoverSizingStyle({ size: 'md' })}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  )
}

type WorkflowComposerMode = 'chat' | 'brainstorm' | 'plan' | 'permission'

function workflowComposerMode(request: DesktopPermissionRequest | null): WorkflowComposerMode {
  if (!request) return 'chat'
  if (request.toolName === 'AskUserQuestion') return 'brainstorm'
  return 'permission'
}

export function shouldShowComposerStatusSummary({
  hasPlan,
  changedFileCount,
}: {
  hasPlan: boolean
  changedFileCount: number
}): boolean {
  return hasPlan || changedFileCount > 0
}
