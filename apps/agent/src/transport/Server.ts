import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { EventManifest, type EventType, type ProtocolCapability } from '@pidex/agent-protocol'
import { AllRpcMethods } from '@pidex/agent-protocol/host'
import { relative, resolve, sep } from 'node:path'
import type { AgentModelCatalog } from '../provider/AgentModelCatalog'
import type { AgentConfig } from '../config/Config'
import { AgentError, type EventEnvelope as StoredEventEnvelope } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import { globalEventSequence } from '../storage/events/EventPublisher'
import type { ThreadService } from '../session/ThreadService'
import type { ThreadHistoryService } from '../session/ThreadHistoryService'
import type { ApprovalService } from '../permission/ApprovalService'
import type { QuestionService } from '../session/QuestionService'
import { RpcRouter } from './rpc/RpcRouter'
import type { PullRequestWatchService } from '../github/PullRequestWatchService'
import type { ThreadPullRequestService } from '../github/ThreadPullRequestService'
import { proxyRendererRequest } from './RendererProxy'
import { buildEventNextNotification } from './EventEnvelope'
import type { AgentLogger } from '../observability/AgentLogger'
import type { ApiKeyService } from '../provider/ApiKeyService'
import type { ProviderCredentialService } from '../provider/ProviderCredentialService'
import type { ProviderCredentialStoreManager } from '../auth/ProviderCredentialStoreManager'
import type { PiModelService } from '../provider/pi'
import type { ModelHealthService } from '../provider/ModelHealthService'
import type { PiAuthSessionService } from '../auth/PiAuthSessionService'
import type { SubagentService } from '../subagent/SubagentService'
import type { AttachmentService } from '../subagent/AttachmentService'
import type { ArtifactService } from '../storage/ArtifactService'
import type { LocalContextPathService } from '../local-context/LocalContextPathService'
import type { ProjectSourceService } from '../project/ProjectSourceService'
import type { MemoryService } from '../memory/MemoryService'
import type { HookService } from '../hooks/HookService'
import type { GitReviewService } from '../review/GitReviewService'
import type { GithubService } from '../github/GithubService'
import type { GitWorkspaceService } from '../git/GitWorkspaceService'
import type { ToolingManager } from '../tool/ToolingManager'
import type { PetService } from '../pet/PetService'
import type { ReleaseNotesService } from '../release-notes/ReleaseNotesService'
import type { SkillManagementService } from '../prompt/SkillManagementService'
import type { PluginManagementService } from '../plugin/PluginManagementService'
import type { McpRuntimeService } from '../mcp/McpRuntimeService'
import type { TaskSuggestionService } from '../suggestion/TaskSuggestionService'
import type { ConfigService } from '../config/ConfigService'
import type { UsageService } from '../usage/UsageService'
import type { TurnPatchService } from '../patch/TurnPatchService'
import type { TerminalContextService } from '../terminal/TerminalContextService'
import type { TerminalOutputMirror } from '../terminal/TerminalOutputMirror'
import type { LocalEnvironmentService } from '../local-environment/LocalEnvironmentService'
import type { ManagedWorktreeService } from '../worktree/ManagedWorktreeService'
import type { HandoffService } from '../handoff/HandoffService'
import type { TaskExecutionBindingService } from '../worktree/TaskExecutionBindingService'
import type { WorktreeRepository } from '../worktree/WorktreeRepository'
import type { EnvironmentDeltaStore } from '../local-environment/EnvironmentDeltaStore'
import type { ThreadMessageForkService } from '../session/fork/ThreadMessageForkService'
import type { SideChatService } from '../session/side-chat/SideChatService'
import { normalizeShellSecurityLevel } from '../security/ShellRiskClassifier'
import type { SpeechTranscriptionService } from '../speech/SpeechTranscriptionService'
import type { ThreadExecutionPreparationService } from '../worktree/ThreadExecutionPreparationService'
import type { SessionGroupService } from '../session-group/SessionGroupService'
import type { ThreadGoalService } from '../session/ThreadGoalService'
import type { ThreadBookmarkService } from '../session/ThreadBookmarkService'
import type { AutomationService } from '../automation'
import type { CalendarService, SchedulePlanService, ScheduledTaskService } from '../calendar'
import type { MemoryManager } from '../resource/MemoryManager'
import type { PlanApprovalService } from '../session/plan/PlanApprovalService'

export interface TransportDependencies {
  mcpElicitations?: import('../mcp/McpElicitationService').McpElicitationService
  config: AgentConfig
  configService: ConfigService
  db: AgentDatabase
  hub: EventHub
  threads: ThreadService
  planApprovals?: PlanApprovalService
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
  prWatches?: PullRequestWatchService
  git: GitWorkspaceService
  tooling: ToolingManager
  pets: PetService
  releaseNotes: ReleaseNotesService
  skills: SkillManagementService
  plugins: PluginManagementService
  mcp: McpRuntimeService
  suggestions: TaskSuggestionService
  logger: AgentLogger
  usage: UsageService
  turnPatches: TurnPatchService
  browser?: import('../browser/BrowserService').BrowserService
  computer?: import('../computer/ComputerUseService').ComputerUseService
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
  calendar: CalendarService
  taskSchedules?: import('../calendar/TaskScheduleService').TaskScheduleService
  scheduledTasks: ScheduledTaskService
  schedulePlans: SchedulePlanService
  memoryManager?: MemoryManager | undefined
}

