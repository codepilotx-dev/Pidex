import type { EventEnvelope, UsageSourceDescriptor } from '@pidex/agent-protocol'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { errorMessageOf } from '@pidex/shared/errors'
import type { DesktopClient } from '../../services/desktop-client/index.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { AGENT_LIVE_EVENT_FILTERS } from '../../services/desktop-client/EventSubscriptionFilters.js'
import type { DesktopApiKeySummary, DesktopProviderCredential } from '../../../shared/Types.js'
import { toUserErrorMessage } from '../../utils/Errors.js'
import type {
  ProviderConfigurationState,
  ProviderDiagnosticEntry,
  ProviderManagementState,
  ProviderOperationError,
  ProviderOperationOutcome,
  ProviderOperationRegion,
  ProviderOperationStatus,
  ProviderOperationTrigger,
  ProviderUsageQueryParams,
  ProviderUsageQueryPartition,
  ProviderUsageQueryResult,
  ProviderUsageRange,
  ProviderUsageSourcesState,
} from './Types.js'

export type ProviderManagementClient = Pick<
  DesktopClient,
  | 'refreshModelProviders'
  | 'listModelProviders'
  | 'getModelProviderState'
  | 'listProviderCredentials'
  | 'listUsageSources'
  | 'queryProviderUsage'
  | 'connectUsageCredential'
  | 'disconnectUsageCredential'
  | 'createApiKey'
  | 'updateApiKey'
  | 'testApiKey'
  | 'setActiveProviderCredential'
  | 'setProviderCredentialEnabled'
  | 'reorderApiKeys'
  | 'deleteProviderCredential'
  | 'subscribeAgentEventEnvelopes'
>

type WriteResult<K extends keyof ProviderManagementClient> = Awaited<
  ReturnType<ProviderManagementClient[K]>
>

export type ProviderManagementActions = {
  ensureLoaded(): Promise<void>
  refresh(): Promise<ProviderConfigurationState>
  refreshSources(): Promise<ProviderUsageSourcesState>
  refreshAllProviderData(providerId?: string): Promise<void>
  querySources(params: ProviderUsageQueryParams): Promise<ProviderUsageQueryResult>
  connectUsageCredential(
    input: Parameters<ProviderManagementClient['connectUsageCredential']>[0],
  ): Promise<ProviderOperationOutcome<WriteResult<'connectUsageCredential'>>>
  disconnectUsageCredential(
    input: Parameters<ProviderManagementClient['disconnectUsageCredential']>[0],
  ): Promise<ProviderOperationOutcome<WriteResult<'disconnectUsageCredential'>>>
  createApiKey(
    input: Parameters<ProviderManagementClient['createApiKey']>[0],
  ): Promise<ProviderOperationOutcome<WriteResult<'createApiKey'>>>
  updateApiKey(
    input: Parameters<ProviderManagementClient['updateApiKey']>[0],
  ): Promise<ProviderOperationOutcome<WriteResult<'updateApiKey'>>>
  testApiKey(
    credentialId: Parameters<ProviderManagementClient['testApiKey']>[0],
  ): Promise<ProviderOperationOutcome<WriteResult<'testApiKey'>>>
  setActiveCredential(
    ...input: Parameters<ProviderManagementClient['setActiveProviderCredential']>
  ): Promise<ProviderOperationOutcome<WriteResult<'setActiveProviderCredential'>>>
  setCredentialEnabled(
    ...input: Parameters<ProviderManagementClient['setProviderCredentialEnabled']>
  ): Promise<ProviderOperationOutcome<WriteResult<'setProviderCredentialEnabled'>>>
  reorderApiKeys(
    ...input: Parameters<ProviderManagementClient['reorderApiKeys']>
  ): Promise<ProviderOperationOutcome<WriteResult<'reorderApiKeys'>>>
  deleteCredential(
    credentialId: Parameters<ProviderManagementClient['deleteProviderCredential']>[0],
  ): Promise<ProviderOperationOutcome<WriteResult<'deleteProviderCredential'>>>
  /** 取消事件订阅并阻止后续状态提交；测试实例与 HMR 模块清理使用。 */
  dispose(): void
  /** 仅开发模式收集的最近操作摘要；不含参数、凭据或响应正文。 */
  getDiagnostics(): readonly ProviderDiagnosticEntry[]
}

