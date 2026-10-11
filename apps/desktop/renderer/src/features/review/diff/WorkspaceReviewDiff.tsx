import React from 'react'
import { MarkdownMessage } from '../../markdown/index.js'
import { VList } from 'virtua'
import {
  Briefcase,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  CheckCircle2,
  Columns2,
  Ellipsis,
  Eye,
  ExternalLink,
  File,
  FileDiff,
  GitCommitHorizontal,
  GitFork,
  GitPullRequestArrow,
  Minus,
  Plus,
  RotateCcw,
  Rows2,
  Search,
  Trash2,
  Type,
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
  DesktopReviewScope,
  DesktopReviewSource,
  DesktopReviewView,
  DesktopSessionStatus,
} from '../../../../shared/Types.js'
import { desktopClient, desktopClipboard } from '../../../services/desktop-client/index.js'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'

import { PopoverItem } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { FileTypeIcon } from '../../layout/FileTypeIcon.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import {
  useDisclosureExpanded,
  type KeyedDisclosureStore,
} from '../../../components/ui/KeyedDisclosureStore.js'
import { buildCommentCountsByPath } from '../comments/ReviewCommentUtils.js'
import { CommitPopover } from '../workspace/CommitPopover.js'
import { PullRequestPopover } from '../workspace/PullRequestPopover.js'
import { formatReviewCount } from './ReviewFormat.js'
import {
  isReviewDiffExpanded,
  toggleReviewDiffExpansion,
  type ReviewTabUiState,
} from '../../layout/tabs/ConversationUiState.js'
import {
  buildReviewIntralineByLineId,
  type ReviewIntralineByLineId,
} from './ReviewIntralineDiff.js'
import {
  ReviewDiffInline,
  ReviewDiffLineContent,
  ReviewDiffLineNumber,
  ReviewDiffSplit,
  ReviewHunkActions,
  ReviewSyntaxText,
  buildAnchor,
  commentKey,
  countUnmodifiedLinesBeforeHunk,
  formatUnmodifiedLines,
  splitDiffLines,
  useReviewDiffSyntax,
  type CommentAnchor,
  type CommentDraft,
  type ReviewCell,
  type ReviewSyntaxByLineId,
} from './ReviewDiffSurface.js'
export { ReviewComment, type CommentAnchor, type CommentDraft } from './ReviewDiffSurface.js'
import {
  ReviewFileRequestCoordinator,
  reviewAgentClient,
  pickDefaultReviewBaseBranch,
  retainCurrentReviewFileDiffs,
  reviewLoadStateForError,
  reviewSourceLabel,
  summaryFileToDesktop,
  type ReviewBranch,
  type ReviewCommit,
  type ReviewFileDiff,
  type ReviewLoadState,
  type ReviewSummarySnapshot,
} from '../source/ReviewAgentClient.js'
import { errorMessageOf } from '@pidex/shared/errors'
import { cx } from '../../../utils/Cx.js'

export { errorMessageOf }

export type ReviewDisplayPath = {
  directory: string
  fileName: string
}

export type ReviewFileLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded' }
  | { status: 'error'; message: string }

export function reviewFileLoadMessage(
  fileLoadState: ReviewFileLoadState,
  summaryLoadState: ReviewLoadState,
): string | null {
  if (fileLoadState.status === 'loading') return '正在加载文件差异…'
  if (fileLoadState.status !== 'idle') return null
  if (summaryLoadState === 'loading' || summaryLoadState === 'stale') {
    return '正在刷新变更快照…'
  }
  if (summaryLoadState === 'error') {
    return '变更快照加载失败，请使用上方重试。'
  }
  return '等待加载文件差异…'
}

export type ReviewFileDiffLoadMode = 'none' | 'batch' | 'selected'

export function reviewFileDiffLoadMode(input: {
  hasSummary: boolean
  cacheState: 'fresh' | 'stale' | null
  summaryLoadState: ReviewLoadState
  largeWorkspaceMode: boolean
  selectedPath: string | null
}): ReviewFileDiffLoadMode {
  if (
    !input.hasSummary ||
    input.cacheState !== 'fresh' ||
    (input.summaryLoadState !== 'success' && input.summaryLoadState !== 'large-diff')
  ) {
    return 'none'
  }
  if (input.largeWorkspaceMode) {
    return input.selectedPath ? 'selected' : 'none'
  }
  return 'batch'
}

export const REVIEW_FILE_TREE_PANEL_DEFAULT_WIDTH = 340
export const REVIEW_FILE_TREE_PANEL_MIN_WIDTH = 200
export const REVIEW_FILE_TREE_PANEL_MAX_WIDTH = 520
export const REVIEW_FILE_TREE_PANEL_KEYBOARD_STEP = 24
export const REVIEW_DIFF_PREVIEW_MIN_WIDTH = 260
export const REVIEW_FILE_ACTION_ICON_SIZE = APP_ICON_SIZE
/*
 * Complete static class list for both file action groups: the semantic hooks
 * stay in the DOM, and the reveal is driven by the file header row group.
 */
const FILE_ACTIONS_CLASS =
  'tw:inline-flex tw:flex-none tw:items-center tw:gap-1 tw:opacity-0 tw:pointer-events-none tw:transition-opacity tw:duration-feedback tw:ease-standard tw:group-hover/file-header:opacity-100 tw:group-hover/file-header:pointer-events-auto tw:group-focus-within/file-header:opacity-100 tw:group-focus-within/file-header:pointer-events-auto'
export const ListChevronsDownUp = createLucideIcon('list-chevrons-down-up', [
  ['path', { d: 'M3 5h8', key: '18g2rq' }],
  ['path', { d: 'M3 12h8', key: '1xfjp6' }],
  ['path', { d: 'M3 19h8', key: 'fpbke4' }],
  ['path', { d: 'm15 5 3 3 3-3', key: '1t4thf' }],
  ['path', { d: 'm15 19 3-3 3 3', key: 'y4ckd2' }],
])
export const ListChevronsUpDown = createLucideIcon('list-chevrons-up-down', [
  ['path', { d: 'M3 5h8', key: '18g2rq' }],
  ['path', { d: 'M3 12h8', key: '1xfjp6' }],
  ['path', { d: 'M3 19h8', key: 'fpbke4' }],
  ['path', { d: 'm15 8 3-3 3 3', key: 'bc4io6' }],
  ['path', { d: 'm15 16 3 3 3-3', key: '9wmg1l' }],
])
export const FILE_HEADER_HEIGHT = 38
export const HUNK_HEADER_HEIGHT = 28
export const DIFF_LINE_HEIGHT = 22
export const EMPTY_FILE_MIN_HEIGHT = 64
export const REVIEW_FILE_VIRTUALIZE_LINE_THRESHOLD = 800

