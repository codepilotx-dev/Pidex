import type {
  AgentContextUsage,
  AgentRuntimeEvent,
  AgentSessionEvent,
  AgentSessionEventType,
  AgentSessionMessage,
  AgentSessionStatus,
  AgentThinkingMode,
  AgentToolLogEntry,
  AgentWorkspace,
} from '@pidex/core/agent/Runtime.js'
import type { CollaborationMode } from '@pidex/core/agent/SessionContract.js'
import type {
  AgentPermissionDecision,
  AgentPermissionRequest,
  DesktopAgentPermissionMode,
} from '@pidex/core/agent/Permissions.js'
import type { ThreadEvent } from '@pidex/core/agent/Workflow.js'
import type { Attachment, UserMessage } from '@pidex/core/attachments/Types.js'
import type {
  ApprovalRequest,
  SubagentProjection,
  SubagentRun,
  SubagentTask,
  ThreadCreationSurface,
  ThreadListItem,
  ThreadExecutionEnvironment,
  ThreadPullRequestList,
  ThreadSnapshot,
  ThreadGoal,
} from '@pidex/shared/thread'
import type {
  DesktopDataLocationChange,
  DesktopDataLocationControlSource,
  DesktopDataLocationState,
} from '@pidex/shared/desktop-data-location-ipc'
import type { DesktopUpdateStatus } from '@pidex/shared/desktop-update-ipc'
export type { DesktopUpdateStatus } from '@pidex/shared/desktop-update-ipc'
export type { ThreadCreationSurface } from '@pidex/shared/thread'
import type {
  DesktopBrowserBounds as SharedDesktopBrowserBounds,
  DesktopBrowserSnapshot as SharedDesktopBrowserSnapshot,
  DesktopBrowserSitePermission as SharedDesktopBrowserSitePermission,
} from '@pidex/shared/desktop-browser-ipc'
import type {
  ModelMetadata,
  ModelProviderID as CoreModelProviderID,
  ModelProviderKind,
  ModelProviderSummary,
} from '@pidex/core/models/Provider.js'
import type { CatalogProvider, ModelRef, ProviderTestResponse } from '@pidex/shared'
import type { HighlightThemeSlug } from './themes/Manifest.js'
import type {
  McpRuntimeServerStatus,
  McpScope,
  McpToolApprovalMode,
  McpToolPolicy,
  McpTransportConfig,
  RpcParams,
  RpcResult,
} from '@pidex/agent-protocol'

export type DesktopAuthStatus = {
  authenticated: boolean
  method: string
  email?: string | null
  organizationName?: string | null
}

export type DesktopProjectFolder = {
  id: string
  name: string
  path: string
  role: 'primary' | 'secondary'
  availability: 'available' | 'missing'
  order: number
  createdAt: number
  updatedAt: number
}

export type DesktopProjectSource =
  | {
      storage: 'managed'
      id: string
      projectId: string
      kind: 'text' | 'image'
      name: string
      mediaType: string
      sizeBytes: number
      sha256: string
      status: 'available'
    }
  | {
      storage: 'workspace-file'
      id: string
      projectId: string
      folderId: string
      path: string
      kind: 'text' | 'image'
      name: string
      status: 'available' | 'missing' | 'denied' | 'unsupported'
      revision: DesktopFileRevision | null
    }

export type DesktopProjectSourceReadResult = {
  source: DesktopProjectSource
  data: string
  encoding: 'utf8' | 'base64'
  range: {
    offset: number
    length: number
    total: number
  }
}

export interface DesktopWorkspace extends AgentWorkspace {
  projectId?: string
  projectVersion?: number
  primaryFolderId?: string
  folders?: DesktopProjectFolder[]
  projectSettings?: {
    defaultModel: ModelRef | null
    instructions: string
    /** `auto` follows the project type; `local` always uses the local directory. */
    executionEnvironment?: 'auto' | 'local'
    version: number
  }
  pinnedAt?: string | null
}

export type DesktopFileEntry = {
  name: string
  path: string
  type: 'file' | 'directory'
  depth: number
  folderId?: string
  folderName?: string
  rootPath?: string
}

export type DesktopFilePreview = {
  path: string
  projectId?: string
  folderId?: string
  rootPath?: string
  content: string
  truncated: boolean
  sizeBytes: number
  readonly: boolean
  revision: DesktopFileRevision
}

export type DesktopFileRevision = {
  mtimeMs: number
  sha256: string
  rawSha256?: string
  utf8Bom?: boolean
}

export type DesktopFileSaveResult =
  | {
      outcome: 'saved'
      revision: DesktopFileRevision
    }
  | {
      outcome: 'conflict'
      revision: DesktopFileRevision
      content: string
    }

export type DesktopFileSaveInput = {
  workspacePath: string
  projectId?: string
  folderId?: string
  filePath: string
  content: string
  expectedRevision: DesktopFileRevision
}

export type DesktopComposerAttachmentKind =
  'image' | 'document' | 'text' | 'audio' | 'video' | 'binary'

export type DesktopComposerAttachmentStatus = 'ready' | 'error'

export type DesktopComposerAttachmentStorage = 'managed' | 'local-path'

export type DesktopComposerPathKind = 'file' | 'directory'

export type DesktopComposerAttachment = {
  id: string
  name: string
  path: string
  mediaType: string
  sizeBytes: number
  kind: DesktopComposerAttachmentKind
  status: DesktopComposerAttachmentStatus
  storage?: DesktopComposerAttachmentStorage
  pathKind?: DesktopComposerPathKind
  localGrantId?: string
  contextReferenceId?: string
  error?: string
  contentBase64?: string
  previewDataUrl?: string
  textContent?: string
  truncated?: boolean
}

export type DesktopGoalSubmission = Omit<
  NonNullable<RpcParams<'turn/start'>['goal']>,
  'expectedVersion'
>

export type DesktopUserMessageInput = {
  text: string
  taskMode?: 'chat' | 'plan'
  skills?: readonly import('@pidex/agent-protocol').SkillSelection[]
  attachments?: DesktopComposerAttachment[]
  retainedAttachmentIds?: string[]
  retainedContextReferenceIds?: string[]
  skillInvocation?: {
    name: string
    args?: string
    skillPath?: string
  }
}

/**
 * Structured user message passed to the runtime for processing.
 * Previously `string | ContentBlockParam[]`; now uses the neutral
 * `UserMessage` format so the runtime can handle attachments natively.
 */
export type DesktopUserMessageContent = UserMessage | string

export type DesktopDiffSummary = {
  patch: string
}

export type DesktopReviewScope = 'unstaged' | 'staged'

export type DesktopReviewSource =
  | { kind: 'uncommitted' }
  | { kind: 'unstaged' }
  | { kind: 'staged' }
  | { kind: 'branch'; baseBranch: string }
  | { kind: 'commit'; commitSha: string }
  | { kind: 'last-turn'; threadId: string; turnId: string }
  | {
      kind: 'pull-request'
      owner: string
      repository: string
      number: number
    }

export type DesktopReviewDelivery = 'inline' | 'detached'

export type DesktopReviewSide = 'left' | 'right'

export type DesktopReviewLineType = 'added' | 'removed' | 'context' | 'meta'

export type DesktopReviewDiffLine = {
  id: string
  type: DesktopReviewLineType
  oldLine: number | null
  newLine: number | null
  content: string
  raw: string
}

export type DesktopReviewDiffHunk = {
  id: string
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  patch: string
  lines: DesktopReviewDiffLine[]
}

export type DesktopReviewDiffFile = {
  partialHunks?: DesktopReviewDiffHunk[]
  fullContext?: boolean
  path: string
  originalPath?: string
  status: string
  additions: number
  deletions: number
  isUntracked: boolean
  hunks: DesktopReviewDiffHunk[]
  revision?: string
  renderable?: boolean
  tooLargeReason?: 'changed-lines' | 'changed-bytes' | 'line-bytes' | null
}

export type DesktopReviewScopeSummary = {
  scope: DesktopReviewScope
  changedFiles: number
  additions: number
  deletions: number
}

export type DesktopReviewDiffInput = {
  workspacePath: string
  scope?: DesktopReviewScope
}

export type DesktopReviewDiffResult = {
  scopes: DesktopReviewScopeSummary[]
  activeScope: DesktopReviewScope
  files: DesktopReviewDiffFile[]
  status: DesktopGitStatus
}

export type DesktopReviewOperationAction = 'stage' | 'unstage' | 'revert'

export type DesktopReviewOperationTarget =
  { type: 'file'; path: string } | { type: 'hunk'; path: string; hunkId: string }

export type DesktopReviewOperationInput = {
  workspacePath: string
  scope: DesktopReviewScope
  action: DesktopReviewOperationAction
  target: DesktopReviewOperationTarget
}

export type DesktopReviewOperationResult =
  | { ok: true; status: DesktopGitStatus; reviewDiff: DesktopReviewDiffResult; output?: string }
  | { ok: false; error: string }

export type DesktopReviewCommentStatus = 'open' | 'resolved'

export type DesktopReviewComment = {
  id: string
  sessionId: string
  filePath: string
  side: DesktopReviewSide
  lineNumber: number
  lineContent: string
  body: string
  status: DesktopReviewCommentStatus
  revision?: string
  hunkId?: string | null
  githubCommentId?: string | null
  githubThreadId?: string | null
  createdAt: string
  updatedAt: string
}