export const resolveEventCursor = (
  queryAfter: string | undefined,
  headerAfter: string | undefined,
  latestEventID: number,
) => {
  if (queryAfter === undefined && headerAfter === undefined) return latestEventID
  const queryCursor = Number(queryAfter ?? '0')
  const headerCursor = Number(headerAfter ?? '0')
  return Math.max(
    Number.isFinite(queryCursor) ? queryCursor : 0,
    Number.isFinite(headerCursor) ? headerCursor : 0,
  )
}

/**
 * Shared gate: returns false for unregistered events or events whose
 * negotiated capability is not held by the subscription.
 * Cursor must always advance even when delivery is denied.
 */
export const eventDeliveryAllowed = (
  event: StoredEventEnvelope,
  subscription: {
    capabilities: ReadonlySet<ProtocolCapability>
  },
): boolean => {
  if (!(event.method in EventManifest)) return false
  const definition = EventManifest[event.method as EventType]
  if (definition.capability && !subscription.capabilities.has(definition.capability)) return false
  return true
}

/**
 * Projects the single durable workflow event onto whichever shape the client can
 * decode. The superseded key is dropped outright rather than set to `undefined`,
 * so a strict `exactResult` decoder on the other side never sees an unknown field.
 */
export const projectWorkflowEvent = (
  event: StoredEventEnvelope,
  capabilities: ReadonlySet<ProtocolCapability>,
): StoredEventEnvelope => {
  if (capabilities.has('workflow.v1') && event.method === 'session-group/changed') {
    const { groupId, ...rest } = event.params as Record<string, unknown>
    return { ...event, method: 'workflow/changed', params: { ...rest, workflowId: groupId } }
  }
  if (
    !capabilities.has('workflow.v1') &&
    capabilities.has('session-group.v1') &&
    event.method === 'workflow/changed'
  ) {
    const { workflowId, ...rest } = event.params as Record<string, unknown>
    return { ...event, method: 'session-group/changed', params: { ...rest, groupId: workflowId } }
  }
  return event
}

/**
 * Live event gate: eventDeliveryAllowed + durability="live" + liveEventTypes.
 * Clients that never negotiated e.g. model.health.v1 must not receive
 * model/health/updated even when they omit liveEventTypes.
 */
export const liveEventDeliveryAllowed = (
  event: StoredEventEnvelope,
  subscription: {
    liveEventTypes: ReadonlySet<string> | null
    capabilities: ReadonlySet<ProtocolCapability>
  },
): boolean => {
  if (!(event.method in EventManifest)) return false
  const definition = EventManifest[event.method as EventType]
  if (definition.durability !== 'live') return false
  if (!eventDeliveryAllowed(event, subscription)) return false
  if (subscription.liveEventTypes && !subscription.liveEventTypes.has(event.method)) return false
  return true
}

export const deliverDurablePage = async (input: {
  events: readonly StoredEventEnvelope[]
  target: number
  subscription: { capabilities: ReadonlySet<ProtocolCapability> }
  updateCursor: (cursor: number) => void
  deliver: (event: StoredEventEnvelope) => boolean | Promise<boolean>
}) => {
  let lastCursor: number | null = null
  let delivered = 0
  for (const event of input.events) {
    if (event.id > input.target) break
    lastCursor = event.id
    input.updateCursor(event.id)
    const projected = projectWorkflowEvent(event, input.subscription.capabilities)
    if (
      !(projected.method in EventManifest) ||
      EventManifest[projected.method as EventType].durability === 'live'
    )
      continue
    if (!eventDeliveryAllowed(projected, input.subscription)) continue
    if (await input.deliver(projected)) delivered += 1
  }
  return { lastCursor, delivered }
}

export const deliverAnchoredLive = async (
  currentSequence: () => number,
  afterSequence: number,
  deliverDurableThrough: (target: number) => Promise<void>,
  deliverLive: () => Promise<void>,
) => {
  if (currentSequence() > afterSequence) return false
  await deliverDurableThrough(afterSequence)
  if (currentSequence() > afterSequence) return false
  await deliverLive()
  return true
}

const cookieValue = (header: string | null, name: string) =>
  header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
