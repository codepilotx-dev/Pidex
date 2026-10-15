import type { ComputerUseService } from '../../computer/ComputerUseService'
import {
  PermissionConfigSchema,
  ThreadSettingsPatchSchema,
  ThreadSettingsSchema,
  type PermissionConfig,
} from '@pidex/shared/thread'
import {
  QueueAddParamsSchema,
  QueueInputParamsSchema,
  QueueResumeParamsSchema,
  QueueUpdateParamsSchema,
  SandboxUninstallParamsSchema,
  TurnInterruptParamsSchema,
  TurnStartParamsSchema,
  TurnSteerParamsSchema,
} from '@pidex/agent-protocol'
import { Effect, Schema } from 'effect'
import { Model, Provider } from '@pidex/model-schema'
import { createHash } from 'node:crypto'
import type { AgentModelCatalog } from '../../provider/AgentModelCatalog'
import { AgentError, type SubmitMessage, type TaskMode } from '../../Domain'
import type { ApprovalService } from '../../permission/ApprovalService'
import type { QuestionService } from '../../session/QuestionService'
import { PlanApprovalService } from '../../session/plan/PlanApprovalService'
import type { ApiKeyService } from '../../provider/ApiKeyService'
import type { ModelHealthService } from '../../provider/ModelHealthService'
import type { ProviderCredentialService } from '../../provider/ProviderCredentialService'
import type { ProviderCredentialStoreManager } from '../../auth/ProviderCredentialStoreManager'
import type { PiModelService } from '../../provider/pi'
import { resolveSpecializedPiModel } from '../../provider/pi/PiSpecializedModelResolver'
import type { PiAuthSessionService } from '../../auth/PiAuthSessionService'
import type { ThreadHistoryService } from '../../session/ThreadHistoryService'
import type { ThreadService } from '../../session/ThreadService'
import type { AgentDatabase } from '../../storage/database/AgentDatabase'
import type { EventHub } from '../../storage/events/EventHub'
import { globalEventSequence, publishAgentEvent } from '../../storage/events/EventPublisher'
import type { SubagentService } from '../../subagent/SubagentService'
import type { AttachmentService } from '../../subagent/AttachmentService'
import type { ArtifactService } from '../../storage/ArtifactService'
import type { LocalContextPathService } from '../../local-context/LocalContextPathService'
import type { ProjectSourceService } from '../../project/ProjectSourceService'
import { WorkspaceService } from '../../workspace/WorkspaceService'
import { InvalidThreadHistoryCursorError, ThreadProjection } from '../ThreadProjection'
import { projectMemoryKey, type MemoryService } from '../../memory/MemoryService'
import type { HookService } from '../../hooks/HookService'
import type { GitReviewService } from '../../review/GitReviewService'
import type { GithubService } from '../../github/GithubService'
import type { ThreadPullRequestService } from '../../github/ThreadPullRequestService'
import type { PullRequestWatchService } from '../../github/PullRequestWatchService'
import type { GitWorkspaceService } from '../../git/GitWorkspaceService'
import type { ToolingManager } from '../../tool/ToolingManager'
import type { PetService } from '../../pet/PetService'
import type { ReleaseNotesService } from '../../release-notes/ReleaseNotesService'
import type { SkillManagementService } from '../../prompt/SkillManagementService'
import type { PluginManagementService } from '../../plugin/PluginManagementService'
import type { MiniMaxCliIntegrationService } from '../../integration/minimax-cli/MiniMaxCliIntegrationService'
import type { McpRuntimeService } from '../../mcp/McpRuntimeService'
import type { TaskSuggestionService } from '../../suggestion/TaskSuggestionService'
import type { UsageService } from '../../usage/UsageService'
import type { ConfigService } from '../../config/ConfigService'
import type { TurnPatchService } from '../../patch/TurnPatchService'
import type { TerminalContextService } from '../../terminal/TerminalContextService'
import type { TerminalOutputMirror } from '../../terminal/TerminalOutputMirror'
import type { LocalEnvironmentService } from '../../local-environment/LocalEnvironmentService'
import type { ManagedWorktreeService } from '../../worktree/ManagedWorktreeService'
import type { HandoffService } from '../../handoff/HandoffService'
import type { TaskExecutionBindingService } from '../../worktree/TaskExecutionBindingService'
import type { WorktreeRepository } from '../../worktree/WorktreeRepository'
import type { EnvironmentDeltaStore } from '../../local-environment/EnvironmentDeltaStore'
import type { SpeechTranscriptionService } from '../../speech/SpeechTranscriptionService'
import type { ThreadExecutionPreparationService } from '../../worktree/ThreadExecutionPreparationService'
import type { SessionGroupService } from '../../session-group/SessionGroupService'
import type { ThreadGoalService } from '../../session/ThreadGoalService'
import type { ThreadBookmarkService } from '../../session/ThreadBookmarkService'
import type { AutomationService } from '../../automation'
import type { CalendarService, SchedulePlanService, ScheduledTaskService } from '../../calendar'
import type { TaskScheduleService } from '../../calendar/TaskScheduleService'
import type { ThreadMessageForkService } from '../../session/fork/ThreadMessageForkService'
import type { SideChatService } from '../../session/side-chat/SideChatService'
import type { MemoryManager } from '../../resource/MemoryManager'
import { InteractionService } from '../../interaction/InteractionService'
import { ThreadReadViewRepository } from '../../session/ThreadReadViewRepository'
import { EventSubscriptionRegistry } from '../EventSubscriptionRegistry'
import { secretScrubber } from '../../security/SecretScrubber'
import { createRpcHandlerRegistry } from './Registry'
import type { RpcRouterContext } from './RequestContext'
import { decodeRpcParams as decodeParams, rpcRecord as record } from './Decoders'
import {
  capabilityRequiredResponse,
  unauthorizedNotificationResponse,
  unauthorizedRequestResponse,
  workspaceFileApplicationErrorCode,
} from './Errors'