export type SaveSessionReviewCommentInput = {
  sessionId: string
  comment:
    | Omit<DesktopReviewComment, 'id' | 'sessionId' | 'status' | 'createdAt' | 'updatedAt'>
    | DesktopReviewComment
}

export type SessionReviewCommentInput = {
  sessionId: string
  commentId: string
}

export type DesktopGitFileChange = {
  path: string
  originalPath?: string
  status: string
  stagedStatus: string
  unstagedStatus: string
  additions: number | null
  deletions: number | null
  isUntracked: boolean
}

export type DesktopGitStatus = {
  branchName: string | null
  upstream: string | null
  ahead: number
  behind: number
  clean: boolean
  files: DesktopGitFileChange[]
}

export type DesktopGitStatusResult =
  { ok: true; status: DesktopGitStatus } | { ok: false; error: string; errorCode?: string }

export type DesktopGitDetectionState = 'loading' | 'git' | 'non-git' | 'error'

export type CreateBranchInput = {
  projectId?: string
  workspacePath: string
  branchName: string
  startPoint?: string
}

export type CommitChangesInput = {
  projectId?: string
  workspacePath: string
  message: string
  paths: string[]
}

export type PushBranchInput = {
  projectId?: string
  workspacePath: string
  setUpstream?: boolean
  forceWithLease?: boolean
  /** When set the agent resolves the thread's real worktree directory. */
  threadId?: string
}

export type CreatePullRequestInput = {
  projectId?: string
  workspacePath: string
  title: string
  body?: string
  draft?: boolean
  /** When set the agent resolves the thread's real worktree directory. */
  threadId?: string
}

export type DesktopThreadPullRequestsResult =
  { ok: true; threads: ThreadPullRequestList[] } | { ok: false; error: string; errorCode?: string }

export type DesktopThreadPullRequestMutationResult =
  { ok: true; thread: ThreadPullRequestList } | { ok: false; error: string; errorCode?: string }

export type LinkThreadPullRequestInput = { threadId: string; url: string }

export type UnlinkThreadPullRequestInput = {
  threadId: string
  owner: string
  repository: string
  number: number
}

export type DiscardWorkspaceChangesInput = {
  workspacePath: string
  paths: string[]
  includeUntracked?: boolean
}

export type RestoreSessionTurnChangesInput = {
  sessionId: string
  turnRestoreId: string
  paths: string[]
}

export type DesktopGitWorkspaceResult =
  { ok: true; workspace: DesktopWorkspace; status: DesktopGitStatus } | { ok: false; error: string }

export type DesktopGitOperationResult =
  { ok: true; status: DesktopGitStatus; output?: string } | { ok: false; error: string }

export type DesktopPullRequestResult =
  { ok: true; url: string; output?: string } | { ok: false; error: string }

export type DesktopRuntimeStatus = {
  runtimeKind: 'rust-sidecar'
  runtimePreference: 'auto' | 'rust-sidecar'
  runtimeSelectionSource: 'default' | 'env'
  agentExecutablePath: string
  agentExecutableExists: boolean
  configDirectoryPath: string
  toolchainEnabled: boolean
  toolchainRoot: string | null
  managedToolchainRoot: string
  packagedToolchainRoot: string
  toolchainPathEntries: string[]
  toolchainBinaries: DesktopRuntimeBinaryStatus[]
}

export type DesktopRuntimeBinaryName = 'node' | 'npm' | 'npx' | 'python' | 'pip'

export type DesktopRuntimeBinarySource = 'managed' | 'packaged' | 'system' | 'missing'

export type DesktopRuntimeBinaryStatus = {
  name: DesktopRuntimeBinaryName
  source: DesktopRuntimeBinarySource
  path: string | null
  exists: boolean
  targetVersion?: string
  version: string | null
  error?: string
}

export type DesktopToolchainDiagnosticReport = {
  enabled: boolean
  root: string | null
  managedRoot: string
  packagedRoot: string
  pathEntries: string[]
  binaries: DesktopRuntimeBinaryStatus[]
  logPath?: string
}

export type DesktopToolchainInstallResult =
  | {
      ok: true
      root: string
      copiedFrom: string | null
      diagnostics: DesktopToolchainDiagnosticReport
    }
  | { ok: false; error: string; diagnostics: DesktopToolchainDiagnosticReport }

export type DesktopBrowserBounds = SharedDesktopBrowserBounds

export type DesktopBrowserState = Pick<
  SharedDesktopBrowserSnapshot,
  'features' | 'device' | 'zoomFactor' | 'historyEpoch'
> & {
  tabId?: string
  sourceThreadId?: string | null
  controlThreadId?: string | null
  state?: 'parked' | 'live' | 'suspended' | 'crashed'
  busy?: boolean
  generation?: string
  documentId?: string
  viewport?: { width: number; height: number }
  panel?: 'right' | 'bottom'
  order?: number
  revision?: number
  open: boolean
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
  allowedSites: string[]
  sitePermissions: DesktopBrowserSitePermission[]
}

export type DesktopBrowserSitePermission = SharedDesktopBrowserSitePermission

export type DesktopOpenTargetKind = 'file-explorer' | 'terminal' | 'editor'

export type DesktopOpenTarget = {
  id: string
  label: string
  kind: DesktopOpenTargetKind
  executablePath?: string
  command?: string
  iconDataUrl?: string
}

export type DesktopExternalOpenTarget = {
  id: string
  label: string
  kind: DesktopOpenTargetKind
  iconDataUrl?: string
  preferred: boolean
}

export type DesktopSessionStatus = AgentSessionStatus

export type DesktopPermissionMode = DesktopAgentPermissionMode

export type DesktopPermissionProfile = string

export type DesktopApprovalPolicy =
  | 'untrusted'
  | 'on-request'
  | 'on-failure'
  | 'never'
  | {
      type: 'granular'
      sandboxApproval: boolean
      rules: boolean
      skillApproval: boolean
      requestPermissions: boolean
      mcpTools: boolean
      mcpElicitations: boolean
    }

export type DesktopApprovalsReviewer = 'user' | 'auto_review'

export type DesktopPermissionConfig = {
  sandboxMode: Exclude<DesktopSandboxMode, 'full-access'>
  approvalPolicy: DesktopApprovalPolicy
  approvalsReviewer: DesktopApprovalsReviewer
}

export type DesktopCollaborationMode = CollaborationMode

export type DesktopThinkingMode = AgentThinkingMode

export type DesktopDrawerTab = 'files' | 'diff' | 'permissions' | 'toolLog' | 'settings'

export type ModelProviderID = CoreModelProviderID

export type DesktopModelProviderKind = ModelProviderKind

export type DesktopModelMetadata = ModelMetadata & {
  inputTokens?: number
  nativeApi?: string
  variants?: string[]
  providerApi?:
    'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai'
}

export type DesktopProviderAvailability =
  | { status: 'ready' }
  | {
      status: 'unavailable'
      reason:
        | 'unsupported-protocol'
        | 'missing-api'
        | 'unsafe-endpoint'
        | 'unresolved-endpoint'
        | 'no-compatible-models'
    }

export type DesktopModelProviderSummary = Omit<ModelProviderSummary, 'modelMetadata'> & {
  modelCount?: number
  providerKind?: 'builtin' | 'custom'
  catalogOrigin?: 'user' | 'pi-bundled'
  availability?: DesktopProviderAvailability
  readOnly?: boolean
  protocol?: 'pi-native' | 'openai-compatible' | 'unsupported'
  enabled?: boolean
  authMethods?: readonly ('api-key' | 'oauth')[]
  providerApis?: readonly (
    'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai'
  )[]
  nativeApis?: readonly string[]
  endpointDefaults?: Readonly<Record<string, string>>
  defaultApi?: string
  config?: DesktopListedProviderDefinition
  unresolvedMigrationIssues?: readonly string[]
  modelMetadata?: Record<string, DesktopModelMetadata>
}

export type DesktopModelProviderState = {
  selectedProviderID: ModelProviderID
  provider: DesktopModelProviderSummary
  model: string
  variant?: string
  baseURL?: string
  apiKeyConfigured: boolean
  apiKeySource: string | null
  modelConfigured: boolean
  configurationMessage?: string
  models: string[]
  modelMetadata?: Record<string, DesktopModelMetadata>
  error?: string
}

export type DesktopProviderModelListResult = {
  models: string[]
  modelMetadata?: Record<string, DesktopModelMetadata>
  total?: number
  nextCursor?: string
  error?: string
}

export type DesktopApiKeyHealthStatus =
  'untested' | 'healthy' | 'auth-failed' | 'rate-limited' | 'error'

export type DesktopApiKeySummary = {
  id: string
  providerId: ModelProviderID
  label: string
  maskedValue: string
  enabled: boolean
  active: boolean
  priority: number
  health: {
    status: DesktopApiKeyHealthStatus
    lastTestedAt?: number
    errorCategory?: 'authentication' | 'rate-limit' | 'network' | 'unknown'
  }
  createdAt: number
  updatedAt: number
}

export type DesktopCopilotAuthStatus = {
  authenticated: boolean
  user?: string | null
  method?: string | null
  error?: string
}

