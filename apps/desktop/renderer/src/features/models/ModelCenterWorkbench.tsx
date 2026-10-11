import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../components/ui/IconTokens.js'
import { desktopClient, desktopClipboard } from '../../services/desktop-client/index.js'
import {
  desktopProviderExecutionError,
  isExecutableDesktopProvider,
} from '../../services/desktop-client/ProviderAdapters.js'
import { withModelCatalogLoading } from '../../hooks/UseModelCatalogLoading.js'
import React, { useEffect, useMemo, useState } from 'react'
import type {
  DesktopApiKeySummary,
  DesktopModelMetadata,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopModelRef,
  ModelProviderID,
} from '../../../shared/Types.js'
import { useDesktopSettings } from '../settings/UseDesktopSettings.js'
import { fullErrorMessage } from '../../utils/Errors.js'
import { Cable, ChevronRight, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { SkeletonBlock, SkeletonRegion } from '../../components/ui/Skeleton.js'
import { useSearchParams } from 'react-router-dom'
import { ProviderCatalog, type ProviderCatalogItem } from './ProviderCatalog.js'
import { ProviderDetail } from './ProviderDetail.js'
import { useModelCenterController } from './UseModelCenterController.js'
import {
  getApiKeyDeleteConfirmation,
  parseModelCenterSearchParams,
  projectProviderDirectory,
  updateModelCenterSearchParams,
  type ProviderCatalogFilter,
} from './ModelCenterState.js'
import { WorkspaceHeaderItem } from '../layout/workspace-header/index.js'
import { ProviderConnectionDialog } from './provider-management/ProviderConnectionDialog.js'
import { ProviderEditorDialog } from './provider-management/ProviderEditorDialog.js'
import { ProviderConnectionSection } from './provider-management/ProviderConnectionSection.js'
import { ProviderModelsSection } from './provider-management/ProviderModelsSection.js'
import {
  canEditProviderConfig,
  deepSeekManagedProvider,
  deepSeekProtocolOf,
  deepSeekProtocolOption,
} from './provider-management/DeepseekProtocol.js'
import { ApiKeyEditorDialog, type ApiKeyEditorValue } from './ApiKeyEditorDialog.js'
import {
  providerManagementStore,
  selectConfiguredProviderGroups,
  type ConfiguredProviderGroup,
} from '../provider-management/index.js'

const NO_MODEL_OPTION = '__no_models_available__'

type Props = {
  onError: (message: string) => void
  onNotice: (message: string) => void
}

export function getProviderSelectionState(provider: DesktopModelProviderSummary | undefined): {
  model: string
} {
  return {
    model: provider?.defaultModels[0] ?? '',
  }
}

export function getProviderConnectionState({
  provider,
  model,
  providerModels,
}: {
  provider: DesktopModelProviderSummary | undefined
  model: string
  providerModels: string[]
}): { model: string } {
  const defaultSelection = getProviderSelectionState(provider)
  return {
    model: providerModels.includes(model) ? model : defaultSelection.model,
  }
}

export function ModelCenterWorkbench({ onError, onNotice }: Props): React.ReactNode {
  const settings = useDesktopSettings()
  const [searchParams, setSearchParams] = useSearchParams()
  const [providerID, setProviderID] = useState<ModelProviderID>(settings.providerID)
  const [model, setModel] = useState(settings.model)
  const [variant, setVariant] = useState('')
  const [, setModelError] = useState<string | null>(null)
  const [, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshingProviderData, setRefreshingProviderData] = useState(false)
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null)
  const [providerSearch, setProviderSearch] = useState('')
  const [catalogFilter, setCatalogFilter] = useState<ProviderCatalogFilter>('all')
  const [connectionDialogProviderId, setConnectionDialogProviderId] =
    useState<ModelProviderID | null>(null)
  const [providerEditorOpen, setProviderEditorOpen] = useState(false)
  const [deepSeekProtocolSupported, setDeepSeekProtocolSupported] = useState(false)
  const [providerEditorProviderId, setProviderEditorProviderId] = useState<ModelProviderID | null>(
    null,
  )

  useEffect(() => {
    let active = true
    void desktopClient
      .getRuntimeCapabilities()
      .then((capabilities) => {
        if (active) {
          setDeepSeekProtocolSupported(capabilities.includes('provider.deepseekProtocol.v1'))
        }
      })
      .catch(() => {
        if (active) setDeepSeekProtocolSupported(false)
      })
    return () => {
      active = false
    }
  }, [])

  // Key editing & deletion state
  const [editorProviderId, setEditorProviderId] = useState<ModelProviderID | null>(null)
  const [editingKey, setEditingKey] = useState<DesktopApiKeySummary | null>(null)
  const [deleteKey, setDeleteKey] = useState<DesktopApiKeySummary | null>(null)

  const controller = useModelCenterController({
    onInitialProviderState: (nextState) => applyProviderState(nextState),
    onError: (message) => {
      setModelError(message)
      onError(message)
    },
  })

  const {
    initialLoadState,
    providers,
    providerState,
    apiKeys,
    snapshot,
    setProviderState,
    refreshAllProviderData,
  } = controller

  const configuredGroups = useMemo(() => selectConfiguredProviderGroups(snapshot), [snapshot])
  const configuredProviderIds = useMemo(
    () => new Set(configuredGroups.map((group) => group.provider.providerID)),
    [configuredGroups],
  )
  const configuredGroupByProvider = useMemo(
    () => new Map(configuredGroups.map((group) => [group.provider.providerID, group])),
    [configuredGroups],
  )

  const routeState = useMemo(
    () =>
      parseModelCenterSearchParams(
        searchParams,
        providers.map((provider) => provider.providerID),
      ),
    [providers, searchParams],
  )

  const providerSection = routeState.section

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.providerID === providerID),
    [providerID, providers],
  )

  const selectedProviderState =
    providerState?.selectedProviderID === providerID ? providerState : null

  const providerModels = (
    selectedProviderState?.models ??
    selectedProvider?.defaultModels ??
    []
  ).filter((item) => item && item !== NO_MODEL_OPTION)

  const modelMetadata =
    selectedProviderState?.modelMetadata ?? selectedProvider?.modelMetadata ?? {}

  const providerApiKeys = useMemo(
    () =>
      apiKeys
        .filter((key) => key.providerId === providerID)
        .sort((left, right) => left.priority - right.priority),
    [apiKeys, providerID],
  )

  const providerDirectory = useMemo(
    () =>
      projectProviderDirectory(
        [...providers].sort((left, right) =>
          left.displayName.localeCompare(right.displayName, 'zh-CN', {
            numeric: true,
            sensitivity: 'base',
          }),
        ),
        {
          query: providerSearch,
          filter: catalogFilter,
          currentProviderId: providerState?.selectedProviderID,
          currentProviderState: providerState,
          apiKeys,
          credentials: snapshot.credentials,
        },
      ),
    [apiKeys, catalogFilter, providerSearch, providerState, providers, snapshot.credentials],
  )

  const providerCatalogItems = useMemo<ProviderCatalogItem[]>(
    () =>
      providerDirectory.map((item) => {
        const { connectionStatus, current, provider, sources, keyCount, hasOAuth, healthTone } =
          item
        const effectiveConnectionStatus =
          connectionStatus === 'unconfigured' && configuredProviderIds.has(provider.providerID)
            ? 'configured'
            : connectionStatus
        const displayedStatus = providerCatalogConnectionStatus(
          effectiveConnectionStatus,
          configuredGroupByProvider.get(provider.providerID),
        )
        const unavailableReason =
          provider.availability?.status === 'unavailable'
            ? providerAvailabilityLabel(provider.availability.reason)
            : null
        return {
          id: provider.providerID,
          name: provider.displayName,
          logoURL: provider.logoURL,
          source: sources
            .map((source) =>
              source === 'gateway' ? 'Gateway' : source === 'custom' ? '自定义' : 'Pi 内置',
            )
            .join(' + '),
          modelCount: provider.modelCount ?? provider.defaultModels.length,
          current,
          canAddConnection:
            unavailableReason === null && effectiveConnectionStatus === 'unconfigured',
          connectionDisabled: unavailableReason !== null,
          keyCount,
          hasOAuth,
          healthTone,
          status: unavailableReason
            ? { label: unavailableReason, tone: 'warning' }
            : provider.unresolvedMigrationIssues?.length
              ? { label: '需要人工修复', tone: 'danger' }
              : displayedStatus,
        }
      }),
    [configuredGroupByProvider, configuredProviderIds, providerDirectory],
  )

  useEffect(() => {
    if (providerID === providerState?.selectedProviderID) return
    const nextSelection = getProviderSelectionState(selectedProvider)
    setModel(nextSelection.model)
    setVariant('')
    setStatus(null)
    setModelError(null)
  }, [providerID, providerState, selectedProvider])

  useEffect(() => {
    if (providers.length === 0 || !routeState.providerId) return
    const requestedProvider = providers.find(
      (provider) => provider.providerID === routeState.providerId,
    )
    if (requestedProvider && requestedProvider.providerID !== providerID) {
      applyProviderSelection(requestedProvider.providerID, requestedProvider)
    }
  }, [providerID, providers, routeState.providerId])

  function updateLocation(
    patch: {
      provider?: string | null
      section?: 'connection' | 'models' | null
    },
    replace = false,
  ): void {
    setSearchParams(
      (current) => {
        return updateModelCenterSearchParams(current, {
          providerId: patch.provider,
          section: patch.section,
        })
      },
      { replace },
    )
  }

  function selectProvider(nextProviderID: ModelProviderID): void {
    const nextProvider = providers.find((provider) => provider.providerID === nextProviderID)
    applyProviderSelection(nextProviderID, nextProvider)
    updateLocation({ provider: nextProviderID, section: 'connection' })
  }

  function showProviderCatalog(): void {
    updateLocation({ provider: null, section: null })
  }

  function applyProviderSelection(
    nextProviderID: ModelProviderID,
    nextProvider: DesktopModelProviderSummary | undefined,
  ): void {
    const nextSelection = getProviderSelectionState(nextProvider)
    setProviderID(nextProviderID)
    setModel(nextSelection.model)
    setVariant('')
    setStatus(null)
    setModelError(null)
  }

  function applyProviderState(nextState: DesktopModelProviderState): void {
    const nextModel =
      nextState.model || nextState.models[0] || nextState.provider.defaultModels[0] || ''
    setProviderState(nextState)
    setProviderID(nextState.selectedProviderID)
    setModel(nextModel)
    setVariant(nextState.variant ?? '')
  }

  function applyFetchedModels(
    models: string[],
    error?: string,
    fetchedMetadata?: Record<string, DesktopModelMetadata>,
  ): void {
    const cleanModels = models.filter(Boolean)
    setProviderState((current) => {
      if (current && current.selectedProviderID === providerID) {
        return {
          ...current,
          models: cleanModels,
          modelMetadata: { ...current.modelMetadata, ...fetchedMetadata },
          error,
        }
      }
      if (!selectedProvider) return current
      return {
        selectedProviderID: providerID,
        provider: selectedProvider,
        model,
        apiKeyConfigured: false,
        apiKeySource: null,
        modelConfigured: false,
        configurationMessage: '未配置模型，请先在设置中配置模型。',
        models: cleanModels,
        modelMetadata: { ...modelMetadata, ...fetchedMetadata },
        error,
      }
    })
    if (!model && cleanModels[0]) setModel(cleanModels[0])
  }

  async function fetchModels(): Promise<void> {
    if (!selectedProvider || !isExecutableDesktopProvider(selectedProvider)) {
      onError('此 Provider 当前没有可执行模型，无法刷新目录。')
      return
    }
    setBusy(true)
    setModelError(null)
    onNotice('正在从供应商刷新模型目录...')
    try {
      const result = await withModelCatalogLoading(() =>
        desktopClient.fetchProviderModels({
          providerID,
        }),
      )
      applyFetchedModels(result.models, result.error, result.modelMetadata)
      if (result.error) {
        onError(`模型目录刷新异常：${result.error}`)
      } else {
        onNotice(`模型目录已同步，共加载 ${result.models.length} 个可用模型。`)
      }
    } catch (error) {
      showOperationError(error)
    } finally {
      setBusy(false)
    }
  }

  async function testConnection(): Promise<void> {
    const executionError = desktopProviderExecutionError(selectedProvider)
    if (executionError) {
      onError(executionError)
      return
    }
    setBusy(true)
    setModelError(null)
    onNotice('正在测试连接与鉴权有效性...')
    try {
      const testRef: DesktopModelRef | undefined = model
        ? ({
            providerID,
            id: model,
            ...(variant ? { variant } : {}),
          } as DesktopModelRef)
        : undefined
      const testResult = await desktopClient.testModelProvider(providerID, testRef)
      if (testResult.status === 'reachable') {
        onNotice(
          `“${selectedProvider?.displayName ?? providerID}”连接正常（响应延迟 ${testResult.latencyMs} ms）。`,
        )
      } else {
        const msg = testResult.message ?? '连接测试失败。'
        setModelError(msg)
        onError(`连接测试失败：${msg}`)
      }
    } catch (error) {
      showOperationError(error)
    } finally {
      setBusy(false)
    }
  }

  async function mutateKey(
    id: string,
    action: () => Promise<unknown>,
    successMessage: string,
  ): Promise<boolean> {
    setBusyKeyId(id)
    try {
      await action()
      onNotice(successMessage)
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      return true
    } catch (error) {
      onError(fullErrorMessage(error))
      return false
    } finally {
      setBusyKeyId(null)
    }
  }

  async function saveApiKeyEditor(value: ApiKeyEditorValue): Promise<boolean> {
    if (editingKey) {
      const replacement = value.key?.trim()
      return mutateKey(
        editingKey.id,
        () =>
          providerManagementStore.updateApiKey({
            credentialId: editingKey.id,
            ...(value.label !== editingKey.label ? { label: value.label } : {}),
            ...(replacement ? { key: replacement } : {}),
          }),
        replacement ? 'API Key 已更换，健康状态已重置。' : 'API Key 名称已更新。',
      )
    }
    if (!value.key) return false
    return mutateKey(
      'create',
      () =>
        providerManagementStore.createApiKey({
          providerId: value.providerId,
          label: value.label,
          key: value.key,
        }),
      'API Key 已安全保存。',
    )
  }

  async function moveApiKey(key: DesktopApiKeySummary, offset: -1 | 1): Promise<void> {
    const providerKeys = [...providerApiKeys]
    const index = providerKeys.findIndex((item) => item.id === key.id)
    const target = index + offset
    if (index < 0 || target < 0 || target >= providerKeys.length) return
    const [item] = providerKeys.splice(index, 1)
    if (!item) return
    providerKeys.splice(target, 0, item)
    await mutateKey(
      key.id,
      () =>
        providerManagementStore.reorderApiKeys(
          key.providerId,
          providerKeys.map((candidate) => candidate.id),
        ),
      'API Key 优先级顺序已更新。',
    )
  }

  async function copyApiKey(key: DesktopApiKeySummary): Promise<void> {
    setBusyKeyId(key.id)
    try {
      const result = await desktopClipboard.copyProviderApiKey(key.id)
      onNotice(
        `API Key 已复制到剪贴板，将在 ${Math.round(result.clearAfterMs / 1000)} 秒后自动清理。`,
      )
    } catch (error) {
      onError(fullErrorMessage(error))
    } finally {
      setBusyKeyId(null)
    }
  }

  async function testSingleApiKey(key: DesktopApiKeySummary): Promise<void> {
    setBusyKeyId(key.id)
    try {
      const result = await providerManagementStore.testApiKey(key.id)
      onNotice(
        result.message ?? (result.ok ? 'API Key 鉴权通过，测试成功。' : 'API Key 测试失败。'),
      )
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
    } catch (error) {
      onError(error instanceof Error ? error.message : 'API Key 测试失败，请稍后重试。')
    } finally {
      setBusyKeyId(null)
    }
  }

  async function createProviderConnection(value: ApiKeyEditorValue): Promise<boolean> {
    if (!value.key) return false
    setBusy(true)
    try {
      await providerManagementStore.createApiKey({
        providerId: value.providerId,
        label: value.label,
        key: value.key,
      })
      onNotice('供应商连接与凭据已保存。')
      setConnectionDialogProviderId(null)
      updateLocation({ provider: value.providerId, section: 'connection' })
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      return true
    } catch (error) {
      showOperationError(error)
      return false
    } finally {
      setBusy(false)
    }
  }

  function showOperationError(error: unknown): void {
    const message = fullErrorMessage(error)
    setModelError(message)
    onError(message)
  }

  async function refreshProviderData(): Promise<void> {
    if (refreshingProviderData) return
    setRefreshingProviderData(true)
    try {
      await refreshAllProviderData()
      onNotice('供应商与模型数据已刷新。')
    } catch (error) {
      showOperationError(error)
    } finally {
      setRefreshingProviderData(false)
    }
  }

  async function deleteCustomProvider(): Promise<void> {
    if (!selectedProvider || selectedProvider.providerKind !== 'custom') return
    if (
      !window.confirm(
        `确定删除自定义供应商“${selectedProvider.displayName}”？历史会话引用与已保存凭据将保留。`,
      )
    )
      return
    setBusy(true)
    try {
      await desktopClient.deleteProvider(selectedProvider.providerID)
      await providerManagementStore.refresh()
      showProviderCatalog()
      onNotice('自定义供应商已删除。')
    } catch (error) {
      showOperationError(error)
    } finally {
      setBusy(false)
    }
  }

  const showingProviderDetail = routeState.providerId !== null

  const showInitialSkeleton = initialLoadState === 'loading' && providers.length === 0

  const selectedConfiguredGroup = configuredGroups.find(
    (group) => group.provider.providerID === providerID,
  )

  const connectionDialogProvider = connectionDialogProviderId
    ? (providers.find((provider) => provider.providerID === connectionDialogProviderId) ?? null)
    : null

  const connectionDialogSources = snapshot.usageSources.filter((source) =>
    source.providerIds.some((pId) => String(pId) === String(connectionDialogProviderId)),
  )

  const editorProvider = editorProviderId
    ? snapshot.providers.find((p) => p.providerID === editorProviderId)
    : undefined

  const deleteConfirmation = deleteKey
    ? getApiKeyDeleteConfirmation(
        deleteKey,
        [...snapshot.apiKeys],
        snapshot.providers.find((p) => p.providerID === deleteKey.providerId)?.displayName,
      )
    : null

  const detailActions = selectedProvider ? (
    <>
      <Button
        color="secondary"
        disabled={refreshingProviderData}
        loading={refreshingProviderData}
        onClick={() => void refreshProviderData()}
        title="刷新供应商信息"
      >
        {!refreshingProviderData ? <RefreshCw size={APP_ICON_SIZE} aria-hidden /> : null}
        <span className="model-center-header-action-label tw:max-[479px]:hidden">刷新</span>
      </Button>

      {canEditProviderConfig(selectedProvider, deepSeekProtocolSupported) ? (
        <>
          <Button
            color="secondary"
            onClick={() => {
              setProviderEditorProviderId(selectedProvider.providerID)
              setProviderEditorOpen(true)
            }}
          >
            <Pencil size={APP_ICON_SIZE} aria-hidden />
            <span className="model-center-header-action-label tw:max-[479px]:hidden">
              编辑 Provider
            </span>
          </Button>
          {selectedProvider?.providerKind === 'custom' ? (
            <Button color="danger" onClick={() => void deleteCustomProvider()}>
              <Trash2 size={APP_ICON_SIZE} aria-hidden />
              <span className="model-center-header-action-label tw:max-[479px]:hidden">
                删除 Provider
              </span>
            </Button>
          ) : null}
        </>
      ) : null}

      {providerSection === 'connection' ? (
        <Button
          color="secondary"
          aria-label="测试连接"
          disabled={busy || !selectedProvider || !isExecutableDesktopProvider(selectedProvider)}
          onClick={() => void testConnection()}
          title="测试当前连接"
        >
          <Cable size={APP_ICON_SIZE} aria-hidden />
          <span className="model-center-header-action-label tw:max-[479px]:hidden">测试连接</span>
        </Button>
      ) : null}

      {providerSection === 'models' ? (
        <Button
          color="secondary"
          aria-label="刷新目录"
          disabled={busy || !selectedProvider || !isExecutableDesktopProvider(selectedProvider)}
          onClick={() => void fetchModels()}
          title="刷新模型目录"
        >
          <RefreshCw
            size={APP_ICON_SIZE}
            aria-hidden
            className={busy ? 'tw:animate-spin' : undefined}
          />
          <span className="model-center-header-action-label tw:max-[479px]:hidden">刷新目录</span>
        </Button>
      ) : null}
    </>
  ) : null

  return (
    <div className="model-center-shell tw:@container tw:mx-auto tw:min-w-0 tw:w-[min(calc(var(--page-content-max-width)_+_var(--cpx-sys-space-5)_*_2),100%)] tw:max-w-[calc(var(--page-content-max-width)_+_var(--cpx-sys-space-5)_*_2)] tw:p-5">
      {showingProviderDetail && selectedProvider ? (
        <WorkspaceHeaderItem align="start" id="models.navigation" order={0} slot="left">
          <div className="plugins-detail-breadcrumb model-center-detail-breadcrumb tw:mb-1 tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1 tw:text-app-text-meta tw:type-caption">
            <Button
              color="ghostSecondary"
              onClick={showProviderCatalog}
              size="toolbar"
              title="返回供应商列表"
            >
              供应商
            </Button>
            <ChevronRight
              aria-hidden="true"
              className="model-center-breadcrumb-separator tw:shrink-0 tw:text-app-text-meta tw:opacity-60"
              size={APP_ICON_SIZES.sm}
              strokeWidth={APP_ICON_STROKE_WIDTH}
            />
            <span className="model-center-breadcrumb-current tw:overflow-hidden tw:text-app-text tw:text-ellipsis tw:whitespace-nowrap">
              {selectedProvider.displayName}
            </span>
          </div>
        </WorkspaceHeaderItem>
      ) : null}

      {!showingProviderDetail ? (
        <div className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-8 tw:grid tw:gap-2">
          <h2 className="settings-page-title tw:m-0 tw:type-title-xl tw:text-app-text tw:tracking-[-0.01em]">
            供应商
          </h2>
          <p className="settings-page-desc tw:m-0 tw:max-w-[68ch] tw:text-app-text-soft tw:type-body-sm">
            管理模型服务、账户连接、凭据与可用模型。
          </p>
        </div>
      ) : null}

      {!showingProviderDetail ? (
        <WorkspaceHeaderItem align="end" id="models.actions" order={100} slot="right">
          <div className="model-center-header-actions tw:inline-flex tw:shrink-0 tw:flex-wrap tw:items-center tw:justify-end tw:gap-3">
            {!showInitialSkeleton ? (
              <>
                <Button
                  color="secondary"
                  disabled={refreshingProviderData}
                  loading={refreshingProviderData}
                  onClick={() => void refreshProviderData()}
                >
                  {!refreshingProviderData ? <RefreshCw size={APP_ICON_SIZE} aria-hidden /> : null}
                  <span className="model-center-header-action-label tw:max-[479px]:hidden">
                    刷新
                  </span>
                </Button>
                <Button
                  color="primary"
                  onClick={() => {
                    setProviderEditorProviderId(null)
                    setProviderEditorOpen(true)
                  }}
                >
                  <Plus size={APP_ICON_SIZE} aria-hidden />
                  <span className="model-center-header-action-label tw:max-[479px]:hidden">
                    新增自定义 Provider
                  </span>
                </Button>
              </>
            ) : null}
          </div>
        </WorkspaceHeaderItem>
      ) : null}

      {showInitialSkeleton ? (
        <ModelCenterInitialSkeleton
          view={showingProviderDetail ? 'detail' : 'catalog'}
          section={providerSection}
        />
      ) : showingProviderDetail && selectedProvider ? (
        <ProviderDetail
          actions={detailActions}
          activeTab={providerSection}
          onBack={showProviderCatalog}
          onTabChange={(tab) => updateLocation({ provider: providerID, section: tab })}
          provider={{
            id: selectedProvider.providerID,
            name: selectedProvider.displayName,
            logoURL: selectedProvider.logoURL,
            description: providerDescription(selectedProvider),
            status: providerDetailStatus(
              selectedProvider,
              selectedProviderState,
              selectedConfiguredGroup,
            ),
          }}
        >
          {providerSection === 'connection' ? (
            <ProviderConnectionSection
              apiKeys={providerApiKeys}
              busy={busy || busyKeyId !== null}
              group={selectedConfiguredGroup}
              onCopyKey={copyApiKey}
              onDeleteKey={setDeleteKey}
              onEditKey={(key) => {
                setEditingKey(key)
                setEditorProviderId(key.providerId)
              }}
              onError={onError}
              onMoveKey={moveApiKey}
              onNotice={onNotice}
              onOpenNewKey={() => {
                setEditingKey(null)
                setEditorProviderId(providerID)
              }}
              onRefresh={async () => {
                await providerManagementStore.refresh()
              }}
              onSetActiveKey={(key) =>
                mutateKey(
                  key.id,
                  () => providerManagementStore.setActiveCredential(key.providerId, key.id),
                  '当前活动 API Key 已切换。',
                ).then(() => undefined)
              }
              onTestConnection={testConnection}
              onTestKey={testSingleApiKey}
              onToggleKeyEnabled={(key) =>
                mutateKey(
                  key.id,
                  () => providerManagementStore.setCredentialEnabled(key.id, !key.enabled),
                  key.enabled ? 'API Key 已停用。' : 'API Key 已启用。',
                ).then(() => undefined)
              }
              provider={selectedProvider}
              providerState={selectedProviderState}
            />
          ) : (
            <ProviderModelsSection
              busy={busy}
              modelMetadata={modelMetadata}
              models={providerModels}
              onError={onError}
              onFetchModels={fetchModels}
              onNotice={onNotice}
              provider={selectedProvider}
            />
          )}
        </ProviderDetail>
      ) : (
        <ProviderCatalog
          filter={catalogFilter}
          onAddConnection={(nextProviderID) => setConnectionDialogProviderId(nextProviderID)}
          onFilterChange={setCatalogFilter}
          onManageConnection={(nextProviderID) => {
            selectProvider(nextProviderID)
          }}
          onQueryChange={setProviderSearch}
          onSelect={selectProvider}
          providers={providerCatalogItems}
          query={providerSearch}
        />
      )}

      {/* Dialogs */}
      <ProviderConnectionDialog
        busy={busy}
        open={connectionDialogProviderId !== null}
        provider={connectionDialogProvider}
        sources={connectionDialogSources}
        onKeySubmit={createProviderConnection}
        onConnected={() => {
          setConnectionDialogProviderId(null)
          if (connectionDialogProvider) {
            updateLocation({
              provider: connectionDialogProvider.providerID,
              section: 'connection',
            })
          }
        }}
        onOpenChange={(open) => {
          if (!open) setConnectionDialogProviderId(null)
        }}
      />

      <ProviderEditorDialog
        deepSeekProtocolSupported={deepSeekProtocolSupported}
        open={providerEditorOpen}
        provider={
          providerEditorProviderId
            ? providers.find((item) => item.providerID === providerEditorProviderId)
            : undefined
        }
        onOpenChange={setProviderEditorOpen}
        onSaved={async (savedProviderId) => {
          await providerManagementStore.refresh()
          const nextId = savedProviderId as ModelProviderID
          setProviderEditorProviderId(null)
          const savedProvider = providerManagementStore
            .getSnapshot()
            .providers.find((item) => item.providerID === nextId)
          applyProviderSelection(nextId, savedProvider)
          updateLocation({ provider: nextId, section: 'connection' })
          onNotice(
            deepSeekManagedProvider(savedProvider)
              ? 'DeepSeek API 协议已保存，将从下一次请求开始生效。'
              : '自定义 Provider 配置已保存。',
          )
        }}
      />

      <ApiKeyEditorDialog
        apiKey={editingKey}
        busy={busyKeyId !== null}
        initialProviderId={editorProviderId ?? providerID}
        open={editorProviderId !== null}
        providers={editorProvider ? [editorProvider] : []}
        onOpenChange={(open) => {
          if (open) return
          setEditorProviderId(null)
          setEditingKey(null)
        }}
        onSubmit={saveApiKeyEditor}
      />

      <ConfirmationDialog
        actionDisabled={busyKeyId !== null}
        actionLabel="删除"
        description={deleteConfirmation?.description ?? ''}
        open={deleteKey !== null}
        title={deleteConfirmation?.title ?? '删除 API Key？'}
        tone="danger"
        onAction={() => {
          if (!deleteKey) return
          const target = deleteKey
          void mutateKey(
            target.id,
            () => providerManagementStore.deleteCredential(target.id),
            'API Key 已删除。',
          ).then((success) => {
            if (success) setDeleteKey(null)
          })
        }}
        onCancel={() => setDeleteKey(null)}
      />
    </div>
  )
}