export function estimateFilePreviewHeight(file: DesktopReviewDiffFile): number {
  let totalLines = 0
  let hunksWithContent = 0
  for (const hunk of file.hunks) {
    if (hunk.lines.length > 0) {
      hunksWithContent++
      totalLines += hunk.lines.length
    }
  }
  if (hunksWithContent === 0) return EMPTY_FILE_MIN_HEIGHT
  return FILE_HEADER_HEIGHT + hunksWithContent * HUNK_HEADER_HEIGHT + totalLines * DIFF_LINE_HEIGHT
}

export function countReviewDiffLines(files: DesktopReviewDiffFile[]): number {
  let total = 0
  for (const file of files) {
    for (const hunk of file.hunks) {
      total += hunk.lines.length
    }
  }
  return total
}

export function splitReviewDisplayPath(path: string): ReviewDisplayPath {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return separator < 0
    ? { directory: '', fileName: path }
    : {
        directory: path.slice(0, separator + 1),
        fileName: path.slice(separator + 1),
      }
}

/* ── Virtual-scroll flatten helpers ─────────────────────────── */

export type DiffVirtualRow =
  | {
      kind: 'hunk-header'
      hunk: DesktopReviewDiffHunk
      unmodifiedLines: number
    }
  | { kind: 'inline-line'; line: DesktopReviewDiffLine }
  | { kind: 'split-row'; left: ReviewCell; right: ReviewCell; rowId: string }

export function flattenDiffRows(
  file: DesktopReviewDiffFile,
  view: DesktopReviewView,
): DiffVirtualRow[] {
  const rows: DiffVirtualRow[] = []
  let previousHunk: DesktopReviewDiffHunk | null = null
  for (const hunk of file.hunks) {
    rows.push({
      kind: 'hunk-header',
      hunk,
      unmodifiedLines: countUnmodifiedLinesBeforeHunk(hunk, previousHunk),
    })
    if (view === 'split') {
      const splitRows = splitDiffLines(hunk.lines)
      for (const sr of splitRows) {
        rows.push({
          kind: 'split-row',
          left: sr.left,
          right: sr.right,
          rowId: sr.id,
        })
      }
    } else {
      for (const line of hunk.lines) {
        rows.push({ kind: 'inline-line', line })
      }
    }
    previousHunk = hunk
  }
  return rows
}