export {
  Effect,
  Model,
  WorkspaceService,
  globalEventSequence,
  secretScrubber,
  AgentError,
  Capabilities,
  InvalidThreadHistoryCursorError,
}
import {
  ReviewApplyBatchParamsSchema,
  ReviewApplyParamsSchema,
  ReviewAiStartParamsSchema,
  ReviewBranchesParamsSchema,
  ReviewCommentIDParamsSchema,
  ReviewCommentListParamsSchema,
  ReviewCommentSaveParamsSchema,
  ReviewCommitParamsSchema,
  ReviewCommitsParamsSchema,
  ReviewFileDiffParamsSchema,
  ReviewStatusParamsSchema,
  ReviewSummaryParamsSchema,
  Capabilities,
  RpcApplicationError,
  dispatchRpcMessageWithMethods,
  type ApplicationErrorCode,
  type JsonValue,
  type ProtocolCapability,
  type RpcHandlers,
  type RpcMethod,
  type ReviewAiTarget,
  type ReviewSource,
} from '@pidex/agent-protocol'
import { AllRpcMethods as RpcMethods } from '@pidex/agent-protocol/host'

import type { BrowserService } from '../../browser/BrowserService'

export type RpcRouterDependencies = {
  mcpElicitations?: import('../../mcp/McpElicitationService').McpElicitationService
  computer?: ComputerUseService
  browser?: BrowserService
  config: ConfigService
  db: AgentDatabase
  hub: EventHub
  threads: ThreadService
  planApprovals?: PlanApprovalService | undefined
  history: ThreadHistoryService
  approvals: ApprovalService
  questions: QuestionService
  subagents: SubagentService
  attachments: AttachmentService
  artifacts: ArtifactService
  localContextPaths: LocalContextPathService
  projectSources: ProjectSourceService
  providers: AgentModelCatalog
  piModels: PiModelService
  apiKeys: ApiKeyService
  modelHealth: ModelHealthService
  providerCredentials: ProviderCredentialService
  providerCredentialStore: ProviderCredentialStoreManager
  authSessions: PiAuthSessionService
  memory: MemoryService
  hooks: HookService
  review: GitReviewService
  github: GithubService
  git: GitWorkspaceService
  tooling: ToolingManager
  pets: PetService
  releaseNotes: ReleaseNotesService
  skills?: SkillManagementService
  plugins?: PluginManagementService
  minimaxCli: MiniMaxCliIntegrationService
  mcp?: McpRuntimeService
  suggestions?: TaskSuggestionService
  usage: UsageService
  turnPatches: TurnPatchService
  terminalContext: TerminalContextService
  terminalOutput: TerminalOutputMirror
  localEnvironment: LocalEnvironmentService
  worktrees: ManagedWorktreeService
  handoff: HandoffService
  threadFork: ThreadMessageForkService
  sideChats: SideChatService
  executionBindings: TaskExecutionBindingService
  worktreeRepository: WorktreeRepository
  environmentDeltas: EnvironmentDeltaStore
  speech: SpeechTranscriptionService
  threadExecutions: ThreadExecutionPreparationService
  sessionGroups: SessionGroupService
  threadGoals: ThreadGoalService
  threadBookmarks: ThreadBookmarkService
  threadPullRequests: ThreadPullRequestService
  automation: AutomationService
  prWatches?: PullRequestWatchService
  calendar?: CalendarService
  taskSchedules?: TaskScheduleService
  scheduledTasks?: ScheduledTaskService
  schedulePlans?: SchedulePlanService
  memoryManager?: MemoryManager | undefined
}

export type { RpcRouterContext } from './RequestContext'

type ModelCatalogPage = {
  providers: Array<{ provider: Provider.Info; models: Model.Info[] }>
  defaultModel: Model.Ref | null
  reviewerModel: Model.Ref | null
  catalogVersion: number
  total?: number
  nextCursor?: string
}

const DESKTOP_THINKING_MODES = new Set(['default', 'enabled', 'adaptive', 'disabled'])

export const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T => {
  if (typeof value !== 'string' || !allowed.includes(value as T))
    throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  return value as T
}

