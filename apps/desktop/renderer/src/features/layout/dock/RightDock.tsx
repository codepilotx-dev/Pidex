import type { FileEditorViewState } from '../../editor/FileEditor.js'
import type React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DesktopBrowserState,
  DesktopDiffMarkerStyle,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopGitStatus,
  DesktopReviewView,
  DesktopSessionStatus,
  DesktopWorkspace,
} from '../../../../shared/Types.js'
import type { ReviewTabUiState } from '../tabs/ConversationUiState.js'
import { TabStripButtonProvider } from '../../../components/ui/TabStripButtonContext.js'
import type {
  MarkdownFileViewMode,
  WorkbenchPanelSnapshot,
  WorkbenchPanelTarget,
  WorkbenchTabDescriptor,
  WorkbenchTabId,
  WorkbenchTabsState,
} from './RightDockState.js'
import {
  createLauncherTab,
  getWorkbenchLauncherDefinitions,
  getWorkbenchLauncherPresentation,
  getWorkbenchTabDefinition,
  type WorkbenchTabAvailability,
  type WorkbenchTabRenderContext,
} from '../tabs/WorkbenchTabRegistry.js'
import { WorkbenchTabStrip, workbenchTabDomId } from '../tabs/WorkbenchTabStrip.js'
import { WorkbenchDockFrame } from './WorkbenchDockFrame.js'
import {
  WorkbenchPanelLauncher,
  WorkbenchTabErrorBoundary,
} from '../panels/WorkbenchPanelStates.js'
import {
  WorkbenchPanelContent as WorkbenchPanelContentSurface,
  WorkbenchPanelSurface,
} from '../panels/WorkbenchPanelSurface.js'
import type { FileDocumentLoadErrorPhase } from './RightDockPanels.js'
import {
  type ResizePhase,
  useSidebarResizeCollapseConfirm,
} from '../UseSidebarResizeCollapseConfirm.js'
import { useWorkbenchPanelLiveResize } from '../panels/WorkbenchPanelPresence.js'

type Props = {
  target: WorkbenchPanelTarget
  state: WorkbenchPanelSnapshot
  tabsById: WorkbenchTabsState['tabsById']
  browserAvailability: WorkbenchTabAvailability
  browserState: DesktopBrowserState | null
  defaultBranch: string | null
  files: DesktopFileEntry[]
  gitStatus: DesktopGitStatus | null
  isRefreshingReview: boolean
  diffMarkerStyle: DesktopDiffMarkerStyle
  maxWidth: number
  minWidth: number
  maxHeight?: number
  minHeight?: number
  reviewView: DesktopReviewView
  onReviewSummaryChange?: WorkbenchTabRenderContext['review']['onReviewSummaryChange']
  onOpenReviewFile?: (path: string) => void
  reviewTabState: ReviewTabUiState
  selectedFile: DesktopFilePreview | null
  sessionId: string | null
  sessionStatus: DesktopSessionStatus
  terminalAvailable: boolean
  planContentByEventId: Readonly<Record<string, string>>
  width: number
  height?: number
  workspace: DesktopWorkspace | null
  browserDraftKey: import('../../session/composer/ComposerTypes.js').ComposerDraftKey
  onBrowserStateChange: (state: DesktopBrowserState) => void
  onClose: () => void
  onCloseTab: (tabId: WorkbenchTabId) => void
  onCloseOtherTabs: (tabId: WorkbenchTabId) => void
  onCloseTabsToRight: (tabId: WorkbenchTabId) => void
  onCreateBranch: () => void
  onFileLoadError: (event: WorkbenchFileLoadErrorEvent) => void
  onOpenTab: (tab: WorkbenchTabDescriptor) => void
  onOpenWorkspacePath: () => void
  onOpenFileFromBrowser: (file: DesktopFileEntry) => void
  onPreviewFile: (file: DesktopFileEntry) => void
  onAskInSideChat?: (text: string) => void
  onSetFileViewState?: (tabId: WorkbenchTabId, viewState: FileEditorViewState) => void
  onAppendComposerText: (text: string) => void
  onAddComposerFiles: (filePaths: string[]) => void
  onRefreshReview: () => void
  onReviewTabStateChange: (
    value: ReviewTabUiState | ((current: ReviewTabUiState) => ReviewTabUiState),
  ) => void
  onResetWidth: () => void
  onResetHeight?: () => void
  onSelectTab: (tabId: WorkbenchTabId) => void
  onSetWidth: (width: number) => void
  onSetHeight?: (height: number) => void
  onMoveTab: (
    source: WorkbenchPanelTarget,
    target: WorkbenchPanelTarget,
    tabId: WorkbenchTabId,
    index?: number,
  ) => void
  onReorderTab: (target: WorkbenchPanelTarget, tabId: WorkbenchTabId, index: number) => void
  onPinTab: (tabId: WorkbenchTabId) => void
  onPopOutTab?: (source: WorkbenchPanelTarget, tabId: WorkbenchTabId) => void
  onSetFileMarkdownViewMode: (tabId: WorkbenchTabId, mode: MarkdownFileViewMode) => void
  onResizeRawSize?: (rawSize: number | null) => void
  onResizePreview?: (nextSize: number | null) => void
  shouldCommitResizeSize?: (rawSize: number) => boolean
  onToggleReviewView: () => void
  sideChat: Omit<WorkbenchTabRenderContext['sideChat'], 'activeTabId'>
  onCreateSideChat: () => void
  onCreateTerminal?: () => void
  activeSideTaskId: string | null
  subagentAvailability: WorkbenchTabAvailability
  sideTaskContent?: React.ReactNode
}