export const ReviewDiffPreview = React.memo(
  function ReviewDiffPreview({
    attachedComments,
    disclosureStore,
    diffMarkerStyle,
    draft,
    fileLoadStates,
    files,
    largeWorkspaceMode,
    readOnly = false,
    richPreview = true,
    viewedRevisions = {},
    branchReview = false,
    onToggleViewed,
    onOpenReviewFile,
    pending,
    summaryLoadState,
    scope,
    selectedPath,
    onDiffExpandedChange,
    viewportRef,
    view,
    showWordDiff,
    wrapLines,
    workspacePath,
    onApplyOperation,
    onCancelDraft,
    onCreateDraft,
    onDeleteComment,
    onFileSectionMount,
    onRetryFile,
    onResolveComment,
    onSaveDraft,
    onScroll,
  }: {
    attachedComments: Map<string, DesktopReviewComment[]>
    disclosureStore: KeyedDisclosureStore
    diffMarkerStyle: DesktopDiffMarkerStyle
    draft: CommentDraft | null
    fileLoadStates: ReadonlyMap<string, ReviewFileLoadState>
    files: DesktopReviewDiffFile[]
    largeWorkspaceMode: boolean
    readOnly?: boolean
    richPreview?: boolean
    viewedRevisions?: Record<string, string>
    branchReview?: boolean
    onToggleViewed?: (path: string, revision: string) => void
    onOpenReviewFile?: (path: string) => void
    pending: boolean
    summaryLoadState: ReviewLoadState
    scope: DesktopReviewScope
    selectedPath: string | null
    onDiffExpandedChange: (path: string, expanded: boolean) => void
    viewportRef: React.RefObject<HTMLDivElement | null>
    view: DesktopReviewView
    showWordDiff: boolean
    wrapLines: boolean
    workspacePath: string | null
    onApplyOperation: (
      action: 'stage' | 'unstage' | 'revert',
      target: { type: 'file'; path: string } | { type: 'hunk'; path: string; hunkId: string },
    ) => void
    onCancelDraft: () => void
    onCreateDraft: (draft: CommentDraft) => void
    onDeleteComment: (commentId: string) => void
    onFileSectionMount: (path: string, element: HTMLElement | null) => void
    onRetryFile: (path: string) => void
    onScroll: (scrollTop: number) => void
    onResolveComment: (commentId: string) => void
    onSaveDraft: (body: string) => void
  }): React.ReactNode {
    const filePaths = React.useMemo(() => files.map((file) => file.path), [files])
    const filePathSet = React.useMemo(() => new Set(filePaths), [filePaths])
    const [windowedPaths, setWindowedPaths] = React.useState<Set<string>>(() => {
      const initialPath = selectedPath ?? filePaths[0]
      return initialPath ? new Set([initialPath]) : new Set()
    })
    const fileSectionElementsRef = React.useRef(new Map<string, HTMLElement>())

    // Refs so the IntersectionObserver callback always sees latest values
    const selectedPathRef = React.useRef(selectedPath)
    selectedPathRef.current = selectedPath
    const draftFilePathRef = React.useRef(draft?.filePath ?? null)
    draftFilePathRef.current = draft?.filePath ?? null

    // Sync windowedPaths when files change, or when selectedPath / draft file changes
    React.useEffect(() => {
      setWindowedPaths((current) => {
        const next = new Set<string>()
        for (const path of current) {
          if (filePathSet.has(path)) next.add(path)
        }
        if (selectedPath && filePathSet.has(selectedPath)) next.add(selectedPath)
        if (draft?.filePath && filePathSet.has(draft.filePath)) next.add(draft.filePath)
        if (next.size === 0 && filePaths[0]) next.add(filePaths[0])
        return next
      })
    }, [filePathSet, filePaths, selectedPath, draft?.filePath])

    // IntersectionObserver for windowing: add near viewport, remove when far out
    React.useEffect(() => {
      if (typeof IntersectionObserver === 'undefined') return
      const root = viewportRef.current
      if (!root) return

      const observer = new IntersectionObserver(
        (entries) => {
          setWindowedPaths((current) => {
            let changed = false
            const next = new Set(current)
            for (const entry of entries) {
              const path = (entry.target as HTMLElement).dataset.reviewDiffPath
              if (!path) continue

              if (entry.isIntersecting) {
                if (!next.has(path)) {
                  next.add(path)
                  changed = true
                }
              } else if (path !== selectedPathRef.current && path !== draftFilePathRef.current) {
                if (next.has(path)) {
                  next.delete(path)
                  changed = true
                }
              }
            }
            return changed ? next : current
          })
        },
        {
          root,
          rootMargin: `${Math.max(0, root.clientHeight)}px 0px`,
        },
      )

      for (const element of fileSectionElementsRef.current.values()) {
        observer.observe(element)
      }

      return () => observer.disconnect()
    }, [filePaths, viewportRef])

    const setFileSectionElement = React.useCallback(
      (path: string) => (element: HTMLElement | null) => {
        onFileSectionMount(path, element)
        if (element) {
          fileSectionElementsRef.current.set(path, element)
          return
        }
        fileSectionElementsRef.current.delete(path)
      },
      [onFileSectionMount],
    )

    return (
      <section
        className="review-diff-preview tw:relative tw:flex tw:flex-1 tw:min-w-0 tw:min-h-0 tw:max-h-none tw:flex-col tw:border-r-0 tw:bg-app-editor tw:overflow-hidden tw:[contain:size_layout_paint]"
        aria-label="工作区 diff"
        data-slot="review-diff-list"
      >
        <div className="review-diff-preview-content tw:flex tw:flex-auto tw:min-w-0 tw:min-h-0 tw:flex-col">
          <ScrollArea
            className="review-diff-scroll tw:flex-auto tw:min-h-0"
            contentClassName="review-diff-scroll-content tw:flex tw:h-full tw:min-h-full tw:flex-col"
            viewportRef={viewportRef}
            onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
          >
            {files.map((file) => (
              <ReviewDiffFilePreview
                active={file.path === selectedPath}
                attachedComments={attachedComments}
                disclosureStore={disclosureStore}
                diffMarkerStyle={diffMarkerStyle}
                draft={draft}
                file={file}
                fileLoadState={
                  fileLoadStates.get(file.path) ??
                  (file.hunks.length > 0 ? { status: 'loaded' } : { status: 'idle' })
                }
                key={file.path}
                largeWorkspaceMode={largeWorkspaceMode}
                readOnly={readOnly}
                richPreview={richPreview}
                viewedRevisions={viewedRevisions}
                branchReview={branchReview}
                onToggleViewed={onToggleViewed}
                onOpenReviewFile={onOpenReviewFile}
                pending={pending}
                summaryLoadState={summaryLoadState}
                previewHeight={estimateFilePreviewHeight(file)}
                renderBody={file.path === selectedPath || windowedPaths.has(file.path)}
                scope={scope}
                sectionRef={setFileSectionElement(file.path)}
                onDiffExpandedChange={onDiffExpandedChange}
                onRetryFile={onRetryFile}
                view={view}
                showWordDiff={showWordDiff}
                wrapLines={wrapLines}
                workspacePath={workspacePath}
                onApplyOperation={onApplyOperation}
                onCancelDraft={onCancelDraft}
                onCreateDraft={onCreateDraft}
                onDeleteComment={onDeleteComment}
                onResolveComment={onResolveComment}
                onSaveDraft={onSaveDraft}
              />
            ))}
          </ScrollArea>
        </div>
      </section>
    )
  },
  (previous, next) =>
    previous.attachedComments === next.attachedComments &&
    previous.disclosureStore === next.disclosureStore &&
    previous.diffMarkerStyle === next.diffMarkerStyle &&
    previous.draft === next.draft &&
    previous.fileLoadStates === next.fileLoadStates &&
    previous.files === next.files &&
    previous.largeWorkspaceMode === next.largeWorkspaceMode &&
    previous.readOnly === next.readOnly &&
    previous.richPreview === next.richPreview &&
    previous.viewedRevisions === next.viewedRevisions &&
    previous.branchReview === next.branchReview &&
    previous.onToggleViewed === next.onToggleViewed &&
    previous.onOpenReviewFile === next.onOpenReviewFile &&
    previous.pending === next.pending &&
    previous.summaryLoadState === next.summaryLoadState &&
    previous.scope === next.scope &&
    previous.selectedPath === next.selectedPath &&
    previous.viewportRef === next.viewportRef &&
    previous.view === next.view &&
    previous.showWordDiff === next.showWordDiff &&
    previous.wrapLines === next.wrapLines &&
    previous.workspacePath === next.workspacePath,
)

export function shouldVirtualizeReviewFile(file: DesktopReviewDiffFile): boolean {
  return countReviewDiffLines([file]) > REVIEW_FILE_VIRTUALIZE_LINE_THRESHOLD
}