export type DesktopCopilotLoginState =
  'idle' | 'starting' | 'awaiting_auth' | 'completed' | 'failed'

export type DesktopCopilotLoginStatus = {
  state: DesktopCopilotLoginState
  deviceCode: string | null
  verificationUrl: string | null
  error: string | null
  auth: DesktopCopilotAuthStatus | null
  elapsedMs: number
}

export type DesktopGithubUser = {
  login: string
  id: number
  name: string | null
  avatarUrl: string | null
  htmlUrl: string
}

export type DesktopGithubAuthStatus = {
  configured: boolean
  authenticated: boolean
  user: DesktopGithubUser | null
  error?: string
}

export type DesktopGithubLoginState = 'starting' | 'awaiting_auth' | 'completed' | 'failed'

export type DesktopGithubAuthMode = 'browser' | 'device'

export type DesktopGithubLoginStatus = {
  loginId: string | null
  mode: DesktopGithubAuthMode
  state: DesktopGithubLoginState
  authorizationUrl: string | null
  userCode: string | null
  verificationUri: string | null
  expiresAt: string | null
  error: string | null
  auth: DesktopGithubAuthStatus | null
  elapsedMs: number
}

export type StartGithubLoginInput = {
  mode: DesktopGithubAuthMode
}

export type DesktopGithubRepository = {
  id: number
  name: string
  fullName: string
  owner: string
  private: boolean
  fork: boolean
  archived: boolean
  disabled: boolean
  cloneUrl: string
  sshUrl: string
  htmlUrl: string
  description: string | null
  defaultBranch: string
  pushedAt: string | null
  updatedAt: string | null
}

export type DesktopGithubRepositoryListResult =
  { ok: true; repositories: DesktopGithubRepository[] } | { ok: false; error: string }

export type CloneGithubRepositoryInput = {
  repository: DesktopGithubRepository
}

export type DesktopGithubCloneResult =
  { ok: true; workspace: DesktopWorkspace } | { ok: false; error: string }

export type DesktopGithubProfileRepository = {
  id: string
  name: string
  fullName: string
  url: string
  description: string | null
  isPrivate: boolean
  isFork: boolean
  primaryLanguage: {
    name: string
    color: string | null
  } | null
  stargazerCount: number
  forkCount: number
  updatedAt: string
}

export type DesktopGithubContributionDay = {
  date: string
  count: number
  color: string
}

export type DesktopGithubContributionWeek = {
  days: DesktopGithubContributionDay[]
}

export type DesktopGithubUserStatus = {
  emoji: string | null
  message: string | null
  indicatesLimitedAvailability: boolean
  expiresAt: string | null
}

export type DesktopGithubUserStatusInput = {
  emoji: string
  message: string
  limitedAvailability: boolean
  expiresAt?: string | null
}

export type DesktopGithubUserStatusResult =
  { ok: true; status: DesktopGithubUserStatus | null } | { ok: false; error: string }

export type DesktopGithubProfileOverview = {
  user: DesktopGithubUser & {
    bio: string | null
    company: string | null
    location: string | null
    websiteUrl: string | null
    email: string | null
    followers: number
    following: number
    repositoryCount: number
    starredRepositoryCount: number
    status: DesktopGithubUserStatus | null
  }
  organizations: Array<{
    login: string
    avatarUrl: string
    url: string
  }>
  pinnedRepositories: DesktopGithubProfileRepository[]
  popularRepositories: DesktopGithubProfileRepository[]
  contributions: {
    totalContributions: number
    totalCommitContributions: number
    totalIssueContributions: number
    totalPullRequestContributions: number
    totalPullRequestReviewContributions: number
    restrictedContributionsCount: number
    weeks: DesktopGithubContributionWeek[]
  }
}

export type DesktopGithubProfileOverviewResult =
  { ok: true; overview: DesktopGithubProfileOverview } | { ok: false; error: string }

export type SaveDesktopModelProviderOptions = {
  providerID: ModelProviderID
  id?: string
  variant?: string
}

export type DesktopProviderDefinition = RpcParams<'provider/update'>['definition']
export type DesktopListedProviderDefinition =
  RpcResult<'provider/list'>['providers'][number]['config']
export type DesktopBuiltinProviderDefinition = Extract<
  DesktopListedProviderDefinition,
  { kind: 'builtin' }
>
export type DesktopCustomProviderDefinition = RpcParams<'provider/create'>['definition']
export type DesktopProviderModelDefinition = DesktopCustomProviderDefinition['models'][number]
/** 未保存的 Provider 请求草稿；`apiKey` 只用于单次请求，不落盘、不进事件。 */
export type DesktopProviderDraft = NonNullable<RpcParams<'provider/model/discover'>['draft']>
/** 可发起模型列表读取与最小生成探测的四类 wire 协议。 */
export type DesktopProviderChatApi = RpcParams<'provider/model/discover'>['api']
export type DesktopProviderCredential = RpcResult<'provider/credential/list'>['credentials'][number]
export type DesktopAuthTarget = RpcParams<'auth/session/start'>['target']
export type DesktopAuthSession = RpcResult<'auth/session/status'>['session']
export type DesktopModelRef = ModelRef
export type DesktopCatalogProvider = CatalogProvider

export type LocalRouterMode = 'off' | 'pareto-code' | 'fusion'

export const LOCAL_ROUTER_MODES = ['off', 'pareto-code', 'fusion'] as const

export function isLocalRouterMode(value: unknown): value is LocalRouterMode {
  return typeof value === 'string' && (LOCAL_ROUTER_MODES as readonly string[]).includes(value)
}

export function normalizeLocalRouterMode(
  value: unknown,
  fallback: LocalRouterMode = 'off',
): LocalRouterMode {
  return isLocalRouterMode(value) ? value : fallback
}

export type DesktopSandboxMode =
  'read-only' | 'workspace-write' | 'full-access' | 'danger-full-access'

export type DesktopPersonality = 'pragmatic' | 'friendly' | 'concise' | 'encouraging'

export type DesktopReviewView = 'inline' | 'split'
export type DesktopDiffMarkerStyle = 'color' | 'symbol'
export type DesktopMessageDelivery = 'steer' | 'follow-up'
export type DesktopSidebarOrganization = 'projects' | 'flat'
export type DesktopSidebarSort = 'priority' | 'updated' | 'manual'

export type DesktopRemovedWorkspace = {
  projectId?: string
  path: string
  name: string
  removedAt: string
}

export type DesktopPetSettings = {
  enabled: boolean
  selectedPetId: string | null
  size: number
  notifyAttention: boolean
  notifyCompletion: boolean
  notifyFailure: boolean
}

export type DesktopSystemNotificationCompletion = 'always' | 'unfocused' | 'never'

export type DesktopSystemNotificationSettings = {
  completion: DesktopSystemNotificationCompletion
  permissions: boolean
  questions: boolean
  errors: boolean
}

export type SidebarProductMode = 'coding' | 'working' | 'chat'
export type SidebarSectionId = 'pinned' | 'projects' | 'recent'
export type DesktopShellSecurityLevel = 'strict' | 'balanced' | 'relaxed'

export type ProjectAppearanceColor =
  'default' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink'

export type ProjectAppearanceIcon =
  | 'folder'
  | 'dollar'
  | 'book'
  | 'graduation'
  | 'edit'
  | 'writing'
  | 'function'
  | 'terminal'
  | 'music'
  | 'popcorn'
  | 'customize'
  | 'palette'
  | 'stethoscope'
  | 'health'
  | 'plant'
  | 'suitcase'
  | 'chart'
  | 'kettlebell'
  | 'dumbbell'
  | 'logs'
  | 'scale'
  | 'globe'
  | 'wrench'
  | 'paw'
  | 'flask'
  | 'brain'
  | 'heart'
  | 'flower'
  | 'paintbrush'
  | 'plane'

export type ProjectAppearance = {
  color: ProjectAppearanceColor
  icon: ProjectAppearanceIcon
}

