import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../components/ui/IconTokens.js'
import { desktopClient, desktopClipboard } from '../../services/desktop-client/index.js'
import { isExecutableDesktopProvider } from '../../services/desktop-client/ProviderAdapters.js'
import React, { useEffect, useMemo, useState } from 'react'
import type {
  DesktopApiKeySummary,
  DesktopProviderCredential,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopProviderDefinition,
  ModelProviderID,
} from '../../../shared/Types.js'
import { useDesktopSettingsField } from '../settings/UseDesktopSettings.js'
import { fullErrorMessage, toUserErrorMessage } from '../../utils/Errors.js'
import { ChevronRight, Plus, RefreshCw } from 'lucide-react'
import { Button } from '../../components/ui/Button.js'
import { useDesktopLayoutOutletContext } from '../layout/shell/DesktopLayoutOutletContext.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'
import { SkeletonBlock, SkeletonRegion } from '../../components/ui/Skeleton.js'
import { useSearchParams } from 'react-router-dom'
import { ProviderCatalog } from './ProviderCatalog.js'
import { ProviderDetail } from './ProviderDetail.js'
import { useModelCenterController } from './UseModelCenterController.js'
import {
  getApiKeyDeleteConfirmation,
  projectProviderDirectory,
  isConfiguredProviderDirectoryItem,
  parseModelCenterSearchParams,
  providerDetailStatus,
  updateModelCenterSearchParams,
} from './ModelCenterState.js'
import { PrimaryPageLayout } from '../layout/primary-page/index.js'
import { ProviderEditorForm } from './provider-management/ProviderEditorForm.js'
import { ProviderConnectionSection } from './provider-management/ProviderConnectionSection.js'
import { ProviderModelsSection } from './provider-management/ProviderModelsSection.js'
import {
  deepSeekManagedProvider,
  deepSeekProtocolOf,
} from './provider-management/DeepseekProtocol.js'
import { type ApiKeyEditorValue } from './ApiKeyEditorDialog.js'
import {
  providerManagementStore,
  selectConfiguredProviderGroups,
  selectOrphanProviderCredentials,
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
  const subscribedProviderID = useDesktopSettingsField((state) => state.providerID)
  const subscribedModel = useDesktopSettingsField((state) => state.model)
  const settings = useMemo(
    () => ({ providerID: subscribedProviderID, model: subscribedModel }),
    [subscribedProviderID, subscribedModel],
  )
  const providerPanel = useDesktopLayoutOutletContext()?.providerManagement
  const [searchParams, setSearchParams] = useSearchParams()
  const [providerID, setProviderID] = useState<ModelProviderID>(settings.providerID)
  const [model, setModel] = useState(settings.model)
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null)
  const [providerQuery, setProviderQuery] = useState('')
  const [deepSeekProtocolSupported, setDeepSeekProtocolSupported] = useState(false)
  const [connectionDraftDirty, setConnectionDraftDirty] = useState(false)
  const [deleteKey, setDeleteKey] = useState<DesktopApiKeySummary | null>(null)
  const [orphanToDelete, setOrphanToDelete] = useState<DesktopProviderCredential | null>(null)
  const [providerToDelete, setProviderToDelete] = useState<DesktopModelProviderSummary | null>(null)
  const [deletingProvider, setDeletingProvider] = useState(false)

  const controller = useModelCenterController({
    onInitialProviderState: (nextState) => applyProviderState(nextState),
    onError,
    onNotice,
  })

  const {
    initialLoadState,
    providers,
    providerState,
    apiKeys,
    configuration,
    usageSources,
    busyProviderIds,
    modelTestResults,
    refreshingProviderData,
    refreshProviderData,
    saveProviderDefinition,
    deleteProvider,
  } = controller

  const busy = busyProviderIds.includes(providerID)

  const selectorInput = useMemo(
    () => ({
      providers: configuration.providers,
      currentProviderState: configuration.currentProviderState,
      credentials: configuration.credentials,
      apiKeys: configuration.apiKeys,
      usageSources,
    }),
    [configuration, usageSources],
  )
  const configuredGroups = useMemo(
    () => selectConfiguredProviderGroups(selectorInput),
    [selectorInput],
  )
  const orphanCredentials = useMemo(
    () => selectOrphanProviderCredentials(configuration),
    [configuration],
  )

  const marketProviders = useMemo(
    () =>
      projectProviderDirectory(providers, {
        query: providerQuery,
        currentProviderId: configuration.currentProviderState?.selectedProviderID,
        currentProviderState: configuration.currentProviderState,
        apiKeys: configuration.apiKeys,
        credentials: configuration.credentials,
      })
        .filter((item) => item.provider.providerKind !== 'custom')
        .map((item) => ({
          id: item.provider.providerID,
          name: item.provider.displayName,
          logoURL: item.provider.logoURL,
          source:
            item.provider.catalogOrigin === 'models-dev'
              ? 'models.dev'
              : item.provider.catalogOrigin === 'pi-remote'
                ? 'Pi 官方'
                : '内置',
          modelCount: item.provider.modelCount ?? item.provider.defaultModels.length,
          current: item.current,
          canAddConnection: !isConfiguredProviderDirectoryItem(item),
          connectionDisabled:
            item.provider.availability?.status === 'unavailable' &&
            item.provider.catalogOrigin !== 'models-dev' &&
            item.provider.catalogOrigin !== 'pi-remote',
        })),
    [providers, configuration, providerQuery],
  )

  const routeState = useMemo(
    () =>
      parseModelCenterSearchParams(
        searchParams,
        providers.map((provider) => provider.providerID),
        providers
          .filter((provider) => provider.providerKind === 'custom')
          .map((provider) => provider.providerID),
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

  useEffect(() => {
    if (
      routeState.providerId !== selectedProvider?.providerID ||
      selectedProvider?.providerKind === 'custom'
    )
      return
    if (selectedProvider)
      void controller.loadProviderModels(selectedProvider.providerID).catch(showOperationError)
  }, [routeState.providerId, selectedProvider?.providerID, controller.loadProviderModels])

  const providerModels = (
    selectedProvider?.defaultModels ??
    selectedProviderState?.models ??
    []
  ).filter((item) => item && item !== NO_MODEL_OPTION)

  const modelMetadata = {
    ...selectedProviderState?.modelMetadata,
    ...selectedProvider?.modelMetadata,
  }

  const providerApiKeys = useMemo(
    () =>
      apiKeys
        .filter((key) => key.providerId === providerID)
        .sort((left, right) => left.priority - right.priority),
    [apiKeys, providerID],
  )

  useEffect(() => {
    if (providerID === providerState?.selectedProviderID) return
    const nextSelection = getProviderSelectionState(selectedProvider)
    setModel(nextSelection.model)
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
      editing?: boolean
    },
    replace = false,
  ): void {
    setSearchParams(
      (current) => {
        return updateModelCenterSearchParams(current, {
          providerId: patch.provider,
          section: patch.section,
          editing: patch.editing,
        })
      },
      { replace },
    )
  }

  function showProviderCatalog(): void {
    updateLocation({ provider: null, section: null })
  }

  function showProviderDetail(): void {
    if (creatingCustomProvider) showProviderCatalog()
    else updateLocation({ provider: routeState.providerId, section: providerSection })
  }

  function applyProviderSelection(
    nextProviderID: ModelProviderID,
    nextProvider: DesktopModelProviderSummary | undefined,
  ): void {
    const nextSelection = getProviderSelectionState(nextProvider)
    setProviderID(nextProviderID)
    setModel(nextSelection.model)
  }

  function applyProviderState(nextState: DesktopModelProviderState): void {
    const nextModel =
      nextState.model || nextState.models[0] || nextState.provider.defaultModels[0] || ''
    setProviderID(nextState.selectedProviderID)
    setModel(nextModel)
  }

  async function fetchModels(): Promise<void> {
    if (selectedProvider) await controller.fetchModels(selectedProvider)
  }

  async function testConnection(modelId = model): Promise<void> {
    if (selectedProvider)
      await controller.testModels(
        selectedProvider,
        modelId ? [modelId] : providerModels.slice(0, 1),
      )
  }

  async function mutateKey(
    id: string,
    action: () => Promise<{ syncWarning: string | null }>,
    successMessage: string,
  ): Promise<boolean> {
    setBusyKeyId(id)
    try {
      const outcome = await action()
      // 写入已成功，仅同步失败：提示成功并附带刷新警告，绝不提示保存失败。
      onNotice(outcome.syncWarning ? `${successMessage}${outcome.syncWarning}` : successMessage)
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      return true
    } catch (error) {
      onError(toUserErrorMessage(error))
      return false
    } finally {
      setBusyKeyId(null)
    }
  }

  async function saveApiKeyEditor(
    value: ApiKeyEditorValue,
    keyToEdit: DesktopApiKeySummary | null = null,
  ): Promise<boolean> {
    if (keyToEdit) {
      const replacement = value.key?.trim()
      return mutateKey(
        keyToEdit.id,
        () =>
          providerManagementStore.updateApiKey({
            credentialId: keyToEdit.id,
            ...(value.label !== keyToEdit.label ? { label: value.label } : {}),
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
      const { value: result, syncWarning } = await providerManagementStore.testApiKey(key.id)
      onNotice(
        result.message ?? (result.ok ? 'API Key 鉴权通过，测试成功。' : 'API Key 测试失败。'),
      )
      if (syncWarning) onNotice(syncWarning)
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
    } catch (error) {
      onError(error instanceof Error ? error.message : 'API Key 测试失败，请稍后重试。')
    } finally {
      setBusyKeyId(null)
    }
  }

  function showOperationError(error: unknown): void {
    const message = fullErrorMessage(error)
    onError(message)
  }

  async function deleteCustomProvider(): Promise<void> {
    if (!selectedProvider || selectedProvider.providerKind !== 'custom') return
    setProviderToDelete(selectedProvider)
  }

  async function confirmDeleteProvider(): Promise<void> {
    if (!providerToDelete || deletingProvider) return
    setDeletingProvider(true)
    try {
      await deleteProvider(providerToDelete.providerID)
      setProviderToDelete(null)
      showProviderCatalog()
      onNotice('自定义供应商已删除。')
    } catch (error) {
      showOperationError(error)
    } finally {
      setDeletingProvider(false)
    }
  }

  const creatingCustomProvider = searchParams.get('newProvider') === '1'
  const showingProviderDetail = !creatingCustomProvider && routeState.providerId !== null
  const showingCustomEditor =
    creatingCustomProvider || (showingProviderDetail && routeState.editing)

  const showInitialSkeleton = initialLoadState === 'loading' && providers.length === 0

  useEffect(() => {
    providerPanel?.claimProvider(
      showingProviderDetail && !showingCustomEditor ? (selectedProvider?.providerID ?? null) : null,
    )
    return () => providerPanel?.claimProvider(null)
  }, [
    providerPanel?.claimProvider,
    showingProviderDetail,
    showingCustomEditor,
    selectedProvider?.providerID,
  ])

  const selectedConfiguredGroup = configuredGroups.find(
    (group) => group.provider.providerID === providerID,
  )

  const deleteConfirmation = deleteKey
    ? getApiKeyDeleteConfirmation(
        deleteKey,
        [...configuration.apiKeys],
        configuration.providers.find((p) => p.providerID === deleteKey.providerId)?.displayName,
      )
    : null

  const connectionSection = selectedProvider ? (
    <ProviderConnectionSection
      key={selectedProvider.providerID}
      apiKeys={providerApiKeys}
      busy={busy || busyKeyId !== null}
      group={selectedConfiguredGroup}
      onCopyKey={copyApiKey}
      onDeleteKey={setDeleteKey}
      onError={onError}
      onMoveKey={moveApiKey}
      onNotice={onNotice}
      onSubmitKey={saveApiKeyEditor}
      onDeleteProvider={
        selectedProvider.providerKind === 'custom' ? deleteCustomProvider : undefined
      }
      onTestConnection={testConnection}
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
      onTestKey={testSingleApiKey}
      onToggleKeyEnabled={(key) =>
        mutateKey(
          key.id,
          () => providerManagementStore.setCredentialEnabled(key.id, !key.enabled),
          key.enabled ? 'API Key 已停用。' : 'API Key 已启用。',
        ).then(() => undefined)
      }
      provider={selectedProvider}
      onDraftChange={setConnectionDraftDirty}
      onSaveDefinition={(definition) =>
        saveProviderDefinition(definition, selectedProvider.providerID)
      }
    />
  ) : null

  async function saveCustomProvider(
    savedProviderId: string,
    select = true,
  ): Promise<DesktopModelProviderSummary | undefined> {
    const savedProvider = await controller.readSavedProvider(savedProviderId)
    if (select) {
      applyProviderSelection(savedProvider.providerID, savedProvider)
      updateLocation({
        provider: savedProviderId,
        section: creatingCustomProvider ? 'connection' : providerSection,
      })
    }
    onNotice('自定义供应商配置已保存。')
    return savedProvider
  }

  const detailActions = selectedProvider ? (
    <>
      {selectedProvider.config ? (
        <ToggleSwitch
          ariaLabel="启用供应商"
          checked={selectedProvider.config.enabled}
          disabled={busy}
          onChange={(enabled) => {
            void saveProviderDefinition(
              { ...selectedProvider.config!, enabled },
              selectedProvider.providerID,
            ).catch((error) => onError(fullErrorMessage(error)))
          }}
        />
      ) : null}
    </>
  ) : null

  const marketActions =
    !showInitialSkeleton && !showingProviderDetail && !creatingCustomProvider ? (
      <div className="model-center-header-actions tw:inline-flex tw:shrink-0 tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
        <Button
          aria-busy={refreshingProviderData}
          disabled={refreshingProviderData}
          isIconOnly
          onClick={() => void refreshProviderData()}
          shape="pill"
          size="md"
          title="刷新供应商目录"
          variant="ghost"
        >
          <RefreshCw
            aria-hidden="true"
            className={refreshingProviderData ? 'tw:animate-spin' : undefined}
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
        </Button>
        <Button
          color="primary"
          onClick={() => setSearchParams({ newProvider: '1' })}
          shape="pill"
          size="md"
        >
          <Plus aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          <span>新增自定义 Provider</span>
        </Button>
      </div>
    ) : null

  return (
    <>
      {!showingProviderDetail && !creatingCustomProvider ? (
        <PrimaryPageLayout
          actions={marketActions}
          className="model-center-shell model-center-primary-page tw:@container"
          headerClassName="settings-page-header"
          title="供应商市场"
          description="浏览模型供应商，连接后可在左侧管理凭据与模型。"
          search={
            <SearchInput
              variant="outlined"
              aria-label="搜索供应商"
              placeholder="搜索供应商"
              shape="pill"
              size="md"
              value={providerQuery}
              onChange={setProviderQuery}
            />
          }
        >
          {showInitialSkeleton ? (
            <ModelCenterInitialSkeleton view="catalog" />
          ) : providerQuery.trim() && marketProviders.length === 0 ? (
            <p className="tw:py-8 tw:text-center tw:text-app-text-meta tw:type-body-sm">
              没有匹配的供应商
            </p>
          ) : (
            <ProviderCatalog
              providers={marketProviders}
              onSelect={(id) => updateLocation({ provider: id, section: 'connection' })}
              onManageConnection={(id) => updateLocation({ provider: id, section: 'connection' })}
              onAddConnection={(id) => updateLocation({ provider: id, section: 'connection' })}
            />
          )}
          {orphanCredentials.length > 0 ? (
            <section aria-label="遗留供应商凭据" className="tw:mt-6 tw:grid tw:gap-3">
              <h2 className="tw:type-title-sm tw:text-app-text">遗留供应商凭据</h2>
              <p className="tw:type-body-sm tw:text-app-text-meta">
                这些凭据所属的供应商已不存在，可单独删除，历史聊天仍保留。
              </p>
              {orphanCredentials.map((credential) => (
                <div
                  key={credential.id}
                  className="tw:flex tw:items-center tw:justify-between tw:gap-3"
                >
                  <span>
                    {credential.providerId} · {credential.label} ·{' '}
                    {credential.kind === 'oauth' ? 'OAuth' : 'API Key'} {credential.maskedValue}
                  </span>
                  <Button size="sm" onClick={() => setOrphanToDelete(credential)}>
                    删除凭据
                  </Button>
                </div>
              ))}
            </section>
          ) : null}
        </PrimaryPageLayout>
      ) : (
        <div className="model-center-shell tw:@container tw:h-full tw:w-full tw:min-w-0 tw:overflow-x-hidden tw:overflow-y-auto tw:p-5">
          <div className="tw:mx-auto tw:min-w-0 tw:w-full tw:max-w-[var(--page-content-max-width)] tw:pb-8">
            {showingCustomEditor ? (
              <>
                <div className="plugins-detail-breadcrumb model-center-detail-breadcrumb tw:mb-4 tw:inline-flex tw:min-w-0 tw:items-center tw:gap-1 tw:text-app-text-meta tw:type-caption">
                  <Button
                    color="ghostSecondary"
                    onClick={
                      showingCustomEditor && !creatingCustomProvider
                        ? showProviderDetail
                        : showProviderCatalog
                    }
                    size="toolbar"
                    title={
                      showingCustomEditor && !creatingCustomProvider
                        ? '返回供应商详情'
                        : '返回供应商列表'
                    }
                  >
                    {showingCustomEditor && !creatingCustomProvider
                      ? selectedProvider?.displayName
                      : '供应商'}
                  </Button>
                  <ChevronRight
                    aria-hidden="true"
                    className="model-center-breadcrumb-separator tw:shrink-0 tw:text-app-text-meta tw:opacity-60"
                    size="var(--inline-icon-size, 1em)"
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                  <span className="model-center-breadcrumb-current tw:overflow-hidden tw:text-app-text tw:text-ellipsis tw:whitespace-nowrap">
                    {creatingCustomProvider
                      ? '新供应商'
                      : showingCustomEditor
                        ? '编辑配置'
                        : selectedProvider?.displayName}
                  </span>
                </div>
              </>
            ) : null}
            {showInitialSkeleton ? (
              <ModelCenterInitialSkeleton view="detail" />
            ) : showingCustomEditor ? (
              <ProviderEditorForm
                key={creatingCustomProvider ? 'new-provider' : selectedProvider?.providerID}
                embedded
                open
                existingProviderIds={providers.map((item) => item.providerID)}
                provider={creatingCustomProvider ? undefined : selectedProvider}
                operationBusy={busy || busyKeyId !== null}
                onTestModel={testConnection}
                onDelete={deleteCustomProvider}
                onOpenChange={showProviderDetail}
                onSaveDefinition={saveProviderDefinition}
                onSaved={saveCustomProvider}
              />
            ) : showingProviderDetail && selectedProvider ? (
              <ProviderDetail
                actions={detailActions}
                section={providerSection}
                provider={{
                  id: selectedProvider.providerID,
                  name: selectedProvider.displayName,
                  logoURL: selectedProvider.logoURL,
                  status: providerDetailStatus(
                    selectedProvider,
                    selectedProviderState,
                    selectedConfiguredGroup,
                  ),
                }}
              >
                <div data-provider-section="connection">{connectionSection}</div>
                <div data-provider-section="models">
                  <ProviderModelsSection
                    editingBlocked={connectionDraftDirty}
                    key={selectedProvider.providerID}
                    busy={busy}
                    modelMetadata={modelMetadata}
                    models={providerModels}
                    onError={onError}
                    onFetchModels={fetchModels}
                    onNotice={onNotice}
                    provider={selectedProvider}
                    testResults={modelTestResults}
                    onTestModels={(ids) => controller.testModels(selectedProvider, ids)}
                    onSaveDefinition={saveProviderDefinition}
                    onRefresh={() => providerManagementStore.refresh().then(() => undefined)}
                  />
                </div>
              </ProviderDetail>
            ) : null}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={providerToDelete !== null}
        title="删除自定义供应商？"
        description={`确定删除自定义供应商“${providerToDelete?.displayName ?? ''}”？将同时删除此供应商已保存的 API Key 和 OAuth 凭据，历史会话引用保留。`}
        actionLabel="删除供应商"
        tone="danger"
        actionDisabled={deletingProvider}
        onAction={() => void confirmDeleteProvider()}
        onCancel={() => {
          if (!deletingProvider) setProviderToDelete(null)
        }}
      />

      <ConfirmationDialog
        open={orphanToDelete !== null}
        title="删除遗留凭据？"
        description={`删除“${orphanToDelete?.label ?? ''}”后无法恢复，历史聊天仍保留。`}
        actionLabel="删除凭据"
        tone="danger"
        actionDisabled={busyKeyId !== null}
        onAction={() => {
          if (!orphanToDelete) return
          const target = orphanToDelete
          void mutateKey(
            target.id,
            () => providerManagementStore.deleteCredential(target.id),
            '遗留凭据已删除。',
          ).then((success) => {
            if (success) setOrphanToDelete(null)
          })
        }}
        onCancel={() => setOrphanToDelete(null)}
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
    </>
  )
}

type ModelCenterInitialSkeletonProps = {
  view: 'catalog' | 'detail'
}

function ModelCenterInitialSkeleton({ view }: ModelCenterInitialSkeletonProps): React.ReactNode {
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
        <SkeletonBlock className="tw:h-24 tw:rounded-md" />
        <SkeletonBlock className="tw:h-9 tw:w-[min(360px,100%)] tw:rounded-md" />
        <div className="tw:grid tw:min-w-0 tw:gap-2">
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonBlock className="tw:h-14 tw:rounded-md" key={index} />
          ))}
        </div>
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
