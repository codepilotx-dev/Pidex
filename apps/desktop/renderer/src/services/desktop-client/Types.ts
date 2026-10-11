import type { DesktopStartupIpcBridge } from '@pidex/shared/desktop-startup-ipc'
import type {
  EventEnvelope,
  ProtocolCapability,
  RpcParams,
  RpcResult,
  ToolingID,
  ToolingPreference,
  ToolingStatus,
  PetCatalogResult,
  PetDescriptor,
  PetInstallPreview,
} from '@pidex/agent-protocol'
import type { DesktopPetOverlayBridge } from '@pidex/shared/desktop-pet-overlay'
import type { DesktopDataLocationIpcBridge } from '@pidex/shared/desktop-data-location-ipc'
import type { DesktopUpdateIpcBridge } from '@pidex/shared/desktop-update-ipc'
import type { DesktopTerminalIpcBridge } from '@pidex/shared/desktop-terminal-ipc'
import type { DesktopMicrophoneIpcBridge } from '@pidex/shared/desktop-microphone-ipc'
import type {
  SessionGroupChangedFile,
  SessionGroupCheckpoint,
  SessionGroupFailure,
  SessionGroupStepStatus,
  SessionGroupValidation,
} from '@pidex/shared/session-group'
import type {
  DesktopAttachmentIpcBridge,
  DesktopAttachmentSaveInput,
  DesktopAttachmentSaveResult,
  DesktopComposerPathListInput,
  DesktopComposerPathListResult,
  DesktopComposerPathPreview,
  DesktopComposerPathReadInput,
} from '@pidex/shared/desktop-attachment-ipc'
import type { DesktopBrowserIpcBridge } from '@pidex/shared/desktop-browser-ipc'
import type {
  DesktopOpenWindowInput,
  DesktopWindowIpcBridge,
} from '@pidex/shared/desktop-window-ipc'
import type { AgentRpcSubscription } from '../AgentRpcClient.js'
import type {
  DesktopApi,
  DesktopComposerAttachment,
  DesktopGitStatus,
  DesktopReviewSource,
  DesktopSessionSnapshot,
  DesktopStoredSettings,
  DesktopSystemFontsResult,
  DesktopThemeSettings,
  DesktopThreadBookmarkList,
} from '../../../shared/Types.js'

export type { DesktopThreadBookmarkList }

type DesktopClientWindow = {
  DesktopBridge?: {
    pickWorkspaceDirectory(): Promise<string | null>
    pickWorkspaceDirectories?(): Promise<string[]>
    getAppearanceSettings?(): Promise<DesktopThemeSettings>
    saveAppearanceSettings?(settings: DesktopThemeSettings): Promise<void>
    canRestorePreviousAppearance?(): Promise<boolean>
    restorePreviousAppearance?(): Promise<DesktopThemeSettings>
    applyNewDesignTheme?(): Promise<DesktopThemeSettings>
    listSystemFonts?(): Promise<DesktopSystemFontsResult>
    getDesktopSettings?(): Promise<DesktopStoredSettings>
    saveDesktopSettings?(settings: DesktopStoredSettings): Promise<DesktopStoredSettings>
    onDesktopSettingsChange?(
      listener: (change: DesktopStoredSettings | { settings: DesktopStoredSettings }) => void,
    ): () => void
    getSystemTheme?(): Promise<'light' | 'dark'>
    onSystemThemeChange?(listener: (theme: 'light' | 'dark') => void): () => void
    listExternalOpenTargets?(targetPath: string): Promise<
      Array<{
        targetId: string
        label: string
        kind: 'file-explorer' | 'terminal' | 'editor'
        iconDataUrl?: string
      }>
    >
    openPathWithTarget?(targetPath: string, targetId: string): Promise<void>
    revealPathInFolder?(targetPath: string): Promise<void>
  } & Partial<DesktopPetOverlayBridge> &
    Partial<DesktopWindowIpcBridge> &
    Partial<Pick<DesktopStartupIpcBridge, 'quitDuringStartup'>> &
    Partial<DesktopDataLocationIpcBridge> &
    Partial<DesktopTerminalIpcBridge> &
    Partial<DesktopUpdateIpcBridge> &
    Partial<DesktopAttachmentIpcBridge> &
    Partial<DesktopBrowserIpcBridge> &
    Partial<DesktopMicrophoneIpcBridge>
  addEventListener?: Window['addEventListener']
  removeEventListener?: Window['removeEventListener']
  dispatchEvent?: Window['dispatchEvent']
}

