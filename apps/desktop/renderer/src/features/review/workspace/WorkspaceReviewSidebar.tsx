import React from 'react'
import { motion } from 'motion/react'
import {
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Columns2,
  Ellipsis,
  Eye,
  ExternalLink,
  FileDiff,
  GitCommitHorizontal,
  GitFork,
  GitPullRequestArrow,
  MessageSquarePlus,
  Minus,
  Plus,
  RotateCcw,
  Rows2,
  Search,
  Undo2,
  WrapText,
  createLucideIcon,
} from 'lucide-react'
import type {
  DesktopDiffMarkerStyle,
  DesktopGitStatus,
  DesktopReviewComment,
  DesktopReviewDiffFile,
  DesktopReviewDiffHunk,
  DesktopReviewDiffLine,
  DesktopReviewDiffResult,
  DesktopReviewScope,
  DesktopReviewSource,
  DesktopReviewSide,
  DesktopReviewView,
  DesktopSessionStatus,
} from '../../../../shared/Types.js'
import {
  desktopClient,
  WORKSPACE_GIT_CHANGED_EVENT,
} from '../../../services/desktop-client/index.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'

import {
  PopoverCheckboxItem,
  PopoverItem,
  PopoverRadioGroup,
  PopoverRadioItem,
} from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import {
  createKeyedDisclosureStore,
  type KeyedDisclosureStore,
} from '../../../components/ui/KeyedDisclosureStore.js'
import { useLiveResizeValue } from '../../layout/UseLiveResizeValue.js'
import { buildReviewFileTree } from './BuildReviewFileTree.js'
import { buildCommentCountsByPath } from '../comments/ReviewCommentUtils.js'
import { CommitPopover } from './CommitPopover.js'
import { PullRequestPopover } from './PullRequestPopover.js'
import { ReviewFileTreeResizeController } from './ReviewFileTreeResizeController.js'
import { ReviewFileTreeController } from './ReviewFileTreeController.js'
import { ReviewFileTreePanelPresence } from './ReviewFileTreePanelPresence.js'
import { formatReviewCount } from '../diff/ReviewFormat.js'
import {
  isReviewDiffExpanded,
  type ReviewDiffExpansion,
  type ReviewTabUiState,
} from '../../layout/tabs/ConversationUiState.js'
import { syntaxTokenStyle } from '../../syntax/CodeBlock.js'
import { resolveLanguageFromPath } from '../../syntax/Language.js'
import { resolveThemeId } from '../../syntax/Theme.js'
import type { SyntaxToken } from '../../syntax/Types.js'
import { useHighlightedCode } from '../../syntax/UseHighlightedCode.js'
import { useDesktopTheme } from '../../theme/ThemeContext.js'
import {
  ReviewFileRequestCoordinator,
  reviewAgentClient,
  retainCurrentReviewFileDiffs,
  reviewLoadStateForError,
  reviewSourceKey,
  summaryFileToDesktop,
  type ReviewBranch,
  type ReviewCommit,
  type ReviewFileDiff,
  type ReviewLoadState,
  type ReviewSummarySnapshot,
} from '../source/ReviewAgentClient.js'
import { ReviewOptionsMenu } from './ReviewOptionsMenu.js'
import { ReviewSourceMenu } from '../source/ReviewSourceMenu.js'
import {
  reportReviewDiagnostic,
  startReviewDiagnosticTimer,
  type ReviewDiagnosticContext,
  type ReviewDiagnosticTimer,
} from '../source/ReviewDiagnostics.js'
import {
  createReviewCommentIdentity,
  createReviewSummaryIdentity,
  isReviewRequestCurrent,
  reviewGitChangeMatchesProject,
  ReviewAutoRefreshScheduler,
  ReviewRefreshCoordinator,
  shouldDeferReviewRefresh,
  type ReviewRefreshReason,
  type ReviewRequestStamp,
} from '../state/ReviewRefreshCoordinator.js'
import {
  ListChevronsDownUp,
  ListChevronsUpDown,
  REVIEW_FILE_TREE_PANEL_MIN_WIDTH,
  ReviewComment,
  ReviewDiffPreview,
  ReviewProjectEmptyState,
  attachComments,
  clampReviewFileTreePanelWidth,
  buildReviewComposerPrompt,
  copyGitApplyCommand,
  errorMessageOf,
  formatPanelNumber,
  parseGithubPullRequestUrl,
  reviewFileDiffLoadMode,
  type CommentDraft,
  type ReviewFileLoadState,
} from '../diff/WorkspaceReviewDiff.js'
import { filterStatusForFile, type ReviewFilter } from './ReviewFileStatus.js'
import { hideImportOnlyHunks } from '../diff/ReviewDiffAdapter.js'
import { cx } from '../../../utils/Cx.js'

const REVIEW_FILE_TREE_RUNTIME_MIN_WIDTH = REVIEW_FILE_TREE_PANEL_MIN_WIDTH + 8 + 260

/*
 * Complete static class lists for the sidebar shell. The semantic class names
 * stay in the DOM as query hooks; `in-[.workbench-panel]` reproduces the old
 * `.workbench-panel .review-sidebar` override so a docked sidebar fills its
 * workbench panel instead of keeping the standalone column metrics.
 */
const REVIEW_SIDEBAR_CLASS =
  'review-sidebar tw:@container tw:flex tw:h-full tw:min-h-0 tw:flex-col tw:overflow-hidden tw:border-l tw:border-app-border-subtle tw:bg-app-panel tw:text-app-text tw:shadow-none tw:in-[.workbench-panel]:flex-auto tw:in-[.workbench-panel]:w-full tw:in-[.workbench-panel]:min-w-0 tw:in-[.workbench-panel]:max-w-none tw:in-[.workbench-panel]:border-l-0'
const REVIEW_SIDEBAR_TOOLBAR_CLASS =
  'tw:box-border tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:min-h-12 tw:items-start tw:gap-2 tw:border-b tw:border-app-border-subtle tw:bg-app-dock tw:px-2 tw:py-2 tw:shadow-none'
const REVIEW_COUNTS_CLASS = 'tw:inline-flex tw:items-center tw:gap-2'
const REVIEW_FOOTER_CLASS =
  'tw:absolute tw:bottom-2.5 tw:left-1/2 tw:z-local tw:flex tw:-translate-x-1/2 tw:items-center tw:justify-center tw:gap-4 tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-1 tw:shadow-none'

function reviewDiffExpansionFromKeys(
  allPaths: readonly string[],
  expandedKeys: readonly string[],
): ReviewDiffExpansion {
  const expanded = new Set(expandedKeys)
  const expandedFiles = allPaths.filter((path) => expanded.has(path))
  if (expandedFiles.length === 0) return { mode: 'none' }
  if (expandedFiles.length === allPaths.length) return { mode: 'all' }
  return { mode: 'custom', expandedFiles }
}

const ReviewDiffExpansionToggle = React.memo(function ReviewDiffExpansionToggle({
  allPaths,
  store,
  onSetAllExpanded,
}: {
  allPaths: readonly string[]
  store: KeyedDisclosureStore
  onSetAllExpanded: (expanded: boolean) => void
}): React.ReactNode {
  React.useSyncExternalStore(store.subscribeAll, store.getVersion, store.getVersion)
  const allCollapsed = allPaths.length > 0 && allPaths.every((path) => !store.getSnapshot(path))
  return (
    <Tooltip content={allCollapsed ? '展开全部差异' : '折叠全部差异'}>
      <Button
        isIconOnly
        color="ghostSecondary"
        size="toolbar"
        title={allCollapsed ? '展开全部差异' : '折叠全部差异'}
        onClick={() => onSetAllExpanded(allCollapsed)}
      >
        {allCollapsed ? (
          <ListChevronsUpDown size={APP_ICON_SIZE} />
        ) : (
          <ListChevronsDownUp size={APP_ICON_SIZE} />
        )}
      </Button>
    </Tooltip>
  )
})

/**
 * `auto` refreshes come from Git change notifications after the workspace has
 * been quiet; `immediate` refreshes come from opening, switching, manual
 * refresh or a completed mutation, and cancel any pending auto refresh.
 */
export type WorkspaceReviewSidebarProps = {
  activeSessionId: string | null
  projectId: string | null
  defaultBranch: string | null
  gitStatus: DesktopGitStatus | null
  diffMarkerStyle: DesktopDiffMarkerStyle
  isRefreshing: boolean
  reviewView: DesktopReviewView
  reviewTabState: ReviewTabUiState
  sessionStatus: DesktopSessionStatus
  workspacePath: string | null
  onAppendComposerText?: (text: string) => void
  onReviewSummaryChange?: (summary: ReviewSummarySnapshot | null) => void
  onOpenReviewFile?: (path: string) => void
  onClose: () => void
  onCreateBranch: () => void
  onOpenWorkspacePath: () => void
  onRefreshDiff: () => void
  onReviewTabStateChange: (
    value: ReviewTabUiState | ((current: ReviewTabUiState) => ReviewTabUiState),
  ) => void
  onToggleReviewView: () => void
}

