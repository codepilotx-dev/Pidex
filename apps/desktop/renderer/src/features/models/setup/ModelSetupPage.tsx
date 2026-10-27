import { startupSurfaceReadyRef } from '../../../startup/StartupSplashHandoff.js'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { Check, ChevronLeft, Server } from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import type {
  DesktopModelMetadata,
  DesktopModelProviderSummary,
  DesktopModelRef,
  ModelProviderID,
} from '../../../../shared/Types.js'
import { AgentRpcError } from '../../../services/AgentRpcClient.js'
import { Button } from '../../../components/ui/Button.js'
import { ProviderIcon } from '../ProviderIcon.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { isExecutableDesktopProvider } from '../../../services/desktop-client/ProviderAdapters.js'
import { persistRecentNewThreadModel } from '../RecentNewThreadModel.js'
import { WindowControls } from '../../layout/MenuBar.js'
import { providerManagementStore } from '../../provider-management/ProviderManagementStore.js'
import {
  useProviderManagementStore,
  useShallow,
} from '../../provider-management/UseProviderManagementStore.js'
import type { ProviderConfigurationState } from '../../provider-management/Types.js'
import { useDesktopSettingsField } from '../../settings/UseDesktopSettings.js'
import { ApiKeyEditorForm, type ApiKeyEditorValue } from '../ApiKeyEditorDialog.js'
import { OAuthConnection } from '../provider-management/OAuthConnection.js'
import { ProviderEditorDialog } from '../provider-management/ProviderEditorDialog.js'
import {
  hasUsableTaskModel,
  resolveModelSetupLoadingLabel,
  SetupBootState,
  SetupRecoveryState,
} from './RequireConfiguredModel.js'

export type ModelSetupStep = 'provider' | 'model'
export type ModelSetupStatus = 'loading' | 'ready' | 'saving' | 'error'