export type DesktopStoredSettings = {
  gitBoardState?: string | null
  language: 'system' | 'zh-CN' | 'en-US'
  enableParetoCodeRouter?: boolean
  enableFusionRouter?: boolean
  enableAutoReviewPermissionMode?: boolean
  enableFullAccessPermissionMode?: boolean
  permissionConfig: DesktopPermissionConfig
  shellSecurityLevel: DesktopShellSecurityLevel
  terminalProfileId: string | null
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  permissionProfile?: DesktopPermissionProfile
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  approvalPolicy?: DesktopApprovalPolicy
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  approvalsReviewer?: DesktopApprovalsReviewer
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  permissionMode?: DesktopPermissionMode
  model: string
  generationModel: string
  organizationModel: string
  codingModel: string
  securityModel: string
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  planExecutionModel?: string
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  reviewModel?: string
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  smallFastModel?: string
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  fastModel?: string
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  defaultModel?: string
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  deepModel?: string
  sessionName: string
  thinkingMode: DesktopThinkingMode
  systemPrompt: string
  appendSystemPrompt: string
  additionalDirectories: string
  recentWorkspaces: DesktopWorkspace[]
  projectAppearances: Record<string, ProjectAppearance>
  lastActiveWorkspacePath: string
  removedWorkspaces: DesktopRemovedWorkspace[]
  drawerTab: DesktopDrawerTab
  selectedModelPreset: string
  providerID: ModelProviderID
  providerBaseURL: string
  showContextUsage: boolean
  defaultOpenTargetId: string
  gitBranchPrefix: string
  gitPrMergeMethod: 'merge' | 'squash'
  gitShowPrIconsInSidebar: boolean
  gitDraftPullRequest: boolean
  gitAutoDeleteWorktree: boolean
  gitAutoDeleteWorktreeLimit: number
  worktreeRoot: string
  worktreeFetchUpstream: boolean
  prWatchAutoMerge: boolean
  prWatchInstructions: string
  allowForcePush: boolean
  commitMessagePrompt: string
  pullRequestPrompt: string
  /** @deprecated Loader-only legacy input. Normalized settings never serialize this field. */
  sandboxMode?: DesktopSandboxMode
  allowNetworkAccess?: boolean
  installPidexDependencies: boolean
  workspaceDependenciesMigrated: boolean
  firstUseSetupCompleted?: 0 | 1
  'desktop.voice.preferredInputDeviceId': string
  personality: DesktopPersonality
  customInstructions: string
  enableMemory: boolean
  skipToolAidedChats: boolean
  defaultModeRequestUserInput: boolean
  githubMemorySyncEnabled: boolean
  githubMemoryRepository: string
  reviewView: DesktopReviewView
  reviewDelivery: DesktopReviewDelivery
  conversationWidth: 'default' | 'narrow' | 'wide'
  diffMarkerStyle: DesktopDiffMarkerStyle
  rustSearchAndDiffKernels: boolean
  sidebarLayout: 'modern' | 'classic'
  sidebarOrganization: DesktopSidebarOrganization
  sidebarProductMode: SidebarProductMode
  sidebarStateVersion: number
  sidebarProjectSort: DesktopSidebarSort
  sidebarSort: DesktopSidebarSort
  /** @deprecated 旧版“优先级筛选”开关；读取时仅用于迁移到时间线设置，保存不再写入 */
  sidebarPriorityFilterEnabled?: boolean
  sidebarTimelineEnabled: boolean
  sidebarTimelinePriorityEnabled: boolean
  sidebarActivityShowWork?: boolean
  sidebarActivityShowChat?: boolean
  sidebarActivityShowScheduled?: boolean
  sidebarShowScheduledSessions?: boolean
  sidebarActivityShowPinned?: boolean
  sidebarActivityCoachmarkDismissed?: boolean
  sidebarManualOrder: Record<string, string[]>
  sidebarSessionPins: Record<string, string>
  collapsedSidebarProjectPaths: string[]
  sidebarSectionOrder: SidebarSectionId[]
  browserAllowedSites: string[]
  collapsedSidebarSections: SidebarSectionId[]
  browserSitePermissions: DesktopBrowserSitePermission[]
  sidebarCustomization?: SidebarCustomization
  pet: DesktopPetSettings
  notifications: DesktopSystemNotificationSettings
}

export type SidebarCustomSection = {
  id: string
  title: string
  itemKeys: string[]
  sort: 'manual' | 'updated'
  collapsed: boolean
}

export type SidebarCustomization = {
  version: number
  sections: SidebarCustomSection[]
  sectionOrder: string[]
  pinnedSort: 'manual' | 'updated'
  showProjectsInRecents?: boolean
  destinationOrder: string[]
  hiddenDestinationIds: string[]
}

export type DesktopConfigReadResult = RpcResult<'config/read'>
export type DesktopConfigBatchWriteParams = RpcParams<'config/batchWrite'>
export type DesktopConfigWriteResult = RpcResult<'config/batchWrite'>
export type DesktopConfigProfileListResult = RpcResult<'config/profile/list'>
export type DesktopConfigProfileSelectResult = RpcResult<'config/profile/select'>

export type DesktopMcpScope = McpScope
export type DesktopEditableMcpScope = McpScope
export type DesktopMcpTransport = McpTransportConfig['type']
export type DesktopMcpServerConfig = McpTransportConfig
export type DesktopMcpToolApprovalMode = McpToolApprovalMode
export type DesktopMcpToolPolicy = McpToolPolicy

export type DesktopMcpServerListItem = {
  name: string
  scope: DesktopMcpScope
  type: DesktopMcpTransport
  summary: string
  enabled: boolean
  diagnosticContext: boolean
  effective: boolean
  shadowedByScope?: DesktopMcpScope
  editable: boolean
  removable: boolean
  transport: DesktopMcpServerConfig
  startupTimeoutMs?: number
  toolTimeoutMs?: number
  required?: boolean
  enabledTools?: string[]
  disabledTools?: string[]
  defaultToolsApprovalMode?: DesktopMcpToolApprovalMode
  tools?: Record<string, DesktopMcpToolPolicy>
  runtime?: McpRuntimeServerStatus
}

export type DesktopMcpRuntimeServerStatus = McpRuntimeServerStatus

export type DesktopMcpRuntimeStatus = RpcResult<'mcp/status'>

export type McpReloadResult = RpcResult<'mcp/reload'>
export type DesktopMcpOAuthStartResult = RpcResult<'mcp/oauth/start'>
export type DesktopMcpOAuthStatusResult = RpcResult<'mcp/oauth/status'>
export type DesktopMcpOAuthLogoutResult = RpcResult<'mcp/oauth/logout'>

export type SaveDesktopMcpServerOptions = {
  originalName?: string
  name: string
  scope: DesktopEditableMcpScope
  enabled: boolean
  diagnosticContext: boolean
  transport: DesktopMcpServerConfig
  startupTimeoutMs?: number
  toolTimeoutMs?: number
  required?: boolean
  enabledTools?: string[]
  disabledTools?: string[]
  defaultToolsApprovalMode?: DesktopMcpToolApprovalMode
  tools?: Record<string, DesktopMcpToolPolicy>
  workspacePath?: string
}

export type {
  DesktopChromeTheme,
  DesktopSystemFontFace,
  DesktopSystemFontsResult,
  DesktopThemeFontFace,
  DesktopThemeFonts,
  DesktopThemeMode,
  DesktopThemeVariant,
} from '@pidex/shared/desktop-theme'
import type {
  DesktopChromeTheme,
  DesktopThemeSettingsV6 as SharedDesktopThemeSettingsV6,
  DesktopThemeSettingsV7 as SharedDesktopThemeSettingsV7,
  DesktopThemeSettingsV8 as SharedDesktopThemeSettingsV8,
  DesktopThemeVariant,
} from '@pidex/shared/desktop-theme'

export type DesktopThemeConfigV1 = {
  codeThemeId: string
  theme: DesktopChromeTheme
  variant: DesktopThemeVariant
}

export type DesktopThemeSettingsV6 = SharedDesktopThemeSettingsV6<HighlightThemeSlug>

export type DesktopThemeSettingsV7 = SharedDesktopThemeSettingsV7<HighlightThemeSlug>

export type DesktopThemeSettingsV8 = SharedDesktopThemeSettingsV8<HighlightThemeSlug>

export type DesktopThemeSettings = DesktopThemeSettingsV8

export type DesktopPermissionGrantScope = 'tool-call' | 'turn' | 'session'

export type DesktopPermissionGrant = {
  requestedPermissions: {
    readPaths?: string[]
    writePaths?: string[]
    networkDomains?: string[]
  }
  requestedScope: DesktopPermissionGrantScope
  allowedScopes: DesktopPermissionGrantScope[]
}

export type DesktopPermissionDecision = AgentPermissionDecision & {
  grantOptionId?: string
  computerGrant?: 'chat' | 'persistent'
  grantScope?: DesktopPermissionGrantScope
}

export type DesktopPermissionRequest = AgentPermissionRequest & {
  grantOptions?: ApprovalRequest['grantOptions']
  toolIdentity?: ApprovalRequest['toolIdentity']
  toolInput?: ApprovalRequest['input']
  computerApp?: { name: string; allowPersistentApproval: boolean }
  permissionGrant?: DesktopPermissionGrant
}

export type DesktopSessionMessage = AgentSessionMessage

export type DesktopToolLogEntry = AgentToolLogEntry

export type DesktopContextUsage = AgentContextUsage

export type DesktopSessionListItem = {
  storageSource?: 'local' | undefined
  id: string
  hasScheduledRun?: boolean
  isScheduledSession?: boolean
  isFork?: boolean
  projectId?: string | null
  /** Canonical workflow membership; `sessionGroupId` remains a one-generation alias. */
  workflowId?: string | null
  /** Agent-projected execution location; the only source of truth for where a task runs. */
  executionEnvironment?: ThreadExecutionEnvironment | null
  /** @deprecated Read `workflowId` instead. */
  sessionGroupId?: string | null
  appServerThreadId?: string | null
  sessionName: string | null
  aiTitle: string | null
  localRouterMode?: LocalRouterMode
  customTitle?: string | null
  tag?: string | null
  summary?: string | null
  preview?: string | null
  gitBranch?: string | null
  firstPrompt?: string | null
  prNumber?: number | null
  prUrl?: string | null
  prRepository?: string | null
  transcriptPath?: string | null
  rolloutPath?: string | null
  legacyTranscriptPath?: string | null
  source?: 'user' | 'internal_guardian' | 'subagent' | null
  parentSessionId?: string | null
  guardianRolloutPath?: string | null
  fileSize?: number | null
  workspaceName: string
  workspacePath: string
  standalone?: boolean
  pinnedAt?: string | null
  archivedAt?: string | null
  permissionProfile?: DesktopPermissionProfile
  approvalPolicy?: DesktopApprovalPolicy
  approvalsReviewer?: DesktopApprovalsReviewer
  permissionMode: DesktopPermissionMode
  collaborationMode?: DesktopCollaborationMode
  planModeActive?: boolean
  providerID?: ModelProviderID
  model: string | null
  effort?: string | null
  personality?: DesktopPersonality
  reviewModel?: string | null
  thinkingMode: DesktopThinkingMode
  hasSystemPrompt: boolean
  hasAppendSystemPrompt: boolean
  additionalDirectoryCount: number
  status: DesktopSessionStatus
  threadGoal?: DesktopThreadGoal | null
  unreadAt?: string | null
  latestTurnStatus?: ThreadListItem['latestTurnStatus']
  pendingPlanApproval?: boolean
  creationSurface?: ThreadCreationSurface
  lastMessageAt?: string | null
  createdAt: string
}