export const rpcTransportAuthority = (
  authorizationHeader: string | null,
  cookieHeader: string | null,
  authToken: string | null | undefined,
): 'desktop-host' | 'renderer' | undefined => {
  if (!authToken) return undefined
  const bearer = authorizationHeader?.replace(/^Bearer\s+/i, '')
  if (bearer === authToken) return 'desktop-host'
  return cookieValue(cookieHeader, 'pidex_session') === authToken ? 'renderer' : undefined
}
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const DESKTOP_GIT_BOARD_SETTINGS_KEY = 'desktop.git-board.v1'
const DESKTOP_RUNTIME_SETTINGS_KEY = 'desktop.runtime-state.v1'
const DESKTOP_TERMINAL_SETTINGS_KEY = 'desktop.terminal-settings.v1'
const DEPRECATED_DESKTOP_SIDEBAR_FIELDS = new Set(['sidebarSectionOrder'])
const DESKTOP_RUNTIME_FIELDS = new Set([
  'recentWorkspaces',
  'lastActiveWorkspacePath',
  'removedWorkspaces',
  'drawerTab',
  'sidebarStateVersion',
  'sidebarManualOrder',
  'sidebarSessionPins',
  'collapsedSidebarProjectPaths',
  'collapsedSidebarSections',
  'workspaceDependenciesMigrated',
])
const desktopProjection = (config: Record<string, unknown>) => {
  const desktop = isPlainObject(config.desktop)
    ? Object.fromEntries(
        Object.entries(config.desktop).filter(
          ([key]) => !DEPRECATED_DESKTOP_SIDEBAR_FIELDS.has(key),
        ),
      )
    : {}
  const specializedModels = isPlainObject(config.specialized_models)
    ? config.specialized_models
    : {}
  const features = isPlainObject(config.features) ? config.features : {}
  const sandbox = isPlainObject(config.sandbox_workspace_write)
    ? config.sandbox_workspace_write
    : {}
  const permissionConfig = isPlainObject(desktop.permissionConfig)
    ? { ...desktop.permissionConfig }
    : {}
  if (typeof config.approval_policy === 'string')
    permissionConfig.approvalPolicy = config.approval_policy
  if (typeof config.approvals_reviewer === 'string')
    permissionConfig.approvalsReviewer = config.approvals_reviewer
  if (typeof config.sandbox_mode === 'string') permissionConfig.sandboxMode = config.sandbox_mode
  return {
    ...desktop,
    ...(Object.keys(permissionConfig).length ? { permissionConfig } : {}),
    shellSecurityLevel: normalizeShellSecurityLevel(config.shell_security_level),
    ...(typeof config.model === 'string' ? { model: config.model } : {}),
    ...(typeof config.model_provider === 'string' ? { providerID: config.model_provider } : {}),
    ...(typeof config.model_reasoning_effort === 'string'
      ? { thinkingMode: config.model_reasoning_effort }
      : {}),
    ...(typeof config.personality === 'string' ? { personality: config.personality } : {}),
    ...(typeof config.system_prompt === 'string' ? { systemPrompt: config.system_prompt } : {}),
    ...(typeof config.append_system_prompt === 'string'
      ? { appendSystemPrompt: config.append_system_prompt }
      : {}),
    ...(typeof config.custom_instructions === 'string'
      ? { customInstructions: config.custom_instructions }
      : {}),
    ...(typeof specializedModels.generation === 'string'
      ? { generationModel: specializedModels.generation }
      : {}),
    ...(typeof specializedModels.organization === 'string'
      ? { organizationModel: specializedModels.organization }
      : {}),
    ...(typeof specializedModels.coding === 'string'
      ? { codingModel: specializedModels.coding }
      : {}),
    ...(typeof specializedModels.security === 'string'
      ? { securityModel: specializedModels.security }
      : {}),
    ...(typeof features.memory === 'boolean' ? { enableMemory: features.memory } : {}),
    ...(typeof features.pareto_code_router === 'boolean'
      ? { enableParetoCodeRouter: features.pareto_code_router }
      : {}),
    ...(typeof features.fusion_router === 'boolean'
      ? { enableFusionRouter: features.fusion_router }
      : {}),
    ...(typeof sandbox.network_access === 'boolean'
      ? { allowNetworkAccess: sandbox.network_access }
      : {}),
  }
}
const desktopCorePath = (key: string): string[] | null =>
  (
    ({
      model: ['model'],
      providerID: ['model_provider'],
      thinkingMode: ['model_reasoning_effort'],
      personality: ['personality'],
      systemPrompt: ['system_prompt'],
      appendSystemPrompt: ['append_system_prompt'],
      customInstructions: ['custom_instructions'],
      generationModel: ['specialized_models', 'generation'],
      organizationModel: ['specialized_models', 'organization'],
      codingModel: ['specialized_models', 'coding'],
      securityModel: ['specialized_models', 'security'],
      enableMemory: ['features', 'memory'],
      enableParetoCodeRouter: ['features', 'pareto_code_router'],
      enableFusionRouter: ['features', 'fusion_router'],
      allowNetworkAccess: ['sandbox_workspace_write', 'network_access'],
      shellSecurityLevel: ['shell_security_level'],
    }) as Record<string, string[]>
  )[key] ?? null