export type DesktopClientEnvironment = {
  window?: DesktopClientWindow
  localStorage?: Storage
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
  eventSourceFactory?: (url: string) => EventSource
  openExternal?: (url: string) => void | Promise<void>
  debugBridgePort?: number
  debugBridgeToken?: string
}

export type DesktopReviewAgentFileSummary = {
  path: string
  previousPath: string | null
  status:
    | 'added'
    | 'modified'
    | 'deleted'
    | 'renamed'
    | 'copied'
    | 'untracked'
    | 'type-changed'
    | 'unknown'
  additions: number | null
  deletions: number | null
  changedLines: number
  changedBytes: number
  binary: boolean
  revision: string
}

export type DesktopReviewAgentSummary = {
  projectId: string
  generation: string
  source: DesktopReviewSource
  repositoryRoot: string
  headSha: string | null
  baseSha: string | null
  files: DesktopReviewAgentFileSummary[]
  totals: {
    files: number
    additions: number
    deletions: number
    changedLines: number
    changedBytes: number
  }
  largeDiffMode: boolean
}

export type DesktopReviewAgentSummaryResult = {
  snapshot: DesktopReviewAgentSummary
  cacheState: 'fresh' | 'stale'
}

export type DesktopReviewAgentFileDiff = {
  file: DesktopReviewAgentFileSummary
  revision: string
  patch: string
  contextPatch?: string
  hunks: Array<{
    id: string
    header: string
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    patch: string
  }>
  renderable: boolean
  tooLargeReason: 'changed-lines' | 'changed-bytes' | 'line-bytes' | null
}

export type DesktopReviewAgentComment = {
  id: string
  threadId: string
  projectId: string
  sourceKey: string
  path: string
  side: 'old' | 'new'
  line: number
  hunkId: string | null
  revision: string
  body: string
  status: 'open' | 'resolved'
  githubCommentId: string | null
  githubThreadId: string | null
  createdAt: string
  updatedAt: string
}

export type DesktopAgentReviewApi = {
  getAgentReviewSummary(input: {
    projectId?: string
    workspacePath: string
    source: DesktopReviewSource
    refresh?: boolean
  }): Promise<DesktopReviewAgentSummaryResult>
  getAgentReviewFileDiff(input: {
    projectId?: string
    workspacePath: string
    source: DesktopReviewSource
    generation: string
    path: string
    hideWhitespace?: boolean
    loadFullFiles?: boolean
  }): Promise<DesktopReviewAgentFileDiff>
  getAgentReviewFileDiffs(input: {
    projectId?: string
    workspacePath: string
    source: DesktopReviewSource
    generation: string
    paths: readonly string[]
    hideWhitespace?: boolean
    loadFullFiles?: boolean
  }): Promise<RpcResult<'review/file-diffs'>>
  applyAgentReviewOperation(input: {
    projectId?: string
    workspacePath: string
    source: DesktopReviewSource
    generation: string
    expectedRevision: string
    action: 'stage' | 'unstage' | 'revert'
    target: { kind: 'file'; path: string } | { kind: 'hunk'; path: string; hunkId: string }
  }): Promise<void>
  applyAgentReviewBatch(input: {
    projectId?: string
    workspacePath: string
    source: DesktopReviewSource
    generation: string
    action: 'stage' | 'unstage' | 'revert'
    items: [
      { path: string; expectedRevision: string },
      ...Array<{ path: string; expectedRevision: string }>,
    ]
  }): Promise<RpcResult<'review/applyBatch'>>
  getAgentReviewBranches(
    workspacePath: string,
    projectId?: string,
  ): Promise<
    Array<{
      name: string
      sha: string
      current: boolean
      remote: boolean
      default?: boolean
    }>
  >
  getAgentReviewCommits(
    workspacePath: string,
    projectId?: string,
  ): Promise<
    Array<{
      sha: string
      shortSha: string
      subject: string
      author: string
      authoredAt: string
    }>
  >
  listAgentReviewComments(input: {
    projectId?: string
    workspacePath: string
    threadId: string
    sourceKey: string
  }): Promise<DesktopReviewAgentComment[]>
  saveAgentReviewComment(input: {
    projectId?: string
    id?: string
    workspacePath: string
    threadId: string
    sourceKey: string
    path: string
    side: 'old' | 'new'
    line: number
    hunkId: string | null
    revision: string
    body: string
    githubCommentId?: string
    githubThreadId?: string
  }): Promise<DesktopReviewAgentComment>
  resolveAgentReviewComment(input: {
    projectId?: string
    workspacePath: string
    threadId: string
    id: string
  }): Promise<DesktopReviewAgentComment>
  deleteAgentReviewComment(input: {
    projectId?: string
    workspacePath: string
    threadId: string
    id: string
  }): Promise<void>
  publishAgentGithubReviewComment(input: {
    source: Extract<DesktopReviewSource, { kind: 'pull-request' }>
    body: string
    path: string
    side: 'LEFT' | 'RIGHT'
    line: number
    expectedHeadRevision: string
    commitId?: string
  }): Promise<{ id: number; nodeId: string; htmlUrl: string }>
  submitAgentGithubReview(input: {
    source: Extract<DesktopReviewSource, { kind: 'pull-request' }>
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'
    expectedHeadRevision: string
    body?: string
  }): Promise<{ id: number; state: string; htmlUrl: string }>
}