export type DesktopSessionSettingsSnapshot = {
  localRouterMode?: LocalRouterMode
  permissionConfig: DesktopPermissionConfig
  collaborationMode?: DesktopCollaborationMode
  planModeActive?: boolean
  providerID?: ModelProviderID
  providerBaseURL?: string
  model?: string
  variant?: string
  effort?: string | null
  personality?: DesktopPersonality
  sessionName?: string
  thinkingMode: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories: string[]
  installPidexDependencies?: boolean
  enableMemory?: boolean
  rustSearchAndDiffKernels?: boolean
}

export type DesktopQueuedFollowUp = {
  id: string
  input: DesktopUserMessageInput
  previewText: string
  createdAt: string
}

export type DesktopQueuePauseReason = 'interrupted' | 'turn_failed'

export type DesktopSessionViewSnapshot = {
  messages: DesktopSessionMessage[]
  toolLog: DesktopToolLogEntry[]
  pendingPermissions: DesktopPermissionRequest[]
  contextUsage: DesktopContextUsage | null
}

export type DesktopSessionEventType = AgentSessionEventType

export type DesktopSessionEvent = AgentSessionEvent

export type DesktopSessionSnapshot = {
  appServerThreadId?: string | null
  /** A newly-created desktop session has not started its persistent Thread yet. */
  appServerThreadPending?: boolean
  item: DesktopSessionListItem
  workspace: DesktopWorkspace
  settings: DesktopSessionSettingsSnapshot
  view: DesktopSessionViewSnapshot
  events?: DesktopSessionEvent[]
  eventModelVersion?: 1
  workflowEvents?: DesktopWorkflowEvent[]
  workflowEventModelVersion?: 1
  reviewComments?: DesktopReviewComment[]
  queuedFollowUps?: DesktopQueuedFollowUp[]
  queuePauseReason?: DesktopQueuePauseReason | null
  queueVersion?: number
  updatedAt: string
}

export type DesktopSubagentRead = {
  task: SubagentTask
  currentRun: SubagentRun | null
  snapshot: ThreadSnapshot
  capabilities: {
    canFollowup?: boolean
    canStop: boolean
    canRetry: boolean
    canRespondToApprovals: boolean
    canRespondToQuestions: boolean
    canApplyWorktree: boolean
    canDiscardWorktree: boolean
    canRestoreWorkspace: boolean
  }
}

export type DesktopSessionStoreChange = {
  activeSessionId: string | null
  sessions: DesktopSessionSnapshot[]
  /** List-level interaction metadata; no interaction payloads or thread content. */
  pendingInteractionThreadIds?: readonly string[]
}

export type DesktopSessionCatalogStatus = {
  state: 'loading' | 'ready' | 'unavailable'
}

export type DesktopSettingsChange = {
  settings: DesktopStoredSettings
}

export type DesktopSessionMetadataPatch = {
  archivedAt?: string | null
}

export type DesktopAgentEvent = AgentRuntimeEvent

export type DesktopWorkflowEvent = ThreadEvent

export type DesktopWorktreeEligibility = {
  isGitRepository: boolean
  availableModes: ReadonlyArray<'local' | 'worktree'>
  defaultMode: 'local' | 'worktree'
}

export type CreateDesktopSessionOptions = {
  creationSurface?: ThreadCreationSurface
  appServerThreadId?: string | null
  localRouterMode?: LocalRouterMode
  projectId?: string
  workspacePath?: string
  /** Optional workflow the new thread joins. */
  workflowId?: string
  /** First submitted text used to name/materialize a projectless workspace. */
  projectlessPrompt?: string
  permissionConfig?: DesktopPermissionConfig
  collaborationMode?: DesktopCollaborationMode
  planModeActive?: boolean
  providerID?: ModelProviderID
  providerBaseURL?: string
  model?: string
  sessionName?: string
  thinkingMode?: DesktopThinkingMode
  systemPrompt?: string
  appendSystemPrompt?: string
  additionalDirectories?: string[]
  installPidexDependencies?: boolean
  enableMemory?: boolean
  rustSearchAndDiffKernels?: boolean
}

export type CreateDesktopSessionResult = {
  sessionId: string
  workspace: DesktopWorkspace
  standalone: boolean
}

export type DesktopThreadGoal = ThreadGoal

export type DesktopThreadBookmarkList = {
  threadId: string
  inputIds: string[]
  version: number
}

export type DesktopRuntimePermissionProfile = {
  id: string
  description: string | null
}

export type DesktopSkillFormat = 'pidex' | 'agents' | 'codex' | 'claude'

export type DesktopSkillSource = 'workspace' | 'user' | 'system' | 'admin'

export type DesktopInstalledSkill = {
  name: string
  description: string
  shortDescription?: string
  path: string
  scope: 'user' | 'repo' | 'system' | 'admin'
  source: DesktopSkillSource
  format: DesktopSkillFormat
  enabled: boolean
}

export type DesktopInstalledSkillDetails = DesktopInstalledSkill & {
  content: string
}

export type DesktopRuntimeHook = {
  key: string
  eventName: string
  handlerType: string
  matcher: string | null
  command: string | null
  timeoutSec: number
  statusMessage: string | null
  sourcePath: string
  source: string
  pluginId: string | null
  displayOrder: number
  enabled: boolean
  isManaged: boolean
  currentHash: string
  trustStatus: 'managed' | 'untrusted' | 'trusted' | 'modified'
}

export type DesktopCatalogResult<T> =
  | { state: 'ready'; data: T; updatedAt: string }
  | { state: 'stale'; data: T; updatedAt: string; error: string }
  | { state: 'unavailable'; data: null; error: string }

export type DesktopAiReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string; title?: string | null }
  | { type: 'custom'; instructions: string }

export type DesktopAiReviewStartResult = {
  threadId: string
  turnId: string
  delivery: DesktopReviewDelivery
  source: DesktopReviewSource
}

export type DesktopRollbackRequest = {
  sessionId: string
  numTurns: number
  restoreFiles: boolean
}

export type DesktopRollbackResult = {
  snapshot: DesktopSessionSnapshot
  restoredFiles: string[]
}

export type DesktopModelSelection = {
  providerID?: ModelProviderID
  providerBaseURL?: string
  model?: string
  variant?: string
  localRouterMode?: LocalRouterMode
}

export type DesktopSkillOwnerFilter = 'all' | 'official' | 'community'

export type DesktopSkillCatalogOptions = {
  query?: string
  owner?: DesktopSkillOwnerFilter
  view?: 'all-time' | 'trending' | 'hot'
  page?: number
  perPage?: number
}

export type DesktopSkillCatalogItem = {
  id: string
  slug: string
  name: string
  source: string
  installs: number
  sourceType: string
  installUrl: string | null
  url: string
  isDuplicate: boolean
  installed: boolean
  audit: DesktopSkillAudit | null
}

export type DesktopSkillCatalogResult = {
  skills: DesktopSkillCatalogItem[]
  page: number
  perPage: number
  total?: number
  hasMore: boolean
}

export type DesktopSkillAuditStatus = 'pass' | 'warn' | 'fail'

export type DesktopSkillAudit = {
  status: DesktopSkillAuditStatus
  summary: string
  providerCount: number
  auditedAt: string | null
}

export type DesktopSkillInstallOptions = {
  id: string
  installUrl?: string | null
}

export type DesktopSkillInstallResult = {
  id: string
  slug: string
  installed: boolean
  installPath: string
}

export type DesktopUiCommand =
  'newConversation' | 'chooseWorkspace' | 'refreshWorkspace' | 'openSettings' | 'logOut'

export type { DesktopDataLocationControlSource, DesktopDataLocationState }
export type DesktopDataLocationMigrationResult = DesktopDataLocationChange

export type DebugToolProbeMode = 'safe' | 'realManual' | 'realAuto'

export type DebugToolProbeItemStatus =
  'passed' | 'failed' | 'permissionDenied' | 'skippedByEnvironment'

export type DebugToolProbeItem = {
  toolName: string
  status: DebugToolProbeItemStatus
  reason?: string
  durationMs?: number
  permissionRequestId?: string
  permissionDecision?: string
  inputSummary?: string
  error?: string
}