const desktopConfigEdits = (
  value: Record<string, unknown>,
  prefix: string[] = [],
  current: Record<string, unknown> = {},
): Array<{ keyPath: string[]; value: never }> =>
  Object.entries(value).flatMap(([key, child]) => {
    if (prefix.length === 0 && DEPRECATED_DESKTOP_SIDEBAR_FIELDS.has(key)) return []
    if (prefix.length === 0 && DESKTOP_RUNTIME_FIELDS.has(key)) return []
    if (prefix.length === 0 && (key === 'terminalProfileId' || key === 'gitBoardState')) return []
    if (prefix.length === 0 && (key === 'browserAllowedSites' || key === 'browserSitePermissions'))
      return []
    if (prefix.length === 0 && key === 'permissionConfig' && isPlainObject(child)) {
      return Object.entries(child).flatMap(([permissionKey, permissionValue]) => {
        const currentPermission = isPlainObject(current.permissionConfig)
          ? current.permissionConfig[permissionKey]
          : undefined
        if (JSON.stringify(permissionValue) === JSON.stringify(currentPermission)) return []
        const path =
          permissionKey === 'approvalPolicy'
            ? ['approval_policy']
            : permissionKey === 'approvalsReviewer'
              ? ['approvals_reviewer']
              : permissionKey === 'sandboxMode'
                ? ['sandbox_mode']
                : null
        return path ? [{ keyPath: path, value: permissionValue as never }] : []
      })
    }
    const corePath = prefix.length === 0 ? desktopCorePath(key) : null
    const path = corePath ?? ['desktop', ...prefix, key]
    return isPlainObject(child)
      ? desktopConfigEdits(child, [...prefix, key], isPlainObject(current[key]) ? current[key] : {})
      : JSON.stringify(child) === JSON.stringify(current[key])
        ? []
        : [{ keyPath: path, value: child as never }]
  })
