import { useStore } from 'zustand/react'
import { useShallow } from 'zustand/react/shallow'
import { startupSurfaceReadyRef } from '../../../startup/StartupSplashHandoff.js'
import { GitBoardSidebar } from '../../git-board/GitBoardSidebar.js'
import { useGitBoard } from '../../git-board/GitBoardContext.js'
import {
  captureSidebarAssignments,
  restoreFailedArchiveAssignments,
} from '../sidebar/SidebarCustomization.js'
import { DEFAULT_SIDEBAR_CUSTOMIZATION } from '../../../../shared/SettingsSchema.js'
import {
  notifyProjectCatalogChanged,
  subscribeProjectRestores,
} from '../../projects/ProjectCatalogEvents.js'
import { mergeBrowserWorkbench } from '../../browser/BrowserWorkbenchState.js'
import { mergeComposerAttachments } from '../../session/composer/ComposerAttachmentSelection.js'
import { ConversationProjectDetails } from '../../projects/ConversationProjectDetails.js'
import {
  desktopClient,
  desktopClipboard,
  loadDesktopTerminalClient,
} from '../../../services/desktop-client/index.js'
import {
  openPathWithPreferredExternalTarget,
  shouldFallbackToExternalOpen,
} from '../../../services/ExternalOpenTargetsStore.js'
import type React from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { normalizePathForComparison } from '../../../utils/PathUtils.js'
import type { SessionBoundComposerProps } from '../../session/composer/SessionBoundComposer.js'
import { getDesktopComposerBranchName } from '../../session/composer/ComposerWorkspacePresentation.js'
import { composerDraftStore } from '../../session/composer/ComposerDraftStore.js'
import { isBuiltinSkill } from '../../plugins/BuiltinSkillPresentation.js'
import { listRuntimeSkills } from '../../settings/plugins/SkillClientAdapter.js'
import type { ComposerDraftKey } from '../../session/composer/ComposerTypes.js'
import { deriveWorkflowSessionState } from '../../../../shared/WorkflowReducer.js'
import type { WorkbenchFileLoadErrorEvent } from '../dock/RightDock.js'
import { WorkspaceShellControls, RightPanelToggleIcon } from '../dock/WorkspaceShellControls.js'
import { DesktopWorkspaceHeader, WorkspaceHeaderProvider } from '../workspace-header/index.js'
import {
  applyWorkbenchPanelAction,
  createDefaultWorkbenchTabsState,
  createSkillPreviewTab,
  type WorkbenchPanelTarget,
  type WorkbenchTabDescriptor,
  type WorkbenchTabId,
  type UserAttachmentPreviewTab,
} from '../dock/RightDockState.js'
import {
  createDefaultConversationUiState,
  createDefaultReviewTabUiState,
  openPatchReviewTabState,
  patchConversationUiState,
  saveConversationUiState,
  loadConversationUiState,
  validateConversationUiState,
  type ConversationUiState,
  type ReviewTabUiState,
} from '../tabs/ConversationUiState.js'
import { DesktopSidebar } from '../DesktopSidebar.js'
import type { GitWorkflowMode } from '../panels/GitWorkflowModal.js'
import { SidebarFrame } from '../SidebarFrame.js'
import { SidebarNavigationRail } from '../sidebar/SidebarNavigationRail.js'
import { SidebarScheduledPane } from '../sidebar/SidebarScheduledPane.js'
import { SidebarPluginsPane } from '../sidebar/SidebarPluginsPane.js'
import { SidebarProvidersPane } from '../sidebar/SidebarProvidersPane.js'
import { SidebarPetsPane } from '../sidebar/SidebarPetsPane.js'
import { SIDEBAR_RAIL_WIDTH, sidebarPaneForRoute } from '../sidebar/SidebarNavigation.js'
import { useSidebarCapabilities } from '../sidebar/SidebarTopNav.js'
import { AutomationControllerProvider } from '../../automation/AutomationControllerProvider.js'
import { MenuBar } from '../MenuBar.js'
import { useAppMenuActions } from './UseAppMenuActions.js'
import { QuickChatContext } from '../../session/QuickChatContext.js'
import {
  sessionDisplayTitle,
  sessionEditableTitle,
  sessionViewFallbackTitle,
  type SessionListItem,
} from '../../../UiTypes.js'
import { resolveModelPresetId } from '../../../ModelPresets.js'
import { useDesktopRuntimeSettingsField } from '../../settings/UseDesktopSettings.js'
import { useSystemNotifications } from '../../notifications/UseSystemNotifications.js'
import { Button } from '../../../components/ui/Button.js'
import { TaskConversationLinks } from '../../automation/TaskConversationLinks.js'
import { NO_WORKSPACE_DIFF } from '../../workspace/UseWorkspaceState.js'
import { shouldRestoreLastWorkspace } from '../../workspace/LastWorkspaceRestore.js'
import { useSessionState } from '../../session/state/UseSessionState.js'
import { useSessionTitleRegeneration } from '../../session/state/UseSessionTitleRegeneration.js'
import { useDesktopCommands } from '../../session/UseDesktopCommands.js'
import { useEverOpened, useLastNonNull } from '../../../hooks/UsePresenceRetention.js'
import type {
  DesktopComposerAttachment,
  DesktopBrowserState,
  DesktopFileEntry,
  DesktopInstalledSkill,
  DesktopPermissionMode,
  DesktopUserMessageInput,
  DesktopWorkspace,
} from '../../../../shared/Types.js'
import type { Attachment, LocalContextReference } from '@pidex/shared/thread'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  memo,
  useRef,
  useState,
} from 'react'
import {
  QUICK_CHAT_PATH,
  sessionPath,
  useWorkbenchRouteController,
} from './UseWorkbenchRouteController.js'
import type { DesktopLayoutOutletContextValue } from './DesktopLayoutOutletContext.js'
import type { ProviderManagementTab, ProviderManagementSection } from '../dock/RightDockState.js'
import {
  providerManagementRouteId,
  scopedProviderManagementTab,
} from '../../models/provider-management/ProviderManagementPanelState.js'
import { useWorkbenchShellController } from './UseWorkbenchShellController.js'
import {
  isTerminalKeyboardTarget,
  useIntegratedTerminalController,
} from './UseIntegratedTerminalController.js'
import { useWorkbenchWorkspaceController } from './UseWorkbenchWorkspaceController.js'
import {
  isDeepSeekThinkingModel,
  useModelProviderController,
} from '../UseModelProviderController.js'
import { buildVariantOptions } from '../../models/ReasoningVariantLabels.js'
import { useSubagentDockController } from '../dock/UseSubagentDockController.js'
import { useSideChatController } from '../dock/UseSideChatController.js'
import { WorkbenchShellView } from './WorkbenchShellView.js'
import { WorkbenchPanelPresence } from '../panels/WorkbenchPanelPresence.js'
import type { ResizePhase } from '../UseSidebarResizeCollapseConfirm.js'
import { resolveSidebarEscapeAction } from '../SidebarShellState.js'
import type { MarkdownFileOpenOptions, MarkdownFileReference } from '../../markdown/index.js'
import { MARKDOWN_THREAD_NAVIGATION_EVENT } from '../../markdown/MarkdownMessage.js'
import {
  hasDirtyFileDocuments,
  fileDocumentLoadErrorMessage,
  prefetchFileDocument,
  saveAllFileDocuments,
  saveFileDocument,
} from '../../workspace/FileDocumentStore.js'
import { SettingsSidebarContent } from '../../settings/SettingsSidebarContent.js'
import { SubagentDockContent } from '../../session/subagents/SubagentDockContent.js'
import { WorkbenchPanel } from '../dock/RightDock.js'
import { AuxiliaryWindowsHost } from '../auxiliary/AuxiliaryWindowsHost.js'
import type { WorkbenchTabRenderContext } from '../tabs/WorkbenchTabRegistry.js'
import { createWorkspaceFileTabId } from '../tabs/WorkspaceFileTabId.js'
import { CommandMenuDialog } from '../../search/CommandMenuDialog.js'
import { DesktopComposer } from '../../session/composer/DesktopComposer.js'
import { buildCommandMenuTasks } from '../../search/CommandMenuModel.js'
import { GlobalErrorModal } from '../../../components/GlobalErrorModal.js'
import { toastStore } from '../../../components/toast/ToastState.js'
import { Archive } from 'lucide-react'
import { toUserErrorMessage } from '../../../utils/Errors.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import type { ThreadArtifactPreviewInput } from '../../session/attachments/AttachmentPreviewDescriptor.js'
import { desktopBrowserClient } from '../../../services/desktop-client/DesktopBrowserClient.js'

const GitWorkflowModal = lazy(() =>
  import('../panels/GitWorkflowModal.js').then((module) => ({ default: module.GitWorkflowModal })),
)
const GithubRepositoryModal = lazy(() =>
  import('../panels/GithubRepositoryModal.js').then((module) => ({
    default: module.GithubRepositoryModal,
  })),
)
const WhatsNewDialog = lazy(() =>
  import('../../whats-new/WhatsNewDialog.js').then((module) => ({
    default: module.WhatsNewDialog,
  })),
)

const EMPTY_BRANCHES: string[] = []
const EXTERNAL_FILE_EXTENSIONS = new Set([
  'bmp',
  'doc',
  'docx',
  'gif',
  'ico',
  'ipynb',
  'jpeg',
  'jpg',
  'ods',
  'odt',
  'pdf',
  'png',
  'ppt',
  'pptx',
  'svg',
  'webp',
  'xls',
  'xlsm',
  'xlsx',
])

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

function hasOpenDialog(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"], dialog[open]') !== null
}

function resolveWorkspaceFileReference(
  workspacePath: string,
  referencePath: string,
): { relativePath: string; absolutePath: string } | null {
  const workspace = workspacePath.replace(/\\/g, '/').replace(/\/+$/u, '')
  const value = referencePath.trim().replace(/\\/g, '/')
  if (!value) return null

  const isAbsolute = /^(?:[a-zA-Z]:\/|\/\/|\/)/u.test(value)
  let relativePath = value

  if (isAbsolute) {
    const prefix = `${workspace}/`
    const matchesWorkspace =
      /^[a-zA-Z]:\//u.test(workspace) || /^[a-zA-Z]:\//u.test(value)
        ? value.toLowerCase().startsWith(prefix.toLowerCase())
        : value.startsWith(prefix)
    if (!matchesWorkspace) {
      // Check if reference IS the workspace root itself (exact match)
      if (value.toLowerCase() === workspace.toLowerCase()) {
        return { relativePath: '.', absolutePath: workspace }
      }
      return null
    }
    relativePath = value.slice(prefix.length)
  }

  relativePath = relativePath.replace(/^(?:\.\/)+/u, '')

  // Handle workspace root (empty or '.' after stripping)
  if (!relativePath || relativePath === '.') {
    return { relativePath: '.', absolutePath: workspace }
  }

  const segments = relativePath.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '..')) {
    return null
  }
  if (segments.length === 0) {
    return { relativePath: '.', absolutePath: workspace }
  }

  relativePath = segments.join('/')
  return {
    relativePath,
    absolutePath: `${workspace}/${relativePath}`,
  }
}

function shouldOpenFileExternally(path: string): boolean {
  const extension = path.split(/[\\/]/u).pop()?.split('.').pop()?.toLowerCase()
  return extension ? EXTERNAL_FILE_EXTENSIONS.has(extension) : false
}

function routeAccessibilityLabel(pathname: string): string {
  if (pathname === '/new') return '新对话'
  if (pathname.startsWith('/threads/')) return '会话'
  if (pathname.startsWith('/projects')) return '项目'
  if (pathname === '/git') return 'Git 看板'
  if (pathname === '/plugins') return '插件与技能'
  if (pathname === '/providers') return '供应商'
  if (pathname === '/pull-requests') return '拉取请求'
  if (pathname === '/automations') return '已安排'
  if (pathname === '/pets') return '宠物'
  if (pathname.startsWith('/settings/')) return '设置'
  return 'Pidex Desktop'
}

function normalizePathForCompare(path: string): string {
  return normalizePathForComparison(path)
}

/** Incrementing counter to sequence directory probe requests */
let directoryProbeRequestId = 0

const MemoGitBoardSidebar = memo(GitBoardSidebar)
const MemoSidebarScheduledPane = memo(SidebarScheduledPane)
const MemoSidebarPluginsPane = memo(SidebarPluginsPane)
const MemoSidebarProvidersPane = memo(SidebarProvidersPane)
const MemoSidebarPetsPane = memo(SidebarPetsPane)