export type DebugToolProbeReport = {
  runId: string
  mode: DebugToolProbeMode
  startedAt: string
  finishedAt?: string
  cancelled?: boolean
  totalTools: number
  passed: number
  failed: number
  permissionDenied: number
  skippedByEnvironment: number
  items: DebugToolProbeItem[]
  logPath?: string
}

export type RustSidecarBinarySource = 'env-override' | 'workspace' | 'bundled'

export type RustSidecarProbeInfo = {
  binaryPath: string
  binarySource: RustSidecarBinarySource
  binaryExists: boolean
  configDirectoryPath: string
  sqliteHome?: string
  protocolCapabilities?: string[]
  userAgent?: string
}

export type DesktopProjectMemoryType = 'user' | 'feedback' | 'project' | 'reference'

export type DesktopProjectMemory = {
  relativePath: string
  absolutePath: string
  type?: DesktopProjectMemoryType
  description: string | null
  size: number
  mtimeMs: number
}

export type DesktopProjectMemoryListing = {
  memoryDir: string
  entrypointPath: string
  memories: DesktopProjectMemory[]
}

export type DesktopUserMemoryListing = {
  memoryDir: string
  profilePath: string
  preferencesPath: string
  eventsPath: string
  conversationIndexPath: string
  memories: DesktopProjectMemory[]
}

export type DesktopProjectMemoryContent = DesktopProjectMemory & {
  content: string
}

export type DesktopTaskSuggestion = RpcResult<'task-suggestion/generate'>['suggestions'][number]

export type GenerateDesktopTaskSuggestionsInput = {
  surface?: 'coding' | 'working'
  workspacePath: string | null
  context: RpcParams<'task-suggestion/generate'>['context']
}

export type SaveProjectMemoryInput = {
  workspacePath: string
  relativePath: string
  content: string
}

export type DeleteProjectMemoryInput = {
  workspacePath: string
  relativePath: string
}

export type ResetProjectMemoryInput = {
  workspacePath: string
  includeRecallLog: boolean
}

export type SaveUserMemoryInput = {
  relativePath: string
  content: string
}

export type DeleteUserMemoryInput = {
  relativePath: string
}

export type ResetUserMemoryInput = {
  includeEventLog: boolean
}

export type ExportUserMemoryResult = {
  memoryDir: string
  files: Array<{
    relativePath: string
    content: string
  }>
}

export type ImportUserMemoryInput = {
  files: Array<{
    relativePath: string
    content: string
  }>
}

export type DesktopMemoryRecallFile = {
  relativePath: string
  type?: DesktopProjectMemoryType
  description?: string | null
  mtimeMs?: number
  truncated?: boolean
}

export type DesktopMemoryRecallEvent = {
  sessionId: string
  createdAt: string
  querySummary: string
  status: 'injected' | 'viewed'
  consumedOnIteration: number
  memories: DesktopMemoryRecallFile[]
}

export type DesktopMemoryRecallListing = {
  recallLogPath: string
  recalls: DesktopMemoryRecallEvent[]
}