export const ReviewDiffFilePreview = React.memo(function ReviewDiffFilePreview({
  active,
  attachedComments,
  disclosureStore,
  diffMarkerStyle,
  draft,
  file: inputFile,
  fileLoadState,
  largeWorkspaceMode,
  readOnly = false,
  richPreview = true,
  viewedRevisions = {},
  branchReview = false,
  onToggleViewed,
  onOpenReviewFile,
  pending,
  summaryLoadState,
  previewHeight,
  renderBody,
  scope,
  sectionRef,
  onRetryFile,
  onDiffExpandedChange,
  view,
  showWordDiff,
  wrapLines,
  workspacePath,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onResolveComment,
  onSaveDraft,
}: {
  active: boolean
  attachedComments: Map<string, DesktopReviewComment[]>
  disclosureStore: KeyedDisclosureStore
  diffMarkerStyle: DesktopDiffMarkerStyle
  draft: CommentDraft | null
  file: DesktopReviewDiffFile
  fileLoadState: ReviewFileLoadState
  largeWorkspaceMode: boolean
  readOnly?: boolean
  richPreview?: boolean
  viewedRevisions?: Record<string, string>
  branchReview?: boolean
  onToggleViewed?: (path: string, revision: string) => void
  onOpenReviewFile?: (path: string) => void
  pending: boolean
  summaryLoadState: ReviewLoadState
  previewHeight: number
  renderBody: boolean
  scope: DesktopReviewScope
  sectionRef: (element: HTMLElement | null) => void
  onRetryFile: (path: string) => void
  onDiffExpandedChange: (path: string, expanded: boolean) => void
  view: DesktopReviewView
  showWordDiff: boolean
  wrapLines: boolean
  workspacePath: string | null
  onApplyOperation: (
    action: 'stage' | 'unstage' | 'revert',
    target: { type: 'file'; path: string } | { type: 'hunk'; path: string; hunkId: string },
  ) => void
  onCancelDraft: () => void
  onCreateDraft: (draft: CommentDraft) => void
  onDeleteComment: (commentId: string) => void
  onResolveComment: (commentId: string) => void
  onSaveDraft: (body: string) => void
}): React.ReactNode {
  // ponytail: one context disclosure per file; use per-gap disclosures if independent expansion is needed.
  const [showFullContext, setShowFullContext] = React.useState(false)
  const hiddenContextLines = inputFile.partialHunks
    ? countReviewDiffLines([inputFile]) -
      countReviewDiffLines([{ ...inputFile, hunks: inputFile.partialHunks }])
    : 0
  const file =
    !showFullContext && inputFile.partialHunks
      ? { ...inputFile, hunks: inputFile.partialHunks }
      : inputFile
  const [showRendered, setShowRendered] = React.useState(true)
  const canRender =
    richPreview &&
    file.fullContext &&
    file.status !== 'deleted' &&
    /\.(md|mdx|markdown)$/iu.test(file.path)
  const markdown = canRender
    ? inputFile.hunks
        .flatMap((hunk) => hunk.lines)
        .filter((line) => line.type !== 'removed')
        .map((line) => line.content)
        .join('\n')
    : ''
  const hasContent = file.hunks.some((hunk) => hunk.lines.length > 0)
  const isExpanded = useDisclosureExpanded(disclosureStore, file.path)
  const isCollapsed = !isExpanded
  const displayPath = splitReviewDisplayPath(file.path)
  const diffBodyId = React.useId()

  const virtualize = React.useMemo(() => {
    if (!renderBody || isCollapsed || !hasContent) return false
    return shouldVirtualizeReviewFile(file)
  }, [renderBody, isCollapsed, hasContent, file])

  const flattenedRows = React.useMemo(
    () => (virtualize ? flattenDiffRows(file, view) : []),
    [virtualize, file, view],
  )
  const intralineByLineId = React.useMemo(
    () =>
      buildReviewIntralineByLineId(file.hunks, {
        enabled: showWordDiff,
      }),
    [file.hunks, showWordDiff],
  )

  let diffBody: React.ReactNode
  if (isCollapsed) {
    diffBody = null
  } else if (!renderBody) {
    diffBody = (
      <div
        className="review-diff-lazy-placeholder tw:pointer-events-none"
        aria-hidden="true"
        style={{ height: previewHeight }}
      />
    )
  } else if (canRender && showRendered) {
    diffBody = (
      <div className="tw:px-4 tw:py-3">
        <MarkdownMessage text={markdown} cwd={workspacePath} />
      </div>
    )
  } else if (virtualize) {
    diffBody = (
      <div
        className={
          largeWorkspaceMode
            ? 'review-diff-virtual-body fill-space tw:flex tw:flex-1 tw:flex-col tw:min-h-0'
            : 'review-diff-virtual-body tw:flex tw:flex-none tw:flex-col tw:min-h-0'
        }
        style={
          !largeWorkspaceMode
            ? { height: Math.min(previewHeight - FILE_HEADER_HEIGHT, 600) }
            : undefined
        }
      >
        <ReviewVirtualDiffRows
          attachedComments={attachedComments}
          diffMarkerStyle={diffMarkerStyle}
          draft={draft}
          file={file}
          flattenedRows={flattenedRows}
          intralineByLineId={intralineByLineId}
          mutationsDisabled={readOnly}
          pending={pending}
          scope={scope}
          view={view}
          onApplyOperation={onApplyOperation}
          onCancelDraft={onCancelDraft}
          onCreateDraft={onCreateDraft}
          onDeleteComment={onDeleteComment}
          onResolveComment={onResolveComment}
          onSaveDraft={onSaveDraft}
        />
      </div>
    )
  } else if (fileLoadState.status === 'loading') {
    diffBody = (
      <div
        className="review-empty-state review-file-load-state tw:flex tw:min-h-16 tw:items-center tw:justify-center tw:gap-2 tw:px-4 tw:py-6 tw:text-app-text-meta tw:type-body-sm"
        role="status"
      >
        {reviewFileLoadMessage(fileLoadState, summaryLoadState)}
      </div>
    )
  } else if (fileLoadState.status === 'idle') {
    diffBody = (
      <div
        className="review-empty-state review-file-load-state tw:flex tw:min-h-16 tw:items-center tw:justify-center tw:gap-2 tw:px-4 tw:py-6 tw:text-app-text-meta tw:type-body-sm"
        role="status"
      >
        {reviewFileLoadMessage(fileLoadState, summaryLoadState)}
      </div>
    )
  } else if (fileLoadState.status === 'error') {
    diffBody = (
      <div
        className="review-empty-state review-file-load-state tw:flex tw:min-h-16 tw:items-center tw:justify-center tw:gap-2 tw:px-4 tw:py-6 tw:text-app-text-meta tw:type-body-sm"
        role="alert"
      >
        <span>{fileLoadState.message}</span>
        <Button size="compact" type="button" onClick={() => onRetryFile(file.path)}>
          重试
        </Button>
      </div>
    )
  } else if (!hasContent) {
    diffBody = (
      <div className="review-empty-state tw:px-4 tw:py-6 tw:text-app-text-meta tw:type-body-sm">
        {file.isUntracked
          ? '未跟踪文件暂不展示 hunk 预览，可直接暂存或删除。'
          : '此文件没有可用的 hunk 预览。'}
      </div>
    )
  } else if (view === 'split') {
    diffBody = (
      <ReviewDiffSplit
        attachedComments={attachedComments}
        diffMarkerStyle={diffMarkerStyle}
        draft={draft}
        file={file}
        intralineByLineId={intralineByLineId}
        mutationsDisabled={readOnly}
        pending={pending}
        scope={scope}
        wrapLines={wrapLines}
        onApplyOperation={onApplyOperation}
        onCancelDraft={onCancelDraft}
        onCreateDraft={onCreateDraft}
        onDeleteComment={onDeleteComment}
        onResolveComment={onResolveComment}
        onSaveDraft={onSaveDraft}
      />
    )
  } else {
    diffBody = (
      <ReviewDiffInline
        attachedComments={attachedComments}
        diffMarkerStyle={diffMarkerStyle}
        draft={draft}
        file={file}
        intralineByLineId={intralineByLineId}
        mutationsDisabled={readOnly}
        pending={pending}
        scope={scope}
        wrapLines={wrapLines}
        onApplyOperation={onApplyOperation}
        onCancelDraft={onCancelDraft}
        onCreateDraft={onCreateDraft}
        onDeleteComment={onDeleteComment}
        onResolveComment={onResolveComment}
        onSaveDraft={onSaveDraft}
      />
    )
  }

  return (
    <section
      className={
        !virtualize
          ? 'review-diff-file-preview tw:flex-none tw:min-w-0'
          : largeWorkspaceMode
            ? 'review-diff-file-preview virtualized fill-space tw:flex-[1_0_auto] tw:h-full tw:min-w-0 tw:flex tw:flex-col tw:min-h-0'
            : 'review-diff-file-preview virtualized tw:flex-none tw:min-w-0 tw:flex tw:flex-col tw:min-h-0'
      }
      ref={sectionRef}
      aria-label={`${file.path} diff`}
      data-review-diff-path={file.path}
      data-slot="review-diff-file"
    >
      <div
        className={cx(
          'review-file-row preview-header tw:group/file-header tw:sticky tw:top-0 tw:z-local tw:m-0 tw:flex tw:h-10 tw:min-h-10 tw:flex-none tw:items-center tw:gap-0 tw:rounded-none tw:border-0 tw:border-b tw:border-b-app-border-subtle tw:px-4 tw:py-1 tw:text-left tw:text-app-text-soft tw:type-body-sm tw:transition-[color,background-color] tw:duration-feedback tw:ease-standard tw:hover:text-app-text',
          active && 'active tw:text-app-text',
        )}
      >
        <button
          aria-controls={diffBodyId}
          aria-expanded={!isCollapsed}
          className="review-file-summary tw:flex tw:flex-auto tw:min-w-0 tw:items-center tw:gap-0 tw:self-stretch tw:appearance-none tw:rounded-sm tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:outline-none tw:cursor-pointer tw:hover:text-app-text tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)]"
          type="button"
          onClick={() => onDiffExpandedChange(file.path, !isExpanded)}
        >
          <FileTypeIcon
            associationMode="extension-only"
            aria-hidden="true"
            className="review-file-icon tw:size-icon tw:min-w-4 tw:mr-2 tw:shrink-0"
            path={file.path}
            size={APP_ICON_SIZE}
          />
          <span
            className="review-file-path tw:min-w-0 tw:flex-[0_1_auto] tw:overflow-hidden tw:text-ellipsis tw:whitespace-nowrap tw:text-app-text-meta tw:type-body-sm tw:[direction:rtl] tw:text-start"
            title={file.path}
          >
            <span className="review-file-path__content tw:[direction:ltr] tw:[unicode-bidi:plaintext]">
              <span className="review-file-path__directory tw:text-app-text-meta">
                {displayPath.directory}
              </span>
              <span className="review-file-path__name tw:text-app-text">
                {displayPath.fileName}
              </span>
            </span>
          </span>
          <span className="review-file-counts tw:inline-flex tw:flex-none tw:items-center tw:gap-2 tw:ml-1">
            <strong className="tw:text-app-success tw:type-weight-label">
              +{formatPanelNumber(file.additions)}
            </strong>
            <em className="tw:text-app-danger tw:not-italic tw:type-weight-label">
              -{formatPanelNumber(file.deletions)}
            </em>
          </span>
        </button>
        <div
          className={cx(
            'review-file-actions review-file-actions-primary tw:ml-1 tw:inline-flex tw:items-center tw:gap-1',
          )}
          role="group"
          aria-label="文件查看操作"
        >
          <Tooltip content={isCollapsed ? '展开文件差异' : '折叠文件差异'}>
            <Button
              isIconOnly
              aria-controls={diffBodyId}
              aria-expanded={!isCollapsed}
              className="review-file-toggle"
              color="ghostSecondary"
              data-expanded={isCollapsed ? 'false' : 'true'}
              size="iconMd"
              title={isCollapsed ? '展开文件差异' : '折叠文件差异'}
              onClick={() => onDiffExpandedChange(file.path, !isExpanded)}
            >
              <ChevronRight
                className={cx(
                  'tw:transition-transform tw:duration-state tw:ease-standard',
                  !isCollapsed && 'tw:rotate-90',
                )}
                size={REVIEW_FILE_ACTION_ICON_SIZE}
              />
            </Button>
          </Tooltip>
          {branchReview && file.revision && onToggleViewed ? (
            <Tooltip
              content={
                viewedRevisions[file.path] === file.revision ? '标记为未审阅' : '标记为已审阅'
              }
            >
              <Button
                isIconOnly
                color="ghostSecondary"
                size="iconMd"
                aria-label={
                  viewedRevisions[file.path] === file.revision ? '标记为未审阅' : '标记为已审阅'
                }
                aria-pressed={viewedRevisions[file.path] === file.revision}
                onClick={() => onToggleViewed(file.path, file.revision!)}
              >
                {viewedRevisions[file.path] === file.revision ? (
                  <CheckCircle2 size={REVIEW_FILE_ACTION_ICON_SIZE} />
                ) : (
                  <Eye size={REVIEW_FILE_ACTION_ICON_SIZE} />
                )}
              </Button>
            </Tooltip>
          ) : null}
          {canRender ? (
            <Tooltip content={showRendered ? '显示源码' : '渲染预览'}>
              <Button
                isIconOnly
                color="ghostSecondary"
                size="iconMd"
                aria-label={showRendered ? '显示源码' : '渲染预览'}
                onClick={() => setShowRendered((value) => !value)}
              >
                <Code2 size={REVIEW_FILE_ACTION_ICON_SIZE} />
              </Button>
            </Tooltip>
          ) : null}
          <Tooltip content="打开文件">
            <Button
              isIconOnly
              aria-disabled={!workspacePath}
              className="review-file-open"
              color="ghostSecondary"
              size="iconMd"
              title="打开文件"
              onClick={() => {
                if (onOpenReviewFile) {
                  onOpenReviewFile(file.path)
                  return
                }
                if (!workspacePath) return
                void desktopClient.openPathWithDefaultTarget(
                  `${workspacePath.replace(/[\\/]$/, '')}/${file.path}`,
                )
              }}
            >
              <ExternalLink size={REVIEW_FILE_ACTION_ICON_SIZE} />
            </Button>
          </Tooltip>
        </div>
        {!readOnly ? (
          <div
            className={cx(
              'review-file-actions review-file-actions-secondary tw:ml-auto',
              FILE_ACTIONS_CLASS,
            )}
            role="group"
            aria-label="文件 Git 操作"
          >
            <Tooltip content={file.isUntracked ? '删除未跟踪文件' : '还原文件'}>
              <Button
                isIconOnly
                aria-disabled={pending}
                color="ghostSecondary"
                size="iconMd"
                title={file.isUntracked ? '删除未跟踪文件' : '还原文件'}
                onClick={() => {
                  if (pending) return
                  onApplyOperation('revert', { type: 'file', path: file.path })
                }}
              >
                {file.isUntracked ? (
                  <Trash2 size={REVIEW_FILE_ACTION_ICON_SIZE} />
                ) : (
                  <Undo2 size={REVIEW_FILE_ACTION_ICON_SIZE} />
                )}
              </Button>
            </Tooltip>
            {scope === 'unstaged' ? (
              <Tooltip content="暂存文件">
                <Button
                  isIconOnly
                  aria-disabled={pending}
                  color="ghostSecondary"
                  size="iconMd"
                  title="暂存文件"
                  onClick={() => {
                    if (pending) return
                    onApplyOperation('stage', { type: 'file', path: file.path })
                  }}
                >
                  <Plus size={REVIEW_FILE_ACTION_ICON_SIZE} />
                </Button>
              </Tooltip>
            ) : (
              <Tooltip content="取消暂存文件">
                <Button
                  isIconOnly
                  aria-disabled={pending}
                  color="ghostSecondary"
                  size="iconMd"
                  title="取消暂存文件"
                  onClick={() => {
                    if (pending) return
                    onApplyOperation('unstage', { type: 'file', path: file.path })
                  }}
                >
                  <Minus size={REVIEW_FILE_ACTION_ICON_SIZE} />
                </Button>
              </Tooltip>
            )}
          </div>
        ) : null}
      </div>
      <div className="review-diff-file-body tw:contents" id={diffBodyId}>
        {diffBody}
        {!isCollapsed && hiddenContextLines > 0 && (!canRender || !showRendered) ? (
          <button
            type="button"
            aria-expanded={showFullContext}
            className="tw:mx-2 tw:mb-2 tw:flex tw:items-center tw:gap-2 tw:rounded-lg tw:border-0 tw:bg-app-raised tw:px-3 tw:py-2 tw:text-left tw:text-app-text-meta tw:type-body-sm tw:cursor-pointer tw:focus-visible:outline-2 tw:focus-visible:outline-app-focus"
            onClick={() => setShowFullContext((value) => !value)}
          >
            <ChevronDown size={REVIEW_FILE_ACTION_ICON_SIZE} />
            {showFullContext
              ? '折叠未修改代码'
              : `${formatPanelNumber(hiddenContextLines)} 行未修改代码`}
          </button>
        ) : null}
      </div>
    </section>
  )
})

