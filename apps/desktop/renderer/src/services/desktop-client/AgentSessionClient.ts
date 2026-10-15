import { resolveTaskExecution } from '../../features/session/TaskExecutionMode.js'
import { reconcileQuestionDrafts } from '../../features/session/approvals/AskUserQuestionModel.js'
import {
  DESKTOP_AGENT_EVENT_CHANNEL,
  DESKTOP_API_METHODS,
  DESKTOP_SETTINGS_CHANGE_CHANNEL,
  DESKTOP_SESSION_STORE_CHANGE_CHANNEL,
  DESKTOP_UI_COMMAND_CHANNEL,
  DESKTOP_WORKFLOW_EVENT_CHANNEL,
  type DesktopApiMethod,
} from '../../../shared/IpcChannels.js'
import { encodeDesktopBridgeArgs } from '../../../shared/DesktopBridgeArgs.js'
import { arePathsEqual } from '../../utils/PathUtils.js'
import { toUserErrorMessage } from '../../utils/Errors.js'
import {
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
} from '../../../shared/SettingsSchema.js'
import {
  collaborationModeFromPlanModeActive,
  planModeActiveFromCollaborationMode,
  resolveCollaborationMode,
} from '../../shims/core/agent/SessionContract.js'
import type { CatalogProvider, ModelRef, Project } from '@pidex/shared'
import { ModelRefSchema } from '@pidex/shared'
import type {
  PermissionConfig,
  SubagentProjection,
  ThreadListItem,
  ThreadSettings,
  ThreadSettingsPatch,
} from '@pidex/shared/thread'
import type {
  EventEnvelope,
  LiveEventType,
  ProtocolCapability,
  RpcParams,
  RpcResult,
} from '@pidex/agent-protocol'
import {
  hasNonTerminalSessionStatus,
  withSessionStatusOverride,
  type SessionStatusOverride,
} from './SessionStatusOverrides.js'
import {
  DEFAULT_DESKTOP_THEME_SETTINGS,
  isNewerDesktopThemeSettingsVersion,
  normalizeDesktopThemeSettings,
} from '../../../shared/Theme.js'
import { desktopUserMessageInputToPreviewText } from '../../../shared/DesktopUserMessage.js'
import { resolvePreferredOpenTarget } from './OpenTargetSelection.js'
import type {
  CreateDesktopSessionOptions,
  CreateDesktopSessionResult,
  DesktopWorktreeEligibility,
  DesktopApi,
  DesktopMessageDelivery,
  DesktopFileEntry,
  DesktopFilePreview,
  DesktopFileRevision,
  DesktopFileSaveResult,
  DesktopModelSelection,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopProviderCredential,
  DesktopModelMetadata,
  DesktopPermissionDecision,
  DesktopPermissionMode,
  DesktopReviewDiffResult,
  DesktopReviewSource,
  DesktopSessionEvent,
  DesktopSessionCatalogStatus,
  DesktopSessionMetadataPatch,
  DesktopRuntimeStatus,
  GenerateDesktopTaskSuggestionsInput,
  DesktopProjectSource,
  DesktopProjectSourceReadResult,
  DesktopSettingsChange,
  DesktopSessionStoreChange,
  DesktopSessionSnapshot,
  DesktopStoredSettings,
  DesktopThemeSettings,
  DesktopSubagentRead,
  DesktopUserMessageInput,
  DesktopWorkspace,
  ModelProviderID,
} from '../../../shared/Types.js'
import {
  agentQuestionIdFromRequestId,
  agentThreadListItemToDesktopSnapshot,
  agentThreadSnapshotToDesktop,
  agentTurnStatusToDesktopStatus,
  desktopPermissionModeToPermissionConfig,
  projectToDesktopWorkspace,
} from '../AgentThreadAdapter.js'
import {
  AgentRpcError,
  createAgentRpcClient,
  type AgentRpcSubscription,
} from '../AgentRpcClient.js'
import { createAgentTurnQueueClient } from './AgentTurnQueueClient.js'
import { questionInteractionResponse } from './QuestionInteractionResponse.js'
import { AGENT_LIVE_EVENT_FILTERS } from './EventSubscriptionFilters.js'
import { SessionCatalogCoordinator } from './SessionCatalogCoordinator.js'
import type { SessionLifecycleUpdate } from './SessionCatalogCoordinator.js'

export const WORKSPACE_FILE_CHANGED_EVENT = 'pidex-workspace-file-changed'
export const WORKSPACE_GIT_CHANGED_EVENT = 'pidex-workspace-git-changed'
export const CONFIG_UPDATED_EVENT = 'pidex-config-updated'

const RENDERER_PROTOCOL = 'thread-rpc-v4' as const

/**
 * Cadence of the in-flight session status reconcile. It runs only while at least
 * one session still reports queued, waiting or running work.
 */
const SESSION_STATUS_RECONCILE_INTERVAL_MS = 30_000
export const RENDERER_CAPABILITIES = [
  'visualizations.v1',
  'artifacts.read.v1',
  'rpc.typed.v1',
  'events.replay.v1',
  'thread.message-phase.v1',
  'events.live.v1',
  'interactions.serverRequests.v1',
  'interaction.recovery.v1',
  'interaction.questionSkip.v1',
  'interaction.scopedGrants.v1',
  'interaction.questionPause.v1',
  'mcp.elicitation.v1',
  'approval.retry.v1',
  'turn.admission.v1',
  'skills.invocation.v1',
  'plan.approval.v1',
  'plan.structured.v1',
  'turn.steer.v1',
  'turn.queue.management.v1',
  'attachments.v1',
  'local-context.paths.v1',
  'memory.v2',
  'pets.management.v1',
  'workspace.editor.v1',
  'thread.creation-surface.v1',
  'git.review.v1',
  'git.review.batch.v1',
  'git.review.context.v1',
  'git.review.uncommitted.v1',
  'git.workspace.v1',
  'ai.review.v1',
  'github.oauth.v1',
  'github.pullRequests.v1',
  'github.threadPullRequests.v1',
  'context.compact.v1',
  'hooks.trust.v1',
  'subagents.v1',
  'subagents.recursive.v1',
  'subagents.followup.v1',
  'sandbox.management.v1',
  'prompt.preview.sensitive.v1',
  'model.catalog.paged.v1',
  'model.health.v1',
  'provider.config.pi.v1',
  'provider.builtinOverrides.v1',
  'provider.auth.pi.v1',
  'tooling.management.v1',
  'skills.manage.v1',
  'plugins.manage.v1',
  'plugins.details.v1',
  'integrations.minimax-cli.v1',
  'mcp.manage.v1',
  'mcp.oauth.v1',
  'config.manage.v1',
  'config.profiles.v1',
  'task-suggestions.v1',
  'release-notes.read.v1',
  'thread.side-chat.v1',
  'speech.transcription.v1',
  'automation.manage.v1',
  'calendar.manage.v1',
  'schedule.draft.v1',
  'session-group.v1' as ProtocolCapability,
  'workflow.v1',
  'computer.use.v1' as ProtocolCapability,
  'computer.policy.v1' as ProtocolCapability,
] as const satisfies ReadonlyArray<ProtocolCapability>
const CAPABILITY_ALIASES = {
  prompt: 'prompt.preview.sensitive.v1',
  memory: 'memory.v2',
  compact: 'context.compact.v1',
  hookTrust: 'hooks.trust.v1',
} as const satisfies Record<string, ProtocolCapability>
type AgentCapabilityName = keyof typeof CAPABILITY_ALIASES | ProtocolCapability
const CURRENT_APP_VERSION = typeof __PIDEX_VERSION__ === 'string' ? __PIDEX_VERSION__ : '0.0.0-dev'
type PendingInteraction = RpcResult<'interaction/listPending'>['interactions'][number]

import {
  bridgeWindowMaximized,
  mockAuthStatus,
  mockRuntimeStatus,
  permissionModeFromDesktopConfig,
} from './FixtureRuntime.js'
import { catalogProviderToDesktop } from './ProviderAdapters.js'
import type {
  DesktopClient,
  DesktopCalendarApi,
  DesktopAttachmentApi,
  DesktopClientEnvironment,
  DesktopComputerApi,
  DesktopLocalContextApi,
  DesktopModelProviderRefreshApi,
  DesktopMiniMaxCliApi,
  DesktopPluginApi,
  DesktopRuntimeCapabilityApi,
  DesktopSpeechApi,
  DesktopThreadBookmarkList,
} from './Types.js'

// Start the two small message-input chunks while the desktop client initializes,
// so the first send does not initiate new module requests and the entry bundle
// does not need to retain their implementation.
const attachmentUploadSupport = import('./AttachmentUploadSupport.js')
const localContextImportSupport = import('./LocalContextImportSupport.js')
export const THREAD_LIST_PAGE_SIZE = 100

/** 防御上限：异常的分页响应不会让侧栏无限翻页。 */
export const THREAD_LIST_MAX_PAGES = 200

/**
 * 消费 thread/list 的 nextCursor，直到取完全部会话；
 * 侧栏因此不再只显示首批 100 项。
 */
export async function collectAllThreadPages(
  fetchPage: (cursor: string | undefined) => Promise<{
    threads: readonly ThreadListItem[]
    nextCursor?: string | null
  }>,
): Promise<ThreadListItem[]> {
  const threads: ThreadListItem[] = []
  const seenThreadIds = new Set<string>()
  const fetchedCursors = new Set<string | undefined>()
  let cursor: string | undefined
  for (let page = 0; page < THREAD_LIST_MAX_PAGES; page += 1) {
    // 同一游标只请求一次：服务端重放同一页时不会重复请求，也不会无限翻页。
    if (fetchedCursors.has(cursor)) break
    fetchedCursors.add(cursor)
    const response = await fetchPage(cursor)
    for (const thread of response.threads) {
      if (seenThreadIds.has(thread.id)) continue
      seenThreadIds.add(thread.id)
      threads.push(thread)
    }
    cursor = response.nextCursor ?? undefined
    if (cursor === undefined) break
  }
  return threads
}