export type DesktopApi = {
  listSubagents?(threadId: string): Promise<SubagentProjection[]>
  readSubagent?(taskId: string): Promise<DesktopSubagentRead>
  stopSubagent?(taskId: string): Promise<unknown>
  retrySubagent?(taskId: string): Promise<unknown>
  followupSubagent?(taskId: string, message: string): Promise<unknown>
  sendSubagent?(taskId: string, message: string): Promise<unknown>
  applySubagentWorktree?(taskId: string): Promise<unknown>
  discardSubagentWorktree?(taskId: string): Promise<unknown>
  restoreSubagentWorkspace?(taskId: string): Promise<unknown>
  respondSubagentApproval?(
    approval: ApprovalRequest,
    decision: 'allow-once' | 'deny' | 'stop',
  ): Promise<void>
  respondSubagentPermission?(
    approval: ApprovalRequest,
    behavior: 'allow' | 'deny',
    grantScope?: DesktopPermissionGrantScope,
  ): Promise<void>
  getAuthStatus(): Promise<DesktopAuthStatus>
  getRuntimeStatus(): Promise<DesktopRuntimeStatus>
  diagnoseDesktopToolchain(): Promise<DesktopToolchainDiagnosticReport>
  reinstallDesktopToolchain(): Promise<DesktopToolchainInstallResult>
  deleteDesktopToolchain(): Promise<DesktopToolchainInstallResult>
  readConfig(params?: RpcParams<'config/read'>): Promise<DesktopConfigReadResult>
  pauseQuestion(interactionId: string, expectedVersion: number): Promise<void>
  approvalReviewState(threadId: string): Promise<RpcResult<'approval/reviewState'>>
  retryApproval(threadId: string, reviewId: string): Promise<void>
  listApprovalRules(threadId: string): Promise<RpcResult<'approval/rules/list'>>
  upsertApprovalRule(
    params: RpcParams<'approval/rules/upsert'>,
  ): Promise<RpcResult<'approval/rules/upsert'>>
  revokeApprovalRule(
    threadId: string,
    ruleId: string,
    expectedVersion?: string,
  ): Promise<RpcResult<'approval/rules/revoke'>>
  writeConfigBatch(params: DesktopConfigBatchWriteParams): Promise<DesktopConfigWriteResult>
  listConfigProfiles(): Promise<DesktopConfigProfileListResult>
  selectConfigProfile(profileId: string | null): Promise<DesktopConfigProfileSelectResult>
  getDesktopSettings(): Promise<DesktopStoredSettings>
  saveDesktopSettings(settings: DesktopStoredSettings): Promise<DesktopStoredSettings>
  listProjectMemories(workspacePath: string): Promise<DesktopProjectMemoryListing>
  readProjectMemory(
    workspacePath: string,
    relativePath: string,
  ): Promise<DesktopProjectMemoryContent>
  saveProjectMemory(input: SaveProjectMemoryInput): Promise<DesktopProjectMemory>
  deleteProjectMemory(input: DeleteProjectMemoryInput): Promise<void>
  resetProjectMemory(input: ResetProjectMemoryInput): Promise<void>
  listProjectMemoryRecalls(workspacePath: string): Promise<DesktopMemoryRecallListing>
  listUserMemories(): Promise<DesktopUserMemoryListing>
  readUserMemory(relativePath: string): Promise<DesktopProjectMemoryContent>
  saveUserMemory(input: SaveUserMemoryInput): Promise<DesktopProjectMemory>
  deleteUserMemory(input: DeleteUserMemoryInput): Promise<void>
  resetUserMemory(input: ResetUserMemoryInput): Promise<void>
  generateTaskSuggestions(
    input: GenerateDesktopTaskSuggestionsInput,
  ): Promise<RpcResult<'task-suggestion/generate'>>
  exportUserMemory(): Promise<ExportUserMemoryResult>
  importUserMemory(input: ImportUserMemoryInput): Promise<ExportUserMemoryResult>
  getBrowserState(): Promise<DesktopBrowserState>
  openBrowser(url?: string): Promise<DesktopBrowserState>
  navigateBrowser(url: string): Promise<DesktopBrowserState>
  reloadBrowser(): Promise<DesktopBrowserState>
  goBackBrowser(): Promise<DesktopBrowserState>
  goForwardBrowser(): Promise<DesktopBrowserState>
  closeBrowser(): Promise<DesktopBrowserState>
  setBrowserBounds(bounds: DesktopBrowserBounds): Promise<DesktopBrowserState>
  clearBrowserAllowedSites(): Promise<DesktopBrowserState>
  listSkillsCatalog(options?: DesktopSkillCatalogOptions): Promise<DesktopSkillCatalogResult>
  installSkill(skill: string | DesktopSkillInstallOptions): Promise<DesktopSkillInstallResult>
  listMcpServers(workspacePath?: string): Promise<DesktopMcpServerListItem[]>
  getMcpRuntimeStatus(workspacePath?: string): Promise<DesktopMcpRuntimeStatus>
  saveMcpServer(options: SaveDesktopMcpServerOptions): Promise<DesktopMcpServerListItem[]>
  removeMcpServer(
    name: string,
    scope: DesktopEditableMcpScope,
    workspacePath?: string,
  ): Promise<DesktopMcpServerListItem[]>
  setMcpServerEnabled(
    name: string,
    scope: DesktopEditableMcpScope,
    enabled: boolean,
    workspacePath?: string,
  ): Promise<DesktopMcpServerListItem[]>
  reloadMcpConfiguration(workspacePath?: string): Promise<McpReloadResult>
  startMcpOAuth(
    name: string,
    scope: DesktopEditableMcpScope,
    workspacePath?: string,
  ): Promise<DesktopMcpOAuthStartResult>
  getMcpOAuthStatus(attemptId: string): Promise<DesktopMcpOAuthStatusResult>
  logoutMcpOAuth(
    name: string,
    scope: DesktopEditableMcpScope,
    workspacePath?: string,
  ): Promise<DesktopMcpOAuthLogoutResult>
  listOpenTargets(): Promise<DesktopOpenTarget[]>
  listExternalOpenTargets(targetPath: string): Promise<DesktopExternalOpenTarget[]>
  openPathWithTarget(targetPath: string, targetId: string): Promise<void>
  openPathWithDefaultTarget(targetPath: string): Promise<void>
  revealPathInFolder(targetPath: string): Promise<void>
  listModelProviders(): Promise<DesktopModelProviderSummary[]>
  getModelProviderState(providerID?: ModelProviderID): Promise<DesktopModelProviderState>
  fetchProviderModels(options: {
    providerID: ModelProviderID
    apiKey?: string
    query?: string
    cursor?: string
    limit?: number
    all?: boolean
  }): Promise<DesktopProviderModelListResult>
  saveModelProvider(options: SaveDesktopModelProviderOptions): Promise<DesktopModelProviderState>
  /** 新建任务一级页记住的最近一次模型选择；无记录或记录失效时返回 null。 */
  getRecentNewThreadModel(): Promise<ModelRef | null>
  saveRecentNewThreadModel(model: {
    providerID: string
    id: string
    variant?: string
  }): Promise<void>
  /** 按 Provider/模型目录稳定顺序返回第一个启用且 Provider 可用的模型。 */
  resolveFirstAvailableModel(): Promise<ModelRef | null>
  saveProviderApiKey(
    providerID: ModelProviderID,
    apiKey: string,
  ): Promise<DesktopModelProviderState>
  deleteProviderApiKey(providerID: ModelProviderID): Promise<DesktopModelProviderState>
  listProviderCredentials(providerId?: ModelProviderID): Promise<DesktopProviderCredential[]>
  readProviderCredentialStore(): Promise<RpcResult<'provider/credential/store/read'>>
  updateProviderCredentialStore(
    store: RpcParams<'provider/credential/store/update'>['store'],
  ): Promise<RpcResult<'provider/credential/store/update'>>
  createApiKey(input: {
    providerId: ModelProviderID
    label: string
    key: string
  }): Promise<DesktopProviderCredential>
  updateApiKey(input: {
    credentialId: string
    label?: string
    key?: string
  }): Promise<DesktopProviderCredential>
  setActiveProviderCredential(
    providerId: ModelProviderID,
    credentialId: string,
  ): Promise<DesktopProviderCredential>
  setProviderCredentialEnabled(
    credentialId: string,
    enabled: boolean,
  ): Promise<DesktopProviderCredential>
  reorderApiKeys(
    providerId: ModelProviderID,
    orderedCredentialIds: string[],
  ): Promise<DesktopProviderCredential[]>
  testApiKey(credentialId: string): Promise<ProviderTestResponse>
  deleteProviderCredential(credentialId: string): Promise<DesktopProviderCredential[]>
  testModelProvider(
    providerID: ModelProviderID,
    model?: DesktopModelRef,
  ): Promise<RpcResult<'provider/test'>>
  /** 立即同步上游模型列表；首次只建基线，之后返回下架/候选差异。 */
  syncProviderModels(providerId: ModelProviderID): Promise<RpcResult<'provider/model/sync'>>
  /** 对草稿地址逐协议（或批量模型）做最小生成探测，不落盘。 */
  detectProviderProtocols(
    params: RpcParams<'provider/protocol/detect'>,
  ): Promise<RpcResult<'provider/protocol/detect'>>
  /** 用未保存草稿探测单个模型可达性；缺省用合成 providerID 构造 Model.Ref。 */
  testProviderDraft(input: {
    providerId?: ModelProviderID
    modelId: string
    api: DesktopProviderChatApi
    draft: DesktopProviderDraft
  }): Promise<RpcResult<'provider/test'>>
  previewModelHealth(): Promise<RpcResult<'model/health/preview'>>
  startModelHealth(operationId: string): Promise<RpcResult<'model/health/start'>>
  readModelHealth(runId: string): Promise<RpcResult<'model/health/read'>>
  cancelModelHealth(runId: string, operationId: string): Promise<RpcResult<'model/health/cancel'>>
  createProvider(definition: DesktopCustomProviderDefinition): Promise<void>
  updateProvider(providerId: ModelProviderID, definition: DesktopProviderDefinition): Promise<void>
  deleteProvider(providerId: ModelProviderID): Promise<void>
  modelRecommendations?: {
    supported(): Promise<boolean>
    preview(
      input: RpcParams<'model/recommendation/preview'>,
    ): Promise<RpcResult<'model/recommendation/preview'>>
    refresh(): Promise<RpcResult<'model/recommendation/refresh'>>
  }
  /** 读取上游模型列表；提供 draft 时用于保存前获取，不访问已保存配置。 */
  discoverProviderModels(input: {
    providerId?: ModelProviderID
    api: DesktopProviderChatApi
    draft?: DesktopProviderDraft
  }): Promise<DesktopProviderModelDefinition[]>
  startAuthSession(target: DesktopAuthTarget): Promise<DesktopAuthSession>
  respondAuthSession(
    sessionId: string,
    promptId: string,
    value: string,
  ): Promise<DesktopAuthSession>
  getAuthSessionStatus(sessionId: string): Promise<DesktopAuthSession>
  cancelAuthSession(sessionId: string): Promise<DesktopAuthSession>
  getCopilotAuthStatus(): Promise<DesktopCopilotAuthStatus>
  startCopilotLogin(): Promise<DesktopCopilotLoginStatus>
  pollCopilotLogin(): Promise<DesktopCopilotLoginStatus>
  cancelCopilotLogin(): Promise<{ cancelled: boolean }>
  getGithubAuthStatus(): Promise<DesktopGithubAuthStatus>
  startGithubLogin(input: StartGithubLoginInput): Promise<DesktopGithubLoginStatus>
  pollGithubLogin(): Promise<DesktopGithubLoginStatus>
  logoutGithub(): Promise<DesktopGithubAuthStatus>
  listGithubRepositories(): Promise<DesktopGithubRepositoryListResult>
  getGithubProfileOverview(): Promise<DesktopGithubProfileOverviewResult>
  setGithubUserStatus(input: DesktopGithubUserStatusInput): Promise<DesktopGithubUserStatusResult>
  clearGithubUserStatus(): Promise<DesktopGithubUserStatusResult>
  cloneGithubRepository(input: CloneGithubRepositoryInput): Promise<DesktopGithubCloneResult>
  listProjects(folderPath?: string): Promise<DesktopWorkspace[]>
  updateProject(input: {
    projectId: string
    name: string
    expectedVersion: number
  }): Promise<DesktopWorkspace>
  editProject(input: {
    projectId: string
    name: string
    paths: string[]
    expectedVersion: number
  }): Promise<DesktopWorkspace>
  restoreProject(projectId: string, removalOperationId: string): Promise<DesktopWorkspace>
  removeProject(
    projectId: string,
  ): Promise<{ archivedThreadCount: number; removalOperationId?: string; undoExpiresAt?: number }>
  addProjectFolder(projectId: string, path: string): Promise<DesktopWorkspace>
  removeProjectFolder(projectId: string, folderId: string): Promise<DesktopWorkspace>
  setPrimaryProjectFolder(projectId: string, folderId: string): Promise<DesktopWorkspace>
  updateProjectSettings(input: {
    projectId: string
    instructions?: string
    defaultModel?: ModelRef | null
    executionEnvironment?: 'auto' | 'local'
    expectedVersion: number
  }): Promise<DesktopWorkspace>
  listProjectSources(projectId: string): Promise<DesktopProjectSource[]>
  importProjectSources(
    projectId: string,
    uploads: Array<{
      kind: 'text' | 'image'
      name: string
      mediaType: string
      encoding: 'utf8' | 'base64'
      data: string
    }>,
  ): Promise<DesktopProjectSource[]>
  addProjectSourceReference(
    projectId: string,
    folderId: string,
    path: string,
  ): Promise<DesktopProjectSource[]>
  readProjectSource(
    projectId: string,
    sourceId: string,
    range?: { offset: number; length: number },
  ): Promise<DesktopProjectSourceReadResult>
  removeProjectSource(projectId: string, sourceId: string): Promise<boolean>
  chooseProjectFolder(): Promise<string | null>
  chooseProjectFolders(): Promise<string[]>
  chooseWorkspace(): Promise<DesktopWorkspace | null>
  openWorkspace(workspacePath: string, projectId?: string): Promise<DesktopWorkspace>
  getWorkspaceContext(workspacePath: string, projectId?: string): Promise<DesktopWorkspace>
  checkoutWorkspaceBranch(
    workspacePath: string,
    branchName: string,
    projectId?: string,
  ): Promise<DesktopWorkspace>
  getWorkspaceGitStatus(
    workspacePath: string,
    projectId?: string,
    options?: { refresh?: boolean },
  ): Promise<DesktopGitStatusResult>
  fetchWorkspaceRepository(
    workspacePath: string,
    projectId?: string,
  ): Promise<DesktopGitStatusResult>
  pullWorkspaceRepository(
    workspacePath: string,
    projectId?: string,
  ): Promise<DesktopGitStatusResult>
  createWorkspaceBranch(input: CreateBranchInput): Promise<DesktopGitWorkspaceResult>
  commitWorkspaceChanges(input: CommitChangesInput): Promise<DesktopGitOperationResult>
  pushWorkspaceBranch(input: PushBranchInput): Promise<DesktopGitOperationResult>
  discardWorkspaceChanges(input: DiscardWorkspaceChangesInput): Promise<DesktopGitOperationResult>
  restoreSessionTurnChanges(
    input: RestoreSessionTurnChangesInput,
  ): Promise<DesktopGitOperationResult>
  createPullRequest(input: CreatePullRequestInput): Promise<DesktopPullRequestResult>
  listThreadPullRequests(threadIds: string[]): Promise<DesktopThreadPullRequestsResult>
  linkThreadPullRequest(
    input: LinkThreadPullRequestInput,
  ): Promise<DesktopThreadPullRequestMutationResult>
  unlinkThreadPullRequest(
    input: UnlinkThreadPullRequestInput,
  ): Promise<DesktopThreadPullRequestMutationResult>
  getWorkspaceReviewDiff(input: DesktopReviewDiffInput): Promise<DesktopReviewDiffResult>
  applyWorkspaceReviewOperation(
    input: DesktopReviewOperationInput,
  ): Promise<DesktopReviewOperationResult>
  listWorkspaceFiles(
    workspacePath: string,
    directoryPath?: string,
    folderId?: string,
    projectId?: string,
  ): Promise<DesktopFileEntry[]>
  readWorkspaceFile(
    workspacePath: string,
    filePath: string,
    folderId?: string,
    projectId?: string,
  ): Promise<DesktopFilePreview>
  readOptionalWorkspaceFile(
    workspacePath: string,
    filePath: string,
    folderId?: string,
    projectId?: string,
  ): Promise<DesktopFilePreview | null>
  saveWorkspaceFile(input: DesktopFileSaveInput): Promise<DesktopFileSaveResult>
  watchWorkspaceFile(
    workspacePath: string,
    filePath: string,
    folderId?: string,
    projectId?: string,
  ): Promise<void>
  unwatchWorkspaceFile(
    workspacePath: string,
    filePath: string,
    folderId?: string,
    projectId?: string,
  ): Promise<void>
  getWorkspaceDiff(workspacePath: string): Promise<DesktopDiffSummary>
  getThemeSettings(): Promise<DesktopThemeSettings>
  saveThemeSettings(settings: DesktopThemeSettings): Promise<void>
  canRestorePreviousAppearance(): Promise<boolean>
  restorePreviousAppearance(): Promise<DesktopThemeSettings>
  applyNewDesignTheme(): Promise<DesktopThemeSettings>
  createSession(options: CreateDesktopSessionOptions): Promise<CreateDesktopSessionResult>
  createSideChat(input: {
    sourceThreadId: string
    referenceText?: string
  }): Promise<RpcResult<'thread/side-chat/create'>>
  discardSideChat(input: { threadId: string }): Promise<RpcResult<'thread/side-chat/discard'>>
  listSessions(options?: { archived?: boolean }): Promise<DesktopSessionSnapshot[]>
  getSessionCatalogStatus(): Promise<DesktopSessionCatalogStatus>
  getSession(sessionId: string): Promise<DesktopSessionSnapshot>
  getActiveSessionId(): Promise<string | null>
  setActiveSession(sessionId: string | null): Promise<void>
  /**
   * Renderer-local status channel. The canonical thread projection publishes the
   * status of the thread it covers here, and the session store change carries the
   * merged value so every list surface reads one status. `null` clears it.
   */
  publishCanonicalSessionStatus(
    threadId: string,
    status: {
      status: DesktopSessionStatus
      latestTurnStatus: ThreadListItem['latestTurnStatus']
    } | null,
  ): void
  markSessionRead(sessionId: string, readThroughAt: string): Promise<DesktopSessionListItem>
  markSessionUnread(sessionId: string, unreadAt: string): Promise<DesktopSessionListItem>
  updateSessionMetadata(
    sessionId: string,
    patch: DesktopSessionMetadataPatch,
  ): Promise<DesktopSessionSnapshot>
  renameSession(sessionId: string, name: string): Promise<DesktopSessionSnapshot>
  saveSessionReviewComment(input: SaveSessionReviewCommentInput): Promise<DesktopSessionSnapshot>
  resolveSessionReviewComment(input: SessionReviewCommentInput): Promise<DesktopSessionSnapshot>
  deleteSessionReviewComment(input: SessionReviewCommentInput): Promise<DesktopSessionSnapshot>
  setSessionPermissionMode(
    sessionId: string,
    mode: DesktopPermissionMode,
  ): Promise<DesktopSessionSnapshot>
  setSessionPlanModeActive(sessionId: string, active: boolean): Promise<DesktopSessionSnapshot>
  setSessionLocalRouterMode(
    sessionId: string,
    mode: LocalRouterMode,
  ): Promise<DesktopSessionSnapshot>
  openExternalURL(url: string): Promise<void>
  supportsMessageEditing?(): boolean
  editUserMessage?(
    sessionId: string,
    target: { turnId: string; inputId: string; operationId: string },
    input: DesktopUserMessageInput,
  ): Promise<void>
  sendUserMessage(
    sessionId: string,
    content: DesktopUserMessageInput,
    model?: string | DesktopModelSelection,
    inputId?: string,
    goal?: DesktopGoalSubmission,
  ): Promise<void>
  respondToPermission(
    sessionId: string,
    requestId: string,
    decision: DesktopPermissionDecision,
  ): Promise<void>
  interruptSession(sessionId: string): Promise<void>
  disposeSession(sessionId: string): Promise<void>
  submitSessionFollowUp(
    sessionId: string,
    input: DesktopUserMessageInput,
    delivery: DesktopMessageDelivery,
    inputId?: string,
    model?: string | DesktopModelSelection,
  ): Promise<'sent' | 'steered' | 'queued'>
  updateQueuedFollowUp(
    sessionId: string,
    followUpId: string,
    input: DesktopUserMessageInput,
  ): Promise<DesktopSessionSnapshot>
  removeQueuedFollowUp(sessionId: string, followUpId: string): Promise<DesktopSessionSnapshot>
  resumeQueuedFollowUps(sessionId: string): Promise<DesktopSessionSnapshot>
  supportsQueuedCompaction(): boolean
  cancelCompaction(sessionId: string, operationId: string): Promise<void>
  compactSession(sessionId: string): Promise<void>
  getSessionPromptPreview(sessionId: string): Promise<unknown>
  rollbackSession(input: DesktopRollbackRequest): Promise<DesktopRollbackResult>
  getSessionGoal(sessionId: string): Promise<DesktopThreadGoal | null>
  setSessionGoal(
    sessionId: string,
    input: {
      objective?: string
      status?: 'active' | 'paused' | 'complete'
      tokenBudget?: number | null
    },
  ): Promise<DesktopThreadGoal>
  clearSessionGoal(sessionId: string): Promise<boolean>
  listThreadBookmarks(sessionId: string): Promise<DesktopThreadBookmarkList | null>
  setThreadBookmark(
    sessionId: string,
    input: { inputId: string; bookmarked: boolean; expectedVersion: number },
  ): Promise<DesktopThreadBookmarkList | null>
  startSessionReview(
    sessionId: string,
    target: DesktopAiReviewTarget,
  ): Promise<DesktopAiReviewStartResult>
  listRuntimePermissionProfiles(
    workspacePath: string,
    options?: { forceRefresh?: boolean },
  ): Promise<DesktopCatalogResult<DesktopRuntimePermissionProfile[]>>
  setSessionPermissionProfile(
    sessionId: string,
    profile: string,
    approvalPolicy?: DesktopApprovalPolicy,
  ): Promise<DesktopSessionSnapshot>
  listRuntimeSkills(
    workspacePath?: string | null,
    options?: { forceReload?: boolean },
  ): Promise<DesktopCatalogResult<DesktopInstalledSkill[]>>
  readRuntimeSkill(
    path: string,
    workspacePath?: string | null,
  ): Promise<DesktopInstalledSkillDetails>
  setRuntimeSkillEnabled(path: string, enabled: boolean): Promise<DesktopInstalledSkill>
  onRuntimeSkillsUpdated(callback: (generation: number) => void): () => void
  minimizeWindow(): Promise<void>
  toggleWindowMaximized(): Promise<boolean>
  closeWindow(): Promise<void>
  isWindowMaximized(): Promise<boolean>
  newWindow(): Promise<void>
  openDevTools(): Promise<void>
  closeDevTools(): Promise<void>
  openSettings(): Promise<void>
  logOut(): Promise<void>
  exitApp(): Promise<void>
  getDataLocation(): Promise<DesktopDataLocationState>
  chooseDataLocation(): Promise<DesktopDataLocationMigrationResult | null>
  onAgentEvent(callback: (event: DesktopAgentEvent) => void): () => void
  onWorkflowEvent(callback: (event: DesktopWorkflowEvent) => void): () => void
  onUiCommand(callback: (command: DesktopUiCommand) => void): () => void
  onSessionStoreChange(callback: (change: DesktopSessionStoreChange) => void): () => void
  onReconciliationError?(callback: (error: unknown) => void): () => void
  onDesktopSettingsChange(callback: (change: DesktopSettingsChange) => void): () => void
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  quitAndInstall(): Promise<void>
  onUpdateStatusChange(callback: (status: DesktopUpdateStatus) => void): () => void
  listDebugBuiltinTools(): Promise<{
    toolNames: string[]
    enabled: boolean[]
    hasProbeInput: boolean[]
  }>
  runDebugToolProbe(mode: DebugToolProbeMode): Promise<DebugToolProbeReport>
  cancelDebugToolProbe(runId: string): Promise<void>
}