type FilePreviewTab = Extract<WorkbenchTabDescriptor, { kind: 'file-preview' }>

/** 右工作区方向键步长；Home/End 与双击继续接现有默认/边界动作。 */
export const RIGHT_DOCK_KEYBOARD_STEP = 10

export type WorkbenchFileLoadErrorEvent = {
  error: Error
  phase: FileDocumentLoadErrorPhase
  tab: FilePreviewTab
  target: WorkbenchPanelTarget
}

function useStableEvent<TArgs extends unknown[], TResult>(
  handler: (...args: TArgs) => TResult,
): (...args: TArgs) => TResult {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  return useCallback((...args: TArgs) => handlerRef.current(...args), [])
}

function WorkbenchPanelResizeController({
  target,
  maxWidth,
  minWidth,
  maxHeight,
  minHeight,
  width,
  height,
  onClose,
  onResetWidth,
  onResetHeight,
  onSetWidth,
  onSetHeight,
  onResizeRawSize,
  onResizePreview,
  shouldCommitResizeSize,
}: Pick<
  Props,
  | 'target'
  | 'maxWidth'
  | 'minWidth'
  | 'maxHeight'
  | 'minHeight'
  | 'width'
  | 'height'
  | 'onClose'
  | 'onResetWidth'
  | 'onResetHeight'
  | 'onSetWidth'
  | 'onSetHeight'
  | 'onResizeRawSize'
  | 'onResizePreview'
  | 'shouldCommitResizeSize'
>): React.ReactNode {
  const handleRef = useRef<HTMLDivElement>(null)
  const isBottom = target === 'bottom'
  const size = isBottom ? (height ?? minHeight ?? 160) : width
  const minSize = isBottom ? (minHeight ?? 160) : minWidth
  const maxSize = isBottom ? (maxHeight ?? minHeight ?? 160) : maxWidth
  const liveResize = useWorkbenchPanelLiveResize(target)

  const updateResizePhase = useCallback(
    (phase: ResizePhase): void => {
      const handle = handleRef.current
      if (phase === 'idle') {
        if (handle) delete handle.dataset.resizePhase
      } else if (handle) {
        handle.dataset.resizePhase = phase
      }
      liveResize?.setPhase(phase)
    },
    [liveResize],
  )

  const previewSize = liveResize?.previewSize
  const resolvedPreview = isBottom ? previewSize : (onResizePreview ?? previewSize)

  const {
    handleLostPointerCapture,
    handlePointerCancel,
    handlePointerMove,
    handlePointerUp,
    handleResizeKey,
    startResize,
  } = useSidebarResizeCollapseConfirm({
    collapsed: false,
    // 越界拖拽必须持续到 pointer up/cancel：阈值不再销毁 divider，内容显隐
    // 由原始的指针尺寸在布局层判定，允许同一次拖动拉回。
    collapseEnabled: false,
    direction: isBottom ? 'bottom' : 'right',
    keyboardStep: isBottom ? undefined : RIGHT_DOCK_KEYBOARD_STEP,
    maxWidth: maxSize,
    minWidth: minSize,
    onCollapse: onClose,
    onResetSize: isBottom ? onResetHeight : onResetWidth,
    onResizePhaseChange: updateResizePhase,
    onResizePreview: resolvedPreview,
    onResizeRawSize: isBottom ? undefined : onResizeRawSize,
    shouldCommitResizeSize: isBottom ? undefined : shouldCommitResizeSize,
    onSetWidth: isBottom ? (onSetHeight ?? onSetWidth) : onSetWidth,
    width: size,
  })

  return (
    <div
      ref={handleRef}
      aria-label={isBottom ? '调整底部面板高度' : '调整右侧面板宽度'}
      aria-orientation={isBottom ? 'horizontal' : 'vertical'}
      aria-valuemax={maxSize}
      aria-valuemin={minSize}
      aria-valuenow={size}
      className={
        isBottom
          ? 'bottom-panel-resize-handle tw:absolute tw:z-local tw:-top-1.25 tw:right-0 tw:left-0 tw:h-3 tw:cursor-row-resize tw:touch-none tw:select-none'
          : 'right-dock-resize-handle tw:absolute tw:z-local tw:top-0 tw:bottom-0 tw:left-0 tw:w-4 tw:cursor-col-resize tw:touch-none tw:select-none tw:focus-visible:outline-app-accent/72'
      }
      role="separator"
      tabIndex={0}
      title={isBottom ? '拖拽调整高度，双击恢复默认高度' : '拖拽调整宽度，双击恢复默认宽度'}
      onDoubleClick={isBottom ? onResetHeight : onResetWidth}
      onKeyDown={handleResizeKey}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerCancel={handlePointerCancel}
      onPointerDown={startResize}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  )
}

