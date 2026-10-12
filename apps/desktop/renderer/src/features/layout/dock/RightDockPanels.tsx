import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FileEditorViewState } from '../../editor/FileEditor.js'
import type React from 'react'
import { Check, Copy, Download, Folder, FolderOpen, ListChecks } from 'lucide-react'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import {
  AnimatePresence,
  motion,
  useMotionTemplate,
  useMotionValue,
  usePresence,
  useTransform,
  type MotionValue,
} from 'motion/react'
import type { DesktopFileEntry, DesktopWorkspace } from '../../../../shared/Types.js'
import { AppContextMenu } from '../../../components/ui/AppContextMenu.js'
import { Button } from '../../../components/ui/Button.js'
import { ScrollArea } from '../../../components/ui/ScrollArea.js'
import { MarkdownMessage } from '../../markdown/index.js'
import { usePlanDocumentActions } from '../../session/workflow/PlanDocumentActions.js'
import {
  StructuredPlanView,
  type OpenPlanInDockRequest,
} from '../../session/workflow/WorkflowPlanCard.js'
import { useCanonicalThreadConversation } from '../../session/timeline/UseCanonicalThreadConversation.js'
import { selectCanonicalLatestPlanItemId } from '../../session/conversation/CanonicalConversationSelectors.js'
import { resolveLanguageFromPath } from '../../syntax/index.js'
import { cx } from '../../../utils/Cx.js'
import {
  prefetchFileDocument,
  fileDocumentLoadErrorMessage,
  resolveFileDocumentConflict,
  saveFileDocument,
  startFileDocumentExternalChecks,
  updateFileDocument,
  useFileDocument,
} from '../../workspace/FileDocumentStore.js'
import { WorkbenchPanelError, WorkbenchPanelLoading } from '../panels/WorkbenchPanelStates.js'
import { FileBreadcrumbToolbar } from '../panels/FileBreadcrumbToolbar.js'
import type { MarkdownFileViewMode, SkillPreviewTab } from './RightDockState.js'
import {
  getSendableFilePath,
  WorkspaceFileTree,
  type WorkspaceFileOpenOptions,
} from '../WorkspaceFileTree.js'
import { createWorkspaceFileTabId } from '../tabs/WorkspaceFileTabId.js'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import {
  exitTween,
  instantTween,
  layoutTween,
  motionTransition,
} from '../../motion/MotionTransitions.js'
import { readRuntimeSkill } from '../../settings/plugins/SkillClientAdapter.js'
import { desktopClipboard } from '../../../services/desktop-client/index.js'

const ConflictMergeEditor = lazy(() =>
  import('../../editor/ConflictMergeEditor.js').then((module) => ({
    default: module.ConflictMergeEditor,
  })),
)
const FileEditor = lazy(() =>
  import('../../editor/FileEditor.js').then((module) => ({ default: module.FileEditor })),
)

const FILE_TREE_DEFAULT_WIDTH = 280
const FILE_TREE_MIN_WIDTH = 200
const FILE_TREE_FALLBACK_MAX_WIDTH = 480
const FILE_TREE_MAX_WIDTH_RATIO = 0.6

export type FileDocumentLoadErrorPhase = 'initial' | 'external-sync'

type FilesPanelProps = {
  files: DesktopFileEntry[]
  activePath?: string | null
  workspace: DesktopWorkspace | null
  revealToken?: number
  onOpenFile: (file: DesktopFileEntry, options: WorkspaceFileOpenOptions) => void
  onAddComposerFiles?: (filePaths: string[]) => void
}

type PlanPanelProps = {
  /** 计划项身份：与所属聊天一起绑定 canonical projection。 */
  planItemId: string
  threadId: string
  /** canonical 投影不可用时的回退：历史标签只保存了打开瞬间的正文。 */
  fallbackContent: string | null
  onOpenPlan?: (request: OpenPlanInDockRequest) => void
}