export const decodeTurnStart = Schema.decodeUnknownSync(TurnStartParamsSchema)
export const decodeTurnSteer = Schema.decodeUnknownSync(TurnSteerParamsSchema)
export const decodeTurnInterrupt = Schema.decodeUnknownSync(TurnInterruptParamsSchema)
export const decodeQueueAdd = Schema.decodeUnknownSync(QueueAddParamsSchema)
export const decodeQueueUpdate = Schema.decodeUnknownSync(QueueUpdateParamsSchema)
export const decodeQueueInput = Schema.decodeUnknownSync(QueueInputParamsSchema)
export const decodeQueueResume = Schema.decodeUnknownSync(QueueResumeParamsSchema)
export const decodeThreadSettings = Schema.decodeUnknownSync(ThreadSettingsSchema)
export const decodeThreadSettingsPatch = Schema.decodeUnknownSync(ThreadSettingsPatchSchema)
export const decodePermissionConfig = Schema.decodeUnknownSync(PermissionConfigSchema)
export const decodeSandboxUninstall = Schema.decodeUnknownSync(SandboxUninstallParamsSchema)
export const decodeReviewSummary = Schema.decodeUnknownSync(ReviewSummaryParamsSchema)
export const decodeReviewFileDiff = Schema.decodeUnknownSync(ReviewFileDiffParamsSchema)
export const decodeReviewApply = Schema.decodeUnknownSync(ReviewApplyParamsSchema)
export const decodeReviewApplyBatch = Schema.decodeUnknownSync(ReviewApplyBatchParamsSchema)
export const decodeReviewAiStart = Schema.decodeUnknownSync(ReviewAiStartParamsSchema)
export const decodeReviewBranches = Schema.decodeUnknownSync(ReviewBranchesParamsSchema)
export const decodeReviewCommit = Schema.decodeUnknownSync(ReviewCommitParamsSchema)
export const decodeReviewCommits = Schema.decodeUnknownSync(ReviewCommitsParamsSchema)
export const decodeReviewStatus = Schema.decodeUnknownSync(ReviewStatusParamsSchema)
export const decodeReviewCommentList = Schema.decodeUnknownSync(ReviewCommentListParamsSchema)
export const decodeReviewCommentSave = Schema.decodeUnknownSync(ReviewCommentSaveParamsSchema)
export const decodeReviewCommentID = Schema.decodeUnknownSync(ReviewCommentIDParamsSchema)

// The shared schema is the compatibility boundary. Do not collapse the Codex
// permission matrix back into a handful of renderer presets here.
export const supportedPermissionConfig = (value: PermissionConfig) => value

export const resolveMemoryProjectKey = async (
  db: AgentDatabase,
  params: Record<string, unknown>,
) => {
  if (params.workspacePath !== undefined)
    throw new AgentError(
      'INVALID_REQUEST',
      '项目记忆 RPC 不接受 workspacePath，请使用 projectId 或 threadId',
      400,
    )
  const explicitProjectID =
    typeof params.projectId === 'string' && params.projectId.trim() ? params.projectId : undefined
  const threadID =
    typeof params.threadId === 'string' && params.threadId.trim() ? params.threadId : undefined
  if (!explicitProjectID && !threadID)
    throw new AgentError('INVALID_REQUEST', '项目记忆 RPC 缺少 projectId 或 threadId', 400)
  const threadProjectID = threadID ? db.threadProjectID(threadID) : undefined
  if (threadID && !threadProjectID)
    throw new AgentError('PROJECT_NOT_FOUND', 'Thread 未绑定已注册项目', 404)
  if (explicitProjectID && threadProjectID && explicitProjectID !== threadProjectID)
    throw new AgentError('PROJECT_SCOPE_MISMATCH', 'projectId 与 threadId 不属于同一项目', 409)
  const projectID = explicitProjectID ?? threadProjectID!
  const project = db.getProject(projectID)
  if (!project) throw new AgentError('PROJECT_NOT_FOUND', '项目不存在', 404)
  return projectMemoryKey(projectID)
}

export const resolveMemoryProjectID = (db: AgentDatabase, params: Record<string, unknown>) => {
  if (typeof params.projectId === 'string' && params.projectId) return params.projectId
  if (typeof params.threadId === 'string' && params.threadId) {
    const projectId = db.threadProjectID(params.threadId)
    if (projectId) return projectId
  }
  throw new AgentError('PROJECT_NOT_FOUND', '项目记忆缺少已注册项目', 404)
}

export const memoryEntryView = (
  entry: {
    id: string
    scope: 'user' | 'project'
    content: string
    sourceThreadID: string | null
    createdAt: number
    updatedAt: number
  },
  projectId: string | null,
) => ({
  id: entry.id,
  scope: entry.scope,
  projectId,
  content: entry.content,
  sourceThreadId: entry.sourceThreadID,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
})

export const resolveProjectWorkspace = async (db: AgentDatabase, projectId: string) => {
  const project = db.getProject(projectId)
  if (!project) throw new AgentError('PROJECT_NOT_FOUND', '项目不存在', 404)
  return WorkspaceService.open(project.rootPath)
}

export const submitMessage = (raw: unknown): SubmitMessage => {
  const body = decodeParams(decodeTurnStart, raw, 'turn/start')
  return {
    content: body.content,
    ...(body.skills ? { skills: body.skills } : {}),
    model: body.model,
    permissionConfig: supportedPermissionConfig(body.permissionConfig),
    strategy: 'start',
    taskMode: enumValue<TaskMode>(body.taskMode, ['chat', 'plan'], 'taskMode'),
  }
}

