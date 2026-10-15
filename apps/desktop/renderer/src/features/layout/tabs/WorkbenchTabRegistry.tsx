import type { FileEditorViewState } from '../../editor/FileEditor.js'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import React, { Suspense, useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  Bot,
  Folder,
  FileText,
  FileCode2,
  GitPullRequest,
  Globe2,
  ListChecks,
  MessageCirclePlus,
  Paperclip,
  SquarePlus,
  SquareTerminal,
  Settings2,
} from 'lucide-react'
import type {
  DesktopBrowserState,
  DesktopDiffMarkerStyle,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopGitStatus,
  DesktopPermissionMode,
  DesktopModelSelection,
  DesktopReviewView,
  DesktopSessionStatus,
  DesktopWorkspace,
} from '../../../../shared/Types.js'
import type { ReviewTabUiState } from './ConversationUiState.js'
import type { SideChatComposerRenderContext } from '../../session/conversation/SideChatThreadPanel.js'
import type { ConversationItemContextValue } from '../../session/timeline/ConversationItemContext.js'
import type { OpenPlanInDockRequest } from '../../session/workflow/WorkflowPlanCard.js'
import type { FileDocumentLoadErrorPhase } from '../dock/RightDockPanels.js'
import { FileTypeIcon } from '../FileTypeIcon.js'
import { createWorkspaceFileTabId } from './WorkspaceFileTabId.js'
import type {
  MarkdownFileViewMode,
  WorkbenchTabDescriptor,
  WorkbenchTabKind,
} from '../dock/RightDockState.js'
import {
  WorkbenchPanelEmpty,
  WorkbenchPanelLoading,
  WorkbenchPanelUnavailable,
} from '../panels/WorkbenchPanelStates.js'
import { desktopBrowserClient } from '../../../services/desktop-client/DesktopBrowserClient.js'
import { WorkspaceReviewSidebar } from '../../review/workspace/WorkspaceReviewSidebar.js'
import {
  RightDockFilePreviewPanel,
  RightDockFilesPanel,
  RightDockPlanPanel,
  RightDockSkillPreviewPanel,
} from '../dock/RightDockPanels.js'
import { SideChatThreadPanel } from '../../session/conversation/SideChatThreadPanel.js'
import { UserAttachmentPreviewPanel } from '../../session/attachments/UserAttachmentPreviewPanel.js'

const DesktopBrowserPanel = React.lazy(() =>
  import('../../browser/DesktopBrowserPanel.js').then((module) => ({
    default: module.DesktopBrowserPanel,
  })),
)
const TerminalPanel = React.lazy(() =>
  import('../../terminal/TerminalPanel.js').then((module) => ({ default: module.TerminalPanel })),
)

function deferred(element: ReactNode): ReactNode {
  return <Suspense fallback={null}>{element}</Suspense>
}

function BrowserTabContent({
  tab,
  context,
}: {
  tab: Extract<WorkbenchTabDescriptor, { kind: 'browser' }>
  context: WorkbenchTabRenderContext['browser']
}): React.ReactNode {
  const client = desktopBrowserClient.forTab(tab.tabId)
  const [state, setState] = useState<DesktopBrowserState | null>(() => client.getTab(tab.tabId))
  const onStateChange = useCallback(
    (next: DesktopBrowserState) => {
      setState(next)
      context.onStateChange(next)
    },
    [context.onStateChange],
  )
  useEffect(() => {
    if (context.availability.status !== 'available') return
    desktopBrowserClient.selectTab(tab.tabId)
    const unsubscribe = client.onBrowserStateChange(onStateChange)
    void client
      .openBrowser()
      .then(() => client.setBrowserVisible(true))
      .then(onStateChange)
      .catch(() => undefined)
    return () => {
      unsubscribe()
      void client.setBrowserVisible(false).catch(() => undefined)
    }
  }, [client, tab.tabId, context.availability.status, onStateChange])
  if (context.availability.status === 'unavailable')
    return (
      <WorkbenchPanelUnavailable
        title="内置浏览器不可用"
        description={context.availability.reason ?? '当前环境没有浏览器能力。'}
      />
    )
  if (!state) return <WorkbenchPanelLoading label="正在连接内置浏览器…" />
  return deferred(
    <DesktopBrowserPanel
      {...context}
      client={client}
      state={state}
      onStateChange={onStateChange}
    />,
  )
}