/* ── Virtual-scroll row renderers ──────────────────────────── */

export function ReviewVirtualDiffRows({
  attachedComments,
  diffMarkerStyle,
  draft,
  file,
  flattenedRows,
  intralineByLineId,
  pending,
  scope,
  view,
  mutationsDisabled = false,
  readOnly = false,
  onApplyOperation,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onResolveComment,
  onSaveDraft,
}: {
  attachedComments: Map<string, DesktopReviewComment[]>
  diffMarkerStyle: DesktopDiffMarkerStyle
  draft: CommentDraft | null
  file: DesktopReviewDiffFile
  flattenedRows: DiffVirtualRow[]
  intralineByLineId: ReviewIntralineByLineId
  pending: boolean
  scope: DesktopReviewScope
  view: DesktopReviewView
  mutationsDisabled?: boolean
  readOnly?: boolean
  onApplyOperation: (
    action: 'stage' | 'unstage' | 'revert',
    target: { type: 'file'; path: string } | { type: 'hunk'; path: string; hunkId: string },
  ) => void
  onCancelDraft: () => void
  onCreateDraft: (draft: CommentDraft) => void
  onDeleteComment: (commentId: string) => void
  onResolveComment: (commentId: string) => void
  onSaveDraft: (body: string) => void
}): React.ReactNode {
  const syntax = useReviewDiffSyntax(file)

  return (
    <div
      className="review-codex-diff review-codex-diff--virtual"
      data-diff=""
      data-diff-type={view === 'split' ? 'split' : 'single'}
      data-indicators={diffMarkerStyle === 'symbol' ? 'classic' : 'bars'}
      data-overflow="scroll"
      data-review-syntax-state={syntax.state}
    >
      <VList
        bufferSize={64}
        className="review-diff-vlist tw:flex-1 tw:min-h-0 tw:overflow-x-hidden"
        data={flattenedRows}
        itemSize={20}
        style={{ width: '100%', height: '100%' }}
      >
        {(row) =>
          row.kind === 'hunk-header' ? (
            <VirtualDiffHunkRow
              file={file}
              hunk={row.hunk}
              key={`hunk-${row.hunk.id}`}
              pending={pending}
              readOnly={readOnly || mutationsDisabled}
              scope={scope}
              unmodifiedLines={row.unmodifiedLines}
              onApplyOperation={onApplyOperation}
            />
          ) : view === 'split' && row.kind === 'split-row' ? (
            <VirtualDiffSplitRow
              key={row.rowId}
              attachedComments={attachedComments}
              draft={draft}
              file={file}
              left={row.left}
              right={row.right}
              intralineByLineId={intralineByLineId}
              syntaxByLineId={syntax.byLineId}
              onCancelDraft={onCancelDraft}
              onCreateDraft={onCreateDraft}
              onDeleteComment={onDeleteComment}
              onResolveComment={onResolveComment}
              onSaveDraft={onSaveDraft}
            />
          ) : row.kind === 'inline-line' ? (
            <VirtualDiffInlineRow
              key={row.line.id}
              attachedComments={attachedComments}
              draft={draft}
              file={file}
              line={row.line}
              intralineByLineId={intralineByLineId}
              readOnly={readOnly}
              syntaxByLineId={syntax.byLineId}
              onCancelDraft={onCancelDraft}
              onCreateDraft={onCreateDraft}
              onDeleteComment={onDeleteComment}
              onResolveComment={onResolveComment}
              onSaveDraft={onSaveDraft}
            />
          ) : null
        }
      </VList>
    </div>
  )
}