export type ProviderManagementStore = StoreApi<ProviderManagementState> & ProviderManagementActions

/** 失败的操作会以该错误拒绝，调用方可据 operationId 关联诊断记录。 */
export class ProviderOperationFailure extends Error {
  constructor(
    readonly operationId: string,
    readonly operation: string,
    readonly region: ProviderOperationRegion,
    message: string,
  ) {
    super(message)
    this.name = 'ProviderOperationFailure'
  }
}

const CONFIGURATION_FALLBACK = '本地 Agent 的供应商配置暂时无法读取，请确认 Agent 已启动后重试。'
const USAGE_SOURCES_FALLBACK = '账户用量来源暂时无法读取，请稍后重试。'
const USAGE_QUERY_FALLBACK = '账户用量查询暂时失败，请稍后重试。'

/** 生产构建不收集诊断；Bun 测试与 Vite 开发模式开启。 */
const DIAGNOSTICS_ENABLED = import.meta.env?.DEV !== false
const DIAGNOSTICS_LIMIT = 100
const USAGE_PARTITION_LIMIT = 8

const INITIAL_STATE: ProviderManagementState = {
  configuration: {
    loaded: false,
    loading: false,
    error: null,
    configurationError: null,
    providers: [],
    currentProviderState: null,
    credentials: [],
    apiKeys: [],
    lastError: null,
  },
  usageSources: {
    loaded: false,
    loading: false,
    error: null,
    sources: [],
    lastError: null,
  },
  usageQueries: {},
}

const providerCredentialToApiKey = (
  credential: DesktopProviderCredential,
): DesktopApiKeySummary => ({
  id: credential.id,
  providerId: credential.providerId,
  label: credential.label,
  maskedValue: credential.maskedValue ?? '',
  enabled: credential.enabled,
  active: credential.active,
  priority: credential.order,
  health: credential.health ?? { status: 'untested' },
  createdAt: credential.createdAt,
  updatedAt: credential.updatedAt,
})

const usageConnectionIdentity = (connection: UsageSourceDescriptor['connection']): string =>
  [connection.kind, connection.credentialId ?? '', connection.maskedValue ?? ''].join('\u0000')

const partitionKeyOf = (range: ProviderUsageRange, timeZone: string): string =>
  `${range}\u0000${timeZone}`

/** 用量查询分区的稳定键；调用方按 `range + timeZone` 订阅自己关心的分区。 */
export const providerUsagePartitionKey = partitionKeyOf

const emptyPartition = (
  range: ProviderUsageRange,
  timeZone: string,
): ProviderUsageQueryPartition => ({
  range,
  timeZone,
  generatedAt: null,
  results: {},
  refreshingSourceIds: [],
  error: null,
})

/** 诊断只记录固定错误类别，避免原始异常文本进入记录。 */
const errorCategoryOf = (error: unknown): string => {
  const code = ((): string | null => {
    if (!error || typeof error !== 'object') return null
    const candidate = error as { errorCode?: unknown; code?: unknown; data?: unknown }
    if (typeof candidate.errorCode === 'string') return candidate.errorCode
    if (typeof candidate.code === 'string') return candidate.code
    const data = candidate.data
    if (data && typeof data === 'object' && typeof (data as { code?: unknown }).code === 'string')
      return (data as { code: string }).code
    return null
  })()
  switch (code) {
    case 'RATE_LIMITED':
      return 'rate-limited'
    case 'CONFLICT':
      return 'conflict'
    case 'PERMISSION_DENIED':
      return 'permission-denied'
    case 'AUTHORIZATION_FAILED':
      return 'authorization-failed'
    case 'INTERNAL_ERROR':
      return 'internal'
    default:
      return 'unknown'
  }
}