export class RpcRouter {
  readonly projection: ThreadProjection
  readonly subscriptions: EventSubscriptionRegistry
  private readonly interactions: InteractionService
  readonly planApprovals: PlanApprovalService
  private readonly threadReadViews: ThreadReadViewRepository
  readonly workspaceFileWatchers = new Map<
    string,
    {
      close: () => void
      ownerCounts: Map<string, number>
    }
  >()
  catalogVersion = 1
  private catalogSource: Promise<{
    providers: readonly Provider.Info[]
    models: readonly Model.Info[]
    modelsByProvider: ReadonlyMap<string, readonly Model.Info[]>
  }> | null = null
  private catalogSourceRevision = -1
  private readonly modelPageCache = new Map<string, Promise<ModelCatalogPage>>()
  private readonly handlers: RpcHandlers<RpcRouterContext>
  readonly connections = new Map<
    string,
    {
      initialized: boolean
      createdAt: number
      lastSeenAt: number
      capabilities: ReadonlySet<ProtocolCapability>
      authority?: 'desktop-host'
      transportAuthority?: 'desktop-host' | 'renderer'
    }
  >()
  private readonly connectionLeaseMs: number
  readonly now: () => number

  constructor(
    readonly dependencies: RpcRouterDependencies,
    options: { connectionLeaseMs?: number; now?: () => number } = {},
  ) {
    this.connectionLeaseMs = options.connectionLeaseMs ?? 60_000
    this.now = options.now ?? Date.now
    this.projection = new ThreadProjection(dependencies.db)
    this.planApprovals =
      dependencies.planApprovals ??
      new PlanApprovalService(dependencies.db, dependencies.hub, dependencies.threads)
    this.subscriptions = new EventSubscriptionRegistry(dependencies.db)
    this.interactions = new InteractionService({
      ...(dependencies.mcpElicitations ? { mcpElicitations: dependencies.mcpElicitations } : {}),
      ...(dependencies.computer ? { computer: dependencies.computer } : {}),
      db: dependencies.db,
      hub: dependencies.hub,
      approvals: dependencies.approvals,
      questions: dependencies.questions,
      subagents: dependencies.subagents,
      threads: dependencies.threads,
    })
    this.threadReadViews = new ThreadReadViewRepository(dependencies.db)
    this.handlers = createRpcHandlerRegistry(this, (method, cause) =>
      this.applicationError(method, cause),
    )
  }

  async handle(input: unknown, context: RpcRouterContext = {}) {
    if (
      context.connectionId &&
      !this.touchConnection(context.connectionId, context.transportAuthority)
    ) {
      return unauthorizedRequestResponse(input)
    } else this.reapExpiredConnections()
    if (isInitializedNotification(input)) {
      const connectionId = context.connectionId
      const connection = connectionId ? this.connections.get(connectionId) : undefined
      if (!connection) return unauthorizedNotificationResponse()
      connection.initialized = true
      return null
    }
    if (isRpcMethod(input, 'initialize'))
      return dispatchRpcMessageWithMethods(input, RpcMethods, this.handlers, context)
    const connection = context.connectionId ? this.connections.get(context.connectionId) : undefined
    if (!connection?.initialized) return unauthorizedRequestResponse(input)
    const requestedMethod = rpcMethodOf(input)
    const capability = requestedMethod ? RpcMethods[requestedMethod].capability : null
    if (capability && !connection.capabilities.has(capability)) {
      return capabilityRequiredResponse(input, capability)
    }
    return dispatchRpcMessageWithMethods(input, RpcMethods, this.handlers, context)
  }

  listPendingInteractions(rawParams: Record<string, unknown>) {
    return this.interactions.listPending(rawParams)
  }

  async respondToInteraction(rawParams: Record<string, unknown>) {
    return this.interactions.respond(rawParams)
  }

  private applicationError(method: RpcMethod, cause: unknown) {
    if (cause instanceof RpcApplicationError) return cause
    if (!(cause instanceof AgentError)) {
      return new RpcApplicationError('INTERNAL_ERROR', 'Agent 内部错误', false)
    }
    const declared = RpcMethods[method].errors as readonly string[]
    const exact = declared.includes(cause.code) ? (cause.code as ApplicationErrorCode) : null
    const mapped = workspaceFileApplicationErrorCode(method, cause.code, declared)
    const fallback: ApplicationErrorCode =
      cause.status === 429 && declared.includes('RATE_LIMITED')
        ? 'RATE_LIMITED'
        : cause.status === 409 && declared.includes('CONFLICT')
          ? 'CONFLICT'
          : cause.status === 403 && declared.includes('PERMISSION_DENIED')
            ? 'PERMISSION_DENIED'
            : 'INTERNAL_ERROR'
    const code = exact ?? mapped ?? fallback
    const exposeMessage = exact !== null || mapped !== null || code !== 'INTERNAL_ERROR'
    return new RpcApplicationError(
      code,
      exposeMessage ? cause.message : 'Agent 内部错误',
      cause.status === 429 || cause.status >= 500,
      safeErrorDetails(code, cause.details),
    )
  }