export function ModelSetupPage(): React.ReactNode {
  const navigate = useNavigate()
  const subscribedSettingsLoaded = useDesktopSettingsField((state) => state.settingsLoaded)
  const subscribedFirstUseSetupCompleted = useDesktopSettingsField(
    (state) => state.firstUseSetupCompleted,
  )
  const subscribedSaveFirstUseSetupCompleted = useDesktopSettingsField(
    (state) => state.saveFirstUseSetupCompleted,
  )
  const subscribedSyncExternalSettingsPatch = useDesktopSettingsField(
    (state) => state.syncExternalSettingsPatch,
  )
  const settings = useMemo(
    () => ({
      settingsLoaded: subscribedSettingsLoaded,
      firstUseSetupCompleted: subscribedFirstUseSetupCompleted,
      saveFirstUseSetupCompleted: subscribedSaveFirstUseSetupCompleted,
      syncExternalSettingsPatch: subscribedSyncExternalSettingsPatch,
    }),
    [
      subscribedSettingsLoaded,
      subscribedFirstUseSetupCompleted,
      subscribedSaveFirstUseSetupCompleted,
      subscribedSyncExternalSettingsPatch,
    ],
  )
  const configuration = useProviderManagementStore(
    useShallow((state) => ({
      loaded: state.configuration.loaded,
      error: state.configuration.error,
      configurationError: state.configuration.configurationError,
      providers: state.configuration.providers,
      currentProviderState: state.configuration.currentProviderState,
      credentials: state.configuration.credentials,
    })),
  )
  const [step, setStep] = useState<ModelSetupStep>('provider')
  const [status, setStatus] = useState<ModelSetupStatus>('loading')
  const [providerQuery, setProviderQuery] = useState('')
  const [modelQuery, setModelQuery] = useState('')
  const [providerId, setProviderId] = useState<ModelProviderID | null>(null)
  const [modelId, setModelId] = useState('')
  const [variant, setVariant] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelMetadata, setModelMetadata] = useState<Record<string, DesktopModelMetadata>>({})
  const [createdCredentialId, setCreatedCredentialId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modelReloadToken, setModelReloadToken] = useState(0)
  const [providerEditorOpen, setProviderEditorOpen] = useState(false)
  const [isMaximized, setIsMaximized] = useState(false)
  const providerListboxId = useRef(
    `model-setup-provider-list-${Math.random().toString(36).slice(2)}`,
  )
  const modelListboxId = useRef(`model-setup-model-list-${Math.random().toString(36).slice(2)}`)

  const providers = useMemo(
    () =>
      configuration.providers.filter(isExecutableDesktopProvider).sort((left, right) =>
        left.displayName.localeCompare(right.displayName, 'zh-CN', {
          numeric: true,
          sensitivity: 'base',
        }),
      ),
    [configuration.providers],
  )
  const selectedProvider = providers.find((provider) => provider.providerID === providerId) ?? null
  const filteredProviders = useMemo(() => {
    const query = providerQuery.trim().toLocaleLowerCase()
    if (!query) return providers
    return providers.filter((provider) =>
      `${provider.displayName} ${provider.providerID}`.toLocaleLowerCase().includes(query),
    )
  }, [providerQuery, providers])
  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase()
    if (!query) return models
    return models.filter((id) => {
      const metadata = modelMetadata[id]
      return `${id} ${metadata?.name ?? ''}`.toLocaleLowerCase().includes(query)
    })
  }, [modelMetadata, modelQuery, models])
  const selectedVariants = modelMetadata[modelId]?.variants ?? []
  const providerConnected = selectedProvider
    ? isProviderConnected(selectedProvider, configuration)
    : false
  const supportsApiKey = selectedProvider?.authMethods?.includes('api-key') !== false
  const keyFormProviders = useMemo(
    () => (selectedProvider ? [selectedProvider] : []),
    [selectedProvider],
  )
  const providerNav = useListboxNavigation({
    count: filteredProviders.length,
    onSelect: (index) => chooseProvider(filteredProviders[index]),
  })
  const modelNav = useListboxNavigation({
    count: filteredModels.length,
    onSelect: (index) => {
      const id = filteredModels[index]
      if (!id) return
      setModelId(id)
      setVariant('')
    },
  })

  useEffect(() => {
    let mounted = true
    void desktopClient
      .isWindowMaximized()
      .then((value) => {
        if (mounted) setIsMaximized(value)
      })
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (
      !settings.settingsLoaded ||
      !configuration.loaded ||
      configuration.configurationError ||
      !configuration.currentProviderState ||
      settings.firstUseSetupCompleted !== undefined
    )
      return
    const inferred = hasUsableTaskModel(configuration.currentProviderState, configuration.providers)
      ? 1
      : 0
    void settings.saveFirstUseSetupCompleted(inferred).catch(() => undefined)
  }, [
    settings.firstUseSetupCompleted,
    settings.saveFirstUseSetupCompleted,
    settings.settingsLoaded,
    configuration.configurationError,
    configuration.currentProviderState,
    configuration.providers,
    configuration.loaded,
  ])

  useEffect(() => {
    if (!configuration.loaded || providerId || providers.length === 0) return
    const preferred =
      providers.find(
        (provider) =>
          provider.providerID === configuration.currentProviderState?.selectedProviderID,
      ) ??
      providers.find((provider) => isProviderConnected(provider, configuration)) ??
      providers[0]
    setProviderId(preferred?.providerID ?? null)
    // 显式重置为 0，或旧配置尚未完成首次引导时，始终从第 1 步开始；
    // Provider 已连接只影响“继续”按钮，不再跳过首次引导页面。
    const fullGuideRequested =
      settings.firstUseSetupCompleted === 0 ||
      (settings.firstUseSetupCompleted === undefined &&
        (configuration.currentProviderState === null ||
          configuration.currentProviderState === undefined ||
          !hasUsableTaskModel(configuration.currentProviderState, configuration.providers)))
    setStep(
      !fullGuideRequested && isProviderConnected(preferred, configuration) ? 'model' : 'provider',
    )
    setStatus('ready')
  }, [providerId, providers, settings.firstUseSetupCompleted, configuration])

  useEffect(() => {
    if (step !== 'model' || !selectedProvider) return
    let cancelled = false
    setStatus('loading')
    setError(null)
    setNotice('正在加载模型目录…')
    void desktopClient
      .fetchProviderModels({
        providerID: selectedProvider.providerID,
        limit: 100,
      })
      .then((result) => {
        if (cancelled) return
        const nextModels =
          result.models.length > 0 ? result.models : [...selectedProvider.defaultModels]
        setModels(nextModels)
        setModelMetadata({
          ...selectedProvider.modelMetadata,
          ...result.modelMetadata,
        })
        setModelId((current) =>
          nextModels.includes(current)
            ? current
            : configuration.currentProviderState?.selectedProviderID ===
                  selectedProvider.providerID &&
                nextModels.includes(configuration.currentProviderState.model)
              ? configuration.currentProviderState.model
              : (nextModels[0] ?? ''),
        )
        setNotice(
          result.error
            ? '远端目录刷新失败，正在使用已有目录。'
            : `已加载 ${nextModels.length} 个模型。`,
        )
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        const fallback = [...selectedProvider.defaultModels]
        setModels(fallback)
        setModelMetadata(selectedProvider.modelMetadata ?? {})
        setModelId((current) => (fallback.includes(current) ? current : (fallback[0] ?? '')))
        setNotice(fallback.length > 0 ? '远端目录暂不可用，正在使用已有目录。' : null)
        setError(fallback.length > 0 ? null : '没有可用模型，请稍后重试。')
        setStatus(fallback.length > 0 ? 'ready' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [modelReloadToken, selectedProvider, configuration.currentProviderState, step])

  if (!configuration.loaded || !settings.settingsLoaded) {
    return (
      <SetupBootState
        label={resolveModelSetupLoadingLabel(configuration.loaded, settings.settingsLoaded)}
      />
    )
  }
  if (configuration.configurationError || !configuration.currentProviderState) {
    return (
      <SetupRecoveryState
        message={configuration.configurationError}
        onRetry={() => void providerManagementStore.refresh()}
      />
    )
  }
  const effectiveFirstUseSetupCompleted =
    settings.firstUseSetupCompleted ??
    (hasUsableTaskModel(configuration.currentProviderState, configuration.providers) ? 1 : 0)
  if (effectiveFirstUseSetupCompleted === 1) {
    return <Navigate replace to="/new" />
  }

  function chooseProvider(provider: DesktopModelProviderSummary): void {
    setProviderId(provider.providerID)
    setCreatedCredentialId(null)
    setNotice(null)
    setError(null)
  }

  function continueToModels(): void {
    if (!selectedProvider || !providerConnected) return
    setStep('model')
    setModelQuery('')
    setVariant('')
    setNotice(null)
    setError(null)
  }

  async function saveApiKey(value: ApiKeyEditorValue): Promise<boolean> {
    if (!value.key) return false
    setStatus('saving')
    setError(null)
    setNotice(null)
    try {
      const { value: credential, syncWarning } = await providerManagementStore.createApiKey({
        providerId: value.providerId,
        label: value.label,
        key: value.key,
      })
      setCreatedCredentialId(credential.id)
      setNotice(
        syncWarning ? `凭据已安全保存，尚未验证。${syncWarning}` : '凭据已安全保存，尚未验证。',
      )
      setStatus('ready')
      setStep('model')
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      return true
    } catch (saveError) {
      setError(setupErrorText(saveError, '凭据保存失败，请重试。'))
      setStatus('error')
      return false
    }
  }

  async function testConnection(): Promise<void> {
    if (!selectedProvider) return
    setStatus('loading')
    setError(null)
    setNotice('正在测试连接…')
    try {
      const result = createdCredentialId
        ? await providerManagementStore.testApiKey(createdCredentialId).then(({ value }) => value)
        : await desktopClient.testModelProvider(
            selectedProvider.providerID,
            modelId
              ? ({
                  providerID: selectedProvider.providerID,
                  id: modelId,
                  ...(variant ? { variant } : {}),
                } as DesktopModelRef)
              : undefined,
          )
      const ok = 'ok' in result ? result.ok : result.status === 'reachable'
      setNotice(ok ? '连接正常。' : null)
      setError(ok ? null : '连接测试失败；你仍可保存模型并稍后重试。')
    } catch (testError) {
      setError(setupErrorText(testError, '连接测试失败；你仍可保存模型并稍后重试。'))
      setNotice(null)
    } finally {
      setStatus('ready')
    }
  }

  async function finishSetup(): Promise<void> {
    if (!selectedProvider || !modelId) return
    setStatus('saving')
    setError(null)
    let modelSaved = false
    try {
      await persistRecentNewThreadModel({
        providerID: selectedProvider.providerID,
        id: modelId,
        ...(variant ? { variant } : {}),
      })
      const nextState = await desktopClient.getModelProviderState(selectedProvider.providerID)
      const sameSelection =
        nextState.selectedProviderID === selectedProvider.providerID &&
        nextState.apiKeyConfigured &&
        nextState.model === modelId
      if (!sameSelection) {
        setError('保存结果与所选不一致，请重试。')
        setStatus('error')
        return
      }
      modelSaved = true
      settings.syncExternalSettingsPatch({
        providerID: nextState.selectedProviderID,
        providerBaseURL: nextState.baseURL ?? '',
        selectedModelPreset: modelId,
      })
      await providerManagementStore.refresh()
      await settings.saveFirstUseSetupCompleted(1)
      window.dispatchEvent(new Event('desktop:model-provider-changed'))
      navigate('/new', { replace: true })
    } catch (saveError) {
      setError(
        setupErrorText(
          saveError,
          modelSaved ? '模型已保存，但首次引导状态保存失败，请重试。' : '模型保存失败，请重试。',
        ),
      )
      setStatus('error')
    }
  }

  return (
    <div
      className="model-setup-page tw:grid tw:h-screen tw:w-full tw:min-w-0 tw:grid-rows-[36px_minmax(0,1fr)] tw:overflow-hidden tw:bg-app-canvas tw:text-app-text"
      ref={startupSurfaceReadyRef}
    >
      <header className="model-setup-titlebar tw:flex tw:h-9 tw:[-webkit-app-region:drag] tw:min-w-0 tw:items-center tw:justify-between tw:border-b-[0.5px] tw:border-b-app-border-subtle">
        <span className="model-setup-brand tw:ps-4 tw:text-app-text-soft tw:type-control tw:tracking-[0.01em]">
          Pidex
        </span>
        <WindowControls
          isMaximized={isMaximized}
          onClose={() => void desktopClient.closeWindow()}
          onMinimize={() => void desktopClient.minimizeWindow()}
          onToggleMaximize={() => {
            void desktopClient.toggleWindowMaximized().then(setIsMaximized)
          }}
        />
      </header>

      <main className="model-setup-main tw:grid tw:min-h-0 tw:overflow-auto tw:place-items-center tw:px-8 tw:pt-10 tw:pb-14 tw:max-[1040px]:px-6 tw:max-[760px]:items-start tw:max-[760px]:px-5 tw:max-[760px]:py-7 tw:[@media_(height<=700px)]:items-start tw:[@media_(height<=700px)]:justify-items-center tw:[@media_(height<=700px)]:py-7">
        <section
          className="model-setup-workspace tw:grid tw:w-[min(640px,100%)] tw:min-w-0 tw:gap-7"
          aria-labelledby="model-setup-title"
        >
          <header className="model-setup-heading tw:grid tw:grid-cols-[36px_minmax(0,1fr)] tw:gap-5 tw:max-[760px]:grid-cols-1 tw:max-[760px]:gap-4">
            <div
              className="model-setup-progress tw:grid tw:grid-rows-[28px_18px_28px] tw:justify-items-center tw:pt-1 tw:max-[760px]:grid-cols-[28px_18px_28px] tw:max-[760px]:grid-rows-[28px] tw:max-[760px]:items-center tw:max-[760px]:justify-start tw:max-[760px]:pt-0"
              aria-label={`第 ${step === 'provider' ? 1 : 2} 步，共 2 步`}
            >
              <span
                className="tw:grid tw:size-7 tw:place-items-center tw:rounded-full tw:border-[0.5px] tw:border-app-border-strong tw:bg-app-canvas tw:text-app-text-meta tw:[font-size:var(--cpx-sys-font-size-sm)] tw:type-weight-label tw:data-[active=true]:border-app-text tw:data-[active=true]:text-app-text"
                data-active="true"
              >
                1
              </span>
              <i
                aria-hidden
                className="tw:h-[18px] tw:w-[0.5px] tw:bg-app-border-strong tw:max-[760px]:h-[0.5px] tw:max-[760px]:w-[18px]"
              />
              <span
                className="tw:grid tw:size-7 tw:place-items-center tw:rounded-full tw:border-[0.5px] tw:border-app-border-strong tw:bg-app-canvas tw:text-app-text-meta tw:[font-size:var(--cpx-sys-font-size-sm)] tw:type-weight-label tw:data-[active=true]:border-app-text tw:data-[active=true]:text-app-text"
                data-active={step === 'model' || undefined}
              >
                2
              </span>
            </div>
            <div>
              <p className="model-setup-eyebrow tw:text-app-text-meta tw:type-label tw:tracking-[0.04em] tw:uppercase">
                {step === 'provider' ? '1 / 2 · 连接供应商' : '2 / 2 · 选择模型'}
              </p>
              <h1
                className="tw:mx-0 tw:mt-1 tw:mb-2 tw:text-app-text tw:type-title-xl tw:tracking-[-0.025em]"
                id="model-setup-title"
              >
                {step === 'provider' ? '先连接一个模型供应商' : '选择模型'}
              </h1>
              <p className="tw:m-0 tw:text-app-text-soft tw:[line-height:var(--cpx-sys-line-height-normal)]">
                {step === 'provider'
                  ? '凭据只会保存到现有安全凭据仓库。连接测试可稍后进行。'
                  : '新任务会记住你最近选择的模型，之后仍可在任务中随时切换。'}
              </p>
            </div>
          </header>

          {step === 'provider' ? (
            <div className="model-setup-content tw:grid tw:min-w-0 tw:gap-4 tw:ps-14 tw:max-[760px]:ps-0">
              <SearchInput
                aria-label="搜索供应商"
                mode="combobox"
                controls={providerListboxId.current}
                expanded
                activeDescendant={
                  providerNav.activeIndex >= 0
                    ? `model-setup-provider-option-${providerNav.activeIndex}`
                    : undefined
                }
                onChange={(value) => {
                  setProviderQuery(value)
                  providerNav.moveToFirst()
                }}
                onKeyDown={providerNav.onKeyDown}
                placeholder="搜索供应商"
                value={providerQuery}
              />
              <div
                aria-label="供应商"
                className="model-setup-provider-list tw:min-h-0 tw:max-h-[248px] tw:overflow-auto tw:border-y-[0.5px] tw:border-app-border-subtle"
                id={providerListboxId.current}
                onKeyDown={providerNav.onKeyDown}
                role="listbox"
              >
                {filteredProviders.map((provider, index) => {
                  const connected = isProviderConnected(provider, configuration)
                  const selected = provider.providerID === providerId
                  return (
                    <button
                      aria-selected={selected}
                      className="model-setup-provider-row tw:flex tw:w-full tw:min-h-[58px] tw:items-center tw:gap-3 tw:rounded-none tw:border-0 tw:border-b-[0.5px] tw:border-b-app-border-subtle tw:bg-transparent tw:p-3 tw:text-start tw:last:border-b-0 tw:hover:bg-app-underlay tw:data-[active=true]:bg-app-underlay tw:data-[selected=true]:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_6%,transparent)] tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-offset-[-2px] tw:focus-visible:outline-app-focus"
                      data-active={providerNav.activeIndex === index || undefined}
                      data-selected={selected || undefined}
                      id={`model-setup-provider-option-${index}`}
                      key={provider.providerID}
                      role="option"
                      tabIndex={-1}
                      type="button"
                      onClick={() => chooseProvider(provider)}
                      onMouseEnter={() => providerNav.setActive(index)}
                    >
                      <ProviderIcon
                        className="model-setup-provider-logo tw:grid tw:size-3.5 tw:shrink-0 tw:place-items-center tw:rounded-md tw:object-contain tw:[&_svg]:size-3.5 tw:[&_svg]:text-app-text-meta"
                        fallback={<Server data-icon-kind="artwork" size={14} aria-hidden />}
                        logoURL={provider.logoURL}
                        providerID={provider.providerID}
                      />
                      <span className="model-setup-provider-copy tw:grid tw:min-w-0 tw:flex-1 tw:gap-1">
                        <strong className="tw:overflow-hidden tw:type-weight-label tw:text-ellipsis tw:whitespace-nowrap">
                          {provider.displayName}
                        </strong>
                        <small className="tw:overflow-hidden tw:text-app-text-meta tw:[font-size:var(--cpx-sys-font-size-xs)] tw:text-ellipsis tw:whitespace-nowrap">
                          {provider.providerID} · {provider.defaultModels.length} 个模型
                        </small>
                      </span>
                      <span
                        className="model-setup-provider-status tw:inline-flex tw:shrink-0 tw:items-center tw:gap-1 tw:text-app-text-meta tw:[font-size:var(--cpx-sys-font-size-xs)] tw:[&_svg]:size-[var(--inline-icon-size,1em)] tw:data-[connected=true]:text-app-success"
                        data-connected={connected || undefined}
                      >
                        {connected ? (
                          <>
                            <Check size={APP_ICON_SIZES.sm} aria-hidden />
                            已连接
                          </>
                        ) : (
                          '未连接'
                        )}
                      </span>
                    </button>
                  )
                })}
                {filteredProviders.length === 0 ? (
                  <p className="model-setup-empty tw:m-0 tw:px-3 tw:py-5 tw:text-center tw:text-app-text-meta">
                    没有匹配的供应商。
                  </p>
                ) : null}
              </div>

              {selectedProvider ? (
                <div className="model-setup-connection tw:grid tw:gap-4 tw:pt-1 tw:pb-4 tw:border-b-[0.5px] tw:border-b-app-border-subtle">
                  <div className="model-setup-connection-heading tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-3 tw:max-[760px]:flex-col tw:max-[760px]:items-stretch">
                    <div>
                      <strong className="tw:overflow-hidden tw:type-weight-label tw:text-ellipsis tw:whitespace-nowrap">
                        {selectedProvider.displayName}
                      </strong>
                      <p className="tw:m-0 tw:text-app-text-soft tw:[line-height:var(--cpx-sys-line-height-normal)]">
                        {providerConnected
                          ? '此供应商已经可以用于模型请求。'
                          : '添加 API Key，或使用供应商支持的 OAuth。'}
                      </p>
                    </div>
                    {providerConnected ? (
                      <span className="model-setup-connected tw:inline-flex tw:shrink-0 tw:items-center tw:gap-1 tw:text-app-success tw:[font-size:var(--cpx-sys-font-size-xs)] tw:[&_svg]:size-[var(--inline-icon-size,1em)]">
                        <Check size="var(--inline-icon-size, 1em)" aria-hidden />
                        已连接
                      </span>
                    ) : null}
                  </div>
                  {!providerConnected && supportsApiKey ? (
                    <ApiKeyEditorForm
                      busy={status === 'saving'}
                      className="model-setup-key-form tw:grid tw:gap-3 tw:[&_.model-center-key-dialog-fields]:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] tw:[&_.model-center-key-dialog-fields]:items-end tw:[&_.model-center-key-dialog-fields]:gap-3 tw:[&_.model-center-key-dialog-fields]:p-0 tw:[&_.model-center-field]:gap-2 tw:[&_.model-center-field]:text-app-text-soft tw:[&_.model-center-field]:[font-size:var(--cpx-sys-font-size-xs)] tw:[&_.model-center-key-dialog-actions]:border-0 tw:[&_.model-center-key-dialog-actions]:bg-transparent tw:[&_.model-center-key-dialog-actions]:p-0 tw:max-[760px]:[&_.model-center-key-dialog-fields]:grid-cols-1"
                      defaultLabel={
                        selectedProvider ? `${selectedProvider.displayName} 账号` : '个人账号'
                      }
                      hideProvider
                      initialProviderId={selectedProvider.providerID}
                      providers={keyFormProviders}
                      resetSignal={selectedProvider.providerID}
                      submitLabel="安全保存"
                      onSubmit={saveApiKey}
                    />
                  ) : null}
                  {!providerConnected && selectedProvider.authMethods?.includes('oauth') ? (
                    <OAuthConnection
                      connected={false}
                      description="在浏览器完成授权，连接此供应商。"
                      target={
                        { kind: 'provider', providerId: selectedProvider.providerID } as never
                      }
                      title={
                        selectedProvider.providerID === 'openai'
                          ? '使用 ChatGPT 登录'
                          : `${selectedProvider.displayName} OAuth 授权`
                      }
                      onChanged={async () => {
                        await providerManagementStore.refresh()
                        setStep('model')
                        setNotice('供应商已连接。')
                        window.dispatchEvent(new Event('desktop:model-provider-changed'))
                      }}
                    />
                  ) : null}
                  <div className="model-setup-actions tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-3 tw:max-[760px]:flex-col tw:max-[760px]:items-stretch">
                    <Button
                      color="secondary"
                      disabled={!providerConnected}
                      onClick={continueToModels}
                    >
                      继续
                    </Button>
                  </div>
                </div>
              ) : null}

              <Button color="ghostSecondary" onClick={() => setProviderEditorOpen(true)}>
                添加自定义供应商
              </Button>
            </div>
          ) : (
            <div className="model-setup-content tw:grid tw:min-w-0 tw:gap-4 tw:ps-14 tw:max-[760px]:ps-0">
              <div className="model-setup-model-toolbar tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-3 tw:max-[760px]:flex-col tw:max-[760px]:items-stretch">
                <SearchInput
                  className="tw:flex-1"
                  aria-label="搜索模型"
                  mode="combobox"
                  controls={modelListboxId.current}
                  expanded
                  activeDescendant={
                    modelNav.activeIndex >= 0
                      ? `model-setup-model-option-${modelNav.activeIndex}`
                      : undefined
                  }
                  onChange={(value) => {
                    setModelQuery(value)
                    modelNav.moveToFirst()
                  }}
                  onKeyDown={modelNav.onKeyDown}
                  placeholder="搜索模型"
                  value={modelQuery}
                />
                <Button
                  color="ghostSecondary"
                  disabled={status === 'loading'}
                  onClick={() => {
                    setStep('provider')
                    setNotice(null)
                    setError(null)
                  }}
                >
                  <ChevronLeft size={APP_ICON_SIZE} aria-hidden />
                  更换供应商
                </Button>
              </div>
              <div
                aria-label="模型"
                className="model-setup-model-list tw:min-h-0 tw:max-h-[248px] tw:overflow-auto tw:border-y-[0.5px] tw:border-app-border-subtle"
                id={modelListboxId.current}
                onKeyDown={modelNav.onKeyDown}
                role="listbox"
              >
                {filteredModels.map((id, index) => {
                  const metadata = modelMetadata[id]
                  return (
                    <button
                      aria-selected={modelId === id}
                      className="model-setup-model-row tw:flex tw:w-full tw:min-h-[58px] tw:items-center tw:gap-3 tw:rounded-none tw:border-0 tw:border-b-[0.5px] tw:border-b-app-border-subtle tw:bg-transparent tw:p-3 tw:text-start tw:last:border-b-0 tw:hover:bg-app-underlay tw:data-[active=true]:bg-app-underlay tw:data-[selected=true]:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_6%,transparent)] tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-offset-[-2px] tw:focus-visible:outline-app-focus"
                      data-active={modelNav.activeIndex === index || undefined}
                      data-selected={modelId === id || undefined}
                      id={`model-setup-model-option-${index}`}
                      key={id}
                      role="option"
                      tabIndex={-1}
                      type="button"
                      onClick={() => {
                        setModelId(id)
                        setVariant('')
                      }}
                      onMouseEnter={() => modelNav.setActive(index)}
                    >
                      <span className="tw:grid tw:min-w-0 tw:flex-1 tw:gap-1">
                        <strong className="tw:overflow-hidden tw:type-weight-label tw:text-ellipsis tw:whitespace-nowrap">
                          {metadata?.name ?? id}
                        </strong>
                        <small className="tw:overflow-hidden tw:text-app-text-meta tw:[font-size:var(--cpx-sys-font-size-xs)] tw:text-ellipsis tw:whitespace-nowrap">
                          {id}
                        </small>
                      </span>
                      <span className="model-setup-model-capabilities tw:inline-flex tw:shrink-0 tw:gap-2 tw:text-app-text-meta tw:[font-size:var(--cpx-sys-font-size-xs)]">
                        {metadata?.reasoning ? '推理' : null}
                        {metadata?.vision ? '图片' : null}
                      </span>
                      {modelId === id ? (
                        <Check
                          className="tw:size-[var(--inline-icon-size,1em)]"
                          size={APP_ICON_SIZES.sm}
                          aria-hidden
                        />
                      ) : null}
                    </button>
                  )
                })}
                {status === 'loading' ? (
                  <p className="model-setup-empty tw:m-0 tw:px-3 tw:py-5 tw:text-center tw:text-app-text-meta">
                    正在加载模型目录…
                  </p>
                ) : null}
                {status !== 'loading' && filteredModels.length === 0 ? (
                  <p className="model-setup-empty tw:m-0 tw:px-3 tw:py-5 tw:text-center tw:text-app-text-meta">
                    没有匹配的模型。
                  </p>
                ) : null}
              </div>
              {selectedVariants.length > 0 ? (
                <label className="model-setup-variants tw:grid tw:min-w-0 tw:gap-2 tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-xs)]">
                  <span>模型变体</span>
                  <select
                    className="tw:h-7 tw:w-full tw:rounded-control tw:border-[0.5px] tw:border-app-border-strong tw:bg-app-canvas tw:px-3 tw:text-app-text tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-offset-[-2px] tw:focus-visible:outline-app-focus"
                    value={variant}
                    onChange={(event) => setVariant(event.target.value)}
                  >
                    <option value="">默认</option>
                    {selectedVariants.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="model-setup-actions model-setup-actions--finish tw:flex tw:min-w-0 tw:items-center tw:justify-end tw:gap-3 tw:max-[760px]:flex-col tw:max-[760px]:items-end">
                <Button
                  color="ghostSecondary"
                  disabled={status === 'loading'}
                  onClick={() => void testConnection()}
                >
                  测试连接（可选）
                </Button>
                {status === 'error' ? (
                  <Button
                    color="secondary"
                    onClick={() => setModelReloadToken((token) => token + 1)}
                  >
                    重试
                  </Button>
                ) : null}
                <Button
                  color="secondary"
                  disabled={!modelId}
                  loading={status === 'saving'}
                  onClick={() => void finishSetup()}
                >
                  开始使用
                </Button>
              </div>
            </div>
          )}

          <div
            className="model-setup-feedback tw:min-h-5 tw:ps-14 tw:[font-size:var(--cpx-sys-font-size-sm)] tw:max-[760px]:ps-0"
            aria-live="polite"
          >
            {notice ? (
              <p className="model-setup-notice tw:m-0 tw:text-app-text-soft">{notice}</p>
            ) : null}
            {error ? <p className="model-setup-error tw:m-0 tw:text-app-danger">{error}</p> : null}
          </div>
        </section>
      </main>

      <ProviderEditorDialog
        existingProviderIds={configuration.providers.map((provider) => provider.providerID)}
        open={providerEditorOpen}
        onOpenChange={setProviderEditorOpen}
        onSaved={async (savedProviderId) => {
          const next = await providerManagementStore.refresh()
          const saved = next.providers.find((provider) => provider.providerID === savedProviderId)
          setProviderId(savedProviderId as ModelProviderID)
        }}
      />
    </div>
  )
}

function useListboxNavigation({
  count,
  onSelect,
}: {
  count: number
  onSelect: (index: number) => void
}): {
  activeIndex: number
  moveToFirst: () => void
  setActive: (index: number) => void
  onKeyDown: (event: React.KeyboardEvent) => void
} {
  const [activeIndex, setActiveIndex] = useState(-1)
  const moveToFirst = useCallback(() => setActiveIndex(count > 0 ? 0 : -1), [count])
  const setActive = useCallback((index: number) => setActiveIndex(index), [])
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (count === 0) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveIndex((current) => {
          if (current < 0) return event.key === 'ArrowDown' ? 0 : count - 1
          const next = current + (event.key === 'ArrowDown' ? 1 : -1)
          if (next < 0) return count - 1
          if (next >= count) return 0
          return next
        })
        return
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        setActiveIndex(event.key === 'Home' ? 0 : count - 1)
        return
      }
      if (event.key === 'Enter' && activeIndex >= 0 && activeIndex < count) {
        event.preventDefault()
        onSelect(activeIndex)
      }
    },
    [activeIndex, count, onSelect],
  )
  return { activeIndex, moveToFirst, setActive, onKeyDown }
}

function isProviderConnected(
  provider: DesktopModelProviderSummary,
  configuration: Pick<ProviderConfigurationState, 'credentials' | 'currentProviderState'>,
): boolean {
  // 只认可：Agent authConfigured 状态、enabled 且 active 的安全凭据，
  // 或当前 Provider state 明确返回已配置凭据；enabled 但未激活的凭据不算连接。
  if (provider.apiKeyConfigured) return true
  if (
    configuration.credentials.some(
      (credential) =>
        credential.providerId === provider.providerID && credential.enabled && credential.active,
    )
  )
    return true
  return (
    configuration.currentProviderState?.selectedProviderID === provider.providerID &&
    configuration.currentProviderState.apiKeyConfigured
  )
}

function setupErrorText(error: unknown, fallback: string): string {
  if (error instanceof AgentRpcError) {
    switch (error.errorCode) {
      case 'RATE_LIMITED':
        return '操作过于频繁，请稍后重试。'
      case 'CONFLICT':
        return '当前操作冲突，请重试。'
      case 'PERMISSION_DENIED':
        return '没有执行此操作的权限。'
      case 'MODEL_UNAVAILABLE':
        return '所选模型当前不可用，请选择其他模型。'
      case 'CURSOR_EXPIRED':
        return '模型目录已刷新，请重新选择。'
      case 'AGENT_OPERATION_UNSUPPORTED':
        return '当前 Agent 不支持此操作，请重启后重试。'
    }
    if (error.status === 429) return '操作过于频繁，请稍后重试。'
  }
  if (error instanceof Error && /fetch|network|timeout|socket|connect|ECONN/i.test(error.message)) {
    return '无法连接本地 Agent，请确认 Agent 已启动后重试。'
  }
  return fallback
}