/** 复用现有安全转换：空消息回退到区域兜底文案，不暴露原始异常。 */
const safeMessage = (error: unknown, fallback: string): string =>
  (errorMessageOf(error).trim() ? toUserErrorMessage(error) : '') || fallback

type ActiveOperation = {
  id: string
  operation: string
  trigger: ProviderOperationTrigger
  region: ProviderOperationRegion
  eventId: string | null
  startedAt: number
}

type ReadRequest = {
  trigger: ProviderOperationTrigger
  eventId: string | null
  /** 普通重复加载复用同一批次；事件与写入后同步需要新批次。 */
  reuseInFlight: boolean
}

type ReadCoordinator = {
  running: Promise<void> | null
  epoch: number
  invalidated: boolean
  next: ReadRequest | null
}

const createReadCoordinator = (): ReadCoordinator => ({
  running: null,
  epoch: 0,
  invalidated: false,
  next: null,
})

export function createProviderManagementStore(
  client: ProviderManagementClient,
): ProviderManagementStore {
  const store = createStore<ProviderManagementState>()(() => INITIAL_STATE)
  const configurationRead = createReadCoordinator()
  const sourcesRead = createReadCoordinator()
  const pendingQueries = new Map<string, Promise<ProviderUsageQueryResult>>()
  const diagnostics: ProviderDiagnosticEntry[] = []
  /** `partitionKey\0sourceId` → 最近一次请求序号；旧响应据此丢弃。 */
  const latestSourceSequence = new Map<string, number>()
  /** `partitionKey\0sourceId` → 占用该来源的在途请求序号。 */
  const refreshingSources = new Map<string, number>()
  const partitionInFlight = new Map<string, number>()
  const partitionLastUsed = new Map<string, number>()
  let sequence = 0
  let usageTick = 0
  let eventSubscription: (() => void) | null = null
  let catalogRefresh: Promise<void> | null = null
  let disposed = false

  const commit = (updater: (state: ProviderManagementState) => ProviderManagementState): void => {
    if (disposed) return
    store.setState(updater)
  }

  const beginOperation = (
    operation: string,
    trigger: ProviderOperationTrigger,
    region: ProviderOperationRegion,
    eventId: string | null = null,
  ): ActiveOperation => ({
    id: `provider-op-${++sequence}`,
    operation,
    trigger,
    region,
    eventId,
    startedAt: Date.now(),
  })

  const finishOperation = (
    active: ActiveOperation,
    status: ProviderOperationStatus,
    errorCategory: string | null,
  ): void => {
    if (!DIAGNOSTICS_ENABLED) return
    diagnostics.push({
      operationId: active.id,
      operation: active.operation,
      trigger: active.trigger,
      eventId: active.eventId,
      startedAt: active.startedAt,
      durationMs: Date.now() - active.startedAt,
      status,
      errorCategory,
    })
    if (diagnostics.length > DIAGNOSTICS_LIMIT) {
      diagnostics.splice(0, diagnostics.length - DIAGNOSTICS_LIMIT)
    }
  }

  const regionError = (active: ActiveOperation, message: string): ProviderOperationError => ({
    operationId: active.id,
    operation: active.operation,
    region: active.region,
    message,
  })

  const setConfigurationLoading = (loading: boolean): void =>
    commit((state) =>
      state.configuration.loading === loading
        ? state
        : { ...state, configuration: { ...state.configuration, loading } },
    )

  const setSourcesLoading = (loading: boolean): void =>
    commit((state) =>
      state.usageSources.loading === loading
        ? state
        : { ...state, usageSources: { ...state.usageSources, loading } },
    )

  /**
   * 每个区域最多一个读取批次在途。读取期间到来的事件或写入后同步会作废当前批次，
   * 并合并为紧接着的一轮刷新；旧批次据 epoch 拒绝提交。
   */
  const requestRead = (
    coordinator: ReadCoordinator,
    request: ReadRequest,
    run: (epoch: number, request: ReadRequest) => Promise<void>,
    settleLoading: (loading: boolean) => void,
  ): Promise<void> => {
    if (coordinator.running) {
      if (request.reuseInFlight) return coordinator.running
      coordinator.epoch += 1
      coordinator.invalidated = true
      coordinator.next = request
      return coordinator.running
    }
    settleLoading(true)
    const batch = (async () => {
      let next = request
      do {
        coordinator.invalidated = false
        coordinator.next = null
        await run(coordinator.epoch, next)
        next = coordinator.next ?? { ...next, trigger: 'event', eventId: null }
      } while (coordinator.invalidated && !disposed)
    })().finally(() => {
      coordinator.running = null
      settleLoading(false)
    })
    coordinator.running = batch
    return batch
  }

  const readConfiguration = (
    trigger: ProviderOperationTrigger,
    eventId: string | null,
    reuseInFlight: boolean,
  ): Promise<void> =>
    requestRead(
      configurationRead,
      { trigger, eventId, reuseInFlight },
      async (epoch, request) => {
        const active = beginOperation(
          'configuration.read',
          request.trigger,
          'configuration',
          request.eventId,
        )
        const [providersResult, stateResult, credentialsResult] = await Promise.allSettled([
          client.listModelProviders(),
          client.getModelProviderState(),
          client.listProviderCredentials(),
        ])
        if (disposed || epoch !== configurationRead.epoch) {
          finishOperation(active, 'stale', null)
          return
        }
        const failures = [providersResult, stateResult, credentialsResult].filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        )
        const messages = [
          ...new Set(failures.map((result) => safeMessage(result.reason, CONFIGURATION_FALLBACK))),
        ]
        const configurationFailed =
          providersResult.status === 'rejected' || stateResult.status === 'rejected'
        commit((state) => {
          const credentials =
            credentialsResult.status === 'fulfilled'
              ? [...credentialsResult.value]
              : state.configuration.credentials
          return {
            ...state,
            configuration: {
              ...state.configuration,
              loaded: true,
              error: messages.length > 0 ? messages.join('；') : null,
              configurationError: configurationFailed ? CONFIGURATION_FALLBACK : null,
              providers:
                providersResult.status === 'fulfilled'
                  ? [...providersResult.value]
                  : state.configuration.providers,
              // 目录或 Provider 状态读取失败时，stale 的 modelConfigured 不再可信。
              currentProviderState: configurationFailed
                ? null
                : stateResult.status === 'fulfilled'
                  ? stateResult.value
                  : state.configuration.currentProviderState,
              credentials,
              apiKeys:
                credentialsResult.status === 'fulfilled'
                  ? credentials
                      .filter((credential) => credential.kind === 'api-key')
                      .map(providerCredentialToApiKey)
                  : state.configuration.apiKeys,
              lastError: failures.length > 0 ? regionError(active, messages[0]!) : null,
            },
          }
        })
        finishOperation(
          active,
          failures.length === 0 ? 'success' : failures.length === 3 ? 'failure' : 'partial',
          failures.length > 0 ? errorCategoryOf(failures[0]!.reason) : null,
        )
      },
      setConfigurationLoading,
    )

  const readUsageSources = (
    trigger: ProviderOperationTrigger,
    eventId: string | null,
    reuseInFlight: boolean,
  ): Promise<void> =>
    requestRead(
      sourcesRead,
      { trigger, eventId, reuseInFlight },
      async (epoch, request) => {
        const active = beginOperation(
          'usage-sources.read',
          request.trigger,
          'usage-sources',
          request.eventId,
        )
        const [sourcesResult] = await Promise.allSettled([client.listUsageSources()])
        if (disposed || epoch !== sourcesRead.epoch) {
          finishOperation(active, 'stale', null)
          return
        }
        if (sourcesResult.status === 'rejected') {
          const message = safeMessage(sourcesResult.reason, USAGE_SOURCES_FALLBACK)
          commit((state) => ({
            ...state,
            usageSources: {
              ...state.usageSources,
              loaded: true,
              error: message,
              lastError: regionError(active, message),
            },
          }))
          finishOperation(active, 'failure', errorCategoryOf(sourcesResult.reason))
          return
        }
        const nextSources = [...sourcesResult.value.sources]
        const previousSources = store.getState().usageSources.sources
        const nextById = new Map(nextSources.map((source) => [source.sourceId, source]))
        invalidateUsageSources(
          previousSources.flatMap((source) => {
            const next = nextById.get(source.sourceId)
            if (!next || next.connection.kind === 'none') return [source.sourceId]
            return usageConnectionIdentity(source.connection) ===
              usageConnectionIdentity(next.connection)
              ? []
              : [source.sourceId]
          }),
        )
        commit((state) => ({
          ...state,
          usageSources: {
            ...state.usageSources,
            loaded: true,
            error: null,
            sources: nextSources,
            lastError: null,
          },
        }))
        finishOperation(active, 'success', null)
      },
      setSourcesLoading,
    )

  const refreshingIdsFor = (partitionKey: string): string[] => {
    const prefix = `${partitionKey}\u0000`
    return [...refreshingSources.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
  }

  const evictIdlePartitions = (): void => {
    const idle = [...partitionLastUsed.entries()].filter(
      ([key]) => (partitionInFlight.get(key) ?? 0) === 0,
    )
    if (idle.length <= USAGE_PARTITION_LIMIT) return
    idle.sort((left, right) => left[1] - right[1])
    const removed = idle.slice(0, idle.length - USAGE_PARTITION_LIMIT).map(([key]) => key)
    for (const key of removed) {
      partitionLastUsed.delete(key)
      partitionInFlight.delete(key)
      const prefix = `${key}\u0000`
      for (const sequenceKey of latestSourceSequence.keys()) {
        if (sequenceKey.startsWith(prefix)) latestSourceSequence.delete(sequenceKey)
      }
      for (const refreshKey of refreshingSources.keys()) {
        if (refreshKey.startsWith(prefix)) refreshingSources.delete(refreshKey)
      }
    }
    commit((state) => {
      const usageQueries = { ...state.usageQueries }
      for (const key of removed) delete usageQueries[key]
      return { ...state, usageQueries }
    })
  }

  /**
   * 凭据或连接变化后，相关来源的历史结果与在途请求都不再可信：
   * 删除缓存结果并作废请求序号，使旧响应无法写回。
   */
  function invalidateUsageSources(sourceIds: Iterable<string>): void {
    const ids = new Set(sourceIds)
    if (ids.size === 0) return
    for (const id of ids) {
      const suffix = `\u0000${id}`
      for (const key of latestSourceSequence.keys()) {
        if (key.endsWith(suffix)) latestSourceSequence.delete(key)
      }
      for (const key of refreshingSources.keys()) {
        if (key.endsWith(suffix)) refreshingSources.delete(key)
      }
    }
    commit((state) => {
      const usageQueries: Record<string, ProviderUsageQueryPartition> = {}
      let changed = false
      for (const [key, partition] of Object.entries(state.usageQueries)) {
        const results = { ...partition.results }
        let partitionChanged = false
        for (const id of ids) {
          if (id in results) {
            delete results[id]
            partitionChanged = true
          }
        }
        const refreshingSourceIds = partition.refreshingSourceIds.filter((id) => !ids.has(id))
        if (
          partitionChanged ||
          refreshingSourceIds.length !== partition.refreshingSourceIds.length
        ) {
          changed = true
          usageQueries[key] = { ...partition, results, refreshingSourceIds }
        } else {
          usageQueries[key] = partition
        }
      }
      return changed ? { ...state, usageQueries } : state
    })
  }

  const invalidateProviderCredentialUsage = (providerId?: string): void => {
    invalidateUsageSources(
      store
        .getState()
        .usageSources.sources.filter(
          (source) =>
            source.connectionMethod.kind === 'provider-credential' &&
            (providerId === undefined ||
              source.providerIds.some((id) => String(id) === providerId)),
        )
        .map((source) => source.sourceId),
    )
  }

  const querySources = (params: ProviderUsageQueryParams): Promise<ProviderUsageQueryResult> => {
    ensureEventSubscription()
    const { range, timeZone } = params
    const sourceIds = [...new Set(params.sourceIds ?? [])].sort()
    if (sourceIds.length === 0) {
      return Promise.resolve({ range, timeZone, generatedAt: Date.now(), sources: [] })
    }
    const partitionKey = partitionKeyOf(range, timeZone)
    const requestKey = `${partitionKey}\u0000${sourceIds.join(',')}\u0000${params.force ? 'force' : 'cached'}`
    const existing = pendingQueries.get(requestKey)
    if (existing) return existing

    const active = beginOperation('usage.query', 'user', 'usage-query')
    const requested = new Set(sourceIds)
    const startedSequences = new Map<string, number>()
    for (const sourceId of sourceIds) {
      const started = ++sequence
      startedSequences.set(sourceId, started)
      latestSourceSequence.set(`${partitionKey}\u0000${sourceId}`, started)
      refreshingSources.set(`${partitionKey}\u0000${sourceId}`, started)
    }
    partitionInFlight.set(partitionKey, (partitionInFlight.get(partitionKey) ?? 0) + 1)
    partitionLastUsed.set(partitionKey, ++usageTick)
    commit((state) => {
      const partition = state.usageQueries[partitionKey] ?? emptyPartition(range, timeZone)
      return {
        ...state,
        usageQueries: {
          ...state.usageQueries,
          [partitionKey]: { ...partition, refreshingSourceIds: refreshingIdsFor(partitionKey) },
        },
      }
    })

    const isLatestForRequest = (): boolean =>
      sourceIds.every(
        (sourceId) =>
          latestSourceSequence.get(`${partitionKey}\u0000${sourceId}`) ===
          startedSequences.get(sourceId),
      )

    const pending = client
      .queryProviderUsage({ ...params, sourceIds })
      .then((result) => {
        const current = isLatestForRequest()
        if (!disposed) {
          commit((state) => {
            const partition = state.usageQueries[partitionKey] ?? emptyPartition(range, timeZone)
            const results = { ...partition.results }
            for (const source of result.sources) {
              if (!requested.has(source.sourceId)) continue
              if (
                latestSourceSequence.get(`${partitionKey}\u0000${source.sourceId}`) !==
                startedSequences.get(source.sourceId)
              )
                continue
              results[source.sourceId] = source
            }
            return {
              ...state,
              usageQueries: {
                ...state.usageQueries,
                [partitionKey]: {
                  ...partition,
                  results,
                  generatedAt: Math.max(partition.generatedAt ?? 0, result.generatedAt),
                  error: current ? null : partition.error,
                },
              },
            }
          })
        }
        finishOperation(active, current ? 'success' : 'stale', null)
        return result
      })
      .catch((error: unknown) => {
        const message = safeMessage(error, USAGE_QUERY_FALLBACK)
        const current = isLatestForRequest()
        if (!disposed && current) {
          commit((state) => {
            const partition = state.usageQueries[partitionKey] ?? emptyPartition(range, timeZone)
            return {
              ...state,
              usageQueries: {
                ...state.usageQueries,
                [partitionKey]: { ...partition, error: message },
              },
            }
          })
        }
        finishOperation(active, current ? 'failure' : 'stale', errorCategoryOf(error))
        throw new ProviderOperationFailure(active.id, 'usage.query', 'usage-query', message)
      })
      .finally(() => {
        pendingQueries.delete(requestKey)
        for (const [sourceId, started] of startedSequences) {
          const key = `${partitionKey}\u0000${sourceId}`
          if (refreshingSources.get(key) === started) refreshingSources.delete(key)
        }
        partitionInFlight.set(
          partitionKey,
          Math.max(0, (partitionInFlight.get(partitionKey) ?? 1) - 1),
        )
        if (!disposed) {
          commit((state) => {
            const partition = state.usageQueries[partitionKey]
            if (!partition) return state
            return {
              ...state,
              usageQueries: {
                ...state.usageQueries,
                [partitionKey]: {
                  ...partition,
                  refreshingSourceIds: refreshingIdsFor(partitionKey),
                },
              },
            }
          })
        }
        evictIdlePartitions()
      })
    pendingQueries.set(requestKey, pending)
    return pending
  }

  const regionWarning = (region: ProviderOperationRegion): string | null => {
    const state = store.getState()
    if (region === 'usage-sources') return state.usageSources.error
    return state.configuration.error ?? state.configuration.configurationError
  }

  /** 写入失败向调用方抛出；写入成功但刷新失败时返回 syncWarning，调用方不得提示保存失败。 */
  const runWrite = async <T>(
    operation: string,
    region: ProviderOperationRegion,
    write: () => Promise<T>,
    afterWrite: () => Promise<void>,
  ): Promise<ProviderOperationOutcome<T>> => {
    ensureEventSubscription()
    const active = beginOperation(operation, 'user', region)
    // 写入前已存在的区域错误不属于本次同步失败，避免误报。
    const baselineWarning = regionWarning(region)
    let value: T
    try {
      value = await write()
    } catch (error) {
      const message = safeMessage(
        error,
        region === 'usage-sources' ? USAGE_SOURCES_FALLBACK : CONFIGURATION_FALLBACK,
      )
      const failure = regionError(active, message)
      commit((state) =>
        region === 'usage-sources'
          ? { ...state, usageSources: { ...state.usageSources, lastError: failure } }
          : { ...state, configuration: { ...state.configuration, lastError: failure } },
      )
      finishOperation(active, 'failure', errorCategoryOf(error))
      throw new ProviderOperationFailure(active.id, operation, region, message)
    }
    await afterWrite()
    const currentWarning = regionWarning(region)
    const syncWarning =
      currentWarning !== null && currentWarning !== baselineWarning ? currentWarning : null
    finishOperation(active, syncWarning ? 'partial' : 'success', syncWarning ? 'sync-failed' : null)
    return { value, syncWarning, operationId: active.id }
  }

  const providerIdOfCredential = (credentialId: string): string | undefined => {
    const key = store.getState().configuration.apiKeys.find((item) => item.id === credentialId)
    return key === undefined ? undefined : String(key.providerId)
  }

  const handleEvents = async (events: readonly EventEnvelope[]): Promise<void> => {
    let configurationEventId: string | null = null
    let sourcesEventId: string | null = null
    let credentialProviderId: string | null = null
    let credentialChanged = false
    for (const event of events) {
      if (event.type === 'catalog/updated') {
        configurationEventId = event.eventId
      } else if (event.type === 'provider/credential/updated') {
        configurationEventId = event.eventId
        credentialChanged = true
        credentialProviderId = String(event.payload.providerId)
      } else if (event.type === 'usage/source/updated') {
        sourcesEventId = event.eventId
      }
    }
    if (credentialChanged) invalidateProviderCredentialUsage(credentialProviderId ?? undefined)
    const tasks: Promise<void>[] = []
    if (configurationEventId) tasks.push(readConfiguration('event', configurationEventId, false))
    if (sourcesEventId || credentialChanged) {
      tasks.push(readUsageSources('event', sourcesEventId ?? configurationEventId, false))
    }
    await Promise.all(tasks)
  }

  const ensureEventSubscription = (): void => {
    if (disposed || eventSubscription !== null) return
    eventSubscription = client.subscribeAgentEventEnvelopes(
      { liveEventTypes: AGENT_LIVE_EVENT_FILTERS.provider },
      (events) => {
        if (disposed) return
        // 事件回调消费异常，避免未处理的 Promise 拒绝。
        void handleEvents(events).catch(() => undefined)
      },
    )
  }

  return {
    ...store,
    ensureLoaded: () => {
      ensureEventSubscription()
      const state = store.getState()
      const tasks: Promise<void>[] = []
      if (!state.configuration.loaded) tasks.push(readConfiguration('initialization', null, true))
      if (!state.usageSources.loaded) tasks.push(readUsageSources('initialization', null, true))
      return Promise.all(tasks).then(() => undefined)
    },
    refresh: () => {
      ensureEventSubscription()
      return readConfiguration('user', null, true).then(() => store.getState().configuration)
    },
    refreshSources: () => {
      ensureEventSubscription()
      return readUsageSources('user', null, true).then(() => store.getState().usageSources)
    },
    refreshAllProviderData: (providerId) => {
      ensureEventSubscription()
      if (catalogRefresh) return catalogRefresh
      const active = beginOperation('catalog.refresh', 'user', 'configuration')
      catalogRefresh = (async () => {
        try {
          await client.refreshModelProviders(providerId)
        } catch (error) {
          finishOperation(active, 'failure', errorCategoryOf(error))
          throw new ProviderOperationFailure(
            active.id,
            'catalog.refresh',
            'configuration',
            safeMessage(error, CONFIGURATION_FALLBACK),
          )
        }
        await Promise.all([
          readConfiguration('user', null, false),
          readUsageSources('user', null, false),
        ])
        const state = store.getState()
        const failed = Boolean(state.configuration.error || state.usageSources.error)
        finishOperation(active, failed ? 'partial' : 'success', failed ? 'sync-failed' : null)
      })().finally(() => {
        catalogRefresh = null
      })
      return catalogRefresh
    },
    querySources,
    connectUsageCredential: (input) =>
      runWrite(
        'usage.connect',
        'usage-sources',
        () => client.connectUsageCredential(input),
        async () => {
          invalidateUsageSources([input.sourceId])
          await readUsageSources('post-write', null, false)
        },
      ),
    disconnectUsageCredential: (input) =>
      runWrite(
        'usage.disconnect',
        'usage-sources',
        () => client.disconnectUsageCredential(input),
        async () => {
          invalidateUsageSources([input.sourceId])
          await readUsageSources('post-write', null, false)
        },
      ),
    createApiKey: (input) =>
      runWrite(
        'api-key.create',
        'configuration',
        () => client.createApiKey(input),
        async () => {
          invalidateProviderCredentialUsage(String(input.providerId))
          await readConfiguration('post-write', null, false)
        },
      ),
    updateApiKey: (input) => {
      const providerId = providerIdOfCredential(input.credentialId)
      return runWrite(
        'api-key.update',
        'configuration',
        () => client.updateApiKey(input),
        async () => {
          invalidateProviderCredentialUsage(providerId)
          await readConfiguration('post-write', null, false)
        },
      )
    },
    testApiKey: (credentialId) =>
      runWrite(
        'api-key.test',
        'configuration',
        () => client.testApiKey(credentialId),
        () => readConfiguration('post-write', null, false),
      ),
    setActiveCredential: (...input) =>
      runWrite(
        'api-key.set-active',
        'configuration',
        () => client.setActiveProviderCredential(...input),
        async () => {
          invalidateProviderCredentialUsage(String(input[0]))
          await readConfiguration('post-write', null, false)
        },
      ),
    setCredentialEnabled: (...input) => {
      const providerId = providerIdOfCredential(input[0])
      return runWrite(
        'api-key.set-enabled',
        'configuration',
        () => client.setProviderCredentialEnabled(...input),
        async () => {
          invalidateProviderCredentialUsage(providerId)
          await readConfiguration('post-write', null, false)
        },
      )
    },
    reorderApiKeys: (...input) =>
      runWrite(
        'api-key.reorder',
        'configuration',
        () => client.reorderApiKeys(...input),
        () => readConfiguration('post-write', null, false),
      ),
    deleteCredential: (credentialId) => {
      const providerId = providerIdOfCredential(credentialId)
      return runWrite(
        'credential.delete',
        'configuration',
        () => client.deleteProviderCredential(credentialId),
        async () => {
          invalidateProviderCredentialUsage(providerId)
          await readConfiguration('post-write', null, false)
        },
      )
    },
    dispose() {
      if (disposed) return
      disposed = true
      eventSubscription?.()
      eventSubscription = null
    },
    getDiagnostics: () => (DIAGNOSTICS_ENABLED ? [...diagnostics] : []),
  }
}

export const providerManagementStore = createProviderManagementStore(desktopClient)

if (import.meta.hot) {
  import.meta.hot.dispose(() => providerManagementStore.dispose())
}