export function DesktopLayout(): React.ReactNode {
  const location = useLocation()
  const [providerManagementTab, setProviderManagementTab] = useState<ProviderManagementTab | null>(
    null,
  )
  const [providerManagementHost, setProviderManagementHost] = useState<HTMLElement | null>(null)
  const [providerManagementOwner, setProviderManagementOwner] = useState<string | null>(null)
  const providerBeforeChange = useRef<(() => Promise<boolean>) | null>(null)
  const providerRouteId = providerManagementRouteId(location.pathname, location.search)
  const isProviderDetailRoute =
    providerRouteId !== null && providerManagementOwner === providerRouteId
  const visibleProviderTab =
    providerManagementOwner === providerRouteId
      ? scopedProviderManagementTab(providerManagementTab, location.pathname, location.search)
      : null
  useEffect(() => {
    if (!providerRouteId || !providerManagementOwner) setProviderManagementTab(null)
  }, [providerRouteId, providerManagementOwner])
  const openProviderManagement = useCallback(
    (providerId: string, section: ProviderManagementSection) => {
      if (providerRouteId !== providerId || providerManagementOwner !== providerId) return
      void (providerBeforeChange.current?.() ?? Promise.resolve(true)).then((allowed) => {
        if (allowed)
          setProviderManagementTab({
            id: 'provider-management',
            kind: 'provider-management',
            providerId,
            section,
          })
      })
    },
    [providerRouteId, providerManagementOwner, providerManagementTab],
  )
  const closeProviderManagement = useCallback(() => {
    void (providerBeforeChange.current?.() ?? Promise.resolve(true)).then((allowed) => {
      if (allowed) setProviderManagementTab(null)
    })
  }, [])
  const routeLabel = routeAccessibilityLabel(location.pathname)
  const subscribedSidebarTimelineEnabled = useDesktopRuntimeSettingsField(
    (s) => s.values.sidebarTimelineEnabled,
  )
  const subscribedNotifications = useDesktopRuntimeSettingsField((s) => s.values.notifications)
  const subscribedLastActiveWorkspacePath = useDesktopRuntimeSettingsField(
    (s) => s.values.lastActiveWorkspacePath,
  )
  const subscribedRemovedWorkspaces = useDesktopRuntimeSettingsField(
    (s) => s.values.removedWorkspaces,
  )
  const subscribedPermissionConfig = useDesktopRuntimeSettingsField(
    (s) => s.values.permissionConfig,
  )
  const subscribedPet = useDesktopRuntimeSettingsField((s) => s.values.pet)
  const subscribedSidebarCustomization = useDesktopRuntimeSettingsField(
    (s) => s.values.sidebarCustomization,
  )
  const subscribedModel = useDesktopRuntimeSettingsField((s) => s.values.model)
  const subscribedCodingModel = useDesktopRuntimeSettingsField((s) => s.values.codingModel)
  const subscribedSessionName = useDesktopRuntimeSettingsField((s) => s.values.sessionName)
  const subscribedThinkingMode = useDesktopRuntimeSettingsField((s) => s.values.thinkingMode)
  const subscribedSystemPrompt = useDesktopRuntimeSettingsField((s) => s.values.systemPrompt)
  const subscribedAppendSystemPrompt = useDesktopRuntimeSettingsField(
    (s) => s.values.appendSystemPrompt,
  )
  const subscribedAdditionalDirectories = useDesktopRuntimeSettingsField(
    (s) => s.values.additionalDirectories,
  )
  const subscribedInstallPidexDependencies = useDesktopRuntimeSettingsField(
    (s) => s.values.installPidexDependencies,
  )
  const subscribedEnableMemory = useDesktopRuntimeSettingsField((s) => s.values.enableMemory)
  const subscribedRustSearchAndDiffKernels = useDesktopRuntimeSettingsField(
    (s) => s.values.rustSearchAndDiffKernels,
  )
  const subscribedEnableAutoReviewPermissionMode = useDesktopRuntimeSettingsField(
    (s) => s.values.enableAutoReviewPermissionMode,
  )
  const subscribedEnableFullAccessPermissionMode = useDesktopRuntimeSettingsField(
    (s) => s.values.enableFullAccessPermissionMode,
  )
  const subscribedRecentWorkspaces = useDesktopRuntimeSettingsField(
    (s) => s.values.recentWorkspaces,
  )
  const subscribedProviderID = useDesktopRuntimeSettingsField((s) => s.values.providerID)
  const subscribedProviderBaseURL = useDesktopRuntimeSettingsField((s) => s.values.providerBaseURL)
  const subscribedShowContextUsage = useDesktopRuntimeSettingsField(
    (s) => s.values.showContextUsage,
  )
  const subscribedDiffMarkerStyle = useDesktopRuntimeSettingsField((s) => s.values.diffMarkerStyle)
  const subscribedReviewView = useDesktopRuntimeSettingsField((s) => s.values.reviewView)
  const subscribedGitBranchPrefix = useDesktopRuntimeSettingsField((s) => s.values.gitBranchPrefix)
  const subscribedAllowForcePush = useDesktopRuntimeSettingsField((s) => s.values.allowForcePush)
  const subscribedCommitMessagePrompt = useDesktopRuntimeSettingsField(
    (s) => s.values.commitMessagePrompt,
  )
  const subscribedPullRequestPrompt = useDesktopRuntimeSettingsField(
    (s) => s.values.pullRequestPrompt,
  )
  const subscribedSidebarSessionPins = useDesktopRuntimeSettingsField(
    (s) => s.values.sidebarSessionPins,
  )
  const subscribedSyncExternalSettingsPatch = useDesktopRuntimeSettingsField(
    (s) => s.syncExternalSettingsPatch,
  )
  const subscribedSetSidebarCustomization = useDesktopRuntimeSettingsField(
    (s) => s.setSidebarCustomization,
  )
  const subscribedPermissionMode = useDesktopRuntimeSettingsField((s) => s.permissionMode)
  const subscribedSettingsLoaded = useDesktopRuntimeSettingsField((s) => s.settingsLoaded)
  const subscribedSetPermissionMode = useDesktopRuntimeSettingsField((s) => s.setPermissionMode)
  const subscribedSetRecentWorkspaces = useDesktopRuntimeSettingsField((s) => s.setRecentWorkspaces)
  const subscribedSetDrawerTab = useDesktopRuntimeSettingsField((s) => s.setDrawerTab)
  const subscribedSetReviewView = useDesktopRuntimeSettingsField((s) => s.setReviewView)
  const subscribedSetSidebarSessionPins = useDesktopRuntimeSettingsField(
    (s) => s.setSidebarSessionPins,
  )
  const subscribedSetSidebarTimelineEnabled = useDesktopRuntimeSettingsField(
    (s) => s.setSidebarTimelineEnabled,
  )
  const settings = useMemo(
    () => ({
      values: {
        sidebarTimelineEnabled: subscribedSidebarTimelineEnabled,
        notifications: subscribedNotifications,
        lastActiveWorkspacePath: subscribedLastActiveWorkspacePath,
        removedWorkspaces: subscribedRemovedWorkspaces,
        permissionConfig: subscribedPermissionConfig,
        pet: subscribedPet,
        sidebarCustomization: subscribedSidebarCustomization,
        model: subscribedModel,
        codingModel: subscribedCodingModel,
        sessionName: subscribedSessionName,
        thinkingMode: subscribedThinkingMode,
        systemPrompt: subscribedSystemPrompt,
        appendSystemPrompt: subscribedAppendSystemPrompt,
        additionalDirectories: subscribedAdditionalDirectories,
        installPidexDependencies: subscribedInstallPidexDependencies,
        enableMemory: subscribedEnableMemory,
        rustSearchAndDiffKernels: subscribedRustSearchAndDiffKernels,
        enableAutoReviewPermissionMode: subscribedEnableAutoReviewPermissionMode,
        enableFullAccessPermissionMode: subscribedEnableFullAccessPermissionMode,
        recentWorkspaces: subscribedRecentWorkspaces,
        providerID: subscribedProviderID,
        providerBaseURL: subscribedProviderBaseURL,
        showContextUsage: subscribedShowContextUsage,
        diffMarkerStyle: subscribedDiffMarkerStyle,
        reviewView: subscribedReviewView,
        gitBranchPrefix: subscribedGitBranchPrefix,
        allowForcePush: subscribedAllowForcePush,
        commitMessagePrompt: subscribedCommitMessagePrompt,
        pullRequestPrompt: subscribedPullRequestPrompt,
        sidebarSessionPins: subscribedSidebarSessionPins,
      },
      syncExternalSettingsPatch: subscribedSyncExternalSettingsPatch,
      setSidebarCustomization: subscribedSetSidebarCustomization,
      permissionMode: subscribedPermissionMode,
      settingsLoaded: subscribedSettingsLoaded,
      setPermissionMode: subscribedSetPermissionMode,
      setRecentWorkspaces: subscribedSetRecentWorkspaces,
      setDrawerTab: subscribedSetDrawerTab,
      setReviewView: subscribedSetReviewView,
      setSidebarSessionPins: subscribedSetSidebarSessionPins,
      setSidebarTimelineEnabled: subscribedSetSidebarTimelineEnabled,
    }),
    [
      subscribedSidebarTimelineEnabled,
      subscribedNotifications,
      subscribedLastActiveWorkspacePath,
      subscribedRemovedWorkspaces,
      subscribedPermissionConfig,
      subscribedPet,
      subscribedSidebarCustomization,
      subscribedModel,
      subscribedCodingModel,
      subscribedSessionName,
      subscribedThinkingMode,
      subscribedSystemPrompt,
      subscribedAppendSystemPrompt,
      subscribedAdditionalDirectories,
      subscribedInstallPidexDependencies,
      subscribedEnableMemory,
      subscribedRustSearchAndDiffKernels,
      subscribedEnableAutoReviewPermissionMode,
      subscribedEnableFullAccessPermissionMode,
      subscribedRecentWorkspaces,
      subscribedProviderID,
      subscribedProviderBaseURL,
      subscribedShowContextUsage,
      subscribedDiffMarkerStyle,
      subscribedReviewView,
      subscribedGitBranchPrefix,
      subscribedAllowForcePush,
      subscribedCommitMessagePrompt,
      subscribedPullRequestPrompt,
      subscribedSidebarSessionPins,
      subscribedSyncExternalSettingsPatch,
      subscribedSetSidebarCustomization,
      subscribedPermissionMode,
      subscribedSettingsLoaded,
      subscribedSetPermissionMode,
      subscribedSetRecentWorkspaces,
      subscribedSetDrawerTab,
      subscribedSetReviewView,
      subscribedSetSidebarSessionPins,
      subscribedSetSidebarTimelineEnabled,
    ],
  )
  const activeSidebarPane = sidebarPaneForRoute(
    location.pathname,
    settings.values.sidebarTimelineEnabled,
  )
  const sidebarCapabilities = useSidebarCapabilities()
  const {
    values: {
      model: settingsModel,
      codingModel,
      sessionName,
      thinkingMode: defaultThinkingMode,
      systemPrompt,
      appendSystemPrompt,
      additionalDirectories,
      installPidexDependencies,
      enableMemory,
      rustSearchAndDiffKernels,
      enableAutoReviewPermissionMode,
      enableFullAccessPermissionMode,
      recentWorkspaces,
      providerID: defaultProviderID,
      providerBaseURL,
      showContextUsage,
      diffMarkerStyle,
      reviewView,
      gitBranchPrefix,
      allowForcePush,
      commitMessagePrompt,
      pullRequestPrompt,
      sidebarSessionPins,
    },
    permissionMode,
    settingsLoaded,
    setPermissionMode,
    setRecentWorkspaces,
    setDrawerTab,
    setReviewView,
    setSidebarSessionPins,
    setSidebarTimelineEnabled,
  } = settings
  const taskNotificationState = useSystemNotifications(
    settingsLoaded ? settings.values.notifications : undefined,
  )
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  const [archiveNoticeVisible, setArchiveNoticeVisible] = useState(false)
  const [archiveUndo, setArchiveUndo] = useState<(() => Promise<void>) | null>(null)
  const [undoingArchive, setUndoingArchive] = useState(false)
  const [commandMenuOpen, setCommandMenuOpen] = useState(false)
  const [isWindowMaximized, setIsWindowMaximized] = useState(false)
  const [gitWorkflowMode, setGitWorkflowMode] = useState<GitWorkflowMode | null>(null)
  const [githubRepositoryModalOpen, setGithubRepositoryModalOpen] = useState(false)
  const [whatsNewDialogOpen, setWhatsNewDialogOpen] = useState(false)
  const [whatsNewRestoreFocusElement, setWhatsNewRestoreFocusElement] =
    useState<HTMLElement | null>(null)
  const browserState = useStore(desktopBrowserClient.tabsStore, (state) =>
    state.displayTabId ? (state.tabs.get(state.displayTabId) ?? null) : null,
  )
  const setBrowserState = useCallback((state: DesktopBrowserState) => {
    if (state.tabId) desktopBrowserClient.tabsStore.setState({ displayTabId: state.tabId })
  }, [])
  const browserTabMap = useStore(desktopBrowserClient.tabsStore, (state) => state.tabs)
  const browserTabs = useMemo(() => [...browserTabMap.values()], [browserTabMap])
  const browserAvailable =
    typeof window !== 'undefined' &&
    typeof window.DesktopBridge?.createOrRestoreDesktopBrowser === 'function'
  const browserAvailability = browserAvailable ? 'available' : 'unavailable'
  const gitWorkflowModalMounted = useEverOpened(gitWorkflowMode !== null)
  const githubRepositoryModalMounted = useEverOpened(githubRepositoryModalOpen)
  const whatsNewDialogMounted = useEverOpened(whatsNewDialogOpen)
  const commandMenuDialogMounted = useEverOpened(commandMenuOpen)
  const globalMessageModalMounted = useEverOpened(errorMessage !== null || noticeMessage !== null)
  const {
    navigate,
    canNavigateBack,
    canNavigateForward,
    navigateBack,
    navigateForward,
    routedSessionId,
    isQuickChatPage,
    isConversationRoute,
    isSettingsRoute,
    settingsActiveTab,
    handleSettingsTabChange,
    handleSettingsBack,
  } = useWorkbenchRouteController()
  const isHomeOrConversationRoute = isQuickChatPage || isConversationRoute
  const {
    sidebarCollapsed,
    sidebarWidth,
    setSidebarWidth,
    toggleSidebarCollapsed: toggleSidebarPanel,
    collapseSidebar,
    sidebarShell,
    sidebarMinWidth,
    sidebarMaxWidth,
    workbenchLayoutState,
    workbenchPanelState,
    setWorkbenchPanelState,
    workspaceView,
    workspaceLayout,
    committedWorkspaceLayout,
    setWorkspaceLayout,
    stepWorkspaceLayout,
    rightDockState,
    bottomPanelState,
    bottomPanelVisible,
    workspaceRef,
    workspaceWidth,
    rightDockVisible,
    rightDockMinWidth,
    rightDockMaxWidth,
    rightDockWidth,
    rightPanelCommittedSize,
    rightPanelLiveResize,
    handleRightDockResizeRaw,
    handleRightDockResizePreview,
    shouldCommitRightDockResize,
    bottomPanelMinHeight,
    bottomPanelMaxHeight,
    bottomPanelHeight,
    bottomPanelLiveResize,
    openRightDockTab,
    handleSetRightDockWidth,
    handleResetRightDockWidth,
    handleSetBottomPanelHeight,
    handleResetBottomPanelHeight,
    handleOpenPlanDock,
    toggleBottomPanelVisible,
    openPanelTab,
    selectPanelTab,
    closePanelTab,
    togglePanel,
    closePanel,
    movePanelTab,
    popOutPanelTab,
    dockBackPanelTab,
    reorderPanelTab,
    closeOtherTabs,
    closeTabsToRight,
    pinTab,
    setFileMarkdownViewMode,
    setFileViewState,
  } = useWorkbenchShellController({
    activePane: activeSidebarPane,
    panelRouteActive: isHomeOrConversationRoute,
    temporaryRightPanelOpen: visibleProviderTab !== null,
  })
  const [rightResizePhase, setRightResizePhase] = useState<ResizePhase>('idle')
  const mainRouteRef = useRef<HTMLDivElement>(null)
  const commandMenuInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    document.title = `${routeLabel} · Pidex Desktop`
  }, [routeLabel])
  const visibleRightDockState = useMemo(
    () => ({
      ...rightDockState,
      open: workspaceLayout !== 'chat',
    }),
    [rightDockState, workspaceLayout],
  )
  const lastErrorRef = useRef<{ message: string; timestamp: number } | null>(null)
  const handleErrorMessage = useCallback((raw: unknown): void => {
    if (!raw) {
      setErrorMessage(null)
      return
    }
    const message = toUserErrorMessage(raw)
    const now = Date.now()
    if (
      lastErrorRef.current &&
      lastErrorRef.current.message === message &&
      now - lastErrorRef.current.timestamp < 1000
    ) {
      return
    }
    lastErrorRef.current = { message, timestamp: now }
    setErrorMessage(message)
  }, [])
  const [titleLoadingIds, regenerateSessionTitle] = useSessionTitleRegeneration()
  const {
    workspace,
    unavailableWorkspacePaths,
    setUnavailableWorkspacePaths,
    removedWorkspaces,
    setRemovedWorkspaces,
    lastActiveWorkspacePath,
    setLastActiveWorkspacePath,
    clearWorkspaceRemoved,
    clearWorkspaceUnavailable,
  } = useWorkbenchWorkspaceController({
    initialLastActiveWorkspacePath: settings.values.lastActiveWorkspacePath ?? '',
    initialRemovedWorkspaces: settings.values.removedWorkspaces ?? [],
    settings,
    onError: handleErrorMessage,
  })
  const {
    workspace: currentWorkspace,
    files: workspaceFiles,
    selectedFile,
    runtimeStatus,
    setActiveSessionId,
    refreshWorkspace,
    chooseWorkspace,
    openRecentWorkspace,
    setSelectedFile,
    setWorkspace: setWorkspaceState,
    setDiff: setDiffState,
    gitStatus,
  } = workspace
  const gitDetection = workspace.gitDetection

  const derivedDefaultBranch = useMemo(() => {
    if (!gitStatus?.upstream) return null
    const upstream = gitStatus.upstream
    const lastSlash = upstream.lastIndexOf('/')
    return lastSlash >= 0 ? upstream.slice(lastSlash + 1) : upstream
  }, [gitStatus?.upstream])
  const [homePlanModeActive, setHomePlanModeActive] = useState(false)
  const [homeGrillModeActive, setHomeGrillModeActive] = useState(false)
  const [homeLocalRouterMode, setHomeLocalRouterMode] = useState<'off'>('off')

  const session = useSessionState({
    permissionMode,
    permissionConfig: settings.values.permissionConfig,
    planModeActive: homePlanModeActive,
    grillModeActive: homeGrillModeActive,
    localRouterMode: homeLocalRouterMode,
    providerID: defaultProviderID,
    providerBaseURL,
    model: settingsModel,
    sessionName,
    thinkingMode: defaultThinkingMode,
    systemPrompt,
    appendSystemPrompt,
    additionalDirectories,
    installPidexDependencies,
    enableMemory,
    rustSearchAndDiffKernels,
    onError: handleErrorMessage,
    onDiffForActive: (patch: string) => setDiffState(patch),
    onRefreshActiveWorkspace: (sessionId: string) => {
      const target = session.sessionId === sessionId ? currentWorkspace : null
      if (!target) return
      void refreshWorkspace(target, {
        clearSelectedFile: false,
        expectedSessionId: sessionId,
        force: true,
      })
    },
    onOpenDrawerPermissions: () => setDrawerTab('permissions'),
  })
  const {
    sessionId,
    sessionsHydrated,
    catalogStatus,
    sessions,
    sessionFallbackTitles,
    sessionStatus,
    events,
    workflowEvents,
    messages,
    contextUsage,
    queuedFollowUps,
    queuePauseReason,
    pendingPermissionSessionIds,
    inputBinding,
    composerAttachments,
    setComposerAttachments,
    appendComposerAttachmentsForDraft,
    removeComposerAttachmentForDraft,
    clearComposerDraftIfUnchanged,
    activateSessionById,
    createSessionForWorkspace,
    submitToSession,
    interrupt,
    decidePermission,
    archiveSessions,
    renameSession,
    setSessionPermissionMode,
    setSessionPlanModeActive,
    setSessionGrillModeActive,
    activeSessionItem,
    permissionMode: effectivePermissionMode,
    planModeActive,
    grillModeActive,
  } = session
  // 侧栏聊天列表只用于 Git 看板的项目活跃度排序，看板不额外请求聊天历史。
  const { registerActivitySessions } = useGitBoard(
    useShallow((state) => ({ registerActivitySessions: state.registerActivitySessions })),
  )
  useEffect(() => {
    registerActivitySessions(sessions)
  }, [registerActivitySessions, sessions])

  const effectiveRightDockVisible =
    (isHomeOrConversationRoute && rightDockVisible) || visibleProviderTab !== null
  const effectiveBottomPanelVisible = isHomeOrConversationRoute && bottomPanelVisible

  const { terminalAvailable, terminalVisible, toggleIntegratedTerminal } =
    useIntegratedTerminalController({
      threadId: sessionId,
      state: workbenchPanelState,
      openPanelTab,
      movePanelTab,
      togglePanel,
      enabled: isHomeOrConversationRoute,
    })
  const toggleSidebarCollapsed = useCallback((): void => {
    if (activeSidebarPane === null) {
      navigate(QUICK_CHAT_PATH)
      sidebarShell.pin()
      return
    }
    toggleSidebarPanel()
  }, [activeSidebarPane, navigate, sidebarShell.pin, toggleSidebarPanel])
  useEffect(() => {
    const bridge = window.DesktopBridge
    if (!bridge) return
    if (
      settingsLoaded &&
      settings.values.pet.enabled &&
      typeof bridge.openPetOverlay === 'function'
    ) {
      void bridge.openPetOverlay()
    }
    if (typeof bridge.onPetOpenSession !== 'function') return
    return bridge.onPetOpenSession((threadId) => {
      navigate(sessionPath(threadId))
    })
  }, [navigate, settings.values.pet.enabled, settingsLoaded])
  useEffect(() => {
    const bridge = window.DesktopBridge
    if (typeof bridge?.onDesktopNotificationActivated !== 'function') return
    return bridge.onDesktopNotificationActivated((activation) => {
      // 点击已解决的权限通知只打开任务，不直接执行授权；页面会重新读取
      // pending interaction，避免对失效请求提交响应。
      if (activation.taskId)
        navigate(
          `/automations?taskId=${encodeURIComponent(activation.taskId)}${activation.occurrenceId ? `&occurrenceId=${encodeURIComponent(activation.occurrenceId)}` : ''}`,
        )
      else if (activation.threadId) navigate(sessionPath(activation.threadId))
    })
  }, [navigate])
  useEffect(() => {
    const bridge = window.DesktopBridge
    if (typeof bridge?.onThreadDeepLinkActivated !== 'function') return
    if (typeof bridge?.consumePendingThreadDeepLink !== 'function') return
    let mounted = true
    const openThread = (payload: { threadId: string }): void => {
      navigate(sessionPath(payload.threadId))
    }
    const unsubscribe = bridge.onThreadDeepLinkActivated(openThread)
    // 先订阅再消费，避免挂载期间到达的深链在订阅/消费间隙丢失。
    void bridge
      .consumePendingThreadDeepLink()
      .then((payload) => {
        if (!mounted || payload === null) return
        openThread(payload)
      })
      .catch(() => {
        window.dispatchEvent(
          new CustomEvent('desktop:error', {
            detail: '无法打开会话深链，请重试。',
          }),
        )
      })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [navigate])
  useEffect(() => {
    const handleMarkdownThreadNavigation = (event: Event): void => {
      const detail = (event as CustomEvent<{ threadId?: unknown }>).detail
      if (!detail || typeof detail !== 'object') return
      const threadId = (detail as { threadId?: unknown }).threadId
      if (typeof threadId !== 'string' || threadId.trim() === '') return
      navigate(sessionPath(threadId))
    }
    window.addEventListener(MARKDOWN_THREAD_NAVIGATION_EVENT, handleMarkdownThreadNavigation)
    return () =>
      window.removeEventListener(MARKDOWN_THREAD_NAVIGATION_EVENT, handleMarkdownThreadNavigation)
  }, [navigate])
  const mainComposerDraftKey: ComposerDraftKey = routedSessionId
    ? `session:${routedSessionId}`
    : 'home'
  const lastWorkspaceRestoreAttemptedRef = useRef(false)
  const conversationSwitchTargetRef = useRef<string | null>(null)
  const beginConversationSwitch = useCallback((targetSessionId: string) => {
    if (conversationSwitchTargetRef.current === targetSessionId) return
    conversationSwitchTargetRef.current = targetSessionId
  }, [])

  useEffect(() => {
    if (!settingsLoaded) return
    setRemovedWorkspaces(settings.values.removedWorkspaces)
    setLastActiveWorkspacePath(settings.values.lastActiveWorkspacePath)
  }, [settings.values.lastActiveWorkspacePath, settings.values.removedWorkspaces, settingsLoaded])

  useEffect(() => {
    setActiveSessionId(sessionId)
  }, [sessionId, setActiveSessionId])

  useLayoutEffect(() => {
    if (!sessionsHydrated) return
    if (!routedSessionId) {
      activateSessionById(null)
      return
    }

    const routedSession = sessions.find((item) => item.id === routedSessionId)
    if (!routedSession) {
      activateSessionById(null)
      setWorkspaceState(null)
      setDiffState('未选择项目。')
      setSelectedFile(null)
      setErrorMessage(`找不到对话：${routedSessionId}`)
      navigate(QUICK_CHAT_PATH, { replace: true })
      return
    }

    if (routedSession.archivedAt) {
      activateSessionById(null)
      setWorkspaceState(null)
      setDiffState(NO_WORKSPACE_DIFF)
      setSelectedFile(null)
      navigate(QUICK_CHAT_PATH, { replace: true })
      return
    }

    if (sessionId === routedSessionId) {
      conversationSwitchTargetRef.current = null
      return
    }

    beginConversationSwitch(routedSessionId)
    const nextWorkspace = activateSessionById(routedSessionId)
    if (!nextWorkspace) {
      setWorkspaceState(null)
      setDiffState('未选择项目。')
      setSelectedFile(null)
      return
    }
    setWorkspaceState(nextWorkspace)
    void refreshWorkspace(nextWorkspace, {
      expectedSessionId: routedSessionId,
    })
  }, [
    activateSessionById,
    beginConversationSwitch,
    navigate,
    refreshWorkspace,
    routedSessionId,
    sessionId,
    sessions,
    sessionsHydrated,
    setDiffState,
    setSelectedFile,
    setWorkspaceState,
  ])

  const handleChooseWorkspace = useCallback(async (): Promise<DesktopWorkspace | null> => {
    const selected = await chooseWorkspace()
    if (!selected) return null
    clearWorkspaceUnavailable(selected)
    clearWorkspaceRemoved(selected)
    navigate(QUICK_CHAT_PATH)
    setWorkspaceState(selected)
    setLastActiveWorkspacePath(selected.path)
    settings.syncExternalSettingsPatch({ lastActiveWorkspacePath: selected.path })
    await refreshWorkspace(selected, { force: true })
    return selected
  }, [
    chooseWorkspace,
    clearWorkspaceUnavailable,
    clearWorkspaceRemoved,
    navigate,
    refreshWorkspace,
    setWorkspaceState,
    settings,
  ])

  const handleOpenRecentWorkspace = useCallback(
    async (target: DesktopWorkspace): Promise<DesktopWorkspace | null> => {
      if (unavailableWorkspacePaths.has(target.path)) return null
      const selected = await openRecentWorkspace(target)
      if (!selected) return null
      clearWorkspaceUnavailable(selected)
      clearWorkspaceRemoved(selected)
      navigate(QUICK_CHAT_PATH)
      setWorkspaceState(selected)
      setLastActiveWorkspacePath(selected.path)
      settings.syncExternalSettingsPatch({ lastActiveWorkspacePath: selected.path })
      await refreshWorkspace(selected, { force: true })
      return selected
    },
    [
      clearWorkspaceUnavailable,
      clearWorkspaceRemoved,
      navigate,
      openRecentWorkspace,
      refreshWorkspace,
      setWorkspaceState,
      unavailableWorkspacePaths,
      settings,
    ],
  )

  const handleClearWorkspace = useCallback((): void => {
    navigate(QUICK_CHAT_PATH)
    activateSessionById(null)
    setWorkspaceState(null)
    setDiffState(NO_WORKSPACE_DIFF)
    setSelectedFile(null)
    inputBinding.replace('')
    setComposerAttachments([])
  }, [activateSessionById, inputBinding, navigate, setDiffState, setSelectedFile, setWorkspaceState])

  const handleGithubWorkspaceCloned = useCallback(
    (selected: DesktopWorkspace): void => {
      notifyProjectCatalogChanged()
      navigate(QUICK_CHAT_PATH)
      setWorkspaceState(selected)
      setLastActiveWorkspacePath(selected.path)
      settings.syncExternalSettingsPatch({ lastActiveWorkspacePath: selected.path })
      void refreshWorkspace(selected, { force: true })
    },
    [navigate, refreshWorkspace, setWorkspaceState, settings],
  )

  useEffect(() => {
    if (
      !shouldRestoreLastWorkspace({
        settingsLoaded,
        isQuickChatPage,
        hasCurrentWorkspace: Boolean(currentWorkspace),
        hasAttemptedRestore: lastWorkspaceRestoreAttemptedRef.current,
        hasLastActiveWorkspacePath: Boolean(lastActiveWorkspacePath),
      })
    ) {
      return
    }
    const lastWorkspace =
      recentWorkspaces.find((w) => w.path === lastActiveWorkspacePath) ?? recentWorkspaces[0]
    if (!lastWorkspace) return
    lastWorkspaceRestoreAttemptedRef.current = true
    void handleOpenRecentWorkspace(lastWorkspace)
  }, [
    currentWorkspace,
    handleOpenRecentWorkspace,
    isQuickChatPage,
    lastActiveWorkspacePath,
    recentWorkspaces,
    settingsLoaded,
  ])

  const handleCreateSession = useCallback(
    async (target?: DesktopWorkspace | null): Promise<void> => {
      if (target === null) {
        navigate(QUICK_CHAT_PATH)
        activateSessionById(null)
        setWorkspaceState(null)
        setDiffState('未选择项目。')
        setSelectedFile(null)
        inputBinding.replace('')
        setComposerAttachments([])
        return
      }
      const targetWorkspace = target === undefined ? currentWorkspace : target
      if (targetWorkspace && targetWorkspace.path !== currentWorkspace?.path) {
        const selected = await handleOpenRecentWorkspace(targetWorkspace)
        if (!selected) return
      } else {
        navigate(QUICK_CHAT_PATH)
      }
      activateSessionById(null)
      inputBinding.replace('')
      setComposerAttachments([])
    },
    [
      activateSessionById,
      currentWorkspace,
      handleOpenRecentWorkspace,
      inputBinding,
      navigate,
      setDiffState,
      setSelectedFile,
      setWorkspaceState,
    ],
  )

  const handleBranchSelect = useCallback(
    async (branch: string): Promise<void> => {
      if (!currentWorkspace || currentWorkspace.branchName === branch) {
        return
      }
      try {
        const nextWorkspace = await desktopClient.checkoutWorkspaceBranch(
          currentWorkspace.path,
          branch,
          currentWorkspace.projectId,
        )
        setWorkspaceState(nextWorkspace)
        await refreshWorkspace(nextWorkspace, {
          clearSelectedFile: true,
          force: true,
        })
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error ?? '无法切换分支'))
      }
    },
    [currentWorkspace, refreshWorkspace, setWorkspaceState],
  )

  const handleWorkspaceChanged = useCallback(
    async (nextWorkspace: DesktopWorkspace): Promise<void> => {
      setWorkspaceState(nextWorkspace)
      await refreshWorkspace(nextWorkspace, {
        clearSelectedFile: true,
        force: true,
      })
    },
    [refreshWorkspace, setWorkspaceState],
  )

  const handleOpenWorkspacePath = useCallback((): void => {
    if (!currentWorkspace) return
    void desktopClient
      .openPathWithDefaultTarget(currentWorkspace.path)
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)))
  }, [currentWorkspace])

  const handleRefreshDiff = useCallback((): void => {
    if (!currentWorkspace) return
    void refreshWorkspace(currentWorkspace, {
      clearSelectedFile: false,
      force: true,
      refreshGitStatus: true,
    })
  }, [currentWorkspace, refreshWorkspace])

  const handleCreateBranch = useCallback((): void => {
    setGitWorkflowMode('branch')
  }, [])

  const handleCommitOrPush = useCallback((): void => {
    setGitWorkflowMode('commitPush')
  }, [])

  const handleCreatePullRequest = useCallback((): void => {
    setGitWorkflowMode('pullRequest')
  }, [])

  const handleOpenBrowser = useCallback((): void => {
    if (browserAvailability !== 'available') {
      setErrorMessage('当前桌面运行环境没有提供内置浏览器能力。')
      return
    }
    void desktopBrowserClient
      .createTab(sessionId)
      .then((next) => {
        if (!next.tabId) return
        setBrowserState(next)
        openRightDockTab({
          id: `browser:${next.tabId}`,
          kind: 'browser',
          tabId: next.tabId,
          title: next.title,
        })
      })
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)))
  }, [openRightDockTab, sessionId])

  const handleOpenFilesDock = useCallback((): void => {
    openRightDockTab({ id: 'file-browser', kind: 'file-browser' })
  }, [openRightDockTab])

  /** 激活既有内置浏览器标签所在的面板，不新建标签。 */
  const handleActivateBrowserTab = useCallback(
    (tabId: string): void => {
      if (!browserAvailable) return
      const record = desktopBrowserClient.getTab(tabId)
      if (!record?.open) return
      openRightDockTab({ id: `browser:${tabId}`, kind: 'browser', tabId, title: record.title })
    },
    [browserAvailable, openRightDockTab],
  )

  const handleOpenArtifact = useCallback(
    (artifact: ThreadArtifactPreviewInput): void => {
      if (!sessionId) return
      void import('../../session/attachments/AttachmentPreviewDescriptor.js').then(
        ({ createThreadArtifactPreviewTab }) => {
          openRightDockTab(createThreadArtifactPreviewTab(sessionId, artifact))
        },
      )
    },
    [openRightDockTab, sessionId],
  )

  const handleSetGoalStatus = useCallback(
    (status: 'active' | 'paused' | 'complete'): void => {
      if (!sessionId) return
      desktopClient
        .setSessionGoal(sessionId, { status })
        .catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)))
    },
    [sessionId],
  )

  const handleGoalPause = useCallback((): void => {
    handleSetGoalStatus('paused')
  }, [handleSetGoalStatus])

  const handleGoalResume = useCallback((): void => {
    handleSetGoalStatus('active')
  }, [handleSetGoalStatus])

  const handleGoalComplete = useCallback((): void => {
    handleSetGoalStatus('complete')
  }, [handleSetGoalStatus])

  const handleGoalClear = useCallback((): void => {
    if (!sessionId) return
    desktopClient
      .clearSessionGoal(sessionId)
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)))
  }, [sessionId])

  const handleOpenThreadAttachment = useCallback(
    (attachment: Attachment): void => {
      void import('../../session/attachments/AttachmentPreviewDescriptor.js').then(
        ({ createThreadAttachmentPreviewTab }) => {
          const tab = createThreadAttachmentPreviewTab(attachment)
          if (tab) openRightDockTab(tab)
        },
      )
    },
    [openRightDockTab],
  )

  const handleOpenDraftAttachment = useCallback(
    (attachment: DesktopComposerAttachment): void => {
      void import('../../session/attachments/AttachmentPreviewDescriptor.js').then(
        ({ createDraftAttachmentPreviewTab }) => {
          const tab = createDraftAttachmentPreviewTab(attachment)
          if (tab) openRightDockTab(tab)
        },
      )
    },
    [openRightDockTab],
  )

  const handleOpenThreadLocalContext = useCallback(
    (reference: LocalContextReference): void => {
      if (!sessionId) return
      void import('../../session/attachments/AttachmentPreviewDescriptor.js').then(
        ({ createThreadLocalContextPreviewTab }) => {
          openRightDockTab(createThreadLocalContextPreviewTab(sessionId, reference))
        },
      )
    },
    [openRightDockTab, sessionId],
  )

  const handleOpenReview = useCallback((): void => {
    if (bottomPanelState.tabIds.includes('review')) {
      movePanelTab('bottom', 'right', 'review')
      return
    }
    openRightDockTab({ id: 'review', kind: 'review' })
  }, [bottomPanelState.tabIds, movePanelTab, openRightDockTab])

  const handleOpenPatchReview = useCallback(
    (path?: string): void => {
      setReviewTabState((current) => openPatchReviewTabState(current, path))
      handleOpenReview()
      handleRefreshDiff()
    },
    [handleOpenReview, handleRefreshDiff],
  )

  const handleStartAiReview = useCallback(
    async (
      target: { type: 'uncommittedChanges' } | { type: 'baseBranch'; branch: string },
    ): Promise<void> => {
      if (!sessionId) {
        setErrorMessage('请先打开一个任务，再发起代码审查。')
        return
      }
      try {
        const result = await desktopClient.startSessionReview(sessionId, target)
        setReviewTabState((current) => ({
          ...current,
          source: result.source,
          selectedFile: null,
          selectedCommentId: null,
          scrollTop: 0,
          diffExpansion: { mode: 'all' },
        }))
        openRightDockTab({ id: 'review', kind: 'review' })
        if (result.delivery === 'detached' && result.threadId !== sessionId) {
          const detachedState = createDefaultConversationUiState()
          detachedState.workbench = applyWorkbenchPanelAction(detachedState.workbench, {
            type: 'openTab',
            target: 'right',
            tab: { id: 'review', kind: 'review' },
          })
          detachedState.review = {
            ...detachedState.review,
            source: result.source,
          }
          saveConversationUiState(result.threadId, detachedState)
          navigate(sessionPath(result.threadId))
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [navigate, openRightDockTab, sessionId],
  )

  const handleReloadBrowser = useCallback((): void => {
    void desktopBrowserClient
      .reloadBrowser()
      .then(setBrowserState)
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)))
  }, [])

  const handleAppendComposerText = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (!trimmed) return
      const current = inputBinding.store.getState().input
      const separator = current.trim() ? '\n\n' : ''
      inputBinding.replace(`${current}${separator}${trimmed}`)
    },
    [inputBinding],
  )

  const activeSideTaskId = useMemo(() => {
    const preferredTarget = workbenchPanelState.focusArea === 'bottom-panel' ? 'bottom' : 'right'
    const fallbackTarget = preferredTarget === 'right' ? 'bottom' : 'right'
    for (const target of [preferredTarget, fallbackTarget] as const) {
      const panel = workbenchPanelState[target]
      if (!panel.open || !panel.activeTabId) continue
      const tab = workbenchPanelState.tabsById[panel.activeTabId]
      if (tab?.kind === 'side-task') return tab.taskId
    }
    return null
  }, [workbenchPanelState])

  const activeSideChatTab = useMemo(() => {
    const preferredTarget = workbenchPanelState.focusArea === 'bottom-panel' ? 'bottom' : 'right'
    const fallbackTarget = preferredTarget === 'right' ? 'bottom' : 'right'
    for (const target of [preferredTarget, fallbackTarget] as const) {
      const panel = workbenchPanelState[target]
      if (!panel.open || !panel.activeTabId) continue
      const tab = workbenchPanelState.tabsById[panel.activeTabId]
      if (tab?.kind === 'side-chat') return tab
    }
    return null
  }, [workbenchPanelState])

  const replaceSideChatWorkbenchTab = useCallback(
    (previousTabId: WorkbenchTabId, tab: WorkbenchTabDescriptor): void => {
      setWorkbenchPanelState((current) =>
        applyWorkbenchPanelAction(current, {
          type: 'replaceTab',
          previousTabId,
          tab,
        }),
      )
    },
    [setWorkbenchPanelState],
  )

  const removeSideChatWorkbenchTab = useCallback(
    (tabId: WorkbenchTabId): void => {
      setWorkbenchPanelState((current) => {
        const target = current.right.tabIds.includes(tabId)
          ? 'right'
          : current.bottom.tabIds.includes(tabId)
            ? 'bottom'
            : null
        return target
          ? applyWorkbenchPanelAction(current, { type: 'closeTab', target, tabId })
          : current
      })
    },
    [setWorkbenchPanelState],
  )

  const initialSideChatSettings = useMemo(
    () => ({
      permissionMode: effectivePermissionMode,
      planModeActive,
      providerID: session.modelSelection?.providerID ?? '',
      model: session.modelSelection?.model ?? '',
      selectedModelPreset: 'custom',
      thinkingMode: session.modelSelection?.thinkingMode ?? 'default',
      variant: session.modelSelection?.variant,
    }),
    [effectivePermissionMode, planModeActive, session.modelSelection],
  )

  const {
    sideChatInput,
    setSideChatInput,
    sideChatFocusVersion,
    sideChatSupported,
    sideChatAttachments,
    setSideChatAttachments,
    handleAppendSideChatText,
    sideChatSubmitToSession,
    createSideChat,
    sideChatTabsForSource,
    requestCloseSideChatTabs,
    reportSideChatState,
    getSideChatSettings,
    isSideChatModelLoading,
    getSideChatModelError,
    reloadSideChatModel,
    updateSideChatSettings,
    isCreatingSideChat,
    closeConfirmationOpen,
    skipCloseConfirmation,
    setSkipCloseConfirmation,
    confirmSideChatClose,
    cancelSideChatClose,
    appendSideComposerAttachmentsForDraft,
    removeSideComposerAttachmentForDraft,
    clearSideComposerDraftIfUnchanged,
  } = useSideChatController({
    activeTab: activeSideChatTab,
    initialSettings: initialSideChatSettings,
    sourceThreadId: activeSessionItem?.id ?? null,
    openRightDockTab,
    removeWorkbenchTab: removeSideChatWorkbenchTab,
    replaceWorkbenchTab: replaceSideChatWorkbenchTab,
    onError: handleErrorMessage,
  })
  const handleBrowserImage = useCallback(
    (image: { data: string; mimeType: 'image/png' }): void => {
      const attachment: DesktopComposerAttachment = {
        id: crypto.randomUUID(),
        name: '网页截图.png',
        path: '',
        mediaType: image.mimeType,
        sizeBytes: atob(image.data).length,
        kind: 'image',
        status: 'ready',
        storage: 'managed',
        contentBase64: image.data,
        previewDataUrl: `data:${image.mimeType};base64,${image.data}`,
      }
      const { accepted, error } = mergeComposerAttachments(
        composerDraftStore.get(mainComposerDraftKey).attachments,
        [attachment],
      )
      if (error) throw new Error(error)
      appendComposerAttachmentsForDraft(mainComposerDraftKey, accepted)
    },
    [appendComposerAttachmentsForDraft, mainComposerDraftKey],
  )
  const closeConfirmationDialogMounted = useEverOpened(closeConfirmationOpen)
  const handleOpenSideChat = useCallback((): void => {
    void createSideChat()
  }, [createSideChat])
  const {
    selectedSubagentTaskId,
    selectedSubagent,
    selectedSubagentError,
    subagentAvailability,
    refreshSelectedSubagent,
    handleOpenSubagent,
  } = useSubagentDockController({
    activeSideTaskId,
    openRightDockTab,
    onError: handleErrorMessage,
  })

  const handleCloseSubagentTab = useCallback(
    (taskId: string): void => {
      const tabId = `side-task:${taskId}` as const
      const target: WorkbenchPanelTarget = workbenchPanelState.right.tabIds.includes(tabId)
        ? 'right'
        : workbenchPanelState.bottom.tabIds.includes(tabId)
          ? 'bottom'
          : null
      if (!target) return
      closePanelTab(target, tabId)
      closePanel(target)
    },
    [closePanel, closePanelTab, workbenchPanelState],
  )

  const handleSubmitEditedUserMessage = useCallback(
    async (
      input: DesktopUserMessageInput,
      target: { turnId: string; inputId: string; operationId: string },
    ): Promise<void> => {
      if (!activeSessionItem || !desktopClient.editUserMessage)
        throw new Error('当前会话不支持修改消息')
      await desktopClient.editUserMessage(activeSessionItem.id, target, input)
    },
    [activeSessionItem],
  )

  const handleAddComposerFiles = useCallback((filePaths: string[]): void => {
    if (filePaths.length === 0) return
    const targetDraftKey = mainComposerDraftKey
    void desktopClient
      .grantComposerFilePaths(filePaths)
      .then((nextAttachments) => {
        if (nextAttachments.length === 0) return
        appendComposerAttachmentsForDraft(targetDraftKey, nextAttachments)
      })
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)))
  }, [])

  const handleNewConversation = useCallback(async (): Promise<void> => {
    activateSessionById(null)
    inputBinding.replace('')
    setComposerAttachments([])
    navigate(QUICK_CHAT_PATH)
  }, [activateSessionById, inputBinding, navigate, setComposerAttachments])

  const handleUseSkill = useCallback(
    (skill: DesktopInstalledSkill): void => {
      activateSessionById(null)
      inputBinding.replace('')
      setComposerAttachments([])
      composerDraftStore.setSkillInvocation('home', {
        name: skill.name,
        path: skill.path,
      })
      navigate(QUICK_CHAT_PATH)
    },
    [activateSessionById, inputBinding, navigate, setComposerAttachments],
  )

  const handleOpenSkillPreview = useCallback(
    (skill: DesktopInstalledSkill): void => {
      if (skill.path.startsWith('builtin://')) return
      openRightDockTab(
        createSkillPreviewTab({
          name: skill.name,
          path: skill.path,
          workspacePath: currentWorkspace?.path ?? null,
        }),
      )
    },
    [currentWorkspace?.path, openRightDockTab],
  )

  const handleActivateComposerSkill = useCallback(
    async (invocation: { name: string; path: string }): Promise<void> => {
      try {
        const result = await listRuntimeSkills(currentWorkspace?.path ?? null, true)
        if (result.state === 'unavailable') {
          setErrorMessage('无法读取技能信息，请稍后重试。')
          return
        }
        const skill = result.data.find((candidate) => candidate.path === invocation.path)
        if (!skill || !skill.enabled) {
          setErrorMessage('该技能已不可用，请重新选择。')
          return
        }
        if (isBuiltinSkill(skill)) {
          const source = `${location.pathname}${location.search}${location.hash}`
          navigate(
            `/settings/plugins?tab=skills&skill=${encodeURIComponent(skill.path)}&from=${encodeURIComponent(source)}`,
          )
          return
        }
        handleOpenSkillPreview(skill)
      } catch {
        setErrorMessage('无法读取技能信息，请稍后重试。')
      }
    },
    [
      currentWorkspace?.path,
      handleOpenSkillPreview,
      location.hash,
      location.pathname,
      location.search,
      navigate,
    ],
  )

  const outletContext = useMemo<DesktopLayoutOutletContextValue>(
    () => ({
      workspacePath: currentWorkspace?.path ?? null,
      useSkill: handleUseSkill,
      openSkillPreview: handleOpenSkillPreview,
      providerManagement: {
        tab: visibleProviderTab,
        host: providerManagementHost,
        open: openProviderManagement,
        close: closeProviderManagement,
        beforeChange: providerBeforeChange,
        claimProvider: setProviderManagementOwner,
      },
    }),
    [
      currentWorkspace?.path,
      handleOpenSkillPreview,
      handleUseSkill,
      visibleProviderTab?.providerId,
      visibleProviderTab?.section,
      providerManagementHost,
      openProviderManagement,
      closeProviderManagement,
    ],
  )

  useDesktopCommands({
    onNewConversation: () => {
      void handleNewConversation()
    },
    onChooseWorkspace: () => {
      void handleChooseWorkspace()
    },
    onRefreshWorkspace: () => {
      void refreshWorkspace(undefined, { force: true, refreshGitStatus: true })
    },
    onOpenSettings: () => {
      navigate('/settings/general')
    },
    onLogOut: () => {
      setErrorMessage('已退出登录。本地桌面端暂无持久账号切换，请重启应用。')
    },
  })

  const prevSessionIdRef = useRef<string | null>(null)
  const hasInitializedSessionSwitchRef = useRef(false)
  const attachmentPreviewTabRef = useRef<UserAttachmentPreviewTab | null>(null)
  const [publishedReviewSummary, setPublishedReviewSummary] = useState<{
    workspacePath: string | null
    snapshot: import('../../review/source/ReviewAgentClient.js').ReviewSummarySnapshot | null
  } | null>(null)
  const handleReviewSummaryChange = useCallback(
    (snapshot: import('../../review/source/ReviewAgentClient.js').ReviewSummarySnapshot | null) => {
      setPublishedReviewSummary({ workspacePath: currentWorkspace?.path ?? null, snapshot })
    },
    [currentWorkspace?.path],
  )
  const [reviewTabState, setReviewTabState] = useState<ReviewTabUiState>(
    createDefaultReviewTabUiState,
  )
  const uiSnapshotRef = useRef<ConversationUiState>(createDefaultConversationUiState())
  const restoredConversationUiIdentityRef = useRef<string | null>(null)
  const currentWorkspaceUiIdentity = currentWorkspace
    ? [
        currentWorkspace.projectId ?? '',
        ...(currentWorkspace.folders && currentWorkspace.folders.length > 0
          ? currentWorkspace.folders.map(
              (folder) => `${folder.id}:${folder.path.replace(/\\/g, '/').toLowerCase()}`,
            )
          : [currentWorkspace.path.replace(/\\/g, '/').toLowerCase()]),
      ].join('\u0000')
    : ''
  const sideChatPanelTargetsRef = useRef(new Map<WorkbenchTabId, WorkbenchPanelTarget>())
  uiSnapshotRef.current = {
    schemaVersion: 4,
    workbench: workbenchPanelState,
    mainScrollTop: uiSnapshotRef.current.mainScrollTop,
    sideChatInput: '',
    sideChatAttachments: [],
    review: reviewTabState,
  }
  const currentAttachmentPreview = workbenchPanelState.tabsById['user-attachment-preview']
  if (currentAttachmentPreview?.kind === 'attachment-preview') {
    attachmentPreviewTabRef.current = currentAttachmentPreview
  } else if (prevSessionIdRef.current === sessionId) {
    attachmentPreviewTabRef.current = null
  }

  useEffect(() => {
    const prevId = prevSessionIdRef.current
    const currentId = sessionId
    for (const target of ['right', 'bottom'] as const) {
      for (const tabId of uiSnapshotRef.current.workbench[target].tabIds) {
        if (uiSnapshotRef.current.workbench.tabsById[tabId]?.kind === 'side-chat') {
          sideChatPanelTargetsRef.current.set(tabId, target)
        }
      }
    }

    const prevKey = prevId ?? '__home__'
    const currentKey = currentId ?? '__home__'

    if (hasInitializedSessionSwitchRef.current && prevKey !== currentKey) {
      patchConversationUiState(prevKey, {
        workbench: uiSnapshotRef.current.workbench,
        sideChatInput: '',
        sideChatAttachments: [],
        review: uiSnapshotRef.current.review,
      })
    }
    hasInitializedSessionSwitchRef.current = true

    if (
      currentId &&
      activeSessionItem &&
      (!currentWorkspace ||
        (activeSessionItem.projectId && currentWorkspace.projectId !== activeSessionItem.projectId))
    ) {
      return
    }
    const restoreIdentity = `${currentId ?? ''}\u0000${currentWorkspaceUiIdentity}`
    if (restoredConversationUiIdentityRef.current === restoreIdentity) return
    restoredConversationUiIdentityRef.current = restoreIdentity

    prevSessionIdRef.current = currentId

    const restoreAttachmentPreview = (
      restored: ReturnType<typeof createDefaultWorkbenchTabsState>,
    ) => {
      const records = Object.values(uiSnapshotRef.current.workbench.tabsById).flatMap((tab) =>
        tab?.kind === 'browser'
          ? [desktopBrowserClient.getTab(tab.tabId)].filter(
              (record): record is DesktopBrowserState => record !== null,
            )
          : [],
      )
      const state = mergeBrowserWorkbench(restored, records, uiSnapshotRef.current.workbench)
      return attachmentPreviewTabRef.current
        ? applyWorkbenchPanelAction(state, {
            type: 'openTab',
            target: 'right',
            tab: attachmentPreviewTabRef.current,
            // 会话恢复不主动揭开用户隐藏的工作区。
            reveal: false,
          })
        : state
    }

    const saved = loadConversationUiState(currentKey)
    if (saved) {
      const fileScopes = currentWorkspace
        ? currentWorkspace.folders && currentWorkspace.folders.length > 0
          ? currentWorkspace.folders.map((folder) => ({
              projectId: currentWorkspace.projectId,
              folderId: folder.id,
              workspacePath: folder.path,
            }))
          : [
              {
                projectId: currentWorkspace.projectId,
                folderId: currentWorkspace.primaryFolderId,
                workspacePath: currentWorkspace.path,
              },
            ]
        : undefined
      const validated = validateConversationUiState(saved, { fileScopes })
      setWorkbenchPanelState(restoreAttachmentPreview(validated.workbench))
      setReviewTabState(validated.review)
    } else {
      /* No saved state — force defaults */
      setWorkbenchPanelState(restoreAttachmentPreview(createDefaultWorkbenchTabsState()))
      setReviewTabState(createDefaultReviewTabUiState())
    }
  }, [activeSessionItem, currentWorkspace, currentWorkspaceUiIdentity, sessionId])

  useEffect(() => {
    desktopBrowserClient.setContext(sessionId)
    if (!desktopBrowserClient.available) return
    const synchronize = (tabs: DesktopBrowserState[]) => {
      setWorkbenchPanelState((current) => mergeBrowserWorkbench(current, tabs))
    }
    const unsubscribe = desktopBrowserClient.onTabsChange(synchronize)
    void desktopBrowserClient
      .listTabs()
      .then(synchronize)
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)))
    return unsubscribe
  }, [sessionId, setWorkbenchPanelState])

  useEffect(() => {
    if (!sessionId || sideChatTabsForSource.length === 0) return
    setWorkbenchPanelState((current) => {
      let next = current
      for (const tab of sideChatTabsForSource) {
        next = applyWorkbenchPanelAction(next, {
          type: 'openTab',
          target: sideChatPanelTargetsRef.current.get(tab.id) ?? 'right',
          tab,
          // 侧边聊天重新挂接保持当前显隐，不额外揭开右工作区。
          reveal: false,
        })
      }
      return next
    })
  }, [sessionId, sideChatTabsForSource])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent): void => {
      const currentSessionId = sessionId ?? '__home__'
      patchConversationUiState(currentSessionId, {
        workbench: uiSnapshotRef.current.workbench,
        sideChatInput: '',
        sideChatAttachments: [],
        review: uiSnapshotRef.current.review,
      })
      if (hasDirtyFileDocuments()) {
        void saveAllFileDocuments()
        event.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [sessionId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.metaKey || event.repeat) return
      const key = event.key.toLowerCase()
      const commandShortcutAllowed =
        !event.defaultPrevented &&
        !event.isComposing &&
        event.keyCode !== 229 &&
        !event.altKey &&
        (commandMenuOpen || !hasOpenDialog())
      if (
        isHomeOrConversationRoute &&
        commandShortcutAllowed &&
        !event.shiftKey &&
        !event.altKey &&
        event.code === 'Backquote'
      ) {
        event.preventDefault()
        toggleIntegratedTerminal()
        return
      }
      if (
        isTerminalKeyboardTarget(event.target) &&
        !(
          commandShortcutAllowed &&
          ((!event.shiftKey && key === 'k') || (event.shiftKey && key === 'p'))
        )
      )
        return
      if (
        commandShortcutAllowed &&
        ((!event.shiftKey && key === 'k') || (event.shiftKey && key === 'p'))
      ) {
        event.preventDefault()
        if (commandMenuOpen) {
          commandMenuInputRef.current?.focus()
          commandMenuInputRef.current?.select()
        } else {
          setCommandMenuOpen(true)
        }
      } else if (
        isHomeOrConversationRoute &&
        commandShortcutAllowed &&
        !event.shiftKey &&
        key === 'p' &&
        currentWorkspace !== null
      ) {
        event.preventDefault()
        setCommandMenuOpen(false)
        handleOpenFilesDock()
      } else if (isHomeOrConversationRoute && event.shiftKey && !event.altKey && key === 'g') {
        event.preventDefault()
        handleOpenReview()
      } else if (isHomeOrConversationRoute && !event.shiftKey && event.altKey && key === 's') {
        event.preventDefault()
        handleOpenSideChat()
      } else if (
        !event.defaultPrevented &&
        !event.isComposing &&
        event.keyCode !== 229 &&
        !hasOpenDialog() &&
        !event.shiftKey &&
        event.altKey &&
        key === 'u'
      ) {
        event.preventDefault()
        setSidebarTimelineEnabled((current) => !current)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    commandMenuOpen,
    currentWorkspace,
    handleOpenFilesDock,
    handleOpenReview,
    handleOpenSideChat,
    isHomeOrConversationRoute,
    toggleIntegratedTerminal,
  ])

  useEffect(() => {
    const preventMouseNavigationDefault = (event: MouseEvent): void => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      event.stopPropagation()
    }
    const handleMouseNavigation = (event: MouseEvent): void => {
      preventMouseNavigationDefault(event)
      if (event.button === 3) {
        navigateBack()
      } else if (event.button === 4) {
        navigateForward()
      }
    }

    window.addEventListener('mousedown', preventMouseNavigationDefault, true)
    window.addEventListener('mouseup', handleMouseNavigation, true)
    window.addEventListener('auxclick', preventMouseNavigationDefault, true)
    return () => {
      window.removeEventListener('mousedown', preventMouseNavigationDefault, true)
      window.removeEventListener('mouseup', handleMouseNavigation, true)
      window.removeEventListener('auxclick', preventMouseNavigationDefault, true)
    }
  }, [navigateBack, navigateForward])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      const action = resolveSidebarEscapeAction({
        defaultPrevented: event.defaultPrevented,
        isDialogOpen: hasOpenDialog(),
        isSettingsRoute,
        isTextEntry: isTextEntryTarget(event.target),
        mode: sidebarShell.mode,
      })
      if (action === 'none') return
      event.preventDefault()
      handleSettingsBack()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSettingsBack, isSettingsRoute, sidebarShell.mode])

  const openWhatsNewDialog = useCallback((restoreFocusElement: HTMLElement | null): void => {
    setWhatsNewRestoreFocusElement(restoreFocusElement)
    setWhatsNewDialogOpen(true)
  }, [])

  const menuActions = useAppMenuActions(
    useMemo(
      () => ({
        client: desktopClient,
        bridge: window.DesktopBridge,
        browserAvailable,
        browserOpen: Boolean(browserState?.open),
        canNavigateBack,
        canNavigateForward,
        navigate,
        newChat: handleCreateSession,
        openFolder: handleChooseWorkspace,
        toggleSidebar: toggleSidebarCollapsed,
        togglePanel: isHomeOrConversationRoute ? togglePanel : () => undefined,
        stepWorkspaceLayout: isHomeOrConversationRoute ? stepWorkspaceLayout : () => undefined,
        openFiles: isHomeOrConversationRoute ? handleOpenFilesDock : () => undefined,
        openBrowser: isHomeOrConversationRoute ? handleOpenBrowser : () => undefined,
        reloadBrowser: handleReloadBrowser,
        navigateBack,
        navigateForward,
        setMaximized: setIsWindowMaximized,
        openWhatsNew: openWhatsNewDialog,
        onError: setErrorMessage,
      }),
      [
        browserAvailable,
        browserState?.open,
        canNavigateBack,
        canNavigateForward,
        navigate,
        handleCreateSession,
        handleChooseWorkspace,
        toggleSidebarCollapsed,
        isHomeOrConversationRoute,
        togglePanel,
        stepWorkspaceLayout,
        handleOpenFilesDock,
        handleOpenBrowser,
        handleReloadBrowser,
        navigateBack,
        navigateForward,
        setIsWindowMaximized,
        openWhatsNewDialog,
        setErrorMessage,
      ],
    ),
  )

  const {
    providerState,
    modelProviders,
    modelCatalogLoading,
    modelPresets,
    selectedProviderID,
    selectedProviderModelPresets,
    resolvedSelectedModelPreset,
    selectedModelMetadata,
    deepSeekThinkingControls,
    showThinkingOptions,
    modelConfigured,
    providerModelOptions,
    handleProviderModelChange,
    handleProviderOpen,
    handleProviderSearch,
    handleThinkingChange,
    selectedVariant,
    variantOptions,
    handleVariantChange,
    selectedModelUnavailableMessage,
    refreshProviderState,
  } = useModelProviderController({
    selection: session.modelSelection,
    onSelectionChange: session.setModelSelection,
    selectionLoading: session.modelSelectionLoading,
    sessionId,
    hasMessages: messages.length > 0,
    setErrorMessage,
    setNoticeMessage,
  })

  const handlePermissionChange = useCallback(
    async (value: DesktopPermissionMode): Promise<void> => {
      if (!sessionId) {
        setPermissionMode(value)
        return
      }
      if (!(await setSessionPermissionMode(sessionId, value))) throw new Error('权限模式未更新')
    },
    [sessionId, setPermissionMode, setSessionPermissionMode],
  )

  const handlePlanModeChange = useCallback(
    async (active: boolean): Promise<void> => {
      if (!sessionId) {
        if (active) setHomeGrillModeActive(false)
        setHomePlanModeActive(active)
        return
      }
      if (!(await setSessionPlanModeActive(sessionId, active))) throw new Error('计划模式未更新')
    },
    [sessionId, setSessionPlanModeActive],
  )

  const handleGrillModeChange = useCallback(
    async (active: boolean): Promise<void> => {
      if (!sessionId) {
        if (active) setHomePlanModeActive(false)
        setHomeGrillModeActive(active)
        return
      }
      if (!(await setSessionGrillModeActive(sessionId, active)))
        throw new Error('深度访谈模式未更新')
    },
    [sessionId, setSessionGrillModeActive],
  )

  const handleSelectSession = useCallback(
    (sessionItem: SessionListItem): void => {
      beginConversationSwitch(sessionItem.id)
      navigate(sessionPath(sessionItem.id))
    },
    [beginConversationSwitch, navigate],
  )
  const handleArchiveSessions = useCallback(
    async (targetSessionIds: readonly string[]) => {
      const capturedAssignments = captureSidebarAssignments(
        settings.values.sidebarCustomization ?? DEFAULT_SIDEBAR_CUSTOMIZATION,
        targetSessionIds.map((id) => `session:${id}`),
      )
      const capturedPins = { ...sidebarSessionPins }
      const result = await archiveSessions(targetSessionIds)
      if (result.succeededSessionIds.length > 0) {
        void loadDesktopTerminalClient()
          .then((terminalClient) =>
            Promise.all(
              result.succeededSessionIds.map((targetSessionId) =>
                terminalClient.closeThreadTerminal(targetSessionId, 'task-close'),
              ),
            ),
          )
          .catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)))
        setArchiveNoticeVisible(true)
        const archivedIdsForUndo = [...result.succeededSessionIds]
        setArchiveUndo(() => async () => {
          const results = await Promise.all(
            archivedIdsForUndo.map(async (id) => ({
              id,
              result: await session.updateSessionMetadata(id, { archivedAt: null }),
            })),
          )
          const restoredIds = results
            .filter((entry) => entry.result !== null)
            .map((entry) => entry.id)
          settings.setSidebarCustomization((current) =>
            restoreFailedArchiveAssignments(
              current ?? DEFAULT_SIDEBAR_CUSTOMIZATION,
              restoredIds.map((id) => `session:${id}`),
              capturedAssignments,
            ),
          )
          setSidebarSessionPins((current) => {
            const next = { ...current }
            for (const id of restoredIds)
              if (capturedPins[id] && !next[id]) next[id] = capturedPins[id]!
            return next
          })
          if (restoredIds.length !== archivedIdsForUndo.length) {
            setErrorMessage(`已恢复 ${restoredIds.length} 个聊天，部分恢复失败。`)
            return
          }
          setArchiveNoticeVisible(false)
          setArchiveUndo(null)
        })
        const archivedIds = new Set(result.succeededSessionIds)
        setSidebarSessionPins((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([targetSessionId]) => !archivedIds.has(targetSessionId),
            ),
          ),
        )
      }
      if (!result.succeededSessionIds.includes(routedSessionId ?? '')) {
        return result
      }
      navigate(
        result.nextActiveSession ? sessionPath(result.nextActiveSession.id) : QUICK_CHAT_PATH,
        { replace: true },
      )
      if (result.nextActiveSession && result.nextWorkspace) {
        setWorkspaceState(result.nextWorkspace)
        void refreshWorkspace(result.nextWorkspace, {
          expectedSessionId: result.nextActiveSession.id,
        })
      } else {
        setWorkspaceState(null)
        setDiffState('未选择项目。')
        setSelectedFile(null)
      }
      return result
    },
    [
      archiveSessions,
      session.updateSessionMetadata,
      settings,
      sidebarSessionPins,
      navigate,
      refreshWorkspace,
      routedSessionId,
      setDiffState,
      setSelectedFile,
      setWorkspaceState,
      setSidebarSessionPins,
    ],
  )

  const isConversationLoading =
    isConversationRoute &&
    (!sessionsHydrated || sessionId !== routedSessionId || gitDetection === 'loading')
  // pending 页没有真实会话：不等工作区就绪就直接显示已提交消息与启动状态。
  const isPendingSubmissionRoute = location.pathname.startsWith('/pending/')
  const branchName = getDesktopComposerBranchName(currentWorkspace)
  const quickChatRecentTasks = useMemo(() => {
    const workspaceKey = currentWorkspace?.path.replace(/\\/g, '/').toLowerCase() ?? null
    return sessions
      .filter((item) => {
        if (item.archivedAt) return false
        if (!workspaceKey) return item.standalone === true
        return item.workspacePath.replace(/\\/g, '/').toLowerCase() === workspaceKey
      })
      .slice(0, 5)
      .map((item) => ({
        id: item.id,
        title: sessionDisplayTitle(item),
        firstPrompt: item.firstPrompt ?? null,
        status: item.status,
        updatedAt: Date.parse(item.lastMessageAt ?? item.createdAt),
      }))
  }, [currentWorkspace?.path, sessions])
  const composerContextTasks = useMemo(
    () =>
      buildCommandMenuTasks(
        sessions.filter((item) => item.id !== routedSessionId),
        '',
      ).map((item) => ({
        id: item.id,
        title: item.title,
        workspaceName: item.workspaceName,
      })),
    [routedSessionId, sessions],
  )
  const composerBrowserContext = useMemo(() => {
    if (!browserState?.open || !/^https?:\/\//u.test(browserState.url)) return null
    return { title: browserState.title, url: browserState.url }
  }, [browserState?.open, browserState?.title, browserState?.url])

  const activeSessionFallbackTitle = useMemo(() => {
    const workflowTitleEvents = deriveWorkflowSessionState(workflowEvents, sessionId).events
    const titleEvents =
      (sessionStatus === 'running' || sessionStatus === 'waiting') && events.length > 0
        ? events
        : workflowTitleEvents.length > 0
          ? workflowTitleEvents
          : events
    return sessionViewFallbackTitle({ events: titleEvents, messages })
  }, [events, messages, sessionId, sessionStatus, workflowEvents])
  const quickChatSessionTitle = activeSessionItem
    ? sessionDisplayTitle(activeSessionItem, activeSessionFallbackTitle)
    : activeSessionFallbackTitle
  const quickChatEditableSessionTitle = activeSessionItem
    ? sessionEditableTitle(activeSessionItem, activeSessionFallbackTitle)
    : activeSessionFallbackTitle
  const regeneratingActiveSessionTitle = activeSessionItem
    ? titleLoadingIds.has(activeSessionItem.id)
    : false
  const sidebarSessionFallbackTitles = useMemo(() => {
    if (!sessionId || !activeSessionFallbackTitle) return sessionFallbackTitles
    if (sessionFallbackTitles[sessionId] === activeSessionFallbackTitle) {
      return sessionFallbackTitles
    }
    return {
      ...sessionFallbackTitles,
      [sessionId]: activeSessionFallbackTitle,
    }
  }, [activeSessionFallbackTitle, sessionFallbackTitles, sessionId])
  useEffect(
    () =>
      subscribeProjectRestores((project, selected) => {
        setRemovedWorkspaces((current) => {
          const next = current.filter((entry) =>
            project.projectId && entry.projectId
              ? entry.projectId !== project.projectId
              : entry.path !== project.path,
          )
          settings.syncExternalSettingsPatch({ removedWorkspaces: next })
          return next
        })
        setRecentWorkspaces((current) => [
          ...current.filter((entry) =>
            project.projectId ? entry.projectId !== project.projectId : entry.path !== project.path,
          ),
          project,
        ])
        if (selected && !currentWorkspace) {
          setWorkspaceState(project)
          void refreshWorkspace(project, { force: true })
        }
      }),
    [currentWorkspace, refreshWorkspace, settings, setRecentWorkspaces, setWorkspaceState],
  )

  const handleRemoveWorkspace = useCallback(
    (target: DesktopWorkspace): void => {
      // Record removal so the project doesn't reappear from sessions
      setRemovedWorkspaces((current) => {
        const next = current.filter((r) =>
          target.projectId && r.projectId
            ? r.projectId !== target.projectId
            : r.path !== target.path,
        )
        next.push({
          path: target.path,
          projectId: target.projectId,
          name: target.name,
          removedAt: new Date().toISOString(),
        })
        settings.syncExternalSettingsPatch({ removedWorkspaces: next })
        return next
      })
      setRecentWorkspaces((current) =>
        current.filter((workspaceItem) =>
          target.projectId
            ? workspaceItem.projectId !== target.projectId
            : workspaceItem.path !== target.path,
        ),
      )
      setUnavailableWorkspacePaths((current) => {
        if (!current.has(target.path)) return current
        const next = new Set(current)
        next.delete(target.path)
        return next
      })
      if (
        target.projectId
          ? currentWorkspace?.projectId !== target.projectId
          : currentWorkspace?.path !== target.path
      )
        return
      setWorkspaceState(null)
      setDiffState(NO_WORKSPACE_DIFF)
      setSelectedFile(null)
      if (!isConversationRoute) {
        navigate(QUICK_CHAT_PATH)
      }
    },
    [
      currentWorkspace?.path,
      isConversationRoute,
      navigate,
      setDiffState,
      setRecentWorkspaces,
      setSelectedFile,
      setWorkspaceState,
      settings,
    ],
  )

  const setProjectPinnedAt = useCallback(
    (target: DesktopWorkspace, pinnedAt: string | null): void => {
      setRecentWorkspaces((current) => {
        const matchesTarget = (item: DesktopWorkspace): boolean =>
          target.projectId
            ? item.projectId === target.projectId
            : !item.projectId && item.path === target.path
        const nextProject = { ...target, pinnedAt }
        const index = current.findIndex(matchesTarget)
        if (index < 0) return [nextProject, ...current]
        return current.map((item, itemIndex) => (itemIndex === index ? nextProject : item))
      })
    },
    [setRecentWorkspaces],
  )

  const handlePinWorkspace = useCallback(
    (target: DesktopWorkspace): void => {
      setProjectPinnedAt(target, new Date().toISOString())
    },
    [setProjectPinnedAt],
  )

  const handleUnpinWorkspace = useCallback(
    (target: DesktopWorkspace): void => {
      setProjectPinnedAt(target, null)
    },
    [setProjectPinnedAt],
  )

  useEffect(() => {
    let mounted = true
    void desktopClient
      .isWindowMaximized()
      .then((next) => {
        if (mounted) {
          setIsWindowMaximized(next)
        }
      })
      .catch(() => {
        if (mounted) {
          setIsWindowMaximized(false)
        }
      })
    return () => {
      mounted = false
    }
  }, [])

  const menuBar = useMemo(
    () => (
      <MenuBar
        sidebarCollapsed={sidebarShell.mode !== 'docked'}
        isMaximized={isWindowMaximized}
        canNavigateBack={canNavigateBack}
        canNavigateForward={canNavigateForward}
        onToggleSidebar={toggleSidebarCollapsed}
        onClose={() => {
          void desktopClient.closeWindow()
        }}
        onMinimize={() => {
          void desktopClient.minimizeWindow()
        }}
        onToggleMaximize={() => {
          void desktopClient.toggleWindowMaximized().then((next) => setIsWindowMaximized(next))
        }}
        {...menuActions}
      />
    ),
    [
      sidebarShell.mode,
      isWindowMaximized,
      canNavigateBack,
      canNavigateForward,
      toggleSidebarCollapsed,
      setIsWindowMaximized,
      menuActions,
    ],
  )

  const displayedSidebarPane = sidebarShell.pane
  const retainedTaskPane =
    useLastNonNull(
      displayedSidebarPane === 'chats' || displayedSidebarPane === 'activity'
        ? displayedSidebarPane
        : null,
    ) ?? 'chats'
  const scheduledSidebarMounted = useEverOpened(displayedSidebarPane === 'scheduled')
  const pluginsSidebarMounted = useEverOpened(displayedSidebarPane === 'plugins')
  const providersSidebarMounted = useEverOpened(displayedSidebarPane === 'providers')
  const petsSidebarMounted = useEverOpened(displayedSidebarPane === 'pets')

  const settingsSidebarContent = useMemo(
    () => (
      <SettingsSidebarContent
        activeTab={settingsActiveTab}
        workspacePath={currentWorkspace?.path ?? null}
        onBack={handleSettingsBack}
        onTabChange={(tab) => {
          sidebarShell.closePreview()
          handleSettingsTabChange(tab)
        }}
      />
    ),
    [
      settingsActiveTab,
      currentWorkspace?.path,
      sidebarShell.closePreview,
      handleSettingsTabChange,
      handleSettingsBack,
    ],
  )

  const handleFollowUpEdit = useCallback(
    async (followUpId: string, value: DesktopUserMessageInput): Promise<void> => {
      if (!sessionId) return
      try {
        await desktopClient.updateQueuedFollowUp(sessionId, followUpId, value)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [sessionId],
  )

  const handleFollowUpRemove = useCallback(
    async (followUpId: string): Promise<void> => {
      if (!sessionId) return
      try {
        await desktopClient.removeQueuedFollowUp(sessionId, followUpId)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [sessionId],
  )

  const handleFollowUpResume = useCallback(async (): Promise<void> => {
    if (!sessionId) return
    try {
      await desktopClient.resumeQueuedFollowUps(sessionId)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId])

  const renderSideChatComposer = (
    tab: Extract<import('../dock/RightDockState.js').WorkbenchTabDescriptor, { kind: 'side-chat' }>,
    sideChatContext: import('../../session/conversation/SideChatThreadPanel.js').SideChatComposerRenderContext,
  ): React.ReactNode => {
    if (!isQuickChatPage && !isConversationRoute) return null
    const sideSettings = getSideChatSettings(tab.id)
    const sideProviderOption = providerModelOptions.find(
      (option) => option.providerID === sideSettings.providerID,
    )
    const sideModelPresets = sideProviderOption?.modelPresets ?? modelPresets
    const sideSelectedModelPreset = resolveModelPresetId(
      sideSettings.model,
      sideSettings.selectedModelPreset,
      sideModelPresets,
    )
    const sideProviderSummary =
      modelProviders.find((provider) => provider.providerID === sideSettings.providerID) ??
      (providerState?.provider.providerID === sideSettings.providerID
        ? providerState.provider
        : undefined)
    const sideModelMetadata =
      sideProviderSummary?.modelMetadata?.[sideSettings.model] ??
      (providerState?.selectedProviderID === sideSettings.providerID
        ? providerState.modelMetadata?.[sideSettings.model]
        : undefined)
    const sideDeepSeekThinkingControls = isDeepSeekThinkingModel({
      providerID: sideSettings.providerID,
      model: sideSettings.model,
      metadata: sideModelMetadata,
    })
    const sideModelConfigured = Boolean(
      sideSettings.model &&
      sideProviderSummary?.apiKeyConfigured &&
      sideModelPresets.some((preset) => preset.value === sideSettings.model),
    )
    const sideModelError =
      getSideChatModelError(tab.id) ??
      (!isSideChatModelLoading(tab.id) &&
      !modelCatalogLoading &&
      sideSettings.model &&
      !sideModelConfigured
        ? `当前会话模型不可用：${sideSettings.providerID}/${sideSettings.model}，请检查提供商配置`
        : null)
    const sideShowThinkingOptions =
      sideDeepSeekThinkingControls ||
      sideProviderSummary?.kind === 'anthropic' ||
      sideModelMetadata?.reasoning === true ||
      Boolean(sideModelMetadata?.variants?.length)
    return (
      <DesktopComposer
        input={sideChatInput}
        messages={[]}
        hasConversationMessages={sideChatContext.hasVisibleMessages}
        placement="thread"
        draftKey={tab.id}
        routedSessionId={tab.threadId}
        sessionStatus={sideChatContext.status}
        permissionMode={sideSettings.permissionMode}
        planModeActive={sideChatContext.planModeActive ?? sideSettings.planModeActive}
        enableAutoReviewPermissionMode={enableAutoReviewPermissionMode ?? false}
        enableFullAccessPermissionMode={enableFullAccessPermissionMode ?? false}
        codingModel={codingModel}
        modelSelectionError={sideModelError}
        onError={handleErrorMessage}
        onRetryModelSelection={() => {
          reloadSideChatModel(tab.id)
          void refreshProviderState()
        }}
        modelVariant={sideSettings.variant ?? 'default'}
        modelVariantOptions={buildVariantOptions(sideModelMetadata?.variants)}
        onModelVariantChange={(variant) =>
          updateSideChatSettings(tab.id, {
            variant: variant === 'default' ? undefined : variant,
            thinkingMode:
              variant === 'enabled' || variant === 'adaptive' || variant === 'disabled'
                ? variant
                : 'default',
          })
        }
        thinkingMode={sideSettings.thinkingMode}
        selectedProviderID={sideSettings.providerID}
        selectedModelPreset={sideSelectedModelPreset}
        modelConfigured={sideModelConfigured}
        modelCatalogLoading={modelCatalogLoading || isSideChatModelLoading(tab.id)}
        selectedModelMetadata={sideModelMetadata}
        showThinkingOptions={sideShowThinkingOptions}
        deepSeekThinkingControls={sideDeepSeekThinkingControls}
        showContextUsage={false}
        contextUsage={null}
        modelPresets={sideModelPresets}
        providerOptions={providerModelOptions}
        recentWorkspaces={recentWorkspaces}
        contextTasks={composerContextTasks}
        browserContext={composerBrowserContext}
        workspace={currentWorkspace}
        attachments={sideChatAttachments}
        onAttachmentsChange={setSideChatAttachments}
        onAppendAttachmentsForDraft={appendSideComposerAttachmentsForDraft}
        onRemoveAttachmentForDraft={removeSideComposerAttachmentForDraft}
        onOpenAttachment={handleOpenDraftAttachment}
        onDraftAccepted={clearSideComposerDraftIfUnchanged}
        onChooseWorkspace={handleChooseWorkspace}
        onInputChange={setSideChatInput}
        onInterrupt={() => desktopClient.interruptSession(tab.threadId)}
        onProviderModelChange={(nextProviderID, nextPresetId) => {
          const providerOption = providerModelOptions.find(
            (option) => option.providerID === nextProviderID,
          )
          const preset = providerOption?.modelPresets.find(
            (candidate) => candidate.id === nextPresetId,
          )
          if (!providerOption || !preset) return
          if (nextProviderID === sideSettings.providerID && preset.value === sideSettings.model)
            return
          const metadata =
            (providerState?.selectedProviderID === nextProviderID
              ? providerState.modelMetadata?.[preset.value]
              : undefined) ??
            modelProviders.find((provider) => provider.providerID === nextProviderID)
              ?.modelMetadata?.[preset.value]
          const variant =
            sideSettings.variant ??
            (sideSettings.thinkingMode !== 'default' ? sideSettings.thinkingMode : undefined)
          const preserveThinking = Boolean(variant && metadata?.variants?.includes(variant))
          updateSideChatSettings(tab.id, {
            providerID: nextProviderID,
            providerBaseURL: providerOption.baseURL ?? '',
            model: preset.value,
            selectedModelPreset: nextPresetId,
            variant: preserveThinking ? variant : undefined,
            thinkingMode: preserveThinking ? sideSettings.thinkingMode : 'default',
          })
        }}
        onProviderOpen={handleProviderOpen}
        onProviderSearch={handleProviderSearch}
        onOpenWorkspace={handleOpenRecentWorkspace}
        onCloneGithub={() => setGithubRepositoryModalOpen(true)}
        onClearWorkspace={handleClearWorkspace}
        onOpenMcpSettings={() => navigate('/settings/plugins?tab=mcps')}
        onOpenModelSettings={() => navigate('/providers')}
        onSkillTokenActivate={(invocation) => {
          void handleActivateComposerSkill(invocation)
        }}
        onBranchSelect={handleBranchSelect}
        onCreateBranch={handleCreateBranch}
        capabilities={{ goals: false, review: false, status: false }}
        onPermissionChange={async (value) => {
          try {
            await desktopClient.setSessionPermissionMode(tab.threadId, value)
            updateSideChatSettings(tab.id, { permissionMode: value })
          } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : String(error))
            throw error
          }
        }}
        onPlanModeChange={async (active) => {
          await desktopClient.setSessionPlanModeActive(tab.threadId, active)
          updateSideChatSettings(tab.id, { planModeActive: active })
        }}
        onThinkingChange={(value) => {
          updateSideChatSettings(tab.id, {
            thinkingMode: value,
            variant: sideModelMetadata?.variants?.includes(value) ? value : undefined,
          })
        }}
        createSessionForWorkspace={createSessionForWorkspace}
        submitToSession={sideChatSubmitToSession}
      />
    )
  }
  const subagentThreadContent = selectedSubagentTaskId ? (
    <SubagentDockContent
      availability={subagentAvailability}
      error={selectedSubagentError}
      read={selectedSubagent}
      taskId={selectedSubagentTaskId}
      onBack={() => {
        if (selectedSubagentTaskId) handleCloseSubagentTab(selectedSubagentTaskId)
      }}
      onError={setErrorMessage}
      onOpenPatchReview={handleOpenPatchReview}
      onOpenSubagent={(item) => handleOpenSubagent(item.subagentTaskId)}
      onOpenParentSubagent={handleOpenSubagent}
      onPatchApplied={handleRefreshDiff}
      onRefresh={refreshSelectedSubagent}
    />
  ) : undefined
  const planContentByEventId = useMemo(() => {
    const result: Record<string, string> = {}
    for (const event of events) {
      if (event.type !== 'proposed_plan') continue
      const content = event.content?.trim()
      if (content) result[event.id] = content
    }
    return result
  }, [events])
  const dockedPlanItemId = useMemo(() => {
    for (const target of ['right', 'bottom'] as const) {
      const panel = workbenchPanelState[target]
      if (target === 'right' && !effectiveRightDockVisible) continue
      if (!panel.open || !panel.activeTabId) continue
      const tab = workbenchPanelState.tabsById[panel.activeTabId]
      if (tab?.kind === 'plan') return tab.planItemId
    }
    return null
  }, [effectiveRightDockVisible, workbenchPanelState])

  const handledFileLoadErrorsRef = useRef(new WeakSet<Error>())
  const handleFileLoadError = useCallback(
    ({ error, phase, tab, target }: WorkbenchFileLoadErrorEvent): void => {
      if (handledFileLoadErrorsRef.current.has(error)) return
      handledFileLoadErrorsRef.current.add(error)
      if (phase === 'initial' && shouldFallbackToExternalOpen(error)) {
        const resolved = resolveWorkspaceFileReference(tab.workspacePath, tab.relativePath)
        if (!resolved) {
          setErrorMessage('无法打开文件')
          return
        }
        closePanelTab(target, tab.id)
        void openPathWithPreferredExternalTarget(resolved.absolutePath).catch(() =>
          setErrorMessage('无法打开文件'),
        )
        return
      }
      const errorCode =
        'errorCode' in error && typeof error.errorCode === 'string' ? error.errorCode : null
      setErrorMessage(fileDocumentLoadErrorMessage(errorCode, error.message).message)
    },
    [closePanelTab, setErrorMessage],
  )

  const retryExistingFileTab = useCallback(
    (tabId: WorkbenchTabId): void => {
      const tab = workbenchPanelState.tabsById[tabId]
      if (tab?.kind !== 'file-preview') return
      const target = workbenchPanelState.right.tabIds.includes(tabId)
        ? 'right'
        : workbenchPanelState.bottom.tabIds.includes(tabId)
          ? 'bottom'
          : null
      if (!target) return
      void prefetchFileDocument(tab.workspacePath, tab.relativePath, {
        projectId: tab.projectId,
        folderId: tab.folderId,
      }).catch((error) =>
        handleFileLoadError({
          error: error instanceof Error ? error : new Error(String(error)),
          phase: 'initial',
          tab,
          target,
        }),
      )
    },
    [
      handleFileLoadError,
      workbenchPanelState.tabsById,
      workbenchPanelState.right.tabIds,
      workbenchPanelState.bottom.tabIds,
    ],
  )

  const handleOpenFilePreview = useCallback(
    (target: WorkbenchPanelTarget, file: DesktopFileEntry): void => {
      if (file.type !== 'file' || !currentWorkspace) return
      const workspacePath = file.rootPath ?? currentWorkspace.path
      const tabId = createWorkspaceFileTabId(
        workspacePath,
        file.path,
        currentWorkspace.projectId,
        file.folderId,
      )
      retryExistingFileTab(tabId)
      openPanelTab(target, {
        id: tabId,
        kind: 'file-preview',
        workspacePath,
        ...(currentWorkspace.projectId ? { projectId: currentWorkspace.projectId } : {}),
        ...(file.folderId ? { folderId: file.folderId } : {}),
        relativePath: file.path,
        preview: true,
      })
    },
    [currentWorkspace, openPanelTab, retryExistingFileTab],
  )

  const handleOpenFileFromBrowser = useCallback(
    (target: WorkbenchPanelTarget, file: DesktopFileEntry): void => {
      if (file.type !== 'file' || !currentWorkspace) return
      const workspacePath = file.rootPath ?? currentWorkspace.path
      const tabId = createWorkspaceFileTabId(
        workspacePath,
        file.path,
        currentWorkspace.projectId,
        file.folderId,
      )
      retryExistingFileTab(tabId)
      openPanelTab(target, {
        id: tabId,
        kind: 'file-preview',
        workspacePath,
        ...(currentWorkspace.projectId ? { projectId: currentWorkspace.projectId } : {}),
        ...(file.folderId ? { folderId: file.folderId } : {}),
        relativePath: file.path,
        preview: false,
      })
      closePanelTab(target, 'file-browser')
    },
    [closePanelTab, currentWorkspace, openPanelTab, retryExistingFileTab],
  )

  const handleOpenMarkdownFileReference = useCallback(
    (reference: MarkdownFileReference, options: MarkdownFileOpenOptions): void => {
      if (!currentWorkspace) return
      const resolved = resolveWorkspaceFileReference(currentWorkspace.path, reference.path)
      if (!resolved) {
        // Not a workspace path — open with system
        if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/u.test(reference.path)) {
          void openPathWithPreferredExternalTarget(reference.path).catch((error) => {
            setErrorMessage(error instanceof Error ? error.message : String(error))
          })
        }
        return
      }

      // Workspace root directory — open file-browser tab
      if (resolved.relativePath === '.') {
        directoryProbeRequestId += 1
        openPanelTab('right', {
          id: 'file-browser',
          kind: 'file-browser',
          directoryPath: undefined,
          revealToken: directoryProbeRequestId,
        })
        return
      }

      // Check if it's a known directory from workspaceFiles (root-level entries)
      const isKnownDirectory = workspaceFiles.some(
        (file) =>
          file.type === 'directory' &&
          normalizePathForCompare(file.path) === normalizePathForCompare(resolved.relativePath),
      )
      if (isKnownDirectory) {
        directoryProbeRequestId += 1
        openPanelTab('right', {
          id: 'file-browser',
          kind: 'file-browser',
          directoryPath: resolved.relativePath,
          revealToken: directoryProbeRequestId,
        })
        return
      }

      // Asynchronously probe unknown paths to determine if directory or file
      const probeRequestId = ++directoryProbeRequestId
      desktopClient
        .listWorkspaceFiles(
          currentWorkspace.path,
          resolved.relativePath,
          currentWorkspace.primaryFolderId,
          currentWorkspace.projectId,
        )
        .then(() => {
          // Probe succeeded → it's a directory
          if (directoryProbeRequestId === probeRequestId) {
            openPanelTab('right', {
              id: 'file-browser',
              kind: 'file-browser',
              directoryPath: resolved.relativePath,
              revealToken: probeRequestId,
            })
          }
        })
        .catch(() => {
          // Probe failed → it's a file (or doesn't exist)
          if (directoryProbeRequestId !== probeRequestId) return

          // External file types still open with system
          if (shouldOpenFileExternally(reference.path)) {
            void openPathWithPreferredExternalTarget(resolved.absolutePath).catch((error) => {
              setErrorMessage(error instanceof Error ? error.message : String(error))
            })
            return
          }

          // Open as file-preview tab
          const tabId = createWorkspaceFileTabId(
            currentWorkspace.path,
            resolved.relativePath,
            currentWorkspace.projectId,
            currentWorkspace.primaryFolderId,
          )
          retryExistingFileTab(tabId)
          openPanelTab('right', {
            id: tabId,
            kind: 'file-preview',
            workspacePath: currentWorkspace.path,
            ...(currentWorkspace.projectId ? { projectId: currentWorkspace.projectId } : {}),
            ...(currentWorkspace.primaryFolderId
              ? { folderId: currentWorkspace.primaryFolderId }
              : {}),
            relativePath: resolved.relativePath,
            preview: options.preview,
            ...(reference.line ? { line: reference.line } : {}),
            ...(reference.column ? { column: reference.column } : {}),
            ...(reference.endLine ? { endLine: reference.endLine } : {}),
            ...(reference.endColumn ? { endColumn: reference.endColumn } : {}),
          })
        })
    },
    [currentWorkspace, openPanelTab, retryExistingFileTab, workspaceFiles],
  )

  const canCopyMarkdownFileReferenceContents = useCallback(
    (reference: MarkdownFileReference): boolean => {
      if (!currentWorkspace || shouldOpenFileExternally(reference.path)) {
        return false
      }
      const resolved = resolveWorkspaceFileReference(currentWorkspace.path, reference.path)
      return resolved !== null && resolved.relativePath !== '.'
    },
    [currentWorkspace],
  )

  const handleCopyMarkdownFileReferenceContents = useCallback(
    async (reference: MarkdownFileReference): Promise<void> => {
      if (!currentWorkspace || shouldOpenFileExternally(reference.path)) return
      const resolved = resolveWorkspaceFileReference(currentWorkspace.path, reference.path)
      if (!resolved) return
      try {
        const document = await prefetchFileDocument(currentWorkspace.path, resolved.relativePath, {
          projectId: currentWorkspace.projectId,
          folderId: currentWorkspace.primaryFolderId,
        })
        await desktopClipboard.writeText(document.draftContent)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [currentWorkspace],
  )

  const handleSelectPanelTab = useCallback(
    (target: WorkbenchPanelTarget, tabId: WorkbenchTabId): void => {
      selectPanelTab(target, tabId)
      retryExistingFileTab(tabId)
    },
    [retryExistingFileTab, selectPanelTab],
  )

  const saveTabsBeforeClose = useCallback(
    async (
      tabIds: readonly WorkbenchTabId[],
      options: { discardSideChats?: boolean } = {},
    ): Promise<boolean> => {
      if (options.discardSideChats !== false) {
        const sideChatTabs = tabIds.flatMap((tabId) => {
          const tab = workbenchPanelState.tabsById[tabId]
          return tab?.kind === 'side-chat' ? [tab] : []
        })
        if (!(await requestCloseSideChatTabs(sideChatTabs))) return false
      }
      for (const tabId of tabIds) {
        const tab = workbenchPanelState.tabsById[tabId]
        if (tab?.kind === 'terminal' && sessionId) {
          try {
            const terminalClient = await loadDesktopTerminalClient()
            await terminalClient.closeThreadTerminal(sessionId)
          } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : String(error))
            return false
          }
          continue
        }
        if (tab?.kind !== 'file-preview') continue
        if (
          !(await saveFileDocument(tab.workspacePath, tab.relativePath, {
            projectId: tab.projectId,
            folderId: tab.folderId,
          }))
        ) {
          setErrorMessage(`无法关闭 ${tab.relativePath}：文件尚未保存。`)
          return false
        }
      }
      return true
    },
    [requestCloseSideChatTabs, sessionId, workbenchPanelState.tabsById],
  )

  const closeBrowserIfIncluded = useCallback(
    async (tabIds: readonly WorkbenchTabId[]): Promise<void> => {
      if (!tabIds.some((tabId) => workbenchPanelState.tabsById[tabId]?.kind === 'browser')) {
        return
      }
      try {
        if (!desktopBrowserClient.available) return
        for (const id of tabIds) {
          const tab = workbenchPanelState.tabsById[id]
          if (tab?.kind === 'browser') await desktopBrowserClient.forTab(tab.tabId).closeBrowser()
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error))
      }
    },
    [workbenchPanelState.tabsById],
  )

  const handleCreateTerminal = useCallback((): void => {
    const bottomTabIds = workbenchPanelState.bottom.tabIds
    let maxIndex = 0
    for (const tabId of bottomTabIds) {
      const tab = workbenchPanelState.tabsById[tabId]
      if (tab?.kind === 'terminal') {
        const idNum = tab.terminalId ? parseInt(tab.terminalId, 10) : NaN
        if (!isNaN(idNum) && idNum > maxIndex) {
          maxIndex = idNum
        }
        const titleMatch = tab.title?.match(/^终端\s*(\d+)$/)
        if (titleMatch) {
          const num = parseInt(titleMatch[1], 10)
          if (!isNaN(num) && num > maxIndex) {
            maxIndex = num
          }
        }
      }
    }
    const nextIndex = maxIndex + 1
    const newTabId: WorkbenchTabId = `terminal:${nextIndex}` as const
    openPanelTab('bottom', {
      id: newTabId,
      kind: 'terminal',
      terminalId: String(nextIndex),
      title: `终端 ${nextIndex}`,
    })
  }, [openPanelTab, workbenchPanelState.bottom.tabIds, workbenchPanelState.tabsById])

  const renderWorkbenchPanel = (target: WorkbenchPanelTarget): React.ReactNode => {
    const providerMode = target === 'right' && visibleProviderTab !== null
    const state = providerMode
      ? {
          ...rightDockState,
          open: true,
          activeTabId: 'provider-management' as const,
          tabIds: ['provider-management' as const],
        }
      : target === 'right'
        ? rightDockState
        : bottomPanelState
    if (target === 'bottom' && !state.open) {
      return null
    }
    return (
      <WorkbenchPanel
        target={target}
        state={state}
        tabsById={
          providerMode
            ? { 'provider-management': visibleProviderTab! }
            : workbenchPanelState.tabsById
        }
        providerManagement={
          providerMode ? (
            <div
              ref={setProviderManagementHost}
              className="tw:flex tw:h-full tw:w-full tw:min-h-0 tw:min-w-0 tw:flex-1 tw:flex-col tw:overflow-hidden"
            />
          ) : undefined
        }
        onCreateTerminal={target === 'bottom' ? handleCreateTerminal : undefined}
        browserAvailability={{
          status: browserAvailability,
          ...(browserAvailability === 'unavailable'
            ? {
                reason: '当前环境未连接桌面浏览器宿主。',
              }
            : {}),
        }}
        browserState={browserState}
        defaultBranch={derivedDefaultBranch}
        files={workspaceFiles}
        gitStatus={gitStatus}
        isRefreshingReview={false}
        diffMarkerStyle={diffMarkerStyle}
        maxWidth={rightDockMaxWidth}
        minWidth={rightDockMinWidth}
        maxHeight={bottomPanelMaxHeight}
        minHeight={bottomPanelMinHeight}
        reviewView={reviewView}
        reviewTabState={reviewTabState}
        onReviewSummaryChange={handleReviewSummaryChange}
        onOpenReviewFile={(path) =>
          handleOpenFileFromBrowser(target, {
            path,
            name: path.split(/[\\/]/).pop() ?? path,
            type: 'file',
            depth: 0,
          })
        }
        planContentByEventId={planContentByEventId}
        onOpenPlan={handleOpenPlanDock}
        selectedFile={selectedFile}
        sessionId={sessionId}
        sessionStatus={sessionStatus}
        terminalAvailable={terminalAvailable}
        width={rightDockWidth}
        height={bottomPanelHeight}
        workspace={currentWorkspace}
        browserDraftKey={mainComposerDraftKey}
        onAppendComposerText={handleAppendComposerText}
        onAddComposerFiles={handleAddComposerFiles}
        onBrowserStateChange={setBrowserState}
        onClose={() => {
          if (providerMode) {
            closeProviderManagement()
            return
          }
          void saveTabsBeforeClose(state.tabIds, {
            discardSideChats: false,
          }).then((saved) => {
            if (saved) closePanel(target)
          })
        }}
        onCloseTab={(tabId) => {
          if (providerMode) {
            closeProviderManagement()
            return
          }
          void saveTabsBeforeClose([tabId]).then(async (saved) => {
            if (!saved) return
            const tab = workbenchPanelState.tabsById[tabId]
            if (tab?.kind === 'side-task') {
              handleCloseSubagentTab(tab.taskId)
              return
            }
            await closeBrowserIfIncluded([tabId])
            if (tab?.kind === 'terminal') {
              const termId =
                tab.terminalId ??
                (tab.id.startsWith('terminal:') ? tab.id.slice('terminal:'.length) : tab.id)
              void loadDesktopTerminalClient().then((client) => {
                void client
                  .closeTerminal({ terminalId: termId, reason: 'user-close' })
                  .catch(() => undefined)
              })
            }
            closePanelTab(target, tabId)
          })
        }}
        onCloseOtherTabs={(tabId) => {
          if (providerMode) return
          const closing = state.tabIds.filter((id) => id !== tabId)
          void saveTabsBeforeClose(closing).then(async (saved) => {
            if (!saved) return
            await closeBrowserIfIncluded(closing)
            for (const closingId of closing) {
              const tab = workbenchPanelState.tabsById[closingId]
              if (tab?.kind === 'terminal') {
                const termId =
                  tab.terminalId ??
                  (tab.id.startsWith('terminal:') ? tab.id.slice('terminal:'.length) : tab.id)
                void loadDesktopTerminalClient().then((client) => {
                  void client
                    .closeTerminal({ terminalId: termId, reason: 'user-close' })
                    .catch(() => undefined)
                })
              }
            }
            closeOtherTabs(target, tabId)
          })
        }}
        onCloseTabsToRight={(tabId) => {
          if (providerMode) return
          const index = state.tabIds.indexOf(tabId)
          const closing = index < 0 ? [] : state.tabIds.slice(index + 1)
          void saveTabsBeforeClose(closing).then(async (saved) => {
            if (!saved) return
            await closeBrowserIfIncluded(closing)
            for (const closingId of closing) {
              const tab = workbenchPanelState.tabsById[closingId]
              if (tab?.kind === 'terminal') {
                const termId =
                  tab.terminalId ??
                  (tab.id.startsWith('terminal:') ? tab.id.slice('terminal:'.length) : tab.id)
                void loadDesktopTerminalClient().then((client) => {
                  void client
                    .closeTerminal({ terminalId: termId, reason: 'user-close' })
                    .catch(() => undefined)
                })
              }
            }
            closeTabsToRight(target, tabId)
          })
        }}
        onCreateBranch={handleCreateBranch}
        onFileLoadError={handleFileLoadError}
        onOpenTab={(tab) => {
          if (providerMode) return
          if (tab.kind === 'browser') {
            if (browserAvailability !== 'available') {
              setErrorMessage('当前桌面运行环境没有提供内置浏览器能力。')
              return
            }
            void desktopBrowserClient
              .forTab(tab.tabId)
              .openBrowser()
              .then(setBrowserState)
              .catch((error) =>
                setErrorMessage(error instanceof Error ? error.message : String(error)),
              )
          }
          openPanelTab(target, tab)
        }}
        onOpenWorkspacePath={handleOpenWorkspacePath}
        onOpenFileFromBrowser={(file) => handleOpenFileFromBrowser(target, file)}
        onPreviewFile={(file) => handleOpenFilePreview(target, file)}
        onRefreshReview={handleRefreshDiff}
        onReviewTabStateChange={setReviewTabState}
        onResetHeight={handleResetBottomPanelHeight}
        onResetWidth={handleResetRightDockWidth}
        onSelectTab={(tabId) => {
          if (!providerMode) handleSelectPanelTab(target, tabId)
        }}
        onMoveTab={providerMode ? () => {} : movePanelTab}
        onPopOutTab={providerMode ? undefined : popOutPanelTab}
        onReorderTab={providerMode ? () => {} : reorderPanelTab}
        onPinTab={providerMode ? () => {} : pinTab}
        onSetFileMarkdownViewMode={setFileMarkdownViewMode}
        onSetFileViewState={setFileViewState}
        onAskInSideChat={sideChatSupported ? handleAppendSideChatText : undefined}
        onSetHeight={handleSetBottomPanelHeight}
        onSetWidth={handleSetRightDockWidth}
        onResizeRawSize={target === 'right' && !providerMode ? handleRightDockResizeRaw : undefined}
        onResizePreview={
          target === 'right'
            ? providerMode
              ? rightPanelLiveResize.previewSize
              : handleRightDockResizePreview
            : undefined
        }
        shouldCommitResizeSize={
          target === 'right' ? (providerMode ? () => true : shouldCommitRightDockResize) : undefined
        }
        onToggleReviewView={() => setReviewView(reviewView === 'inline' ? 'split' : 'inline')}
        onCreateSideChat={() => void createSideChat()}
        sideChat={{
          available: sideChatSupported,
          focusVersion: sideChatFocusVersion,
          isCreating: isCreatingSideChat,
          getPermissionMode: (tab) => getSideChatSettings(tab.id).permissionMode,
          getModelSelection: (tab) => getSideChatSettings(tab.id),
          onInteractionError: (message) => setErrorMessage(message),
          itemContext: (tab, status) => ({
            modelProviderNames: Object.fromEntries(
              modelProviders.map((provider) => [provider.providerID, provider.displayName]),
            ),
            canCopyFileReferenceContents: canCopyMarkdownFileReferenceContents,
            onCopyFileReferenceContents: handleCopyMarkdownFileReferenceContents,
            onOpenFileReference: handleOpenMarkdownFileReference,
            onOpenAttachment: handleOpenThreadAttachment,
            onOpenLocalContext: handleOpenThreadLocalContext,
            canEditUserMessage: desktopClient.supportsMessageEditing?.() ?? false,
            onSubmitEditedUserMessage: async (input, target) => {
              if (!desktopClient.editUserMessage) throw new Error('当前会话不支持修改消息')
              await desktopClient.editUserMessage(tab.threadId, target, input)
            },
            sessionStatus: status,
            workspacePath: currentWorkspace?.path ?? null,
          }),
          onOpenPatchReview: handleOpenPatchReview,
          onOpenPlan: handleOpenPlanDock,
          onRecreate: (tab) => {
            void createSideChat().then((created) => {
              if (!created) return
              const target = workbenchPanelState.right.tabIds.includes(tab.id) ? 'right' : 'bottom'
              void requestCloseSideChatTabs([tab]).then((closed) => {
                if (closed) closePanelTab(target, tab.id)
              })
            })
          },
          onStateChange: reportSideChatState,
          renderComposer: renderSideChatComposer,
        }}
        activeSideTaskId={activeSideTaskId}
        subagentAvailability={{
          status: subagentAvailability,
          ...(subagentAvailability === 'unavailable'
            ? { reason: '当前 Agent 不支持子智能体工作台。' }
            : {}),
        }}
        sideTaskContent={subagentThreadContent}
      />
    )
  }

  const auxiliaryPanelContext = useMemo<WorkbenchTabRenderContext>(
    () => ({
      review: {
        activeSessionId: sessionId,
        defaultBranch: derivedDefaultBranch,
        gitStatus,
        isRefreshing: false,
        projectId: currentWorkspace?.projectId ?? null,
        diffMarkerStyle,
        reviewView,
        reviewTabState,
        handleReviewSummaryChange,
        handleOpenFileFromBrowser,
        onReviewSummaryChange: handleReviewSummaryChange,
        onOpenReviewFile: (path) =>
          handleOpenFileFromBrowser('right', {
            path,
            name: path.split(/[\\/]/).pop() ?? path,
            type: 'file',
            depth: 0,
          }),
        sessionStatus,
        workspacePath: currentWorkspace?.path ?? null,
        onAppendComposerText: handleAppendComposerText,
        onClose: () => undefined,
        onCreateBranch: handleCreateBranch,
        onOpenWorkspacePath: handleOpenWorkspacePath,
        onRefreshDiff: handleRefreshDiff,
        onReviewTabStateChange: setReviewTabState,
        onToggleReviewView: () => setReviewView(reviewView === 'inline' ? 'split' : 'inline'),
      },
      browser: {
        availability: {
          status: browserAvailability,
          ...(browserAvailability === 'unavailable'
            ? {
                reason: '当前环境未连接桌面浏览器宿主。',
              }
            : {}),
        },
        state: browserState,
        threadId: sessionId,
        onNewTab: handleOpenBrowser,
        draftKey: mainComposerDraftKey,
        onAppendImage: handleBrowserImage,
        onOpenSettings: () => navigate('/settings/browser'),
        onStateChange: setBrowserState,
      },
      files: {
        files: workspaceFiles,
        selectedFile,
        workspace: currentWorkspace,
        onOpenFileFromBrowser: (file) => handleOpenFileFromBrowser('right', file),
        onPreviewFile: (file) => handleOpenFilePreview('right', file),
        onAppendComposerText: handleAppendComposerText,
        onAddComposerFiles: handleAddComposerFiles,
        onPinFileTab: pinTab,
        onSetFileMarkdownViewMode: setFileMarkdownViewMode,
        onSetFileViewState: setFileViewState,
        onAskInSideChat: sideChatSupported ? handleAppendSideChatText : undefined,
        onLoadError: (tab, error, phase) =>
          handleFileLoadError({ error, phase, tab, target: 'right' }),
      },
      planContentByEventId,
      plan: { onOpenPlan: handleOpenPlanDock },
      sideChat: {
        activeTabId: null,
        available: sideChatSupported,
        focusVersion: sideChatFocusVersion,
        isCreating: isCreatingSideChat,
        getPermissionMode: (tab) => getSideChatSettings(tab.id).permissionMode,
        getModelSelection: (tab) => getSideChatSettings(tab.id),
        onInteractionError: (message) => setErrorMessage(message),
        itemContext: (tab, status) => ({
          modelProviderNames: Object.fromEntries(
            modelProviders.map((provider) => [provider.providerID, provider.displayName]),
          ),
          canCopyFileReferenceContents: canCopyMarkdownFileReferenceContents,
          onCopyFileReferenceContents: handleCopyMarkdownFileReferenceContents,
          onOpenFileReference: handleOpenMarkdownFileReference,
          onOpenAttachment: handleOpenThreadAttachment,
          onOpenLocalContext: handleOpenThreadLocalContext,
          canEditUserMessage: desktopClient.supportsMessageEditing?.() ?? false,
          onSubmitEditedUserMessage: async (input, target) => {
            if (!desktopClient.editUserMessage) throw new Error('当前会话不支持修改消息')
            await desktopClient.editUserMessage(tab.threadId, target, input)
          },
          sessionStatus: status,
          workspacePath: currentWorkspace?.path ?? null,
        }),
        onOpenPatchReview: handleOpenPatchReview,
        onOpenPlan: handleOpenPlanDock,
        onStateChange: reportSideChatState,
        renderComposer: renderSideChatComposer,
        onRecreate: () => void createSideChat(),
      },
      sideTask: {
        activeTaskId: activeSideTaskId,
        availability: {
          status: subagentAvailability,
          ...(subagentAvailability === 'unavailable'
            ? { reason: '当前 Agent 不支持子智能体工作台。' }
            : {}),
        },
        content: subagentThreadContent,
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
        cwd: currentWorkspace?.path ?? null,
        onDisplayPathChange: () => undefined,
      },
    }),
    [
      activeSideTaskId,
      browserAvailability,
      browserState,
      canCopyMarkdownFileReferenceContents,
      createSideChat,
      currentWorkspace,
      derivedDefaultBranch,
      diffMarkerStyle,
      gitStatus,
      handleAddComposerFiles,
      handleAppendComposerText,
      handleAppendSideChatText,
      mainComposerDraftKey,
      handleBrowserImage,
      handleOpenBrowser,
      handleCopyMarkdownFileReferenceContents,
      handleCreateBranch,
      handleFileLoadError,
      handleOpenFileFromBrowser,
      handleOpenFilePreview,
      handleOpenMarkdownFileReference,
      handleOpenPatchReview,
      handleOpenPlanDock,
      handleOpenThreadAttachment,
      handleOpenThreadLocalContext,
      handleOpenWorkspacePath,
      handleRefreshDiff,
      isCreatingSideChat,
      modelProviders,
      pinTab,
      planContentByEventId,
      renderSideChatComposer,
      reportSideChatState,
      reviewTabState,
      reviewView,
      selectedFile,
      sessionId,
      sessionStatus,
      setBrowserState,
      setErrorMessage,
      setFileMarkdownViewMode,
      setFileViewState,
      setReviewTabState,
      setReviewView,
      sideChatFocusVersion,
      sideChatSubmitToSession,
      sideChatSupported,
      subagentAvailability,
      subagentThreadContent,
      terminalAvailable,
      workspaceFiles,
    ],
  )

  const closeSidebarPreview = sidebarShell.closePreview
  // 保持元素身份，工作区布局更新无需重新遍历侧栏；侧栏自身订阅仍正常更新。
  const appSidebarContent = useMemo(
    () => (
      <DesktopSidebar
        active={displayedSidebarPane === 'chats' || displayedSidebarPane === 'activity'}
        pane={retainedTaskPane}
        activeSessionId={sessionId}
        catalogStatus={catalogStatus}
        pendingPermissionSessionIds={pendingPermissionSessionIds}
        titleLoadingIds={titleLoadingIds}
        recentWorkspaces={recentWorkspaces}
        removedWorkspaces={removedWorkspaces}
        sessionFallbackTitles={sidebarSessionFallbackTitles}
        sessions={sessions}
        unavailableWorkspacePaths={unavailableWorkspacePaths}
        workspace={currentWorkspace}
        onChooseWorkspace={() => void handleChooseWorkspace()}
        onCreateSession={(workspaceItem) => {
          closeSidebarPreview()
          void handleCreateSession(workspaceItem)
        }}
        onOpenCommandMenu={() => setCommandMenuOpen(true)}
        onOpenWhatsNew={openWhatsNewDialog}
        onPinWorkspace={handlePinWorkspace}
        onRemoveWorkspace={handleRemoveWorkspace}
        onUnpinWorkspace={handleUnpinWorkspace}
        onSelectSession={(session) => {
          closeSidebarPreview()
          handleSelectSession(session)
        }}
        onArchiveSessions={handleArchiveSessions}
        onRenameSession={async (targetSessionId, title) =>
          Boolean(await renameSession(targetSessionId, title))
        }
        onError={handleErrorMessage}
        onReport={setNoticeMessage}
        dockedPanesState={workbenchPanelState.sidebar}
        dockedTabsById={workbenchPanelState.tabsById}
        workspaceFiles={workspaceFiles}
        onSelectDockedTab={(tabId) => handleSelectPanelTab('sidebar', tabId)}
        onCloseDockedTab={(tabId) => closePanelTab('sidebar', tabId)}
        onMoveDockedTab={movePanelTab}
        onPopOutDockedTab={popOutPanelTab}
        onOpenFile={(file) => handleOpenFilePreview('sidebar', file)}
        onAddComposerFiles={handleAddComposerFiles}
      />
    ),
    [
      displayedSidebarPane,
      retainedTaskPane,
      sessionId,
      catalogStatus,
      pendingPermissionSessionIds,
      titleLoadingIds,
      recentWorkspaces,
      removedWorkspaces,
      sidebarSessionFallbackTitles,
      sessions,
      unavailableWorkspacePaths,
      currentWorkspace,
      handleChooseWorkspace,
      closeSidebarPreview,
      handleCreateSession,
      setCommandMenuOpen,
      openWhatsNewDialog,
      handlePinWorkspace,
      handleRemoveWorkspace,
      handleUnpinWorkspace,
      handleSelectSession,
      handleArchiveSessions,
      renameSession,
      handleErrorMessage,
      setNoticeMessage,
      workbenchPanelState.sidebar,
      workbenchPanelState.tabsById,
      workspaceFiles,
      handleSelectPanelTab,
      closePanelTab,
      movePanelTab,
      popOutPanelTab,
      handleOpenFilePreview,
      handleAddComposerFiles,
    ],
  )

  const sidebar = (
    <SidebarFrame
      rail={
        <SidebarNavigationRail
          shell={sidebarShell}
          activePane={activeSidebarPane}
          capabilityState={sidebarCapabilities}
          onOpenWhatsNew={openWhatsNewDialog}
          onReport={setNoticeMessage}
        />
      }
      collapsed={sidebarCollapsed}
      contentKind={isSettingsRoute ? 'settings' : 'tasks'}
      defaultWidth={340}
      maxWidth={sidebarMaxWidth}
      minWidth={sidebarMinWidth}
      width={sidebarWidth}
      onCollapse={collapseSidebar}
      onSetWidth={setSidebarWidth}
      shell={sidebarShell}
    >
      <div
        className="sidebar-panel-content"
        hidden={
          displayedSidebarPane === 'git' ||
          displayedSidebarPane === 'settings' ||
          displayedSidebarPane === 'scheduled' ||
          displayedSidebarPane === 'plugins' ||
          displayedSidebarPane === 'providers' ||
          displayedSidebarPane === 'pets' ||
          displayedSidebarPane === null
        }
      >
        {appSidebarContent}
      </div>
      <div className="sidebar-panel-content" hidden={displayedSidebarPane !== 'settings'}>
        {settingsSidebarContent}
      </div>
      {displayedSidebarPane === 'git' ? (
        <div className="sidebar-panel-content">
          <MemoGitBoardSidebar
            sessions={sessions}
            onArchiveSessions={handleArchiveSessions}
            onRemoveWorkspace={handleRemoveWorkspace}
            onReport={setNoticeMessage}
          />
        </div>
      ) : null}
      {scheduledSidebarMounted ? (
        <div className="sidebar-panel-content" hidden={displayedSidebarPane !== 'scheduled'}>
          <MemoSidebarScheduledPane />
        </div>
      ) : null}
      {pluginsSidebarMounted ? (
        <div className="sidebar-panel-content" hidden={displayedSidebarPane !== 'plugins'}>
          <MemoSidebarPluginsPane workspacePath={currentWorkspace?.path ?? null} />
        </div>
      ) : null}
      {providersSidebarMounted ? (
        <div className="sidebar-panel-content" hidden={displayedSidebarPane !== 'providers'}>
          <MemoSidebarProvidersPane />
        </div>
      ) : null}
      {petsSidebarMounted ? (
        <div className="sidebar-panel-content" hidden={displayedSidebarPane !== 'pets'}>
          <MemoSidebarPetsPane />
        </div>
      ) : null}
    </SidebarFrame>
  )

  const composerProps = useMemo<SessionBoundComposerProps | null>(
    () =>
      isQuickChatPage || isConversationRoute
        ? {
            inputBinding,
            messages: isConversationRoute ? [] : messages,
            placement: isQuickChatPage ? 'new-session' : 'thread',
            layout: 'multiline',
            radiusVariant: 'default',
            utilityBarVariant: isQuickChatPage ? 'home' : 'default',
            draftKey: mainComposerDraftKey,
            routedSessionId,
            sessionStatus,
            permissionMode: effectivePermissionMode,
            planModeActive,
            grillModeActive,
            enableAutoReviewPermissionMode: enableAutoReviewPermissionMode ?? false,
            enableFullAccessPermissionMode: enableFullAccessPermissionMode ?? false,
            codingModel,
            thinkingMode: session.modelSelection?.thinkingMode ?? 'default',
            modelVariant: selectedVariant,
            modelVariantOptions: variantOptions,
            onModelVariantChange: handleVariantChange,
            modelSelectionError: session.modelSelectionError ?? selectedModelUnavailableMessage,
            threadGoal: activeSessionItem?.threadGoal ?? null,
            onGoalPause: handleGoalPause,
            onGoalResume: handleGoalResume,
            onGoalComplete: handleGoalComplete,
            onGoalClear: handleGoalClear,
            onRetryModelSelection: () => {
              session.reloadModelSelection()
              void refreshProviderState()
            },
            selectedProviderID,
            selectedModelPreset: resolvedSelectedModelPreset,
            modelConfigured: modelConfigured && (!routedSessionId || routedSessionId === sessionId),
            modelCatalogLoading: modelCatalogLoading || session.modelSelectionLoading,
            selectedModelMetadata,
            showThinkingOptions,
            deepSeekThinkingControls,
            showContextUsage,
            contextUsage: isConversationRoute ? null : contextUsage,
            modelPresets: selectedProviderModelPresets,
            providerOptions: providerModelOptions,
            allProviders: modelProviders,
            recentWorkspaces,
            contextTasks: composerContextTasks,
            browserContext: composerBrowserContext,
            workspace: currentWorkspace,
            attachments: composerAttachments,
            onAttachmentsChange: setComposerAttachments,
            onAppendAttachmentsForDraft: appendComposerAttachmentsForDraft,
            onRemoveAttachmentForDraft: removeComposerAttachmentForDraft,
            onOpenAttachment: handleOpenDraftAttachment,
            onDraftAccepted: clearComposerDraftIfUnchanged,
            onChooseWorkspace: handleChooseWorkspace,
            onInputChange: inputBinding.replace,
            onInterrupt: interrupt,
            readPathname: () => location.pathname,
            onProviderModelChange: handleProviderModelChange,
            onProviderOpen: handleProviderOpen,
            onProviderSearch: handleProviderSearch,
            onOpenWorkspace: handleOpenRecentWorkspace,
            onCloneGithub: () => setGithubRepositoryModalOpen(true),
            onClearWorkspace: handleClearWorkspace,
            onOpenMcpSettings: () => navigate('/settings/plugins?tab=mcps'),
            onOpenModelSettings: () => navigate('/providers'),
            onOpenSideChat: sideChatSupported ? handleOpenSideChat : undefined,
            onSkillTokenActivate: (invocation) => {
              void handleActivateComposerSkill(invocation)
            },
            onBranchSelect: handleBranchSelect,
            onCreateBranch: handleCreateBranch,
            onStartReview: handleStartAiReview,
            onPermissionChange: handlePermissionChange,
            onPlanModeChange: handlePlanModeChange,
            onGrillModeChange: handleGrillModeChange,
            onThinkingChange: handleThinkingChange,
            createSessionForWorkspace,
            submitToSession,
            onError: handleErrorMessage,
            queuedFollowUps,
            queuePauseReason,
            onFollowUpEdit: (followUpId, value) => void handleFollowUpEdit(followUpId, value),
            onFollowUpRemove: (followUpId) => void handleFollowUpRemove(followUpId),
            onFollowUpResume: () => void handleFollowUpResume(),
          }
        : null,
    [
      isQuickChatPage,
      isConversationRoute,
      inputBinding,
      messages,
      mainComposerDraftKey,
      routedSessionId,
      sessionStatus,
      effectivePermissionMode,
      planModeActive,
      grillModeActive,
      enableAutoReviewPermissionMode,
      enableFullAccessPermissionMode,
      codingModel,
      session.modelSelection?.thinkingMode,
      selectedVariant,
      variantOptions,
      handleVariantChange,
      session.modelSelectionError,
      selectedModelUnavailableMessage,
      activeSessionItem,
      handleGoalPause,
      handleGoalResume,
      handleGoalComplete,
      handleGoalClear,
      session.reloadModelSelection,
      refreshProviderState,
      selectedProviderID,
      resolvedSelectedModelPreset,
      modelConfigured,
      sessionId,
      modelCatalogLoading,
      session.modelSelectionLoading,
      selectedModelMetadata,
      showThinkingOptions,
      deepSeekThinkingControls,
      showContextUsage,
      contextUsage,
      selectedProviderModelPresets,
      providerModelOptions,
      modelProviders,
      recentWorkspaces,
      composerContextTasks,
      composerBrowserContext,
      currentWorkspace,
      composerAttachments,
      setComposerAttachments,
      appendComposerAttachmentsForDraft,
      removeComposerAttachmentForDraft,
      handleOpenDraftAttachment,
      clearComposerDraftIfUnchanged,
      handleChooseWorkspace,
      interrupt,
      location,
      handleProviderModelChange,
      handleProviderOpen,
      handleProviderSearch,
      handleOpenRecentWorkspace,
      setGithubRepositoryModalOpen,
      handleClearWorkspace,
      navigate,
      sideChatSupported,
      handleOpenSideChat,
      handleActivateComposerSkill,
      handleBranchSelect,
      handleCreateBranch,
      handleStartAiReview,
      handlePermissionChange,
      handlePlanModeChange,
      handleGrillModeChange,
      handleThinkingChange,
      createSessionForWorkspace,
      submitToSession,
      handleErrorMessage,
      queuedFollowUps,
      queuePauseReason,
      handleFollowUpEdit,
      handleFollowUpRemove,
      handleFollowUpResume,
    ],
  )

  const quickChatContextValue = useMemo<React.ContextType<typeof QuickChatContext>>(
    () => ({
      isConversationRoute,
      isConversationLoading,
      activeSessionId: activeSessionItem?.id ?? null,
      activeSessionPinnedAt: activeSessionItem
        ? (sidebarSessionPins[activeSessionItem.id] ?? null)
        : null,
      sessionTitle: quickChatSessionTitle,
      editableSessionTitle: quickChatEditableSessionTitle,
      titleRegenerating: regeneratingActiveSessionTitle,
      projectDetailsTrigger:
        isConversationRoute && !isConversationLoading && activeSessionItem?.id === sessionId ? (
          <ConversationProjectDetails
            session={activeSessionItem}
            currentWorkspace={currentWorkspace}
            projects={recentWorkspaces}
            sessions={sessions}
            unavailableWorkspacePaths={unavailableWorkspacePaths}
            onPinWorkspace={handlePinWorkspace}
            onUnpinWorkspace={handleUnpinWorkspace}
            onRemoveWorkspace={handleRemoveWorkspace}
            onArchiveSessions={handleArchiveSessions}
            onReport={setNoticeMessage}
          />
        ) : null,
      workspaceName: currentWorkspace?.name ?? null,
      workspacePath: currentWorkspace?.path ?? null,
      activeProjectId: currentWorkspace?.projectId ?? null,
      branchName,
      branches: currentWorkspace?.branches ?? EMPTY_BRANCHES,
      diff: workspace.diff,
      gitStatus,
      gitDetection,
      reviewSource: reviewTabState.source,
      reviewSummary:
        publishedReviewSummary?.workspacePath === currentWorkspace?.path
          ? publishedReviewSummary?.snapshot
          : null,
      recentWorkspaces,
      recentTasks: quickChatRecentTasks,
      onArchiveSession: () => {
        if (!activeSessionItem) return
        void handleArchiveSessions([activeSessionItem.id])
      },
      onCreateBranch: handleCreateBranch,
      onOpenAutomation: () => navigate('/automations'),
      onOpenWorkspacePath: handleOpenWorkspacePath,
      onOpenRightDock: (_tool, source) => {
        if (source)
          setReviewTabState((current) => ({
            ...current,
            source,
            selectedFile: null,
            selectedCommentId: null,
            scrollTop: 0,
            diffExpansion: { mode: 'all' },
          }))
        handleOpenReview()
      },
      onOpenPatchReview: handleOpenPatchReview,
      onOpenPlanInRightDock: handleOpenPlanDock,
      canCopyFileReferenceContents: canCopyMarkdownFileReferenceContents,
      onCopyFileReferenceContents: handleCopyMarkdownFileReferenceContents,
      onOpenFileReference: handleOpenMarkdownFileReference,
      onOpenAttachment: handleOpenThreadAttachment,
      onOpenLocalContext: handleOpenThreadLocalContext,
      onOpenArtifact: handleOpenArtifact,
      onActivateBrowserTab: handleActivateBrowserTab,
      browserTabs,
      threadGoal: activeSessionItem?.threadGoal ?? null,
      onGoalPause: handleGoalPause,
      onGoalResume: handleGoalResume,
      onSubmitEditedUserMessage: handleSubmitEditedUserMessage,
      onAppendComposerText: handleAppendComposerText,
      onAppendSideChatText: handleAppendSideChatText,
      onOpenSideChat: handleOpenSideChat,
      sideChatAvailable: sideChatSupported,
      onOpenSubagent: handleOpenSubagent,
      onAddComposerFiles: handleAddComposerFiles,
      onRefreshDiff: handleRefreshDiff,
      onRenameSession: async (title) => {
        const targetSessionId = activeSessionItem?.id
        if (!targetSessionId) return false
        return Boolean(await renameSession(targetSessionId, title))
      },
      onRefreshSessionTitle: async () =>
        activeSessionItem ? regenerateSessionTitle(activeSessionItem.id) : false,
      onToggleSidebar: toggleSidebarCollapsed,
      onToggleSessionPinned: () => {
        if (!activeSessionItem) return
        setSidebarSessionPins((current) => {
          if (current[activeSessionItem.id]) {
            const { [activeSessionItem.id]: _removed, ...next } = current
            return next
          }
          return {
            ...current,
            [activeSessionItem.id]: new Date().toISOString(),
          }
        })
      },
      onCommitOrPush: handleCommitOrPush,
      onGitOperation: (operation) => setGitWorkflowMode(operation),
      onOpenTerminal: () => {
        if (!terminalVisible) toggleIntegratedTerminal()
      },
      onCreatePullRequest: handleCreatePullRequest,
      onChooseWorkspace: handleChooseWorkspace,
      onCloneGithub: () => setGithubRepositoryModalOpen(true),
      onOpenWorkspace: handleOpenRecentWorkspace,
      onBranchSelect: handleBranchSelect,
      onClearWorkspace: handleClearWorkspace,
      onDecidePermission: (request, behavior, alwaysAllow, updatedInput, decisionExtras) => {
        return decidePermission(request, behavior, alwaysAllow, updatedInput, decisionExtras)
      },
      permissionMode: effectivePermissionMode,
      planModeActive,
      providerModelOptions,
      sessionStatus,
      composerProps: isConversationLoading && !isPendingSubmissionRoute ? null : composerProps,
      composerDraft: {
        store: inputBinding.store,
        replace: inputBinding.replace,
      },
      bottomPanelVisible: effectiveBottomPanelVisible,
      layoutResizeActive: rightResizePhase !== 'idle',
      onToggleBottomPanel: isHomeOrConversationRoute ? toggleBottomPanelVisible : () => undefined,
      dockedPlanItemId,
    }),
    [
      isConversationRoute,
      isConversationLoading,
      activeSessionItem,
      sidebarSessionPins,
      quickChatSessionTitle,
      quickChatEditableSessionTitle,
      regeneratingActiveSessionTitle,
      sessionId,
      currentWorkspace,
      recentWorkspaces,
      sessions,
      unavailableWorkspacePaths,
      handlePinWorkspace,
      handleUnpinWorkspace,
      handleRemoveWorkspace,
      handleArchiveSessions,
      setNoticeMessage,
      branchName,
      workspace.diff,
      gitStatus,
      gitDetection,
      reviewTabState.source,
      publishedReviewSummary,
      quickChatRecentTasks,
      handleCreateBranch,
      navigate,
      handleOpenWorkspacePath,
      setReviewTabState,
      handleOpenReview,
      handleOpenPatchReview,
      handleOpenPlanDock,
      canCopyMarkdownFileReferenceContents,
      handleCopyMarkdownFileReferenceContents,
      handleOpenMarkdownFileReference,
      handleOpenThreadAttachment,
      handleOpenThreadLocalContext,
      handleOpenArtifact,
      handleActivateBrowserTab,
      browserTabs,
      handleGoalPause,
      handleGoalResume,
      handleSubmitEditedUserMessage,
      handleAppendComposerText,
      handleAppendSideChatText,
      handleOpenSideChat,
      sideChatSupported,
      handleOpenSubagent,
      handleAddComposerFiles,
      handleRefreshDiff,
      renameSession,
      regenerateSessionTitle,
      toggleSidebarCollapsed,
      setSidebarSessionPins,
      handleCommitOrPush,
      setGitWorkflowMode,
      terminalVisible,
      toggleIntegratedTerminal,
      handleCreatePullRequest,
      handleChooseWorkspace,
      setGithubRepositoryModalOpen,
      handleOpenRecentWorkspace,
      handleBranchSelect,
      handleClearWorkspace,
      decidePermission,
      effectivePermissionMode,
      planModeActive,
      providerModelOptions,
      sessionStatus,
      isPendingSubmissionRoute,
      composerProps,
      inputBinding,
      effectiveBottomPanelVisible,
      rightResizePhase,
      isHomeOrConversationRoute,
      toggleBottomPanelVisible,
      dockedPlanItemId,
    ],
  )

  const rightDockNode = renderWorkbenchPanel('right')
  const bottomPanelNode = renderWorkbenchPanel('bottom')

  return (
    <AutomationControllerProvider
      enabled={location.pathname === '/automations' || scheduledSidebarMounted}
    >
      <div
        className="desktop-frame tw:flex tw:h-screen tw:min-h-0 tw:w-full tw:flex-col tw:overflow-hidden tw:bg-app-canvas tw:text-app-text"
        ref={
          location.pathname !== '/new' && location.pathname !== '/'
            ? startupSurfaceReadyRef
            : undefined
        }
      >
        <a
          className="skip-to-main"
          href="#desktop-main-content"
          onClick={(event) => {
            event.preventDefault()
            mainRouteRef.current?.focus()
            mainRouteRef.current?.scrollIntoView({ block: 'start' })
          }}
        >
          跳到主要内容
        </a>
        <span aria-atomic="true" aria-live="polite" className="tw:sr-only">
          已进入{routeLabel}
        </span>
        {globalMessageModalMounted ? (
          <Suspense fallback={null}>
            <GlobalErrorModal message={errorMessage} onDismiss={() => setErrorMessage(null)} />
            <GlobalErrorModal
              message={noticeMessage}
              tone="status"
              onDismiss={() => setNoticeMessage(null)}
            />
          </Suspense>
        ) : null}
        {gitWorkflowModalMounted ? (
          <Suspense fallback={null}>
            <GitWorkflowModal
              allowForcePush={allowForcePush}
              commitMessagePrompt={commitMessagePrompt}
              gitBranchPrefix={gitBranchPrefix}
              gitStatus={gitStatus}
              mode={gitWorkflowMode}
              threadId={sessionId}
              pullRequestPrompt={pullRequestPrompt}
              workspace={currentWorkspace}
              onClose={() => setGitWorkflowMode(null)}
              onError={(message) => setErrorMessage(message)}
              onRefreshWorkspace={async () => {
                if (currentWorkspace) {
                  await refreshWorkspace(currentWorkspace, {
                    clearSelectedFile: false,
                    force: true,
                    refreshGitStatus: true,
                  })
                }
              }}
              onWorkspaceChanged={handleWorkspaceChanged}
            />
          </Suspense>
        ) : null}
        {githubRepositoryModalMounted ? (
          <Suspense fallback={null}>
            <GithubRepositoryModal
              open={githubRepositoryModalOpen}
              onClose={() => setGithubRepositoryModalOpen(false)}
              onError={(message) => setErrorMessage(message)}
              onWorkspaceCloned={handleGithubWorkspaceCloned}
            />
          </Suspense>
        ) : null}
        {whatsNewDialogMounted ? (
          <Suspense fallback={null}>
            <WhatsNewDialog
              open={whatsNewDialogOpen}
              restoreFocusElement={whatsNewRestoreFocusElement}
              onOpenChange={setWhatsNewDialogOpen}
            />
          </Suspense>
        ) : null}
        {commandMenuDialogMounted ? (
          <CommandMenuDialog
            catalogStatus={catalogStatus}
            hasWorkspace={currentWorkspace !== null}
            inputRef={commandMenuInputRef}
            open={commandMenuOpen}
            pendingPermissionSessionIds={pendingPermissionSessionIds}
            sessions={sessions}
            onCreateTask={() => {
              setCommandMenuOpen(false)
              void handleCreateSession()
            }}
            onOpenChange={setCommandMenuOpen}
            onOpenFolder={() => {
              setCommandMenuOpen(false)
              void handleChooseWorkspace()
            }}
            onSearchFiles={() => {
              if (currentWorkspace === null) return
              setCommandMenuOpen(false)
              handleOpenFilesDock()
            }}
            onSelectTask={(task) => {
              setCommandMenuOpen(false)
              handleSelectSession(task.session)
            }}
          />
        ) : null}
        {archiveNoticeVisible ? (
          <ArchiveConversationNotice
            undoing={undoingArchive}
            onUndo={
              archiveUndo
                ? () => {
                    setUndoingArchive(true)
                    void archiveUndo()
                      .catch((error) =>
                        setErrorMessage(error instanceof Error ? error.message : String(error)),
                      )
                      .finally(() => setUndoingArchive(false))
                  }
                : undefined
            }
            onClose={() => setArchiveNoticeVisible(false)}
            onOpenSettings={() => {
              setArchiveNoticeVisible(false)
              navigate('/settings/archived')
            }}
          />
        ) : null}
        {closeConfirmationDialogMounted ? (
          <Suspense fallback={null}>
            <ConfirmationDialog
              actionLabel="关闭侧边聊天"
              description="这个侧边聊天将被删除，且无法恢复。你确定吗？"
              open={closeConfirmationOpen}
              suppression={{
                checked: skipCloseConfirmation,
                label: '不再询问',
                onCheckedChange: setSkipCloseConfirmation,
              }}
              title="关闭侧边聊天？"
              tone="danger"
              onAction={confirmSideChatClose}
              onCancel={cancelSideChatClose}
            />
          </Suspense>
        ) : null}

        <QuickChatContext.Provider value={quickChatContextValue}>
          <WorkspaceHeaderProvider routeScope={location.pathname}>
            <WorkbenchShellView
              menuBar={menuBar}
              primarySidebar={sidebar}
              appBodyRef={sidebarShell.appBodyRef}
              workspaceRef={workspaceRef}
              workspaceStyle={
                {
                  '--sidebar-w': sidebarShell.dockedVisible
                    ? `${sidebarWidth}px`
                    : `${SIDEBAR_RAIL_WIDTH}px`,
                } as React.CSSProperties
              }
              workspaceHeader={
                isHomeOrConversationRoute || isProviderDetailRoute ? (
                  <DesktopWorkspaceHeader
                    divider={isConversationRoute}
                    rightDockOpen={effectiveRightDockVisible}
                    shellControls={
                      isHomeOrConversationRoute ? (
                        <WorkspaceShellControls
                          terminalAvailable={terminalAvailable}
                          terminalVisible={terminalVisible}
                          workspaceLayout={workspaceLayout}
                          showBottomPanel={isHomeOrConversationRoute}
                          showRightPanel={isHomeOrConversationRoute}
                          onStepWorkspaceLayout={stepWorkspaceLayout}
                          onToggleTerminal={toggleIntegratedTerminal}
                        />
                      ) : (
                        <div className="workspace-shell-controls">
                          <Button
                            isIconOnly
                            aria-pressed={visibleProviderTab !== null}
                            className="workspace-shell-control-button"
                            color="ghostSecondary"
                            size="toolbar"
                            title={visibleProviderTab ? '隐藏右侧边栏' : '显示右侧边栏'}
                            onClick={() => {
                              if (visibleProviderTab) closeProviderManagement()
                              else if (providerRouteId)
                                openProviderManagement(providerRouteId, 'credentials')
                            }}
                          >
                            <RightPanelToggleIcon open={visibleProviderTab !== null} />
                          </Button>
                        </div>
                      )
                    }
                  />
                ) : null
              }
              mainContent={
                <div
                  aria-label="主要内容"
                  ref={mainRouteRef}
                  className="desktop-main-route tw:flex tw:min-w-0 tw:min-h-0 tw:flex-auto tw:flex-col tw:overflow-hidden"
                  id="desktop-main-content"
                  tabIndex={-1}
                  role="region"
                >
                  {isHomeOrConversationRoute || isProviderDetailRoute ? (
                    <div
                      aria-hidden="true"
                      className="desktop-main-route__header-spacer tw:h-[var(--workspace-header-height)] tw:min-h-[var(--workspace-header-height)] tw:w-full tw:shrink-0 tw:grow-0 tw:basis-[var(--workspace-header-height)] tw:pointer-events-none"
                    />
                  ) : null}
                  <div className="desktop-main-route__body tw:flex tw:w-full tw:min-w-0 tw:min-h-0 tw:flex-auto tw:justify-center tw:overflow-hidden">
                    {taskNotificationState.attention.length ? (
                      <div
                        role="status"
                        aria-label="任务强提醒"
                        className="tw:flex tw:flex-wrap tw:gap-2 tw:border-b tw:border-app-border-subtle tw:p-2"
                      >
                        <Button color="secondary" onClick={() => navigate('/automations')}>
                          需要你处理 · {taskNotificationState.attention.length}
                        </Button>
                        {taskNotificationState.attention.slice(0, 3).map((occurrence) => (
                          <Button
                            key={occurrence.id}
                            color="secondary"
                            onClick={() =>
                              navigate(
                                `/automations?taskId=${encodeURIComponent(occurrence.taskId)}&occurrenceId=${encodeURIComponent(occurrence.id)}`,
                              )
                            }
                          >
                            {occurrence.snapshot.name} ·{' '}
                            {occurrence.attention === 'awaiting-acceptance'
                              ? '待验收'
                              : '到期待处理'}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                    <TaskConversationLinks
                      threadId={
                        location.pathname.startsWith('/threads/')
                          ? (activeSessionItem?.appServerThreadId ?? activeSessionItem?.id ?? null)
                          : null
                      }
                      state={taskNotificationState}
                    />
                    <Outlet context={outletContext} />
                  </div>
                </div>
              }
              auxiliaryPanel={
                <WorkbenchPanelPresence
                  keepMounted
                  liveResize={rightPanelLiveResize}
                  mainRouteRef={mainRouteRef}
                  workspaceRef={workspaceRef}
                  minSize={rightDockMinWidth}
                  size={rightPanelCommittedSize}
                  target="right"
                  visible={effectiveRightDockVisible}
                  onResizePhaseChange={setRightResizePhase}
                >
                  {rightDockNode}
                </WorkbenchPanelPresence>
              }
              bottomPanel={
                <WorkbenchPanelPresence
                  liveResize={bottomPanelLiveResize}
                  mainRouteRef={mainRouteRef}
                  workspaceRef={workspaceRef}
                  minSize={bottomPanelMinHeight}
                  size={bottomPanelHeight}
                  target="bottom"
                  visible={effectiveBottomPanelVisible}
                >
                  {bottomPanelNode}
                </WorkbenchPanelPresence>
              }
              primarySidebarVisible={
                workbenchLayoutState?.visibility.primarySidebar ?? !sidebarCollapsed
              }
              auxiliaryPanelVisible={effectiveRightDockVisible}
              bottomPanelVisible={effectiveBottomPanelVisible}
              workspaceLayout={workspaceLayout}
              resizeActive={rightResizePhase !== 'idle'}
            />
          </WorkspaceHeaderProvider>
        </QuickChatContext.Provider>
        <AuxiliaryWindowsHost
          floatingTabIds={workbenchPanelState.floatingTabIds}
          tabsById={workbenchPanelState.tabsById}
          panelContext={auxiliaryPanelContext}
          onDockBack={dockBackPanelTab}
        />
      </div>
    </AutomationControllerProvider>
  )
}

function ArchiveConversationNotice({
  onUndo,
  undoing,
  onClose,
  onOpenSettings,
}: {
  onClose: () => void
  onOpenSettings: () => void
  onUndo?: () => void
  undoing?: boolean
}): null {
  const onCloseRef = useRef(onClose)
  const onUndoRef = useRef(onUndo)
  const onOpenSettingsRef = useRef(onOpenSettings)

  useEffect(() => {
    onCloseRef.current = onClose
    onUndoRef.current = onUndo
    onOpenSettingsRef.current = onOpenSettings
  }, [onClose, onUndo, onOpenSettings])

  useEffect(() => {
    let active = true
    const id = toastStore.show({
      id: 'archive-conversation-notice',
      tone: 'status',
      appearance: 'action',
      dedupeKey: 'archive-conversation-notice',
      message: (
        <span className="tw:inline-flex tw:items-center tw:gap-3 tw:px-1.5 tw:type-heading-sm tw:whitespace-nowrap">
          <Archive
            aria-hidden="true"
            className="tw:size-[var(--inline-icon-size,1em)] tw:shrink-0"
            size="var(--inline-icon-size, 1em)"
          />
          已归档的聊天
        </span>
      ),
      action: {
        label: '查看',
        onClick: () => {
          onOpenSettingsRef.current()
        },
      },
      secondaryAction: onUndo
        ? {
            label: '撤销',
            disabled: undoing,
            onClick: () => {
              onUndoRef.current?.()
            },
          }
        : undefined,
      onDismiss: () => {
        if (active) onCloseRef.current()
      },
    })
    return () => {
      // StrictMode 重挂及撤销状态更新的清理不代表用户关闭。
      active = false
      toastStore.dismiss(id)
    }
  }, [onUndo !== undefined, undoing])

  return null
}