export function WorkbenchPanel({
  target,
  state,
  tabsById,
  browserAvailability,
  browserState,
  defaultBranch,
  files,
  gitStatus,
  isRefreshingReview,
  diffMarkerStyle,
  maxWidth,
  minWidth,
  maxHeight,
  minHeight,
  reviewView,
  reviewTabState,
  onReviewSummaryChange,
  onOpenReviewFile,
  selectedFile,
  sessionId,
  sessionStatus,
  terminalAvailable,
  planContentByEventId,
  width,
  height,
  workspace,
  browserDraftKey,
  onBrowserStateChange,
  onClose,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onCreateBranch,
  onFileLoadError,
  onOpenTab,
  onOpenWorkspacePath,
  onOpenFileFromBrowser,
  onPreviewFile,
  onAppendComposerText,
  onAskInSideChat,
  onSetFileViewState,
  onAddComposerFiles,
  onRefreshReview,
  onReviewTabStateChange,
  onResetWidth,
  onResetHeight,
  onSelectTab,
  onSetWidth,
  onSetHeight,
  onMoveTab,
  onPopOutTab,
  onReorderTab,
  onPinTab,
  onSetFileMarkdownViewMode,
  onResizeRawSize,
  onResizePreview,
  shouldCommitResizeSize,
  onToggleReviewView,
  sideChat,
  onCreateSideChat,
  onCreateTerminal,
  activeSideTaskId,
  subagentAvailability,
  sideTaskContent,
}: Props): React.ReactNode {
  const panelRef = useRef<HTMLElement>(null)
  const liveResize = useWorkbenchPanelLiveResize(target)
  const contentRef = useRef<HTMLDivElement>(null)
  const [terminalDisplayPathState, setTerminalDisplayPathState] = useState<{
    sessionId: string | null
    displayPath: string | null
  }>({ sessionId, displayPath: null })
  const terminalDisplayPath =
    terminalDisplayPathState.sessionId === sessionId ? terminalDisplayPathState.displayPath : null
  const handleTerminalDisplayPathChange = useCallback(
    (displayPath: string | null) => {
      setTerminalDisplayPathState({ sessionId, displayPath })
    },
    [sessionId],
  )
  useEffect(() => {
    setTerminalDisplayPathState((current) =>
      current.sessionId === sessionId ? current : { sessionId, displayPath: null },
    )
  }, [sessionId])
  const stableOnBrowserStateChange = useStableEvent(onBrowserStateChange)
  const stableOnClose = useStableEvent(onClose)
  const stableOnCreateBranch = useStableEvent(onCreateBranch)
  const stableOnFileLoadError = useStableEvent(onFileLoadError)
  const stableOnOpenWorkspacePath = useStableEvent(onOpenWorkspacePath)
  const stableOnOpenFileFromBrowser = useStableEvent(onOpenFileFromBrowser)
  const stableOnPreviewFile = useStableEvent(onPreviewFile)
  const stableOnAskInSideChat = useStableEvent((text: string) => onAskInSideChat?.(text))
  const stableOnSetFileViewState = useStableEvent(
    (tabId: WorkbenchTabId, state: FileEditorViewState) => onSetFileViewState?.(tabId, state),
  )
  const stableOnAppendComposerText = useStableEvent(onAppendComposerText)
  const stableOnAddComposerFiles = useStableEvent(onAddComposerFiles)
  const stableOnRefreshReview = useStableEvent(onRefreshReview)
  const stableOnReviewTabStateChange = useStableEvent(onReviewTabStateChange)
  const stableOnOpenTab = useStableEvent(onOpenTab)
  const stableOnPinTab = useStableEvent(onPinTab)
  const stableOnSetFileMarkdownViewMode = useStableEvent(onSetFileMarkdownViewMode)
  const stableOnToggleReviewView = useStableEvent(onToggleReviewView)

  const panelContext = useMemo<WorkbenchTabRenderContext>(
    () => ({
      review: {
        activeSessionId: sessionId,
        defaultBranch,
        gitStatus,
        isRefreshing: isRefreshingReview,
        projectId: workspace?.projectId ?? null,
        diffMarkerStyle,
        reviewView,
        reviewTabState,
        onReviewSummaryChange,
        onOpenReviewFile,
        sessionStatus,
        workspacePath: workspace?.path ?? null,
        onAppendComposerText: stableOnAppendComposerText,
        onClose: stableOnClose,
        onCreateBranch: stableOnCreateBranch,
        onOpenWorkspacePath: stableOnOpenWorkspacePath,
        onRefreshDiff: stableOnRefreshReview,
        onReviewTabStateChange: stableOnReviewTabStateChange,
        onToggleReviewView: stableOnToggleReviewView,
      },
      browser: {
        availability: browserAvailability,
        state: browserState,
        draftKey: browserDraftKey,
        onAppendComposerText: stableOnAppendComposerText,
        onStateChange: stableOnBrowserStateChange,
      },
      files: {
        files,
        selectedFile,
        workspace,
        onOpenFileFromBrowser: stableOnOpenFileFromBrowser,
        onPreviewFile: stableOnPreviewFile,
        onAskInSideChat: onAskInSideChat ? stableOnAskInSideChat : undefined,
        onSetFileViewState: stableOnSetFileViewState,
        onAppendComposerText: stableOnAppendComposerText,
        onAddComposerFiles: stableOnAddComposerFiles,
        onPinFileTab: stableOnPinTab,
        onSetFileMarkdownViewMode: stableOnSetFileMarkdownViewMode,
        onLoadError: (tab, error, phase) => stableOnFileLoadError({ error, phase, tab, target }),
      },
      planContentByEventId,
      sideChat: {
        ...sideChat,
        activeTabId: state.activeTabId,
      },
      sideTask: {
        activeTaskId: activeSideTaskId,
        availability: subagentAvailability,
        content: sideTaskContent,
      },
      terminal: {
        availability: terminalAvailable
          ? { status: 'available' }
          : sessionId
            ? {
                status: 'unavailable',
                reason: '当前桌面运行环境没有提供集成终端桥接。',
              }
            : { status: 'available' },
        threadId: sessionId,
        cwd: workspace?.path ?? null,
        onDisplayPathChange: handleTerminalDisplayPathChange,
      },
    }),
    [
      browserState,
      browserAvailability,
      defaultBranch,
      diffMarkerStyle,
      files,
      gitStatus,
      handleTerminalDisplayPathChange,
      isRefreshingReview,
      planContentByEventId,
      reviewView,
      reviewTabState,
      onReviewSummaryChange,
      onOpenReviewFile,
      selectedFile,
      sessionId,
      sessionStatus,
      terminalAvailable,
      sideChat,
      onAskInSideChat,
      stableOnAskInSideChat,
      stableOnSetFileViewState,
      activeSideTaskId,
      sideTaskContent,
      subagentAvailability,
      stableOnAddComposerFiles,
      browserDraftKey,
      stableOnAppendComposerText,
      stableOnBrowserStateChange,
      stableOnClose,
      stableOnCreateBranch,
      stableOnFileLoadError,
      stableOnOpenFileFromBrowser,
      stableOnOpenWorkspacePath,
      stableOnPinTab,
      stableOnPreviewFile,
      stableOnRefreshReview,
      stableOnReviewTabStateChange,
      stableOnSetFileMarkdownViewMode,
      stableOnToggleReviewView,
      target,
      workspace,
    ],
  )

  return (
    <WorkbenchDockFrame
      ref={panelRef}
      open={state.open}
      target={target}
      targetWidth={
        target === 'right' && liveResize && liveResize.phase !== 'idle'
          ? liveResize.liveSize
          : width
      }
      visibleWidth={target === 'right' && liveResize ? liveResize.liveSize : width}
    >
      <WorkbenchPanelResizeController
        target={target}
        maxWidth={maxWidth}
        minWidth={minWidth}
        maxHeight={maxHeight}
        minHeight={minHeight}
        width={width}
        height={height}
        onClose={stableOnClose}
        onResetWidth={onResetWidth}
        onResetHeight={onResetHeight}
        onSetWidth={onSetWidth}
        onSetHeight={onSetHeight}
        onResizePreview={onResizePreview}
        onResizeRawSize={onResizeRawSize}
        shouldCommitResizeSize={shouldCommitResizeSize}
      />
      <WorkbenchPanelSurface
        target={target}
        header={
          <TabStripButtonProvider>
            <WorkbenchTabStrip
              state={state}
              tabsById={tabsById}
              target={target}
              terminalDisplayPath={terminalDisplayPath}
              onClosePanel={target === 'bottom' ? stableOnClose : undefined}
              onCloseOtherTabs={onCloseOtherTabs}
              onCloseTab={onCloseTab}
              onCloseTabsToRight={onCloseTabsToRight}
              onMoveTab={onMoveTab}
              onPopOutTab={onPopOutTab}
              onOpenTab={stableOnOpenTab}
              onCreateSideChat={onCreateSideChat}
              onCreateTerminal={onCreateTerminal}
              sideChatAvailable={sideChat.available}
              onPinTab={onPinTab}
              onReorderTab={onReorderTab}
              onSelectTab={onSelectTab}
            />
          </TabStripButtonProvider>
        }
      >
        <MemoizedWorkbenchPanelContent
          contentRef={contentRef}
          panelContext={panelContext}
          state={state}
          tabsById={tabsById}
          target={target}
          onCreateSideChat={onCreateSideChat}
          onOpenTab={stableOnOpenTab}
          sideChatAvailable={sideChat.available}
        />
      </WorkbenchPanelSurface>
    </WorkbenchDockFrame>
  )
}