export type WorkbenchTabRenderContext = {
  providerManagement?: ReactNode
  review: {
    activeSessionId: string | null
    projectId: string | null
    defaultBranch: string | null
    gitStatus: DesktopGitStatus | null
    isRefreshing: boolean
    diffMarkerStyle: DesktopDiffMarkerStyle
    reviewView: DesktopReviewView
    reviewTabState: ReviewTabUiState
    sessionStatus: DesktopSessionStatus
    workspacePath: string | null
    onAppendComposerText?: (text: string) => void
    onReviewSummaryChange?: (
      summary: import('../../review/source/ReviewAgentClient.js').ReviewSummarySnapshot | null,
    ) => void
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
  browser: {
    availability: WorkbenchTabAvailability
    state: DesktopBrowserState | null
    threadId?: string | null
    onNewTab?: () => void
    draftKey: import('../../session/composer/ComposerTypes.js').ComposerDraftKey
    onOpenSettings?: () => void
    onAppendImage?: (image: { data: string; mimeType: 'image/png' }) => void
    onStateChange: (state: DesktopBrowserState) => void
  }
  files: {
    files: DesktopFileEntry[]
    selectedFile: DesktopFilePreview | null
    workspace: DesktopWorkspace | null
    onOpenFileFromBrowser: (file: DesktopFileEntry) => void
    onPreviewFile: (file: DesktopFileEntry) => void
    onAskInSideChat?: (text: string) => void
    onSetFileViewState?: (tabId: WorkbenchTabDescriptor['id'], state: FileEditorViewState) => void
    onAppendComposerText?: (text: string) => void
    onAddComposerFiles?: (filePaths: string[]) => void
    onPinFileTab: (tabId: WorkbenchTabDescriptor['id']) => void
    onSetFileMarkdownViewMode: (
      tabId: WorkbenchTabDescriptor['id'],
      mode: MarkdownFileViewMode,
    ) => void
    onLoadError: (
      tab: Extract<WorkbenchTabDescriptor, { kind: 'file-preview' }>,
      error: Error,
      phase: FileDocumentLoadErrorPhase,
    ) => void
  }
  planContentByEventId: Readonly<Record<string, string>>
  plan: {
    /** 打开该聊天最新的计划；计划面板据此提供“有新版计划”入口。 */
    onOpenPlan?: (request: OpenPlanInDockRequest) => void
  }
  sideChat: {
    activeTabId: WorkbenchTabDescriptor['id'] | null
    available: boolean
    focusVersion: number
    isCreating: (tabId: Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>['id']) => boolean
    itemContext: (
      tab: Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>,
      status: DesktopSessionStatus,
    ) => ConversationItemContextValue
    getPermissionMode: (
      tab: Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>,
    ) => DesktopPermissionMode
    getModelSelection?: (
      tab: Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>,
    ) => Pick<DesktopModelSelection, 'providerID' | 'model' | 'variant'>
    onInteractionError: (message: string) => void
    onOpenPatchReview?: (path?: string) => void
    onOpenPlan?: (request: OpenPlanInDockRequest) => void
    onRecreate: (tab: Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>) => void
    onStateChange: (threadId: string, count: number, status: DesktopSessionStatus) => void
    renderComposer: (
      tab: Extract<WorkbenchTabDescriptor, { kind: 'side-chat' }>,
      context: SideChatComposerRenderContext,
    ) => ReactNode
  }
  sideTask: {
    activeTaskId: string | null
    availability: WorkbenchTabAvailability
    content?: ReactNode
  }
  terminal: {
    availability: WorkbenchTabAvailability
    threadId: string | null
    cwd?: string | null
    onDisplayPathChange: (displayPath: string | null) => void
  }
}

export type WorkbenchTabLifecycle = 'unmount-when-hidden' | 'keep-alive-hidden' | 'external-surface'

export type WorkbenchTabAvailability = {
  status: 'loading' | 'available' | 'unavailable'
  reason?: string
}

export type WorkbenchTabDefinition = {
  kind: WorkbenchTabKind
  label: string
  icon: ReactNode
  shortcut?: string
  launcher: boolean
  launcherLabel?: string
  launcherIcon?: ReactNode
  launcherShortcut?: string | null
  lifecycle: WorkbenchTabLifecycle
  getAvailability?: (context: WorkbenchTabRenderContext) => WorkbenchTabAvailability
  getTitle: (tab: WorkbenchTabDescriptor) => string
  getIcon?: (tab: WorkbenchTabDescriptor) => ReactNode
  render: (tab: WorkbenchTabDescriptor, context: WorkbenchTabRenderContext) => ReactNode
}

const iconSize = APP_ICON_SIZE

const WORKBENCH_LAUNCHER_ORDER: Partial<Record<WorkbenchTabKind, number>> = {
  review: 0,
  terminal: 1,
  browser: 2,
  'file-browser': 3,
  'side-chat': 4,
}

export function getWorkbenchLauncherPresentation(definition: WorkbenchTabDefinition): {
  label: string
  icon: ReactNode
  shortcut?: string
} {
  return {
    label: definition.launcherLabel ?? definition.label,
    icon: definition.launcherIcon ?? definition.icon,
    shortcut:
      definition.launcherShortcut === undefined
        ? definition.shortcut
        : (definition.launcherShortcut ?? undefined),
  }
}

const definitions: readonly WorkbenchTabDefinition[] = [
  {
    kind: 'provider-management',
    label: '供应商设置',
    icon: <Settings2 size={iconSize} />,
    launcher: false,
    lifecycle: 'unmount-when-hidden',
    getTitle: () => '供应商设置',
    render: (_tab, context) => context.providerManagement ?? null,
  },
  {
    kind: 'review',
    label: '变更',
    icon: <GitPullRequest size={iconSize} />,
    shortcut: 'Ctrl+Shift+G',
    launcher: true,
    lifecycle: 'unmount-when-hidden',
    launcherIcon: <SquarePlus size={iconSize} />,
    getTitle: () => '变更',
    render: (_tab, context) => <WorkspaceReviewSidebar {...context.review} />,
  },
  {
    kind: 'browser',
    label: '浏览器',
    icon: <Globe2 size={iconSize} />,
    shortcut: 'Ctrl+T',
    launcher: true,
    lifecycle: 'external-surface',
    getAvailability: (context) => context.browser.availability,
    getTitle: (tab) =>
      tab.kind === 'browser'
        ? `${tab.title || '浏览器'}${tab.busy ? ' · 运行中' : tab.suspended ? ' · 已暂停' : ''}`
        : '浏览器',
    render: (tab, context) =>
      tab.kind === 'browser' ? <BrowserTabContent tab={tab} context={context.browser} /> : null,
  },
  {
    kind: 'file-browser',
    label: '打开文件',
    icon: <FileText size={iconSize} />,
    shortcut: 'Ctrl+Shift+E',
    launcher: true,
    lifecycle: 'unmount-when-hidden',
    launcherLabel: '打开文件',
    launcherIcon: <Folder size={iconSize} />,
    launcherShortcut: 'Ctrl+P',
    getTitle: () => '打开文件',
    render: (tab, context) => {
      const directoryPath = tab.kind === 'file-browser' ? tab.directoryPath : undefined
      return (
        <RightDockFilesPanel
          activePath={directoryPath ?? null}
          files={context.files.files}
          workspace={context.files.workspace}
          onAddComposerFiles={context.files.onAddComposerFiles}
          onOpenFile={(file) => context.files.onOpenFileFromBrowser(file)}
        />
      )
    },
  },
  {
    kind: 'file-preview',
    label: '文件预览',
    icon: <FileText size={iconSize} />,
    launcher: false,
    lifecycle: 'unmount-when-hidden',
    getTitle: (tab) => (tab.kind === 'file-preview' ? basename(tab.relativePath) : '文件预览'),
    getIcon: () => <FileText size={iconSize} />,
    render: (tab, context) =>
      tab.kind === 'file-preview' ? (
        <RightDockFilePreviewPanel
          expectedPath={tab.relativePath}
          projectId={tab.projectId}
          folderId={tab.folderId}
          files={context.files.files}
          workspacePath={tab.workspacePath}
          workspace={context.files.workspace}
          revealLine={tab.line}
          previewTab={tab.preview}
          markdownViewMode={tab.markdownViewMode}
          viewState={tab.viewState}
          onViewStateChange={(state) => context.files.onSetFileViewState?.(tab.id, state)}
          onAskInSideChat={context.files.onAskInSideChat}
          onSetMarkdownViewMode={(mode) => context.files.onSetFileMarkdownViewMode(tab.id, mode)}
          onPinTab={() => context.files.onPinFileTab(tab.id)}
          onLoadError={(error, phase) => context.files.onLoadError(tab, error, phase)}
          onOpenFile={(file, options) => {
            context.files.onPreviewFile(file)
            if (!options.preview && file.type === 'file') {
              context.files.onPinFileTab(
                createWorkspaceFileTabId(
                  file.rootPath ?? tab.workspacePath,
                  file.path,
                  tab.projectId,
                  file.folderId ?? tab.folderId,
                ),
              )
            }
          }}
          onAddComposerFiles={context.files.onAddComposerFiles}
          onAppendComposerText={context.files.onAppendComposerText}
        />
      ) : null,
  },
  {
    kind: 'plan',
    label: '计划',
    icon: <ListChecks size={iconSize} />,
    launcher: false,
    lifecycle: 'unmount-when-hidden',
    getTitle: (tab) => (tab.kind === 'plan' ? tab.title : '计划'),
    render: (tab, context) =>
      tab.kind === 'plan' ? (
        <RightDockPlanPanel
          planItemId={tab.planItemId}
          threadId={tab.threadId}
          fallbackContent={
            tab.content?.trim() || context.planContentByEventId[tab.planItemId] || null
          }
          onOpenPlan={context.plan?.onOpenPlan}
        />
      ) : null,
  },
  {
    kind: 'skill-preview',
    label: '技能预览',
    icon: <FileCode2 size={iconSize} />,
    launcher: false,
    lifecycle: 'unmount-when-hidden',
    getTitle: (tab) => (tab.kind === 'skill-preview' ? tab.skill.name : '技能预览'),
    render: (tab) =>
      tab.kind === 'skill-preview' ? <RightDockSkillPreviewPanel tab={tab} /> : null,
  },
  {
    kind: 'attachment-preview',
    label: '用户附件',
    icon: <Paperclip size={iconSize} />,
    launcher: false,
    lifecycle: 'unmount-when-hidden',
    getTitle: () => '用户附件',
    render: (tab) =>
      tab.kind === 'attachment-preview' ? <UserAttachmentPreviewPanel tab={tab} /> : null,
  },
  {
    kind: 'side-chat',
    label: '侧边聊天',
    icon: <MessageCirclePlus size={iconSize} />,
    shortcut: 'Ctrl+Alt+S',
    launcher: true,
    lifecycle: 'unmount-when-hidden',
    getTitle: (tab) => (tab.kind === 'side-chat' ? tab.title : '侧边聊天'),
    render: (tab, context) =>
      tab.kind === 'side-chat' ? (
        <SideChatThreadPanel
          active={context.sideChat.activeTabId === tab.id}
          creating={context.sideChat.isCreating(tab.id)}
          focusVersion={context.sideChat.focusVersion}
          itemContext={(status) => context.sideChat.itemContext(tab, status)}
          onInteractionError={context.sideChat.onInteractionError}
          onOpenPatchReview={context.sideChat.onOpenPatchReview}
          onOpenPlan={context.sideChat.onOpenPlan}
          onRecreate={context.sideChat.onRecreate}
          onStateChange={context.sideChat.onStateChange}
          permissionMode={context.sideChat.getPermissionMode(tab)}
          modelSelection={context.sideChat.getModelSelection?.(tab)}
          renderComposer={context.sideChat.renderComposer}
          tab={tab}
        />
      ) : null,
  },
  {
    kind: 'terminal',
    label: '终端',
    icon: <SquareTerminal size={iconSize} />,
    shortcut: 'Ctrl+`',
    launcher: true,
    launcherShortcut: null,
    lifecycle: 'keep-alive-hidden',
    getAvailability: (context) => context.terminal.availability,
    getTitle: (tab) => (tab.kind === 'terminal' && tab.title ? tab.title : '终端'),
    render: (tab, context) => {
      if (context.terminal.availability.status === 'loading') {
        return <WorkbenchPanelLoading label="正在连接集成终端…" />
      }
      if (context.terminal.availability.status === 'unavailable') {
        return (
          <WorkbenchPanelUnavailable
            title="集成终端不可用"
            description={
              context.terminal.availability.reason ?? '当前桌面运行环境没有提供终端能力。'
            }
          />
        )
      }
      const terminalTab = tab.kind === 'terminal' ? tab : null
      const effectiveThreadId = context.terminal.threadId || 'home'
      const terminalId =
        terminalTab?.terminalId ??
        (tab.id.startsWith('terminal:') ? tab.id.slice('terminal:'.length) : tab.id)
      return deferred(
        <TerminalPanel
          key={tab.id}
          threadId={effectiveThreadId}
          terminalId={terminalId}
          cwd={context.terminal.cwd}
          onDisplayPathChange={context.terminal.onDisplayPathChange}
        />,
      )
    },
  },
  {
    kind: 'side-task',
    label: '子智能体',
    icon: <Bot size={iconSize} />,
    launcher: false,
    lifecycle: 'unmount-when-hidden',
    getAvailability: (context) => context.sideTask.availability,
    getTitle: () => '子智能体',
    render: (tab, context) =>
      tab.kind === 'side-task' && context.sideTask.activeTaskId === tab.taskId ? (
        (context.sideTask.content ?? (
          <div className="right-dock-empty-state">正在加载子智能体…</div>
        ))
      ) : (
        <div className="right-dock-empty-state">
          <strong>子智能体已在其他标签切换</strong>
          <span>选择此标签以恢复对应任务。</span>
        </div>
      ),
  },
]

const registry = new Map(definitions.map((definition) => [definition.kind, definition]))

export function getWorkbenchTabDefinition(
  tabOrKind: WorkbenchTabDescriptor | WorkbenchTabKind,
): WorkbenchTabDefinition {
  const kind = typeof tabOrKind === 'string' ? tabOrKind : tabOrKind.kind
  const definition = registry.get(kind)
  if (!definition) {
    throw new Error(`未注册的工作台标签：${kind}`)
  }
  return definition
}

export function getWorkbenchTabDisplayTitle(
  tab: WorkbenchTabDescriptor,
  terminalDisplayPath: string | null,
): string {
  if (tab.kind === 'terminal') {
    if (tab.title) {
      return tab.title
    }
    if (terminalDisplayPath?.trim()) {
      return terminalDisplayPath
    }
    return '终端'
  }
  return getWorkbenchTabDefinition(tab).getTitle(tab)
}

export function getWorkbenchLauncherDefinitions(): readonly WorkbenchTabDefinition[] {
  return definitions
    .filter((definition) => definition.launcher)
    .map((definition, index) => ({ definition, index }))
    .sort((left, right) => {
      const leftOrder = WORKBENCH_LAUNCHER_ORDER[left.definition.kind]
      const rightOrder = WORKBENCH_LAUNCHER_ORDER[right.definition.kind]
      return (
        (leftOrder ?? Object.keys(WORKBENCH_LAUNCHER_ORDER).length + left.index) -
        (rightOrder ?? Object.keys(WORKBENCH_LAUNCHER_ORDER).length + right.index)
      )
    })
    .map(({ definition }) => definition)
}

export function createLauncherTab(kind: WorkbenchTabKind): WorkbenchTabDescriptor | null {
  if (kind === 'review') return { id: 'review', kind: 'review' }
  if (kind === 'browser') {
    const tabId = crypto.randomUUID()
    return { id: `browser:${tabId}`, kind: 'browser', tabId }
  }
  if (kind === 'file-browser') {
    return { id: 'file-browser', kind: 'file-browser' }
  }
  if (kind === 'side-chat') return null
  if (kind === 'terminal') return { id: 'terminal', kind: 'terminal', title: '终端 1' }
  return null
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/)
  return segments[segments.length - 1] || path
}
