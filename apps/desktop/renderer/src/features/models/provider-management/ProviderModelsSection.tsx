import * as Dialog from '@radix-ui/react-dialog'
import {
  Activity,
  ChevronRight,
  RefreshCw,
  Pencil,
  Plus,
  Minus,
  X,
  Brain,
  Eye,
  Wrench,
  Server,
} from 'lucide-react'
import type React from 'react'
import { useId, useMemo, useState } from 'react'
import type {
  DesktopModelMetadata,
  DesktopModelProviderSummary,
  DesktopProviderDefinition,
  ModelProviderID,
  DesktopProviderModelDefinition,
} from '../../../../shared/Types.js'
import type { ModelTestStatus } from '../UseModelCenterController.js'
import { Button } from '../../../components/ui/Button.js'
import { groupProviderModels } from '../ModelCenterState.js'
import { ProviderIcon } from '../ProviderIcon.js'
import { modelsDevLogoURL } from '../../../services/desktop-client/ProviderLogoBrands.js'
import { SearchHeading } from '../../../components/ui/SearchHeading.js'
import { SearchInput } from '../../../components/ui/SearchInput.js'
import { DisclosureContent } from '../../../components/ui/DisclosureContent.js'
import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { fullErrorMessage } from '../../../utils/Errors.js'
import { formatCompactNumber } from '../../../utils/UsageFormatters.js'
import { isExecutableDesktopProvider } from '../../../services/desktop-client/ProviderAdapters.js'
import { ProviderModelDialog } from './ProviderModelDialog.js'
import { editableModel, normalizeEditableModel } from './ProviderEditorForm.js'
import { Checkbox } from '../../../components/ui/Checkbox.js'
import { useDialogFocusRestore } from '../../../components/ui/UseDialogFocusRestore.js'
import { ConfirmationDialog } from '../../../components/ui/ConfirmationDialog.js'
import { desktopClient } from '../../../services/desktop-client/index.js'

export type ProviderModelsSectionProps = {
  provider: DesktopModelProviderSummary
  editingBlocked?: boolean
  models: readonly string[]
  modelMetadata?: Record<string, DesktopModelMetadata>
  busy: boolean
  testResults: Readonly<Record<string, ModelTestStatus>>
  onTestModels: (ids: readonly string[]) => Promise<void>
  onFetchModels: () => Promise<void>
  onSaveDefinition: (
    definition: DesktopProviderDefinition,
    providerId?: ModelProviderID,
  ) => Promise<void>
  onRefresh: () => Promise<void>
  onNotice: (message: string) => void
  onError: (message: string) => void
}