  requireConnection(context: RpcRouterContext) {
    const connectionId = context.connectionId
    if (!connectionId || !this.connections.get(connectionId)?.initialized) {
      throw new AgentError('UNAUTHORIZED', 'RPC 连接尚未完成 initialized 握手', 401)
    }
    return connectionId
  }

  requireDesktopHost(context: RpcRouterContext) {
    const connectionId = this.requireConnection(context)
    const connection = this.connections.get(connectionId)
    if (
      process.env.PIDEX_DESKTOP_MANAGED !== '1' ||
      connection?.authority !== 'desktop-host' ||
      connection.transportAuthority !== 'desktop-host'
    ) {
      throw new AgentError('PERMISSION_DENIED', '该 RPC 方法仅允许桌面宿主调用', 403)
    }
    return connectionId
  }

  touchConnection(connectionId: string, transportAuthority?: 'desktop-host' | 'renderer') {
    const now = this.now()
    this.reapExpiredConnections(now)
    const connection = this.connections.get(connectionId)
    if (!connection) return false
    if (connection.transportAuthority !== transportAuthority) return false
    connection.lastSeenAt = now
    return true
  }

  closeConnection(connectionId: string) {
    const deleted = this.connections.delete(connectionId)
    this.subscriptions.closeConnection(connectionId)
    for (const [key, watcher] of this.workspaceFileWatchers) {
      watcher.ownerCounts.delete(connectionId)
      if (watcher.ownerCounts.size > 0) continue
      watcher.close()
      this.workspaceFileWatchers.delete(key)
    }
    return deleted
  }

  private reapExpiredConnections(now = this.now()) {
    for (const [connectionId, connection] of this.connections) {
      if (now - connection.lastSeenAt > this.connectionLeaseMs) this.closeConnection(connectionId)
    }
  }

  requiredSnapshot(threadId: string) {
    this.dependencies.db.repositories.planApprovals.recover(threadId)
    const snapshot = this.projection.snapshot(threadId)
    if (!snapshot) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
    return snapshot
  }

  threadSnapshotResult(threadId: string) {
    this.dependencies.db.repositories.planApprovals.recover(threadId)
    return this.threadReadViews.snapshot(threadId)
  }

  threadHistoryPageResult(threadId: string, params: { before?: string; limit?: number }) {
    this.dependencies.db.repositories.planApprovals.recover(threadId)
    return this.threadReadViews.history(threadId, params)
  }

  queueStateResult(threadId: string, eventID?: number) {
    return this.threadReadViews.queue(threadId, eventID)
  }

  private loadCatalogSource() {
    const { providers } = this.dependencies
    const revision = providers.catalogRevision?.() ?? 0
    if (this.catalogSource && this.catalogSourceRevision === revision) return this.catalogSource
    this.catalogSourceRevision = revision
    this.catalogSource = Promise.all([providers.list(), providers.models()])
      .then(([providerInfos, models]) => {
        const modelsByProvider = new Map<string, Model.Info[]>()
        for (const model of models) {
          const group = modelsByProvider.get(model.providerID) ?? []
          group.push(model)
          modelsByProvider.set(model.providerID, group)
        }
        return {
          providers: providerInfos,
          models,
          modelsByProvider: modelsByProvider as ReadonlyMap<string, readonly Model.Info[]>,
        }
      })
      .catch((cause) => {
        this.catalogSource = null
        throw cause
      })
    return this.catalogSource
  }

  private invalidateCatalogSource() {
    this.catalogSource = null
    this.catalogSourceRevision = -1
    this.modelPageCache.clear()
  }

  private async configuredModels() {
    const source = await this.loadCatalogSource()
    const config = this.dependencies.config.snapshot()
    const specializedModels =
      config.specialized_models &&
      typeof config.specialized_models === 'object' &&
      !Array.isArray(config.specialized_models)
        ? (config.specialized_models as Record<string, unknown>)
        : {}
    const desktop =
      config.desktop && typeof config.desktop === 'object' && !Array.isArray(config.desktop)
        ? (config.desktop as Record<string, unknown>)
        : {}
    const recent =
      desktop.recent_new_thread_model &&
      typeof desktop.recent_new_thread_model === 'object' &&
      !Array.isArray(desktop.recent_new_thread_model)
        ? (desktop.recent_new_thread_model as Record<string, unknown>)
        : {}
    const recentProviderID = typeof recent.providerID === 'string' ? recent.providerID : ''
    const legacyProviderID = typeof config.model_provider === 'string' ? config.model_provider : ''
    const recentVariant =
      typeof recent.variant === 'string' &&
      recent.variant &&
      !DESKTOP_THINKING_MODES.has(recent.variant)
        ? (recent.variant as Model.VariantID)
        : undefined
    // 兼容外壳：wire 字段仍叫 defaultModel，语义是新建任务最近选择。
    const recentSelection =
      recentProviderID && typeof recent.id === 'string' && recent.id
        ? ({
            providerID: recentProviderID,
            id: recent.id,
            ...(recentVariant ? { variant: recentVariant } : {}),
          } as Model.Ref)
        : null
    const security =
      typeof specializedModels.security === 'string' ? specializedModels.security.trim() : ''
    const separator = security.indexOf('/')
    const configuredReviewer = security
      ? ({
          providerID: separator > 0 ? security.slice(0, separator) : legacyProviderID,
          id: separator > 0 ? security.slice(separator + 1) : security,
        } as Model.Ref)
      : null
    const available = (ref: Model.Ref | null) => {
      if (!ref) return null
      const match = source.modelsByProvider
        .get(ref.providerID)
        ?.find((model) => model.id === ref.id)
      if (!match || !match.enabled) return null
      if (ref.variant && !match.variants.some((variant) => variant.id === ref.variant)) return null
      return ref
    }
    return {
      defaultModel: available(recentSelection),
      reviewerModel: available(configuredReviewer),
    }
  }