function planTitleOf(item: { structured?: { title: string }; markdown: string }): string | null {
  if (item.structured?.title) return item.structured.title
  const heading = item.markdown.match(/^\s*#\s+(.+)$/m)?.[1]?.trim()
  return heading || null
}

export function RightDockSkillPreviewPanel({ tab }: { tab: SkillPreviewTab }): React.ReactNode {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryVersion, setRetryVersion] = useState(0)

  useEffect(() => {
    if (tab.skill.path.startsWith('builtin://')) {
      setContent(null)
      setError('内置技能仅可在技能详情中查看。')
      return
    }
    let cancelled = false
    setContent(null)
    setError(null)
    void readRuntimeSkill(tab.skill.workspacePath, tab.skill.path)
      .then((result) => {
        if (!cancelled) setContent(result.content)
      })
      .catch((cause) => {
        if (cancelled) return
        setError(cause instanceof Error && cause.message ? cause.message : '技能内容读取失败。')
      })
    return () => {
      cancelled = true
    }
  }, [retryVersion, tab.skill.path, tab.skill.workspacePath])

  if (error) {
    return (
      <WorkbenchPanelError
        title="无法打开技能"
        message={error}
        retryable={!tab.skill.path.startsWith('builtin://')}
        onRetry={() => setRetryVersion((version) => version + 1)}
      />
    )
  }
  if (content === null) {
    return <WorkbenchPanelLoading label="正在加载技能内容…" />
  }
  return (
    <ScrollArea
      aria-label={`${tab.skill.name} 技能内容`}
      className="right-dock-plan-scroll-area tw:min-h-0 tw:min-w-0 tw:flex-1 tw:bg-app-dock"
      contentClassName="right-dock-plan-scroll-content tw:min-w-0 tw:p-4"
    >
      <article className="right-dock-plan-document tw:mx-auto tw:w-full tw:max-w-[48rem] tw:text-app-text">
        <pre className="right-dock-skill-content tw:m-0 tw:whitespace-pre-wrap tw:break-words tw:type-code">
          {content}
        </pre>
      </article>
    </ScrollArea>
  )
}

export function RightDockPlanPanel({
  planItemId,
  threadId,
  fallbackContent,
  onOpenPlan,
}: PlanPanelProps): React.ReactNode {
  const conversation = useCanonicalThreadConversation(threadId || null)
  const state = conversation.state
  const item = state?.itemsById.get(planItemId)
  const structured = item?.type === 'plan' ? item.structured : undefined
  const canonicalMarkdown =
    item?.type === 'plan' && item.markdown.trim() ? item.markdown : null
  const content = canonicalMarkdown ?? fallbackContent
  const latestItemId = selectCanonicalLatestPlanItemId(state)
  const latestItem = latestItemId ? state?.itemsById.get(latestItemId) : undefined
  const hasNewer = Boolean(latestItemId && latestItemId !== planItemId)
  const pendingReview = state?.pendingPlanApproval?.planItemId === planItemId
  const title = (item?.type === 'plan' ? planTitleOf(item) : null) ?? null
  const actions = usePlanDocumentActions(content ?? '')

  const openLatest = (): void => {
    if (!onOpenPlan || !latestItemId || latestItem?.type !== 'plan') return
    onOpenPlan({
      planItemId: latestItemId,
      threadId,
      title: planTitleOf(latestItem) ?? '计划',
      content: latestItem.markdown,
      openable: true,
    })
  }

  if (!content) {
    return (
      <ScrollArea
        aria-label="计划"
        className="right-dock-plan-scroll-area tw:min-h-0 tw:flex-1"
        contentClassName="right-dock-plan-scroll-content tw:min-w-0 tw:p-4"
      >
        <div className="right-dock-empty-state tw:grid tw:h-full tw:w-full tw:place-content-center tw:justify-items-center tw:gap-2 tw:p-6 tw:text-center tw:text-app-text-soft">
          <ListChecks size={APP_ICON_SIZES.lg} strokeWidth={APP_ICON_STROKE_WIDTH} />
          <strong className="tw:text-app-text">暂无计划</strong>
          <span className="tw:max-w-full tw:text-app-text-soft">
            从主对话里的计划卡片打开计划书
          </span>
        </div>
      </ScrollArea>
    )
  }

  return (
    <ScrollArea
      aria-label="计划"
      className="right-dock-plan-scroll-area tw:min-h-0 tw:min-w-0 tw:flex-1 tw:bg-app-dock"
      contentClassName="right-dock-plan-scroll-content tw:min-w-0 tw:p-4"
    >
      <article className="right-dock-plan-document tw:mx-auto tw:w-full tw:max-w-[48rem] tw:text-app-text">
        <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:pb-3">
          <span className="tw:text-app-text-meta tw:type-label">
            {hasNewer ? '历史计划' : pendingReview ? '计划 · 待审阅' : '计划'}
          </span>
          <div className="tw:flex tw:items-center tw:gap-2">
            {hasNewer && onOpenPlan && latestItemId ? (
              <Button color="secondary" onClick={openLatest}>
                有新版计划
              </Button>
            ) : null}
            <Button onClick={actions.copy}>{actions.copied ? <Check /> : <Copy />}复制计划</Button>
            <Button onClick={actions.exportMarkdown}>
              <Download />
              导出 PLAN.md
            </Button>
          </div>
        </div>
        {actions.error ? <p role="alert">{actions.error}</p> : null}
        {title ? (
          <h2 className="right-dock-plan-title tw:m-0 tw:pb-2 tw:text-app-text tw:type-body-lg">
            {title}
          </h2>
        ) : null}
        {structured ? <StructuredPlanView plan={structured} /> : <MarkdownMessage text={content} />}
      </article>
    </ScrollArea>
  )
}