const MemoizedWorkbenchPanelContent = memo(function WorkbenchPanelContent({
  contentRef,
  panelContext,
  state,
  tabsById,
  target,
  onCreateSideChat,
  onOpenTab,
  sideChatAvailable,
}: {
  contentRef: React.RefObject<HTMLDivElement | null>
  panelContext: WorkbenchTabRenderContext
  state: WorkbenchPanelSnapshot
  tabsById: WorkbenchTabsState['tabsById']
  target: WorkbenchPanelTarget
  onCreateSideChat: () => void
  onOpenTab: (tab: WorkbenchTabDescriptor) => void
  sideChatAvailable: boolean
}): React.ReactNode {
  return (
    <WorkbenchPanelContentSurface ref={contentRef} target={target}>
      {state.tabIds.length > 0 ? (
        state.tabIds.map((tabId) => {
          const tab = tabsById[tabId]
          if (!tab) return null
          const active = state.activeTabId === tab.id
          const definition = getWorkbenchTabDefinition(tab)
          const shouldMount = active || definition.lifecycle === 'keep-alive-hidden'
          return (
            <div
              key={tab.id}
              aria-labelledby={`workbench-tab-${target}-${workbenchTabDomId(tab.id)}`}
              className="workbench-tab-panel"
              hidden={!active}
              id={`workbench-panel-${target}-${workbenchTabDomId(tab.id)}`}
              role="tabpanel"
              tabIndex={active ? 0 : -1}
            >
              {shouldMount ? (
                <WorkbenchTabErrorBoundary tabId={tab.id}>
                  {definition.render(tab, panelContext)}
                </WorkbenchTabErrorBoundary>
              ) : null}
            </div>
          )
        })
      ) : target === 'bottom' ? (
        <div className="bottom-panel-empty tw:flex tw:h-full tw:w-full tw:items-center tw:justify-center tw:p-4 tw:type-caption tw:text-app-text-meta">
          <span>暂无打开的终端</span>
        </div>
      ) : (
        <WorkbenchLauncher
          onCreateSideChat={onCreateSideChat}
          onOpenTab={onOpenTab}
          panelContext={panelContext}
          sideChatAvailable={sideChatAvailable}
        />
      )}
    </WorkbenchPanelContentSurface>
  )
})