  async providerList() {
    const source = await this.loadCatalogSource()
    return {
      providers: source.providers.map((provider) => {
        const runtimeModels = source.modelsByProvider.get(provider.id) ?? []
        return {
          ...provider,
          modelCount: runtimeModels.length,
        }
      }),
      ...(await this.configuredModels()),
      catalogVersion: this.catalogVersion,
    }
  }

  private normalizedModelQuery(params: Record<string, unknown>) {
    const filters = {
      ...(typeof params.providerId === 'string' ? { providerId: params.providerId } : {}),
      ...(typeof params.query === 'string' && params.query.trim()
        ? { query: params.query.trim().toLowerCase() }
        : {}),
      ...(typeof params.enabled === 'boolean' ? { enabled: params.enabled } : {}),
      ...(typeof params.inputModality === 'string' && params.inputModality
        ? { inputModality: params.inputModality }
        : {}),
      ...(typeof params.outputModality === 'string' && params.outputModality
        ? { outputModality: params.outputModality }
        : {}),
    }
    return {
      filters,
      ...(typeof params.cursor === 'string' ? { cursor: params.cursor } : {}),
      ...(typeof params.limit === 'number'
        ? { limit: Math.max(1, Math.min(100, Math.trunc(params.limit))) }
        : {}),
    }
  }

  async modelCatalog(params: Record<string, unknown> = {}) {
    const query = this.normalizedModelQuery(params)
    const legacyFullCatalog =
      Object.keys(query.filters).length === 0 &&
      query.limit === undefined &&
      query.cursor === undefined
    if (legacyFullCatalog) return this.buildModelCatalog(query)
    const key = JSON.stringify({ version: this.catalogVersion, ...query })
    const cached = this.modelPageCache.get(key)
    if (cached) return cached
    const pending = this.buildModelCatalog(query).catch((cause) => {
      this.modelPageCache.delete(key)
      throw cause
    })
    this.modelPageCache.set(key, pending)
    return pending
  }

  private async buildModelCatalog(query: ReturnType<RpcRouter['normalizedModelQuery']>) {
    const source = await this.loadCatalogSource()
    const filterHash = createHash('sha256')
      .update(JSON.stringify(query.filters))
      .digest('base64url')
      .slice(0, 16)
    let offset = 0
    if (query.cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as {
          version?: unknown
          filter?: unknown
          offset?: unknown
        }
        if (
          decoded.version !== this.catalogVersion ||
          decoded.filter !== filterHash ||
          !Number.isInteger(decoded.offset) ||
          Number(decoded.offset) < 0
        )
          throw new Error('expired')
        offset = Number(decoded.offset)
      } catch {
        throw new AgentError('CURSOR_EXPIRED', '模型目录游标已失效，请重新查询', 409)
      }
    }

    const matches = source.models.filter((model) => {
      const { filters } = query
      if (filters.providerId !== undefined && model.providerID !== filters.providerId) return false
      if (
        filters.query !== undefined &&
        !model.id.toLowerCase().includes(filters.query) &&
        !model.name.toLowerCase().includes(filters.query)
      )
        return false
      if (filters.enabled !== undefined && model.enabled !== filters.enabled) return false
      if (
        filters.inputModality !== undefined &&
        !model.capabilities.input.includes(filters.inputModality)
      )
        return false
      if (
        filters.outputModality !== undefined &&
        !model.capabilities.output.includes(filters.outputModality)
      )
        return false
      return true
    })
    const page = query.limit === undefined ? matches : matches.slice(offset, offset + query.limit)
    const pageByProvider = new Map<string, Model.Info[]>()
    for (const model of page) {
      const group = pageByProvider.get(model.providerID) ?? []
      group.push(model)
      pageByProvider.set(model.providerID, group)
    }
    const nextOffset = offset + page.length
    const hasFilters = Object.keys(query.filters).length > 0
    return {
      providers: source.providers
        .filter(
          (provider) =>
            !hasFilters ||
            pageByProvider.has(provider.id) ||
            query.filters.providerId === provider.id,
        )
        .map((provider) => ({ provider, models: pageByProvider.get(provider.id) ?? [] })),
      ...(await this.configuredModels()),
      catalogVersion: this.catalogVersion,
      ...(query.limit === undefined ? {} : { total: matches.length }),
      ...(query.limit !== undefined && nextOffset < matches.length
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({
                version: this.catalogVersion,
                filter: filterHash,
                offset: nextOffset,
              }),
            ).toString('base64url'),
          }
        : {}),
    }
  }

  async publishCatalogUpdated(invalidateSource = true) {
    if (invalidateSource) this.invalidateCatalogSource()
    this.catalogVersion += 1
    this.modelPageCache.clear()
    const catalog = await this.modelCatalog()
    await this.emit('catalog/updated', {
      catalogVersion: catalog.catalogVersion,
    })
    return catalog
  }

  async emit(method: string, params: unknown) {
    await publishAgentEvent(this.dependencies.db, this.dependencies.hub, null, null, method, params)
  }
}