export function RightDockFilesPanel({
  files,
  activePath,
  workspace,
  revealToken,
  onOpenFile,
  onAddComposerFiles,
}: FilesPanelProps): React.ReactNode {
  const workspacePath = workspace?.path ?? ''
  const initialTreeState = useRef(readFileTreeViewState(workspacePath, true))
  const [treeVisible, setTreeVisible] = useState(initialTreeState.current.visible)
  const [treeWidth, setTreeWidth] = useState(initialTreeState.current.width)
  const [copied, setCopied] = useState(false)
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const treeToggleRef = useRef<HTMLButtonElement | null>(null)
  const treeResize = useEditorFileTreeResize({
    committedWidth: treeWidth,
    layoutRef,
    onCommitWidth: setTreeWidth,
  })

  useEffect(() => {
    writeFileTreeViewState(workspacePath, {
      visible: treeVisible,
      width: treeWidth,
    })
  }, [treeVisible, treeWidth, workspacePath])

  function handleCopyWorkspacePath(): void {
    if (!workspacePath) return
    void desktopClipboard.writeText(workspacePath).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  const rootDisplayName = workspacePath ? workspacePath.replace(/\\/g, '/').replace(/\/$/, '') : '/'

  return (
    <section
      aria-label="打开文件"
      className="right-dock-file-browser tw:flex tw:h-full tw:w-full tw:min-h-0 tw:min-w-0 tw:grow tw:shrink tw:basis-auto tw:flex-col tw:overflow-hidden tw:bg-app-dock tw:@container"
    >
      <article
        className={cx(
          'right-dock-file-document',
          'tw:flex tw:h-full tw:w-full tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col',
        )}
      >
        <header className="file-breadcrumb-toolbar file-breadcrumb-toolbar--empty">
          <div
            aria-label={`文件路径：${rootDisplayName}`}
            className="file-breadcrumb-toolbar__path"
          >
            <strong className="file-breadcrumb-toolbar__root" title={workspacePath}>
              {rootDisplayName}
            </strong>
          </div>
          <div className="file-breadcrumb-toolbar__actions">
            {workspacePath ? (
              <Button
                isIconOnly
                className="file-breadcrumb-toolbar__action"
                color="ghostSecondary"
                size="toolbar"
                title={copied ? '已复制路径' : '复制工作区路径'}
                type="button"
                onClick={handleCopyWorkspacePath}
              >
                {copied ? (
                  <Check
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                ) : (
                  <Copy
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                )}
              </Button>
            ) : null}
            <Button
              isIconOnly
              ref={treeToggleRef}
              aria-pressed={treeVisible}
              className="file-breadcrumb-toolbar__action"
              color="ghostSecondary"
              size="toolbar"
              title={treeVisible ? '隐藏文件树' : '显示文件树'}
              type="button"
              onClick={() => setTreeVisible((current) => !current)}
            >
              <FolderOpen
                aria-hidden="true"
                size={APP_ICON_SIZE}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </Button>
          </div>
        </header>
        <motion.div
          ref={layoutRef}
          className={cx(
            'right-dock-file-editor-layout',
            'tw:flex tw:h-full tw:w-full tw:min-h-0 tw:min-w-0 tw:flex-1 tw:overflow-hidden',
            treeVisible && 'has-file-tree',
          )}
          style={treeResize.layoutStyle}
        >
          <div className="right-dock-file-selection-target right-dock-open-file-placeholder tw:flex tw:h-full tw:min-h-0 tw:min-w-0 tw:grow tw:shrink tw:basis-auto tw:flex-col tw:items-center tw:justify-center tw:[&>*]:grow tw:[&>*]:shrink tw:[&>*]:basis-auto tw:[&>*]:min-h-0">
            <div className="right-dock-empty-state">
              <svg
                aria-hidden="true"
                className="right-dock-open-file-illustration"
                fill="none"
                height={APP_ICON_SIZE}
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.6"
                viewBox="0 0 24 24"
                width={APP_ICON_SIZE}
              >
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                <path d="M9 13h6" />
                <path d="M12 10v6" />
              </svg>
              <strong>打开文件</strong>
              <span>从工作区目录树中选择文件</span>
            </div>
          </div>
          <EditorFileTreePresence
            focusReturnRef={treeToggleRef}
            liveWidth={treeResize.liveWidth}
            visible={treeVisible}
            width={treeWidth}
          >
            <div
              aria-label="调整文件树宽度"
              aria-orientation="vertical"
              aria-valuemax={treeResize.maximumWidth}
              aria-valuemin={FILE_TREE_MIN_WIDTH}
              aria-valuenow={treeWidth}
              className="right-dock-editor-tree-resize-handle tw:relative tw:z-local tw:w-2 tw:min-w-2 tw:grow-0 tw:shrink-0 tw:basis-2 tw:cursor-col-resize tw:touch-none tw:focus-visible:outline-none"
              role="separator"
              tabIndex={0}
              title="拖拽调整文件树宽度，双击恢复默认宽度"
              onDoubleClick={treeResize.resetWidth}
              onKeyDown={treeResize.handleKeyDown}
              onPointerDown={treeResize.startResize}
            />
            <aside
              aria-label="工作区文件树"
              className="right-dock-editor-file-tree tw:grow tw:shrink tw:basis-auto tw:h-full tw:min-h-0 tw:min-w-0 tw:overflow-hidden tw:border-l tw:border-app-border-subtle tw:bg-app-underlay"
            >
              <WorkspaceFileTree
                key={workspacePath}
                activePath={activePath}
                autoFocusSearch
                files={files}
                revealToken={revealToken}
                workspace={workspace}
                onAddComposerFiles={onAddComposerFiles}
                onEscape={() => setTreeVisible(false)}
                onOpenFile={onOpenFile}
              />
            </aside>
          </EditorFileTreePresence>
        </motion.div>
      </article>
    </section>
  )
}

export function RightDockFilePreviewPanel({
  workspacePath,
  projectId,
  folderId,
  expectedPath,
  revealLine,
  previewTab,
  markdownViewMode,
  viewState,
  onViewStateChange,
  onAskInSideChat,
  files,
  workspace,
  onPinTab,
  onSetMarkdownViewMode,
  onAppendComposerText,
  onAddComposerFiles,
  onOpenFile,
  onLoadError,
}: {
  workspacePath: string
  projectId?: string
  folderId?: string
  expectedPath: string
  revealLine?: number
  previewTab: boolean
  markdownViewMode?: MarkdownFileViewMode
  viewState?: FileEditorViewState
  onViewStateChange?: (state: FileEditorViewState) => void
  onAskInSideChat?: (text: string) => void
  files: DesktopFileEntry[]
  workspace: DesktopWorkspace | null
  onPinTab: () => void
  onSetMarkdownViewMode: (mode: MarkdownFileViewMode) => void
  onAppendComposerText?: (text: string) => void
  onAddComposerFiles?: (filePaths: string[]) => void
  onOpenFile: (file: DesktopFileEntry, options: WorkspaceFileOpenOptions) => void
  onLoadError?: (error: Error, phase: FileDocumentLoadErrorPhase) => void
}): React.ReactNode {
  const [selectedText, setSelectedText] = useState('')
  const initialTreeState = useRef(readFileTreeViewState(workspacePath))
  const [treeVisible, setTreeVisible] = useState(initialTreeState.current.visible)
  const [treeWidth, setTreeWidth] = useState(initialTreeState.current.width)
  const [switchingMarkdownMode, setSwitchingMarkdownMode] = useState(false)
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const treeToggleRef = useRef<HTMLButtonElement | null>(null)
  const treeResize = useEditorFileTreeResize({
    committedWidth: treeWidth,
    layoutRef,
    onCommitWidth: setTreeWidth,
  })
  const initialLoadKeyRef = useRef<string | null>(null)
  const onLoadErrorRef = useRef(onLoadError)
  const documentScope = { projectId, folderId }
  const document = useFileDocument(workspacePath, expectedPath, documentScope)
  const language = resolveLanguageFromPath(expectedPath)
  const isMarkdown = isMarkdownFilePath(expectedPath)
  const resolvedMarkdownViewMode = isMarkdown ? (markdownViewMode ?? 'rich') : undefined

  useEffect(() => {
    onLoadErrorRef.current = onLoadError
  }, [onLoadError])

  useEffect(() => {
    const loadKey = `${projectId ?? ''}\u0000${folderId ?? ''}\u0000${workspacePath}\u0000${expectedPath}`
    if (initialLoadKeyRef.current === loadKey) return
    initialLoadKeyRef.current = loadKey
    void prefetchFileDocument(workspacePath, expectedPath, documentScope).catch((error) => {
      if (initialLoadKeyRef.current !== loadKey) return
      onLoadErrorRef.current?.(error instanceof Error ? error : new Error(String(error)), 'initial')
    })
  }, [expectedPath, folderId, projectId, workspacePath])

  useEffect(() => {
    if (document.status !== 'ready') return
    return startFileDocumentExternalChecks(
      workspacePath,
      expectedPath,
      {
        onLoadError: (error) => onLoadErrorRef.current?.(error, 'external-sync'),
      },
      documentScope,
    )
  }, [document.status, expectedPath, folderId, projectId, workspacePath])

  useEffect(() => {
    writeFileTreeViewState(workspacePath, {
      visible: treeVisible,
      width: treeWidth,
    })
  }, [treeVisible, treeWidth, workspacePath])

  function sendSelectedTextToComposer(): void {
    if (!shouldShowSelectionSendAction(selectedText)) return
    onAppendComposerText?.(
      buildFileSelectionPrompt({
        path: expectedPath,
        selectedText,
      }),
    )
    setSelectedText('')
  }

  async function toggleMarkdownViewMode(targetMode: MarkdownFileViewMode): Promise<void> {
    if (
      !resolvedMarkdownViewMode ||
      targetMode === resolvedMarkdownViewMode ||
      switchingMarkdownMode ||
      document.conflict
    ) {
      return
    }
    setSwitchingMarkdownMode(true)
    try {
      if (document.dirty && !(await saveFileDocument(workspacePath, expectedPath, documentScope))) {
        return
      }
      onSetMarkdownViewMode(targetMode)
    } finally {
      setSwitchingMarkdownMode(false)
    }
  }

  if (document.status === 'error') {
    const presentation = fileDocumentLoadErrorMessage(document.loadErrorCode, document.loadError)
    return (
      <WorkbenchPanelError
        {...presentation}
        onRetry={() => {
          void prefetchFileDocument(workspacePath, expectedPath, documentScope).catch((error) => {
            onLoadErrorRef.current?.(
              error instanceof Error ? error : new Error(String(error)),
              'initial',
            )
          })
        }}
      />
    )
  }

  if (document.status !== 'ready') {
    return (
      <div className="right-dock-empty-state">
        <Folder size={APP_ICON_SIZES.lg} strokeWidth={APP_ICON_STROKE_WIDTH} />
        <strong>正在读取文件</strong>
        <span>{expectedPath}</span>
      </div>
    )
  }

  return (
    <section className="right-dock-file-preview" aria-label={expectedPath}>
      <article
        className={cx(
          'right-dock-file-document',
          'tw:flex tw:h-full tw:w-full tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col',
        )}
      >
        <FileBreadcrumbToolbar
          treeToggleRef={treeToggleRef}
          path={expectedPath}
          readonly={document.readonly}
          treeAvailable
          treeVisible={treeVisible}
          markdownViewMode={document.conflict ? undefined : resolvedMarkdownViewMode}
          switching={switchingMarkdownMode}
          workspace={workspace}
          workspacePath={workspacePath}
          onToggleTree={() => setTreeVisible((current) => !current)}
          onToggleMarkdownViewMode={(targetMode) => {
            void toggleMarkdownViewMode(targetMode)
          }}
        />
        <motion.div
          ref={layoutRef}
          className={cx(
            'right-dock-file-editor-layout',
            'tw:flex tw:h-full tw:w-full tw:min-h-0 tw:min-w-0 tw:flex-1 tw:overflow-hidden',
            treeVisible && 'has-file-tree',
          )}
          style={treeResize.layoutStyle}
        >
          <AppContextMenu
            actions={
              shouldShowSelectionSendAction(selectedText)
                ? [
                    {
                      kind: 'item',
                      label: '发送到对话框',
                      onSelect: sendSelectedTextToComposer,
                    },
                    ...(onAskInSideChat
                      ? [
                          {
                            kind: 'item' as const,
                            label: '在侧边聊天中询问',
                            onSelect: () => {
                              onAskInSideChat(
                                buildFileSelectionPrompt({ path: expectedPath, selectedText }),
                              )
                              setSelectedText('')
                            },
                          },
                        ]
                      : []),
                  ]
                : []
            }
            layout="flex"
            trigger={
              <div
                className="right-dock-file-selection-target tw:flex tw:min-h-0 tw:grow tw:shrink tw:basis-auto tw:flex-col tw:[&>*]:grow tw:[&>*]:shrink tw:[&>*]:basis-auto tw:[&>*]:min-h-0"
                onContextMenu={() => {
                  if (resolvedMarkdownViewMode === 'rich') {
                    const text = window.getSelection()?.toString()
                    if (text) setSelectedText(text)
                  }
                }}
              >
                <Suspense fallback={<WorkbenchPanelLoading label="正在加载文件编辑器…" />}>
                  {document.conflict ? (
                    <ConflictMergeEditor
                      diskValue={document.conflict.diskContent}
                      error={document.saveError}
                      language={language}
                      localValue={document.draftContent}
                      path={expectedPath}
                      saving={document.saving}
                      onChangeLocal={(value) =>
                        updateFileDocument(workspacePath, expectedPath, value, documentScope)
                      }
                      onKeepLocal={() =>
                        resolveFileDocumentConflict(
                          workspacePath,
                          expectedPath,
                          'local',
                          undefined,
                          documentScope,
                        )
                      }
                      onUseDisk={() =>
                        resolveFileDocumentConflict(
                          workspacePath,
                          expectedPath,
                          'disk',
                          undefined,
                          documentScope,
                        )
                      }
                    />
                  ) : (
                    <FileEditor
                      ariaLabel={`${expectedPath} 文件编辑器`}
                      className="right-dock-file-code tw:m-0 tw:min-h-full tw:rounded-none tw:border-0 tw:shadow-none tw:[&_.md-code-pre]:min-w-0"
                      error={document.saveError}
                      language={language}
                      path={expectedPath}
                      presentation={
                        resolvedMarkdownViewMode === 'rich' ? 'markdown-rich' : 'source'
                      }
                      readonly={document.readonly}
                      revealLine={revealLine}
                      saving={document.saving}
                      value={document.draftContent}
                      viewState={viewState}
                      onViewStateChange={onViewStateChange}
                      onSelectionChange={setSelectedText}
                      onChange={(value) => {
                        if (previewTab) onPinTab()
                        updateFileDocument(workspacePath, expectedPath, value, documentScope)
                      }}
                      onSave={async () => {
                        await saveFileDocument(workspacePath, expectedPath, documentScope)
                      }}
                    />
                  )}
                </Suspense>
              </div>
            }
            size="sm"
          />
          <EditorFileTreePresence
            focusReturnRef={treeToggleRef}
            liveWidth={treeResize.liveWidth}
            visible={treeVisible}
            width={treeWidth}
          >
            <div
              aria-label="调整文件树宽度"
              aria-orientation="vertical"
              aria-valuemax={treeResize.maximumWidth}
              aria-valuemin={FILE_TREE_MIN_WIDTH}
              aria-valuenow={treeWidth}
              className="right-dock-editor-tree-resize-handle tw:relative tw:z-local tw:w-2 tw:min-w-2 tw:grow-0 tw:shrink-0 tw:basis-2 tw:cursor-col-resize tw:touch-none tw:focus-visible:outline-none"
              role="separator"
              tabIndex={0}
              title="拖拽调整文件树宽度，双击恢复默认宽度"
              onDoubleClick={treeResize.resetWidth}
              onKeyDown={treeResize.handleKeyDown}
              onPointerDown={treeResize.startResize}
            />
            <aside
              aria-label="当前文件的工作区文件树"
              className="right-dock-editor-file-tree tw:grow tw:shrink tw:basis-auto tw:h-full tw:min-h-0 tw:min-w-0 tw:overflow-hidden tw:border-l tw:border-app-border-subtle tw:bg-app-underlay"
            >
              <WorkspaceFileTree
                activePath={expectedPath}
                files={files}
                workspace={workspace}
                onAddComposerFiles={onAddComposerFiles}
                onEscape={() => setTreeVisible(false)}
                onOpenFile={onOpenFile}
              />
            </aside>
          </EditorFileTreePresence>
        </motion.div>
      </article>
    </section>
  )
}

function isMarkdownFilePath(path: string): boolean {
  return /\.(?:md|markdown|mdown|mdx|mkd)$/i.test(path)
}

export function buildFileSelectionPrompt({
  path,
  selectedText,
}: {
  path: string
  selectedText: string
}): string {
  const extension = path.split(/[\\/]/).pop()?.split('.').pop()
  const fence = extension && extension !== path ? extension : ''
  return ['文件选区：', `- 文件：${path}`, '', `\`\`\`${fence}`, selectedText.trim(), '```'].join(
    '\n',
  )
}

export function shouldShowSelectionSendAction(selectedText: string): boolean {
  return selectedText.trim().length > 0
}

/**
 * Appends `text` to the end of `prev`, trimming `text` first.
 * Adds a `\n\n` separator if `prev` already contains non-whitespace content.
 * Returns `prev` unchanged if trimmed `text` is empty.
 */
export function buildAppendText(prev: string, text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return prev
  const existing = prev.trim()
  if (!existing) return trimmed
  return `${prev}\n\n${trimmed}`
}

export { getSendableFilePath }
export { createWorkspaceFileTabId }

type FileTreeViewState = {
  visible: boolean
  width: number
}

type ActiveFileTreeResize = {
  finish: (outcome: 'commit' | 'restore') => void
}

function resolveFileTreeMaximumWidth(layout: HTMLDivElement | null): number {
  const layoutWidth = layout?.getBoundingClientRect().width ?? 0
  return Math.round(
    layoutWidth > 0
      ? Math.max(FILE_TREE_MIN_WIDTH, layoutWidth * FILE_TREE_MAX_WIDTH_RATIO)
      : FILE_TREE_FALLBACK_MAX_WIDTH,
  )
}

function clampFileTreeWidth(width: number, layout: HTMLDivElement | null): number {
  return Math.min(
    resolveFileTreeMaximumWidth(layout),
    Math.max(FILE_TREE_MIN_WIDTH, Math.round(width)),
  )
}

function useEditorFileTreeResize({
  committedWidth,
  layoutRef,
  onCommitWidth,
}: {
  committedWidth: number
  layoutRef: React.RefObject<HTMLDivElement | null>
  onCommitWidth: React.Dispatch<React.SetStateAction<number>>
}): {
  handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  layoutStyle: React.CSSProperties
  liveWidth: MotionValue<number>
  maximumWidth: number
  resetWidth: () => void
  startResize: (event: React.PointerEvent<HTMLDivElement>) => void
} {
  const liveWidth = useMotionValue(committedWidth)
  const liveWidthPixels = useMotionTemplate`${liveWidth}px`
  const committedWidthRef = useRef(committedWidth)
  const activeResizeRef = useRef<ActiveFileTreeResize | null>(null)

  useLayoutEffect(() => {
    committedWidthRef.current = committedWidth
    if (!activeResizeRef.current) {
      liveWidth.set(committedWidth)
    }
  }, [committedWidth, liveWidth])

  useEffect(
    () => () => {
      activeResizeRef.current?.finish('restore')
    },
    [],
  )

  function commitWidth(width: number): void {
    const nextWidth = clampFileTreeWidth(width, layoutRef.current)
    committedWidthRef.current = nextWidth
    liveWidth.set(nextWidth)
    onCommitWidth(nextWidth)
  }

  function startResize(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    event.preventDefault()
    activeResizeRef.current?.finish('restore')

    const handle = event.currentTarget
    const pointerId = event.pointerId
    const startX = event.clientX
    const startWidth = committedWidthRef.current
    let pendingWidth = startWidth
    let frameId: number | null = null
    let finished = false

    const flushPreview = (): void => {
      frameId = null
      liveWidth.set(pendingWidth)
    }
    const queuePreview = (width: number): void => {
      pendingWidth = clampFileTreeWidth(width, layoutRef.current)
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(flushPreview)
    }
    const removeListeners = (): void => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', onWindowBlur)
      handle.removeEventListener('lostpointercapture', onLostPointerCapture)
    }
    const finish = (outcome: 'commit' | 'restore'): void => {
      if (finished) return
      finished = true
      removeListeners()
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
        frameId = null
      }
      window.document.body.classList.remove('file-tree-is-resizing')
      activeResizeRef.current = null
      if (outcome === 'commit') {
        committedWidthRef.current = pendingWidth
        liveWidth.set(pendingWidth)
        onCommitWidth(pendingWidth)
      } else {
        liveWidth.set(committedWidthRef.current)
      }
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId)
      }
    }
    const onPointerMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return
      queuePreview(startWidth + startX - moveEvent.clientX)
    }
    const onPointerUp = (upEvent: PointerEvent): void => {
      if (upEvent.pointerId !== pointerId) return
      pendingWidth = clampFileTreeWidth(startWidth + startX - upEvent.clientX, layoutRef.current)
      finish('commit')
    }
    const onPointerCancel = (cancelEvent: PointerEvent): void => {
      if (cancelEvent.pointerId !== pointerId) return
      finish('restore')
    }
    const onWindowBlur = (): void => finish('restore')
    const onLostPointerCapture = (): void => finish('restore')

    activeResizeRef.current = { finish }
    window.document.body.classList.add('file-tree-is-resizing')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', onWindowBlur)
    handle.addEventListener('lostpointercapture', onLostPointerCapture)
    handle.setPointerCapture(pointerId)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const step = event.shiftKey ? 40 : 10
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      commitWidth(committedWidthRef.current + step)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      commitWidth(committedWidthRef.current - step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      commitWidth(FILE_TREE_DEFAULT_WIDTH)
    }
  }

  return {
    handleKeyDown,
    layoutStyle: {
      '--right-dock-editor-tree-width': liveWidthPixels,
    } as React.CSSProperties,
    liveWidth,
    maximumWidth: resolveFileTreeMaximumWidth(layoutRef.current),
    resetWidth: () => commitWidth(FILE_TREE_DEFAULT_WIDTH),
    startResize,
  }
}

