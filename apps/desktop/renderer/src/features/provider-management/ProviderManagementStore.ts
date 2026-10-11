import type { RpcParams, RpcResult } from '@pidex/agent-protocol'
import type { DesktopClient } from '../../services/desktop-client/index.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { AGENT_LIVE_EVENT_FILTERS } from '../../services/desktop-client/EventSubscriptionFilters.js'
import type { DesktopApiKeySummary, DesktopProviderCredential } from '../../../shared/Types.js'
import type {
  ProviderManagementSnapshot,
  ProviderUsageQueryParams,
  ProviderUsageQueryResult,
} from './Types.js'
const errorMessage = (error: unknown): string =>
  rawErrorMessage(error).trim() || '供应商连接状态暂时无法加载。'
import { errorMessageOf as rawErrorMessage } from '@pidex/shared/errors'

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

export type ProviderManagementStore = {
  getSnapshot(): ProviderManagementSnapshot
  subscribe(listener: () => void): () => void
  ensureLoaded(): Promise<ProviderManagementSnapshot>
  refresh(): Promise<ProviderManagementSnapshot>
  refreshAllProviderData(): Promise<ProviderManagementSnapshot>
  refreshConnections(): Promise<ProviderManagementSnapshot>
  refreshSources(): Promise<RpcResult<'usage/source/list'>>
  querySources(params: ProviderUsageQueryParams): Promise<ProviderUsageQueryResult>
  connectUsageCredential(
    input: Parameters<ProviderManagementClient['connectUsageCredential']>[0],
  ): ReturnType<ProviderManagementClient['connectUsageCredential']>
  disconnectUsageCredential(
    input: Parameters<ProviderManagementClient['disconnectUsageCredential']>[0],
  ): ReturnType<ProviderManagementClient['disconnectUsageCredential']>
  createApiKey(
    input: Parameters<ProviderManagementClient['createApiKey']>[0],
  ): ReturnType<ProviderManagementClient['createApiKey']>
  updateApiKey(
    input: Parameters<ProviderManagementClient['updateApiKey']>[0],
  ): ReturnType<ProviderManagementClient['updateApiKey']>
  testApiKey(
    credentialId: Parameters<ProviderManagementClient['testApiKey']>[0],
  ): ReturnType<ProviderManagementClient['testApiKey']>
  setActiveCredential(
    ...input: Parameters<ProviderManagementClient['setActiveProviderCredential']>
  ): ReturnType<ProviderManagementClient['setActiveProviderCredential']>
  setCredentialEnabled(
    ...input: Parameters<ProviderManagementClient['setProviderCredentialEnabled']>
  ): ReturnType<ProviderManagementClient['setProviderCredentialEnabled']>
  reorderApiKeys(
    ...input: Parameters<ProviderManagementClient['reorderApiKeys']>
  ): ReturnType<ProviderManagementClient['reorderApiKeys']>
  deleteCredential(
    credentialId: Parameters<ProviderManagementClient['deleteProviderCredential']>[0],
  ): ReturnType<ProviderManagementClient['deleteProviderCredential']>
  invalidate(): void
}

const CONFIGURATION_ERROR_MESSAGE =
  '本地 Agent 的供应商配置暂时无法读取，请确认 Agent 已启动后重试。'