const isInitializedNotification = (input: unknown): input is Record<string, unknown> =>
  Boolean(
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    (input as Record<string, unknown>).method === 'initialized',
  )

const isRpcMethod = (input: unknown, method: string) =>
  Boolean(
    input &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    (input as Record<string, unknown>).method === method,
  )

const rpcMethodOf = (input: unknown): RpcMethod | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const method = (input as Record<string, unknown>).method
  return typeof method === 'string' && method in RpcMethods ? (method as RpcMethod) : null
}

export const resolveAiReviewSource = async (
  review: GitReviewService,
  projectId: string,
  target: ReviewAiTarget,
): Promise<ReviewSource> => {
  if (target.type === 'uncommittedChanges') {
    const [unstaged, staged] = await Promise.all([
      review.summary(projectId, { kind: 'unstaged' }),
      review.summary(projectId, { kind: 'staged' }),
    ])
    if (unstaged.totals.files > 0) return { kind: 'unstaged' }
    if (staged.totals.files > 0) return { kind: 'staged' }
    throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '当前没有可供审阅的未提交更改', 409)
  }
  const source: ReviewSource =
    target.type === 'baseBranch'
      ? { kind: 'branch', baseBranch: target.branch }
      : { kind: 'commit', commitSha: target.sha }
  const snapshot = await review.summary(projectId, source)
  if (snapshot.totals.files === 0)
    throw new AgentError('REVIEW_SOURCE_UNAVAILABLE', '所选范围没有可供审阅的更改', 409)
  return source
}

