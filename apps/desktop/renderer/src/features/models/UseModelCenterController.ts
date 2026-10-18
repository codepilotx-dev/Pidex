import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopModelRef,
  DesktopProviderDefinition,
  ModelProviderID,
} from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { desktopProviderExecutionError } from '../../services/desktop-client/ProviderAdapters.js'
import { withModelCatalogLoading } from '../../hooks/UseModelCatalogLoading.js'
import { fullErrorMessage } from '../../utils/Errors.js'
import {
  providerManagementStore,
  useProviderManagementSnapshot,
} from '../provider-management/index.js'

type Options = {
  onInitialProviderState: (state: DesktopModelProviderState) => void
  onError: (message: string) => void
  onNotice: (message: string) => void
}

export type ModelTestStatus =
  | { state: 'testing' }
  | { state: 'reachable'; latencyMs: number; api?: string }
  | { state: 'failed'; message: string; api?: string; category?: string }

/** 批量模型测试在客户端保持与 Agent 健康批次一致的 4 路并发。 */
const MODEL_TEST_CONCURRENCY = 4

export type ModelCenterInitialLoadState = 'loading' | 'ready' | 'error'

export function useModelCenterController({ onInitialProviderState, onError, onNotice }: Options) {
  const snapshot = useProviderManagementSnapshot()
  const handlers = useRef({ onInitialProviderState, onError, onNotice })
  handlers.current = { onInitialProviderState, onError, onNotice }
  const initialStateApplied = useRef(false)
  const pendingProviders = useRef(new Set<string>())
  const [busyProviderIds, setBusyProviderIds] = useState<readonly string[]>([])
  const [modelTestResults, setModelTestResults] = useState<Record<string, ModelTestStatus>>({})
  const [refreshingProviderData, setRefreshingProviderData] = useState(false)
  const refreshing = useRef(false)

  useEffect(() => {
    if (!initialStateApplied.current && snapshot.currentProviderState) {
      initialStateApplied.current = true
      handlers.current.onInitialProviderState(snapshot.currentProviderState)
    }
  }, [snapshot.currentProviderState])

  useEffect(() => {
    if (snapshot.error) handlers.current.onError(snapshot.error)
  }, [snapshot.error])

  const setPending = (providerId: string, pending: boolean) => {
    if (pending) pendingProviders.current.add(providerId)
    else pendingProviders.current.delete(providerId)
    setBusyProviderIds([...pendingProviders.current])
  }

  const runModelTest = async (providerId: ModelProviderID, modelId: string, variant?: string) => {
    const key = `${providerId}/${modelId}`
    setModelTestResults((results) => ({ ...results, [key]: { state: 'testing' } }))
    let status: ModelTestStatus
    try {
      const result = await desktopClient.testModelProvider(providerId, {
        providerID: providerId,
        id: modelId,
        ...(variant ? { variant } : {}),
      } as DesktopModelRef)
      status =
        result.status === 'reachable'
          ? {
              state: 'reachable',
              latencyMs: result.latencyMs ?? 0,
              ...(result.api ? { api: result.api } : {}),
            }
          : {
              state: 'failed',
              message: result.message ?? '连接测试失败',
              ...(result.api ? { api: result.api } : {}),
              ...(result.category ? { category: result.category } : {}),
            }
    } catch (error) {
      status = { state: 'failed', message: fullErrorMessage(error) }
    }
    setModelTestResults((results) => ({ ...results, [key]: status }))
    return status
  }

  async function testModels(
    provider: DesktopModelProviderSummary,
    modelIds: readonly string[],
    variant?: string,
  ) {
    if (pendingProviders.current.has(provider.providerID) || modelIds.length === 0) return
    const error = desktopProviderExecutionError(provider)
    if (error) {
      handlers.current.onError(error)
      return
    }
    setPending(provider.providerID, true)
    try {
      const results: ModelTestStatus[] = new Array(modelIds.length)
      let nextIndex = 0
      const worker = async (): Promise<void> => {
        while (nextIndex < modelIds.length) {
          const index = nextIndex
          nextIndex += 1
          results[index] = await runModelTest(provider.providerID, modelIds[index]!, variant)
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(MODEL_TEST_CONCURRENCY, modelIds.length) }, () => worker()),
      )
      const failures = results.filter((result) => result.state === 'failed').length
      if (modelIds.length === 1) {
        const result = results[0]
        if (result?.state === 'failed')
          handlers.current.onError(`模型“${modelIds[0]}”测试失败：${result.message}`)
        else if (result?.state === 'reachable')
          handlers.current.onNotice(
            `模型“${modelIds[0]}”测试通过（响应耗时 ${result.latencyMs} ms${result.api ? `，协议 ${result.api}` : ''}）。`,
          )
      } else {
        handlers.current.onNotice(
          `${provider.displayName}：${modelIds.length} 个模型测试完成，${failures} 个失败。`,
        )
      }
    } finally {
      setPending(provider.providerID, false)
    }
  }

  async function fetchModels(provider: DesktopModelProviderSummary) {
    if (pendingProviders.current.has(provider.providerID)) return
    if (provider.availability?.status === 'unavailable') return
    setPending(provider.providerID, true)
    try {
      const result = await withModelCatalogLoading(() =>
        providerManagementStore.refreshAllProviderData(provider.providerID),
      )
      if (result.error) handlers.current.onError(`模型目录刷新异常：${result.error}`)
      else {
        const catalog = await loadProviderModels(provider.providerID)
        handlers.current.onNotice(`模型目录已刷新，共 ${catalog.models.length} 个可用模型。`)
      }
    } catch (error) {
      handlers.current.onError(fullErrorMessage(error))
    } finally {
      setPending(provider.providerID, false)
    }
  }

  const loadProviderModels = useCallback(async (providerID: ModelProviderID) => {
    const catalog = await desktopClient.fetchProviderModels({ providerID, all: true })
    await providerManagementStore.refresh()
    return catalog
  }, [])

  async function refreshProviderData() {
    if (refreshing.current) return
    refreshing.current = true
    setRefreshingProviderData(true)
    try {
      const result = await providerManagementStore.refreshAllProviderData()
      if (!result.error) handlers.current.onNotice('供应商目录已从 Pi / models.dev 更新。')
    } catch (error) {
      handlers.current.onError(fullErrorMessage(error))
    } finally {
      refreshing.current = false
      setRefreshingProviderData(false)
    }
  }

  const saveProviderDefinition = useCallback(
    async (definition: DesktopProviderDefinition, providerId?: ModelProviderID) => {
      if (providerId) await desktopClient.updateProvider(providerId, definition)
      else if (definition.kind === 'custom') await desktopClient.createProvider(definition)
      if (providerId) {
        const refreshed = await providerManagementStore.refresh()
        if (refreshed.configurationError) throw new Error(refreshed.configurationError)
      }
    },
    [],
  )

  const deleteProvider = useCallback(async (providerId: ModelProviderID) => {
    await desktopClient.deleteProvider(providerId)
    await providerManagementStore.refresh()
  }, [])

  async function readSavedProvider(providerId: string) {
    const result = await providerManagementStore.refresh()
    if (result.configurationError) throw new Error(result.configurationError)
    const saved = result.providers.find((provider) => provider.providerID === providerId)
    if (!saved) throw new Error('供应商已保存，但刷新结果中没有找到该供应商，请重试。')
    return saved
  }

  const initialLoadState: ModelCenterInitialLoadState = !snapshot.loaded
    ? 'loading'
    : snapshot.error && snapshot.providers.length === 0
      ? 'error'
      : 'ready'

  return {
    initialLoadState,
    providers: snapshot.providers,
    providerState: snapshot.currentProviderState,
    apiKeys: snapshot.apiKeys,
    snapshot,
    busyProviderIds,
    modelTestResults,
    refreshingProviderData,
    testModels,
    fetchModels,
    loadProviderModels,
    refreshProviderData,
    saveProviderDefinition,
    deleteProvider,
    readSavedProvider,
  }
}