export type DesktopAgentEventEnvelopeApi = {
  implementPlanFresh(
    params: RpcParams<'planApproval/implementFresh'>,
  ): Promise<RpcResult<'planApproval/implementFresh'>>
  readPlanApproval(params: RpcParams<'planApproval/read'>): Promise<RpcResult<'planApproval/read'>>
  respondPlanApproval(
    params: RpcParams<'planApproval/respond'>,
  ): Promise<RpcResult<'planApproval/respond'>>
  applyThreadPatch(
    params: Omit<RpcParams<'thread/patch/apply'>, 'operationId'>,
  ): Promise<RpcResult<'thread/patch/apply'>>
  readThreadHistoryPage(
    params: RpcParams<'thread/history/read'>,
  ): Promise<RpcResult<'thread/history/read'>>
  listPendingAgentInteractions(
    params: RpcParams<'interaction/listPending'>,
  ): Promise<RpcResult<'interaction/listPending'>>
  readThreadPatchDiff(
    params: RpcParams<'thread/patch/diff'>,
  ): Promise<RpcResult<'thread/patch/diff'>>
  subscribeAgentEventEnvelopes(
    options: AgentRpcSubscription,
    callback: (events: readonly EventEnvelope[]) => void | Promise<void>,
  ): () => void
}

export type DesktopAgentThreadTitleApi = {
  regenerateSessionTitle(sessionId: string): Promise<DesktopSessionSnapshot>
}

export type DesktopToolingApi = {
  listTooling(): Promise<readonly ToolingStatus[]>
  refreshTooling(): Promise<readonly ToolingStatus[]>
  setToolingPreference(id: ToolingID, preference: ToolingPreference): Promise<ToolingStatus>
  installTooling(id: ToolingID, force?: boolean): Promise<ToolingStatus>
  onToolingUpdated(callback: (status: ToolingStatus) => void): () => void
}

export type DesktopPetApi = {
  listPets(): Promise<readonly PetDescriptor[]>
  listPetCatalog(refresh?: boolean): Promise<PetCatalogResult>
  installCatalogPet(slug: string, acceptedRestrictedLicense?: boolean): Promise<PetDescriptor>
  previewPetInstall(url: string): Promise<PetInstallPreview>
  installPet(url: string): Promise<PetDescriptor>
  removePet(id: string): Promise<void>
}

export type DesktopUsageApi = {
  listUsageSources(): Promise<RpcResult<'usage/source/list'>>
  getLocalUsage(input: RpcParams<'usage/local/get'>): Promise<RpcResult<'usage/local/get'>>
  queryProviderUsage(
    input: RpcParams<'usage/provider/query'>,
  ): Promise<RpcResult<'usage/provider/query'>>
  connectUsageCredential(
    input: RpcParams<'usage/credential/connect'> extends infer Input
      ? Input extends unknown
        ? Omit<Input, 'operationId'>
        : never
      : never,
  ): Promise<RpcResult<'usage/credential/connect'>>
  disconnectUsageCredential(
    input: Omit<RpcParams<'usage/credential/disconnect'>, 'operationId'>,
  ): Promise<RpcResult<'usage/credential/disconnect'>>
}

export type DesktopReleaseNotesApi = {
  listReleaseNotes(options?: { refresh?: boolean }): Promise<RpcResult<'release-notes/list'>>
}

export type DesktopRuntimeCapabilityApi = {
  getRuntimeCapabilities(): Promise<readonly ProtocolCapability[]>
}

type WithoutOperationId<T> = T extends { operationId: unknown } ? Omit<T, 'operationId'> : T