export const aiReviewModel = async (
  db: AgentDatabase,
  providers: AgentModelCatalog,
  piModels: PiModelService,
  configService: ConfigService,
  threadId: string,
  projectId: string,
): Promise<Model.Ref> => {
  const latest = db.sqlite
    .query('SELECT model_ref FROM inputs WHERE thread_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(threadId) as { model_ref: string } | null
  let latestModel: Model.Ref | null = null
  if (latest?.model_ref) {
    try {
      latestModel = modelRef(record(JSON.parse(latest.model_ref), 'model'))
    } catch {
      latestModel = null
    }
  }
  const specialized = await resolveSpecializedPiModel({
    purpose: 'coding',
    db,
    models: piModels,
    configService,
    projectId,
    ...(latestModel ? { fallbackRefs: [latestModel] } : {}),
  })
  if (specialized) return specialized.ref
  const first = (await providers.models()).find((candidate) => candidate.enabled)
  if (!first) throw new AgentError('MODEL_UNAVAILABLE', '没有可用于代码审查的模型', 409)
  return Model.Ref.make({ providerID: first.providerID, id: first.id })
}

export const aiReviewTitle = (target: ReviewAiTarget) => {
  if (target.type === 'baseBranch') return `代码审查 · ${target.branch}`
  if (target.type === 'commit')
    return `代码审查 · ${target.title?.trim() || target.sha.slice(0, 8)}`
  return '代码审查 · 未提交更改'
}

export const aiReviewPrompt = (target: ReviewAiTarget) => {
  const scope =
    target.type === 'uncommittedChanges'
      ? '审查当前仓库所有未提交更改，包括已暂存、未暂存和未跟踪文件。'
      : target.type === 'baseBranch'
        ? `审查当前工作树相对基础分支 ${target.branch} 的全部变更，先解析 merge-base。`
        : `审查提交 ${target.sha} 引入的变更。`
  return [
    '请执行一次严格、可操作的代码审查。不要修改文件。',
    '',
    'Review Guidelines:',
    '- 只报告会影响正确性、安全性、性能或可维护性的具体问题。',
    '- 每条 finding 必须说明触发条件、影响和最小修复方向，并按严重度排序。',
    '- 不要报告纯风格偏好，不要猜测无法从代码或仓库状态验证的问题。',
    '- 先检查真实 diff 和相关上下文；没有问题时明确说明未发现 actionable findings。',
    '- 每条可定位 finding 额外输出一行 directive：',
    '  ::code-comment{title="简短标题" body="问题和修复建议" file="仓库相对路径" start=行号 end=行号 priority=2}',
    '- priority 使用 0（阻断）、1（高）、2（中）、3（低）；行号必须来自变更后的文件。',
    '',
    `审查范围：${scope}`,
  ].join('\n')
}

export const stringParam = (params: Record<string, unknown>, ...names: string[]) => {
  for (const name of names) {
    const value = params[name]
    if (typeof value === 'string' && value) return value
  }
  throw new AgentError('INVALID_REQUEST', `${names[0]} 参数无效`, 400)
}

export const booleanParam = (params: Record<string, unknown>, name: string) => {
  const value = params[name]
  if (typeof value !== 'boolean') throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  return value
}

export const positiveIntegerParam = (params: Record<string, unknown>, name: string) => {
  const value = params[name]
  if (!Number.isInteger(value) || (value as number) <= 0)
    throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  return value as number
}

export const githubRepositoryIdentity = (params: Record<string, unknown>) => ({
  owner: stringParam(params, 'owner'),
  repository: stringParam(params, 'repository'),
})

export const githubPullRequestIdentity = (params: Record<string, unknown>) => ({
  ...githubRepositoryIdentity(params),
  number: positiveIntegerParam(params, 'number'),
})

export const attachmentView = (record: {
  id: string
  kind: 'text' | 'image' | 'audio' | 'video'
  name: string
  mimeType: string
  size: number
  sha256: string
  createdAt: number
}) => ({
  id: record.id,
  kind: record.kind,
  name: record.name,
  mediaType: record.mimeType,
  sizeBytes: record.size,
  sha256: record.sha256,
  createdAt: record.createdAt,
})

export const artifactMetadataView = (record: {
  id: string
  threadId: string
  turnId: string
  itemId: string
  name: string
  mimeType: string
  sizeBytes: number
  createdAt: number
}) => ({
  id: record.id,
  threadId: record.threadId,
  turnId: record.turnId,
  itemId: record.itemId,
  name: record.name,
  mimeType: record.mimeType,
  sizeBytes: record.sizeBytes,
  createdAt: record.createdAt,
})

export const modelRef = (value: Record<string, unknown>) => {
  if (typeof value.providerID !== 'string' || typeof value.id !== 'string')
    throw new AgentError('INVALID_REQUEST', '模型参数无效', 400)
  return Model.Ref.make({
    providerID: Provider.ID.make(value.providerID),
    id: Model.ID.make(value.id),
    ...(typeof value.variant === 'string' ? { variant: Model.VariantID.make(value.variant) } : {}),
  })
}

export const modelRefOrNull = (value: unknown) =>
  value == null ? null : modelRef(record(value, 'model'))

export const parseJsonRecord = (value: string) => {
  try {
    return record(JSON.parse(value))
  } catch {
    return {}
  }
}

export const encodeOffsetCursor = (offset: number) => `offset:${offset}`
export const decodeOffsetCursor = (value: unknown) => {
  if (value === undefined) return 0
  if (typeof value !== 'string' || !/^offset:\d+$/.test(value)) {
    throw new AgentError('INVALID_REQUEST', 'cursor 参数无效', 400)
  }
  return Number(value.slice('offset:'.length))
}

const safeErrorDetails = (code: ApplicationErrorCode, value: unknown): JsonValue | undefined => {
  if (code === 'REVIEW_SNAPSHOT_EXPIRED') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const details = value as Record<string, unknown>
    const safe = {
      ...(typeof details.latestGeneration === 'string'
        ? { latestGeneration: details.latestGeneration }
        : {}),
      ...(typeof details.retryable === 'boolean' ? { retryable: details.retryable } : {}),
    }
    return Object.keys(safe).length ? safe : undefined
  }
  if (code === 'REVIEW_BATCH_PARTIAL') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const details = value as Record<string, unknown>
    if (
      typeof details.appliedCount !== 'number' ||
      !Number.isInteger(details.appliedCount) ||
      typeof details.totalCount !== 'number' ||
      !Number.isInteger(details.totalCount)
    )
      return undefined
    return {
      appliedCount: details.appliedCount,
      totalCount: details.totalCount,
    }
  }
  if (code.startsWith('GIT_') || code.startsWith('REVIEW_')) return undefined
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string')
    return value.length <= 500 && !/token|authorization|secret|credential/i.test(value)
      ? value
      : undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const safe = Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (
        /token|authorization|secret|credential|environment|stack|path|stderr|stdout|command|args/i.test(
          key,
        )
      )
        return []
      if (entry === null || typeof entry === 'boolean' || typeof entry === 'number')
        return [[key, entry]]
      if (
        typeof entry === 'string' &&
        entry.length <= 500 &&
        !/token|authorization|secret|credential/i.test(entry)
      )
        return [[key, entry]]
      return []
    }),
  )
  return Object.keys(safe).length ? (safe as JsonValue) : undefined
}

export const providerFailureCategory = (
  cause: unknown,
): 'authentication' | 'configuration' | 'network' | 'rate-limit' | 'unknown' => {
  if (cause instanceof AgentError) {
    if (cause.status === 401 || cause.status === 403) return 'authentication'
    if (cause.status === 429) return 'rate-limit'
    if (cause.status >= 400 && cause.status < 500) return 'configuration'
  }
  const message = cause instanceof Error ? cause.message : String(cause)
  if (/auth|credential|api.?key|token|unauthor/i.test(message)) return 'authentication'
  if (/network|fetch|socket|timeout|dns|connect/i.test(message)) return 'network'
  if (/rate.?limit|too many requests|429/i.test(message)) return 'rate-limit'
  return 'unknown'
}