const INITIAL_SNAPSHOT: ProviderManagementSnapshot = {
  loaded: false,
  loading: false,
  refreshingSources: false,
  refreshingSourceIds: [],
  error: null,
  configurationError: null,
  providers: [],
  currentProviderState: null,
  credentials: [],
  apiKeys: [],
  usageSources: [],
  usageResults: [],
  usageGeneratedAt: null,
  usageRange: null,
  usageTimeZone: null,
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

const fulfilledValue = <T>(result: PromiseSettledResult<T>): T => {
  if (result.status === 'rejected') throw result.reason
  return result.value
}

const mergeUsageResults = (
  current: ProviderManagementSnapshot['usageResults'],
  next: ProviderUsageQueryResult['sources'],
) => {
  const merged = new Map(current.map((source) => [source.sourceId, source]))
  for (const source of next) merged.set(source.sourceId, source)
  return [...merged.values()]
}

const usageConnectionIdentity = (
  connection: ProviderManagementSnapshot['usageSources'][number]['connection'],
): string =>
  [connection.kind, connection.credentialId ?? '', connection.maskedValue ?? ''].join('\u0000')

const reconcileUsageResults = (
  current: ProviderManagementSnapshot['usageResults'],
  previousSources: ProviderManagementSnapshot['usageSources'],
  nextSources: ProviderManagementSnapshot['usageSources'],
) => {
  const previousById = new Map(previousSources.map((source) => [source.sourceId, source]))
  const nextById = new Map(nextSources.map((source) => [source.sourceId, source]))
  return current.filter((result) => {
    const next = nextById.get(result.sourceId)
    if (!next || next.connection.kind === 'none') return false
    const previous = previousById.get(result.sourceId)
    return (
      previous === undefined ||
      usageConnectionIdentity(previous.connection) === usageConnectionIdentity(next.connection)
    )
  })
}

export function createProviderManagementStore(
  client: ProviderManagementClient,
): ProviderManagementStore {
  let snapshot = INITIAL_SNAPSHOT
  let loadRequest: Promise<ProviderManagementSnapshot> | null = null
  let eventSubscription: (() => void) | null = null
  let queryContextKey: string | null = null
  let queryEpoch = 0
  const pendingQueriesByEpoch = new Map<number, number>()
  const activeRefreshingSourceCounts = new Map<string, number>()
  const listeners = new Set<() => void>()

  const update = (change: Partial<ProviderManagementSnapshot>): ProviderManagementSnapshot => {
    snapshot = { ...snapshot, ...change }
    for (const listener of listeners) listener()
    return snapshot
  }

  const refresh = (): Promise<ProviderManagementSnapshot> => {
    if (loadRequest) return loadRequest
    update({ loading: true, error: null, configurationError: null })
    const pending = Promise.allSettled([
      client.listModelProviders(),
      client.getModelProviderState(),
      client.listProviderCredentials(),
      client.listUsageSources(),
    ])
      .then((results) => {
        const errors = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => errorMessage(result.reason))
        const configurationFailed =
          results[0]?.status === 'rejected' || results[1]?.status === 'rejected'
        const nextUsageSources =
          results[3]?.status === 'fulfilled' ? [...results[3].value.sources] : snapshot.usageSources
        const credentials =
          results[2]?.status === 'fulfilled' ? [...results[2].value] : snapshot.credentials
        return update({
          loaded: true,
          loading: false,
          error: errors.length > 0 ? [...new Set(errors)].join('；') : null,
          // 目录或 Provider 状态读取失败时，stale 的 modelConfigured 不再可信。
          ...(configurationFailed
            ? { configurationError: CONFIGURATION_ERROR_MESSAGE, currentProviderState: null }
            : { configurationError: null }),
          ...(results[0]?.status === 'fulfilled' ? { providers: [...results[0].value] } : {}),
          ...(results[1]?.status === 'fulfilled' ? { currentProviderState: results[1].value } : {}),
          ...(results[2]?.status === 'fulfilled'
            ? {
                credentials,
                apiKeys: credentials
                  .filter((credential) => credential.kind === 'api-key')
                  .map(providerCredentialToApiKey),
              }
            : {}),
          ...(results[3]?.status === 'fulfilled'
            ? {
                usageSources: nextUsageSources,
                usageResults: reconcileUsageResults(
                  snapshot.usageResults,
                  snapshot.usageSources,
                  nextUsageSources,
                ),
              }
            : {}),
        })
      })
      .finally(() => {
        if (loadRequest === pending) loadRequest = null
      })
    loadRequest = pending
    return pending
  }

  const refreshAllProviderData = async (): Promise<ProviderManagementSnapshot> => {
    update({ loading: true })
    try {
      await client.refreshModelProviders()
      const results = await Promise.allSettled([
        client.listModelProviders(),
        client.getModelProviderState(),
        client.listProviderCredentials(),
        client.listUsageSources(),
      ])
      const providers = fulfilledValue(results[0])
      const currentProviderState = fulfilledValue(results[1])
      const credentialsResult = fulfilledValue(results[2])
      const usageSourceResult = fulfilledValue(results[3])
      const credentials = [...credentialsResult]
      const usageSources = [...usageSourceResult.sources]
      return update({
        loaded: true,
        loading: false,
        error: null,
        configurationError: null,
        providers: [...providers],
        currentProviderState,
        credentials,
        apiKeys: credentials
          .filter((credential) => credential.kind === 'api-key')
          .map(providerCredentialToApiKey),
        usageSources,
        usageResults: reconcileUsageResults(
          snapshot.usageResults,
          snapshot.usageSources,
          usageSources,
        ),
      })
    } catch (error) {
      update({ loading: false })
      throw error
    }
  }

  const refreshSources = async (): Promise<RpcResult<'usage/source/list'>> => {
    update({ refreshingSources: true, error: null })
    try {
      const result = await client.listUsageSources()
      const nextUsageSources = [...result.sources]
      update({
        loaded: true,
        refreshingSources: false,
        usageSources: nextUsageSources,
        usageResults: reconcileUsageResults(
          snapshot.usageResults,
          snapshot.usageSources,
          nextUsageSources,
        ),
      })
      return result
    } catch (error) {
      update({ refreshingSources: false, error: errorMessage(error) })
      throw error
    }
  }

  const refreshConnections = async (): Promise<ProviderManagementSnapshot> => {
    update({ refreshingSources: true, error: null, configurationError: null })
    const results = await Promise.allSettled([
      client.listProviderCredentials(),
      client.listUsageSources(),
      client.getModelProviderState(),
    ])
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => errorMessage(result.reason))
    const nextUsageSources =
      results[1]?.status === 'fulfilled' ? [...results[1].value.sources] : snapshot.usageSources
    const credentials =
      results[0]?.status === 'fulfilled' ? [...results[0].value] : snapshot.credentials
    const configurationFailed = results[2]?.status === 'rejected'
    return update({
      loaded: true,
      refreshingSources: false,
      error: errors.length > 0 ? [...new Set(errors)].join('；') : null,
      ...(configurationFailed
        ? { configurationError: CONFIGURATION_ERROR_MESSAGE, currentProviderState: null }
        : { configurationError: null }),
      ...(results[0]?.status === 'fulfilled'
        ? {
            credentials,
            apiKeys: credentials
              .filter((credential) => credential.kind === 'api-key')
              .map(providerCredentialToApiKey),
          }
        : {}),
      ...(results[1]?.status === 'fulfilled'
        ? {
            usageSources: nextUsageSources,
            usageResults: reconcileUsageResults(
              snapshot.usageResults,
              snapshot.usageSources,
              nextUsageSources,
            ),
          }
        : {}),
      ...(results[2]?.status === 'fulfilled' ? { currentProviderState: results[2].value } : {}),
    })
  }

  // 目录、凭据和模型状态的一次性合并刷新：事件与凭据变更统一走这里，
  // 避免 refreshCatalog() 与 refreshConnections() 并发、重复请求及后返回覆盖新状态。
  const refreshConfiguration = async (): Promise<ProviderManagementSnapshot> => {
    update({ refreshingSources: true, configurationError: null })
    const results = await Promise.allSettled([
      client.listModelProviders(),
      client.listProviderCredentials(),
      client.getModelProviderState(),
    ])
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => errorMessage(result.reason))
    const configurationFailed =
      results[0]?.status === 'rejected' || results[2]?.status === 'rejected'
    const credentials =
      results[1]?.status === 'fulfilled' ? [...results[1].value] : snapshot.credentials
    return update({
      refreshingSources: false,
      error: errors.length > 0 ? [...new Set(errors)].join('；') : null,
      ...(configurationFailed
        ? { configurationError: CONFIGURATION_ERROR_MESSAGE, currentProviderState: null }
        : { configurationError: null }),
      ...(results[0]?.status === 'fulfilled' ? { providers: [...results[0].value] } : {}),
      ...(results[1]?.status === 'fulfilled'
        ? {
            credentials,
            apiKeys: credentials
              .filter((credential) => credential.kind === 'api-key')
              .map(providerCredentialToApiKey),
          }
        : {}),
      ...(results[2]?.status === 'fulfilled' ? { currentProviderState: results[2].value } : {}),
    })
  }

  const refreshApiKeys = async (): Promise<void> => {
    try {
      const credentials = [...(await client.listProviderCredentials())]
      update({
        credentials,
        apiKeys: credentials
          .filter((credential) => credential.kind === 'api-key')
          .map(providerCredentialToApiKey),
      })
    } catch (error) {
      update({ error: errorMessage(error) })
    }
  }

  const invalidateProviderCredentialResults = (providerId: string | undefined) => {
    const sourceIds = new Set(
      snapshot.usageSources
        .filter(
          (source) =>
            source.connectionMethod.kind === 'provider-credential' &&
            (providerId === undefined ||
              source.providerIds.some((id) => String(id) === providerId)),
        )
        .map((source) => source.sourceId),
    )
    update({
      usageResults: snapshot.usageResults.filter((result) => !sourceIds.has(result.sourceId)),
    })
  }

  const ensureEventSubscription = () => {
    if (eventSubscription !== null) return
    eventSubscription = client.subscribeAgentEventEnvelopes(
      {
        liveEventTypes: AGENT_LIVE_EVENT_FILTERS.provider,
      },
      async (events) => {
        let refreshConfigurationRequested = false
        let refreshSourcesRequested = false
        for (const event of events) {
          if (event.type === 'catalog/updated' || event.type === 'provider/credential/updated') {
            refreshConfigurationRequested = true
            continue
          }
          if (event.type === 'usage/source/updated') {
            refreshSourcesRequested = true
          }
        }
        await Promise.all([
          ...(refreshConfigurationRequested ? [refreshConfiguration()] : []),
          ...(refreshSourcesRequested ? [refreshSources()] : []),
        ])
      },
    )
  }

  const querySources = async (
    params: RpcParams<'usage/provider/query'>,
  ): Promise<RpcResult<'usage/provider/query'>> => {
    const contextKey = `${params.timeZone}`
    if (queryContextKey !== contextKey) {
      queryContextKey = contextKey
      queryEpoch += 1
    }
    const requestEpoch = queryEpoch
    pendingQueriesByEpoch.set(requestEpoch, (pendingQueriesByEpoch.get(requestEpoch) ?? 0) + 1)
    for (const sourceId of params.sourceIds) {
      activeRefreshingSourceCounts.set(
        sourceId,
        (activeRefreshingSourceCounts.get(sourceId) ?? 0) + 1,
      )
    }
    update({
      refreshingSources: true,
      refreshingSourceIds: [...activeRefreshingSourceCounts.keys()],
      error: null,
    })
    try {
      const result = await client.queryProviderUsage(params)
      if (requestEpoch !== queryEpoch) return result
      update({
        usageResults: mergeUsageResults(snapshot.usageResults, result.sources),
        usageGeneratedAt: result.generatedAt,
        usageRange: result.range,
        usageTimeZone: result.timeZone,
      })
      return result
    } catch (error) {
      if (requestEpoch === queryEpoch) update({ error: errorMessage(error) })
      throw error
    } finally {
      for (const sourceId of params.sourceIds) {
        const count = (activeRefreshingSourceCounts.get(sourceId) ?? 1) - 1
        if (count <= 0) {
          activeRefreshingSourceCounts.delete(sourceId)
        } else {
          activeRefreshingSourceCounts.set(sourceId, count)
        }
      }
      const remaining = (pendingQueriesByEpoch.get(requestEpoch) ?? 1) - 1
      if (remaining > 0) {
        pendingQueriesByEpoch.set(requestEpoch, remaining)
      } else {
        pendingQueriesByEpoch.delete(requestEpoch)
      }
      if (requestEpoch === queryEpoch) {
        update({
          refreshingSources: remaining > 0 || activeRefreshingSourceCounts.size > 0,
          refreshingSourceIds: [...activeRefreshingSourceCounts.keys()],
        })
      }
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      ensureEventSubscription()
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    ensureLoaded: () => {
      ensureEventSubscription()
      return snapshot.loaded ? Promise.resolve(snapshot) : (loadRequest ?? refresh())
    },
    refresh,
    refreshAllProviderData,
    refreshConnections,
    refreshSources,
    querySources,
    async connectUsageCredential(input) {
      const result = await client.connectUsageCredential(input)
      update({
        usageSources: snapshot.usageSources.map((source) =>
          source.sourceId === result.sourceId
            ? { ...source, connection: result.connection }
            : source,
        ),
        usageResults: snapshot.usageResults.filter((source) => source.sourceId !== result.sourceId),
      })
      return result
    },
    async disconnectUsageCredential(input) {
      const result = await client.disconnectUsageCredential(input)
      update({
        usageSources: snapshot.usageSources.map((source) =>
          source.sourceId === result.sourceId
            ? {
                ...source,
                connection: {
                  kind: 'none' as const,
                  disconnectible: false,
                },
              }
            : source,
        ),
        usageResults: snapshot.usageResults.filter((source) => source.sourceId !== result.sourceId),
      })
      return result
    },
    async createApiKey(input) {
      const result = await client.createApiKey(input)
      invalidateProviderCredentialResults(String(input.providerId))
      await refreshConfiguration()
      return result
    },
    async updateApiKey(input) {
      const providerId = snapshot.apiKeys.find((key) => key.id === input.credentialId)?.providerId
      const result = await client.updateApiKey(input)
      invalidateProviderCredentialResults(providerId === undefined ? undefined : String(providerId))
      await refreshConfiguration()
      return result
    },
    async testApiKey(credentialId) {
      const result = await client.testApiKey(credentialId)
      await refreshApiKeys()
      return result
    },
    async setActiveCredential(...input) {
      const result = await client.setActiveProviderCredential(...input)
      invalidateProviderCredentialResults(String(input[0]))
      await refreshConfiguration()
      return result
    },
    async setCredentialEnabled(...input) {
      const providerId = snapshot.apiKeys.find((key) => key.id === input[0])?.providerId
      const result = await client.setProviderCredentialEnabled(...input)
      invalidateProviderCredentialResults(providerId === undefined ? undefined : String(providerId))
      await refreshConfiguration()
      return result
    },
    async reorderApiKeys(...input) {
      const result = await client.reorderApiKeys(...input)
      await refreshApiKeys()
      return result
    },
    async deleteCredential(credentialId) {
      const providerId = snapshot.apiKeys.find((key) => key.id === credentialId)?.providerId
      const result = await client.deleteProviderCredential(credentialId)
      invalidateProviderCredentialResults(providerId === undefined ? undefined : String(providerId))
      await refreshConfiguration()
      return result
    },
    invalidate() {
      update({ loaded: false, error: null, configurationError: null })
    },
  }
}

export const providerManagementStore = createProviderManagementStore(desktopClient)