export function ProviderModelsSection({
  provider,
  editingBlocked = false,
  models,
  modelMetadata = {},
  busy,
  testResults,
  onTestModels,
  onFetchModels,
  onSaveDefinition,
  onRefresh,
  onNotice,
  onError,
}: ProviderModelsSectionProps): React.ReactNode {
  const [searchQuery, setSearchQuery] = useState('')
  const builtinConfig = provider.config?.kind === 'builtin' ? provider.config : null
  const customConfig = provider.config?.kind === 'custom' ? provider.config : null
  const [saving, setSaving] = useState(false)
  const [editingModel, setEditingModel] = useState<{
    model: DesktopProviderModelDefinition
    creating: boolean
    nativeApi?: string
  } | null>(null)
  const [deletingModel, setDeletingModel] = useState<string | null>(null)
  const [discoveredModels, setDiscoveredModels] = useState<DesktopProviderModelDefinition[] | null>(
    null,
  )
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const { onCloseAutoFocus } = useDialogFocusRestore(discoveredModels !== null)
  const executable = isExecutableDesktopProvider(provider)
  const editable = provider.config != null
  async function fetchModels() {
    if (!customConfig) return onFetchModels()
    const api = customConfig.models.find((model) => model.api !== 'anthropic-messages')?.api
    if (!api) {
      onError('此端点不支持 OpenAI /models 发现，可手动添加模型。')
      return
    }
    setSaving(true)
    try {
      const discovered = await desktopClient.discoverProviderModels(provider.providerID, api)
      const existing = new Set(customConfig.models.map((model) => model.id))
      setDiscoveredModels(discovered.filter((model) => !existing.has(model.id)))
      setSelectedModels(new Set())
    } catch (error) {
      onError(fullErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }
  async function importModels() {
    if (!customConfig || !discoveredModels || saving) return
    setSaving(true)
    try {
      await onSaveDefinition(
        {
          ...customConfig,
          models: [
            ...customConfig.models,
            ...discoveredModels.filter((model) => selectedModels.has(model.id)),
          ],
        },
        provider.providerID,
      )
      await onRefresh()
      setDiscoveredModels(null)
      onNotice('模型已添加。')
    } catch (error) {
      onError(fullErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }
  const rows = useMemo(
    () =>
      customConfig
        ? customConfig.models.map((model) => ({
            id: model.id,
            enabled: model.enabled !== false,
            metadata: {
              ...modelMetadata[model.id],
              name: model.name,
              contextWindow: model.contextWindow,
              outputTokens: model.maxTokens,
              reasoning: model.reasoning,
              vision: model.input?.includes('image'),
              providerApi: model.api,
              inputCost: model.cost?.input,
              outputCost: model.cost?.output,
            } as DesktopModelMetadata,
          }))
        : [
            ...new Set([
              ...models,
              ...(builtinConfig?.models.map((model) => String(model.id)) ?? []),
            ]),
          ]
            .filter(
              (id) =>
                !builtinConfig?.denyModels.includes(id as never) &&
                (!builtinConfig?.allowModels.length ||
                  builtinConfig.allowModels.includes(id as never)),
            )
            .map((id) => {
              const override = builtinConfig?.models.find((model) => model.id === id)
              return {
                id,
                enabled:
                  override?.enabled !== false && !builtinConfig?.denyModels.includes(id as never),
                metadata: {
                  ...modelMetadata[id],
                  name: override?.name ?? modelMetadata[id]?.name,
                  contextWindow: override?.contextWindow ?? modelMetadata[id]?.contextWindow,
                  outputTokens: override?.maxTokens ?? modelMetadata[id]?.outputTokens,
                  reasoning: override?.reasoning ?? modelMetadata[id]?.reasoning,
                  vision: override?.input?.includes('image') ?? modelMetadata[id]?.vision,
                  providerApi: override?.api ?? modelMetadata[id]?.providerApi,
                } as DesktopModelMetadata,
              }
            }),
    [customConfig, builtinConfig, models, modelMetadata],
  )

  function openModel(id?: string) {
    const metadata = id ? modelMetadata[id] : undefined
    const protocolMetadata = id ? metadata : modelMetadata[models[0] ?? '']
    const configured = id
      ? (customConfig?.models.find((model) => model.id === id) ??
        builtinConfig?.models.find((model) => model.id === id))
      : undefined
    const api =
      configured?.api ??
      (customConfig?.models.find((model) => !model.modelType || model.modelType === 'chat')?.api) ??
      protocolMetadata?.providerApi ??
      provider.providerApis?.[0] ??
      'openai-completions'
    const nativeApi =
      builtinConfig?.id === 'deepseek'
        ? (builtinConfig.protocol ?? metadata?.providerApi ?? 'openai-completions')
        : builtinConfig && !configured?.api && !protocolMetadata?.providerApi
          ? (protocolMetadata?.nativeApi ??
            (provider.providerApis?.length ? undefined : provider.nativeApis?.[0]))
          : undefined
    const model = {
      id: (id ?? '') as DesktopProviderModelDefinition['id'],
      name: id ? (metadata?.name ?? id) : '',
      api,
      enabled: true,
      contextWindow: metadata?.contextWindow ?? 32_768,
      maxInputTokens: metadata?.inputTokens,
      maxTokens: metadata?.outputTokens ?? 8_192,
      reasoning: metadata?.reasoning ?? false,
      tools: metadata?.toolCall ?? true,
      modelType: metadata?.modelType === 'embedding' || metadata?.modelType === 'rerank' ? metadata.modelType : 'chat',
      input: metadata?.modalities?.input ?? (metadata?.vision ? ['text', 'image'] : ['text']),
      ...configured,
      cost: {
        input: metadata?.inputCost ?? 0,
        output: metadata?.outputCost ?? 0,
        cacheRead: metadata?.cacheReadCost ?? 0,
        cacheWrite: metadata?.cacheWriteCost ?? 0,
        ...configured?.cost,
      },
    } as DesktopProviderModelDefinition
    setEditingModel({ model, creating: !id, ...(nativeApi ? { nativeApi } : {}) })
  }

  async function saveModel(model: DesktopProviderModelDefinition) {
    const config = provider.config
    if (!config || !editingModel) throw new Error('供应商配置尚未加载。')
    const oldId = editingModel.creating ? null : editingModel.model.id
    if (
      config.models.some((item) => item.id === model.id && item.id !== oldId) ||
      (editingModel.creating && models.includes(model.id))
    )
      throw new Error('模型 ID 已存在。')
    if (config.kind === 'custom') {
      await onSaveDefinition(
        { ...config, models: [...config.models.filter((item) => item.id !== oldId), model] },
        provider.providerID,
      )
    } else {
      const previous = config.models.find((item) => item.id === oldId)
      const initial = normalizeEditableModel(editableModel(editingModel.model))
      if (initial instanceof Error) throw initial
      const override: Record<string, unknown> = {
        ...previous,
        id: model.id,
        enabled: model.enabled ?? true,
      }
      for (const [key, value] of Object.entries(model)) {
        if (key === 'api' && editingModel.nativeApi) continue
        if (
          editingModel.creating ||
          JSON.stringify(value) !==
            JSON.stringify(initial[key as keyof DesktopProviderModelDefinition])
        )
          override[key] = value
      }
      await onSaveDefinition(
        {
          ...config,
          models: [...config.models.filter((item) => item.id !== oldId), override as never],
          denyModels: config.denyModels.filter((id) => id !== model.id),
          allowModels:
            config.allowModels.length > 0
              ? [...new Set([...config.allowModels, model.id])]
              : config.allowModels,
        },
        provider.providerID,
      )
    }
    await onRefresh()
    onNotice('模型配置已保存。')
  }

  async function removeModel(id: string) {
    if (!provider.config) return
    setSaving(true)
    try {
      const config = provider.config
      if (config.kind === 'custom' && config.models.length <= 1)
        throw new Error('供应商至少需要保留一个模型。')
      await onSaveDefinition(
        config.kind === 'custom'
          ? { ...config, models: config.models.filter((model) => model.id !== id) }
          : {
              ...config,
              denyModels: [...new Set([...config.denyModels, id as never])],
              models: config.models.map((model) =>
                model.id === id ? { ...model, enabled: false } : model,
              ),
            },
        provider.providerID,
      )
      await onRefresh()
      setDeletingModel(null)
      onNotice('模型已移除。')
    } catch (error) {
      onError(fullErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }
  const filtered = rows.filter(({ id, metadata }) =>
    [
      id,
      metadata?.name,
      metadata?.description,
      ...(metadata?.tags ?? []),
      metadata?.reasoning ? '推理 reasoning' : '',
      metadata?.vision ? '图片 vision' : '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(searchQuery.trim().toLowerCase()),
  )


  return (
    <section
      className="model-center-models-section tw:grid tw:min-w-0 tw:gap-3"
      aria-label="模型列表"
    >
      <header className="tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-3">
        <SearchHeading
          title={
            <div className="tw:flex tw:items-center tw:gap-2">
              <h3 className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:type-title-sm">
                模型 <span className="tw:inline-flex tw:h-6 tw:min-w-6 tw:items-center tw:justify-center tw:rounded-full tw:bg-app-hover tw:px-2 tw:type-body-sm tw:tabular-nums">{rows.length}</span>
              </h3>

            </div>
          }
          search={
            <SearchInput
              aria-label="搜索模型"
              placeholder="搜索模型名称、ID 或能力"
              value={searchQuery}
              onChange={setSearchQuery}
            />
          }
        />
        <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-1">
          <Button
            color="ghostSecondary"
            isIconOnly
            size="toolbar"
            aria-label="测试全部"
            title="测试全部"
            disabled={busy || !executable || !rows.some((row) => row.enabled)}
            onClick={() =>
              void onTestModels(rows.filter((row) => row.enabled).map((row) => row.id))
            }
          >
            <Activity aria-hidden size={APP_ICON_SIZE} />
          </Button>
          <Button
            color="outline"
            size="sm"
            disabled={
              busy || saving || editingBlocked || provider.availability?.status === 'unavailable'
            }
            onClick={() => void fetchModels()}
          >
            <RefreshCw aria-hidden size={APP_ICON_SIZES.sm} />
            同步模型
          </Button>
          {provider.config && editable ? (
            <Button
              color="outline"
              isIconOnly
              size="sm"
              aria-label="添加模型"
              title="添加模型"
              disabled={busy || saving || editingBlocked}
              onClick={() => openModel()}
            >
              <Plus aria-hidden size={APP_ICON_SIZES.sm} />
            </Button>
          ) : null}
        </div>
      </header>
      <div className="model-center-models-list tw:grid tw:min-w-0 tw:gap-3">
        {groupProviderModels(filtered, provider.providerID).map((group) => (
          <ModelGroup key={group.id} id={group.id} searchActive={searchQuery.trim().length > 0}>
            {group.models.map((row) => (
              <ModelRowItem
                key={row.id}
                modelId={row.id}
                metadata={row.metadata}
                disabled={busy || !executable || !row.enabled}
                enabled={row.enabled}
                testStatus={testResults[`${provider.providerID}/${row.id}`]}
                onTest={() => void onTestModels([row.id])}
                onEdit={() => openModel(row.id)}
                onRemove={() => setDeletingModel(row.id)}
                editingDisabled={busy || saving || editingBlocked || !provider.config || !editable}
                logoURL={
                  group.id === provider.providerID ? provider.logoURL : modelsDevLogoURL(group.id)
                }
              />
            ))}
          </ModelGroup>
        ))}
        {filtered.length === 0 ? (
          <p className="tw:px-3 tw:py-4 tw:text-app-text-soft tw:type-body-sm">
            {rows.length === 0 ? '尚无模型，请同步目录或添加模型。' : '未找到匹配的模型。'}
          </p>
        ) : null}
      </div>
      {editingModel ? (
        <ProviderModelDialog
          providerId={provider.providerID}
          baseUrl={provider.baseURL ?? ''}
          model={editingModel.model}
          creating={editingModel.creating}
          {...(editingModel.nativeApi ? { nativeApi: editingModel.nativeApi } : {})}
          onSave={saveModel}
          onClose={() => setEditingModel(null)}
        />
      ) : null}
      <Dialog.Root
        open={discoveredModels !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setDiscoveredModels(null)
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
          <Dialog.Content
            onCloseAutoFocus={onCloseAutoFocus}
            className="ui-dialog-surface ui-dialog-surface--centered settings-management-dialog tw:w-[min(680px,calc(100vw_-_32px))] tw:max-h-[85vh] tw:overflow-y-auto"
          >
            <header className="settings-management-dialog-header">
              <div className="settings-management-dialog-heading">
                <Dialog.Title>添加远端模型</Dialog.Title>
                <Dialog.Description>
                  从 API 地址的 /models 目录选择尚未配置的模型，确认后保存。
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <Button
                  color="ghostSecondary"
                  isIconOnly
                  size="toolbar"
                  disabled={saving}
                  aria-label="关闭模型发现"
                >
                  <X aria-hidden size={APP_ICON_SIZE} />
                </Button>
              </Dialog.Close>
            </header>
            <div className="settings-management-dialog-body tw:grid tw:gap-2">
              {discoveredModels?.length === 0 ? (
                <p>远端目录没有尚未配置的模型。</p>
              ) : (
                discoveredModels?.map((model) => (
                  <label
                    key={model.id}
                    className="tw:flex tw:items-center tw:gap-3 tw:type-body-sm"
                  >
                    <Checkbox
                      ariaLabel={`选择模型 ${model.id}`}
                      checked={selectedModels.has(model.id)}
                      disabled={saving}
                      onCheckedChange={(checked) =>
                        setSelectedModels((current) => {
                          const next = new Set(current)
                          if (checked === true) next.add(model.id)
                          else next.delete(model.id)
                          return next
                        })
                      }
                    />
                    <span>
                      {model.name ?? model.id} · {model.id}
                    </span>
                  </label>
                ))
              )}
            </div>
            <footer className="settings-management-dialog-footer">
              <Button
                size="md"
                color="secondary"
                disabled={saving}
                onClick={() => setDiscoveredModels(null)}
              >
                取消
              </Button>
              <Button
                size="md"
                color="primary"
                disabled={saving || selectedModels.size === 0}
                loading={saving}
                onClick={() => void importModels()}
              >
                添加所选模型
              </Button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ConfirmationDialog
        open={deletingModel !== null}
        title="移除模型？"
        description={
          builtinConfig
            ? '将此模型加入排除列表，可通过模型筛选恢复。'
            : '将从供应商配置中移除此模型。'
        }
        actionLabel="移除"
        actionDisabled={saving}
        onAction={() => {
          if (deletingModel) void removeModel(deletingModel)
        }}
        onCancel={() => setDeletingModel(null)}
      />
    </section>
  )
}

function ModelGroup({
  id,
  searchActive,
  children,
}: {
  id: string
  searchActive: boolean
  children: React.ReactNode
}): React.ReactNode {
  const [collapsed, setCollapsed] = useState(false)
  const contentId = useId()
  const expanded = searchActive || !collapsed
  return (
    <section className="tw:min-w-0 tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle">
      <button
        type="button"
        className="tw:flex tw:w-full tw:items-center tw:gap-2 tw:bg-app-panel tw:px-4 tw:py-3 tw:text-left tw:type-row-title"
        aria-label={`模型分组 ${id}`}
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setCollapsed(!collapsed)}
      >
        <ChevronRight
          aria-hidden
          size={APP_ICON_SIZE}
          className={expanded ? 'tw:rotate-90' : undefined}
        />
        {id}
      </button>
      <DisclosureContent id={contentId} expanded={expanded} contentClassName="tw:grid tw:gap-0">
        {children}
      </DisclosureContent>
    </section>
  )
}

function ModelRowItem({
  modelId,
  metadata,
  disabled,
  enabled,
  testStatus,
  onTest,
  onEdit,
  onRemove,
  editingDisabled,
  logoURL,
}: {
  modelId: string
  metadata?: DesktopModelMetadata
  disabled: boolean
  enabled: boolean
  testStatus?: ModelTestStatus
  onTest: () => void
  onEdit: () => void
  onRemove: () => void
  editingDisabled: boolean
  logoURL?: string
}): React.ReactNode {
  const details = `${modelId} · 上下文 ${metadata?.contextWindow ? formatCompactNumber(metadata.contextWindow) : '未知'} / 输出 ${metadata?.outputTokens ? formatCompactNumber(metadata.outputTokens) : '未知'}${enabled ? '' : ' · 已停用'}`
  return (
    <article
      className="model-center-model-row tw:flex tw:min-w-0 tw:items-center tw:gap-3 tw:px-4 tw:py-3 tw:hover:bg-app-hover"
      title={details}
    >
      <span className="tw:flex tw:size-5 tw:shrink-0 tw:items-center tw:justify-center">
        <ProviderIcon
          logoURL={logoURL}
          className="tw:size-full"
          imageClassName="tw:object-contain tw:[.dark-theme_&]:invert tw:[.dark-theme_&]:hue-rotate-180"
          fallback={<Server aria-hidden size={APP_ICON_SIZE} />}
        />
      </span>
      <button
        type="button"
        className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-left tw:type-row-title"
        aria-label={`编辑模型 ${modelId}`}
        disabled={editingDisabled}
        onClick={onEdit}
      >
        {metadata?.name || modelId}
      </button>
      <div className="tw:flex tw:shrink-0 tw:items-center tw:gap-2 tw:text-app-text-soft">
        {metadata?.reasoning ? (
          <span role="img" aria-label="推理" title="推理">
            <Brain aria-hidden size={APP_ICON_SIZE} />
          </span>
        ) : null}
        {metadata?.vision ? (
          <span role="img" aria-label="图片输入" title="图片输入">
            <Eye aria-hidden size={APP_ICON_SIZE} />
          </span>
        ) : null}
        {metadata?.toolCall ? (
          <span role="img" aria-label="工具调用" title="工具调用">
            <Wrench aria-hidden size={APP_ICON_SIZE} />
          </span>
        ) : null}
        {testStatus?.state === 'reachable' ? (
          <span role="status" className="tw:text-app-success tw:type-caption">
            {testStatus.latencyMs} ms
          </span>
        ) : testStatus?.state === 'failed' ? (
          <span
            role="status"
            className="tw:text-app-danger tw:type-caption"
            title={testStatus.message}
          >
            失败
          </span>
        ) : null}
        <Button
          color="ghostSecondary"
          isIconOnly
          size="toolbar"
          disabled={disabled}
          aria-label={`测试模型 ${modelId}`}
          title={`测试模型 ${modelId}`}
          loading={testStatus?.state === 'testing'}
          onClick={onTest}
        >
          <Activity aria-hidden size={APP_ICON_SIZE} />
        </Button>
        <Button
          color="ghostSecondary"
          isIconOnly
          size="toolbar"
          aria-label={`模型设置 ${modelId}`}
          title={`模型设置 ${modelId}`}
          disabled={editingDisabled}
          onClick={onEdit}
        >
          <Pencil aria-hidden size={APP_ICON_SIZE} />
        </Button>
        <Button
          color="ghostSecondary"
          isIconOnly
          size="toolbar"
          aria-label={`移除模型 ${modelId}`}
          title={`移除模型 ${modelId}`}
          disabled={editingDisabled}
          onClick={onRemove}
        >
          <Minus aria-hidden size={APP_ICON_SIZE} />
        </Button>
      </div>
    </article>
  )
}