export function VirtualDiffHunkRow({
  file,
  hunk,
  unmodifiedLines,
  pending,
  scope,
  readOnly = false,
  onApplyOperation,
}: {
  file: DesktopReviewDiffFile
  hunk: DesktopReviewDiffHunk
  unmodifiedLines: number
  pending: boolean
  scope: DesktopReviewScope
  readOnly?: boolean
  onApplyOperation: (
    action: 'stage' | 'unstage' | 'revert',
    target: { type: 'hunk'; path: string; hunkId: string },
  ) => void
}): React.ReactNode {
  return (
    <div className="review-codex-diff__virtual-row" data-virtual-layout="hunk">
      <div
        className="review-codex-diff__hunk review-codex-diff__hunk--gutter"
        data-separator="line-info"
      />
      <div
        className="review-codex-diff__hunk review-codex-diff__hunk--content"
        data-separator="line-info"
      >
        <div data-separator-wrapper="">
          <span data-separator-content="">{formatUnmodifiedLines(unmodifiedLines)}</span>
          {readOnly ? null : (
            <ReviewHunkActions
              file={file}
              hunk={hunk}
              pending={pending}
              scope={scope}
              onApplyOperation={onApplyOperation}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export function VirtualDiffInlineRow({
  attachedComments,
  draft,
  file,
  line,
  intralineByLineId,
  syntaxByLineId,
  readOnly = false,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onResolveComment,
  onSaveDraft,
}: {
  attachedComments: Map<string, DesktopReviewComment[]>
  draft: CommentDraft | null
  file: DesktopReviewDiffFile
  line: DesktopReviewDiffLine
  intralineByLineId: ReviewIntralineByLineId
  syntaxByLineId: ReviewSyntaxByLineId
  readOnly?: boolean
  onCancelDraft: () => void
  onCreateDraft: (draft: CommentDraft) => void
  onDeleteComment: (commentId: string) => void
  onResolveComment: (commentId: string) => void
  onSaveDraft: (body: string) => void
}): React.ReactNode {
  const side = line.type === 'removed' ? 'left' : 'right'
  const lineNumber = line.type === 'removed' ? line.oldLine : line.newLine
  const anchor = buildAnchor(file.path, side, lineNumber, line.content)
  const comments = anchor ? (attachedComments.get(commentKey(anchor)) ?? []) : []

  return (
    <div className="review-codex-diff__virtual-row" data-virtual-layout="single">
      <ReviewDiffLineNumber
        anchor={readOnly ? null : anchor}
        cellTone={line.type}
        lineNumber={lineNumber}
        readOnly={readOnly}
        onCreateDraft={onCreateDraft}
      />
      <ReviewDiffLineContent
        anchor={readOnly ? null : anchor}
        comments={readOnly ? [] : comments}
        draft={readOnly ? null : draft}
        cellTone={line.type}
        readOnly={readOnly}
        onCancelDraft={onCancelDraft}
        onDeleteComment={onDeleteComment}
        onResolveComment={onResolveComment}
        onSaveDraft={onSaveDraft}
      >
        <span className="review-codex-diff__line-text">
          <ReviewSyntaxText
            content={line.content}
            line={line}
            ranges={intralineByLineId.get(line.id)}
            syntaxByLineId={syntaxByLineId}
          />
        </span>
      </ReviewDiffLineContent>
    </div>
  )
}

export function VirtualDiffSplitRow({
  attachedComments,
  draft,
  file,
  left,
  right,
  intralineByLineId,
  syntaxByLineId,
  onCancelDraft,
  onCreateDraft,
  onDeleteComment,
  onResolveComment,
  onSaveDraft,
}: {
  attachedComments: Map<string, DesktopReviewComment[]>
  draft: CommentDraft | null
  file: DesktopReviewDiffFile
  left: ReviewCell
  right: ReviewCell
  intralineByLineId: ReviewIntralineByLineId
  syntaxByLineId: ReviewSyntaxByLineId
  onCancelDraft: () => void
  onCreateDraft: (draft: CommentDraft) => void
  onDeleteComment: (commentId: string) => void
  onResolveComment: (commentId: string) => void
  onSaveDraft: (body: string) => void
}): React.ReactNode {
  return (
    <div className="review-codex-diff__virtual-row" data-virtual-layout="split">
      {[left, right].map((cell) => {
        const anchor = buildAnchor(file.path, cell.side, cell.number, cell.content)
        const comments = anchor ? (attachedComments.get(commentKey(anchor)) ?? []) : []
        return (
          <div className="review-codex-diff__virtual-cell" key={cell.side}>
            <ReviewDiffLineNumber
              anchor={anchor}
              cellTone={cell.tone}
              lineNumber={cell.number}
              onCreateDraft={onCreateDraft}
            />
            <ReviewDiffLineContent
              anchor={anchor}
              comments={comments}
              draft={draft}
              cellTone={cell.tone}
              onCancelDraft={onCancelDraft}
              onDeleteComment={onDeleteComment}
              onResolveComment={onResolveComment}
              onSaveDraft={onSaveDraft}
            >
              <span className="review-codex-diff__line-text">
                {cell.tone === 'empty' ? (
                  ' '
                ) : (
                  <ReviewSyntaxText
                    content={cell.content}
                    line={cell.line}
                    ranges={cell.line ? intralineByLineId.get(cell.line.id) : undefined}
                    syntaxByLineId={syntaxByLineId}
                  />
                )}
              </span>
            </ReviewDiffLineContent>
          </div>
        )
      })}
    </div>
  )
}

export function clampReviewFileTreePanelWidth(width: number, containerWidth?: number): number {
  const containerMax =
    typeof containerWidth === 'number' && Number.isFinite(containerWidth)
      ? Math.max(
          REVIEW_FILE_TREE_PANEL_MIN_WIDTH,
          Math.min(containerWidth * 0.6, containerWidth - REVIEW_DIFF_PREVIEW_MIN_WIDTH),
        )
      : REVIEW_FILE_TREE_PANEL_MAX_WIDTH
  const maxWidth = containerMax
  return Math.round(Math.min(Math.max(width, REVIEW_FILE_TREE_PANEL_MIN_WIDTH), maxWidth))
}

export function attachComments(
  files: DesktopReviewDiffFile[],
  comments: DesktopReviewComment[],
): {
  attachedComments: Map<string, DesktopReviewComment[]>
  staleComments: DesktopReviewComment[]
} {
  const anchors = new Set<string>()
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.oldLine !== null) {
          anchors.add(
            commentKey({
              filePath: file.path,
              side: 'left',
              lineNumber: line.oldLine,
              lineContent: line.content,
            }),
          )
        }
        if (line.newLine !== null) {
          anchors.add(
            commentKey({
              filePath: file.path,
              side: 'right',
              lineNumber: line.newLine,
              lineContent: line.content,
            }),
          )
        }
      }
    }
  }
  const attachedComments = new Map<string, DesktopReviewComment[]>()
  const staleComments: DesktopReviewComment[] = []
  for (const comment of comments) {
    if (comment.status === 'resolved') continue
    const key = commentKey(comment)
    if (!anchors.has(key)) {
      staleComments.push(comment)
      continue
    }
    attachedComments.set(key, [...(attachedComments.get(key) ?? []), comment])
  }
  return { attachedComments, staleComments }
}