export function createAgentSessionDesktopClient(
  environment: DesktopClientEnvironment,
  mockClient: DesktopApi &
    DesktopRuntimeCapabilityApi &
    DesktopAttachmentApi &
    DesktopLocalContextApi &
    DesktopSpeechApi &
    DesktopModelProviderRefreshApi &
    DesktopPluginApi &
    DesktopMiniMaxCliApi &
    DesktopComputerApi &
    DesktopCalendarApi,
  allowBrowserMockFallback: boolean,
): DesktopClient {
  const fetcher = environment.fetch
  const browserUnavailable = async (): Promise<never> => {
    throw new Error('内置浏览器仅在 Pidex 桌面应用中可用。')
  }
  const clientInstanceId = crypto.randomUUID()
  const rpc = createAgentRpcClient({
    ...environment,
    handshake: {
      initialize: {
        clientInfo: {
          name: 'pidex-desktop-renderer',
          version: '0.2.0',
          platform: typeof navigator === 'undefined' ? 'desktop' : navigator.platform,
          instanceId: clientInstanceId,
        },
        protocols: [RENDERER_PROTOCOL],
        capabilities: [...RENDERER_CAPABILITIES],
        interactionDelivery: 'active',
      },
      initialized: {
        protocol: RENDERER_PROTOCOL,
        clientInstanceId,
      },
    },
  })
  let activeSessionId: string | null = null
  let agentReady = false
  let agentCapabilities = new Set<string>()
  let readyProbe: Promise<boolean> | null = null
  let readinessError: unknown = null
  let projectsByIdCache: Map<string, Project> | null = null
  let modelCatalogCache: RpcResult<'model/list'> | null = null
  let providerCatalogCache: RpcResult<'provider/list'> | null = null
  let providerCatalogRequest: Promise<RpcResult<'provider/list'>> | null = null
  const providerModelCache = new Map<string, CatalogProvider['models']>()
  const providerModelRequests = new Map<string, Promise<RpcResult<'model/list'>>>()
  let providerCredentialsCache: DesktopProviderCredential[] | null = null
  const sessionSnapshots = new Map<string, DesktopSessionSnapshot>()
  const lifecycleEpochBySessionId = new Map<string, number>()
  const latestLifecycleBySessionId = new Map<string, SessionLifecycleUpdate>()
  // Canonical projection status per thread. It outranks the catalog snapshot for
  // the threads that projection currently covers, and is applied in
  // `emitSessionStoreChange` so every session store consumer sees one status.
  const canonicalStatusOverrides = new Map<string, SessionStatusOverride>()
  let sessionStatusReconcileTimer: ReturnType<typeof setInterval> | null = null
  const sessionPermissionConfigs = new Map<string, PermissionConfig>()
  let pendingInteractionThreadIds = new Set<string>()
  const sessionStoreListeners = new Set<(change: DesktopSessionStoreChange) => void>()
  const sharedGlobalEventListeners = new Set<{
    liveEventTypes: ReadonlySet<LiveEventType>
    callback: (events: readonly EventEnvelope[]) => void | Promise<void>
    onSubscriptionError?: (error: unknown) => void | Promise<void>
  }>()
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const confirmedReadThroughBySessionId = new Map<string, number>()
  const pendingReadThroughBySessionId = new Map<string, Map<string, number>>()
  const pendingSettingsUpdates = new Map<string, Promise<void>>()
  const approvalRetryOperations = new Map<string, string>()
  const pendingDesktopSettingsSaves = new Map<string, Promise<DesktopStoredSettings>>()
  let desktopSettingsSaveTail: Promise<void> = Promise.resolve()
  let sessionStoreReconcile: Promise<void> | null = null
  let backgroundReconcileFailed = false
  const reconciliationErrorListeners = new Set<(error: unknown) => void>()

  function notifyReconciliationError(error: unknown): void {
    if (backgroundReconcileFailed) return
    backgroundReconcileFailed = true
    for (const listener of reconciliationErrorListeners) {
      try {
        listener(error)
      } catch (err) {
        console.error('对账错误监听器执行失败：', err)
      }
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('desktop:error', {
          detail: toUserErrorMessage(error, 'thread-read'),
        }),
      )
    }
  }

  function notifyReconciliationSuccess(): void {
    backgroundReconcileFailed = false
  }
  let speechInstallProbeStarted = false
  let speechApiPromise: Promise<
    ReturnType<(typeof import('./AgentSpeechApi.js'))['createAgentSpeechApi']>
  > | null = null

  function loadSpeechApi() {
    speechApiPromise ??= import('./AgentSpeechApi.js').then((module) =>
      module.createAgentSpeechApi(rpc, () => agentCapabilities.has('speech.transcription.v1')),
    )
    return speechApiPromise
  }

  async function isAgentAvailable(): Promise<boolean> {
    if (agentReady) return true
    readyProbe ??= probeAgentReady().finally(() => {
      readyProbe = null
    })
    agentReady = await readyProbe
    return agentReady
  }

  async function probeAgentReady(): Promise<boolean> {
    if (!fetcher) {
      readinessError = new Error('当前环境无法访问 agent RPC。')
      return false
    }
    try {
      const initialized = await rpc.ensureInitialized()
      agentCapabilities = new Set(initialized.capabilities)
      if (agentCapabilities.has('speech.transcription.v1') && !speechInstallProbeStarted) {
        speechInstallProbeStarted = true
        void installSpeechInBackground()
      }
      readinessError = null
      return true
    } catch (error) {
      readinessError = error
      return false
    }
  }

  async function installSpeechInBackground(): Promise<void> {
    try {
      const speechApi = await loadSpeechApi()
      const status = await speechApi.getSpeechStatus()
      if (status.state === 'not-installed') {
        await speechApi.installSpeech()
      }
    } catch {
      // Installation remains observable and retryable from General Settings.
    }
  }

  async function withAgentOrMock<T>(
    agentOperation: () => Promise<T>,
    mockOperation: () => Promise<T>,
  ): Promise<T> {
    if (!(await isAgentAvailable())) {
      if (allowBrowserMockFallback) return mockOperation()
      throw readinessError instanceof Error ? readinessError : new Error('Agent RPC 当前不可用。')
    }
    return agentOperation()
  }

  async function withRequiredAgent<T>(operation: () => Promise<T>): Promise<T> {
    if (!(await isAgentAvailable())) {
      throw readinessError instanceof Error ? readinessError : new Error('Agent RPC 当前不可用。')
    }
    return operation()
  }

  /**
   * Goal mutations are optimistic-concurrency guarded. On conflict we refresh the
   * canonical snapshot and surface a retryable message instead of overwriting the
   * newer version the other writer produced.
   */
  async function runGoalMutation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      if (error instanceof AgentRpcError && error.errorCode === 'CONFLICT') {
        await refreshAgentSessionStoreChange().catch(() => emitSessionStoreChange())
        const conflict = new Error('目标已被其他操作更新，已刷新为最新状态，请重试。') as Error & {
          code: string
        }
        conflict.code = 'GOAL_VERSION_CONFLICT'
        throw conflict
      }
      throw error
    }
  }

  function unsupportedAgentOperation(operation: string): never {
    const error = new Error(
      `AGENT_OPERATION_UNSUPPORTED: 真实 Agent 会话暂不支持 ${operation}。`,
    ) as Error & { code: string }
    error.code = 'AGENT_OPERATION_UNSUPPORTED'
    throw error
  }

  function requireAgentCapability(name: AgentCapabilityName, version = 1): void {
    const capability =
      name in CAPABILITY_ALIASES
        ? CAPABILITY_ALIASES[name as keyof typeof CAPABILITY_ALIASES]
        : (name as ProtocolCapability)
    if (version <= 1 && agentCapabilities.has(capability)) return
    if (version === 2 && (name === 'prompt' || name === 'memory')) {
      if (agentCapabilities.has(capability)) return
    }
    const versionLabel = name.endsWith(`.v${version}`) ? name : `${name} v${version}`
    unsupportedAgentOperation(versionLabel)
  }

  function withUnsupportedAgentFallback<T>(
    operation: string,
    mockOperation: () => Promise<T>,
  ): Promise<T> {
    return withAgentOrMock(async () => unsupportedAgentOperation(operation), mockOperation)
  }

  function queueSettingsUpdate<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = pendingSettingsUpdates.get(sessionId) ?? Promise.resolve()
    const result = previous.catch(() => undefined).then(operation)
    const pending = result.then(() => undefined)
    pendingSettingsUpdates.set(sessionId, pending)
    void pending.then(
      () => {
        if (pendingSettingsUpdates.get(sessionId) === pending) {
          pendingSettingsUpdates.delete(sessionId)
        }
      },
      () => {
        if (pendingSettingsUpdates.get(sessionId) === pending) {
          pendingSettingsUpdates.delete(sessionId)
        }
      },
    )
    return result
  }

  async function awaitPendingSettingsUpdate(sessionId: string): Promise<void> {
    await pendingSettingsUpdates.get(sessionId)
  }

  function queueDesktopSettingsSave(
    settings: DesktopStoredSettings,
  ): Promise<DesktopStoredSettings> {
    const normalized = normalizeDesktopStoredSettings(settings)
    const fingerprint = JSON.stringify(normalized)
    const pending = pendingDesktopSettingsSaves.get(fingerprint)
    if (pending) return pending

    const operation = desktopSettingsSaveTail
      .catch(() => undefined)
      .then(async () => {
        const saver = environment.window?.DesktopBridge?.saveDesktopSettings
        if (!saver) return mockClient.saveDesktopSettings(normalized)
        const saved = normalizeDesktopStoredSettings(await saver(normalized))
        await mockClient.saveDesktopSettings(saved)
        return saved
      })
    desktopSettingsSaveTail = operation.then(
      () => undefined,
      () => undefined,
    )
    pendingDesktopSettingsSaves.set(fingerprint, operation)
    const clearPending = () => {
      if (pendingDesktopSettingsSaves.get(fingerprint) === operation) {
        pendingDesktopSettingsSaves.delete(fingerprint)
      }
    }
    void operation.then(clearPending, clearPending)
    return operation
  }

  function invalidateModelCatalog(): void {
    modelCatalogCache = null
    providerCatalogCache = null
    providerCatalogRequest = null
    providerModelCache.clear()
    providerModelRequests.clear()
  }

  function notifyModelProviderChanged(): void {
    environment.window?.dispatchEvent?.(new Event('desktop:model-provider-changed'))
  }

  async function loadModelCatalog(refresh = false): Promise<RpcResult<'model/list'>> {
    if (modelCatalogCache && !refresh) return modelCatalogCache
    const result = refresh
      ? await rpc.call('model/refresh', {
          operationId: crypto.randomUUID(),
        })
      : await rpc.call('model/list', {})
    modelCatalogCache = {
      providers: [...result.providers],
      defaultModel: result.defaultModel,
      reviewerModel: result.reviewerModel,
      catalogVersion: result.catalogVersion,
    }
    return modelCatalogCache
  }

  async function loadProviderCatalog(refresh = false): Promise<RpcResult<'provider/list'>> {
    await isAgentAvailable()
    if (providerCatalogCache && !refresh) return providerCatalogCache
    if (providerCatalogRequest && !refresh) return providerCatalogRequest
    const pending = rpc
      .call('provider/list', {})
      .then((result) => {
        providerCatalogCache = result
        return result
      })
      .finally(() => {
        if (providerCatalogRequest === pending) providerCatalogRequest = null
      })
    providerCatalogRequest = pending
    return pending
  }

  async function loadProviderModelPage(options: {
    providerID: ModelProviderID
    query?: string
    cursor?: string
    limit?: number
    retryCatalogChange?: boolean
  }): Promise<RpcResult<'model/list'>> {
    if (!agentCapabilities.has('model.catalog.paged.v1')) {
      const legacy = await loadModelCatalog()
      const provider = legacy.providers.find((item) => item.provider.id === options.providerID)
      if (!provider) throw new Error(`未找到模型提供商：${options.providerID}`)
      providerModelCache.set(provider.provider.id, [...provider.models])
      return {
        ...legacy,
        providers: [provider],
        total: provider.models.length,
      }
    }

    const directory = await loadProviderCatalog()
    const providerID = directory.providers.find(
      (provider) => provider.id === options.providerID,
    )?.id
    if (!providerID) throw new Error(`未找到模型提供商：${options.providerID}`)
    const requestKey = JSON.stringify({
      version: directory.catalogVersion,
      providerID,
      query: options.query?.trim().toLowerCase() ?? '',
      cursor: options.cursor ?? '',
      limit: options.limit ?? 100,
    })
    let pending = providerModelRequests.get(requestKey)
    if (!pending) {
      pending = rpc
        .call('model/list', {
          providerId: providerID,
          enabled: true,
          limit: Math.max(1, Math.min(100, options.limit ?? 100)),
          ...(options.query?.trim() ? { query: options.query.trim() } : {}),
          ...(options.cursor ? { cursor: options.cursor } : {}),
        })
        .catch((error) => {
          providerModelRequests.delete(requestKey)
          throw error
        })
      providerModelRequests.set(requestKey, pending)
    }
    const result = await pending
    if (result.catalogVersion !== directory.catalogVersion) {
      invalidateModelCatalog()
      if (options.cursor || options.retryCatalogChange === false) {
        throw new Error('模型目录已更新，请重新查询。')
      }
      return loadProviderModelPage({ ...options, retryCatalogChange: false })
    }
    const page =
      result.providers.find((item) => item.provider.id === options.providerID)?.models ?? []
    const previous = providerModelCache.get(options.providerID) ?? []
    const merged = new Map(previous.map((model) => [model.id, model]))
    for (const model of page) merged.set(model.id, model)
    providerModelCache.set(options.providerID, [...merged.values()])
    return result
  }

  async function loadAllProviderModels(
    providerID: ModelProviderID,
  ): Promise<RpcResult<'model/list'>> {
    const hadPrevious = providerModelCache.has(providerID)
    const previous = providerModelCache.get(providerID)

    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const models = new Map<
          string,
          RpcResult<'model/list'>['providers'][number]['models'][number]
        >()
        const seenCursors = new Set<string>()
        let cursor: string | undefined
        let latest: RpcResult<'model/list'> | undefined
        try {
          do {
            latest = await loadProviderModelPage({
              providerID,
              cursor,
              limit: 100,
              retryCatalogChange: false,
            })
            const provider = latest.providers.find((item) => item.provider.id === providerID)
            if (!provider) throw new Error(`未找到模型提供商：${providerID}`)
            for (const model of provider.models) models.set(model.id, model)
            cursor = latest.nextCursor
            if (cursor && seenCursors.has(cursor)) {
              throw new Error('模型目录分页游标重复，已停止加载。')
            }
            if (cursor) seenCursors.add(cursor)
          } while (cursor)

          const provider = latest?.providers.find((item) => item.provider.id === providerID)
          if (!latest || !provider) throw new Error(`未找到模型提供商：${providerID}`)
          const completeModels = [...models.values()]
          providerModelCache.set(providerID, completeModels)
          const { nextCursor: _nextCursor, ...completeResult } = latest
          return {
            ...completeResult,
            providers: [{ ...provider, models: completeModels }],
            total: completeModels.length,
          }
        } catch (error) {
          if (
            attempt === 0 &&
            error instanceof Error &&
            error.message === '模型目录已更新，请重新查询。'
          ) {
            continue
          }
          throw error
        }
      }
      throw new Error('模型目录加载失败。')
    } catch (error) {
      if (hadPrevious && previous) providerModelCache.set(providerID, previous)
      else providerModelCache.delete(providerID)
      throw error
    }
  }

  async function loadProviderCredentials(refresh = false): Promise<DesktopProviderCredential[]> {
    if (providerCredentialsCache && !refresh) return providerCredentialsCache
    const response = await rpc.call('provider/credential/list', {})
    providerCredentialsCache = [...response.credentials]
    return providerCredentialsCache
  }

  async function providerState(
    preferredProviderID?: ModelProviderID,
  ): Promise<DesktopModelProviderState> {
    const [directory, credentials, desktopSettings] = await Promise.all([
      loadProviderCatalog(),
      loadProviderCredentials(),
      mockClient.getDesktopSettings(),
    ])
    const selectedProviderID =
      preferredProviderID ??
      directory.defaultModel?.providerID ??
      desktopSettings.providerID ??
      directory.providers[0]?.id
    const provider =
      directory.providers.find((item) => item.id === selectedProviderID) ?? directory.providers[0]
    if (!provider) throw new Error('Agent 未返回可用模型提供商。')
    const firstPage = await loadProviderModelPage({
      providerID: provider.id,
      limit: 100,
    })
    let models = firstPage.providers.find((item) => item.provider.id === provider.id)?.models ?? []
    const selectedModel =
      directory.defaultModel?.providerID === provider.id ? directory.defaultModel : null
    if (selectedModel && !models.some((item) => item.id === selectedModel.id)) {
      const selectedPage = await loadProviderModelPage({
        providerID: provider.id,
        query: selectedModel.id,
        limit: 100,
      })
      const exact = selectedPage.providers
        .find((item) => item.provider.id === provider.id)
        ?.models.find((item) => item.id === selectedModel.id)
      if (exact) models = [...models, exact]
    }
    const catalogProvider: CatalogProvider = { provider, models }
    const summary = {
      ...catalogProviderToDesktop(catalogProvider),
      modelCount: provider.modelCount,
      config: provider.config,
      readOnly: provider.config.kind === 'builtin',
      unresolvedMigrationIssues: directory.issues
        .filter((issue) => issue.providerId === provider.id)
        .map((issue) => `${issue.code}:${issue.path}`),
    }
    // 最近新建任务模型必须属于当前 Provider 且可用，才视为已配置。
    const configuredModel =
      directory.defaultModel?.providerID === provider.id ? directory.defaultModel : null
    const displayModel =
      configuredModel?.id ?? models.find((item) => item.enabled)?.id ?? models[0]?.id ?? ''
    const activeCredential = credentials.find(
      (credential) => credential.providerId === provider.id && credential.active,
    )
    const providerConfigured = provider.authConfigured
    const apiKeySource = activeCredential
      ? 'secureStorage'
      : providerConfigured && provider.auth.apiKey
        ? 'environment'
        : null
    return {
      selectedProviderID: catalogProvider.provider.id,
      provider: {
        ...summary,
        apiKeyConfigured: providerConfigured,
      },
      model: displayModel,
      variant: configuredModel?.variant,
      baseURL: summary.baseURL,
      apiKeyConfigured: providerConfigured,
      apiKeySource,
      modelConfigured: Boolean(configuredModel) && providerConfigured,
      configurationMessage: !providerConfigured
        ? '未连接凭据，请先配置 API 密钥或完成授权。'
        : configuredModel
          ? undefined
          : '已连接供应商，请选择模型。',
      models: summary.defaultModels,
      modelMetadata: summary.modelMetadata,
    }
  }

  async function loadProjectsById(refresh = false): Promise<Map<string, Project>> {
    if (projectsByIdCache && !refresh) return projectsByIdCache
    const response = await rpc.call<{ projects: Project[] }>('project/list', {})
    projectsByIdCache = new Map(response.projects.map((project) => [project.id, project]))
    return projectsByIdCache
  }

  type AgentProjectTrust = ReturnType<
    (typeof import('./AgentProjectTrust.js'))['createAgentProjectTrust']
  >
  let agentProjectTrustPromise: Promise<AgentProjectTrust> | null = null

  async function ensureDesktopProjectTrusted(project: Project): Promise<Project> {
    requireAgentCapability('config.manage.v1')
    const controller = await (agentProjectTrustPromise ??= import('./AgentProjectTrust.js').then(
      (module) => module.createAgentProjectTrust({ rpc }),
    ))
    return controller.ensure(project)
  }

  async function loadProjectForPath(rootPath: string): Promise<Project> {
    const listed = await rpc.call<{ projects: Project[] }>('project/list', { folderPath: rootPath })
    if (listed.projects.length > 1) {
      throw new Error('该目录属于多个项目，请先选择具体项目。')
    }
    const existing = listed.projects[0]
    const response = existing
      ? await rpc.call<{ project: Project }>('project/open', {
          projectId: existing.id,
          operationId: crypto.randomUUID(),
        })
      : await rpc.call<{ project: Project }>('project/create', {
          primaryPath: rootPath,
          operationId: crypto.randomUUID(),
        })
    projectsByIdCache = null
    return ensureDesktopProjectTrusted(response.project)
  }

  async function chooseProjectForPath(rootPath: string): Promise<Project | null> {
    const listed = await rpc.call<{ projects: Project[] }>('project/list', { folderPath: rootPath })
    if (listed.projects.length === 0) {
      const created = await rpc.call<{ project: Project }>('project/create', {
        primaryPath: rootPath,
        operationId: crypto.randomUUID(),
      })
      return ensureDesktopProjectTrusted(created.project)
    }

    const choices = listed.projects
      .map((project, index) => `${index + 1}. ${project.name}`)
      .join('\n')
    const selection =
      typeof window === 'undefined'
        ? '1'
        : window.prompt(
            `该目录已属于以下项目：\n${choices}\n\n输入序号打开项目，输入 0 仍然创建新项目；取消则不打开。`,
            '1',
          )
    if (selection === null) return null
    if (selection.trim() === '0') {
      const created = await rpc.call<{ project: Project }>('project/create', {
        primaryPath: rootPath,
        operationId: crypto.randomUUID(),
      })
      return ensureDesktopProjectTrusted(created.project)
    }
    const selectedIndex = Number(selection) - 1
    const selected = listed.projects[selectedIndex]
    if (!selected) throw new Error('项目选择无效。')
    const opened = await rpc.call<{ project: Project }>('project/open', {
      projectId: selected.id,
      operationId: crypto.randomUUID(),
    })
    return ensureDesktopProjectTrusted(opened.project)
  }

  async function loadProjectById(projectId: string): Promise<Project> {
    const cached = (await loadProjectsById()).get(projectId)
    if (cached) return ensureDesktopProjectTrusted(cached)
    const response = await rpc.call<{ project: Project }>('project/open', {
      projectId,
      operationId: crypto.randomUUID(),
    })
    projectsByIdCache = new Map([[response.project.id, response.project]])
    return ensureDesktopProjectTrusted(response.project)
  }

  async function preparePullRequestReview(
    projectId: string,
    source: DesktopReviewSource,
    force = false,
  ): Promise<void> {
    if (source.kind !== 'pull-request') return
    await rpc.call('review/pullRequest/prepare', {
      projectId,
      owner: source.owner,
      repository: source.repository,
      number: source.number,
      ...(force ? { force: true } : {}),
    })
  }

  function projectFolderId(project: Project, requested?: string, workspacePath?: string): string {
    if (requested) return requested
    if (workspacePath) {
      const matching = project.folders.find((folder) => arePathsEqual(folder.path, workspacePath))
      if (matching) return matching.id
    }
    return project.primaryFolderId
  }

  function applySessionReadThrough(thread: ThreadListItem): ThreadListItem {
    const pendingReadThrough = Math.max(
      0,
      ...(pendingReadThroughBySessionId.get(thread.id)?.values() ?? []),
    )
    const readThroughAt = Math.max(
      confirmedReadThroughBySessionId.get(thread.id) ?? 0,
      pendingReadThrough,
    )
    return thread.unreadAt != null && thread.unreadAt <= readThroughAt
      ? { ...thread, unreadAt: null }
      : thread
  }

  function applyLifecycleSnapshotFreshness(
    snapshot: DesktopSessionSnapshot,
    requestEpoch: number,
  ): DesktopSessionSnapshot {
    const currentEpoch = lifecycleEpochBySessionId.get(snapshot.item.id) ?? 0
    const lifecycle = latestLifecycleBySessionId.get(snapshot.item.id)
    if (!lifecycle) return snapshot
    const lifecycleIsTerminal =
      lifecycle.status === 'completed' ||
      lifecycle.status === 'failed' ||
      lifecycle.status === 'interrupted' ||
      lifecycle.status === 'stopped' ||
      lifecycle.status === 'cancelled'
    // A terminal durable lifecycle event is authoritative for its turn until a
    // higher-sequence lifecycle event starts the next turn. This also protects
    // refreshes launched by the terminal event itself: their request epoch
    // already includes the event, but an older list/read snapshot must not
    // restore the session to running.
    if (!lifecycleIsTerminal && currentEpoch <= requestEpoch) return snapshot
    return {
      ...snapshot,
      item: {
        ...snapshot.item,
        status: agentTurnStatusToDesktopStatus(lifecycle.status),
        latestTurnStatus: lifecycle.status,
      },
    }
  }

  function applySessionLifecycleUpdate(update: SessionLifecycleUpdate): void {
    const previous = latestLifecycleBySessionId.get(update.threadId)
    if (previous && previous.sequence >= update.sequence) return
    latestLifecycleBySessionId.set(update.threadId, update)
    lifecycleEpochBySessionId.set(
      update.threadId,
      (lifecycleEpochBySessionId.get(update.threadId) ?? 0) + 1,
    )
    const cached = sessionSnapshots.get(update.threadId)
    if (!cached) return
    sessionSnapshots.set(update.threadId, {
      ...cached,
      item: {
        ...cached.item,
        status: agentTurnStatusToDesktopStatus(update.status),
        latestTurnStatus: update.status,
      },
    })
    emitSessionStoreChange()
  }

  function clearSessionLifecycle(sessionId: string): void {
    lifecycleEpochBySessionId.delete(sessionId)
    latestLifecycleBySessionId.delete(sessionId)
  }

  async function listAgentSessions(options?: {
    archived?: boolean
  }): Promise<DesktopSessionSnapshot[]> {
    const archived = options?.archived === true
    const requestEpochs = new Map(lifecycleEpochBySessionId)
    const projectsByIdPromise = loadProjectsById()
    const allThreads = await collectAllThreadPages((cursor) =>
      rpc.call('thread/list', {
        archived,
        limit: THREAD_LIST_PAGE_SIZE,
        ...(cursor ? { cursor } : {}),
      }),
    )
    const projectsById = await projectsByIdPromise
    const snapshots = allThreads.map((rawItem) => {
      const item = applySessionReadThrough(rawItem)
      const listSnapshot = agentThreadListItemToDesktopSnapshot(
        item,
        item.projectID ? projectsById.get(item.projectID) : null,
      )
      const cached = sessionSnapshots.get(item.id)
      let snapshot = cached
        ? {
            ...cached,
            item: {
              ...cached.item,
              ...listSnapshot.item,
              pinnedAt: cached.item.pinnedAt ?? listSnapshot.item.pinnedAt,
            },
            workspace: listSnapshot.workspace,
            updatedAt: listSnapshot.updatedAt,
          }
        : listSnapshot
      snapshot = applyLifecycleSnapshotFreshness(snapshot, requestEpochs.get(item.id) ?? 0)
      sessionSnapshots.set(item.id, snapshot)
      return snapshot
    })
    return snapshots
  }

  async function loadAgentSessionSnapshot(sessionId: string): Promise<DesktopSessionSnapshot> {
    const requestEpoch = lifecycleEpochBySessionId.get(sessionId) ?? 0
    const { snapshot: sharedSnapshot } = await rpc.call('thread/read', {
      threadId: sessionId,
    })
    sessionPermissionConfigs.set(sessionId, sharedSnapshot.thread.settings.permissionConfig)
    const projectsById = await loadProjectsById()
    let snapshot = agentThreadSnapshotToDesktop(
      sharedSnapshot,
      sharedSnapshot.thread.projectID ? projectsById.get(sharedSnapshot.thread.projectID) : null,
    )
    snapshot = applyLifecycleSnapshotFreshness(snapshot, requestEpoch)
    const activeDraftKeys = new Set(
      snapshot.view.pendingPermissions
        .filter((request) => request.toolName === 'AskUserQuestion')
        .map(
          (request) => `${sessionId}:${request.requestId}:${String(request.input.version ?? '')}`,
        ),
    )
    if (sharedSnapshot.pendingPlanApproval) {
      const plan = sharedSnapshot.pendingPlanApproval
      activeDraftKeys.add(`${sessionId}:${plan.id}:${plan.version}:${plan.version}`)
    }
    reconcileQuestionDrafts(sessionId, activeDraftKeys)
    const cached = sessionSnapshots.get(sessionId)
    sessionSnapshots.set(sessionId, {
      ...snapshot,
      item: {
        ...snapshot.item,
        pinnedAt: cached?.item.pinnedAt ?? snapshot.item.pinnedAt,
        unreadAt: cached?.item.unreadAt ?? null,
      },
    })
    return sessionSnapshots.get(sessionId)!
  }

  async function updateAgentSessionMetadata(
    sessionId: string,
    patch: DesktopSessionMetadataPatch,
  ): Promise<DesktopSessionSnapshot> {
    if (patch.archivedAt !== undefined) {
      const response = await rpc.call('thread/update', {
        threadId: sessionId,
        patch: { archived: patch.archivedAt !== null },
        operationId: crypto.randomUUID(),
      })
      return cacheThreadListItem(response.thread)
    }
    const snapshot = sessionSnapshots.get(sessionId) ?? (await loadAgentSessionSnapshot(sessionId))
    sessionSnapshots.set(sessionId, snapshot)
    await refreshAgentSessionStoreChange().catch(() => emitSessionStoreChange())
    return snapshot
  }

  async function restoreArchivedAgentSession(sessionId: string): Promise<void> {
    const snapshot = await loadAgentSessionSnapshot(sessionId)
    if (snapshot.item.archivedAt) {
      await updateAgentSessionMetadata(sessionId, { archivedAt: null })
    }
  }

  async function refreshAgentSessionStoreChange(
    options: { reloadActive?: boolean; reconcileInteractions?: boolean } = {},
  ): Promise<void> {
    // The catalog list is the primary source: without it there is nothing to
    // publish. The pending-interaction catalog and the active-session snapshot
    // are supplements, so a failure there must not discard the list refresh
    // that already corrected `sessionSnapshots`.
    const sessions = await listAgentSessions({ archived: false })
    if (options.reconcileInteractions) {
      await refreshPendingInteractionCatalog().catch((error) => {
        console.error('待处理交互目录对账失败：', error)
      })
    }
    const visibleIds = new Set(sessions.map((snapshot) => snapshot.item.id))
    for (const sessionId of [...sessionSnapshots.keys()]) {
      if (!visibleIds.has(sessionId)) {
        const snapshot = sessionSnapshots.get(sessionId)
        if (!snapshot?.item.archivedAt) {
          sessionSnapshots.delete(sessionId)
          clearSessionLifecycle(sessionId)
        }
      }
    }
    if (activeSessionId && !visibleIds.has(activeSessionId)) {
      activeSessionId = sessions[0]?.item.id ?? null
    }
    if (options.reloadActive && activeSessionId) {
      await loadAgentSessionSnapshot(activeSessionId).catch((error) => {
        console.error('活动会话快照刷新失败：', error)
      })
    }
    emitSessionStoreChange()
  }

  function reconcileAgentSessionStore(): Promise<void> {
    if (sessionStoreReconcile) return sessionStoreReconcile
    providerCredentialsCache = null
    invalidateModelCatalog()
    notifyModelProviderChanged()
    sessionStoreReconcile = refreshAgentSessionStoreChange({
      reloadActive: true,
      reconcileInteractions: true,
    })
      .then(() => {
        notifyReconciliationSuccess()
      })
      .catch((error) => {
        console.error('会话目录对账失败：', error)
        notifyReconciliationError(error)
      })
      .finally(() => {
        sessionStoreReconcile = null
      })
    return sessionStoreReconcile
  }

  function applyCanonicalStatusOverrides(
    sessions: DesktopSessionSnapshot[],
  ): DesktopSessionSnapshot[] {
    if (canonicalStatusOverrides.size === 0) return sessions
    return sessions.map((snapshot) => {
      const item = withSessionStatusOverride(
        snapshot.item,
        canonicalStatusOverrides.get(snapshot.item.id),
      )
      return item === snapshot.item ? snapshot : { ...snapshot, item }
    })
  }

  function emitSessionStoreChange(
    sessions = [...sessionSnapshots.values()].filter((snapshot) => !snapshot.item.archivedAt),
  ): void {
    // Session status has exactly one published value: the catalog snapshot,
    // overridden by the canonical projection for the threads it covers. Every
    // consumer (sidebar, command menu, notifications, pets) reads this change.
    const change: DesktopSessionStoreChange = {
      activeSessionId,
      sessions: applyCanonicalStatusOverrides(sessions),
      pendingInteractionThreadIds: [...pendingInteractionThreadIds],
    }
    for (const listener of sessionStoreListeners) {
      listener(change)
    }
  }

  function publishCanonicalSessionStatus(
    threadId: string,
    status: SessionStatusOverride | null,
  ): void {
    const current = canonicalStatusOverrides.get(threadId)
    if (status === null) {
      if (!current) return
      canonicalStatusOverrides.delete(threadId)
    } else {
      if (
        current &&
        current.status === status.status &&
        current.latestTurnStatus === status.latestTurnStatus
      ) {
        return
      }
      canonicalStatusOverrides.set(threadId, status)
    }
    // The browser mock owns its own session map, so republishing the agent
    // snapshots there would report an empty session list.
    if (agentReady) emitSessionStoreChange()
  }

  /**
   * Reconciles the catalog while any session still claims in-flight work. This
   * is the safety net for a lifecycle event that never reached this client: the
   * terminal status is persisted, so the next list read publishes it.
   */
  function startSessionStatusReconcile(): void {
    if (sessionStatusReconcileTimer !== null) return
    sessionStatusReconcileTimer = setInterval(() => {
      const published = [...sessionSnapshots.values()].map((snapshot) =>
        withSessionStatusOverride(snapshot.item, canonicalStatusOverrides.get(snapshot.item.id)),
      )
      if (!hasNonTerminalSessionStatus(published)) return
      void refreshAgentSessionStoreChange({ reloadActive: false })
        .then(() => {
          notifyReconciliationSuccess()
        })
        .catch((error) => {
          console.error('会话状态对账失败：', error)
          notifyReconciliationError(error)
        })
    }, SESSION_STATUS_RECONCILE_INTERVAL_MS)
  }

  function stopSessionStatusReconcile(): void {
    if (sessionStatusReconcileTimer === null) return
    clearInterval(sessionStatusReconcileTimer)
    sessionStatusReconcileTimer = null
  }

  async function refreshPendingInteractionCatalog(): Promise<void> {
    if (!agentCapabilities.has('interaction.recovery.v1')) {
      pendingInteractionThreadIds = new Set()
      return
    }
    const result = await rpc.call('interaction/listPending', { limit: 500 })
    pendingInteractionThreadIds = new Set(
      result.interactions.map((interaction) => interaction.threadId),
    )
  }

  function scheduleSessionRefresh(sessionId: string): void {
    if (refreshTimers.has(sessionId)) return
    const timer = setTimeout(() => {
      refreshTimers.delete(sessionId)
      void loadAgentSessionSnapshot(sessionId)
        .then(() => refreshAgentSessionStoreChange())
        .catch(() => {})
    }, 250)
    refreshTimers.set(sessionId, timer)
  }

  function taskModeForSession(sessionId: string): 'chat' | 'plan' {
    return sessionSnapshots.get(sessionId)?.item.planModeActive ? 'plan' : 'chat'
  }

  function permissionConfigForSession(sessionId: string) {
    return (
      sessionPermissionConfigs.get(sessionId) ??
      desktopPermissionModeToPermissionConfig(sessionSnapshots.get(sessionId)?.item.permissionMode)
    )
  }

  function permissionModeFromConfig(config: PermissionConfig): DesktopPermissionMode {
    return permissionModeFromDesktopConfig(config)
  }

  async function applyThreadSettings(
    sessionId: string,
    settings: ThreadSettings,
  ): Promise<DesktopSessionSnapshot> {
    const current = sessionSnapshots.get(sessionId) ?? (await loadAgentSessionSnapshot(sessionId))
    const planModeActive = settings.taskMode === 'plan'
    const collaborationMode = collaborationModeFromPlanModeActive(planModeActive)
    const permissionMode = permissionModeFromConfig(settings.permissionConfig)
    const snapshot: DesktopSessionSnapshot = {
      ...current,
      item: {
        ...current.item,
        collaborationMode,
        permissionMode,
        planModeActive,
      },
      settings: {
        ...current.settings,
        collaborationMode,
        permissionConfig: settings.permissionConfig,
        planModeActive,
      },
    }
    sessionSnapshots.set(sessionId, snapshot)
    sessionPermissionConfigs.set(sessionId, settings.permissionConfig)
    emitSessionStoreChange()
    return snapshot
  }

  function updateThreadSettings(
    sessionId: string,
    settings: ThreadSettingsPatch,
  ): Promise<DesktopSessionSnapshot> {
    return queueSettingsUpdate(sessionId, async () => {
      const response = await rpc.call('thread/settings/update', {
        threadId: sessionId,
        settings,
        operationId: crypto.randomUUID(),
      })
      if (response.threadId !== sessionId) {
        throw new Error(`thread/settings/update 返回了不匹配的 threadId：${response.threadId}`)
      }
      return applyThreadSettings(sessionId, response.settings)
    })
  }

  async function importAgentAttachments(input: DesktopUserMessageInput) {
    const { buildAgentAttachmentUploads } = await attachmentUploadSupport
    const payload = await buildAgentAttachmentUploads(input, (attachmentId) =>
      rpc.call('attachment/read', { attachmentId }),
    )
    if (!payload.length) return []
    const response = await rpc.call('attachment/import', {
      uploads: payload,
      operationId: crypto.randomUUID(),
    })
    return response.attachments.map((attachment) => attachment.id)
  }

  async function importAgentMessageContext(
    sessionId: string,
    input: DesktopUserMessageInput,
  ): Promise<{ attachmentIds: string[]; contextReferenceIds: string[] }> {
    const attachmentIds = await importAgentAttachments(input)
    const { importLocalContextReferences } = await localContextImportSupport
    const contextReferenceIds = await importLocalContextReferences(
      sessionId,
      input,
      async (threadId, paths) => {
        requireAgentCapability('local-context.paths.v1')
        return rpc.call('context/path/import', {
          threadId,
          paths,
          operationId: crypto.randomUUID(),
        })
      },
    )
    return {
      attachmentIds,
      contextReferenceIds,
    }
  }

  async function findPendingInteraction(
    predicate: (interaction: PendingInteraction) => boolean,
    threadId?: string,
  ): Promise<PendingInteraction> {
    const result = await rpc.call('interaction/listPending', {
      ...(threadId ? { threadId } : {}),
      limit: 500,
    })
    const interaction = result.interactions.find(predicate)
    if (!interaction) {
      throw new Error('该交互请求已失效或已由其他客户端处理，请刷新任务后重试。')
    }
    return interaction
  }

  async function respondToInteraction(
    interaction: PendingInteraction,
    response: RpcResult<'interaction/respond'>['response'],
  ): Promise<void> {
    await rpc.call('interaction/respond', {
      interactionId: interaction.interactionId,
      expectedVersion: interaction.version,
      response,
      operationId: crypto.randomUUID(),
    })
  }

  async function respondToPermissionInteraction(
    interaction: Extract<PendingInteraction, { kind: 'permission' }>,
    decision: DesktopPermissionDecision,
  ): Promise<void> {
    if (decision.behavior === 'deny') {
      await respondToInteraction(interaction, {
        kind: 'permission',
        decision: 'deny',
      })
      return
    }
    const scope = decision.grantScope ?? interaction.requestedScope
    if (!interaction.allowedScopes.includes(scope)) {
      throw new Error(`授权范围 ${scope} 不在 Agent 允许的范围内，请重新选择。`)
    }
    await respondToInteraction(interaction, {
      kind: 'permission',
      decision: 'grant',
      scope,
      grantedPermissions: interaction.requestedPermissions,
    })
  }

  async function respondToPermissionDecision(
    requestId: string,
    decision: DesktopPermissionDecision,
    threadId?: string,
  ): Promise<void> {
    const questionId = agentQuestionIdFromRequestId(requestId)
    const interaction = await findPendingInteraction(
      (candidate) =>
        questionId
          ? candidate.kind === 'question' && candidate.interactionId === questionId
          : (candidate.kind === 'approval' ||
              candidate.kind === 'permission' ||
              candidate.kind === 'hookTrust') &&
            candidate.interactionId === requestId,
      threadId,
    )
    if (interaction.kind === 'question') {
      const response = questionInteractionResponse(interaction, decision)
      if (
        response.kind === 'question' &&
        response.status === 'answered' &&
        response.answers.some((answer) => answer.skipped)
      ) {
        requireAgentCapability('interaction.questionSkip.v1')
      }
      await respondToInteraction(interaction, response)
      return
    }
    if (interaction.kind === 'approval') {
      await respondToInteraction(interaction, {
        kind: 'approval',
        decision: decision.behavior === 'allow' ? 'allow-once' : 'deny',
        ...(typeof decision.updatedInput?.feedback === 'string'
          ? { feedback: decision.updatedInput.feedback }
          : {}),
        ...(interaction.computerApp && decision.behavior === 'allow'
          ? {
              computerGrant:
                decision.computerGrant ??
                (decision.alwaysAllow ? ('persistent' as const) : ('chat' as const)),
            }
          : {}),
        ...(decision.grantOptionId ? { grantOptionId: decision.grantOptionId } : {}),
      })
      return
    }
    if (interaction.kind === 'mcp-elicitation') {
      requireAgentCapability('mcp.elicitation.v1')
      await respondToInteraction(interaction, {
        kind: 'mcp-elicitation',
        action: decision.updatedInput?.cancelled
          ? 'cancel'
          : decision.behavior === 'allow'
            ? 'accept'
            : 'decline',
        ...(decision.behavior === 'allow'
          ? {
              content: decision.updatedInput?.content as Record<
                string,
                import('@pidex/agent-protocol').JsonValue
              >,
            }
          : {}),
      })
      return
    }
    if (interaction.kind === 'permission') {
      await respondToPermissionInteraction(interaction, decision)
      return
    }
    if (interaction.kind === 'hookTrust') {
      await respondToInteraction(interaction, {
        kind: 'hookTrust',
        decision: decision.behavior === 'allow' ? 'allow' : 'block',
      })
    }
  }

  async function resolveAgentModelRef(
    selection: string | DesktopModelSelection | undefined,
    sessionId: string,
  ): Promise<ModelRef> {
    if (typeof selection === 'object' && selection?.providerID && selection.model) {
      return ModelRefSchema.make({
        providerID: ModelRefSchema.fields.providerID.make(selection.providerID),
        id: ModelRefSchema.fields.id.make(selection.model),
        ...(selection.variant
          ? { variant: ModelRefSchema.fields.variant.from.make(selection.variant) }
          : {}),
      })
    }
    const providers = await loadModelCatalog()
    if (typeof selection === 'string' && selection.trim()) {
      const providerID = sessionSnapshots.get(sessionId)?.settings.providerID
      const provider = providers.providers.find((item) => item.provider.id === providerID)
      const model = provider?.models.find((item) => item.id === selection.trim())
      if (provider && model) {
        return { providerID: provider.provider.id, id: model.id }
      }
    }
    const cached = sessionSnapshots.get(sessionId)
    if (cached?.settings.providerID && cached.settings.model) {
      if (
        providers.defaultModel?.providerID === cached.settings.providerID &&
        providers.defaultModel.id === cached.settings.model
      ) {
        return providers.defaultModel
      }
      const provider = providers.providers.find(
        (item) => item.provider.id === cached.settings.providerID,
      )
      const model = provider?.models.find((item) => item.id === cached.settings.model)
      if (provider && model) return { providerID: provider.provider.id, id: model.id }
    }
    if (providers.defaultModel) return providers.defaultModel
    const credentials = await loadProviderCredentials()
    const provider =
      providers.providers.find((item) => {
        return (
          item.provider.disabled !== true &&
          (credentials.some(
            (credential) =>
              credential.providerId === item.provider.id && credential.enabled && credential.active,
          ) ||
            (!item.provider.auth.apiKey && !item.provider.auth.oauth))
        )
      }) ?? providers.providers[0]
    const model = provider?.models[0]
    if (provider && model) {
      return { providerID: provider.provider.id, id: model.id }
    }
    throw new Error('没有可用模型，请先配置模型提供商。')
  }

  const turnQueueClient = createAgentTurnQueueClient({
    rpc,
    requireSkillInvocationCapability: () => requireAgentCapability('skills.invocation.v1'),
    awaitPendingSettingsUpdate,
    importMessageContext: importAgentMessageContext,
    resolveModelRef: resolveAgentModelRef,
    permissionConfigForSession,
    taskModeForSession,
    queueVersionForSession: (sessionId) => sessionSnapshots.get(sessionId)?.queueVersion,
    loadThreadSnapshot: async (sessionId) =>
      (await rpc.call('thread/read', { threadId: sessionId })).snapshot,
    refreshSession: loadAgentSessionSnapshot,
    emitSessionStoreChange,
  })

  function eventSourceFactory(): ((url: string) => EventSource) | null {
    if (environment.eventSourceFactory) return environment.eventSourceFactory
    if (typeof EventSource === 'undefined') return null
    return (url) => new EventSource(url, { withCredentials: true })
  }

  const operationError = (error: unknown) =>
    error instanceof Error ? error.message : String(error)

  const cacheThreadListItem = async (
    rawThread: ThreadListItem,
  ): Promise<DesktopSessionSnapshot> => {
    const requestEpoch = lifecycleEpochBySessionId.get(rawThread.id) ?? 0
    const thread = applySessionReadThrough(rawThread)
    const projectsById = await loadProjectsById()
    const listSnapshot = agentThreadListItemToDesktopSnapshot(
      thread,
      thread.projectID ? projectsById.get(thread.projectID) : null,
    )
    const snapshot = sessionSnapshots.get(thread.id) ?? listSnapshot
    snapshot.item = { ...snapshot.item, ...listSnapshot.item }
    snapshot.updatedAt = listSnapshot.updatedAt
    const reconciled = applyLifecycleSnapshotFreshness(snapshot, requestEpoch)
    sessionSnapshots.set(thread.id, reconciled)
    emitSessionStoreChange()
    return reconciled
  }

  type AgentReviewApi = ReturnType<(typeof import('./AgentReviewApi.js'))['createAgentReviewApi']>
  let agentReviewApiPromise: Promise<AgentReviewApi> | null = null
  const loadAgentReviewApi = (): Promise<AgentReviewApi> => {
    agentReviewApiPromise ??= import('./AgentReviewApi.js').then((module) =>
      module.createAgentReviewApi({
        rpc,
        loadProjectById,
        loadProjectForPath,
        preparePullRequestReview,
        requireGithubPullRequestCapability: () => requireAgentCapability('github.pullRequests.v1'),
        requireReviewCapability: () => requireAgentCapability('git.review.v1'),
        unsupportedReviewOperation: () => unsupportedAgentOperation('git.review.v1'),
        withAgentOrMock,
      }),
    )
    return agentReviewApiPromise
  }

  type AgentGitApi = ReturnType<(typeof import('./AgentGitApi.js'))['createAgentGitApi']>
  let agentGitApiPromise: Promise<AgentGitApi> | null = null
  const loadAgentGitApi = (): Promise<AgentGitApi> => {
    agentGitApiPromise ??= import('./AgentGitApi.js').then((module) =>
      module.createAgentGitApi({
        environment,
        invalidateProjectCache: () => {
          projectsByIdCache = null
        },
        loadProjectById,
        loadProjectForPath,
        ensureDesktopProjectTrusted,
        operationError,
        requireAgentCapability,
        rpc,
        withRequiredAgent,
      }),
    )
    return agentGitApiPromise
  }

  type AgentMcpApi = ReturnType<(typeof import('./AgentMcpApi.js'))['createAgentMcpApi']>
  let agentMcpApiPromise: Promise<AgentMcpApi> | null = null
  const loadAgentMcpApi = (): Promise<AgentMcpApi> => {
    agentMcpApiPromise ??= import('./AgentMcpApi.js').then((module) =>
      module.createAgentMcpApi({
        mockClient,
        requireMcpManagementCapability: () => requireAgentCapability('mcp.manage.v1'),
        requireMcpOAuthCapability: () => requireAgentCapability('mcp.oauth.v1'),
        rpc,
        withAgentOrMock,
      }),
    )
    return agentMcpApiPromise
  }

  type AgentToolingApi = ReturnType<
    (typeof import('./AgentToolingApi.js'))['createAgentToolingApi']
  >
  let agentToolingApiPromise: Promise<AgentToolingApi> | null = null
  const loadAgentToolingApi = (): Promise<AgentToolingApi> => {
    agentToolingApiPromise ??= import('./AgentToolingApi.js').then((module) =>
      module.createAgentToolingApi({
        currentAppVersion: CURRENT_APP_VERSION,
        mockClient,
        requireAgentCapability,
        rpc: {
          call: rpc.call,
          subscribeEnvelope: subscribeGlobalEventEnvelopes,
        },
        withAgentOrMock,
        withRequiredAgent,
      }),
    )
    return agentToolingApiPromise
  }

  type AgentPluginApi = ReturnType<(typeof import('./AgentPluginApi.js'))['createAgentPluginApi']>
  let agentPluginApiPromise: Promise<AgentPluginApi> | null = null
  const loadAgentPluginApi = (): Promise<AgentPluginApi> => {
    agentPluginApiPromise ??= import('./AgentPluginApi.js').then((module) =>
      module.createAgentPluginApi({
        hasAgentCapability: (capability) => agentCapabilities.has(capability),
        mockClient,
        requireAgentCapability,
        rpc: {
          call: rpc.call,
          subscribeEnvelope: subscribeGlobalEventEnvelopes,
        },
        withAgentOrMock,
      }),
    )
    return agentPluginApiPromise
  }

  type AgentMiniMaxCliApi = ReturnType<
    (typeof import('./AgentMinimaxCliApi.js'))['createAgentMiniMaxCliApi']
  >
  let agentMiniMaxCliApiPromise: Promise<AgentMiniMaxCliApi> | null = null
  const loadAgentMiniMaxCliApi = (): Promise<AgentMiniMaxCliApi> => {
    agentMiniMaxCliApiPromise ??= import('./AgentMinimaxCliApi.js').then((module) =>
      module.createAgentMiniMaxCliApi({
        mockClient,
        requireAgentCapability,
        rpc: {
          call: rpc.call,
          subscribeEnvelope: subscribeGlobalEventEnvelopes,
        },
        withAgentOrMock,
      }),
    )
    return agentMiniMaxCliApiPromise
  }

  type AgentComputerApi = ReturnType<
    (typeof import('./AgentComputerApi.js'))['createAgentComputerApi']
  >
  let agentComputerApiPromise: Promise<AgentComputerApi> | null = null
  const loadAgentComputerApi = (): Promise<AgentComputerApi> => {
    agentComputerApiPromise ??= import('./AgentComputerApi.js').then((module) =>
      module.createAgentComputerApi({
        mockClient,
        requireAgentCapability,
        rpc: {
          call: rpc.call,
          subscribeEnvelope: subscribeGlobalEventEnvelopes,
        },
        withAgentOrMock,
      }),
    )
    return agentComputerApiPromise
  }

  type AgentProviderCredentialApi = ReturnType<
    (typeof import('./AgentProviderCredentialApi.js'))['createAgentProviderCredentialApi']
  >
  let agentProviderCredentialApiPromise: Promise<AgentProviderCredentialApi> | null = null
  const loadAgentProviderCredentialApi = (): Promise<AgentProviderCredentialApi> => {
    agentProviderCredentialApiPromise ??= import('./AgentProviderCredentialApi.js').then((module) =>
      module.createAgentProviderCredentialApi({
        invalidateModelCatalog,
        loadProviderCredentials,
        mockClient,
        providerState,
        requireAgentCapability,
        rpc,
        setProviderCredentialsCache: (credentials) => {
          providerCredentialsCache = credentials
        },
        withAgentOrMock,
      }),
    )
    return agentProviderCredentialApiPromise
  }

  type AgentModelHealthApi = ReturnType<
    (typeof import('./AgentModelHealthApi.js'))['createAgentModelHealthApi']
  >
  let agentModelHealthApiPromise: Promise<AgentModelHealthApi> | null = null
  const loadAgentModelHealthApi = (): Promise<AgentModelHealthApi> => {
    agentModelHealthApiPromise ??= import('./AgentModelHealthApi.js').then((module) =>
      module.createAgentModelHealthApi({
        mockClient,
        requireAgentCapability,
        rpc,
        withAgentOrMock,
      }),
    )
    return agentModelHealthApiPromise
  }

  type AgentSessionGroupApi = ReturnType<
    (typeof import('./AgentSessionGroupApi.js'))['createAgentSessionGroupApi']
  >
  let agentSessionGroupApiPromise: Promise<AgentSessionGroupApi> | null = null
  const loadAgentSessionGroupApi = (): Promise<AgentSessionGroupApi> => {
    agentSessionGroupApiPromise ??= import('./AgentSessionGroupApi.js').then((module) =>
      module.createAgentSessionGroupApi({
        requireAgentCapability,
        rpc,
        withRequiredAgent,
      }),
    )
    return agentSessionGroupApiPromise
  }

  type AgentAutomationApi = ReturnType<
    (typeof import('./AgentAutomationApi.js'))['createAgentAutomationApi']
  >
  let agentAutomationApiPromise: Promise<AgentAutomationApi> | null = null
  const loadAgentAutomationApi = (): Promise<AgentAutomationApi> => {
    agentAutomationApiPromise ??= import('./AgentAutomationApi.js').then((module) =>
      module.createAgentAutomationApi({
        requireAgentCapability,
        rpc,
        withRequiredAgent,
      }),
    )
    return agentAutomationApiPromise
  }

  type AgentCalendarApi = ReturnType<
    (typeof import('./AgentCalendarApi.js'))['createAgentCalendarApi']
  >
  let agentCalendarApiPromise: Promise<AgentCalendarApi> | null = null
  const loadAgentCalendarApi = (): Promise<AgentCalendarApi> => {
    agentCalendarApiPromise ??= import('./AgentCalendarApi.js').then((module) =>
      module.createAgentCalendarApi({
        mockClient,
        requireAgentCapability,
        rpc,
        withAgentOrMock,
      }),
    )
    return agentCalendarApiPromise
  }

  let unsubscribeSessionCatalog: (() => void) | null = null
  const sharedGlobalLiveEventTypes = [
    ...new Set<LiveEventType>([
      ...AGENT_LIVE_EVENT_FILTERS.global,
      ...AGENT_LIVE_EVENT_FILTERS.provider,
      ...AGENT_LIVE_EVENT_FILTERS.modelHealth,
      ...AGENT_LIVE_EVENT_FILTERS.skills,
      ...AGENT_LIVE_EVENT_FILTERS.plugins,
      ...AGENT_LIVE_EVENT_FILTERS.minimaxCli,
      ...AGENT_LIVE_EVENT_FILTERS.tooling,
      ...AGENT_LIVE_EVENT_FILTERS.mcp,
      'speech/statusChanged',
    ]),
  ]

  function subscribeGlobalEventEnvelopes(
    options: AgentRpcSubscription,
    callback: (events: readonly EventEnvelope[]) => void | Promise<void>,
  ): () => void {
    if (
      options.threadId ||
      options.after !== undefined ||
      options.onReplayComplete ||
      options.onCursorExpired ||
      options.onDeliveryError
    ) {
      return rpc.subscribeEnvelope(options, callback)
    }
    const entry = {
      liveEventTypes: new Set(options.liveEventTypes ?? []),
      callback,
      ...(options.onSubscriptionError ? { onSubscriptionError: options.onSubscriptionError } : {}),
    }
    sharedGlobalEventListeners.add(entry)
    startSessionCatalogSubscription()
    return () => {
      sharedGlobalEventListeners.delete(entry)
      if (sharedGlobalEventListeners.size === 0 && sessionStoreListeners.size === 0) {
        stopSessionCatalogSubscription()
      }
    }
  }

  const startSessionCatalogSubscription = (): void => {
    if (unsubscribeSessionCatalog || !eventSourceFactory()) return
    startSessionStatusReconcile()
    const catalogCoordinator = new SessionCatalogCoordinator({
      onCatalogUpdated: () => {
        invalidateModelCatalog()
        notifyModelProviderChanged()
      },
      onProviderCredentialUpdated: () => {
        providerCredentialsCache = null
        invalidateModelCatalog()
        notifyModelProviderChanged()
      },
      onConfigUpdated: (payload) => {
        void agentProjectTrustPromise?.then((controller) => controller.clear())
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(CONFIG_UPDATED_EVENT, {
              detail: payload,
            }),
          )
        }
      },
      onWorkspaceFileChanged: (payload) => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(WORKSPACE_FILE_CHANGED_EVENT, {
              detail: payload,
            }),
          )
        }
      },
      onWorkspaceGitChanged: (payload) => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(WORKSPACE_GIT_CHANGED_EVENT, {
              detail: payload,
            }),
          )
        }
      },
      onLifecycleUpdated: applySessionLifecycleUpdate,
      refreshThreads: async () => {
        // Catalog reconciliation is best-effort: the lifecycle update of this
        // batch was already applied above. Letting a transient list failure
        // reject the batch would make the event client tear the subscription
        // down and resubscribe, which is how a terminal lifecycle event gets
        // skipped and a session stays stuck in its previous status.
        await refreshAgentSessionStoreChange({
          reconcileInteractions: true,
          reloadActive: true,
        })
          .then(() => {
            notifyReconciliationSuccess()
          })
          .catch((error) => {
            console.error('会话目录对账失败：', error)
            notifyReconciliationError(error)
          })
      },
    })
    unsubscribeSessionCatalog = rpc.subscribeEnvelope(
      {
        liveEventTypes: sharedGlobalLiveEventTypes,
        onReplayComplete: () => reconcileAgentSessionStore(),
        onSubscriptionError: (error) => {
          notifyReconciliationError(error)
          for (const entry of [...sharedGlobalEventListeners]) {
            void Promise.resolve(entry.onSubscriptionError?.(error)).catch((cause) => {
              console.error('共享全局事件订阅错误处理失败：', cause)
            })
          }
        },
      },
      async (events) => {
        await catalogCoordinator.deliverBatch(events)
        const results = await Promise.allSettled(
          [...sharedGlobalEventListeners].map((entry) => {
            const selected = events.filter(
              (event) => event.durability === 'durable' || entry.liveEventTypes.has(event.type),
            )
            return selected.length > 0 ? entry.callback(selected) : undefined
          }),
        )
        for (const result of results) {
          if (result.status === 'rejected') {
            console.error('共享全局事件监听失败：', result.reason)
          }
        }
      },
    )
  }

  const stopSessionCatalogSubscription = (): void => {
    stopSessionStatusReconcile()
    unsubscribeSessionCatalog?.()
    unsubscribeSessionCatalog = null
  }

  // 显式组合 Agent/Electron 实现与 lazy Browser Mock fallback：target 中
  // 显式定义的方法优先；未定义的（mock 独有的兜底）在调用时才经 lazy
  // facade 加载 Mock chunk，不再把完整 Mock 实现静态展开进 Agent 路径。
  const agentClient: Partial<DesktopClient> = {
    ...(allowBrowserMockFallback
      ? {}
      : {
          getBrowserState: browserUnavailable,
          openBrowser: browserUnavailable,
          navigateBrowser: browserUnavailable,
          reloadBrowser: browserUnavailable,
          goBackBrowser: browserUnavailable,
          goForwardBrowser: browserUnavailable,
          closeBrowser: browserUnavailable,
          setBrowserBounds: browserUnavailable,
          clearBrowserAllowedSites: browserUnavailable,
        }),
    getWorkspaceDiff: allowBrowserMockFallback
      ? mockClient.getWorkspaceDiff
      : async () => {
          throw new Error('当前 Agent 不提供独立工作区 patch；请使用 Review 数据源。')
        },
    isComposerFileAttachmentAvailable: async () => {
      if (!(await isAgentAvailable())) return false
      return (
        agentCapabilities.has('attachments.v1') &&
        agentCapabilities.has('local-context.paths.v1') &&
        Boolean(
          environment.window?.DesktopBridge?.chooseComposerFiles &&
          environment.window.DesktopBridge.grantComposerPaths &&
          environment.window.DesktopBridge.getPathForFile,
        )
      )
    },
    chooseComposerFiles: async () => {
      const bridge = environment.window?.DesktopBridge
      if (!bridge?.chooseComposerFiles || !bridge.readComposerPathGrant) return []
      const { composerAttachmentsFromPathGrants } =
        await import('./ComposerPathAttachmentSupport.js')
      return composerAttachmentsFromPathGrants(
        await bridge.chooseComposerFiles(),
        bridge as Required<Pick<typeof bridge, 'readComposerPathGrant'>>,
      )
    },
    grantComposerFilePaths: async (filePaths) => {
      const bridge = environment.window?.DesktopBridge
      if (!bridge?.grantComposerPaths || !bridge.readComposerPathGrant) return []
      const { composerAttachmentsFromPathGrants } =
        await import('./ComposerPathAttachmentSupport.js')
      return composerAttachmentsFromPathGrants(
        await bridge.grantComposerPaths(filePaths),
        bridge as Required<Pick<typeof bridge, 'readComposerPathGrant'>>,
      )
    },
    getComposerFilePath: (file) => environment.window?.DesktopBridge?.getPathForFile?.(file) ?? '',
    readAttachment: (attachmentId) =>
      withAgentOrMock(
        () => rpc.call('attachment/read', { attachmentId }),
        () => mockClient.readAttachment(attachmentId),
      ),
    submitVisualizationFollowUp: (input) =>
      withRequiredAgent(() => {
        requireAgentCapability('visualizations.v1')
        return rpc.call('visualization/submitFollowUp', input)
      }),
    readArtifact: (threadId, artifactId) =>
      withRequiredAgent(() => {
        requireAgentCapability('artifacts.read.v1')
        return rpc.call('artifact/read', { threadId, artifactId })
      }),
    readLocalContextPath: (input) =>
      withRequiredAgent(() => {
        requireAgentCapability('local-context.paths.v1')
        return rpc.call('context/path/read', input)
      }),
    listLocalContextPath: (input) =>
      withRequiredAgent(() => {
        requireAgentCapability('local-context.paths.v1')
        return rpc.call('context/path/list', input)
      }),
    openWindow: (input) =>
      environment.window?.DesktopBridge?.openWindow?.(input) ?? Promise.resolve(),
    getSpeechStatus: () =>
      withAgentOrMock(
        async () => (await loadSpeechApi()).getSpeechStatus(),
        () => mockClient.getSpeechStatus(),
      ),
    installSpeech: (force = false) =>
      withAgentOrMock(
        async () => (await loadSpeechApi()).installSpeech(force),
        () => mockClient.installSpeech(force),
      ),
    transcribeSpeech: (input) =>
      withRequiredAgent(async () => (await loadSpeechApi()).transcribeSpeech(input)),
    cancelSpeech: (operationId) =>
      withRequiredAgent(async () => (await loadSpeechApi()).cancelSpeech(operationId)),
    onSpeechStatusUpdated: (callback) =>
      subscribeGlobalEventEnvelopes({ liveEventTypes: ['speech/statusChanged'] }, (events) => {
        for (const event of events) {
          if (event.type === 'speech/statusChanged') callback(event.payload.status)
        }
      }),
    openMicrophonePrivacySettings: () =>
      environment.window?.DesktopBridge?.openMicrophonePrivacySettings
        ? environment.window.DesktopBridge.openMicrophonePrivacySettings()
        : mockClient.openMicrophonePrivacySettings(),
    saveAttachmentToDownloads: (input) =>
      environment.window?.DesktopBridge?.saveAttachmentToDownloads
        ? environment.window.DesktopBridge.saveAttachmentToDownloads(input)
        : mockClient.saveAttachmentToDownloads(input),
    readDraftComposerPath: (input) =>
      environment.window?.DesktopBridge?.readComposerPathGrant
        ? environment.window.DesktopBridge.readComposerPathGrant(input)
        : mockClient.readDraftComposerPath(input),
    listDraftComposerPath: (input) =>
      environment.window?.DesktopBridge?.listComposerPathGrant
        ? environment.window.DesktopBridge.listComposerPathGrant(input)
        : mockClient.listDraftComposerPath(input),
    getRuntimeCapabilities: () =>
      withAgentOrMock<readonly ProtocolCapability[]>(
        async () => [...agentCapabilities] as ProtocolCapability[],
        () => mockClient.getRuntimeCapabilities(),
      ),
    checkForUpdates: () =>
      environment.window?.DesktopBridge?.checkForUpdates
        ? environment.window.DesktopBridge.checkForUpdates()
        : mockClient.checkForUpdates(),
    downloadUpdate: () =>
      environment.window?.DesktopBridge?.downloadUpdate
        ? environment.window.DesktopBridge.downloadUpdate()
        : mockClient.downloadUpdate(),
    quitAndInstall: () =>
      environment.window?.DesktopBridge?.quitAndInstall
        ? environment.window.DesktopBridge.quitAndInstall()
        : mockClient.quitAndInstall(),
    onUpdateStatusChange: (callback) =>
      environment.window?.DesktopBridge?.onUpdateStatusChange
        ? environment.window.DesktopBridge.onUpdateStatusChange(callback)
        : mockClient.onUpdateStatusChange(callback),
    getDataLocation: () =>
      environment.window?.DesktopBridge?.getDataLocation
        ? environment.window.DesktopBridge.getDataLocation()
        : mockClient.getDataLocation(),
    chooseDataLocation: async () =>
      environment.window?.DesktopBridge?.chooseDataLocation
        ? environment.window.DesktopBridge.chooseDataLocation(
            [...(await loadProjectsById()).values()]
              .map(
                (project) =>
                  project.folders.find((folder) => folder.id === project.primaryFolderId)?.path,
              )
              .filter((path): path is string => typeof path === 'string'),
          )
        : mockClient.chooseDataLocation(),
    listTooling: () => loadAgentToolingApi().then((api) => api.listTooling()),
    refreshTooling: () => loadAgentToolingApi().then((api) => api.refreshTooling()),
    setToolingPreference: (id, preference) =>
      loadAgentToolingApi().then((api) => api.setToolingPreference(id, preference)),
    installTooling: (id, force = false) =>
      loadAgentToolingApi().then((api) => api.installTooling(id, force)),
    listRuntimeSkills: (workspacePath, options) =>
      loadAgentToolingApi().then((api) => api.listRuntimeSkills(workspacePath, options)),
    readRuntimeSkill: (path, workspacePath) =>
      loadAgentToolingApi().then((api) => api.readRuntimeSkill(path, workspacePath)),
    setRuntimeSkillEnabled: (path, enabled) =>
      loadAgentToolingApi().then((api) => api.setRuntimeSkillEnabled(path, enabled)),
    onRuntimeSkillsUpdated: (callback) => {
      let disposed = false
      let dispose = () => {}
      void loadAgentToolingApi().then((api) => {
        if (disposed) return
        dispose = api.onRuntimeSkillsUpdated(callback)
      })
      return () => {
        disposed = true
        dispose()
      }
    },
    listPlugins: (workspacePath, forceReload) =>
      loadAgentPluginApi().then((api) => api.listPlugins(workspacePath, forceReload)),
    getPluginDetails: (pluginId, workspacePath) =>
      loadAgentPluginApi().then((api) => api.getPluginDetails(pluginId, workspacePath)),
    setPluginEnabled: (pluginId, enabled) =>
      loadAgentPluginApi().then((api) => api.setPluginEnabled(pluginId, enabled)),
    onPluginsUpdated: (callback) => {
      let disposed = false
      let dispose = () => {}
      void loadAgentPluginApi().then((api) => {
        if (disposed) return
        dispose = api.onPluginsUpdated(callback)
      })
      return () => {
        disposed = true
        dispose()
      }
    },
    getMiniMaxCliStatus: (forceReload) =>
      loadAgentMiniMaxCliApi().then((api) => api.getMiniMaxCliStatus(forceReload)),
    installMiniMaxCli: () => loadAgentMiniMaxCliApi().then((api) => api.installMiniMaxCli()),
    uninstallMiniMaxCli: () => loadAgentMiniMaxCliApi().then((api) => api.uninstallMiniMaxCli()),
    onMiniMaxCliUpdated: (callback) => {
      let disposed = false
      let dispose = () => {}
      void loadAgentMiniMaxCliApi().then((api) => {
        if (disposed) return
        dispose = api.onMiniMaxCliUpdated(callback)
      })
      return () => {
        disposed = true
        dispose()
      }
    },
    getComputerState: () => loadAgentComputerApi().then((api) => api.getComputerState()),
    discoverComputerApps: () => loadAgentComputerApi().then((api) => api.discoverComputerApps()),
    configureComputer: (input) =>
      loadAgentComputerApi().then((api) => api.configureComputer(input)),
    stopComputer: () => loadAgentComputerApi().then((api) => api.stopComputer()),
    onComputerChanged: (callback) => {
      let disposed = false
      let dispose = () => {}
      void loadAgentComputerApi().then((api) => {
        if (disposed) return
        dispose = api.onComputerChanged(callback)
      })
      return () => {
        disposed = true
        dispose()
      }
    },
    onToolingUpdated: (callback) => {
      let disposed = false
      let dispose = () => {}
      void loadAgentToolingApi().then((api) => {
        if (disposed) return
        dispose = api.onToolingUpdated(callback)
      })
      return () => {
        disposed = true
        dispose()
      }
    },
    listPets: () => loadAgentToolingApi().then((api) => api.listPets()),
    listPetCatalog: (refresh = false) =>
      loadAgentToolingApi().then((api) => api.listPetCatalog(refresh)),
    listReleaseNotes: (options = {}) =>
      loadAgentToolingApi().then((api) => api.listReleaseNotes(options)),
    installCatalogPet: (slug, acceptedRestrictedLicense = false) =>
      loadAgentToolingApi().then((api) => api.installCatalogPet(slug, acceptedRestrictedLicense)),
    previewPetInstall: (url) => loadAgentToolingApi().then((api) => api.previewPetInstall(url)),
    installPet: (url) => loadAgentToolingApi().then((api) => api.installPet(url)),
    removePet: (id) => loadAgentToolingApi().then((api) => api.removePet(id)),
    listAutomations: (input) => loadAgentAutomationApi().then((api) => api.listAutomations(input)),
    readAutomation: (input) => loadAgentAutomationApi().then((api) => api.readAutomation(input)),
    createAutomation: (input) =>
      loadAgentAutomationApi().then((api) => api.createAutomation(input)),
    updateAutomation: (input) =>
      loadAgentAutomationApi().then((api) => api.updateAutomation(input)),
    deleteAutomation: (input) =>
      loadAgentAutomationApi().then((api) => api.deleteAutomation(input)),
    runAutomation: (input) => loadAgentAutomationApi().then((api) => api.runAutomation(input)),
    listAutomationRuns: (input) =>
      loadAgentAutomationApi().then((api) => api.listAutomationRuns(input)),
    markAutomationRunRead: (input) =>
      loadAgentAutomationApi().then((api) => api.markAutomationRunRead(input)),
    markAllAutomationRunsRead: (input) =>
      loadAgentAutomationApi().then((api) => api.markAllAutomationRunsRead(input)),
    previewAutomationSchedule: (input) =>
      loadAgentAutomationApi().then((api) => api.previewAutomationSchedule(input)),
    taskSchedule: (method, input) =>
      withRequiredAgent(async () => {
        requireAgentCapability('task.schedule.v1')
        return rpc.call(method as never, input as never) as Promise<
          import('@pidex/agent-protocol').RpcResult<typeof method>
        >
      }),
    listCalendarOccurrences: (input) =>
      loadAgentCalendarApi().then((api) => api.listCalendarOccurrences(input)),
    readScheduledTask: (input) =>
      loadAgentCalendarApi().then((api) => api.readScheduledTask(input)),
    createScheduledTask: (input) =>
      loadAgentCalendarApi().then((api) => api.createScheduledTask(input)),
    updateScheduledTask: (input) =>
      loadAgentCalendarApi().then((api) => api.updateScheduledTask(input)),
    deleteScheduledTask: (input) =>
      loadAgentCalendarApi().then((api) => api.deleteScheduledTask(input)),
    runScheduledTask: (input) => loadAgentCalendarApi().then((api) => api.runScheduledTask(input)),
    readSchedulePlan: (input) => loadAgentCalendarApi().then((api) => api.readSchedulePlan(input)),
    commitSchedulePlan: (input) =>
      loadAgentCalendarApi().then((api) => api.commitSchedulePlan(input)),
    readScheduleDraft: (input) =>
      loadAgentCalendarApi().then((api) => api.readScheduleDraft(input)),
    commitScheduleDraft: (input) =>
      loadAgentCalendarApi().then((api) => api.commitScheduleDraft(input)),
    cancelScheduleDraft: (input) =>
      loadAgentCalendarApi().then((api) => api.cancelScheduleDraft(input)),
    feedbackScheduleDraft: (input) =>
      loadAgentCalendarApi().then((api) => api.feedbackScheduleDraft(input)),
    listSessionGroups: () => loadAgentSessionGroupApi().then((api) => api.listSessionGroups()),
    readSessionGroup: (groupId) =>
      loadAgentSessionGroupApi().then((api) => api.readSessionGroup(groupId)),
    createSessionGroup: (input) =>
      loadAgentSessionGroupApi().then((api) => api.createSessionGroup(input)),
    updateSessionGroup: (input) =>
      loadAgentSessionGroupApi().then((api) => api.updateSessionGroup(input)),
    deleteSessionGroup: (groupId, expectedVersion) =>
      loadAgentSessionGroupApi().then((api) => api.deleteSessionGroup(groupId, expectedVersion)),
    setSessionGroupMembership: (input) =>
      loadAgentSessionGroupApi()
        .then((api) => api.setSessionGroupMembership(input))
        .then(() =>
          refreshAgentSessionStoreChange({ reloadActive: activeSessionId === input.threadId }),
        ),
    listSessionGroupSteps: (groupId) =>
      loadAgentSessionGroupApi().then((api) => api.listSessionGroupSteps(groupId)),
    readSessionGroupStepDiff: (input) =>
      loadAgentSessionGroupApi().then((api) => api.readSessionGroupStepDiff(input)),
    getGithubAuthStatus: () => loadAgentGitApi().then((api) => api.getGithubAuthStatus()),
    startGithubLogin: (input) => loadAgentGitApi().then((api) => api.startGithubLogin(input)),
    pollGithubLogin: () => loadAgentGitApi().then((api) => api.pollGithubLogin()),
    logoutGithub: () => loadAgentGitApi().then((api) => api.logoutGithub()),
    listGithubRepositories: () => loadAgentGitApi().then((api) => api.listGithubRepositories()),
    cloneGithubRepository: (input) =>
      loadAgentGitApi().then((api) => api.cloneGithubRepository(input)),
    getGithubProfileOverview: () => loadAgentGitApi().then((api) => api.getGithubProfileOverview()),
    setGithubUserStatus: (input) => loadAgentGitApi().then((api) => api.setGithubUserStatus(input)),
    clearGithubUserStatus: () => loadAgentGitApi().then((api) => api.clearGithubUserStatus()),
    pushWorkspaceBranch: (input) => loadAgentGitApi().then((api) => api.pushWorkspaceBranch(input)),
    createPullRequest: (input) => loadAgentGitApi().then((api) => api.createPullRequest(input)),
    listThreadPullRequests: (threadIds) =>
      loadAgentGitApi().then((api) => api.listThreadPullRequests(threadIds)),
    linkThreadPullRequest: (input) =>
      loadAgentGitApi().then((api) => api.linkThreadPullRequest(input)),
    unlinkThreadPullRequest: (input) =>
      loadAgentGitApi().then((api) => api.unlinkThreadPullRequest(input)),
    getWorkspaceGitStatus: (workspacePath) =>
      loadAgentGitApi().then((api) => api.getWorkspaceGitStatus(workspacePath)),
    checkoutWorkspaceBranch: (workspacePath, branchName) =>
      loadAgentGitApi().then((api) => api.checkoutWorkspaceBranch(workspacePath, branchName)),
    createWorkspaceBranch: (input) =>
      loadAgentGitApi().then((api) => api.createWorkspaceBranch(input)),
    commitWorkspaceChanges: (input) =>
      loadAgentGitApi().then((api) => api.commitWorkspaceChanges(input)),
    getAgentReviewSummary: (input) =>
      loadAgentReviewApi().then((api) => api.getAgentReviewSummary(input)),
    getAgentReviewFileDiff: (input) =>
      loadAgentReviewApi().then((api) => api.getAgentReviewFileDiff(input)),
    getAgentReviewFileDiffs: (input) =>
      loadAgentReviewApi().then((api) => api.getAgentReviewFileDiffs(input)),
    applyAgentReviewOperation: (input) =>
      loadAgentReviewApi().then((api) => api.applyAgentReviewOperation(input)),
    applyAgentReviewBatch: (input) =>
      loadAgentReviewApi().then((api) => api.applyAgentReviewBatch(input)),
    getAgentReviewBranches: (workspacePath) =>
      loadAgentReviewApi().then((api) => api.getAgentReviewBranches(workspacePath)),
    getAgentReviewCommits: (workspacePath) =>
      loadAgentReviewApi().then((api) => api.getAgentReviewCommits(workspacePath)),
    listAgentReviewComments: (input) =>
      loadAgentReviewApi().then((api) => api.listAgentReviewComments(input)),
    saveAgentReviewComment: (input) =>
      loadAgentReviewApi().then((api) => api.saveAgentReviewComment(input)),
    resolveAgentReviewComment: (input) =>
      loadAgentReviewApi().then((api) => api.resolveAgentReviewComment(input)),
    deleteAgentReviewComment: (input) =>
      loadAgentReviewApi().then((api) => api.deleteAgentReviewComment(input)),
    publishAgentGithubReviewComment: (input) =>
      loadAgentReviewApi().then((api) => api.publishAgentGithubReviewComment(input)),
    submitAgentGithubReview: (input) =>
      loadAgentReviewApi().then((api) => api.submitAgentGithubReview(input)),
    listExternalOpenTargets: async (targetPath) => {
      const listTargets = environment.window?.DesktopBridge?.listExternalOpenTargets
      if (!listTargets) return mockClient.listExternalOpenTargets(targetPath)
      const [targets, settings] = await Promise.all([
        listTargets(targetPath),
        client.getDesktopSettings(),
      ])
      const mappedTargets = targets.map((target) => ({
        id: target.targetId,
        label: target.label,
        kind: target.kind,
        ...(target.iconDataUrl ? { iconDataUrl: target.iconDataUrl } : {}),
      }))
      const resolved = resolvePreferredOpenTarget(mappedTargets, settings.defaultOpenTargetId)
      if (resolved && resolved.id !== settings.defaultOpenTargetId) {
        await client.saveDesktopSettings({
          ...settings,
          defaultOpenTargetId: resolved.id,
        })
      }
      return mappedTargets.map((target) => ({
        ...target,
        preferred: target.id === resolved?.id,
      }))
    },
    listOpenTargets: async () => {
      const settings = await client.getDesktopSettings()
      const targetPath = settings.lastActiveWorkspacePath || settings.recentWorkspaces[0]?.path
      if (!targetPath) return mockClient.listOpenTargets()
      const targets = await client.listExternalOpenTargets(targetPath)
      return targets.map((target) => ({
        id: target.id,
        label: target.label,
        kind: target.kind,
        ...(target.iconDataUrl ? { iconDataUrl: target.iconDataUrl } : {}),
      }))
    },
    openPathWithTarget: async (targetPath, targetId) => {
      const openPath = environment.window?.DesktopBridge?.openPathWithTarget
      if (openPath) await openPath(targetPath, targetId)
      else await mockClient.openPathWithTarget(targetPath, targetId)
      const settings = await client.getDesktopSettings()
      if (settings.defaultOpenTargetId !== targetId) {
        await client.saveDesktopSettings({
          ...settings,
          defaultOpenTargetId: targetId,
        })
      }
    },
    openPathWithDefaultTarget: async (targetPath) => {
      const openPath = environment.window?.DesktopBridge?.openPathWithTarget
      if (!openPath) return mockClient.openPathWithDefaultTarget(targetPath)
      const targets = await client.listExternalOpenTargets(targetPath)
      const settings = await client.getDesktopSettings()
      const resolved = resolvePreferredOpenTarget(targets, settings.defaultOpenTargetId)
      if (!resolved) throw new Error('没有可用的外部打开方式。')
      return openPath(targetPath, resolved.id)
    },
    revealPathInFolder: async (targetPath) => {
      const revealPath = environment.window?.DesktopBridge?.revealPathInFolder
      if (revealPath) return revealPath(targetPath)
      return mockClient.revealPathInFolder(targetPath)
    },
    listMcpServers: (workspacePath) =>
      loadAgentMcpApi().then((api) => api.listMcpServers(workspacePath)),
    getMcpRuntimeStatus: (workspacePath) =>
      loadAgentMcpApi().then((api) => api.getMcpRuntimeStatus(workspacePath)),
    saveMcpServer: (options) => loadAgentMcpApi().then((api) => api.saveMcpServer(options)),
    removeMcpServer: (name, scope, workspacePath) =>
      loadAgentMcpApi().then((api) => api.removeMcpServer(name, scope, workspacePath)),
    setMcpServerEnabled: (name, scope, enabled, workspacePath) =>
      loadAgentMcpApi().then((api) => api.setMcpServerEnabled(name, scope, enabled, workspacePath)),
    reloadMcpConfiguration: (workspacePath) =>
      loadAgentMcpApi().then((api) => api.reloadMcpConfiguration(workspacePath)),
    startMcpOAuth: (name, scope, workspacePath) =>
      loadAgentMcpApi().then((api) => api.startMcpOAuth(name, scope, workspacePath)),
    getMcpOAuthStatus: (attemptId) =>
      loadAgentMcpApi().then((api) => api.getMcpOAuthStatus(attemptId)),
    logoutMcpOAuth: (name, scope, workspacePath) =>
      loadAgentMcpApi().then((api) => api.logoutMcpOAuth(name, scope, workspacePath)),
    restoreSessionTurnChanges: (input) =>
      withUnsupportedAgentFallback('restoreSessionTurnChanges', () =>
        mockClient.restoreSessionTurnChanges(input),
      ),
    listProjects: (folderPath) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ projects: Project[] }>('project/list', {
            ...(folderPath ? { folderPath } : {}),
            limit: 100,
          })
          return result.projects.map((project) => projectToDesktopWorkspace(project, project.id))
        },
        () => mockClient.listProjects(folderPath),
      ),
    updateProject: (input) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ project: Project }>('project/update', {
            ...input,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          return projectToDesktopWorkspace(result.project, input.projectId)
        },
        () => mockClient.updateProject(input),
      ),
    editProject: (input) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('project.edit.v1')
          const result = await rpc.call('project/edit', {
            ...input,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          return projectToDesktopWorkspace(
            await ensureDesktopProjectTrusted(result.project),
            input.projectId,
          )
        },
        () => mockClient.editProject(input),
      ),
    restoreProject: (projectId, removalOperationId) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('project.restore.v1')
          const result = await rpc.call('project/restore', {
            projectId,
            removalOperationId,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          return projectToDesktopWorkspace(result.project, projectId)
        },
        () => mockClient.restoreProject(projectId, removalOperationId),
      ),
    removeProject: (projectId) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call('project/remove', {
            projectId,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          return result
        },
        () => mockClient.removeProject(projectId),
      ),
    addProjectFolder: (projectId, path) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ project: Project }>('project/folder/add', {
            projectId,
            path,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          const project = await ensureDesktopProjectTrusted(result.project)
          return projectToDesktopWorkspace(project, projectId)
        },
        () => mockClient.addProjectFolder(projectId, path),
      ),
    removeProjectFolder: (projectId, folderId) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ project: Project }>('project/folder/remove', {
            projectId,
            folderId,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          return projectToDesktopWorkspace(result.project, projectId)
        },
        () => mockClient.removeProjectFolder(projectId, folderId),
      ),
    setPrimaryProjectFolder: (projectId, folderId) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ project: Project }>('project/folder/set-primary', {
            projectId,
            folderId,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          return projectToDesktopWorkspace(result.project, projectId)
        },
        () => mockClient.setPrimaryProjectFolder(projectId, folderId),
      ),
    updateProjectSettings: (input) =>
      withAgentOrMock(
        async () => {
          const { projectId, expectedVersion, ...settings } = input
          await rpc.call('project/settings/update', {
            projectId,
            settings,
            expectedVersion,
            operationId: crypto.randomUUID(),
          })
          projectsByIdCache = null
          const project = await loadProjectById(projectId)
          return projectToDesktopWorkspace(project, projectId)
        },
        () => mockClient.updateProjectSettings(input),
      ),
    listProjectSources: (projectId) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ sources: DesktopProjectSource[] }>(
            'project/source/list',
            {
              projectId,
              limit: 100,
            },
          )
          return result.sources as DesktopProjectSource[]
        },
        () => mockClient.listProjectSources(projectId),
      ),
    importProjectSources: (projectId, uploads) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ sources: DesktopProjectSource[] }>(
            'project/source/import',
            {
              projectId,
              uploads,
              operationId: crypto.randomUUID(),
            },
          )
          return result.sources as DesktopProjectSource[]
        },
        () => mockClient.importProjectSources(projectId, uploads),
      ),
    addProjectSourceReference: (projectId, folderId, path) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ sources: DesktopProjectSource[] }>(
            'project/source/reference/add',
            {
              projectId,
              folderId,
              path,
              operationId: crypto.randomUUID(),
            },
          )
          return result.sources as DesktopProjectSource[]
        },
        () => mockClient.addProjectSourceReference(projectId, folderId, path),
      ),
    readProjectSource: (projectId, sourceId, range) =>
      withAgentOrMock(
        async () =>
          rpc.call<DesktopProjectSourceReadResult>('project/source/read', {
            projectId,
            sourceId,
            ...(range ? { range } : {}),
          }),
        () => mockClient.readProjectSource(projectId, sourceId, range),
      ),
    removeProjectSource: (projectId, sourceId) =>
      withAgentOrMock(
        async () => {
          const result = await rpc.call<{ removed: boolean }>('project/source/remove', {
            projectId,
            sourceId,
            operationId: crypto.randomUUID(),
          })
          return result.removed
        },
        () => mockClient.removeProjectSource(projectId, sourceId),
      ),
    chooseProjectFolders: async () => {
      const picker = environment.window?.DesktopBridge?.pickWorkspaceDirectories
      if (picker) return picker()
      const path = await mockClient.chooseProjectFolder()
      return path ? [path] : []
    },
    chooseProjectFolder: async () => {
      const picker = environment.window?.DesktopBridge?.pickWorkspaceDirectory
      return picker ? picker() : mockClient.chooseProjectFolder()
    },
    chooseWorkspace: async () => {
      const picker = environment.window?.DesktopBridge?.pickWorkspaceDirectory
      if (!picker) return mockClient.chooseWorkspace()
      const workspacePath = await picker()
      if (!workspacePath) return null
      return withAgentOrMock(
        async () => {
          const project = await chooseProjectForPath(workspacePath)
          return project ? projectToDesktopWorkspace(project, project.id) : null
        },
        () => mockClient.openWorkspace(workspacePath),
      )
    },
    openWorkspace: (workspacePath, projectId) =>
      withAgentOrMock(
        async () =>
          projectToDesktopWorkspace(
            projectId
              ? await loadProjectById(projectId)
              : ((await chooseProjectForPath(workspacePath)) ??
                  (() => {
                    throw new Error('已取消选择项目。')
                  })()),
            projectId ?? null,
          ),
        () => mockClient.openWorkspace(workspacePath),
      ),
    getWorkspaceContext: (workspacePath, projectId) =>
      withAgentOrMock(
        async () =>
          projectToDesktopWorkspace(
            projectId ? await loadProjectById(projectId) : await loadProjectForPath(workspacePath),
            projectId ?? null,
          ),
        () => mockClient.getWorkspaceContext(workspacePath),
      ),
    listWorkspaceFiles: (workspacePath, directoryPath = '.', folderId, projectId) =>
      withAgentOrMock(
        async () => {
          const project = projectId
            ? await loadProjectById(projectId)
            : await loadProjectForPath(workspacePath)
          const result = await rpc.call<{ entries: DesktopFileEntry[] }>('workspace/file/list', {
            projectId: project.id,
            folderId: projectFolderId(project, folderId, workspacePath),
            path: directoryPath,
          })
          return result.entries
        },
        () => mockClient.listWorkspaceFiles(workspacePath, directoryPath),
      ),
    readWorkspaceFile: (workspacePath, filePath, folderId, projectId) =>
      withAgentOrMock(
        async () => {
          const project = projectId
            ? await loadProjectById(projectId)
            : await loadProjectForPath(workspacePath)
          const preview = await rpc.call<DesktopFilePreview>('workspace/file/read', {
            projectId: project.id,
            folderId: projectFolderId(project, folderId, workspacePath),
            path: filePath,
          })
          return {
            ...preview,
            projectId: project.id,
            folderId: projectFolderId(project, folderId, workspacePath),
            rootPath: workspacePath,
          }
        },
        () => mockClient.readWorkspaceFile(workspacePath, filePath),
      ),
    readOptionalWorkspaceFile: (workspacePath, filePath, folderId, projectId) =>
      withAgentOrMock(
        async () => {
          const project = projectId
            ? await loadProjectById(projectId)
            : await loadProjectForPath(workspacePath)
          try {
            const resolvedFolderId = projectFolderId(project, folderId, workspacePath)
            const preview = await rpc.call<DesktopFilePreview>('workspace/file/read', {
              projectId: project.id,
              folderId: resolvedFolderId,
              path: filePath,
            })
            return {
              ...preview,
              projectId: project.id,
              folderId: resolvedFolderId,
              rootPath: workspacePath,
            }
          } catch {
            return null
          }
        },
        () => mockClient.readOptionalWorkspaceFile(workspacePath, filePath),
      ),
    saveWorkspaceFile: (input) =>
      withAgentOrMock(
        async (): Promise<DesktopFileSaveResult> => {
          const project = input.projectId
            ? await loadProjectById(input.projectId)
            : await loadProjectForPath(input.workspacePath)
          const folderId = projectFolderId(project, input.folderId, input.workspacePath)
          const result = await rpc.call<
            | { outcome: 'saved'; revision: DesktopFileRevision }
            | { outcome: 'conflict'; revision: DesktopFileRevision }
          >('workspace/file/save', {
            projectId: project.id,
            folderId,
            path: input.filePath,
            content: input.content,
            expectedRevision: input.expectedRevision,
          })
          if (result.outcome === 'saved') return result
          const latest = await rpc.call<DesktopFilePreview>('workspace/file/read', {
            projectId: project.id,
            folderId,
            path: input.filePath,
          })
          return {
            outcome: 'conflict',
            revision: latest.revision,
            content: latest.content,
          }
        },
        () => mockClient.saveWorkspaceFile(input),
      ),
    watchWorkspaceFile: (workspacePath, filePath, folderId, projectId) =>
      withAgentOrMock(
        async () => {
          const project = projectId
            ? await loadProjectById(projectId)
            : await loadProjectForPath(workspacePath)
          await rpc.call('workspace/file/watch', {
            projectId: project.id,
            folderId: projectFolderId(project, folderId, workspacePath),
            path: filePath,
          })
        },
        () => mockClient.watchWorkspaceFile(workspacePath, filePath),
      ),
    unwatchWorkspaceFile: (workspacePath, filePath, folderId, projectId) =>
      withAgentOrMock(
        async () => {
          const project = projectId
            ? await loadProjectById(projectId)
            : await loadProjectForPath(workspacePath)
          await rpc.call('workspace/file/unwatch', {
            projectId: project.id,
            folderId: projectFolderId(project, folderId, workspacePath),
            path: filePath,
          })
        },
        () => mockClient.unwatchWorkspaceFile(workspacePath, filePath),
      ),
    readConfig: (params) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('config.manage.v1')
          return rpc.call('config/read', params ?? {})
        },
        () => mockClient.readConfig(params),
      ),
    pauseQuestion: (interactionId, expectedVersion) =>
      withRequiredAgent(async () => {
        requireAgentCapability('interaction.questionPause.v1')
        await rpc.call('interaction/questionPause', { interactionId, expectedVersion })
      }),
    approvalReviewState: (threadId) =>
      withRequiredAgent(async () => {
        requireAgentCapability('approval.retry.v1')
        return rpc.call('approval/reviewState', { threadId })
      }),
    retryApproval: (threadId, reviewId) =>
      withRequiredAgent(async () => {
        requireAgentCapability('approval.retry.v1')
        const key = `${threadId}:${reviewId}`
        const state = await rpc.call('approval/reviewState', { threadId })
        const operationId =
          state.denials.find((denial) => denial.id === reviewId)?.retryOperationId ??
          approvalRetryOperations.get(key) ??
          crypto.randomUUID()
        approvalRetryOperations.set(key, operationId)
        const { input } = await rpc.call('approval/retry', { threadId, reviewId, operationId })
        await turnQueueClient.submitMessage(threadId, { text: input }, 'start', {})
        approvalRetryOperations.delete(key)
      }),
    listApprovalRules: (threadId) =>
      withRequiredAgent(async () => {
        requireAgentCapability('interaction.scopedGrants.v1')
        return rpc.call('approval/rules/list', { threadId })
      }),
    revokeApprovalRule: (threadId, ruleId) =>
      withRequiredAgent(async () => {
        requireAgentCapability('interaction.scopedGrants.v1')
        await rpc.call('approval/rules/revoke', { threadId, ruleId })
      }),
    writeConfigBatch: (params) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('config.manage.v1')
          return rpc.call('config/batchWrite', params)
        },
        () => mockClient.writeConfigBatch(params),
      ),
    listConfigProfiles: () =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('config.profiles.v1')
          return rpc.call('config/profile/list', {})
        },
        () => mockClient.listConfigProfiles(),
      ),
    selectConfigProfile: (profileId) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('config.profiles.v1')
          return rpc.call('config/profile/select', { profileId })
        },
        () => mockClient.selectConfigProfile(profileId),
      ),
    getDesktopSettings: async () => {
      const getter = environment.window?.DesktopBridge?.getDesktopSettings
      return getter
        ? normalizeDesktopStoredSettings(await getter())
        : mockClient.getDesktopSettings()
    },
    getThemeSettings: async () => {
      try {
        requireAgentCapability('config.manage.v1')
        const result = await rpc.call('config/read', {})
        const desktop =
          result.config.desktop &&
          typeof result.config.desktop === 'object' &&
          !Array.isArray(result.config.desktop)
            ? (result.config.desktop as Record<string, unknown>)
            : {}
        if (isNewerDesktopThemeSettingsVersion(desktop.appearance)) {
          throw new Error('外观设置版本高于当前客户端支持版本，已拒绝降级读取。')
        }
        if (
          desktop.appearance &&
          typeof desktop.appearance === 'object' &&
          !Array.isArray(desktop.appearance)
        ) {
          return normalizeDesktopThemeSettings(desktop.appearance)
        }
      } catch {
        // The initial Electron value remains the upgrade fallback until Agent migration completes.
      }
      const getter = environment.window?.DesktopBridge?.getAppearanceSettings
      return getter ? getter().then(normalizeDesktopThemeSettings) : mockClient.getThemeSettings()
    },
    saveThemeSettings: async (settings) => {
      const normalized = normalizeDesktopThemeSettings(settings)
      try {
        requireAgentCapability('config.manage.v1')
        const current = await rpc.call('config/read', { includeLayers: true })
        const currentDesktop =
          current.config.desktop &&
          typeof current.config.desktop === 'object' &&
          !Array.isArray(current.config.desktop)
            ? (current.config.desktop as Record<string, unknown>)
            : null
        if (isNewerDesktopThemeSettingsVersion(currentDesktop?.appearance)) {
          throw new Error('外观设置版本高于当前客户端支持版本，已拒绝降级保存。')
        }
        const version = current.layers?.find((layer) => layer.kind === 'user')?.version
        const flatten = (
          value: Record<string, unknown>,
          prefix: string[],
        ): Array<{ keyPath: string[]; value: never }> =>
          Object.entries(value).flatMap(([key, child]) =>
            child && typeof child === 'object' && !Array.isArray(child)
              ? flatten(child as Record<string, unknown>, [...prefix, key])
              : [{ keyPath: [...prefix, key], value: child as never }],
          )
        await rpc.call('config/batchWrite', {
          edits: flatten(normalized as unknown as Record<string, unknown>, [
            'desktop',
            'appearance',
          ]),
          ...(version ? { expectedVersion: version } : {}),
        })
      } catch (error) {
        if (
          environment.window?.DesktopBridge &&
          (!error ||
            typeof error !== 'object' ||
            !('code' in error) ||
            error.code !== 'AGENT_OPERATION_UNSUPPORTED')
        ) {
          throw error
        }
      }
      const saver = environment.window?.DesktopBridge?.saveAppearanceSettings
      if (saver) {
        await saver(normalized)
        await mockClient.saveThemeSettings(normalized)
        return
      }
      await mockClient.saveThemeSettings(normalized)
    },
    canRestorePreviousAppearance: async () => {
      const checker = environment.window?.DesktopBridge?.canRestorePreviousAppearance
      if (checker) {
        return checker()
      }
      return mockClient.canRestorePreviousAppearance()
    },
    restorePreviousAppearance: async () => {
      const restorer = environment.window?.DesktopBridge?.restorePreviousAppearance
      if (restorer) {
        const restored = await restorer()
        const normalized = normalizeDesktopThemeSettings(restored)
        await mockClient.saveThemeSettings(normalized)
        return normalized
      }
      return mockClient.restorePreviousAppearance()
    },
    applyNewDesignTheme: async () => {
      const applier = environment.window?.DesktopBridge?.applyNewDesignTheme
      if (applier) {
        const applied = await applier()
        const normalized = normalizeDesktopThemeSettings(applied)
        await mockClient.saveThemeSettings(normalized)
        return normalized
      }
      return mockClient.applyNewDesignTheme()
    },
    saveDesktopSettings: queueDesktopSettingsSave,
    listProjectMemories: (workspacePath) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const project = await loadProjectForPath(workspacePath)
          const response = await rpc.call<{
            entries: Array<{
              id: string
              scope: 'user' | 'project'
              content: string
              updatedAt: number
            }>
          }>('memory/list', { scope: 'project', projectId: project.id })
          return {
            memoryDir: 'Agent data directory / project memory',
            entrypointPath: 'SQLite:memory_entries',
            memories: response.entries.map((entry) => ({
              relativePath: entry.id,
              absolutePath: entry.id,
              type: 'project' as const,
              description: entry.content.slice(0, 120),
              size: entry.content.length,
              mtimeMs: entry.updatedAt,
            })),
          }
        },
        () => mockClient.listProjectMemories(workspacePath),
      ),
    readProjectMemory: (workspacePath, relativePath) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const project = await loadProjectForPath(workspacePath)
          const response = await rpc.call<{
            entry: { id: string; content: string; updatedAt: number }
          }>('memory/read', { id: relativePath, scope: 'project', projectId: project.id })
          return {
            relativePath: response.entry.id,
            absolutePath: response.entry.id,
            type: 'project' as const,
            description: response.entry.content.slice(0, 120),
            size: response.entry.content.length,
            mtimeMs: response.entry.updatedAt,
            content: response.entry.content,
          }
        },
        () => mockClient.readProjectMemory(workspacePath, relativePath),
      ),
    saveProjectMemory: (input) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const project = await loadProjectForPath(input.workspacePath)
          const response = await rpc.call<{
            entry: { id: string; content: string; updatedAt: number }
          }>('memory/save', {
            scope: 'project',
            projectId: project.id,
            ...(input.relativePath ? { id: input.relativePath } : {}),
            content: input.content,
            operationId: crypto.randomUUID(),
          })
          return {
            relativePath: response.entry.id,
            absolutePath: response.entry.id,
            type: 'project' as const,
            description: response.entry.content.slice(0, 120),
            size: response.entry.content.length,
            mtimeMs: response.entry.updatedAt,
          }
        },
        () => mockClient.saveProjectMemory(input),
      ),
    deleteProjectMemory: (input) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const project = await loadProjectForPath(input.workspacePath)
          await rpc.call('memory/delete', {
            id: input.relativePath,
            scope: 'project',
            projectId: project.id,
            operationId: crypto.randomUUID(),
          })
        },
        () => mockClient.deleteProjectMemory(input),
      ),
    resetProjectMemory: (input) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const project = await loadProjectForPath(input.workspacePath)
          await rpc.call('memory/reset', {
            scope: 'project',
            projectId: project.id,
            includeEventLog: input.includeRecallLog === true,
            operationId: crypto.randomUUID(),
          })
        },
        () => mockClient.resetProjectMemory(input),
      ),
    listProjectMemoryRecalls: (workspacePath) =>
      withAgentOrMock(
        async () => ({ recallLogPath: 'SQLite prompt context fragments', recalls: [] }),
        () => mockClient.listProjectMemoryRecalls(workspacePath),
      ),
    listUserMemories: () =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const response = await rpc.call<{
            entries: Array<{ id: string; content: string; updatedAt: number }>
          }>('memory/list', { scope: 'user' })
          return {
            memoryDir: 'Agent data directory / user memory',
            profilePath: 'SQLite:memory_entries',
            preferencesPath: 'SQLite:memory_entries',
            eventsPath: 'SQLite:memory_jobs',
            conversationIndexPath: 'SQLite:agent.sqlite',
            memories: response.entries.map((entry) => ({
              relativePath: entry.id,
              absolutePath: entry.id,
              type: 'user' as const,
              description: entry.content.slice(0, 120),
              size: entry.content.length,
              mtimeMs: entry.updatedAt,
            })),
          }
        },
        () => mockClient.listUserMemories(),
      ),
    readUserMemory: (relativePath) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const response = await rpc.call<{
            entry: { id: string; content: string; updatedAt: number }
          }>('memory/read', { id: relativePath, scope: 'user' })
          return {
            relativePath: response.entry.id,
            absolutePath: response.entry.id,
            type: 'user' as const,
            description: response.entry.content.slice(0, 120),
            size: response.entry.content.length,
            mtimeMs: response.entry.updatedAt,
            content: response.entry.content,
          }
        },
        () => mockClient.readUserMemory(relativePath),
      ),
    saveUserMemory: (input) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          const response = await rpc.call<{
            entry: { id: string; content: string; updatedAt: number }
          }>('memory/save', {
            scope: 'user',
            ...(input.relativePath ? { id: input.relativePath } : {}),
            content: input.content,
            operationId: crypto.randomUUID(),
          })
          return {
            relativePath: response.entry.id,
            absolutePath: response.entry.id,
            type: 'user' as const,
            description: response.entry.content.slice(0, 120),
            size: response.entry.content.length,
            mtimeMs: response.entry.updatedAt,
          }
        },
        () => mockClient.saveUserMemory(input),
      ),
    deleteUserMemory: (input) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          await rpc.call('memory/delete', {
            id: input.relativePath,
            scope: 'user',
            operationId: crypto.randomUUID(),
          })
        },
        () => mockClient.deleteUserMemory(input),
      ),
    resetUserMemory: (input) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('memory', 2)
          await rpc.call('memory/reset', {
            scope: 'user',
            includeEventLog: input.includeEventLog,
            operationId: crypto.randomUUID(),
          })
        },
        () => mockClient.resetUserMemory(input),
      ),
    generateTaskSuggestions: (input: GenerateDesktopTaskSuggestionsInput) =>
      withRequiredAgent(async () => {
        requireAgentCapability('task-suggestions.v1')
        const project = input.workspacePath ? await loadProjectForPath(input.workspacePath) : null
        return rpc.call('task-suggestion/generate', {
          ...(input.surface ? { surface: input.surface } : {}),
          workspace: project ? { kind: 'project', projectId: project.id } : { kind: 'projectless' },
          context: input.context,
        })
      }),
    refreshModelProviders: () =>
      withAgentOrMock(
        async () => {
          await rpc.call('model/refresh', {
            operationId: crypto.randomUUID(),
          })
          invalidateModelCatalog()
          providerCredentialsCache = null
        },
        () => mockClient.refreshModelProviders(),
      ),
    listModelProviders: () =>
      withAgentOrMock(
        async () => {
          const directory = await loadProviderCatalog()
          return directory.providers.map((provider) => ({
            ...catalogProviderToDesktop({
              provider,
              models: providerModelCache.get(provider.id) ?? [],
            }),
            config: provider.config,
            readOnly: provider.config.kind === 'builtin',
            unresolvedMigrationIssues: directory.issues
              .filter((issue) => issue.providerId === provider.id)
              .map((issue) => `${issue.code}:${issue.path}`),
            apiKeyConfigured: provider.authConfigured,
            modelCount: provider.modelCount,
          }))
        },
        () => mockClient.listModelProviders(),
      ),
    getModelProviderState: (providerID?: ModelProviderID) =>
      withAgentOrMock(
        () => providerState(providerID),
        () => mockClient.getModelProviderState(providerID),
      ),
    fetchProviderModels: async (options) => {
      const result = options.all
        ? await loadAllProviderModels(options.providerID)
        : await loadProviderModelPage({
            providerID: options.providerID,
            query: options.query,
            cursor: options.cursor,
            limit: options.limit,
          })
      const provider = result.providers.find((item) => item.provider.id === options.providerID)
      if (!provider) throw new Error(`未找到模型提供商：${options.providerID}`)
      const metadata = catalogProviderToDesktop(provider).modelMetadata
      return {
        models: provider.models.filter((item) => item.enabled).map((item) => item.id),
        modelMetadata: metadata,
        total: result.total,
        nextCursor: result.nextCursor,
      }
    },
    listUsageSources: () => withRequiredAgent(() => rpc.call('usage/source/list', {})),
    getLocalUsage: (input) => withRequiredAgent(() => rpc.call('usage/local/get', input)),
    queryProviderUsage: (input) => withRequiredAgent(() => rpc.call('usage/provider/query', input)),
    connectUsageCredential: (input) =>
      withRequiredAgent(() => {
        const operationId = crypto.randomUUID()
        if (input.sourceId === 'xai-management') {
          return rpc.call('usage/credential/connect', {
            sourceId: input.sourceId,
            key: input.key,
            teamId: input.teamId,
            operationId,
          })
        }
        if (input.sourceId === 'cloudflare-ai-gateway') {
          return rpc.call('usage/credential/connect', {
            sourceId: input.sourceId,
            key: input.key,
            accountId: input.accountId,
            operationId,
          })
        }
        return rpc.call('usage/credential/connect', {
          sourceId: input.sourceId,
          key: input.key,
          operationId,
        })
      }),
    disconnectUsageCredential: (input) =>
      withRequiredAgent(() =>
        rpc.call('usage/credential/disconnect', {
          ...input,
          operationId: crypto.randomUUID(),
        }),
      ),
    saveModelProvider: async (options) => {
      const directory = await loadProviderCatalog()
      const provider = directory.providers.find((item) => item.id === options.providerID)
      if (!provider) throw new Error(`未找到模型提供商：${options.providerID}`)
      if (options.id) {
        const page = await loadProviderModelPage({
          providerID: options.providerID,
          query: options.id,
          limit: 100,
        })
        const selectedModel = page.providers
          .find((item) => item.provider.id === provider.id)
          ?.models.find((model) => model.id === options.id)
        if (!selectedModel) {
          throw new Error(`未找到模型：${options.providerID}/${options.id}`)
        }
        const selectedVariant = options.variant
          ? selectedModel.variants.find((variant) => variant.id === options.variant)?.id
          : undefined
        const model: ModelRef = {
          providerID: provider.id,
          id: selectedModel.id,
          ...(selectedVariant ? { variant: selectedVariant } : {}),
        }
        await rpc.call('model/setDefault', {
          model,
          operationId: crypto.randomUUID(),
        })
      }
      invalidateModelCatalog()
      return providerState(options.providerID)
    },
    getRecentNewThreadModel: () =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('config.manage.v1')
          const result = await rpc.call('config/read', {})
          const desktop = result.config.desktop
          if (!desktop || typeof desktop !== 'object' || Array.isArray(desktop)) {
            return null
          }
          const recent = (desktop as Record<string, unknown>).recent_new_thread_model
          if (!recent || typeof recent !== 'object' || Array.isArray(recent)) {
            return null
          }
          const record = recent as Record<string, unknown>
          const providerID = typeof record.providerID === 'string' ? record.providerID : ''
          const id = typeof record.id === 'string' ? record.id : ''
          if (!providerID || !id) return null
          return ModelRefSchema.make({
            providerID: ModelRefSchema.fields.providerID.make(providerID),
            id: ModelRefSchema.fields.id.make(id),
            ...(typeof record.variant === 'string' && record.variant
              ? { variant: ModelRefSchema.fields.variant.from.make(record.variant) }
              : {}),
          })
        },
        () => mockClient.getRecentNewThreadModel(),
      ),
    saveRecentNewThreadModel: (model) =>
      withAgentOrMock(
        async () => {
          const directory = await loadProviderCatalog()
          const provider = directory.providers.find((item) => item.id === model.providerID)
          if (!provider) throw new Error(`未找到模型提供商：${model.providerID}`)
          const page = await loadProviderModelPage({
            providerID: model.providerID,
            query: model.id,
            limit: 100,
          })
          const selectedModel = page.providers
            .find((item) => item.provider.id === provider.id)
            ?.models.find((item) => item.id === model.id)
          if (!selectedModel) {
            throw new Error(`未找到模型：${model.providerID}/${model.id}`)
          }
          const selectedVariant = model.variant
            ? selectedModel.variants.find((variant) => variant.id === model.variant)?.id
            : undefined
          await rpc.call('model/setDefault', {
            model: ModelRefSchema.make({
              providerID: ModelRefSchema.fields.providerID.make(String(provider.id)),
              id: ModelRefSchema.fields.id.make(String(selectedModel.id)),
              ...(selectedVariant
                ? { variant: ModelRefSchema.fields.variant.from.make(String(selectedVariant)) }
                : {}),
            }),
            operationId: crypto.randomUUID(),
          })
          invalidateModelCatalog()
        },
        () => mockClient.saveRecentNewThreadModel(model),
      ),
    resolveFirstAvailableModel: () =>
      withAgentOrMock(
        async () => {
          const directory = await loadProviderCatalog()
          for (const provider of directory.providers) {
            if (provider.disabled === true) continue
            if (provider.availability?.status === 'unavailable') continue
            const requiresAuth = provider.auth?.apiKey === true || provider.auth?.oauth === true
            if (requiresAuth && provider.authConfigured !== true) continue
            const page = await loadProviderModelPage({
              providerID: provider.id,
              limit: 100,
            })
            const models =
              page.providers.find((item) => item.provider.id === provider.id)?.models ?? []
            // 只接受启用模型；当前 Provider 没有启用模型时继续检查下一个。
            const first = models.find((candidate) => candidate.enabled)
            if (first) return { providerID: provider.id, id: first.id }
          }
          return null
        },
        () => mockClient.resolveFirstAvailableModel(),
      ),
    saveProviderApiKey: (providerID, apiKey) =>
      loadAgentProviderCredentialApi().then((api) => api.saveProviderApiKey(providerID, apiKey)),
    deleteProviderApiKey: (providerID) =>
      loadAgentProviderCredentialApi().then((api) => api.deleteProviderApiKey(providerID)),
    listProviderCredentials: (providerId) =>
      withAgentOrMock(
        () =>
          loadAgentProviderCredentialApi().then((api) => api.listProviderCredentials(providerId)),
        () => mockClient.listProviderCredentials(providerId),
      ),
    readProviderCredentialStore: () =>
      loadAgentProviderCredentialApi().then((api) => api.readProviderCredentialStore()),
    updateProviderCredentialStore: (store) =>
      loadAgentProviderCredentialApi().then((api) => api.updateProviderCredentialStore(store)),
    createApiKey: (input) =>
      loadAgentProviderCredentialApi().then((api) => api.createApiKey(input)),
    updateApiKey: (input) =>
      loadAgentProviderCredentialApi().then((api) => api.updateApiKey(input)),
    setActiveProviderCredential: (providerId, credentialId) =>
      loadAgentProviderCredentialApi().then((api) =>
        api.setActiveProviderCredential(providerId, credentialId),
      ),
    setProviderCredentialEnabled: (credentialId, enabled) =>
      loadAgentProviderCredentialApi().then((api) =>
        api.setProviderCredentialEnabled(credentialId, enabled),
      ),
    reorderApiKeys: (providerId, orderedCredentialIds) =>
      loadAgentProviderCredentialApi().then((api) =>
        api.reorderApiKeys(providerId, orderedCredentialIds),
      ),
    testApiKey: (credentialId) =>
      loadAgentProviderCredentialApi().then((api) => api.testApiKey(credentialId)),
    deleteProviderCredential: (credentialId) =>
      loadAgentProviderCredentialApi().then((api) => api.deleteProviderCredential(credentialId)),
    testModelProvider: (providerID, model) =>
      loadAgentModelHealthApi().then((api) => api.testModelProvider(providerID, model)),
    previewModelHealth: () => loadAgentModelHealthApi().then((api) => api.previewModelHealth()),
    startModelHealth: (operationId) =>
      loadAgentModelHealthApi().then((api) => api.startModelHealth(operationId)),
    readModelHealth: (runId) => loadAgentModelHealthApi().then((api) => api.readModelHealth(runId)),
    cancelModelHealth: (runId, operationId) =>
      loadAgentModelHealthApi().then((api) => api.cancelModelHealth(runId, operationId)),
    createProvider: async (definition) => {
      await rpc.call('provider/create', {
        definition,
        operationId: crypto.randomUUID(),
      })
      invalidateModelCatalog()
    },
    updateProvider: async (providerId, definition) => {
      await rpc.call('provider/update', {
        providerId: providerId as RpcParams<'provider/update'>['providerId'],
        definition,
        operationId: crypto.randomUUID(),
      })
      invalidateModelCatalog()
    },
    deleteProvider: async (providerId) => {
      await rpc.call('provider/delete', {
        providerId: providerId as RpcParams<'provider/delete'>['providerId'],
        operationId: crypto.randomUUID(),
      })
      invalidateModelCatalog()
    },
    discoverProviderModels: async (providerId, api) => {
      const result = await rpc.call('provider/model/discover', {
        providerId: providerId as RpcParams<'provider/model/discover'>['providerId'],
        api,
      })
      return [...result.models]
    },
    startAuthSession: async (target) => {
      const result = await rpc.call('auth/session/start', {
        target,
        operationId: crypto.randomUUID(),
      })
      return result.session
    },
    respondAuthSession: async (sessionId, promptId, value) => {
      const result = await rpc.call('auth/session/respond', {
        sessionId,
        promptId,
        value,
        operationId: crypto.randomUUID(),
      })
      return result.session
    },
    getAuthSessionStatus: async (sessionId) => {
      const result = await rpc.call('auth/session/status', { sessionId })
      return result.session
    },
    cancelAuthSession: async (sessionId) => {
      const result = await rpc.call('auth/session/cancel', {
        sessionId,
        operationId: crypto.randomUUID(),
      })
      providerCredentialsCache = null
      return result.session
    },
    createSession: async (options: CreateDesktopSessionOptions) =>
      withAgentOrMock<CreateDesktopSessionResult>(
        async () => {
          const workspacePath = options.workspacePath?.trim()
          const project = options.projectId
            ? await loadProjectById(options.projectId)
            : workspacePath
              ? await loadProjectForPath(workspacePath)
              : null
          const collaborationMode = resolveCollaborationMode({
            collaborationMode: options.collaborationMode,
            planModeActive: options.planModeActive,
          })
          const stored = await client.getDesktopSettings()
          const advancedPermission: PermissionConfig =
            options.permissionConfig ?? stored.permissionConfig
          const settings: ThreadSettings = {
            taskMode: planModeActiveFromCollaborationMode(collaborationMode) ? 'plan' : 'chat',
            permissionConfig: advancedPermission,
          }
          const supportsCreationSurface = agentCapabilities.has('thread.creation-surface.v1')
          const creationSurface =
            supportsCreationSurface && options.creationSurface ? options.creationSurface : undefined
          // The execution location is automatic: the project setting wins, otherwise the
          // project type decides. A failed probe is silently Local, and an older agent
          // that never negotiated thread.execution.v2 keeps the legacy Local behaviour.
          const execution = project
            ? resolveTaskExecution({
                supportsExecution: agentCapabilities.has('thread.execution.v2'),
                projectExecutionEnvironment: project.settings?.executionEnvironment,
                eligibility: agentCapabilities.has('thread.execution.v2')
                  ? await rpc
                      .call('worktree/eligibility', { projectId: project.id })
                      .catch(() => null)
                  : null,
              })
            : undefined
          const { snapshot: sharedSnapshot } = await rpc.call('thread/create', {
            workspace: project
              ? { kind: 'project', projectId: project.id, ...(execution ? { execution } : {}) }
              : {
                  kind: 'projectless',
                  ...(options.projectlessPrompt?.trim()
                    ? { prompt: options.projectlessPrompt.trim() }
                    : {}),
                },
            settings,
            ...(creationSurface ? { creationSurface } : {}),
            ...(options.workflowId ? { workflowId: options.workflowId } : {}),
            title: options.sessionName,
            operationId: crypto.randomUUID(),
          })
          const snapshot = agentThreadSnapshotToDesktop(sharedSnapshot, project)
          sessionSnapshots.set(snapshot.item.id, snapshot)
          activeSessionId = snapshot.item.id
          await refreshAgentSessionStoreChange().catch(() => emitSessionStoreChange())
          return {
            sessionId: snapshot.item.id,
            workspace: snapshot.workspace,
            standalone: sharedSnapshot.thread.projectID === null,
          }
        },
        () => mockClient.createSession(options),
      ),
    listSessions: async (options) =>
      withAgentOrMock(
        () => listAgentSessions(options),
        () => mockClient.listSessions(options),
      ),
    getSessionCatalogStatus: async (): Promise<DesktopSessionCatalogStatus> => {
      if (await isAgentAvailable()) return { state: 'ready' }
      if (allowBrowserMockFallback) return mockClient.getSessionCatalogStatus()
      return {
        state: 'unavailable',
      }
    },
    getSession: async (sessionId) =>
      withAgentOrMock(
        () => loadAgentSessionSnapshot(sessionId),
        () => mockClient.getSession(sessionId),
      ),
    listSubagents: async (threadId) => {
      const response = await rpc.call<{ subagents: SubagentProjection[] }>('subagent/list', {
        threadId,
      })
      return response.subagents
    },
    readSubagent: (taskId) => rpc.call<DesktopSubagentRead>('subagent/read', { taskId }),
    stopSubagent: (taskId) =>
      rpc.call('subagent/stop', { taskId, operationId: crypto.randomUUID() }),
    retrySubagent: (taskId) =>
      rpc.call('subagent/retry', { taskId, operationId: crypto.randomUUID() }),
    sendSubagent: (taskId, message) =>
      rpc.call('subagent/send', { taskId, message, operationId: crypto.randomUUID() }),
    followupSubagent: (taskId, message) =>
      rpc.call('subagent/followup', { taskId, message, operationId: crypto.randomUUID() }),
    applySubagentWorktree: (taskId) =>
      rpc.call('subagent/worktree/apply', { taskId, operationId: crypto.randomUUID() }),
    discardSubagentWorktree: (taskId) =>
      rpc.call('subagent/worktree/discard', { taskId, operationId: crypto.randomUUID() }),
    restoreSubagentWorkspace: (taskId) =>
      rpc.call('subagent/workspace/restore', { taskId, operationId: crypto.randomUUID() }),
    respondSubagentApproval: async (approval, decision) => {
      const interaction = await findPendingInteraction(
        (candidate) =>
          candidate.kind === 'approval' &&
          (candidate.interactionId === approval.id || candidate.toolCallId === approval.toolCallID),
        approval.threadId,
      )
      if (interaction.kind !== 'approval') return
      await respondToInteraction(interaction, {
        kind: 'approval',
        decision,
      })
    },
    respondSubagentPermission: async (approval, behavior, grantScope) => {
      const interaction = await findPendingInteraction(
        (candidate) =>
          candidate.kind === 'permission' &&
          (candidate.interactionId === approval.id || candidate.toolCallId === approval.toolCallID),
        approval.threadId,
      )
      if (interaction.kind !== 'permission') return
      await respondToPermissionInteraction(interaction, {
        behavior,
        ...(behavior === 'allow' ? { grantScope } : {}),
      })
    },
    getActiveSessionId: () =>
      withAgentOrMock(
        async () => activeSessionId,
        () => mockClient.getActiveSessionId(),
      ),
    setActiveSession: (sessionId) =>
      withAgentOrMock(
        async () => {
          activeSessionId = sessionId
          emitSessionStoreChange()
        },
        () => mockClient.setActiveSession(sessionId),
      ),
    // Renderer-local status channel: the canonical projection publishes here and
    // every session store consumer reads the merged value from the store change.
    publishCanonicalSessionStatus: (threadId: string, status: SessionStatusOverride | null) => {
      publishCanonicalSessionStatus(threadId, status)
    },
    markSessionRead: (sessionId: string, readThroughAt: string) =>
      withAgentOrMock(
        async () => {
          const readThroughTimestamp = Date.parse(readThroughAt)
          if (!Number.isFinite(readThroughTimestamp)) {
            throw new Error('INVALID_READ_THROUGH_AT')
          }
          const requestId = crypto.randomUUID()
          const pendingReadThrough = pendingReadThroughBySessionId.get(sessionId) ?? new Map()
          pendingReadThrough.set(requestId, readThroughTimestamp)
          pendingReadThroughBySessionId.set(sessionId, pendingReadThrough)
          const cached = sessionSnapshots.get(sessionId)
          if (cached?.item.unreadAt && Date.parse(cached.item.unreadAt) <= readThroughTimestamp) {
            cached.item = { ...cached.item, unreadAt: null }
            sessionSnapshots.set(sessionId, cached)
            emitSessionStoreChange()
          }
          try {
            const response = await rpc.call('thread/mark-read', {
              threadId: sessionId,
              readThroughAt: readThroughTimestamp,
              operationId: requestId,
            })
            confirmedReadThroughBySessionId.set(
              sessionId,
              Math.max(confirmedReadThroughBySessionId.get(sessionId) ?? 0, readThroughTimestamp),
            )
            pendingReadThrough.delete(requestId)
            if (pendingReadThrough.size === 0) {
              pendingReadThroughBySessionId.delete(sessionId)
            }
            return (await cacheThreadListItem(response.thread)).item
          } catch (error) {
            pendingReadThrough.delete(requestId)
            if (pendingReadThrough.size === 0) {
              pendingReadThroughBySessionId.delete(sessionId)
            }
            await refreshAgentSessionStoreChange().catch(() => {})
            throw error
          }
        },
        () => mockClient.markSessionRead(sessionId, readThroughAt),
      ),
    markSessionUnread: (sessionId: string, unreadAt: string) =>
      withAgentOrMock(
        async () => {
          const unreadTimestamp = Date.parse(unreadAt)
          if (!Number.isFinite(unreadTimestamp) || unreadTimestamp < 0) {
            throw new Error('INVALID_UNREAD_AT')
          }
          const requestId = crypto.randomUUID()
          const cached = sessionSnapshots.get(sessionId)
          if (cached) {
            const currentTimestamp = cached.item.unreadAt ? Date.parse(cached.item.unreadAt) : 0
            cached.item = {
              ...cached.item,
              unreadAt: new Date(Math.max(currentTimestamp, unreadTimestamp)).toISOString(),
            }
            sessionSnapshots.set(sessionId, cached)
            emitSessionStoreChange()
          }
          try {
            const response = await rpc.call('thread/mark-unread', {
              threadId: sessionId,
              unreadAt: unreadTimestamp,
              operationId: requestId,
            })
            return (await cacheThreadListItem(response.thread)).item
          } catch (error) {
            await refreshAgentSessionStoreChange().catch(() => {})
            throw error
          }
        },
        () => mockClient.markSessionUnread(sessionId, unreadAt),
      ),
    updateSessionMetadata: async (sessionId: string, patch: DesktopSessionMetadataPatch) =>
      withAgentOrMock(
        () => updateAgentSessionMetadata(sessionId, patch),
        () => mockClient.updateSessionMetadata(sessionId, patch),
      ),
    renameSession: async (sessionId: string, name: string) =>
      withAgentOrMock(
        async () => {
          const response = await rpc.call('thread/update', {
            threadId: sessionId,
            patch: { title: name },
            operationId: crypto.randomUUID(),
          })
          return cacheThreadListItem(response.thread)
        },
        () => mockClient.renameSession(sessionId, name),
      ),
    regenerateSessionTitle: (sessionId: string) =>
      import('./SessionTitleClient.js').then((module) =>
        module.regenerateSessionTitle(
          sessionId,
          withAgentOrMock,
          rpc,
          cacheThreadListItem,
          mockClient,
        ),
      ),
    saveSessionReviewComment: (input) =>
      withUnsupportedAgentFallback('saveSessionReviewComment', () =>
        mockClient.saveSessionReviewComment(input),
      ),
    resolveSessionReviewComment: (input) =>
      withUnsupportedAgentFallback('resolveSessionReviewComment', () =>
        mockClient.resolveSessionReviewComment(input),
      ),
    deleteSessionReviewComment: (input) =>
      withUnsupportedAgentFallback('deleteSessionReviewComment', () =>
        mockClient.deleteSessionReviewComment(input),
      ),
    setSessionPermissionMode: (sessionId, mode) =>
      withAgentOrMock(
        () =>
          updateThreadSettings(sessionId, {
            permissionConfig: desktopPermissionModeToPermissionConfig(mode),
          }),
        () => mockClient.setSessionPermissionMode(sessionId, mode),
      ),
    setSessionPlanModeActive: (sessionId, active) =>
      withAgentOrMock(
        () =>
          updateThreadSettings(sessionId, {
            taskMode: active ? 'plan' : 'chat',
          }),
        () => mockClient.setSessionPlanModeActive(sessionId, active),
      ),
    setSessionLocalRouterMode: (sessionId, mode) =>
      withUnsupportedAgentFallback('setSessionLocalRouterMode', () =>
        mockClient.setSessionLocalRouterMode(sessionId, mode),
      ),
    disposeSession: async (sessionId) =>
      withAgentOrMock(
        async () => {
          await rpc.call('thread/delete', {
            threadId: sessionId,
            operationId: crypto.randomUUID(),
          })
          sessionSnapshots.delete(sessionId)
          clearSessionLifecycle(sessionId)
          if (activeSessionId === sessionId) {
            activeSessionId =
              [...sessionSnapshots.values()].find((snapshot) => !snapshot.item.archivedAt)?.item
                .id ?? null
          }
          emitSessionStoreChange()
        },
        () => mockClient.disposeSession(sessionId),
      ),
    sendUserMessage: async (sessionId, input, model, inputId, goal) =>
      withAgentOrMock(
        async () => {
          const submit = async () => {
            if (goal) requireAgentCapability('thread.goal.v1')
            const current = goal
              ? (await rpc.call('thread/goal/get', { threadId: sessionId })).goal
              : null
            await turnQueueClient.submitMessage(sessionId, input, 'start', {
              model,
              inputId,
              ...(goal ? { goal: { ...goal, expectedVersion: current?.version ?? null } } : {}),
            })
          }
          if (goal) await runGoalMutation(submit)
          else await submit()
        },
        () => mockClient.sendUserMessage(sessionId, input, model, inputId, goal),
      ),
    submitSessionFollowUp: async (
      sessionId: string,
      input: DesktopUserMessageInput,
      delivery: DesktopMessageDelivery,
      inputId?: string,
      model?: string | DesktopModelSelection,
    ) =>
      withAgentOrMock(
        async () => {
          const admission = await turnQueueClient.submitMessage(sessionId, input, delivery, {
            inputId,
            model,
          })
          return admission.outcome
        },
        () => mockClient.submitSessionFollowUp(sessionId, input, delivery, inputId, model),
      ),
    updateQueuedFollowUp: (sessionId, followUpId, input) =>
      withAgentOrMock(
        async () => {
          const shouldReplaceAttachments =
            input.attachments !== undefined || input.retainedAttachmentIds !== undefined
          const shouldReplaceContextReferences =
            input.attachments !== undefined || input.retainedContextReferenceIds !== undefined
          const imported =
            shouldReplaceAttachments || shouldReplaceContextReferences
              ? await importAgentMessageContext(sessionId, input)
              : undefined
          if (input.skills?.length) requireAgentCapability('skills.invocation.v1')
          await turnQueueClient.callQueueMutation(sessionId, 'queue/update', {
            inputId: followUpId,
            content: desktopUserMessageInputToPreviewText({ ...input, skills: undefined }),
            ...(input.skills ? { skills: [...input.skills] } : {}),
            ...(shouldReplaceAttachments ? { attachmentIds: imported?.attachmentIds ?? [] } : {}),
            ...(shouldReplaceContextReferences
              ? { contextReferenceIds: imported?.contextReferenceIds ?? [] }
              : {}),
          })
          const snapshot = await loadAgentSessionSnapshot(sessionId)
          emitSessionStoreChange()
          return snapshot
        },
        () => mockClient.updateQueuedFollowUp(sessionId, followUpId, input),
      ),
    removeQueuedFollowUp: (sessionId, followUpId) =>
      withAgentOrMock(
        async () => {
          await turnQueueClient.callQueueMutation(sessionId, 'queue/remove', {
            inputId: followUpId,
          })
          const snapshot = await loadAgentSessionSnapshot(sessionId)
          emitSessionStoreChange()
          return snapshot
        },
        () => mockClient.removeQueuedFollowUp(sessionId, followUpId),
      ),
    resumeQueuedFollowUps: (sessionId) =>
      withAgentOrMock(
        async () => {
          await turnQueueClient.callQueueMutation(sessionId, 'queue/resume', {})
          const snapshot = await loadAgentSessionSnapshot(sessionId)
          emitSessionStoreChange()
          return snapshot
        },
        () => mockClient.resumeQueuedFollowUps(sessionId),
      ),
    compactSession: (sessionId) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('compact')
          await rpc.call('thread/compact', {
            threadId: sessionId,
            operationId: crypto.randomUUID(),
          })
        },
        () => mockClient.compactSession(sessionId),
      ),
    getSessionPromptPreview: (sessionId) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('prompt', 2)
          return (await rpc.call<{ preview: unknown }>('prompt/preview', { threadId: sessionId }))
            .preview
        },
        () => mockClient.getSessionPromptPreview(sessionId),
      ),
    rollbackSession: (input) =>
      withUnsupportedAgentFallback('rollbackSession', () => mockClient.rollbackSession(input)),
    getSessionGoal: (sessionId) =>
      withAgentOrMock(
        async () => {
          if (!agentCapabilities.has('thread.goal.v1'))
            unsupportedAgentOperation('getSessionGoal (thread.goal.v1)')
          return (await rpc.call('thread/goal/get', { threadId: sessionId })).goal
        },
        () => mockClient.getSessionGoal(sessionId),
      ),
    setSessionGoal: (sessionId, input) =>
      withAgentOrMock(
        async () =>
          runGoalMutation(async () => {
            if (!agentCapabilities.has('thread.goal.v1'))
              unsupportedAgentOperation('setSessionGoal (thread.goal.v1)')
            const current = (await rpc.call('thread/goal/get', { threadId: sessionId })).goal
            const snapshot = (await rpc.call('thread/read', { threadId: sessionId })).snapshot
            const running = snapshot.turns.some((turn) =>
              [
                'queued',
                'running',
                'waiting-permission',
                'waiting-question',
                'waiting-subagents',
              ].includes(turn.status),
            )
            if (input.objective?.trim() && input.status !== 'paused' && !running) {
              await turnQueueClient.submitMessage(
                sessionId,
                { text: input.objective.trim() },
                'start',
                {
                  goal: {
                    objective: input.objective.trim(),
                    expectedVersion: current?.version ?? null,
                    ...(input.tokenBudget === undefined ? {} : { tokenBudget: input.tokenBudget }),
                  },
                },
              )
              return (await rpc.call('thread/goal/get', { threadId: sessionId })).goal!
            }
            const result = await rpc.call('thread/goal/set', {
              threadId: sessionId,
              expectedVersion: current?.version ?? null,
              operationId: crypto.randomUUID(),
              ...(input.objective === undefined ? {} : { objective: input.objective }),
              ...(input.status === undefined ? {} : { status: input.status }),
              ...(input.tokenBudget === undefined ? {} : { tokenBudget: input.tokenBudget }),
            })
            await refreshAgentSessionStoreChange().catch(() => emitSessionStoreChange())
            return result.goal
          }),
        () => mockClient.setSessionGoal(sessionId, input),
      ),
    clearSessionGoal: (sessionId) =>
      withAgentOrMock(
        async () =>
          runGoalMutation(async () => {
            if (!agentCapabilities.has('thread.goal.v1'))
              unsupportedAgentOperation('clearSessionGoal (thread.goal.v1)')
            const current = (await rpc.call('thread/goal/get', { threadId: sessionId })).goal
            if (!current) return true
            await rpc.call('thread/goal/clear', {
              threadId: sessionId,
              expectedVersion: current.version,
              operationId: crypto.randomUUID(),
            })
            await refreshAgentSessionStoreChange().catch(() => emitSessionStoreChange())
            return true
          }),
        () => mockClient.clearSessionGoal(sessionId),
      ),
    listThreadBookmarks: (sessionId) =>
      withAgentOrMock(
        async () => {
          // 未协商到书签 capability 时返回 null，导轨据此隐藏书签按钮。
          if (!agentCapabilities.has('thread.bookmarks.v1')) return null
          return rpc.call<DesktopThreadBookmarkList>('thread/bookmarks/list', {
            threadId: sessionId,
          })
        },
        () => mockClient.listThreadBookmarks(sessionId),
      ),
    setThreadBookmark: (sessionId, input) =>
      withAgentOrMock(
        async () => {
          if (!agentCapabilities.has('thread.bookmarks.v1')) return null
          return rpc.call<DesktopThreadBookmarkList>('thread/bookmarks/set', {
            threadId: sessionId,
            inputId: input.inputId,
            bookmarked: input.bookmarked,
            expectedVersion: input.expectedVersion,
            operationId: crypto.randomUUID(),
          })
        },
        () => mockClient.setThreadBookmark(sessionId, input),
      ),
    startSessionReview: (sessionId, target) =>
      withAgentOrMock(
        async () => {
          if (!agentCapabilities.has('ai.review.v1')) {
            unsupportedAgentOperation('startSessionReview (ai.review.v1)')
          }
          if (target.type === 'custom') {
            unsupportedAgentOperation('自定义 AI Review 目标')
          }
          const settings = await client.getDesktopSettings()
          return rpc.call('review/ai/start', {
            threadId: sessionId,
            target,
            delivery: settings.reviewDelivery,
          })
        },
        () => mockClient.startSessionReview(sessionId, target),
      ),
    setSessionPermissionProfile: (sessionId, profile, approvalPolicy) =>
      withAgentOrMock(
        async () => {
          const current =
            sessionSnapshots.get(sessionId) ?? (await loadAgentSessionSnapshot(sessionId))
          const sandboxMode: PermissionConfig['sandboxMode'] = profile.includes('danger')
            ? 'danger-full-access'
            : profile.includes('read-only')
              ? 'read-only'
              : 'workspace-write'
          const permissionConfig: PermissionConfig = {
            sandboxMode,
            approvalPolicy: approvalPolicy ?? 'on-request',
            approvalsReviewer: current.settings.permissionConfig.approvalsReviewer,
          }
          const response = await rpc.call('thread/settings/update', {
            threadId: sessionId,
            settings: { permissionConfig },
            operationId: crypto.randomUUID(),
          })
          return applyThreadSettings(response.threadId, response.settings)
        },
        () => mockClient.setSessionPermissionProfile(sessionId, profile, approvalPolicy),
      ),
    respondToPermission: async (
      sessionId: string,
      requestId: string,
      decision: DesktopPermissionDecision,
    ) =>
      withAgentOrMock(
        async () => {
          await respondToPermissionDecision(requestId, decision, sessionId)
          await loadAgentSessionSnapshot(sessionId).catch(() => null)
          emitSessionStoreChange()
        },
        () => mockClient.respondToPermission(sessionId, requestId, decision),
      ),
    interruptSession: async (sessionId) =>
      withAgentOrMock(
        async () => {
          await turnQueueClient.interrupt(sessionId)
          scheduleSessionRefresh(sessionId)
        },
        () => mockClient.interruptSession(sessionId),
      ),
    applyThreadPatch: (params) =>
      withRequiredAgent(() =>
        rpc.call('thread/patch/apply', {
          ...params,
          operationId: crypto.randomUUID(),
        }),
      ),
    implementPlanFresh: (params) =>
      withRequiredAgent(async () => {
        requireAgentCapability('plan.approval.fresh.v1')
        const result = await rpc.call('planApproval/implementFresh', params)
        await Promise.all([
          loadAgentSessionSnapshot(params.threadId),
          loadAgentSessionSnapshot(result.targetThreadId),
        ])
        emitSessionStoreChange()
        return result
      }),
    readPlanApproval: (params) =>
      withRequiredAgent(() => {
        requireAgentCapability('plan.approval.v1')
        return rpc.call('planApproval/read', params)
      }),
    respondPlanApproval: (params) =>
      withRequiredAgent(async () => {
        requireAgentCapability('plan.approval.v1')
        const result = await rpc.call('planApproval/respond', params)
        await loadAgentSessionSnapshot(params.threadId)
        emitSessionStoreChange()
        return result
      }),
    readThreadHistoryPage: (params) =>
      withAgentOrMock(
        () => rpc.call('thread/history/read', params),
        async () => {
          const { mockThreadHistoryPage } = await import('./FixtureShared.js')
          return mockThreadHistoryPage(await mockClient.getSession(params.threadId))
        },
      ),
    createSideChat: (input) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('thread.side-chat.v1')
          return rpc.call('thread/side-chat/create', {
            ...input,
            operationId: crypto.randomUUID(),
          })
        },
        () => mockClient.createSideChat(input),
      ),
    discardSideChat: (input) =>
      withAgentOrMock(
        async () => {
          requireAgentCapability('thread.side-chat.v1')
          return rpc.call('thread/side-chat/discard', {
            ...input,
            operationId: crypto.randomUUID(),
          })
        },
        () => mockClient.discardSideChat(input),
      ),
    listPendingAgentInteractions: (params) =>
      withAgentOrMock(
        () => rpc.call('interaction/listPending', params),
        async () => ({ interactions: [], nextCursor: null }),
      ),
    readThreadPatchDiff: (params) => withRequiredAgent(() => rpc.call('thread/patch/diff', params)),
    subscribeAgentEventEnvelopes: (options, callback) => {
      const makeEventSource = eventSourceFactory()
      if (!makeEventSource) return noop
      return subscribeGlobalEventEnvelopes(options, callback)
    },
    onAgentEvent: (callback) =>
      allowBrowserMockFallback ? mockClient.onAgentEvent(callback) : noop,
    onSessionStoreChange: (callback) => {
      sessionStoreListeners.add(callback)
      if (sessionStoreListeners.size === 1) startSessionCatalogSubscription()
      const unsubscribeMock = allowBrowserMockFallback
        ? mockClient.onSessionStoreChange(callback)
        : noop
      return () => {
        sessionStoreListeners.delete(callback)
        if (sessionStoreListeners.size === 0 && sharedGlobalEventListeners.size === 0) {
          stopSessionCatalogSubscription()
        }
        unsubscribeMock()
      }
    },
    onReconciliationError: (callback) => {
      reconciliationErrorListeners.add(callback)
      return () => {
        reconciliationErrorListeners.delete(callback)
      }
    },
    onDesktopSettingsChange: (callback) => {
      const subscribe = environment.window?.DesktopBridge?.onDesktopSettingsChange
      if (!subscribe) return mockClient.onDesktopSettingsChange(callback)
      return subscribe((change) => {
        const value =
          change && typeof change === 'object' && 'settings' in change ? change.settings : change
        callback({
          settings: normalizeDesktopStoredSettings(value),
        })
      })
    },
  }

  // Browser Mock 独有的兜底方法（DesktopClient 接口减去 agentClient
  // 已实现键的差集）。这些方法不在 Agent/bridge 路径实现，原实现经
  // `...mockClient` 静态展开；现在显式组合：首屏挂载链会调用的方法使用与
  // Mock 等价的本地/共享实现（不加载 Mock chunk），其余方法在调用时才经
  // lazy facade 加载 Mock chunk，行为与原实现等价。
  const MOCK_FALLBACK_METHODS = [
    'applyWorkspaceReviewOperation',
    'cancelCopilotLogin',
    'cancelDebugToolProbe',
    'closeDevTools',
    'closeWindow',
    'deleteDesktopToolchain',
    'diagnoseDesktopToolchain',
    'discardWorkspaceChanges',
    'exitApp',
    'exportUserMemory',
    'getAuthStatus',
    'getCopilotAuthStatus',
    'getRuntimeStatus',
    'getWorkspaceReviewDiff',
    'importUserMemory',
    'installSkill',
    'isWindowMaximized',
    'listDebugBuiltinTools',
    'listRuntimePermissionProfiles',
    'listSkillsCatalog',
    'logOut',
    'minimizeWindow',
    'newWindow',
    'onUiCommand',
    'onWorkflowEvent',
    'openDevTools',
    'openExternalURL',
    'openSettings',
    'pickWorkspaceDirectory',
    'pickWorkspaceDirectories',
    'pollCopilotLogin',
    'reinstallDesktopToolchain',
    'runDebugToolProbe',
    'startCopilotLogin',
    'toggleWindowMaximized',
  ] as const
  type MockFallbackMethod = (typeof MOCK_FALLBACK_METHODS)[number]
  const lazyMock =
    (method: MockFallbackMethod) =>
    (...args: unknown[]) => {
      const impl = Reflect.get(mockClient, method) as (...methodArgs: unknown[]) => unknown
      return impl(...args)
    }
  const mockFallbackMethods: Record<MockFallbackMethod, unknown> = {
    // 首屏挂载链（useSessionState/useDesktopCommands/useWorkspaceState/
    // DesktopLayout）会调用：使用与 Mock 等价的本地实现，不加载 Mock chunk。
    onWorkflowEvent: () => () => {},
    onUiCommand: () => () => {},
    getAuthStatus: async () => mockAuthStatus(),
    getRuntimeStatus: async () => mockRuntimeStatus(),
    isWindowMaximized: async () => bridgeWindowMaximized(),
    newWindow: () =>
      environment.window?.DesktopBridge?.openWindow?.({ kind: 'home' }) ?? Promise.resolve(),
    // 其余方法只在用户交互或导航后调用，按需经 lazy facade 加载 Mock chunk。
    applyWorkspaceReviewOperation: lazyMock('applyWorkspaceReviewOperation'),
    cancelCopilotLogin: lazyMock('cancelCopilotLogin'),
    cancelDebugToolProbe: lazyMock('cancelDebugToolProbe'),
    closeDevTools: lazyMock('closeDevTools'),
    closeWindow: async () => {
      await environment.window?.DesktopBridge?.close?.()
    },
    deleteDesktopToolchain: lazyMock('deleteDesktopToolchain'),
    diagnoseDesktopToolchain: lazyMock('diagnoseDesktopToolchain'),
    discardWorkspaceChanges: lazyMock('discardWorkspaceChanges'),
    exitApp: async () => {
      await environment.window?.DesktopBridge?.quitDuringStartup?.()
    },
    exportUserMemory: lazyMock('exportUserMemory'),
    getCopilotAuthStatus: lazyMock('getCopilotAuthStatus'),
    getWorkspaceReviewDiff: lazyMock('getWorkspaceReviewDiff'),
    importUserMemory: lazyMock('importUserMemory'),
    installSkill: lazyMock('installSkill'),
    listDebugBuiltinTools: lazyMock('listDebugBuiltinTools'),
    listRuntimePermissionProfiles: lazyMock('listRuntimePermissionProfiles'),
    listSkillsCatalog: lazyMock('listSkillsCatalog'),
    logOut: lazyMock('logOut'),
    minimizeWindow: async () => {
      await environment.window?.DesktopBridge?.minimize?.()
    },
    openDevTools: lazyMock('openDevTools'),
    openExternalURL: lazyMock('openExternalURL'),
    openSettings: lazyMock('openSettings'),
    pickWorkspaceDirectory: lazyMock('pickWorkspaceDirectory'),
    pickWorkspaceDirectories: lazyMock('pickWorkspaceDirectories'),
    pollCopilotLogin: lazyMock('pollCopilotLogin'),
    reinstallDesktopToolchain: lazyMock('reinstallDesktopToolchain'),
    runDebugToolProbe: lazyMock('runDebugToolProbe'),
    startCopilotLogin: lazyMock('startCopilotLogin'),
    toggleWindowMaximized: async () =>
      (await environment.window?.DesktopBridge?.toggleMaximize?.()) ?? false,
  }

  const client = {
    ...agentClient,
    ...mockFallbackMethods,
  } as unknown as DesktopClient

  return client
}

function noop(): void {}
