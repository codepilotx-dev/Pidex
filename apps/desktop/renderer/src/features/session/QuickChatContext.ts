import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'
import type { ModelPreset } from '../../ModelPresets.js'
import type {
  DesktopReviewSource,
  DesktopUserMessageInput,
  DesktopGitStatus,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopPermissionRequest,
  DesktopSessionStatus,
  DesktopWorkspace,
  DesktopThreadGoal,
  DesktopBrowserState,
} from '../../../shared/Types.js'
import type { OpenPlanInDockRequest } from './workflow/WorkflowPlanCard.js'
import type { MarkdownFileOpenOptions, MarkdownFileReference } from '../markdown/index.js'
import type { DesktopComposerProps } from './composer/DesktopComposer.js'
import type { NewSessionRecentTask } from './NewSessionSuggestions.js'
import type { Attachment, LocalContextReference } from '@pidex/shared/thread'
import type { ThreadArtifactPreviewInput } from './attachments/AttachmentPreviewDescriptor.js'

export type ProviderModelOption = {
  providerID: string
  displayName: string
  modelPresets: ModelPreset[]
  baseURL: string | undefined
}

export type QuickChatComposerDraftBridge = {
  value: string
  replace: (value: string) => void
  focus?: () => void
}

export type QuickChatContextValue = {
  isConversationRoute: boolean
  isConversationLoading: boolean
  sidebarCollapsed: boolean
  activeSessionId: string | null
  activeSessionPinnedAt: string | null
  sessionTitle: string | null
  editableSessionTitle: string | null
  projectDetailsTrigger?: ReactNode
  workspaceName: string | null
  workspacePath: string | null
  activeProjectId: string | null
  branchName: string | null
  branches: string[]
  diff: string
  gitStatus: DesktopGitStatus | null
  gitDetection?: import('../../../shared/Types.js').DesktopGitDetectionState
  reviewSource?: DesktopReviewSource
  reviewSummary?: import('../review/source/ReviewAgentClient.js').ReviewSummarySnapshot | null
  recentWorkspaces: DesktopWorkspace[]
  recentTasks: NewSessionRecentTask[]
  titleRegenerating: boolean
  permissionMode: DesktopPermissionMode
  planModeActive: boolean
  providerModelOptions: ProviderModelOption[]
  onArchiveSession: () => void
  onCreateBranch: () => void
  onOpenAutomation: () => void
  onOpenWorkspacePath: () => void
  onOpenRightDock: (tool: 'review', source?: DesktopReviewSource) => void
  onOpenPatchReview: (path?: string) => void
  onOpenPlanInRightDock: (plan: OpenPlanInDockRequest) => void
  onOpenFileReference: (reference: MarkdownFileReference, options: MarkdownFileOpenOptions) => void
  onOpenAttachment: (attachment: Attachment) => void
  onOpenLocalContext: (reference: LocalContextReference) => void
  onOpenArtifact: (artifact: ThreadArtifactPreviewInput) => void
  onActivateBrowserTab: (tabId: string) => void
  browserTabs: DesktopBrowserState[]
  threadGoal: DesktopThreadGoal | null
  onGoalPause: () => void
  onGoalResume: () => void
  canCopyFileReferenceContents: (reference: MarkdownFileReference) => boolean
  onCopyFileReferenceContents: (reference: MarkdownFileReference) => void | Promise<void>
  onSubmitEditedUserMessage: (
    input: DesktopUserMessageInput,
    target: { turnId: string; inputId: string; operationId: string },
  ) => Promise<void>
  onAppendComposerText: (text: string) => void
  onAppendSideChatText: (text: string) => void
  onOpenSideChat: () => void
  sideChatAvailable: boolean
  onOpenSubagent: (taskId: string) => void
  onAddComposerFiles: (filePaths: string[]) => void
  onRefreshDiff: () => void
  onRenameSession: (title: string) => Promise<boolean>
  onRefreshSessionTitle: () => Promise<boolean>
  onToggleSidebar: () => void
  onToggleSessionPinned: () => void
  onCommitOrPush: () => void
  onGitOperation?: (operation: 'commit' | 'push') => void
  onOpenTerminal?: () => void
  onCreatePullRequest: () => void
  onChooseWorkspace: () => Promise<DesktopWorkspace | null>
  onCloneGithub: () => void
  onOpenWorkspace: (workspace: DesktopWorkspace) => Promise<DesktopWorkspace | null>
  onBranchSelect: (branch: string) => Promise<void>
  onClearWorkspace: () => void
  onDecidePermission: (
    request: DesktopPermissionRequest,
    behavior: 'allow' | 'deny',
    alwaysAllow?: boolean,
    updatedInput?: Record<string, unknown>,
    decisionExtras?: Pick<
      DesktopPermissionDecision,
      'grantScope' | 'computerGrant' | 'grantOptionId'
    >,
  ) => void | Promise<void>
  sessionStatus: DesktopSessionStatus
  composerProps: DesktopComposerProps | null
  composerDraft?: QuickChatComposerDraftBridge
  bottomPanelVisible: boolean
  /** 右工作区处于内容全宽：聊天区域被隐藏，摘要浮层需要随之关闭。 */
  layoutResizeActive: boolean
  onToggleBottomPanel: () => void
  dockedPlanItemId: string | null
}

export const QuickChatContext = createContext<QuickChatContextValue | null>(null)

export function useQuickChatContext(): QuickChatContextValue {
  const context = useContext(QuickChatContext)
  if (!context) {
    throw new Error('useQuickChatContext must be used within QuickChatContext.Provider')
  }
  return context
}