export function ReviewProjectEmptyState({
  source,
}: {
  source: DesktopReviewSource
}): React.ReactNode {
  if (source.kind === 'unstaged') {
    return (
      <div className="review-project-empty-state tw:flex tw:w-full tw:min-w-0 tw:min-h-0 tw:flex-auto tw:items-center tw:justify-center tw:px-3 tw:py-6 tw:text-center">
        <div className="review-project-empty-state__copy tw:flex tw:flex-col tw:items-center tw:gap-2">
          <strong className="tw:text-app-text tw:type-title-sm">无未暂存更改</strong>
          <span className="tw:text-app-text-soft tw:type-body-sm">代码更改将在此处显示</span>
        </div>
      </div>
    )
  }
  if (source.kind === 'staged') {
    return (
      <div className="review-project-empty-state tw:flex tw:w-full tw:min-w-0 tw:min-h-0 tw:flex-auto tw:items-center tw:justify-center tw:px-3 tw:py-6 tw:text-center">
        <div className="review-project-empty-state__copy tw:flex tw:flex-col tw:items-center tw:gap-2">
          <strong className="tw:text-app-text tw:type-title-sm">无暂存更改</strong>
          <span className="tw:text-app-text-soft tw:type-body-sm">接受编辑内容并暂存</span>
        </div>
      </div>
    )
  }
  return (
    <div className="review-project-empty-state tw:flex tw:w-full tw:min-w-0 tw:min-h-0 tw:flex-auto tw:items-center tw:justify-center tw:px-3 tw:py-6 tw:text-center">
      <div className="review-project-empty-state__content tw:flex tw:w-full tw:max-w-[576px] tw:flex-col tw:items-center tw:gap-3">
        <FileDiff
          className="tw:size-icon-lg tw:text-app-text-meta tw:[stroke-width:var(--cpx-sys-icon-stroke-width)]"
          size={APP_ICON_SIZES.lg}
          aria-hidden="true"
        />
        <div className="review-project-empty-state__copy tw:flex tw:flex-col tw:items-center tw:gap-2">
          <strong className="tw:text-app-text tw:type-title-sm">尚无文件更改</strong>
          <span className="tw:text-app-text-soft tw:type-body-sm">
            此项目中的更改将显示在此处。
          </span>
        </div>
      </div>
    </div>
  )
}