type ModelCenterInitialSkeletonProps = {
  view: 'catalog' | 'detail'
  section: 'connection' | 'models'
}

function ModelCenterInitialSkeleton({
  view,
  section,
}: ModelCenterInitialSkeletonProps): React.ReactNode {
  if (view === 'detail') {
    return (
      <SkeletonRegion
        className="model-center-initial-skeleton tw:grid tw:min-w-0 tw:gap-3"
        label="正在加载 Provider 详情"
      >
        <header className="model-center-skeleton-provider-header tw:flex tw:min-h-10 tw:min-w-0 tw:items-center tw:gap-3">
          <SkeletonBlock className="model-center-skeleton-back tw:size-9 tw:rounded-md" />
          <SkeletonBlock className="model-center-skeleton-provider-logo tw:size-10 tw:rounded-md" />
          <div className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-2">
            <SkeletonBlock className="model-center-skeleton-provider-title tw:h-[18px] tw:w-[min(150px,72%)]" />
            <SkeletonBlock className="model-center-skeleton-provider-copy tw:h-3.5 tw:w-[min(210px,88%)]" />
          </div>
        </header>
        <div className="model-center-skeleton-tabs tw:flex tw:gap-5 tw:border-b tw:border-b-app-border-subtle tw:px-1">
          <SkeletonBlock className="model-center-skeleton-tab tw:h-10 tw:w-14 tw:rounded-md" />
          <SkeletonBlock className="model-center-skeleton-tab tw:h-10 tw:w-14 tw:rounded-md" />
        </div>
        {section === 'models' ? (
          <>
            <SkeletonBlock className="model-center-skeleton-search tw:h-9 tw:w-[min(360px,100%)] tw:rounded-md" />
            <div className="model-center-skeleton-model-grid tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-4 tw:@max-[900px]:grid-cols-1">
              {Array.from({ length: 6 }, (_, index) => (
                <SkeletonBlock
                  className="model-center-skeleton-model-card tw:min-h-[116px] tw:rounded-lg"
                  key={index}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="model-center-skeleton-detail-sections tw:grid tw:gap-4">
            <SkeletonBlock className="tw:min-h-[154px] tw:rounded-xl" />
            <SkeletonBlock className="tw:min-h-[154px] tw:rounded-xl" />
          </div>
        )}
      </SkeletonRegion>
    )
  }

  return (
    <SkeletonRegion
      className="model-center-initial-skeleton tw:grid tw:min-w-0 tw:gap-3"
      label="正在加载 Provider 目录"
    >
      <div className="model-center-heading model-center-skeleton-heading tw:grid tw:gap-2">
        <SkeletonBlock className="model-center-skeleton-page-title tw:h-7 tw:w-[min(190px,52%)] tw:rounded-md" />
        <SkeletonBlock className="model-center-skeleton-page-copy tw:h-[18px] tw:w-[min(460px,78%)] tw:rounded-md" />
      </div>
      <div className="model-center-catalog-toolbar tw:flex tw:min-w-0 tw:items-center tw:justify-start tw:gap-3 tw:@max-[900px]:items-stretch">
        <SkeletonBlock className="model-center-skeleton-search tw:h-9 tw:w-[min(360px,100%)] tw:rounded-md" />
        <SkeletonBlock className="model-center-skeleton-count tw:h-6 tw:w-[46px] tw:rounded-full" />
      </div>
      <div className="model-center-skeleton-provider-grid tw:grid tw:min-w-0 tw:grid-cols-2 tw:gap-4 tw:@max-[900px]:grid-cols-1">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            className="model-center-skeleton-provider-card tw:grid tw:min-h-[78px] tw:min-w-0 tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:rounded-lg tw:border tw:border-app-border-subtle tw:p-4"
            key={index}
          >
            <SkeletonBlock className="model-center-skeleton-logo tw:size-9 tw:rounded-md" />
            <div className="tw:grid tw:min-w-0 tw:gap-2">
              <SkeletonBlock className="model-center-skeleton-name tw:h-[18px] tw:w-[min(150px,72%)]" />
              <SkeletonBlock className="model-center-skeleton-meta tw:h-3.5 tw:w-[min(210px,88%)]" />
            </div>
            <SkeletonBlock className="model-center-skeleton-status tw:h-3.5 tw:w-16" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

function providerDescription(provider: DesktopModelProviderSummary | undefined): string {
  if (!provider) return '管理供应商凭据与模型目录。'
  const parts = [provider.providerID]
  parts.push(provider.providerKind === 'custom' ? '自定义 Provider · Pi 执行' : 'Pi 内置')
  const managed = deepSeekManagedProvider(provider)
  if (managed) {
    const protocol = deepSeekProtocolOption(deepSeekProtocolOf(managed.config))
    parts.push(`${protocol.label} · ${protocol.endpoint}`)
  }
  return parts.join(' · ')
}

function providerDetailStatus(
  provider: DesktopModelProviderSummary,
  providerState: DesktopModelProviderState | null,
  group: ConfiguredProviderGroup | undefined,
): { label: string; tone: 'positive' | 'warning' | 'neutral' } {
  if (provider.availability?.status === 'unavailable') {
    return {
      label: providerAvailabilityLabel(provider.availability.reason),
      tone: 'warning',
    }
  }
  if (group?.activeConnection) {
    return { label: '已连接', tone: 'positive' }
  }
  if (providerState?.apiKeyConfigured) {
    return { label: '已配置', tone: 'positive' }
  }
  return { label: '未配置', tone: 'neutral' }
}

function providerAvailabilityLabel(
  reason:
    | 'unsupported-protocol'
    | 'missing-api'
    | 'unsafe-endpoint'
    | 'unresolved-endpoint'
    | 'no-compatible-models',
): string {
  switch (reason) {
    case 'missing-api':
      return '缺少 API 地址'
    case 'unsafe-endpoint':
      return 'Endpoint 不安全'
    case 'unresolved-endpoint':
      return 'Endpoint 尚未配置'
    case 'no-compatible-models':
      return '没有兼容模型'
    case 'unsupported-protocol':
      return '协议暂未适配'
  }
}

function providerCatalogConnectionStatus(
  status: 'stored-key' | 'oauth' | 'environment' | 'configured' | 'unconfigured',
  group: ConfiguredProviderGroup | undefined,
): { label: string; tone: 'positive' | 'warning' | 'neutral' } {
  if (group?.activeConnection) {
    if (group.activeConnection.kind === 'oauth') {
      return { label: 'OAuth 已连接', tone: 'positive' }
    }
    return { label: '已保存 Key', tone: 'positive' }
  }
  if (status === 'stored-key') return { label: '已保存 Key', tone: 'positive' }
  if (status === 'oauth') return { label: 'OAuth 已连接', tone: 'positive' }
  if (status === 'environment') return { label: '环境变量', tone: 'positive' }
  if (status === 'configured') return { label: '已配置', tone: 'positive' }
  return { label: '未配置', tone: 'neutral' }
}