export type DesktopAutomationApi = {
  listAutomations(input: RpcParams<'automation/list'>): Promise<RpcResult<'automation/list'>>
  readAutomation(input: RpcParams<'automation/read'>): Promise<RpcResult<'automation/read'>>
  createAutomation(
    input: WithoutOperationId<RpcParams<'automation/create'>>,
  ): Promise<RpcResult<'automation/create'>>
  updateAutomation(
    input: Pick<RpcParams<'automation/update'>, 'automationId' | 'expectedRevision'> & {
      patch: Omit<RpcParams<'automation/update'>, 'automationId' | 'expectedRevision'>
    },
  ): Promise<RpcResult<'automation/update'>>
  deleteAutomation(input: RpcParams<'automation/delete'>): Promise<RpcResult<'automation/delete'>>
  runAutomation(
    input: WithoutOperationId<RpcParams<'automation/run'>>,
  ): Promise<RpcResult<'automation/run'>>
  listAutomationRuns(
    input: RpcParams<'automation/run/list'>,
  ): Promise<RpcResult<'automation/run/list'>>
  markAutomationRunRead(
    input: RpcParams<'automation/run/mark-read'>,
  ): Promise<RpcResult<'automation/run/mark-read'>>
  markAllAutomationRunsRead(
    input: RpcParams<'automation/run/mark-all-read'>,
  ): Promise<RpcResult<'automation/run/mark-all-read'>>
  previewAutomationSchedule(
    input: RpcParams<'automation/schedule/preview'>,
  ): Promise<RpcResult<'automation/schedule/preview'>['preview']>
}

export type DesktopCalendarApi = {
  listCalendarOccurrences(input: RpcParams<'calendar/range'>): Promise<RpcResult<'calendar/range'>>
  readScheduledTask(
    input: RpcParams<'scheduled-task/read'>,
  ): Promise<RpcResult<'scheduled-task/read'>>
  createScheduledTask(
    input: WithoutOperationId<RpcParams<'scheduled-task/create'>>,
  ): Promise<RpcResult<'scheduled-task/create'>>
  updateScheduledTask(
    input: RpcParams<'scheduled-task/update'>,
  ): Promise<RpcResult<'scheduled-task/update'>>
  deleteScheduledTask(
    input: RpcParams<'scheduled-task/delete'>,
  ): Promise<RpcResult<'scheduled-task/delete'>>
  runScheduledTask(
    input: Omit<RpcParams<'scheduled-task/run'>, 'operationId'>,
  ): Promise<RpcResult<'scheduled-task/run'>>
  readSchedulePlan(input: RpcParams<'schedule-plan/read'>): Promise<RpcResult<'schedule-plan/read'>>
  commitSchedulePlan(
    input: Omit<RpcParams<'schedule-plan/commit'>, 'operationId'>,
  ): Promise<RpcResult<'schedule-plan/commit'>>
}

export type DesktopPluginApi = {
  listPlugins(
    workspacePath?: string | null,
    forceReload?: boolean,
  ): Promise<RpcResult<'plugin/list'>>
  getPluginDetails(
    pluginId: string,
    workspacePath?: string | null,
  ): Promise<RpcResult<'plugin/getDetails'>['details'] | null>
  setPluginEnabled(
    pluginId: string,
    enabled: boolean,
  ): Promise<RpcResult<'plugin/setEnabled'>['plugin']>
  onPluginsUpdated(callback: (generation: number) => void): () => void
}

export type DesktopMiniMaxCliApi = {
  getMiniMaxCliStatus(forceReload?: boolean): Promise<RpcResult<'minimaxCli/status'>>
  installMiniMaxCli(): Promise<RpcResult<'minimaxCli/install'>>
  uninstallMiniMaxCli(): Promise<RpcResult<'minimaxCli/uninstall'>>
  onMiniMaxCliUpdated(callback: (status: RpcResult<'minimaxCli/status'>) => void): () => void
}

export type DesktopComputerApi = {
  getComputerState(): Promise<RpcResult<'computer/state'>>
  discoverComputerApps(): Promise<RpcResult<'computer/apps'>>
  configureComputer(
    input: RpcParams<'computer/configure'>,
  ): Promise<RpcResult<'computer/configure'>>
  stopComputer(): Promise<RpcResult<'computer/stop'>>
  onComputerChanged(callback: (state: RpcResult<'computer/state'>) => void): () => void
}

export type DesktopSessionGroupChangedFile = SessionGroupChangedFile

export type DesktopSessionGroupStep = {
  id: string
  groupId: string
  sequence: number
  sourceThreadId: string | null
  sourceThreadTitle: string
  sourceTurnId: string
  projectId: string | null
  workspaceLabel: string
  status: SessionGroupStepStatus
  summary: string
  checkpoints: readonly SessionGroupCheckpoint[]
  changedFiles: readonly DesktopSessionGroupChangedFile[]
  validations: readonly SessionGroupValidation[]
  failure: SessionGroupFailure | null
  createdAt: number
  updatedAt: number
}