const githubCallbackPage = (completed: boolean) =>
  new Response(
    [
      '<!doctype html>',
      '<html lang="zh-CN"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<title>${completed ? 'GitHub 登录成功' : 'GitHub 登录失败'}</title>`,
      '</head><body>',
      `<main><h1>${completed ? 'GitHub 登录成功' : 'GitHub 登录未完成'}</h1>`,
      `<p>${completed ? '你可以关闭此页面并返回 Pidex。' : '请关闭此页面并返回 Pidex 查看详情后重试。'}</p>`,
      '</main></body></html>',
    ].join(''),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
        'Content-Security-Policy':
          "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )
const mcpCallbackPage = (completed: boolean) =>
  new Response(
    [
      '<!doctype html>',
      '<html lang="zh-CN"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<title>${completed ? 'MCP 认证成功' : 'MCP 认证失败'}</title>`,
      '</head><body>',
      `<main><h1>${completed ? 'MCP 认证成功' : 'MCP 认证未完成'}</h1>`,
      `<p>${completed ? '你可以关闭此页面并返回 Pidex。' : '请关闭此页面，返回 Pidex 查看安全错误后重试。'}</p>`,
      '</main></body></html>',
    ].join(''),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        Pragma: 'no-cache',
        'Content-Security-Policy':
          "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  )

const eventNextNotification = (
  subscriptionId: string,
  streamId: string,
  event: StoredEventEnvelope,
  rpc: RpcRouter,
) =>
  buildEventNextNotification({
    subscriptionId,
    streamId,
    event,
    projection: rpc.projection,
  })

export const createApp = (dependencies: TransportDependencies) => {
  const {
    config,
    db,
    hub,
    threads,
    history,
    approvals,
    questions,
    subagents,
    attachments,
    artifacts,
    projectSources,
    providers,
    piModels,
    apiKeys,
    modelHealth,
    providerCredentials,
    providerCredentialStore,
    authSessions,
    memory,
    hooks,
    review,
    github,
    git,
    tooling,
    pets,
    releaseNotes,
    skills,
    plugins,
    suggestions,
    logger,
  } = dependencies
  const app = new Hono()
  const rpc = new RpcRouter({
    ...(dependencies.mcpElicitations ? { mcpElicitations: dependencies.mcpElicitations } : {}),
    planApprovals: dependencies.planApprovals,
    config: dependencies.configService,
    db,
    hub,
    threads,
    history,
    approvals,
    questions,
    subagents,
    attachments,
    artifacts,
    localContextPaths: dependencies.localContextPaths,
    projectSources,
    providers,
    piModels,
    apiKeys,
    modelHealth,
    providerCredentials,
    providerCredentialStore,
    authSessions,
    memory,
    hooks,
    review,
    github,
    git,
    tooling,
    pets,
    releaseNotes,
    skills,
    plugins,
    suggestions,
    usage: dependencies.usage,
    mcp: dependencies.mcp,
    turnPatches: dependencies.turnPatches,
    ...(dependencies.browser ? { browser: dependencies.browser } : {}),
    ...(dependencies.computer ? { computer: dependencies.computer } : {}),
    terminalContext: dependencies.terminalContext,
    terminalOutput: dependencies.terminalOutput,
    localEnvironment: dependencies.localEnvironment,
    worktrees: dependencies.worktrees,
    handoff: dependencies.handoff,
    threadFork: dependencies.threadFork,
    sideChats: dependencies.sideChats,
    executionBindings: dependencies.executionBindings,
    worktreeRepository: dependencies.worktreeRepository,
    environmentDeltas: dependencies.environmentDeltas,
    speech: dependencies.speech,
    threadExecutions: dependencies.threadExecutions,
    sessionGroups: dependencies.sessionGroups,
    threadGoals: dependencies.threadGoals,
    threadBookmarks: dependencies.threadBookmarks,
    threadPullRequests: dependencies.threadPullRequests,
    automation: dependencies.automation,
    ...(dependencies.prWatches ? { prWatches: dependencies.prWatches } : {}),
    calendar: dependencies.calendar,
    ...(dependencies.taskSchedules ? { taskSchedules: dependencies.taskSchedules } : {}),
    scheduledTasks: dependencies.scheduledTasks,
    schedulePlans: dependencies.schedulePlans,
    memoryManager: dependencies.memoryManager,
  })

  app.onError((cause, context) => {
    const error =
      cause instanceof AgentError
        ? cause
        : new AgentError('INTERNAL_ERROR', cause instanceof Error ? cause.message : '未知错误', 500)
    const log =
      error.status >= 500 ? logger.error.bind(logger) : (logger.warn ?? logger.error).bind(logger)
    log('http.error', {
      details: {
        method: context.req.method,
        path: context.req.path,
        code: error.code,
        status: error.status,
        message: error.message,
      },
    })
    return context.json(
      {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.status === 429 || error.status >= 500,
          details: error.details,
        },
      },
      error.status as 400,
    )
  })

  app.use('*', async (context, next) => {
    const startedAt = performance.now()
    try {
      await next()
    } finally {
      logger.request({
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        durationMs: Math.round(performance.now() - startedAt),
      })
    }
  })

  app.use('*', async (context, next) => {
    const origin = context.req.header('Origin')
    if (origin) {
      const requestURL = new URL(context.req.url)
      if (new URL(origin).host !== requestURL.host)
        throw new AgentError('ORIGIN_DENIED', '不允许外部 Origin 访问 Agent', 403)
    }
    await next()
  })

  app.get('/health', (context) =>
    context.json({ ok: true, service: 'pidex-agent', version: '0.1.0', pid: process.pid }),
  )

  app.get('/auth/github/callback', async (context) => {
    try {
      const code = context.req.query('code')
      const state = context.req.query('state')
      const error = context.req.query('error')
      const status = await github.handleOAuthCallback({
        ...(code === undefined ? {} : { code }),
        ...(state === undefined ? {} : { state }),
        ...(error === undefined ? {} : { error }),
      })
      return githubCallbackPage(status.state === 'completed')
    } catch {
      return githubCallbackPage(false)
    }
  })

  app.get('/auth/mcp/callback', async (context) => {
    try {
      const code = context.req.query('code')
      const state = context.req.query('state')
      const error = context.req.query('error')
      const completed =
        (await dependencies.mcp.oauth?.handleCallback({
          ...(code === undefined ? {} : { code }),
          ...(state === undefined ? {} : { state }),
          ...(error === undefined ? {} : { error }),
        })) ?? false
      return mcpCallbackPage(completed)
    } catch {
      return mcpCallbackPage(false)
    }
  })

  app.post('/api/desktop/api-keys/:credentialId/copy-material', async (context) => {
    const bearer = context.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!config.authToken || bearer !== config.authToken) {
      throw new AgentError('PERMISSION_DENIED', '安全复制仅允许桌面主进程调用', 403)
    }
    const credentialID = context.req.param('credentialId')
    if (!/^cred_[0-9a-f-]{36}$/i.test(credentialID)) {
      throw new AgentError('INVALID_REQUEST', 'API Key 标识无效', 400)
    }
    const key = await apiKeys.copyMaterial(credentialID)
    context.header('Cache-Control', 'no-store, max-age=0')
    context.header('Pragma', 'no-cache')
    return context.json({ key })
  })

  app.use('/api/*', async (context, next) => {
    if (!config.authToken) return next()
    const bearer = context.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
    const cookie = cookieValue(context.req.header('Cookie') ?? null, 'pidex_session')
    if (bearer !== config.authToken && cookie !== config.authToken)
      throw new AgentError('UNAUTHORIZED', 'Agent 认证失败', 401)
    return next()
  })

  app.use('/rpc*', async (context, next) => {
    if (!config.authToken) return next()
    const bearer = context.req.header('Authorization')?.replace(/^Bearer\s+/i, '')
    const cookie = cookieValue(context.req.header('Cookie') ?? null, 'pidex_session')
    if (bearer !== config.authToken && cookie !== config.authToken)
      throw new AgentError('UNAUTHORIZED', 'Agent 认证失败', 401)
    return next()
  })

  app.post('/rpc', async (context) => {
    const body = await context.req.json().catch(() => null)
    const request = body && typeof body === 'object' && !Array.isArray(body) ? body : {}
    const params =
      request.params && typeof request.params === 'object' && !Array.isArray(request.params)
        ? request.params
        : {}
    const method =
      typeof request.method === 'string' && Object.hasOwn(AllRpcMethods, request.method)
        ? request.method
        : request.method === 'initialized'
          ? 'initialized'
          : 'unknown'
    const startedAt = performance.now()
    const connectionId = context.req.header('x-pidex-connection-id')
    const transportAuthority = rpcTransportAuthority(
      context.req.header('Authorization') ?? null,
      context.req.header('Cookie') ?? null,
      config.authToken,
    )
    let result: Awaited<ReturnType<RpcRouter['handle']>> = null
    let failed = false
    try {
      result = await rpc.handle(body, {
        ...(connectionId ? { connectionId } : {}),
        ...(transportAuthority ? { transportAuthority } : {}),
      })
    } catch (cause) {
      failed = true
      throw cause
    } finally {
      const error = result && !Array.isArray(result) && 'error' in result ? result.error : undefined
      logger.rpc({
        method,
        durationMs: Math.round(performance.now() - startedAt),
        context: {
          ...(typeof params.threadId === 'string' ? { threadId: params.threadId } : {}),
          ...(typeof params.turnId === 'string' ? { turnId: params.turnId } : {}),
        },
        expectedWait:
          method === 'browser/host/next' ||
          method === 'computer/host/next' ||
          ((method === 'thread/handoff/status' || method === 'thread/fork/status') &&
            typeof params.waitMs === 'number' &&
            params.waitMs > 0),
        ...(failed
          ? { rpcCode: -32603, code: 'INTERNAL_ERROR' }
          : error
            ? {
                rpcCode: error.code,
                ...(error.data ? { code: error.data.code, retryable: error.data.retryable } : {}),
              }
            : {}),
      })
    }
    if (Array.isArray(result)) return context.json(result.filter(Boolean))
    if (!result) return new Response(null, { status: 204 })
    return context.json(result)
  })

  app.get('/rpc/events', (context) => {
    const subscriptionId = context.req.query('subscriptionId')
    const connectionId = context.req.query('connectionId')
    if (!subscriptionId || !connectionId) {
      throw new AgentError('INVALID_REQUEST', 'SSE 缺少 subscriptionId 或 connectionId', 400)
    }
    const subscription = rpc.subscriptions.get(subscriptionId, connectionId)
    if (!subscription)
      throw new AgentError('SUBSCRIPTION_NOT_FOUND', '事件订阅不存在或不属于当前连接', 404)
    const transportAuthority = rpcTransportAuthority(
      context.req.header('Authorization') ?? null,
      context.req.header('Cookie') ?? null,
      config.authToken,
    )
    if (!rpc.touchConnection(connectionId, transportAuthority))
      throw new AgentError('UNAUTHORIZED', 'RPC 连接已过期或认证来源已变化', 401)
    rpc.subscriptions.validateLastEventID(subscription, context.req.header('Last-Event-ID'))
    const cursors = new Map(subscription.acknowledged)
    return streamSSE(context, async (stream) => {
      let heartbeatAt = Date.now()
      let replayCompleted = false
      const buffered: StoredEventEnvelope[] = []
      let overflow = false
      let durableWake = false
      const appliesToAnyStream = (event: StoredEventEnvelope) =>
        [...cursors.keys()].some(
          (streamId) =>
            streamId === 'global' || event.threadId === null || event.threadId === streamId,
        )
      const unlisten = hub.listen((signal) => {
        if (signal.kind === 'durable') {
          durableWake = true
          return
        }
        const event = signal.event
        if (!appliesToAnyStream(event)) return
        if (!liveEventDeliveryAllowed(event, subscription)) return
        if (buffered.length >= 1024) {
          overflow = true
          return
        }
        buffered.push(event)
      })
      // Capture the durable high-watermarks only after live delivery is
      // subscribed so commits racing replay are buffered rather than lost.
      const replayTarget = globalEventSequence(db)
      for (const event of hub.visualizationSnapshots(replayTarget)) {
        if (appliesToAnyStream(event) && liveEventDeliveryAllowed(event, subscription))
          buffered.push(event)
      }
      const deliverDurableThrough = async (streamId: string, target: number) => {
        let cursor = cursors.get(streamId) ?? 0
        let delivered = 0
        while (cursor < target) {
          const events = db.eventsAfter(cursor, streamId === 'global' ? undefined : streamId, 500)
          const page = await deliverDurablePage({
            events,
            target,
            subscription,
            updateCursor: (nextCursor) => {
              cursor = nextCursor
              cursors.set(streamId, nextCursor)
            },
            deliver: async (event) => {
              const notification = eventNextNotification(subscriptionId, streamId, event, rpc)
              if (!notification) return false
              await stream.writeSSE({ id: String(event.id), data: JSON.stringify(notification) })
              return true
            },
          })
          const advanced = page.lastCursor !== null
          delivered += page.delivered
          if (!advanced || events.length < 500 || events.at(-1)!.id > target) {
            cursor = target
            cursors.set(streamId, cursor)
          }
        }
        return delivered
      }
      try {
        while (!stream.aborted) {
          const active = rpc.subscriptions.get(subscriptionId, connectionId)
          if (!active || overflow) {
            await stream.writeSSE({
              data: JSON.stringify({
                jsonrpc: '2.0',
                method: 'event/subscriptionClosed',
                params: {
                  subscriptionId,
                  reason: overflow ? 'overflow' : 'unsubscribed',
                  positions: [...cursors].map(([streamId, sequence]) => ({ streamId, sequence })),
                },
              }),
            })
            return
          }
          let delivered = 0
          if (!replayCompleted) {
            for (const streamId of cursors.keys())
              delivered += await deliverDurableThrough(streamId, replayTarget)
            if ([...cursors.values()].every((cursor) => cursor >= replayTarget)) {
              await stream.writeSSE({
                data: JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'event/replayComplete',
                  params: {
                    subscriptionId,
                    positions: [...cursors].map(([streamId, sequence]) => ({ streamId, sequence })),
                  },
                }),
              })
              replayCompleted = true
            }
          }
          if (replayCompleted) {
            const pending = buffered.splice(0, buffered.length)
            for (const event of pending) {
              for (const streamId of cursors.keys()) {
                if (streamId !== 'global' && event.threadId !== null && event.threadId !== streamId)
                  continue
                if (!liveEventDeliveryAllowed(event, active)) continue
                const anchor = event.afterSequence
                if (anchor === undefined) continue
                let durableDelivered = 0
                const liveDelivered = await deliverAnchoredLive(
                  () => cursors.get(streamId) ?? 0,
                  anchor,
                  async (target) => {
                    durableDelivered += await deliverDurableThrough(streamId, target)
                  },
                  async () => {
                    const notification = eventNextNotification(subscriptionId, streamId, event, rpc)
                    if (notification) await stream.writeSSE({ data: JSON.stringify(notification) })
                  },
                )
                delivered += durableDelivered + (liveDelivered ? 1 : 0)
              }
            }
            // Durable rows remain the source of truth. A durable EventHub
            // signal is only a wake-up; polling also covers a missed wake.
            const durableTarget = globalEventSequence(db)
            if (durableWake || [...cursors.values()].some((cursor) => cursor < durableTarget)) {
              durableWake = false
              for (const streamId of cursors.keys())
                delivered += await deliverDurableThrough(streamId, durableTarget)
            }
          }
          if (Date.now() - heartbeatAt >= 10_000) {
            await stream.writeSSE({
              event: 'heartbeat',
              data: JSON.stringify({
                jsonrpc: '2.0',
                method: 'heartbeat',
                params: {
                  at: Date.now(),
                  positions: [...cursors].map(([streamId, sequence]) => ({ streamId, sequence })),
                },
              }),
            })
            heartbeatAt = Date.now()
            if (!rpc.touchConnection(connectionId, transportAuthority)) return
          }
          await stream.sleep(delivered ? 10 : 100)
        }
      } finally {
        unlisten()
      }
    })
  })

  app.get('/api/ready', (context) => {
    db.sqlite.query('SELECT 1').get()
    const instanceToken =
      process.env.PIDEX_DESKTOP_MANAGED === '1'
        ? process.env.PIDEX_SIDECAR_INSTANCE_TOKEN
        : undefined
    return context.json({
      ok: true,
      service: 'pidex-agent',
      version: '0.1.0',
      pid: process.pid,
      readyAt: Date.now(),
      ...(instanceToken ? { instanceToken } : {}),
    })
  })

  app.get('/api/config/desktop-projection', async (context) => {
    const result = await dependencies.configService.read()
    const runtime = db.getSetting<Record<string, unknown>>(DESKTOP_RUNTIME_SETTINGS_KEY) ?? {}
    const currentRuntime = Object.fromEntries(
      Object.entries(runtime).filter(([key]) => DESKTOP_RUNTIME_FIELDS.has(key)),
    )
    const terminalSettings =
      db.getSetting<Record<string, unknown>>(DESKTOP_TERMINAL_SETTINGS_KEY) ?? {}
    const terminalProfileId = terminalSettings.terminalProfileId
    return context.json({
      ...desktopProjection(result.config),
      ...currentRuntime,
      gitBoardState: db.getSetting<string>(DESKTOP_GIT_BOARD_SETTINGS_KEY) ?? null,
      ...(terminalProfileId === null || typeof terminalProfileId === 'string'
        ? { terminalProfileId }
        : {}),
    })
  })

  app.put('/api/config/desktop-projection', async (context) => {
    const settings = await context.req.json().catch(() => null)
    if (!isPlainObject(settings)) throw new AgentError('INVALID_REQUEST', '桌面设置参数无效', 400)
    if (
      settings.gitBoardState !== undefined &&
      settings.gitBoardState !== null &&
      typeof settings.gitBoardState !== 'string'
    ) {
      throw new AgentError('INVALID_REQUEST', 'Git 看板设置无效', 400)
    }
    const hasTerminalProfileId = Object.prototype.hasOwnProperty.call(settings, 'terminalProfileId')
    const terminalProfileId = settings.terminalProfileId
    if (
      hasTerminalProfileId &&
      terminalProfileId !== null &&
      typeof terminalProfileId !== 'string'
    ) {
      throw new AgentError('INVALID_REQUEST', '终端 profile 设置无效', 400)
    }
    const read = await dependencies.configService.read({ includeLayers: true })
    const currentRuntime =
      db.getSetting<Record<string, unknown>>(DESKTOP_RUNTIME_SETTINGS_KEY) ?? {}
    const currentSettings = {
      ...desktopProjection(read.config),
      ...Object.fromEntries(
        Object.entries(currentRuntime).filter(([key]) => DESKTOP_RUNTIME_FIELDS.has(key)),
      ),
    }
    db.setSetting(
      DESKTOP_RUNTIME_SETTINGS_KEY,
      Object.fromEntries(
        Object.entries(settings).filter(([key]) => DESKTOP_RUNTIME_FIELDS.has(key)),
      ),
    )
    if (typeof settings.gitBoardState === 'string') {
      db.setSetting(DESKTOP_GIT_BOARD_SETTINGS_KEY, settings.gitBoardState)
    }
    if (hasTerminalProfileId) {
      const current = db.getSetting<Record<string, unknown>>(DESKTOP_TERMINAL_SETTINGS_KEY) ?? {}
      db.setSetting(DESKTOP_TERMINAL_SETTINGS_KEY, { ...current, terminalProfileId })
    }
    const version = read.layers?.find((layer) => layer.kind === 'user')?.version
    const edits = desktopConfigEdits(settings, [], currentSettings)
    if (edits.length === 0) return context.json(settings)
    await dependencies.configService.batchWrite({
      edits,
      ...(version ? { expectedVersion: version } : {}),
    })
    return context.json(settings)
  })

  app.get('/api/pets/:id/spritesheet', async (context) => {
    const asset = await pets.spritesheet(context.req.param('id'))
    const body = asset.bytes.buffer.slice(
      asset.bytes.byteOffset,
      asset.bytes.byteOffset + asset.bytes.byteLength,
    ) as ArrayBuffer
    return new Response(body, {
      headers: {
        'Content-Type': asset.contentType,
        'Cache-Control': 'private, max-age=0, must-revalidate',
        ETag: asset.etag,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })

  app.get('/api/pets/catalog/:slug/preview', async (context) => {
    const asset = await pets.previewAsset(context.req.param('slug'))
    const body = asset.bytes.buffer.slice(
      asset.bytes.byteOffset,
      asset.bytes.byteOffset + asset.bytes.byteLength,
    ) as ArrayBuffer
    return new Response(body, {
      headers: {
        'Content-Type': asset.contentType,
        'Cache-Control': 'private, max-age=14400',
        ETag: asset.etag,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  })

  app.post('/api/shutdown', (context) => {
    if (process.env.PIDEX_DESKTOP_MANAGED !== '1')
      throw new AgentError('SHUTDOWN_DENIED', '仅桌面托管的 Agent 可以通过 HTTP 关闭', 403)
    setTimeout(() => process.emit('SIGTERM'), 25)
    return context.json({ ok: true })
  })
  app.all('*', async (context) => {
    if (config.rendererDevURL) {
      return proxyRendererRequest(context.req.raw, config.rendererDevURL)
    }
    if (config.rendererDir) {
      const requested =
        context.req.path === '/' ? 'index.html' : context.req.path.replace(/^\/+/, '')
      const path = resolve(config.rendererDir, requested)
      if (relative(config.rendererDir, path).startsWith(`..${sep}`))
        throw new AgentError('PATH_DENIED', '静态资源路径无效', 403)
      const file = Bun.file(path)
      if (await file.exists()) return new Response(file)
      const index = Bun.file(resolve(config.rendererDir, 'index.html'))
      if (await index.exists())
        return new Response(index, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    }
    return context.json({ error: { code: 'NOT_FOUND', message: '资源不存在' } }, 404)
  })

  return app
}