export function scopeLabel(scope: DesktopReviewScope): string {
  switch (scope) {
    case 'staged':
      return '已暂存'
    default:
      return '未暂存'
  }
}

export function formatPanelNumber(value: number): string {
  return formatReviewCount(value)
}

export function buildReviewComposerPrompt(
  gitStatus: DesktopGitStatus | null,
  files: DesktopReviewDiffFile[],
): string {
  const changedFiles = files.length > 0 ? files : []
  const fileList =
    changedFiles.length > 0
      ? changedFiles
          .slice(0, 50)
          .map((file) => `- ${file.path} (+${file.additions}/-${file.deletions})`)
          .join('\n')
      : gitStatus?.files.length
        ? gitStatus.files
            .slice(0, 50)
            .map((file) => `- ${file.path} (${file.status.trim() || '已修改'})`)
            .join('\n')
        : '- 当前没有可用变更'
  return ['请对当前工作区变更发起一次代码审查。', '', '变更文件：', fileList].join('\n')
}

export function parseGithubPullRequestUrl(
  value: string,
): { owner: string; repository: string; number: number } | null {
  try {
    const url = new URL(value)
    if (url.hostname.toLowerCase() !== 'github.com') return null
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/u.exec(url.pathname)
    if (!match) return null
    return {
      owner: decodeURIComponent(match[1] ?? ''),
      repository: decodeURIComponent(match[2] ?? ''),
      number: Number.parseInt(match[3] ?? '', 10),
    }
  } catch {
    return null
  }
}

export async function copyGitApplyCommand(
  files: DesktopReviewDiffFile[],
  scope: DesktopReviewScope,
): Promise<void> {
  const patches: string[] = []
  for (const file of files) {
    for (const hunk of file.hunks) {
      if (hunk.lines.length === 0) continue
      patches.push(hunk.patch)
    }
  }
  if (patches.length === 0) return
  const cmd = scope === 'staged' ? 'git apply --cached' : 'git apply'
  const text = `${cmd} << 'EOF'\n${patches.join('\n')}\nEOF`
  try {
    await desktopClipboard.writeText(text)
  } catch {
    // clipboard write may fail in some contexts; silently ignore
  }
}