function EditorFileTreePresence({
  children,
  focusReturnRef,
  liveWidth,
  visible,
  width,
}: {
  children: React.ReactNode
  focusReturnRef: React.RefObject<HTMLButtonElement | null>
  liveWidth: MotionValue<number>
  visible: boolean
  width: number
}): React.ReactNode {
  const initiallyVisibleRef = useRef(visible)

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <EditorFileTreePresenceItem
          key="editor-file-tree"
          focusReturnRef={focusReturnRef}
          liveWidth={liveWidth}
          skipEnterAnimation={initiallyVisibleRef.current}
          width={width}
        >
          {children}
        </EditorFileTreePresenceItem>
      ) : null}
    </AnimatePresence>
  )
}

function EditorFileTreePresenceItem({
  children,
  focusReturnRef,
  liveWidth,
  ref,
  skipEnterAnimation,
  width,
}: {
  children: React.ReactNode
  focusReturnRef: React.RefObject<HTMLButtonElement | null>
  liveWidth: MotionValue<number>
  ref?: React.Ref<HTMLDivElement | null>
  skipEnterAnimation: boolean
  width: number
}): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const [isPresent, safeToRemove] = usePresence()
  const shellRef = useRef<HTMLDivElement | null>(null)
  const [entryComplete, setEntryComplete] = useState(skipEnterAnimation)
  const liveShellWidth = useTransform(liveWidth, (value) => value + 8)
  const visibleState = { opacity: 1, width: width + 8, x: 0 }
  const hiddenState = { opacity: 0, width: 0, x: 8 }

  useLayoutEffect(() => {
    if (isPresent) return
    setEntryComplete(false)
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && shellRef.current?.contains(activeElement)) {
      focusReturnRef.current?.focus({ preventScroll: true })
    }
  }, [focusReturnRef, isPresent])

  useEffect(() => {
    if (!reducedMotion || !isPresent) return
    setEntryComplete(true)
  }, [isPresent, reducedMotion])

  useEffect(() => {
    if (isPresent || !safeToRemove) return
    const timeout = window.setTimeout(
      safeToRemove,
      reducedMotion ? 0 : (exitTween.duration as number) * 1_000,
    )
    return () => window.clearTimeout(timeout)
  }, [isPresent, reducedMotion, safeToRemove])

  return (
    <motion.div
      ref={(node) => {
        shellRef.current = node
        if (typeof ref === 'function') {
          ref(node)
        } else if (ref) {
          ref.current = node
        }
      }}
      aria-hidden={!isPresent ? true : undefined}
      animate={
        isPresent
          ? visibleState
          : {
              ...hiddenState,
              transition: motionTransition(reducedMotion, exitTween),
            }
      }
      className="right-dock-editor-file-tree-presence tw:flex tw:h-full tw:min-h-0 tw:grow-0 tw:shrink-0 tw:basis-auto tw:overflow-hidden"
      data-file-tree-presence={isPresent ? 'open' : 'exiting'}
      data-presence={isPresent ? 'present' : 'exiting'}
      initial={skipEnterAnimation ? false : hiddenState}
      inert={!isPresent ? true : undefined}
      onAnimationComplete={() => {
        if (isPresent) setEntryComplete(true)
      }}
      style={{
        height: '100%',
        width: liveShellWidth,
        minWidth: isPresent && entryComplete ? FILE_TREE_MIN_WIDTH + 8 : 0,
      }}
      transition={motionTransition(reducedMotion, entryComplete ? instantTween : layoutTween)}
    >
      {children}
    </motion.div>
  )
}

function fileTreeViewStorageKey(workspacePath: string): string {
  return `pidex.desktop.fileTreeView:${workspacePath.replace(/\\/g, '/').toLowerCase()}`
}

function readFileTreeViewState(workspacePath: string, defaultVisible = true): FileTreeViewState {
  const fallback = {
    visible: defaultVisible,
    width: FILE_TREE_DEFAULT_WIDTH,
  }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(fileTreeViewStorageKey(workspacePath))
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as {
      visible?: unknown
      width?: unknown
    }
    return {
      visible: typeof parsed.visible === 'boolean' ? parsed.visible : fallback.visible,
      width:
        typeof parsed.width === 'number' && Number.isFinite(parsed.width)
          ? Math.max(FILE_TREE_MIN_WIDTH, Math.round(parsed.width))
          : fallback.width,
    }
  } catch {
    return fallback
  }
}

function writeFileTreeViewState(workspacePath: string, state: FileTreeViewState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(fileTreeViewStorageKey(workspacePath), JSON.stringify(state))
  } catch {
    // File tree view persistence is best-effort.
  }
}