function WorkspaceReviewSidebarImpl({
  activeSessionId,
  projectId,
  defaultBranch,
  gitStatus,
  isRefreshing,
  diffMarkerStyle,
  reviewView,
  reviewTabState,
  sessionStatus,
  workspacePath,
  onAppendComposerText,
  onReviewSummaryChange,
  onOpenReviewFile,
  onClose,
  onCreateBranch,
  onOpenWorkspacePath,
  onRefreshDiff,
  onReviewTabStateChange,
  onToggleReviewView,
}: WorkspaceReviewSidebarProps): React.ReactNode {
  const [reviewCapabilities, setReviewCapabilities] = React.useState<readonly string[]>([])
  React.useEffect(() => {
    let active = true
    void desktopClient
      .getRuntimeCapabilities()
      .then((capabilities) => {
        if (active) setReviewCapabilities(capabilities)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  const source = reviewTabState.source
  const summaryIdentity = createReviewSummaryIdentity(projectId, workspacePath, source)
  const commentIdentity = createReviewCommentIdentity(summaryIdentity, activeSessionId)
  const scope: DesktopReviewScope = source.kind === 'staged' ? 'staged' : 'unstaged'
  const [reviewDiffState, setReviewDiff] = React.useState<Awaited<
    ReturnType<typeof desktopClient.getWorkspaceReviewDiff>
  > | null>(null)
  const [summaryState, setSummary] = React.useState<ReviewSummarySnapshot | null>(null)
  const summaryStateIdentityRef = React.useRef(summaryIdentity)
  const summary = summaryStateIdentityRef.current === summaryIdentity ? summaryState : null
  const reviewDiff = summaryStateIdentityRef.current === summaryIdentity ? reviewDiffState : null
  React.useEffect(() => {
    onReviewSummaryChange?.(summary)
  }, [summary, onReviewSummaryChange])
  const [loadedDiffs, setLoadedDiffs] = React.useState<ReadonlyMap<string, ReviewFileDiff>>(
    () => new Map(),
  )
  const [fileLoadStates, setFileLoadStates] = React.useState<
    ReadonlyMap<string, ReviewFileLoadState>
  >(() => new Map())
  const [batchLargeModeKey, setBatchLargeModeKey] = React.useState<string | null>(null)
  const [branches, setBranches] = React.useState<ReviewBranch[]>([])
  const [commits, setCommits] = React.useState<ReviewCommit[]>([])
  const [sourceOptionsState, setSourceOptionsState] = React.useState<
    'idle' | 'loading' | 'ready' | 'error'
  >('idle')
  const [sourceOptionsRetry, setSourceOptionsRetry] = React.useState(0)
  const [commentsState, setComments] = React.useState<DesktopReviewComment[]>([])
  const commentsStateIdentityRef = React.useRef(commentIdentity)
  const comments = commentsStateIdentityRef.current === commentIdentity ? commentsState : []
  const selectedPath = reviewTabState.selectedFile
  const setSelectedPath = React.useCallback(
    (value: string | null | ((current: string | null) => string | null)) => {
      onReviewTabStateChange((current) => ({
        ...current,
        selectedFile: typeof value === 'function' ? value(current.selectedFile) : value,
      }))
    },
    [onReviewTabStateChange],
  )
  const [search, setSearch] = React.useState('')
  const [filter, setFilter] = React.useState<ReviewFilter>('all')
  const [filterMenuOpen, setFilterMenuOpen] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [loadState, setLoadState] = React.useState<ReviewLoadState>('loading')
  const [draft, setDraft] = React.useState<CommentDraft | null>(null)

  const [autoHideFileList, setAutoHideFileList] = React.useState(false)
  const hideFileList = !reviewTabState.fileTreeVisible || autoHideFileList
  const setHideFileList = React.useCallback(
    (value: boolean | ((current: boolean) => boolean)) => {
      onReviewTabStateChange((current) => {
        const nextHidden = typeof value === 'function' ? value(!current.fileTreeVisible) : value
        return { ...current, fileTreeVisible: !nextHidden }
      })
    },
    [onReviewTabStateChange],
  )
  const [reviewContentWidth, setReviewContentWidth] = React.useState<number>()
  const fileTreePanelWidth = clampReviewFileTreePanelWidth(
    reviewTabState.fileTreeWidth,
    reviewContentWidth,
  )
  const {
    liveSize: liveFileTreePanelWidth,
    liveSizePixels: liveFileTreePanelWidthPixels,
    previewSize: previewFileTreePanelWidth,
  } = useLiveResizeValue(fileTreePanelWidth)
  const setFileTreePanelWidth = React.useCallback(
    (value: number | ((current: number) => number)) => {
      React.startTransition(() => {
        onReviewTabStateChange((current) => ({
          ...current,
          fileTreeWidth: typeof value === 'function' ? value(current.fileTreeWidth) : value,
        }))
      })
    },
    [onReviewTabStateChange],
  )
  const [scopeMenuOpen, setScopeMenuOpen] = React.useState(false)
  const [branchSearch, setBranchSearch] = React.useState('')
  const [branchPickerOpen, setBranchPickerOpen] = React.useState(false)
  const [commitPopoverOpen, setCommitPopoverOpen] = React.useState(false)
  const [prPopoverOpen, setPrPopoverOpen] = React.useState(false)
  const [currentPullRequestUrl, setCurrentPullRequestUrl] = React.useState<string | null>(null)
  const [moreMenuOpen, setMoreMenuOpen] = React.useState(false)
  const wordWrap = reviewTabState.wrapLines
  const richDiffPreview = reviewTabState.richPreview
  const textDiff = reviewTabState.showWordDiff
  const updateReviewBoolean = React.useCallback(
    (
      key:
        | 'wrapLines'
        | 'richPreview'
        | 'showWordDiff'
        | 'hideWhitespace'
        | 'loadFullFiles'
        | 'hideImports',
      value: boolean | ((current: boolean) => boolean),
    ) => {
      onReviewTabStateChange((current) => ({
        ...current,
        [key]: typeof value === 'function' ? value(Boolean(current[key])) : value,
      }))
    },
    [onReviewTabStateChange],
  )
  const setWordWrap = React.useCallback(
    (value: boolean | ((current: boolean) => boolean)) => updateReviewBoolean('wrapLines', value),
    [updateReviewBoolean],
  )
  const selectSource = React.useCallback(
    (nextSource: DesktopReviewSource) => {
      onReviewTabStateChange((current) => ({
        ...current,
        source: nextSource,
        selectedFile: null,
        selectedCommentId: null,
        scrollTop: 0,
        diffExpansion: { mode: 'all' },
      }))
      setScopeMenuOpen(false)
    },
    [onReviewTabStateChange],
  )

  React.useEffect(() => {
    if ((!scopeMenuOpen && !branchPickerOpen) || !workspacePath) return
    let active = true
    setSourceOptionsState('loading')
    void Promise.all([
      reviewAgentClient.branches(workspacePath, projectId ?? undefined),
      reviewAgentClient.commits(workspacePath, projectId ?? undefined),
    ]).then(
      ([nextBranches, nextCommits]) => {
        if (!active) return
        setBranches(nextBranches)
        setCommits(nextCommits)
        setSourceOptionsState('ready')
      },
      () => {
        if (active) setSourceOptionsState('error')
      },
    )
    return () => {
      active = false
    }
  }, [branchPickerOpen, scopeMenuOpen, sourceOptionsRetry, projectId, workspacePath])

  const moreButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const wideActionsFocusRef = React.useRef(false)
  const reviewMainRef = React.useRef<HTMLDivElement | null>(null)
  const fileTreeToggleRef = React.useRef<HTMLButtonElement | null>(null)
  const reviewRootRef = React.useRef<HTMLElement | null>(null)
  const staleGitChangeRef = React.useRef(false)
  const summaryRef = React.useRef<ReviewSummarySnapshot | null>(null)
  const summaryCacheStateRef = React.useRef<'fresh' | 'stale' | null>(null)
  const loadedDiffsRef = React.useRef<ReadonlyMap<string, ReviewFileDiff>>(new Map())
  const loadedDiffOptionsRef = React.useRef(new Map<string, boolean>())
  const fileRequestCoordinatorRef = React.useRef(new ReviewFileRequestCoordinator(2))
  const fileRequestIdRef = React.useRef(0)
  const activeFileRequestRef = React.useRef(new Map<string, ReviewRequestStamp>())
  const activeFileDiffBatchRef = React.useRef<string | null>(null)
  const diagnosticTimersRef = React.useRef(new Set<ReviewDiagnosticTimer>())
  const activeDiffContextRef = React.useRef({
    generation: null as string | null,
    hideWhitespace: reviewTabState.hideWhitespace,
    loadFullFiles: reviewTabState.loadFullFiles,
  })
  const expiredFilePathsRef = React.useRef(new Set<string>())
  const beginDiagnosticTimer = React.useCallback(
    (eventPrefix: string, context: ReviewDiagnosticContext) => {
      const timer = startReviewDiagnosticTimer(eventPrefix, context)
      diagnosticTimersRef.current.add(timer)
      const finish =
        (action: 'succeed' | 'fail' | 'cancel') =>
        (extraContext?: ReviewDiagnosticContext): void => {
          if (action === 'succeed') timer.succeed(extraContext)
          else timer[action]()
          diagnosticTimersRef.current.delete(timer)
        }
      return {
        succeed: finish('succeed'),
        fail: finish('fail'),
        cancel: finish('cancel'),
      }
    },
    [],
  )

  React.useEffect(
    () => () => {
      for (const timer of diagnosticTimersRef.current) timer.cancel()
      diagnosticTimersRef.current.clear()
    },
    [summaryIdentity],
  )
  const refreshCoordinatorRef = React.useRef(
    new ReviewRefreshCoordinator<{
      snapshot: ReviewSummarySnapshot
      cacheState: 'fresh' | 'stale'
    }>(),
  )
  const refreshLifecycleGenerationRef = React.useRef(0)
  React.useEffect(() => {
    const coordinator = refreshCoordinatorRef.current
    coordinator.activate()
    autoRefreshRef.current.activate()
    return () => {
      refreshLifecycleGenerationRef.current += 1
      coordinator.dispose()
      autoRefreshRef.current.dispose()
    }
  }, [])
  const activeSummaryIdentityRef = React.useRef(summaryIdentity)
  const activeCommentIdentityRef = React.useRef(commentIdentity)
  activeSummaryIdentityRef.current = summaryIdentity
  activeCommentIdentityRef.current = commentIdentity
  const diffScrollViewportRef = React.useRef<HTMLDivElement | null>(null)
  const diffFileSectionRefs = React.useRef(new Map<string, HTMLElement>())
  const fileSearchInputRef = React.useRef<HTMLInputElement | null>(null)
  const errorTimerRef = React.useRef<number | null>(null)
  const publishedGithubCommentIdsRef = React.useRef(new Set<string>())
  const mutationRequestTokenRef = React.useRef(0)
  const pendingScrollTopRef = React.useRef<number | null>(null)
  const pendingScrollIdentityRef = React.useRef<string | null>(null)
  const scrollPersistTimerRef = React.useRef<number | null>(null)
  const onReviewTabStateChangeRef = React.useRef(onReviewTabStateChange)
  onReviewTabStateChangeRef.current = onReviewTabStateChange
  const flushReviewScroll = React.useCallback(
    (identity: string): void => {
      if (scrollPersistTimerRef.current !== null) {
        window.clearTimeout(scrollPersistTimerRef.current)
        scrollPersistTimerRef.current = null
      }
      const scrollTop = pendingScrollTopRef.current
      const pendingIdentity = pendingScrollIdentityRef.current
      pendingScrollTopRef.current = null
      pendingScrollIdentityRef.current = null
      if (
        scrollTop === null ||
        pendingIdentity !== identity ||
        activeSummaryIdentityRef.current !== identity
      ) {
        return
      }
      const sourceKey = reviewSourceKey(source)
      onReviewTabStateChangeRef.current((current) =>
        reviewSourceKey(current.source) === sourceKey ? { ...current, scrollTop } : current,
      )
    },
    [source],
  )

  const handleReviewScroll = React.useCallback(
    (scrollTop: number): void => {
      const identity = summaryIdentity
      pendingScrollTopRef.current = scrollTop
      pendingScrollIdentityRef.current = identity
      if (scrollPersistTimerRef.current !== null) {
        window.clearTimeout(scrollPersistTimerRef.current)
      }
      scrollPersistTimerRef.current = window.setTimeout(() => flushReviewScroll(identity), 150)
    },
    [flushReviewScroll, summaryIdentity],
  )
  const flushReviewScrollRef = React.useRef(flushReviewScroll)
  flushReviewScrollRef.current = flushReviewScroll

  const autoRefreshRef = React.useRef(new ReviewAutoRefreshScheduler())
  const autoRefreshTargetRef = React.useRef<() => void>(() => {})
  const scheduleAutoRefresh = React.useCallback((): void => {
    autoRefreshRef.current.schedule(() => autoRefreshTargetRef.current())
  }, [])

  const refreshReviewDiff = React.useCallback(
    (force = false, reason: ReviewRefreshReason = 'immediate') => {
      const identity = summaryIdentity
      const lifecycleGeneration = refreshLifecycleGenerationRef.current
      // An explicit refresh supersedes any timer that was waiting on the
      // workspace to settle; the new scan already covers the pending change.
      if (reason !== 'auto') autoRefreshRef.current.cancel()
      const isCurrentRequest = (): boolean =>
        activeSummaryIdentityRef.current === identity &&
        refreshLifecycleGenerationRef.current === lifecycleGeneration
      const cycleStartedAt = performance.now()
      const finishWithError = (
        refreshError: unknown,
        event: string,
        context: ReviewDiagnosticContext,
      ): void => {
        if (!isCurrentRequest()) return
        const busy = shouldDeferReviewRefresh(reason, refreshError)
        reportReviewDiagnostic(busy ? 'warning' : 'error', event, context, refreshError)
        if (summaryRef.current !== null) summaryCacheStateRef.current = 'stale'
        setFileLoadStates((current) => {
          const next = new Map(current)
          for (const [path, state] of next) {
            if (state.status === 'loading') next.delete(path)
          }
          return next
        })
        if (busy) {
          // Keep the current list and diff, stop pretending to load, and retry
          // after the next quiet window instead of surfacing a shared error.
          setLoadState(summaryRef.current !== null ? 'stale' : 'empty')
          scheduleAutoRefresh()
          return
        }
        setLoadState(reviewLoadStateForError(refreshError))
        setError(errorMessageOf(refreshError))
      }
      const request = refreshCoordinatorRef.current.request(
        identity,
        force,
        async (
          refresh,
        ): Promise<{
          snapshot: ReviewSummarySnapshot
          cacheState: 'fresh' | 'stale'
        } | null> => {
          const startedAt = performance.now()
          if (!workspacePath) {
            if (!isCurrentRequest()) return null
            summaryStateIdentityRef.current = identity
            summaryRef.current = null
            summaryCacheStateRef.current = null
            loadedDiffsRef.current = new Map()
            setSummary(null)
            setLoadedDiffs(new Map())
            setFileLoadStates(new Map())
            setReviewDiff(null)
            setLoadState('not-repository')
            return null
          }
          try {
            if (!isCurrentRequest()) return null
            setLoadState((current) =>
              summaryRef.current !== null ||
              current === 'success' ||
              current === 'empty' ||
              current === 'large-diff'
                ? 'stale'
                : 'loading',
            )
            setError(null)
            const diagnosticTimer = beginDiagnosticTimer('review.summary.load', {
              sourceKind: source.kind,
              refresh,
              hasCachedSummary: summaryRef.current !== null,
            })
            let result: Awaited<ReturnType<typeof reviewAgentClient.summary>>
            try {
              result = await reviewAgentClient.summary(
                workspacePath,
                source,
                refresh,
                projectId ?? undefined,
              )
              diagnosticTimer.succeed({ cacheState: result.cacheState })
            } catch (summaryError) {
              diagnosticTimer.fail()
              throw summaryError
            }
            if (!isCurrentRequest()) return null
            const nextSummary = result.snapshot
            summaryCacheStateRef.current = result.cacheState
            const retainedDiffs = retainCurrentReviewFileDiffs(nextSummary, loadedDiffsRef.current)
            const retainedPaths = new Set(retainedDiffs.keys())
            for (const path of loadedDiffOptionsRef.current.keys()) {
              if (!retainedPaths.has(path)) {
                loadedDiffOptionsRef.current.delete(path)
              }
            }
            summaryRef.current = nextSummary
            loadedDiffsRef.current = retainedDiffs
            summaryStateIdentityRef.current = identity
            const expiredPaths =
              result.cacheState === 'fresh'
                ? new Set(expiredFilePathsRef.current)
                : new Set<string>()
            if (result.cacheState === 'fresh') {
              expiredFilePathsRef.current.clear()
            }
            const nextReviewDiff: DesktopReviewDiffResult = {
              activeScope: scope,
              scopes: [
                {
                  scope: 'unstaged',
                  changedFiles: source.kind === 'unstaged' ? nextSummary.totals.files : 0,
                  additions: source.kind === 'unstaged' ? nextSummary.totals.additions : 0,
                  deletions: source.kind === 'unstaged' ? nextSummary.totals.deletions : 0,
                },
                {
                  scope: 'staged',
                  changedFiles: source.kind === 'staged' ? nextSummary.totals.files : 0,
                  additions: source.kind === 'staged' ? nextSummary.totals.additions : 0,
                  deletions: source.kind === 'staged' ? nextSummary.totals.deletions : 0,
                },
              ],
              files: nextSummary.files.map((file) =>
                summaryFileToDesktop(file, retainedDiffs.get(file.path)),
              ),
              status: gitStatus ?? {
                branchName: null,
                upstream: null,
                ahead: 0,
                behind: 0,
                clean: nextSummary.files.length === 0,
                files: [],
              },
            }
            const nextLoadState =
              result.cacheState === 'stale'
                ? 'stale'
                : nextSummary.largeDiffMode
                  ? 'large-diff'
                  : nextSummary.files.length === 0
                    ? 'empty'
                    : 'success'
            React.startTransition(() => {
              if (!isCurrentRequest()) return
              setSummary(nextSummary)
              setLoadedDiffs(retainedDiffs)
              setFileLoadStates((current) => {
                const next = new Map<string, ReviewFileLoadState>()
                for (const file of nextSummary.files) {
                  if (retainedPaths.has(file.path)) {
                    next.set(file.path, { status: 'loaded' })
                    continue
                  }
                  const previous = current.get(file.path)
                  if (previous?.status === 'error' && !expiredPaths.has(file.path)) {
                    next.set(file.path, previous)
                  }
                }
                return next
              })
              setReviewDiff(nextReviewDiff)
              setLoadState(nextLoadState)
            })
            return result
          } catch (refreshError) {
            finishWithError(refreshError, 'review.summary.load.failed', {
              sourceKind: source.kind,
              refresh,
              hasCachedSummary: summaryRef.current !== null,
              durationMs: Math.round(performance.now() - startedAt),
            })
            return null
          }
        },
      )
      return request.catch((refreshError: unknown) => {
        finishWithError(refreshError, 'review.summary.refresh-cycle.failed', {
          sourceKind: source.kind,
          force,
          hasCachedSummary: summaryRef.current !== null,
          durationMs: Math.round(performance.now() - cycleStartedAt),
        })
        return null
      })
    },
    [
      beginDiagnosticTimer,
      gitStatus,
      projectId,
      scheduleAutoRefresh,
      scope,
      source,
      summaryIdentity,
      workspacePath,
    ],
  )

  autoRefreshTargetRef.current = (): void => {
    const root = reviewRootRef.current
    if (root === null || root.offsetParent === null) {
      staleGitChangeRef.current = true
      return
    }
    void refreshReviewDiff(true, 'auto')
  }

  const recoverExpiredReview = React.useCallback(
    async (
      recoveryError: unknown,
      identity: string,
    ): Promise<{
      snapshot: ReviewSummarySnapshot
      cacheState: 'fresh'
    } | null> => {
      if (!reviewAgentClient.isSnapshotExpired(recoveryError)) return null
      const refreshed = await refreshReviewDiff(true)
      if (activeSummaryIdentityRef.current !== identity || refreshed?.cacheState !== 'fresh') {
        return null
      }
      setError(null)
      return {
        snapshot: refreshed.snapshot,
        cacheState: 'fresh',
      }
    },
    [refreshReviewDiff],
  )

  React.useEffect(() => {
    refreshCoordinatorRef.current.invalidate()
    autoRefreshRef.current.cancel()
    fileRequestCoordinatorRef.current = new ReviewFileRequestCoordinator(2)
    summaryRef.current = null
    summaryCacheStateRef.current = null
    loadedDiffsRef.current = new Map()
    loadedDiffOptionsRef.current.clear()
    activeFileRequestRef.current.clear()
    activeFileDiffBatchRef.current = null
    expiredFilePathsRef.current.clear()
    mutationRequestTokenRef.current += 1
    summaryStateIdentityRef.current = summaryIdentity
    setSummary(null)
    setLoadedDiffs(new Map())
    setFileLoadStates(new Map())
    setBatchLargeModeKey(null)
    setReviewDiff(null)
    setLoadState('loading')
    setError(null)
    setPending(false)
    setCurrentPullRequestUrl(null)
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current)
      errorTimerRef.current = null
    }
  }, [summaryIdentity])

  React.useEffect(() => {
    commentsStateIdentityRef.current = commentIdentity
    setComments([])
    setDraft(null)
    publishedGithubCommentIdsRef.current.clear()
  }, [commentIdentity])

  const loadFileDiff = React.useCallback(
    async (
      path: string,
      priority: 'selected' | 'prefetch' = 'prefetch',
      retryExpired = true,
    ): Promise<void> => {
      const identity = summaryIdentity
      if (activeSummaryIdentityRef.current !== identity) return
      const currentSummary = summaryRef.current
      if (!workspacePath || !currentSummary || summaryCacheStateRef.current !== 'fresh') {
        return
      }
      if (
        loadedDiffsRef.current.has(path) &&
        loadedDiffOptionsRef.current.get(path) === reviewTabState.hideWhitespace
      ) {
        return
      }
      const fileSummary = currentSummary.files.find((file) => file.path === path)
      if (!fileSummary) return
      const requestKey = [
        currentSummary.generation,
        path,
        reviewTabState.hideWhitespace ? 'hide-whitespace' : 'standard',
        reviewTabState.loadFullFiles ? 'full-context' : 'partial-context',
      ].join('\0')
      const beginRequest = (generation: string): ReviewRequestStamp => {
        const request = {
          identity,
          generation,
          requestId: ++fileRequestIdRef.current,
        }
        activeFileRequestRef.current.set(path, request)
        return request
      }
      const requestIsCurrent = (request: ReviewRequestStamp): boolean => {
        const latestSummary = summaryRef.current
        return (
          activeSummaryIdentityRef.current === identity &&
          summaryCacheStateRef.current === 'fresh' &&
          latestSummary?.generation === request.generation &&
          isReviewRequestCurrent(request, activeFileRequestRef.current.get(path))
        )
      }
      const failLoad = (
        request: ReviewRequestStamp,
        loadError: unknown,
        publishSharedError = true,
      ): void => {
        if (!requestIsCurrent(request)) return
        const message = errorMessageOf(loadError)
        if (publishSharedError) setError(message)
        setFileLoadStates((current) => new Map(current).set(path, { status: 'error', message }))
      }
      const commitLoaded = (
        request: ReviewRequestStamp,
        loaded: ReviewFileDiff,
        expectedSummary: ReviewSummarySnapshot,
      ): void => {
        if (!requestIsCurrent(request)) return
        const latestSummary = summaryRef.current
        if (!latestSummary || latestSummary.generation !== expectedSummary.generation) {
          return
        }
        const currentFile = latestSummary.files.find((file) => file.path === path)
        if (!currentFile || currentFile.revision !== loaded.revision) return
        const nextLoadedDiffs = new Map(loadedDiffsRef.current).set(path, loaded)
        loadedDiffsRef.current = nextLoadedDiffs
        loadedDiffOptionsRef.current.set(path, reviewTabState.hideWhitespace)
        expiredFilePathsRef.current.delete(path)
        setLoadedDiffs(nextLoadedDiffs)
        setFileLoadStates((current) => new Map(current).set(path, { status: 'loaded' }))
        setReviewDiff((current) =>
          current
            ? {
                ...current,
                files: current.files.map((file) =>
                  file.path === path ? summaryFileToDesktop(currentFile, loaded) : file,
                ),
              }
            : current,
        )
      }
      return fileRequestCoordinatorRef.current.schedule(
        requestKey,
        async () => {
          if (activeSummaryIdentityRef.current !== identity) return
          setFileLoadStates((current) => {
            if (current.get(path)?.status === 'loading') return current
            return new Map(current).set(path, { status: 'loading' })
          })
          let request = beginRequest(currentSummary.generation)
          const initialStartedAt = performance.now()
          const initialDiagnosticTimer = beginDiagnosticTimer('review.file-diff.load', {
            sourceKind: source.kind,
            path,
            priority,
            hideWhitespace: reviewTabState.hideWhitespace,
            stage: 'initial',
          })
          try {
            const loaded = await reviewAgentClient.fileDiff(
              workspacePath,
              source,
              currentSummary.generation,
              path,
              reviewTabState.hideWhitespace,
              projectId ?? undefined,
              reviewTabState.loadFullFiles,
            )
            initialDiagnosticTimer.succeed()
            commitLoaded(request, loaded, currentSummary)
          } catch (loadError) {
            initialDiagnosticTimer.fail()
            if (retryExpired && reviewAgentClient.isSnapshotExpired(loadError)) {
              reportReviewDiagnostic(
                'warning',
                'review.file-diff.snapshot-expired',
                {
                  sourceKind: source.kind,
                  path,
                  priority,
                  hideWhitespace: reviewTabState.hideWhitespace,
                  durationMs: Math.round(performance.now() - initialStartedAt),
                },
                loadError,
              )
              expiredFilePathsRef.current.add(path)
              const retryStartedAt = performance.now()
              try {
                const refreshed = await recoverExpiredReview(loadError, identity)
                if (!refreshed || activeSummaryIdentityRef.current !== identity) {
                  reportReviewDiagnostic(
                    'error',
                    'review.file-diff.retry.failed',
                    {
                      sourceKind: source.kind,
                      path,
                      priority,
                      hideWhitespace: reviewTabState.hideWhitespace,
                      stage: 'summary-refresh',
                      durationMs: Math.round(performance.now() - retryStartedAt),
                    },
                    loadError,
                  )
                  failLoad(request, loadError, false)
                  return
                }
                const refreshedFile = refreshed.snapshot.files.find((file) => file.path === path)
                if (!refreshedFile) {
                  request = beginRequest(refreshed.snapshot.generation)
                  const missingFileError = new Error('刷新后找不到该文件差异')
                  reportReviewDiagnostic(
                    'error',
                    'review.file-diff.retry.failed',
                    {
                      sourceKind: source.kind,
                      path,
                      priority,
                      hideWhitespace: reviewTabState.hideWhitespace,
                      stage: 'file-missing',
                      durationMs: Math.round(performance.now() - retryStartedAt),
                    },
                    missingFileError,
                  )
                  failLoad(request, missingFileError)
                  return
                }
                request = beginRequest(refreshed.snapshot.generation)
                const retryDiagnosticTimer = beginDiagnosticTimer('review.file-diff.load', {
                  sourceKind: source.kind,
                  path,
                  priority,
                  hideWhitespace: reviewTabState.hideWhitespace,
                  stage: 'retry',
                })
                let loaded: ReviewFileDiff
                try {
                  loaded = await reviewAgentClient.fileDiff(
                    workspacePath,
                    source,
                    refreshed.snapshot.generation,
                    path,
                    reviewTabState.hideWhitespace,
                    projectId ?? undefined,
                    reviewTabState.loadFullFiles,
                  )
                  retryDiagnosticTimer.succeed()
                } catch (retryLoadError) {
                  retryDiagnosticTimer.fail()
                  throw retryLoadError
                }
                commitLoaded(request, loaded, refreshed.snapshot)
              } catch (retryError) {
                if (reviewAgentClient.isSnapshotExpired(retryError)) {
                  expiredFilePathsRef.current.add(path)
                }
                reportReviewDiagnostic(
                  'error',
                  'review.file-diff.retry.failed',
                  {
                    sourceKind: source.kind,
                    path,
                    priority,
                    hideWhitespace: reviewTabState.hideWhitespace,
                    stage: 'file-diff',
                    durationMs: Math.round(performance.now() - retryStartedAt),
                  },
                  retryError,
                )
                failLoad(request, retryError)
              }
              return
            }
            reportReviewDiagnostic(
              'error',
              'review.file-diff.load.failed',
              {
                sourceKind: source.kind,
                path,
                priority,
                hideWhitespace: reviewTabState.hideWhitespace,
                retryExpired,
                stage: 'initial',
                durationMs: Math.round(performance.now() - initialStartedAt),
              },
              loadError,
            )
            failLoad(request, loadError)
          }
        },
        priority,
      )
    },
    [
      beginDiagnosticTimer,
      onReviewTabStateChange,
      projectId,
      recoverExpiredReview,
      reviewTabState.hideWhitespace,
      reviewTabState.loadFullFiles,
      source,
      summaryIdentity,
      workspacePath,
    ],
  )

  const loadSmallWorkspaceDiffs = React.useCallback(async (): Promise<void> => {
    const identity = summaryIdentity
    const initialSummary = summaryRef.current
    if (
      !workspacePath ||
      !initialSummary ||
      initialSummary.largeDiffMode ||
      summaryCacheStateRef.current !== 'fresh' ||
      activeSummaryIdentityRef.current !== identity
    ) {
      return
    }

    const hideWhitespace = reviewTabState.hideWhitespace
    const pathsForSummary = (expectedSummary: ReviewSummarySnapshot): string[] =>
      expectedSummary.files
        .map((file) => file.path)
        .filter(
          (path) =>
            !loadedDiffsRef.current.has(path) ||
            loadedDiffOptionsRef.current.get(path) !== hideWhitespace,
        )

    const runBatch = async (
      expectedSummary: ReviewSummarySnapshot,
      retryExpired: boolean,
    ): Promise<void> => {
      const paths = pathsForSummary(expectedSummary)
      if (paths.length === 0) return
      const requestKey = [
        expectedSummary.generation,
        hideWhitespace ? 'hide-whitespace' : 'standard',
      ].join('\0')
      if (activeFileDiffBatchRef.current) return
      activeFileDiffBatchRef.current = requestKey
      const requests = new Map(
        paths.map((path) => {
          const request = {
            identity,
            generation: expectedSummary.generation,
            requestId: ++fileRequestIdRef.current,
          }
          activeFileRequestRef.current.set(path, request)
          return [path, request] as const
        }),
      )
      setFileLoadStates((current) => {
        const next = new Map(current)
        for (const path of paths) next.set(path, { status: 'loading' })
        return next
      })

      const startedAt = performance.now()
      const diagnosticTimer = beginDiagnosticTimer('review.file-diffs.load', {
        sourceKind: source.kind,
        pathCount: paths.length,
        hideWhitespace,
        retryExpired,
      })
      try {
        const result = await reviewAgentClient.fileDiffs(
          workspacePath,
          source,
          expectedSummary.generation,
          paths,
          hideWhitespace,
          projectId ?? undefined,
          reviewTabState.loadFullFiles,
        )
        diagnosticTimer.succeed({ resultType: result.type })
        if (
          activeSummaryIdentityRef.current !== identity ||
          summaryCacheStateRef.current !== 'fresh' ||
          summaryRef.current?.generation !== expectedSummary.generation ||
          activeFileDiffBatchRef.current !== requestKey
        ) {
          return
        }
        if (result.type === 'large') {
          setBatchLargeModeKey(requestKey)
          setFileLoadStates((current) => {
            const next = new Map(current)
            for (const [path, request] of requests) {
              if (
                isReviewRequestCurrent(request, activeFileRequestRef.current.get(path)) &&
                next.get(path)?.status === 'loading'
              ) {
                next.delete(path)
              }
            }
            return next
          })
          return
        }

        const latestSummary = summaryRef.current
        if (!latestSummary) return
        const summaryFiles = new Map(latestSummary.files.map((file) => [file.path, file] as const))
        const committed = new Map<string, ReviewFileDiff>()
        for (const loaded of result.files) {
          const request = requests.get(loaded.file.path)
          const currentFile = summaryFiles.get(loaded.file.path)
          if (
            request &&
            currentFile?.revision === loaded.revision &&
            isReviewRequestCurrent(request, activeFileRequestRef.current.get(loaded.file.path))
          ) {
            committed.set(loaded.file.path, loaded)
          }
        }
        const nextLoadedDiffs = new Map(loadedDiffsRef.current)
        for (const [path, loaded] of committed) {
          nextLoadedDiffs.set(path, loaded)
          loadedDiffOptionsRef.current.set(path, hideWhitespace)
          expiredFilePathsRef.current.delete(path)
        }
        loadedDiffsRef.current = nextLoadedDiffs
        setLoadedDiffs(nextLoadedDiffs)
        setFileLoadStates((current) => {
          const next = new Map(current)
          for (const [path, request] of requests) {
            if (!isReviewRequestCurrent(request, activeFileRequestRef.current.get(path))) {
              continue
            }
            if (committed.has(path)) {
              next.set(path, { status: 'loaded' })
            } else if (next.get(path)?.status === 'loading') {
              next.set(path, {
                status: 'error',
                message: '批量差异响应不完整',
              })
            }
          }
          return next
        })
        setReviewDiff((current) =>
          current
            ? {
                ...current,
                files: current.files.map((file) => {
                  const loaded = committed.get(file.path)
                  const currentFile = summaryFiles.get(file.path)
                  return loaded && currentFile ? summaryFileToDesktop(currentFile, loaded) : file
                }),
              }
            : current,
        )
        if (committed.size > 0) {
        }
      } catch (loadError) {
        diagnosticTimer.fail()
        if (reviewAgentClient.isBatchUnsupported(loadError)) {
          reportReviewDiagnostic('warning', 'review.file-diffs.unsupported', {
            sourceKind: source.kind,
            pathCount: paths.length,
            hideWhitespace,
            fallback: 'single-file-queue',
          })
          activeFileDiffBatchRef.current = null
          await Promise.all(paths.map((path) => loadFileDiff(path, 'prefetch')))
          return
        }
        if (retryExpired && reviewAgentClient.isSnapshotExpired(loadError)) {
          reportReviewDiagnostic(
            'warning',
            'review.file-diffs.snapshot-expired',
            {
              sourceKind: source.kind,
              pathCount: paths.length,
              hideWhitespace,
              durationMs: Math.round(performance.now() - startedAt),
            },
            loadError,
          )
          for (const path of paths) expiredFilePathsRef.current.add(path)
          const refreshed = await recoverExpiredReview(loadError, identity)
          if (refreshed) {
            activeFileDiffBatchRef.current = null
            await runBatch(refreshed.snapshot, false)
            return
          }
        }
        reportReviewDiagnostic(
          'error',
          'review.file-diffs.load.failed',
          {
            sourceKind: source.kind,
            pathCount: paths.length,
            hideWhitespace,
            retryExpired,
            durationMs: Math.round(performance.now() - startedAt),
          },
          loadError,
        )
        const message = errorMessageOf(loadError)
        if (activeSummaryIdentityRef.current === identity) setError(message)
        setFileLoadStates((current) => {
          const next = new Map(current)
          for (const [path, request] of requests) {
            if (isReviewRequestCurrent(request, activeFileRequestRef.current.get(path))) {
              next.set(path, { status: 'error', message })
            }
          }
          return next
        })
      } finally {
        if (activeFileDiffBatchRef.current === requestKey) {
          activeFileDiffBatchRef.current = null
        }
      }
    }

    await runBatch(initialSummary, true)
  }, [
    onReviewTabStateChange,
    beginDiagnosticTimer,
    loadFileDiff,
    projectId,
    recoverExpiredReview,
    reviewTabState.hideWhitespace,
    reviewTabState.loadFullFiles,
    source,
    summaryIdentity,
    workspacePath,
  ])

  const refreshComments = React.useCallback(async () => {
    const identity = commentIdentity
    if (!activeSessionId) {
      if (activeCommentIdentityRef.current === identity) setComments([])
      return
    }
    try {
      if (!workspacePath) {
        if (activeCommentIdentityRef.current === identity) setComments([])
        return
      }
      const nextComments = await reviewAgentClient.listComments(
        workspacePath,
        activeSessionId,
        source,
        projectId ?? undefined,
      )
      if (activeCommentIdentityRef.current === identity) {
        commentsStateIdentityRef.current = identity
        setComments(nextComments)
      }
    } catch (refreshError) {
      if (activeCommentIdentityRef.current === identity) {
        setError(errorMessageOf(refreshError))
      }
    }
  }, [activeSessionId, commentIdentity, projectId, source, workspacePath])

  React.useEffect(() => {
    void refreshReviewDiff()
  }, [refreshReviewDiff, isRefreshing])

  React.useEffect(() => {
    const handleGitChange = (event: Event): void => {
      const detail = event instanceof CustomEvent ? event.detail : null
      if (!reviewGitChangeMatchesProject(detail, projectId)) return
      if (reviewRootRef.current !== null && reviewRootRef.current.offsetParent === null) {
        staleGitChangeRef.current = true
        return
      }
      // Restart the quiet-window countdown; the scan itself waits for the
      // workspace to stop changing instead of joining every write.
      scheduleAutoRefresh()
    }
    window.addEventListener(WORKSPACE_GIT_CHANGED_EVENT, handleGitChange)
    return () => window.removeEventListener(WORKSPACE_GIT_CHANGED_EVENT, handleGitChange)
  }, [projectId, scheduleAutoRefresh])

  React.useEffect(() => {
    const root = reviewRootRef.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && staleGitChangeRef.current) {
        staleGitChangeRef.current = false
        void refreshReviewDiff(true)
      }
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [refreshReviewDiff])

  React.useEffect(() => {
    void refreshComments()
  }, [refreshComments])

  React.useEffect(() => {
    const files = reviewDiff?.files ?? []
    if (files.length === 0) {
      setSelectedPath(null)
      return
    }
    setSelectedPath((current) =>
      current && files.some((file) => file.path === current) ? current : (files[0]?.path ?? null),
    )
  }, [reviewDiff])

  const largeWorkspaceMode =
    summary?.largeDiffMode === true ||
    (summary !== null &&
      batchLargeModeKey ===
        [summary.generation, reviewTabState.hideWhitespace ? 'hide-whitespace' : 'standard'].join(
          '\0',
        ))
  const fileDiffLoadMode = reviewFileDiffLoadMode({
    hasSummary: summary !== null,
    cacheState: summaryCacheStateRef.current,
    summaryLoadState: loadState,
    largeWorkspaceMode,
    selectedPath,
  })

  React.useEffect(() => {
    const nextContext = {
      generation: summary?.generation ?? null,
      hideWhitespace: reviewTabState.hideWhitespace,
      loadFullFiles: reviewTabState.loadFullFiles,
    }
    const previousContext = activeDiffContextRef.current
    if (
      previousContext.generation === nextContext.generation &&
      previousContext.hideWhitespace === nextContext.hideWhitespace &&
      previousContext.loadFullFiles === nextContext.loadFullFiles
    ) {
      return
    }
    activeDiffContextRef.current = nextContext
    activeFileDiffBatchRef.current = null
    activeFileRequestRef.current.clear()
    fileRequestCoordinatorRef.current = new ReviewFileRequestCoordinator(2)
    setBatchLargeModeKey(null)
    setFileLoadStates((current) => {
      const next = new Map(current)
      for (const [path, state] of next) {
        if (state.status === 'loading') next.delete(path)
      }
      return next
    })
    if (
      (previousContext.hideWhitespace !== nextContext.hideWhitespace ||
        previousContext.loadFullFiles !== nextContext.loadFullFiles) &&
      summary
    ) {
      loadedDiffsRef.current = new Map()
      loadedDiffOptionsRef.current.clear()
      setLoadedDiffs(new Map())
      setFileLoadStates(new Map())
      setReviewDiff((current) =>
        current
          ? {
              ...current,
              files: summary.files.map((file) => summaryFileToDesktop(file)),
            }
          : current,
      )
    }
  }, [reviewTabState.hideWhitespace, reviewTabState.loadFullFiles, summary?.generation])

  React.useEffect(() => {
    if (fileDiffLoadMode === 'selected' && selectedPath) {
      void loadFileDiff(selectedPath, 'selected')
    }
  }, [fileDiffLoadMode, loadFileDiff, selectedPath])

  React.useEffect(() => {
    if (fileDiffLoadMode === 'batch') void loadSmallWorkspaceDiffs()
  }, [fileDiffLoadMode, loadSmallWorkspaceDiffs, summary?.generation])

  React.useEffect(() => {
    if (!summary) return
    const frame = window.requestAnimationFrame(() => {
      const viewport = diffScrollViewportRef.current
      if (viewport) viewport.scrollTop = reviewTabState.scrollTop
    })
    return () => window.cancelAnimationFrame(frame)
  }, [summary?.generation])

  React.useEffect(() => {
    const main = reviewMainRef.current
    if (!main || typeof ResizeObserver === 'undefined') return
    const updateAutoHide = (width: number): void => {
      if (width > 0) setReviewContentWidth(width)
      if (width < 625 && wideActionsFocusRef.current && document.hasFocus()) {
        wideActionsFocusRef.current = false
        moreButtonRef.current?.focus()
      }
      const shouldHide = width > 0 && width < REVIEW_FILE_TREE_RUNTIME_MIN_WIDTH
      setAutoHideFileList((current) => (current === shouldHide ? current : shouldHide))
    }
    updateAutoHide(main.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) updateAutoHide(entry.contentRect.width)
    })
    observer.observe(main)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    const identity = summaryIdentity
    return () => flushReviewScroll(identity)
  }, [flushReviewScroll, summaryIdentity])

  React.useEffect(() => {
    return () => {
      flushReviewScrollRef.current(activeSummaryIdentityRef.current)
      if (errorTimerRef.current !== null) {
        window.clearTimeout(errorTimerRef.current)
        errorTimerRef.current = null
      }
      if (scrollPersistTimerRef.current !== null) {
        window.clearTimeout(scrollPersistTimerRef.current)
        scrollPersistTimerRef.current = null
      }
    }
  }, [])

  function flashError(message: string): void {
    setError(message)
    if (errorTimerRef.current !== null) {
      window.clearTimeout(errorTimerRef.current)
    }
    errorTimerRef.current = window.setTimeout(() => {
      setError(null)
      errorTimerRef.current = null
    }, 3000)
  }

  function isMutationCurrent(
    token: number,
    expectedSummaryIdentity: string,
    expectedCommentIdentity?: string,
  ): boolean {
    return (
      mutationRequestTokenRef.current === token &&
      activeSummaryIdentityRef.current === expectedSummaryIdentity &&
      (expectedCommentIdentity === undefined ||
        activeCommentIdentityRef.current === expectedCommentIdentity)
    )
  }

  const files = reviewDiff?.files ?? []
  const reviewMutationPending = pending || summaryCacheStateRef.current !== 'fresh'
  const allFilePaths = React.useMemo(() => files.map((file) => file.path), [files])
  const allFilePathsRef = React.useRef(allFilePaths)
  allFilePathsRef.current = allFilePaths
  const diffExpansionStore = React.useMemo(
    () =>
      createKeyedDisclosureStore({
        initialExpandedKeys: [],
        persist: (expandedKeys) => {
          const diffExpansion = reviewDiffExpansionFromKeys(allFilePathsRef.current, expandedKeys)
          onReviewTabStateChangeRef.current((current) => ({
            ...current,
            diffExpansion,
          }))
        },
      }),
    [],
  )
  const diffExpansionDestroyTimerRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (diffExpansionDestroyTimerRef.current !== null) {
      window.clearTimeout(diffExpansionDestroyTimerRef.current)
      diffExpansionDestroyTimerRef.current = null
    }
    return () => {
      diffExpansionStore.flush()
      diffExpansionDestroyTimerRef.current = window.setTimeout(
        () => diffExpansionStore.destroy(),
        0,
      )
    }
  }, [diffExpansionStore])
  React.useLayoutEffect(() => {
    diffExpansionStore.replace(
      allFilePaths.filter((path) => isReviewDiffExpanded(reviewTabState.diffExpansion, path)),
    )
  }, [allFilePaths, diffExpansionStore, reviewTabState.diffExpansion])
  const showProjectEmptyState = loadState === 'empty' && summary !== null && files.length === 0
  const visibleFiles = React.useMemo(() => {
    const query = search.trim().toLowerCase()
    return files.filter((file) => {
      if (query && !file.path.toLowerCase().includes(query)) return false
      if (filter === 'all') return true
      return filterStatusForFile(file) === filter
    })
  }, [files, filter, search])

  React.useEffect(() => {
    if (!selectedPath || !summary || visibleFiles.some((file) => file.path === selectedPath)) {
      return
    }
    setSelectedPath(visibleFiles[0]?.path ?? null)
  }, [selectedPath, summary, visibleFiles])

  const reviewTree = React.useMemo(() => buildReviewFileTree(visibleFiles), [visibleFiles])

  React.useEffect(() => {
    if (!selectedPath || largeWorkspaceMode) return
    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        scrollToDiffFile(selectedPath)
      })
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame) window.cancelAnimationFrame(secondFrame)
    }
  }, [largeWorkspaceMode, selectedPath, visibleFiles])

  const selectedFile =
    visibleFiles.find((file) => file.path === selectedPath) ?? visibleFiles[0] ?? null
  const previewFiles = React.useMemo(
    () =>
      (largeWorkspaceMode && selectedFile ? [selectedFile] : visibleFiles).map((file) =>
        reviewTabState.hideImports && /\.[cm]?[jt]sx?$/iu.test(file.path)
          ? {
              ...file,
              hunks: hideImportOnlyHunks(file.hunks),
              partialHunks: file.partialHunks ? hideImportOnlyHunks(file.partialHunks) : undefined,
            }
          : file,
      ),
    [largeWorkspaceMode, selectedFile, visibleFiles, reviewTabState.hideImports],
  )
  const totals = React.useMemo(
    () =>
      files.reduce(
        (summary, file) => ({
          additions: summary.additions + file.additions,
          deletions: summary.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  )
  const { attachedComments, staleComments } = React.useMemo(
    () => attachComments(files, comments),
    [comments, files],
  )
  const openComments = comments.filter((comment) => comment.status === 'open')
  const commentCountsByPath = React.useMemo(
    () => buildCommentCountsByPath(openComments),
    [openComments],
  )
  const sessionBusy = sessionStatus === 'running' || sessionStatus === 'waiting'

  const setDiffExpanded = React.useCallback(
    (path: string, expanded: boolean): void => {
      diffExpansionStore.setExpanded(path, expanded)
      if (expanded && largeWorkspaceMode) {
        void loadFileDiff(path, 'selected')
      }
    },
    [diffExpansionStore, largeWorkspaceMode, loadFileDiff],
  )

  const setAllDiffsExpanded = React.useCallback(
    (expanded: boolean): void => {
      for (const path of allFilePathsRef.current) {
        diffExpansionStore.setExpanded(path, expanded)
      }
    },
    [diffExpansionStore],
  )

  async function applyOperation(
    action: 'stage' | 'unstage' | 'revert',
    target: { type: 'file'; path: string } | { type: 'hunk'; path: string; hunkId: string },
  ): Promise<void> {
    if (!workspacePath || !summary || pending) return
    if (summaryCacheStateRef.current !== 'fresh') {
      void refreshReviewDiff(true)
      return
    }
    if (source.kind !== 'unstaged' && source.kind !== 'staged') {
      flashError('分支、提交、上轮对话和 PR 差异为只读来源')
      return
    }
    if (
      action === 'revert' &&
      !window.confirm(`确定要丢弃 ${target.path} 的所选变更吗？此操作无法撤销。`)
    ) {
      return
    }
    const file = summary.files.find((candidate) => candidate.path === target.path)
    if (!file) return
    const operationIdentity = summaryIdentity
    const operationToken = ++mutationRequestTokenRef.current
    setPending(true)
    try {
      await reviewAgentClient.apply(
        workspacePath,
        {
          source,
          generation: summary.generation,
          expectedRevision: file.revision,
          action,
          target:
            target.type === 'file'
              ? { kind: 'file', path: target.path }
              : {
                  kind: 'hunk',
                  path: target.path,
                  hunkId: target.hunkId,
                },
        },
        projectId ?? undefined,
      )
      if (!isMutationCurrent(operationToken, operationIdentity)) return
      setError(null)
      await refreshReviewDiff(true)
      if (isMutationCurrent(operationToken, operationIdentity)) {
        onRefreshDiff()
      }
    } catch (operationError) {
      if (isMutationCurrent(operationToken, operationIdentity)) {
        if (reviewAgentClient.isSnapshotExpired(operationError)) {
          await recoverExpiredReview(operationError, operationIdentity)
        } else {
          setError(errorMessageOf(operationError))
        }
      }
    } finally {
      if (isMutationCurrent(operationToken, operationIdentity)) {
        setPending(false)
      }
    }
  }

  async function saveDraft(body: string): Promise<void> {
    if (!activeSessionId || !workspacePath || !summary || !draft || !body.trim()) {
      return
    }
    const file = summary.files.find((candidate) => candidate.path === draft.filePath)
    if (!file) return
    const operationIdentity = summaryIdentity
    const operationToken = ++mutationRequestTokenRef.current
    setPending(true)
    try {
      const saved = await reviewAgentClient.saveComment(
        workspacePath,
        activeSessionId,
        source,
        file.revision,
        {
          filePath: draft.filePath,
          side: draft.side,
          lineNumber: draft.lineNumber,
          body: body.trim(),
        },
        projectId ?? undefined,
      )
      if (!isMutationCurrent(operationToken, operationIdentity, commentIdentity)) return
      setComments((current) => [...current.filter((comment) => comment.id !== saved.id), saved])
      setDraft(null)
    } catch (commentError) {
      if (isMutationCurrent(operationToken, operationIdentity, commentIdentity)) {
        setError(errorMessageOf(commentError))
      }
    } finally {
      if (isMutationCurrent(operationToken, operationIdentity, commentIdentity)) {
        setPending(false)
      }
    }
  }

  async function resolveComment(commentId: string): Promise<void> {
    if (!activeSessionId || !workspacePath) return
    const identity = commentIdentity
    const resolved = await reviewAgentClient.resolveComment(
      workspacePath,
      activeSessionId,
      commentId,
      projectId ?? undefined,
    )
    if (activeCommentIdentityRef.current !== identity) return
    setComments((current) =>
      current.map((comment) => (comment.id === resolved.id ? resolved : comment)),
    )
  }

  async function deleteComment(commentId: string): Promise<void> {
    if (!activeSessionId || !workspacePath) return
    const identity = commentIdentity
    await reviewAgentClient.deleteComment(
      workspacePath,
      activeSessionId,
      commentId,
      projectId ?? undefined,
    )
    if (activeCommentIdentityRef.current !== identity) return
    setComments((current) => current.filter((comment) => comment.id !== commentId))
  }

  async function sendCommentsToAgent(): Promise<void> {
    if (!activeSessionId || sessionBusy || openComments.length === 0) return
    const body = [
      '请按这些本地行内审查评论修改代码：',
      '',
      ...openComments.map(
        (comment, index) =>
          `${index + 1}. ${comment.filePath}:${comment.lineNumber} (${comment.side})\n` +
          `   行内容：${comment.lineContent || '(空行)'}\n` +
          `   评论：${comment.body}`,
      ),
    ].join('\n')
    await desktopClient.sendUserMessage(activeSessionId, { text: body })
  }

  async function submitGithubReview(
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES',
  ): Promise<void> {
    if (source.kind !== 'pull-request' || pending) return
    const expectedHeadRevision = summary?.headSha
    if (!expectedHeadRevision) {
      flashError('当前 PR 缺少 head revision，请刷新审阅后重试')
      return
    }
    if (event !== 'APPROVE' && openComments.length === 0) {
      flashError('请先添加至少一条行内评论')
      return
    }
    const reviewSource = source
    const reviewComments = [...openComments]
    const operationSummaryIdentity = summaryIdentity
    const operationCommentIdentity = commentIdentity
    const operationToken = ++mutationRequestTokenRef.current
    setPending(true)
    try {
      for (const comment of reviewComments) {
        if (
          !isMutationCurrent(operationToken, operationSummaryIdentity, operationCommentIdentity)
        ) {
          return
        }
        if (comment.githubCommentId || publishedGithubCommentIdsRef.current.has(comment.id)) {
          continue
        }
        const published = await reviewAgentClient.publishGithubComment(reviewSource, {
          body: comment.body,
          path: comment.filePath,
          side: comment.side,
          line: comment.lineNumber,
          expectedHeadRevision,
          commitId: expectedHeadRevision,
        })
        if (
          !isMutationCurrent(operationToken, operationSummaryIdentity, operationCommentIdentity)
        ) {
          return
        }
        publishedGithubCommentIdsRef.current.add(comment.id)
        if (workspacePath) {
          const linked = await reviewAgentClient.linkGithubComment(
            workspacePath,
            reviewSource,
            comment,
            published,
            projectId ?? undefined,
          )
          if (
            !isMutationCurrent(operationToken, operationSummaryIdentity, operationCommentIdentity)
          ) {
            return
          }
          setComments((current) =>
            current.map((candidate) => (candidate.id === linked.id ? linked : candidate)),
          )
        }
      }
      await reviewAgentClient.submitGithubReview(
        reviewSource,
        event,
        expectedHeadRevision,
        event === 'APPROVE' ? undefined : `Pidex 提交了 ${reviewComments.length} 条行内审阅评论。`,
      )
      if (isMutationCurrent(operationToken, operationSummaryIdentity, operationCommentIdentity)) {
        setError(null)
      }
    } catch (reviewError) {
      if (isMutationCurrent(operationToken, operationSummaryIdentity, operationCommentIdentity)) {
        setError(errorMessageOf(reviewError))
      }
    } finally {
      if (isMutationCurrent(operationToken, operationSummaryIdentity, operationCommentIdentity)) {
        setPending(false)
      }
    }
  }

  function sendReviewPromptToComposer(): void {
    if (!onAppendComposerText) return
    onAppendComposerText(
      buildReviewComposerPrompt(reviewDiff?.status ?? gitStatus, reviewDiff?.files ?? []),
    )
  }

  async function handleCommit(message: string, includeUnstaged: boolean): Promise<boolean> {
    if (!workspacePath || pending) return false
    if (!message.trim()) {
      flashError('请输入提交信息')
      return false
    }
    const operationIdentity = summaryIdentity
    const operationToken = ++mutationRequestTokenRef.current
    setPending(true)
    try {
      let commitPaths: string[] = []
      if (includeUnstaged) {
        const statusResult = await desktopClient.getWorkspaceGitStatus(
          workspacePath,
          projectId ?? undefined,
          { refresh: true },
        )
        if ('error' in statusResult) {
          throw new Error(statusResult.error)
        }
        commitPaths = [...new Set(statusResult.status.files.map((file) => file.path))]
      }
      const result = await desktopClient.commitWorkspaceChanges({
        ...(projectId ? { projectId } : {}),
        workspacePath,
        message: message.trim(),
        paths: commitPaths,
      })
      if (result.ok === false) throw new Error(result.error)
      if (
        activeSummaryIdentityRef.current !== operationIdentity ||
        mutationRequestTokenRef.current !== operationToken
      ) {
        return false
      }
      setCommitPopoverOpen(false)
      await refreshReviewDiff(true)
      if (
        activeSummaryIdentityRef.current !== operationIdentity ||
        mutationRequestTokenRef.current !== operationToken
      ) {
        return false
      }
      onRefreshDiff()
      return true
    } catch (commitError) {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setError(errorMessageOf(commitError))
      }
      return false
    } finally {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setPending(false)
      }
    }
  }

  async function handleCommitAndPush(message: string, includeUnstaged: boolean): Promise<void> {
    if (!workspacePath || pending) return
    const committed = await handleCommit(message, includeUnstaged)
    if (!committed) return
    await handlePush()
  }

  async function handlePush(): Promise<void> {
    if (!workspacePath || pending) return
    const operationIdentity = summaryIdentity
    const operationToken = ++mutationRequestTokenRef.current
    setPending(true)
    try {
      const result = await desktopClient.pushWorkspaceBranch({
        ...(projectId ? { projectId } : {}),
        workspacePath,
        setUpstream: !gitStatus?.upstream,
      })
      if (result.ok === false) throw new Error(result.error)
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setCommitPopoverOpen(false)
        onRefreshDiff()
      }
    } catch (pushError) {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setError(errorMessageOf(pushError))
      }
    } finally {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setPending(false)
      }
    }
  }

  async function createPullRequest(
    title: string,
    body: string,
    pushFirst: boolean,
    draft: boolean,
  ): Promise<void> {
    if (!workspacePath || pending) return
    if (!title.trim()) {
      flashError('请输入 Pull Request 标题')
      return
    }
    const operationIdentity = summaryIdentity
    const operationToken = ++mutationRequestTokenRef.current
    setPending(true)
    try {
      if (pushFirst) {
        const pushed = await desktopClient.pushWorkspaceBranch({
          ...(projectId ? { projectId } : {}),
          workspacePath,
          setUpstream: !gitStatus?.upstream,
          ...(activeSessionId ? { threadId: activeSessionId } : {}),
        })
        if (pushed.ok === false) throw new Error(pushed.error)
      }
      const result = await desktopClient.createPullRequest({
        ...(projectId ? { projectId } : {}),
        workspacePath,
        title: title.trim(),
        body: body.trim(),
        draft,
        ...(activeSessionId ? { threadId: activeSessionId } : {}),
      })
      if (result.ok === false) throw new Error(result.error)
      if (
        activeSummaryIdentityRef.current !== operationIdentity ||
        mutationRequestTokenRef.current !== operationToken
      ) {
        return
      }
      setCurrentPullRequestUrl(result.url)
      const identity = parseGithubPullRequestUrl(result.url)
      if (identity) {
        selectSource({ kind: 'pull-request', ...identity })
      }
      setPrPopoverOpen(false)
    } catch (pullRequestError) {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setError(errorMessageOf(pullRequestError))
      }
    } finally {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setPending(false)
      }
    }
  }

  function handleCreatePR(title: string, body: string, pushFirst: boolean): void {
    void createPullRequest(title, body, pushFirst, false)
  }

  function handleCreateDraftPR(title: string, body: string, pushFirst: boolean): void {
    void createPullRequest(title, body, pushFirst, true)
  }

  function handleOpenPR(): void {
    setPrPopoverOpen(false)
    const url =
      currentPullRequestUrl ??
      (source.kind === 'pull-request'
        ? `https://github.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/pull/${source.number}`
        : null)
    if (!url) {
      flashError('当前还没有可打开的 Pull Request')
      return
    }
    void desktopClient.openExternalURL(url).catch((openError) => {
      setError(errorMessageOf(openError))
    })
  }

  async function handleLastTurnScope(): Promise<void> {
    if (!activeSessionId) return
    setScopeMenuOpen(false)
    try {
      const snapshot = await desktopClient.getSession(activeSessionId)
      const event = [...(snapshot.events ?? [])]
        .reverse()
        .find(
          (candidate) =>
            'turnId' in candidate &&
            typeof candidate.turnId === 'string' &&
            candidate.type !== 'turn.started',
        )
      if (!event || !('turnId' in event)) {
        flashError('当前任务还没有可审阅的上一轮变更')
        return
      }
      selectSource({
        kind: 'last-turn',
        threadId: activeSessionId,
        turnId: event.turnId,
      })
    } catch (lastTurnError) {
      flashError(errorMessageOf(lastTurnError))
    }
  }

  async function applyAll(action: 'stage' | 'unstage' | 'revert'): Promise<void> {
    if (!workspacePath || pending || (source.kind !== 'unstaged' && source.kind !== 'staged')) {
      return
    }
    const currentSummary = summary
    const itemList =
      currentSummary?.files.map((file) => ({
        path: file.path,
        expectedRevision: file.revision,
      })) ?? []
    const firstItem = itemList[0]
    if (!currentSummary || !firstItem) return
    if (summaryCacheStateRef.current !== 'fresh') {
      void refreshReviewDiff(true)
      return
    }
    const items: [
      { path: string; expectedRevision: string },
      ...Array<{ path: string; expectedRevision: string }>,
    ] = [firstItem, ...itemList.slice(1)]
    if (
      action === 'revert' &&
      !window.confirm(`确定要丢弃全部 ${items.length} 个文件的变更吗？此操作无法撤销。`)
    ) {
      return
    }
    const operationIdentity = summaryIdentity
    const operationToken = ++mutationRequestTokenRef.current
    setPending(true)
    try {
      await reviewAgentClient.applyBatch(
        workspacePath,
        {
          source,
          generation: currentSummary.generation,
          action,
          items,
        },
        projectId ?? undefined,
      )
      if (
        activeSummaryIdentityRef.current !== operationIdentity ||
        mutationRequestTokenRef.current !== operationToken
      ) {
        return
      }
      await refreshReviewDiff(true)
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setError(null)
        onRefreshDiff()
      }
    } catch (operationError) {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        if (reviewAgentClient.isSnapshotExpired(operationError)) {
          await recoverExpiredReview(operationError, operationIdentity)
        } else if (reviewAgentClient.isBatchPartial(operationError)) {
          const partialMessage = errorMessageOf(operationError)
          await refreshReviewDiff(true)
          if (
            activeSummaryIdentityRef.current === operationIdentity &&
            mutationRequestTokenRef.current === operationToken
          ) {
            setError(partialMessage)
          }
        } else {
          setError(errorMessageOf(operationError))
        }
      }
    } finally {
      if (
        activeSummaryIdentityRef.current === operationIdentity &&
        mutationRequestTokenRef.current === operationToken
      ) {
        setPending(false)
      }
    }
  }

  function handlePullRequestScope(): void {
    const value = window.prompt(
      '输入 GitHub Pull Request URL，例如 https://github.com/owner/repo/pull/123',
      source.kind === 'pull-request'
        ? `https://github.com/${source.owner}/${source.repository}/pull/${source.number}`
        : '',
    )
    if (!value) return
    const identity = parseGithubPullRequestUrl(value.trim())
    if (!identity) {
      flashError('请输入有效的 github.com Pull Request URL')
      return
    }
    setCurrentPullRequestUrl(value.trim())
    selectSource({ kind: 'pull-request', ...identity })
  }

  function revertAll(): void {
    void applyAll('revert')
  }

  function stageAll(): void {
    void applyAll('stage')
  }

  function unstageAll(): void {
    void applyAll('unstage')
  }

  const setDiffFileSectionElement = React.useCallback(
    (path: string, element: HTMLElement | null) => {
      if (element) {
        diffFileSectionRefs.current.set(path, element)
        return
      }
      diffFileSectionRefs.current.delete(path)
    },
    [],
  )

  function scrollToDiffFile(path: string): void {
    const viewport = diffScrollViewportRef.current
    const section = diffFileSectionRefs.current.get(path)
    if (!viewport || !section) return
    const viewportRect = viewport.getBoundingClientRect()
    const sectionRect = section.getBoundingClientRect()
    viewport.scrollTo({
      top: viewport.scrollTop + sectionRect.top - viewportRect.top,
      behavior: 'auto',
    })
  }

  const selectedFileIndex = visibleFiles.findIndex((file) => file.path === selectedPath)

  function handleSelectFile(path: string): void {
    setSelectedPath(path)
    if (largeWorkspaceMode) void loadFileDiff(path, 'selected')
    if (!largeWorkspaceMode) {
      window.requestAnimationFrame(() => scrollToDiffFile(path))
    }
  }

  return (
    <aside
      className={cx(REVIEW_SIDEBAR_CLASS, hideFileList && 'hide-files')}
      aria-label="本地代码审查"
      data-review-view={reviewView}
      data-wrap-lines={wordWrap ? 'true' : 'false'}
      ref={reviewRootRef}
    >
      <div
        className={cx(
          'review-sidebar-toolbar',
          source.kind === 'branch' && 'review-sidebar-toolbar--branch',
          REVIEW_SIDEBAR_TOOLBAR_CLASS,
        )}
      >
        <div
          className={cx(
            'review-sidebar-title tw:flex tw:flex-wrap tw:min-w-0 tw:items-center tw:gap-2',
            source.kind === 'branch' && 'tw:flex-wrap',
          )}
        >
          <div className="tw:inline-flex tw:min-w-0 tw:shrink-0 tw:items-center tw:gap-2 tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-2 tw:py-1">
            <ReviewSourceMenu
              branches={branches}
              commits={commits}
              open={scopeMenuOpen}
              source={source}
              supportsUncommitted={reviewCapabilities.includes('git.review.uncommitted.v1')}
              sourceOptionsState={sourceOptionsState}
              onOpenChange={setScopeMenuOpen}
              onRetry={() => setSourceOptionsRetry((current) => current + 1)}
              onSelectLastTurn={() => void handleLastTurnScope()}
              onSelectSource={selectSource}
            />
            {summary ? (
              totals.additions > 0 || totals.deletions > 0 ? (
                <span className={cx('review-sidebar-counts', REVIEW_COUNTS_CLASS)}>
                  <>
                    <strong className="tw:text-app-success tw:type-weight-label">
                      +{formatPanelNumber(totals.additions)}
                    </strong>
                    <em className="tw:text-app-danger tw:not-italic tw:type-weight-label">
                      -{formatPanelNumber(totals.deletions)}
                    </em>
                  </>
                </span>
              ) : null
            ) : (
              <span
                aria-label="变更统计不可用"
                className={cx('review-sidebar-counts', REVIEW_COUNTS_CLASS)}
              >
                —
              </span>
            )}
          </div>
          {source.kind === 'branch' ? (
            <div className="review-branch-range tw:flex tw:min-w-0 tw:flex-[0_1_auto] tw:items-center tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-1 tw:py-1 tw:gap-1 tw:text-app-text-soft tw:type-caption">
              <span
                className="tw:min-w-0 tw:max-w-[38%] tw:overflow-hidden tw:px-2 tw:text-ellipsis tw:whitespace-nowrap"
                title={gitStatus?.branchName ?? 'HEAD'}
              >
                {gitStatus?.branchName ?? 'HEAD'}
              </span>
              <span aria-hidden="true">→</span>
              <PopoverMenu
                align="start"
                className="popover-review-branches popover-menu--flex"
                open={branchPickerOpen}
                sideOffset={4}
                size="md"
                trigger={
                  <button
                    className="review-branch-range__trigger tw:inline-flex tw:min-w-0 tw:max-w-[54%] tw:items-center tw:gap-1 tw:rounded-md tw:px-2 tw:py-1 tw:text-app-text-soft tw:hover:bg-app-hover tw:hover:text-app-text tw:active:bg-app-selected"
                    type="button"
                  >
                    <span className="tw:min-w-0 tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap">
                      {source.baseBranch}
                    </span>
                    <ChevronDown size={APP_ICON_SIZES.sm} />
                  </button>
                }
                onOpenChange={setBranchPickerOpen}
              >
                <SearchInput
                  value={branchSearch}
                  onChange={setBranchSearch}
                  placeholder="搜索分支"
                  aria-label="搜索基准分支"
                />
                <div className="tw:max-h-80 tw:overflow-y-auto">
                  {sourceOptionsState === 'loading' ? (
                    <div className="review-source-submenu-message tw:p-2 tw:text-app-text-soft tw:type-body-sm">
                      正在加载分支…
                    </div>
                  ) : sourceOptionsState === 'error' ? (
                    <>
                      <div className="review-source-submenu-message tw:p-2 tw:text-app-text-soft tw:type-body-sm">
                        无法加载分支
                      </div>
                      <PopoverItem onClick={() => setSourceOptionsRetry((current) => current + 1)}>
                        重试
                      </PopoverItem>
                    </>
                  ) : (
                    <PopoverRadioGroup
                      value={source.baseBranch}
                      onValueChange={(branchName) => {
                        selectSource({
                          kind: 'branch',
                          baseBranch: branchName,
                        })
                        setBranchPickerOpen(false)
                      }}
                    >
                      {branches
                        .filter(
                          (branch) =>
                            !branch.current &&
                            branch.name.toLowerCase().includes(branchSearch.toLowerCase()),
                        )
                        .map((branch) => (
                          <PopoverRadioItem key={`base-branch:${branch.name}`} value={branch.name}>
                            {branch.name}
                          </PopoverRadioItem>
                        ))}
                    </PopoverRadioGroup>
                  )}
                </div>
              </PopoverMenu>
            </div>
          ) : null}
        </div>
        <div className="review-sidebar-actions tw:inline-flex tw:flex-none tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-raised tw:p-1 tw:whitespace-nowrap">
          <ReviewOptionsMenu
            open={moreMenuOpen}
            onOpenChange={setMoreMenuOpen}
            buttonRef={moreButtonRef}
            preferences={reviewTabState}
            supportsFullContext={reviewCapabilities.includes('git.review.context.v1')}
            onSetPreference={updateReviewBoolean}
            onRefresh={() => {
              onRefreshDiff()
              void refreshReviewDiff(true)
            }}
            onCreateBranch={onCreateBranch}
            onOpenPullRequest={handlePullRequestScope}
            onToggleView={onToggleReviewView}
            onToggleExpanded={() =>
              setAllDiffsExpanded(reviewTabState.diffExpansion.mode === 'none')
            }
            onCommit={() => setCommitPopoverOpen(true)}
            onCreatePullRequest={() => setPrPopoverOpen(true)}
            onCopyPatch={() => {
              void copyGitApplyCommand(reviewDiff?.files ?? [], scope)
            }}
          />
          <Tooltip content="搜索文件">
            <Button
              isIconOnly
              iconSize="sm"
              className="review-sidebar-search-action "
              color="ghostSecondary"
              size="toolbar"
              title="搜索文件"
              onClick={() => fileSearchInputRef.current?.focus()}
            >
              <Search size={APP_ICON_SIZES.sm} />
            </Button>
          </Tooltip>
          <div
            className="tw:hidden tw:items-center tw:gap-1 tw:@min-[625px]:flex"
            onFocusCapture={(event) => {
              wideActionsFocusRef.current =
                event.target instanceof HTMLElement && event.target.matches(':focus-visible')
            }}
            onBlurCapture={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
                wideActionsFocusRef.current = false
            }}
          >
            <Tooltip content="刷新变更">
              <Button
                isIconOnly
                color="ghostSecondary"
                size="toolbar"
                title="刷新变更"
                onClick={() => {
                  onRefreshDiff()
                  void refreshReviewDiff(true)
                }}
              >
                <RotateCcw size={APP_ICON_SIZE} />
              </Button>
            </Tooltip>
            <Tooltip content="自动换行">
              <Button
                isIconOnly
                color={wordWrap ? 'ghostActive' : 'ghostSecondary'}
                size="toolbar"
                title="自动换行"
                aria-pressed={wordWrap}
                onClick={() => setWordWrap((value) => !value)}
              >
                <WrapText size={APP_ICON_SIZE} />
              </Button>
            </Tooltip>
            <ReviewDiffExpansionToggle
              allPaths={allFilePaths}
              store={diffExpansionStore}
              onSetAllExpanded={setAllDiffsExpanded}
            />

            <Tooltip content={reviewView === 'inline' ? '切换到分离视图' : '切换到统一差异视图'}>
              <Button
                isIconOnly
                color={reviewView === 'inline' ? 'ghostSecondary' : 'ghostActive'}
                size="toolbar"
                title={reviewView === 'inline' ? '切换到拆分差异视图' : '切换到统一差异视图'}
                onClick={onToggleReviewView}
              >
                {reviewView === 'inline' ? (
                  <Columns2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                ) : (
                  <Rows2 size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                )}
              </Button>
            </Tooltip>
          </div>
          <Tooltip content={hideFileList ? '显示文件' : '隐藏文件'}>
            <Button
              isIconOnly
              ref={fileTreeToggleRef}
              aria-pressed={!hideFileList}
              color={!hideFileList ? 'ghostActive' : 'ghostSecondary'}
              size="toolbar"
              title={hideFileList ? '显示文件' : '隐藏文件'}
              onClick={() => setHideFileList((value) => !value)}
            >
              <Briefcase size={APP_ICON_SIZE} />
            </Button>
          </Tooltip>
        </div>
      </div>

      {largeWorkspaceMode && visibleFiles.length > 0 ? (
        <div
          className="tw:mx-2 tw:mb-2 tw:flex tw:@max-[625px]:grid tw:@max-[625px]:grid-cols-[auto_minmax(0,1fr)] tw:min-h-12 tw:shrink-0 tw:items-center tw:gap-3 tw:rounded-2xl tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-4 tw:py-4 tw:type-control"
          role="status"
        >
          <Info className="tw:shrink-0 tw:text-app-accent" size={APP_ICON_SIZE} />
          <span className="tw:min-w-0 tw:flex-1">此差异较大，每次仅显示一个文件</span>
          <div className="tw:flex tw:items-center tw:gap-1 tw:@max-[625px]:col-start-2">
            <Tooltip content="上一个文件">
              <Button
                isIconOnly
                aria-label="上一个文件"
                size="toolbar"
                disabled={selectedFileIndex <= 0}
                onClick={() => handleSelectFile(visibleFiles[selectedFileIndex - 1]!.path)}
              >
                <ChevronLeft size={APP_ICON_SIZE} />
              </Button>
            </Tooltip>
            <Tooltip content="下一个文件">
              <Button
                isIconOnly
                aria-label="下一个文件"
                size="toolbar"
                disabled={selectedFileIndex >= visibleFiles.length - 1}
                onClick={() => handleSelectFile(visibleFiles[selectedFileIndex + 1]!.path)}
              >
                <ChevronRight size={APP_ICON_SIZE} />
              </Button>
            </Tooltip>
          </div>
        </div>
      ) : null}

      {error ? (
        <div
          className="review-error-state tw:flex tw:flex-none tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-app-border-subtle tw:px-4 tw:py-2 tw:text-app-danger tw:type-body-sm"
          role="alert"
        >
          <span>{error}</span>
          <Button color="secondary" onClick={() => void refreshReviewDiff(true)}>
            重试
          </Button>
        </div>
      ) : null}

      <motion.div
        className="review-sidebar-main tw:relative tw:flex tw:min-w-0 tw:min-h-0 tw:flex-auto tw:items-stretch tw:overflow-hidden tw:bg-app-editor tw:[contain:size_layout_paint]"
        ref={reviewMainRef}
        style={
          {
            '--review-file-tree-panel-w': `${fileTreePanelWidth}px`,
          } as React.CSSProperties
        }
      >
        {showProjectEmptyState ? <ReviewProjectEmptyState source={source} /> : null}

        {!showProjectEmptyState && visibleFiles.length > 0 ? (
          <ReviewDiffPreview
            attachedComments={attachedComments}
            disclosureStore={diffExpansionStore}
            diffMarkerStyle={diffMarkerStyle}
            draft={draft}
            fileLoadStates={fileLoadStates}
            files={previewFiles}
            largeWorkspaceMode={largeWorkspaceMode}
            viewedRevisions={reviewTabState.viewedRevisions}
            readOnly={source.kind !== 'unstaged' && source.kind !== 'staged'}
            richPreview={richDiffPreview}
            branchReview={source.kind === 'branch'}
            onToggleViewed={(path, revision) =>
              onReviewTabStateChange((current) => {
                const viewedRevisions = { ...current.viewedRevisions }
                if (viewedRevisions[path] === revision) delete viewedRevisions[path]
                else viewedRevisions[path] = revision
                return { ...current, viewedRevisions }
              })
            }
            onOpenReviewFile={onOpenReviewFile}
            pending={reviewMutationPending}
            summaryLoadState={loadState}
            scope={scope}
            selectedPath={selectedFile?.path ?? null}
            onDiffExpandedChange={setDiffExpanded}
            viewportRef={diffScrollViewportRef}
            view={reviewView}
            showWordDiff={textDiff}
            wrapLines={wordWrap}
            workspacePath={workspacePath}
            onApplyOperation={(action, target) => void applyOperation(action, target)}
            onCreateDraft={setDraft}
            onDeleteComment={(commentId) => void deleteComment(commentId)}
            onResolveComment={(commentId) => void resolveComment(commentId)}
            onSaveDraft={(body) => void saveDraft(body)}
            onCancelDraft={() => setDraft(null)}
            onFileSectionMount={setDiffFileSectionElement}
            onRetryFile={(path) => void loadFileDiff(path, 'selected')}
            onScroll={handleReviewScroll}
          />
        ) : null}

        <ReviewFileTreePanelPresence
          focusReturnRef={fileTreeToggleRef}
          liveWidth={liveFileTreePanelWidth}
          liveWidthPixels={liveFileTreePanelWidthPixels}
          resizeHandle={
            <ReviewFileTreeResizeController
              containerRef={reviewMainRef}
              liveWidthPixels={liveFileTreePanelWidthPixels}
              width={fileTreePanelWidth}
              onResizePreview={previewFileTreePanelWidth}
              onSetWidth={setFileTreePanelWidth}
            />
          }
          visible={!showProjectEmptyState && !hideFileList}
          width={fileTreePanelWidth}
        >
          <div className="review-file-tree-panel-content tw:flex tw:min-w-0 tw:min-h-0 tw:flex-auto tw:flex-col">
            <div className="review-file-search-region tw:shrink-0 tw:bg-app-dock tw:px-2 tw:pt-2 tw:pb-1">
              <SearchInput
                ref={fileSearchInputRef}
                aria-label="筛选文件"
                className="review-file-search tw:w-full tw:min-h-7 tw:border tw:border-app-border-subtle tw:rounded-lg tw:bg-app-raised"
                onChange={setSearch}
                placeholder="筛选文件..."
                value={search}
                variant="compact"
              />
            </div>

            <ReviewFileTreeController
              commentCountsByPath={commentCountsByPath}
              emptyMessage={
                loadState === 'loading' && !summary
                  ? '正在加载变更…'
                  : loadState === 'not-repository' && !summary
                    ? '当前工作区不是 Git 仓库。'
                    : loadState === 'unsupported' && !summary
                      ? '当前 Agent 不支持代码审阅。'
                      : !summary && files.length === 0
                        ? '无法加载变更，请重试。'
                        : files.length === 0
                          ? scope === 'staged'
                            ? '暂无已暂存变更。'
                            : '暂无未暂存变更。'
                          : '当前筛选下没有匹配的文件。'
              }
              reviewTree={reviewTree}
              selectedPath={selectedFile?.path ?? null}
              onSelectFile={handleSelectFile}
            />

            {staleComments.length > 0 ? (
              <ScrollArea
                className="review-stale-comments-scroll tw:shrink-0 tw:max-h-[24%]"
                contentClassName="review-stale-comments tw:border-t tw:border-app-border-subtle tw:bg-app-panel tw:px-3 tw:py-3"
                aria-label="过期评论"
              >
                <div className="review-stale-title tw:mb-2 tw:text-app-text-soft tw:type-title-sm">
                  过期评论
                </div>
                {staleComments.map((comment) => (
                  <ReviewComment
                    comment={comment}
                    key={comment.id}
                    stale
                    onDelete={() => void deleteComment(comment.id)}
                    onResolve={() => void resolveComment(comment.id)}
                  />
                ))}
              </ScrollArea>
            ) : null}
          </div>
        </ReviewFileTreePanelPresence>
      </motion.div>

      {!hideFileList &&
      visibleFiles.length > 0 &&
      (source.kind === 'unstaged' || source.kind === 'staged') ? (
        <footer className={cx('review-footer', REVIEW_FOOTER_CLASS)}>
          {scope === 'unstaged' ? (
            <>
              <Tooltip content="还原所有未暂存变更">
                <Button
                  aria-disabled={reviewMutationPending}
                  color="danger"
                  onClick={() => {
                    if (!reviewMutationPending) revertAll()
                  }}
                >
                  <Undo2 size={APP_ICON_SIZE} />
                  还原全部
                </Button>
              </Tooltip>
              <Tooltip content="暂存所有未暂存文件">
                <Button
                  color="primary"
                  aria-disabled={reviewMutationPending}
                  onClick={() => {
                    if (!reviewMutationPending) stageAll()
                  }}
                >
                  <Plus size={APP_ICON_SIZE} />
                  暂存全部
                </Button>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip content="取消暂存所有已暂存文件">
                <Button
                  color="secondary"
                  aria-disabled={reviewMutationPending}
                  onClick={() => {
                    if (!reviewMutationPending) unstageAll()
                  }}
                >
                  <Undo2 size={APP_ICON_SIZE} />
                  取消暂存全部
                </Button>
              </Tooltip>
              <Tooltip content="还原已暂存变更">
                <Button
                  aria-disabled={reviewMutationPending}
                  color="danger"
                  onClick={() => {
                    if (!reviewMutationPending) revertAll()
                  }}
                >
                  <Undo2 size={APP_ICON_SIZE} />
                  还原全部
                </Button>
              </Tooltip>
            </>
          )}
        </footer>
      ) : null}

      {source.kind === 'pull-request' ? (
        <footer className={cx('review-footer', REVIEW_FOOTER_CLASS)}>
          <Button
            color="secondary"
            disabled={pending || openComments.length === 0}
            onClick={() => void submitGithubReview('COMMENT')}
          >
            <MessageSquarePlus size={APP_ICON_SIZE} />
            提交评论
          </Button>
          <Button
            color="primary"
            disabled={pending}
            onClick={() => void submitGithubReview('APPROVE')}
          >
            <CheckCircle2 size={APP_ICON_SIZE} />
            批准
          </Button>
          <Button
            disabled={pending || openComments.length === 0}
            color="danger"
            onClick={() => void submitGithubReview('REQUEST_CHANGES')}
          >
            <RotateCcw size={APP_ICON_SIZE} />
            请求修改
          </Button>
        </footer>
      ) : null}

      <CommitPopover
        additions={totals.additions}
        anchorRef={moreButtonRef}
        branchName={gitStatus?.branchName ?? 'HEAD'}
        deletions={totals.deletions}
        open={commitPopoverOpen}
        size="lg"
        onClose={() => setCommitPopoverOpen(false)}
        onCommit={handleCommit}
        onCommitAndPush={handleCommitAndPush}
        onPush={handlePush}
      />

      <PullRequestPopover
        additions={totals.additions}
        anchorRef={moreButtonRef}
        branchName={gitStatus?.branchName ?? null}
        defaultBranch={defaultBranch}
        deletions={totals.deletions}
        open={prPopoverOpen}
        size="lg"
        onClose={() => setPrPopoverOpen(false)}
        onCreateDraftPR={handleCreateDraftPR}
        onCreatePR={handleCreatePR}
        onOpenPR={handleOpenPR}
      />
    </aside>
  )
}

export const WorkspaceReviewSidebar = React.memo(WorkspaceReviewSidebarImpl)
WorkspaceReviewSidebar.displayName = 'WorkspaceReviewSidebar'