export type DesktopSessionGroup = {
  id: string
  name: string
  description: string
  version: number
  memberCount: number
  projectLabels: readonly string[]
  latestStepAt: number | null
  createdAt: number
  updatedAt: number
}

export type DesktopSessionGroupMember = {
  groupId: string
  threadId: string
  joinedAt: number
  title?: string
  workspaceLabel?: string
}

export type DesktopSessionGroupContextEntry = {
  id: string
  section: string
  title: string
  content: string
  status: string
}

export type DesktopSessionGroupDetail = {
  group: DesktopSessionGroup
  members: readonly DesktopSessionGroupMember[]
  digest: string
  contextEntries: readonly DesktopSessionGroupContextEntry[]
}

export type DesktopSessionGroupApi = {
  listSessionGroups(): Promise<DesktopSessionGroup[]>
  readSessionGroup(groupId: string): Promise<DesktopSessionGroupDetail>
  createSessionGroup(input: { name: string; description?: string }): Promise<DesktopSessionGroup>
  updateSessionGroup(input: {
    groupId: string
    name?: string
    description?: string
    version?: number
  }): Promise<DesktopSessionGroup>
  deleteSessionGroup(groupId: string, expectedVersion: number): Promise<void>
  setSessionGroupMembership(input: { threadId: string; groupId: string | null }): Promise<void>
  listSessionGroupSteps(groupId: string): Promise<DesktopSessionGroupStep[]>
  readSessionGroupStepDiff(input: {
    groupId: string
    stepId: string
    path?: string
  }): Promise<RpcResult<'session-group/step/diff'>>
}

export type DesktopSpeechStatus = RpcResult<'speech/status'>['status']

export type DesktopSpeechApi = {
  getSpeechStatus(): Promise<DesktopSpeechStatus>
  installSpeech(force?: boolean): Promise<DesktopSpeechStatus>
  transcribeSpeech(input: RpcParams<'speech/transcribe'>): Promise<RpcResult<'speech/transcribe'>>
  cancelSpeech(operationId: string): Promise<boolean>
  onSpeechStatusUpdated(callback: (status: DesktopSpeechStatus) => void): () => void
  openMicrophonePrivacySettings(): Promise<void>
}

export type DesktopAttachmentApi = {
  isComposerFileAttachmentAvailable(): Promise<boolean>
  chooseComposerFiles(): Promise<DesktopComposerAttachment[]>
  grantComposerFilePaths(filePaths: string[]): Promise<DesktopComposerAttachment[]>
  getComposerFilePath(file: File): string
  readAttachment(attachmentId: string): Promise<RpcResult<'attachment/read'>>
  readArtifact(threadId: string, artifactId: string): Promise<RpcResult<'artifact/read'>>
  saveAttachmentToDownloads(input: DesktopAttachmentSaveInput): Promise<DesktopAttachmentSaveResult>
  readDraftComposerPath(input: DesktopComposerPathReadInput): Promise<DesktopComposerPathPreview>
  listDraftComposerPath(input: DesktopComposerPathListInput): Promise<DesktopComposerPathListResult>
}

export type DesktopLocalContextApi = {
  readLocalContextPath(
    input: RpcParams<'context/path/read'>,
  ): Promise<RpcResult<'context/path/read'>>
  listLocalContextPath(
    input: RpcParams<'context/path/list'>,
  ): Promise<RpcResult<'context/path/list'>>
}

export type DesktopModelProviderRefreshApi = {
  refreshModelProviders(): Promise<void>
}

export type DesktopWindowApi = {
  openWindow(input: DesktopOpenWindowInput): Promise<void>
}

export type DesktopClient = DesktopApi &
  DesktopAgentReviewApi &
  DesktopAgentEventEnvelopeApi &
  DesktopAgentThreadTitleApi &
  DesktopToolingApi &
  DesktopPetApi &
  DesktopUsageApi &
  DesktopReleaseNotesApi &
  DesktopRuntimeCapabilityApi &
  DesktopAutomationApi &
  DesktopCalendarApi &
  DesktopPluginApi &
  DesktopMiniMaxCliApi &
  DesktopComputerApi &
  DesktopSessionGroupApi &
  DesktopAttachmentApi &
  DesktopSpeechApi &
  DesktopLocalContextApi &
  DesktopModelProviderRefreshApi &
  DesktopWindowApi