export { WorkbenchTabStrip as WorkbenchTabsHeader }

function WorkbenchLauncher({
  onCreateSideChat,
  onOpenTab,
  panelContext,
  sideChatAvailable,
}: {
  onCreateSideChat: () => void
  onOpenTab: (tab: WorkbenchTabDescriptor) => void
  panelContext: WorkbenchTabRenderContext
  sideChatAvailable: boolean
}): React.ReactNode {
  const launchers = getWorkbenchLauncherDefinitions().filter(
    (definition) => definition.kind !== 'side-chat' || sideChatAvailable,
  )

  const actions = launchers.flatMap<
    Parameters<typeof WorkbenchPanelLauncher>[0]['actions'][number]
  >((definition) => {
    const presentation = getWorkbenchLauncherPresentation(definition)
    const availability = definition.getAvailability?.(panelContext) ?? {
      status: 'available' as const,
    }
    if (definition.kind === 'side-chat') {
      return [
        {
          disabled: availability.status !== 'available',
          id: definition.kind,
          icon: presentation.icon,
          label: presentation.label,
          reason: availability.reason,
          shortcut: presentation.shortcut,
          onSelect: onCreateSideChat,
        },
      ]
    }
    const tab = createLauncherTab(definition.kind)
    if (!tab) return []
    return [
      {
        disabled: availability.status !== 'available',
        id: definition.kind,
        icon: presentation.icon,
        label: presentation.label,
        reason: availability.reason,
        shortcut: presentation.shortcut,
        onSelect: () => onOpenTab(tab),
      },
    ]
  })

  return <WorkbenchPanelLauncher actions={actions} />
}
