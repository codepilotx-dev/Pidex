import { useSmartModelConfig } from './UseSmartModelConfig.js'
import * as Dialog from '@radix-ui/react-dialog'
import {
  AlertTriangle,
  Brain,
  Cable,
  ChevronDown,
  ChevronRight,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import type React from 'react'
import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import type {
  DesktopCustomProviderDefinition,
  DesktopModelProviderSummary,
  DesktopProviderDefinition,
  ModelProviderID,
  DesktopProviderModelDefinition,
} from '../../../../shared/Types.js'
import { Dropdown } from '../../../components/ui/Dropdown.js'
import { PopoverItem } from '../../../components/ui/PopoverItem.js'
import { ProviderEditorNavigationGuard } from './ProviderEditorNavigationGuard.js'
import { newCustomProviderId, providerApiFormat } from './ProviderEditorState.js'
import { Button } from '../../../components/ui/Button.js'

import { Input } from '../../../components/ui/Input.js'
import { SegmentedControl } from '../../../components/ui/SegmentedControl.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import { DisclosureContent } from '../../../components/ui/DisclosureContent.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import { useDialogFocusRestore } from '../../../components/ui/UseDialogFocusRestore.js'
import { useLastNonNull } from '../../../hooks/UsePresenceRetention.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { SettingsDropdown } from '../../settings/SettingsDropdown.js'
import { PROVIDER_PRESETS, type ProviderPreset } from './ProviderEditorPresets.js'
import { cx } from '../../../utils/Cx.js'
import {
  DEEPSEEK_PROTOCOL_OPTIONS,
  DEFAULT_DEEPSEEK_PROTOCOL,
  buildDeepSeekProtocolDefinition,
  deepSeekManagedProvider,
  deepSeekProtocolOf,
  deepSeekProtocolOption,
  type DeepSeekProtocol,
} from './DeepseekProtocol.js'

const API_OPTIONS = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions (/chat/completions)' },
  { value: 'openai-responses', label: 'OpenAI Responses (/responses)' },
  { value: 'anthropic-messages', label: 'Anthropic Messages (/v1/messages)' },
] as const

const BUILTIN_PROVIDER_IDS: ReadonlySet<string> = new Set([
  'amazon-bedrock',
  'ant-ling',
  'anthropic',
  'azure-openai-responses',
  'baseten',
  'cerebras',
  'cloudflare-ai-gateway',
  'cloudflare-workers-ai',
  'deepseek',
  'fireworks',
  'github-copilot',
  'google',
  'google-vertex',
  'groq',
  'huggingface',
  'kimi-coding',
  'minimax',
  'minimax-cn',
  'mistral',
  'moonshotai',
  'moonshotai-cn',
  'nvidia',
  'openai',
  'openai-codex',
  'opencode',
  'opencode-go',
  'openrouter',
  'qwen-token-plan',
  'qwen-token-plan-cn',
  'qwen-token-plan-individual',
  'radius',
  'together',
  'vercel-ai-gateway',
  'xai',
  'xiaomi',
  'xiaomi-token-plan-ams',
  'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp',
  'zai',
  'zai-coding-cn',
])

type Api = DesktopProviderModelDefinition['api']

export type EditableModel = {
  original?: DesktopProviderModelDefinition
  editorKey: string
  id: string
  name: string
  api: Api
  enabled: boolean
  contextWindow: number
  maxInputTokens?: number
  maxTokens: number
  reasoning: boolean
  imageInput: boolean
  audioInput?: boolean
  videoInput?: boolean
  tools?: boolean
  modelType?: 'chat' | 'embedding' | 'rerank'
  inputCost: number
  outputCost: number
  cacheReadCost: number
  cacheWriteCost: number
  headers: string
  thinkingLevelMap: string
  compat: string
}

type DialogTab = 'basic' | 'models' | 'advanced'

export type ProviderEditorFormProps = {
  onSaveDefinition?: (
    definition: DesktopProviderDefinition,
    providerId?: ModelProviderID,
  ) => Promise<void>
  operationBusy?: boolean
  onTestModel?: (modelId: string) => Promise<void>
  embedded?: boolean
  existingProviderIds?: readonly string[]
  onDelete?: () => Promise<void>
  open: boolean
  provider?: DesktopModelProviderSummary
  deepSeekProtocolSupported?: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (
    providerId: string,
    select?: boolean,
  ) => void | DesktopModelProviderSummary | Promise<void | DesktopModelProviderSummary>
}

/* 编辑弹窗字段：标签/说明排版与输入宽度，窄屏回到单列。 */
const PROVIDER_EDITOR_FIELD_CLASS =
  'provider-editor-field tw:grid tw:gap-2 tw:[&>span]:flex tw:[&>span]:items-center tw:[&>span]:justify-between tw:[&>span]:gap-2 tw:[&>span]:text-app-text tw:[&>span]:type-label tw:[&>span>small]:text-app-text-meta tw:[&>span>small]:type-caption tw:[&>p]:col-start-2 tw:[&>p]:m-0 tw:[&>p]:text-app-text-soft tw:[&>p]:type-body-sm tw:[&_input]:w-full tw:[&_textarea]:w-full tw:max-[720px]:grid-cols-1 tw:max-[720px]:[&>p]:col-start-1'

/* `--mono` 变体把该字段的输入控件切到等宽字体。 */
const PROVIDER_EDITOR_FIELD_MONO_CLASS =
  'provider-editor-field--mono tw:[&_input]:type-code tw:[&_textarea]:type-code'

/* 模型卡摘要按钮下方的正文（DisclosureContent 的 contentClassName）。 */
const PROVIDER_EDITOR_MODEL_CARD_BODY_CLASS =
  'provider-editor-model-card-body tw:grid tw:gap-4 tw:rounded-none tw:border-t tw:border-t-app-border-subtle tw:bg-app-raised tw:p-4'

/* 高级配置正文（DisclosureContent 的 contentClassName）。 */
const PROVIDER_EDITOR_MODEL_ADVANCED_CONTENT_CLASS =
  'provider-editor-model-advanced-content tw:grid tw:gap-3 tw:border-t tw:border-t-app-border-subtle tw:p-3'

export function ProviderEditorForm({
  embedded = false,
  operationBusy = false,
  onTestModel,
  existingProviderIds = [],
  onDelete,
  open,
  provider: currentProvider,
  deepSeekProtocolSupported = false,
  onOpenChange,
  onSaved,
  onSaveDefinition = async (definition, providerId) => {
    if (providerId) await desktopClient.updateProvider(providerId, definition)
    else if (definition.kind === 'custom') await desktopClient.createProvider(definition)
  },
}: ProviderEditorFormProps): React.ReactNode {
  const retainedProvider = useLastNonNull(currentProvider)
  const provider = open ? currentProvider : (retainedProvider ?? undefined)
  const titleId = useId()
  const editing = provider?.providerKind === 'custom'
  // 内置 DeepSeek 走同一编辑入口，但只允许切换全局 API 协议。
  // memo 保持引用稳定，避免初始化 effect 在每次渲染后重复执行。
  const managed = useMemo(
    () => deepSeekManagedProvider(provider, deepSeekProtocolSupported),
    [deepSeekProtocolSupported, provider],
  )
  const { onCloseAutoFocus } = useDialogFocusRestore(open)

  const [activeTab, setActiveTab] = useState<DialogTab>('basic')
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [auth, setAuth] = useState<'api-key' | 'none'>('api-key')
  const [enabled, setEnabled] = useState(true)
  const [allowInsecureHttp, setAllowInsecureHttp] = useState(false)
  const [env, setEnv] = useState('')
  const [headers, setHeaders] = useState('')
  const [models, setModels] = useState<EditableModel[]>([])
  const [defaultApi, setDefaultApi] = useState<Api>('anthropic-messages')
  const [baseline, setBaseline] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const allowNavigation = useRef(false)
  const createdProviderId = useRef<string | null>(null)
  const [candidates, setCandidates] = useState<DesktopProviderModelDefinition[]>([])
  const [selectedCandidates, setSelectedCandidates] = useState<Set<string>>(new Set())
  const [protocol, setProtocol] = useState<DeepSeekProtocol>(DEFAULT_DEEPSEEK_PROTOCOL)
  const [internalBusy, setBusy] = useState(false)
  const busy = internalBusy || operationBusy
  const [error, setError] = useState<string | null>(null)

  function resetForm(provider: DesktopModelProviderSummary | undefined): void {
    createdProviderId.current = null
    setActiveTab('basic')
    const customConfig = provider?.config?.kind === 'custom' ? provider.config : undefined
    const nextModels =
      customConfig?.models.map((model) => editableModel(model)) ??
      provider?.defaultModels.map((modelId) => {
        const metadata = provider.modelMetadata?.[modelId]
        return {
          editorKey: createEditorKey(),
          id: modelId,
          name: metadata?.name ?? modelId,
          api: metadata?.providerApi ?? provider.providerApis?.[0] ?? 'openai-completions',
          enabled: true,
          contextWindow: metadata?.contextWindow ?? 32_768,
          maxTokens: metadata?.outputTokens ?? 8_192,
          reasoning: metadata?.reasoning ?? false,
          imageInput: metadata?.vision ?? false,
          inputCost: metadata?.inputCost ?? 0,
          outputCost: metadata?.outputCost ?? 0,
          cacheReadCost: metadata?.cacheReadCost ?? 0,
          cacheWriteCost: metadata?.cacheWriteCost ?? 0,
          headers: '',
          thinkingLevelMap: '',
          compat: '',
        } satisfies EditableModel
      }) ??
      (embedded ? [] : [emptyModel()])
    const nextId = provider?.providerID ?? newCustomProviderId(existingProviderIds)
    setId(nextId)
    setName(provider?.displayName ?? '新供应商')
    setBaseUrl(provider?.baseURL ?? '')
    setAuth(
      customConfig?.auth ??
        (provider?.authMethods?.includes('api-key') === false ? 'none' : 'api-key'),
    )
    setEnabled(customConfig?.enabled ?? provider?.enabled ?? true)
    setAllowInsecureHttp(customConfig?.allowInsecureHttp ?? false)
    setEnv(customConfig?.env.join(', ') ?? provider?.envVars?.join(', ') ?? '')
    setHeaders(headersToText(customConfig?.headers ?? {}))
    setModels(nextModels)
    setDefaultApi(nextModels[0]?.api ?? (embedded ? 'anthropic-messages' : 'openai-completions'))
    setBaseline(
      draftSignature({
        id: nextId,
        name: provider?.displayName ?? '新供应商',
        baseUrl: provider?.baseURL ?? '',
        auth:
          customConfig?.auth ??
          (provider?.authMethods?.includes('api-key') === false ? 'none' : 'api-key'),
        enabled: customConfig?.enabled ?? provider?.enabled ?? true,
        allowInsecureHttp: customConfig?.allowInsecureHttp ?? false,
        env: customConfig?.env.join(', ') ?? provider?.envVars?.join(', ') ?? '',
        headers: headersToText(customConfig?.headers ?? {}),
        models: nextModels,
      }),
    )
    setProtocol(managed ? deepSeekProtocolOf(managed.config) : DEFAULT_DEEPSEEK_PROTOCOL)
    setCandidates([])
    setSelectedCandidates(new Set())
    setError(null)
  }

  useEffect(() => {
    if (open) resetForm(provider)
    // 凭据刷新会生成新的 summary；只在打开或切换身份时初始化，避免覆盖未保存输入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider?.providerID, managed?.provider.providerID])

  function applyPreset(preset: ProviderPreset): void {
    setId(newCustomProviderId(existingProviderIds, `custom-${preset.defaultValues.id}`))
    setDefaultApi(preset.defaultValues.models[0]?.api ?? 'anthropic-messages')
    setName(preset.defaultValues.name)
    setBaseUrl(preset.defaultValues.baseUrl)
    setAuth(preset.defaultValues.auth)
    setModels(
      preset.defaultValues.models.map((item) => ({
        ...emptyModel(),
        id: item.id,
        name: item.name,
        api: item.api,
        contextWindow: item.contextWindow,
        maxTokens: item.maxTokens,
        reasoning: item.reasoning,
        imageInput: item.imageInput,
      })),
    )
    setError(null)
  }

  const definition = useMemo(() => {
    const headerEntries = parseHeaders(headers)
    if (headerEntries instanceof Error) return headerEntries
    const normalizedModels: DesktopProviderModelDefinition[] = []
    for (const model of models.filter((item) => item.id.trim())) {
      const normalized = normalizeEditableModel(model)
      if (normalized instanceof Error) return normalized
      normalizedModels.push(normalized)
    }
    const trimmedId = id.trim()
    const trimmedName = name.trim()
    const trimmedBaseUrl = baseUrl.trim()
    if (!trimmedId || !trimmedName || !trimmedBaseUrl) {
      return new Error('Provider ID、名称和 Base URL 不能为空。')
    }
    if (!editing && BUILTIN_PROVIDER_IDS.has(trimmedId.toLowerCase())) {
      return new Error(
        `Provider ID "${trimmedId}" 与系统内置 Provider 重名，请添加前缀（如 custom-${trimmedId}）。`,
      )
    }
    if (!editing && !/^[A-Za-z0-9_.-]+$/.test(trimmedId)) {
      return new Error('Provider ID 只能包含英文字母、数字、下划线、短横线与点。')
    }
    let parsedUrl: URL
    try {
      parsedUrl = new URL(trimmedBaseUrl)
    } catch {
      return new Error('Base URL 格式无效，请填写完整的 URL（如 https://api.example.com/v1）。')
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return new Error('Base URL 必须以 http:// 或 https:// 开头。')
    }
    if (parsedUrl.protocol === 'http:' && !isLoopbackUrl(trimmedBaseUrl) && !allowInsecureHttp) {
      return new Error(
        '检测到非本地明文 HTTP 端点，请在“高级与网络”中开启“允许非 loopback 明文 HTTP”，或使用 HTTPS。',
      )
    }
    const envList = env
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (auth === 'api-key') {
      for (const entry of envList) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry)) {
          return new Error(
            `环境变量名 "${entry}" 格式无效。此处应填写环境变量名称（如 GEMINI_API_KEY），而非 API Key 密钥本身。`,
          )
        }
      }
    }
    if (normalizedModels.length === 0) return new Error('至少添加一个有效模型。')
    const modelIds = normalizedModels.map((item) => item.id)
    if (new Set(modelIds).size !== modelIds.length) {
      return new Error('模型列表中存在重复的模型 ID。')
    }
    return {
      kind: 'custom',
      id: trimmedId,
      name: trimmedName,
      enabled,
      baseUrl: trimmedBaseUrl,
      ...(provider?.config?.endpoints
        ? {
            endpoints: Object.fromEntries(
              Object.entries(provider.config.endpoints).map(([api, address]) => [
                api,
                address === provider.config?.baseUrl ? trimmedBaseUrl : address,
              ]),
            ),
          }
        : {}),
      auth,
      env: envList,
      allowInsecureHttp,
      headers: headerEntries,
      models: normalizedModels,
    } as unknown as DesktopCustomProviderDefinition
  }, [
    allowInsecureHttp,
    auth,
    baseUrl,
    editing,
    enabled,
    env,
    headers,
    id,
    models,
    name,
    provider?.config,
  ])

  const signature = draftSignature({
    id,
    name,
    baseUrl,
    auth,
    enabled,
    allowInsecureHttp,
    env,
    headers,
    models,
  })
  const dirty = baseline !== '' && signature !== baseline
  const format = providerApiFormat(models, defaultApi)
  const Title = embedded ? 'h2' : Dialog.Title
  const Description = embedded ? 'p' : Dialog.Description

  async function save(select = true): Promise<boolean> {
    if (busyRef.current || operationBusy) return false
    if (managed) {
      busyRef.current = true
      setBusy(true)
      setError(null)
      try {
        await onSaveDefinition(
          buildDeepSeekProtocolDefinition(managed.config, protocol),
          managed.provider.providerID,
        )
        await onSaved(String(managed.provider.providerID))
        onOpenChange(false)
        return true
      } catch (saveError) {
        setError(saveError instanceof Error ? saveError.message : String(saveError))
        return false
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    }
    if (definition instanceof Error) {
      setError(definition.message)
      return false
    }
    if (
      definition.allowInsecureHttp &&
      /^http:\/\//i.test(definition.baseUrl) &&
      !isLoopbackUrl(definition.baseUrl) &&
      !window.confirm('此 Endpoint 使用局域网或远程明文 HTTP，凭据可能被窃听。仍要保存吗？')
    )
      return false
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      if (editing || createdProviderId.current) {
        await onSaveDefinition(
          definition,
          (provider?.providerID ??
            createdProviderId.current!) as DesktopModelProviderSummary['providerID'],
        )
      } else {
        await onSaveDefinition(definition)
        createdProviderId.current = definition.id
      }
      allowNavigation.current = true
      const savedProvider = await onSaved(definition.id, select)
      if (savedProvider) resetForm(savedProvider)
      else setBaseline(signature)
      if (!embedded) onOpenChange(false)
      return true
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
      return false
    } finally {
      allowNavigation.current = false
      busyRef.current = false
      setBusy(false)
    }
  }

  async function discover(): Promise<void> {
    if (!editing) {
      setError('请先保存 Provider，再主动导入 /models。')
      return
    }
    if (definition instanceof Error) {
      setError(definition.message)
      return
    }
    const api = models.find((model) => model.api !== 'anthropic-messages')?.api
    if (!api || api === 'anthropic-messages') {
      setError('Anthropic Messages Endpoint 不支持自动发现。')
      return
    }
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await desktopClient.discoverProviderModels(provider.providerID, api)
      setCandidates(result)
      setSelectedCandidates(new Set(result.map((model) => String(model.id))))
    } catch (discoverError) {
      setError(discoverError instanceof Error ? discoverError.message : String(discoverError))
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function importSelected(): void {
    const existing = new Set(models.map((model) => model.id))
    const imported = candidates
      .filter(
        (model) => selectedCandidates.has(String(model.id)) && !existing.has(String(model.id)),
      )
      .map((model) => editableModel(model))
    setModels((current) => [...current, ...imported])
    setCandidates([])
    setSelectedCandidates(new Set())
  }

  const isRemoteHttp = /^http:\/\//i.test(baseUrl) && !isLoopbackUrl(baseUrl)

  // 内置 DeepSeek 只暴露协议设置，因此不显示“高级与网络”页签。
  const tabOptions: readonly { value: DialogTab; label: React.ReactNode }[] = [
    { value: 'basic', label: '基本配置' },
    { value: 'models', label: `模型管理 (${models.length})` },
    ...(managed ? [] : [{ value: 'advanced' as const, label: '高级与网络' }]),
  ]

  const credentialFields = (
    <>
      <label
        className={cx(
          embedded ? undefined : 'settings-management-dialog-row',
          PROVIDER_EDITOR_FIELD_CLASS,
        )}
      >
        <span>认证方式</span>
        <SettingsDropdown
          ariaLabel="认证方式"
          options={[
            { value: 'api-key', label: 'API Key（需要凭据）' },
            { value: 'none', label: '无需认证（本地/公开服务）' },
          ]}
          value={auth}
          size="lg"
          onChange={(value) => setAuth(value as 'api-key' | 'none')}
        />
      </label>
      <label
        className={cx(
          embedded ? undefined : 'settings-management-dialog-row',
          PROVIDER_EDITOR_FIELD_CLASS,
          PROVIDER_EDITOR_FIELD_MONO_CLASS,
        )}
      >
        <span>凭据环境变量（逗号分隔）</span>
        <Input
          placeholder="如：OLLAMA_API_KEY, CUSTOM_API_KEY"
          value={env}
          onChange={(event) => setEnv(event.target.value)}
        />
      </label>
    </>
  )

  const content = (
    <>
      <header
        className={
          embedded
            ? 'tw:flex tw:items-start tw:justify-between tw:gap-4'
            : 'settings-management-dialog-header provider-editor-header tw:flex-none tw:justify-between'
        }
      >
        <div className="settings-management-dialog-heading provider-editor-heading tw:flex tw:min-w-0 tw:items-start tw:gap-3">
          <div className="provider-editor-icon tw:inline-flex tw:size-9 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-md tw:bg-app-accent-subtle tw:text-app-accent-fg tw:[&_svg]:size-icon-lg">
            <Server aria-hidden size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </div>
          <div>
            <Title id={titleId} className="tw:m-0 tw:text-app-text tw:type-title-lg">
              {embedded
                ? editing
                  ? `编辑 ${name || provider.displayName}`
                  : '新供应商'
                : managed
                  ? `编辑 ${managed.provider.displayName}`
                  : editing
                    ? `编辑 ${provider.displayName}`
                    : '新增自定义 Provider'}
            </Title>
            <Description className="tw:mt-1 tw:text-app-text-soft tw:type-body-sm">
              {managed
                ? '内置 DeepSeek Provider：切换全局 API 协议，所有模型同步生效'
                : '配置兼容 OpenAI / Anthropic 协议的自定义模型端点'}
            </Description>
          </div>
        </div>
        {embedded ? (
          <div className="tw:flex tw:items-center tw:gap-3">
            <ToggleSwitch
              ariaLabel="启用供应商"
              disabled={busy}
              checked={enabled}
              onChange={setEnabled}
            />
            <Dropdown
              align="end"
              trigger={
                <Button
                  isIconOnly
                  color="ghostSecondary"
                  size="toolbar"
                  title="供应商操作"
                  disabled={busy}
                >
                  <MoreHorizontal aria-hidden size={APP_ICON_SIZE} />
                </Button>
              }
            >
              <PopoverItem
                icon={<Pencil size={APP_ICON_SIZE} />}
                onClick={() => requestAnimationFrame(() => nameInputRef.current?.focus())}
              >
                重命名
              </PopoverItem>
              {editing && onDelete ? (
                <PopoverItem
                  icon={<Trash2 size={APP_ICON_SIZE} />}
                  onClick={() => {
                    if (busyRef.current) return
                    busyRef.current = true
                    allowNavigation.current = true
                    setBusy(true)
                    void onDelete()
                      .catch((failure) => setError(String(failure)))
                      .finally(() => {
                        busyRef.current = false
                        allowNavigation.current = false
                        setBusy(false)
                      })
                  }}
                >
                  删除供应商
                </PopoverItem>
              ) : null}
            </Dropdown>
          </div>
        ) : (
          <Dialog.Close asChild>
            <Button isIconOnly color="ghostSecondary" size="toolbar" title="关闭" disabled={busy}>
              <X size={APP_ICON_SIZE} aria-hidden />
            </Button>
          </Dialog.Close>
        )}
      </header>

      {!embedded ? (
        <div className="provider-editor-tabs-bar tw:flex-none tw:border-b tw:border-b-app-border-subtle tw:px-5 tw:pt-0 tw:pb-3">
          <SegmentedControl<DialogTab>
            ariaLabel="配置分类"
            onChange={setActiveTab}
            options={tabOptions}
            semantics="tabs"
            value={activeTab}
          />
        </div>
      ) : null}

      <fieldset
        disabled={busy}
        className={cx(
          'tw:m-0 tw:min-w-0 tw:border-0 tw:p-0',
          embedded ? undefined : 'tw:min-h-0 tw:flex-1 tw:overflow-auto',
        )}
      >
        <div
          className={
            embedded
              ? 'tw:grid tw:gap-5'
              : 'settings-management-dialog-body provider-editor-body tw:overflow-x-hidden'
          }
        >
          {embedded || activeTab === 'basic' ? (
            <div className="provider-editor-tab-panel tw:grid tw:gap-4">
              {managed ? (
                <div
                  className={
                    embedded
                      ? 'tw:grid tw:gap-4'
                      : 'settings-management-dialog-card provider-editor-basic-card'
                  }
                >
                  <div
                    className={cx(
                      embedded ? undefined : 'settings-management-dialog-row',
                      PROVIDER_EDITOR_FIELD_CLASS,
                    )}
                  >
                    <span>API 协议</span>
                    <SegmentedControl<DeepSeekProtocol>
                      ariaLabel="DeepSeek API 协议"
                      options={DEEPSEEK_PROTOCOL_OPTIONS.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                      value={protocol}
                      onChange={setProtocol}
                    />
                    <p>
                      切换后所有 DeepSeek 模型从下一次请求开始使用新协议，正在进行的请求不会中断。
                    </p>
                  </div>
                  <label
                    className={cx(
                      embedded ? undefined : 'settings-management-dialog-row',
                      PROVIDER_EDITOR_FIELD_CLASS,
                      PROVIDER_EDITOR_FIELD_MONO_CLASS,
                    )}
                  >
                    <span>Endpoint</span>
                    <Input
                      readOnly
                      value={managed.config.baseUrl ?? deepSeekProtocolOption(protocol).endpoint}
                    />
                    <p>
                      {managed.config.baseUrl
                        ? '已使用供应商详情中保存的 API 地址。'
                        : '端点由所选协议决定，可在供应商详情中修改。'}
                    </p>
                  </label>
                </div>
              ) : null}

              {!managed && !editing && !createdProviderId.current ? (
                <section className="provider-editor-presets-section tw:grid tw:gap-2 tw:rounded-lg tw:border tw:border-dashed tw:border-app-border-subtle tw:bg-app-panel tw:px-4 tw:py-3">
                  <div className="provider-editor-presets-header tw:flex tw:items-center tw:justify-between tw:gap-2">
                    <span className="tw:text-app-text-meta tw:type-label">快速套用常用预设</span>
                    <Sparkles
                      aria-hidden
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                  </div>
                  <div className="provider-editor-presets-list tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                    {PROVIDER_PRESETS.map((preset) => (
                      <button
                        className="provider-editor-preset-chip tw:cursor-pointer tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-3 tw:py-1 tw:text-app-text tw:type-label tw:transition-all tw:hover:border-app-accent tw:hover:bg-app-accent-subtle tw:hover:text-app-accent-fg"
                        key={preset.id}
                        title={preset.description}
                        type="button"
                        onClick={() => applyPreset(preset)}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              {!managed ? (
                <div
                  className={
                    embedded
                      ? 'tw:grid tw:gap-4'
                      : 'settings-management-dialog-card provider-editor-basic-card'
                  }
                >
                  {!embedded ? (
                    <label
                      className={cx(
                        embedded ? undefined : 'settings-management-dialog-row',
                        PROVIDER_EDITOR_FIELD_CLASS,
                        PROVIDER_EDITOR_FIELD_MONO_CLASS,
                      )}
                    >
                      <span>
                        Provider ID
                        {editing ? <small>（不可修改）</small> : null}
                      </span>
                      <Input
                        placeholder="如：custom-ollama"
                        readOnly={editing || embedded || Boolean(createdProviderId.current)}
                        value={id}
                        onChange={(event) => setId(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <label
                    className={cx(
                      embedded ? undefined : 'settings-management-dialog-row',
                      PROVIDER_EDITOR_FIELD_CLASS,
                    )}
                  >
                    <span>显示名称</span>
                    <Input
                      ref={nameInputRef}
                      placeholder="如：Ollama 本地服务"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label
                    className={cx(
                      embedded ? undefined : 'settings-management-dialog-row',
                      PROVIDER_EDITOR_FIELD_CLASS,
                      PROVIDER_EDITOR_FIELD_MONO_CLASS,
                    )}
                  >
                    <span>Base URL</span>
                    <Input
                      placeholder="https://example.com/v1"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                    />
                    <p>端点 URL，例如本地服务 http://localhost:11434/v1 或官方 API 路径。</p>
                  </label>
                  {!embedded ? credentialFields : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {embedded ? (
            <>
              <label className={PROVIDER_EDITOR_FIELD_CLASS}>
                <span>API 格式</span>
                <SettingsDropdown
                  ariaLabel="默认 API 格式"
                  size="lg"
                  triggerClassName="tw:w-full tw:max-w-none"
                  value={format}
                  options={[
                    ...(format === 'per-model'
                      ? [{ value: 'per-model', label: '按模型设置', disabled: true }]
                      : []),
                    ...API_OPTIONS,
                  ]}
                  onChange={(value) => {
                    if (value === 'per-model') return
                    setDefaultApi(value as Api)
                    setModels((current) =>
                      current.map((model) => ({ ...model, api: value as Api })),
                    )
                  }}
                />
              </label>
            </>
          ) : null}
          {embedded || activeTab === 'models' ? (
            <div className="provider-editor-tab-panel tw:grid tw:gap-4">
              <header className="provider-editor-models-header tw:flex tw:items-center tw:justify-between tw:gap-3">
                <div className="provider-editor-models-title tw:flex tw:items-center tw:gap-2">
                  <h3 className="tw:m-0 tw:text-app-text tw:[font-size:var(--cpx-sys-font-size-md)] tw:type-weight-label">
                    模型列表
                  </h3>
                  <span className="tw:rounded-full tw:bg-app-editor tw:px-2 tw:py-1 tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-xs)] tw:type-weight-label">
                    {models.length}
                  </span>
                </div>
                {!managed ? (
                  <div className="provider-editor-models-actions tw:flex tw:items-center tw:gap-2">
                    {editing ? (
                      <Button
                        size="md"
                        color="secondary"
                        disabled={busy || (embedded && dirty)}
                        onClick={() => void discover()}
                      >
                        <RefreshCw aria-hidden size={APP_ICON_SIZE} />从 /models 导入
                      </Button>
                    ) : null}
                    <Button
                      size="md"
                      color="secondary"
                      onClick={() => {
                        setModels((current) => [...current, { ...emptyModel(), api: defaultApi }])
                      }}
                    >
                      <Plus aria-hidden size={APP_ICON_SIZE} />
                      新增模型
                    </Button>
                  </div>
                ) : null}
              </header>

              {candidates.length > 0 ? (
                <section className="provider-editor-candidates-card tw:grid tw:gap-3 tw:rounded-lg tw:border tw:border-app-accent-border tw:bg-app-accent-subtle tw:p-4">
                  <header className="tw:flex tw:items-center tw:justify-between tw:gap-2">
                    <strong className="tw:text-app-text tw:[font-size:var(--cpx-sys-font-size-sm)]">
                      发现 {candidates.length} 个候选模型
                    </strong>
                    <Button
                      size="md"
                      color="primary"
                      disabled={selectedCandidates.size === 0}
                      onClick={importSelected}
                    >
                      导入已选 ({selectedCandidates.size})
                    </Button>
                  </header>
                  <div className="provider-editor-candidates-list tw:grid tw:max-h-40 tw:gap-1 tw:overflow-y-auto tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:p-2">
                    {candidates.map((candidate) => (
                      <label
                        className="provider-editor-candidate-row tw:flex tw:cursor-pointer tw:items-center tw:gap-2 tw:rounded-xs tw:px-2 tw:py-1 tw:[font-size:var(--cpx-sys-font-size-sm)] tw:hover:bg-app-hover tw:[&_input]:cursor-pointer"
                        key={String(candidate.id)}
                      >
                        <input
                          checked={selectedCandidates.has(String(candidate.id))}
                          type="checkbox"
                          onChange={(event) =>
                            setSelectedCandidates((current) => {
                              const next = new Set(current)
                              if (event.target.checked) next.add(String(candidate.id))
                              else next.delete(String(candidate.id))
                              return next
                            })
                          }
                        />
                        <span>{String(candidate.id)}</span>
                        <span className="provider-editor-model-card-badge tw:rounded-full tw:bg-app-editor tw:px-2 tw:py-1 tw:text-app-text-soft tw:font-mono tw:[font-size:var(--cpx-sys-font-size-xs)]">
                          {candidate.api}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              ) : null}

              {managed ? (
                <div className="settings-management-dialog-card">
                  {models.map((model) => (
                    <div className="settings-management-dialog-row" key={model.editorKey}>
                      <span>{model.id}</span>
                      <span className="provider-editor-model-card-badge tw:rounded-full tw:bg-app-editor tw:px-2 tw:py-1 tw:text-app-text-soft tw:font-mono tw:[font-size:var(--cpx-sys-font-size-xs)]">
                        {protocol}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="provider-editor-models-list tw:grid tw:gap-3">
                  {models.length === 0 ? (
                    <p className="tw:m-0 tw:rounded-lg tw:border tw:border-dashed tw:border-app-border-subtle tw:p-4 tw:text-app-text-soft tw:type-body-sm">
                      当前没有配置模型，添加并保存后可在聊天中使用。
                    </p>
                  ) : null}
                  {models.map((model, index) => (
                    <ProviderModelCard
                      providerId={id}
                      baseUrl={baseUrl}
                      canRemove={embedded || models.length > 1}
                      dialog={embedded}
                      defaultExpanded={index === 0}
                      key={model.editorKey}
                      model={model}
                      onChange={(next) =>
                        setModels((current) =>
                          current.map((item) => (item.editorKey === model.editorKey ? next : item)),
                        )
                      }
                      onRemove={() =>
                        setModels((current) =>
                          current.filter((item) => item.editorKey !== model.editorKey),
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {embedded ? (
            <Button
              size="md"
              color="ghostSecondary"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((value) => !value)}
            >
              <ChevronRight aria-hidden size={APP_ICON_SIZE} />
              高级与网络
            </Button>
          ) : null}
          {(embedded ? advancedOpen : activeTab === 'advanced') && !managed ? (
            <div className="provider-editor-tab-panel tw:grid tw:gap-4">
              {embedded ? credentialFields : null}
              {embedded ? (
                <label className={PROVIDER_EDITOR_FIELD_CLASS}>
                  <span>供应商 ID（自动生成，不可修改）</span>
                  <Input readOnly value={id} />
                </label>
              ) : null}
              <div className="settings-management-dialog-card">
                {!embedded ? (
                  <div className="settings-management-dialog-row provider-editor-switch-card tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-4 tw:rounded-none tw:border-0 tw:bg-transparent tw:px-4 tw:py-3">
                    <div className="provider-editor-switch-info tw:grid tw:min-w-0 tw:gap-1">
                      <strong className="tw:text-app-text tw:type-row-title">
                        启用此 Provider
                      </strong>
                      <span className="tw:text-app-text-soft tw:type-body-sm">
                        在模型选择菜单与 Agent 会话中允许调用此 Provider
                      </span>
                    </div>
                    <ToggleSwitch
                      ariaLabel="启用 Provider"
                      checked={enabled}
                      onChange={setEnabled}
                    />
                  </div>
                ) : null}
                <div className="settings-management-dialog-row provider-editor-switch-card tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-4 tw:rounded-none tw:border-0 tw:bg-transparent tw:px-4 tw:py-3">
                  <div className="provider-editor-switch-info tw:grid tw:min-w-0 tw:gap-1">
                    <strong className="tw:text-app-text tw:type-row-title">
                      允许非 loopback 明文 HTTP
                    </strong>
                    <span className="tw:text-app-text-soft tw:type-body-sm">
                      允许连接局域网或远程非 localhost 的 http:// 端点
                    </span>
                  </div>
                  <ToggleSwitch
                    ariaLabel="允许非 loopback HTTP"
                    checked={allowInsecureHttp}
                    onChange={setAllowInsecureHttp}
                  />
                </div>
              </div>

              {isRemoteHttp && !allowInsecureHttp ? (
                <div
                  className="provider-editor-alert tw:flex tw:items-start tw:gap-3 tw:rounded-md tw:px-4 tw:py-3 tw:type-body-sm tw:[&_svg]:size-icon tw:[&_svg]:shrink-0 tw:[&_svg]:mt-1 tw:data-[tone=warning]:border tw:data-[tone=warning]:border-app-warning-border tw:data-[tone=warning]:bg-app-warning-subtle tw:data-[tone=warning]:text-app-warning tw:data-[tone=danger]:border tw:data-[tone=danger]:border-app-danger-border tw:data-[tone=danger]:bg-app-danger-subtle tw:data-[tone=danger]:text-app-danger tw:data-[tone=info]:border tw:data-[tone=info]:border-app-info-border tw:data-[tone=info]:bg-app-info-subtle tw:data-[tone=info]:text-app-info-fg"
                  data-tone="warning"
                >
                  <AlertTriangle size={APP_ICON_SIZE} aria-hidden />
                  <div>
                    <strong>检测到非本地明文 HTTP 端点</strong>
                    <p>
                      当前 Base URL 使用明文 HTTP 且不是本机回环地址，建议开启“允许非 loopback 明文
                      HTTP”或使用 HTTPS。
                    </p>
                  </div>
                </div>
              ) : null}

              <label
                className={cx(
                  'settings-management-dialog-card settings-management-dialog-row',
                  PROVIDER_EDITOR_FIELD_CLASS,
                )}
              >
                <span>
                  全局非敏感 Headers
                  <small>每行 name: value</small>
                </span>
                <textarea
                  className="provider-editor-textarea tw:w-full tw:min-h-20 tw:resize-y tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-3 tw:py-2 tw:text-app-text tw:type-code tw:transition-[border-color] tw:duration-state tw:ease-standard tw:focus:border-app-accent tw:focus:outline-2 tw:focus:outline-solid tw:focus:outline-offset-[-1px] tw:focus:outline-app-focus tw:placeholder:text-app-text-meta"
                  placeholder="X-Custom-Header: value&#10;Custom-Client: Pidex"
                  rows={4}
                  value={headers}
                  onChange={(event) => setHeaders(event.target.value)}
                />
                <p>仅填写非敏感请求头。Authorization / API Key 等凭据请勿直接写入此处。</p>
              </label>
            </div>
          ) : null}
        </div>
      </fieldset>

      <footer
        className={cx(
          'settings-management-dialog-footer provider-editor-footer tw:flex-none tw:justify-between tw:max-[720px]:flex-col tw:max-[720px]:items-stretch tw:max-[720px]:gap-2',
          embedded &&
            'tw:sticky tw:bottom-0 tw:z-10 tw:border-t tw:border-app-border-subtle tw:bg-app-panel tw:py-3',
        )}
      >
        <div className="provider-editor-footer-status tw:min-w-0 tw:flex-1">
          {embedded ? (
            <span className="tw:text-app-text-soft tw:type-body-sm" role="status">
              {dirty || !editing ? '未保存修改' : '已保存'}
            </span>
          ) : null}
          {error ? (
            <p
              className="provider-editor-error-text tw:m-0 tw:overflow-hidden tw:text-app-danger tw:type-body-sm tw:text-ellipsis tw:whitespace-nowrap"
              role="status"
              title={error}
            >
              {error}
            </p>
          ) : null}
        </div>
        <div className="provider-editor-footer-actions tw:flex tw:shrink-0 tw:items-center tw:gap-2 tw:max-[720px]:justify-end">
          <Button size="md" color="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="md"
            color="primary"
            loading={busy}
            disabled={busy || (embedded && editing && !dirty)}
            onClick={() => void save()}
          >
            {embedded ? '保存配置' : '保存 Provider'}
          </Button>
        </div>
      </footer>
    </>
  )

  if (embedded)
    return (
      <section className="tw:grid tw:gap-5">
        {content}
        <ProviderEditorNavigationGuard
          dirty={dirty || (!editing && models.length > 0)}
          busy={busy}
          allowNavigation={allowNavigation}
          onSave={() => save(false)}
        />
      </section>
    )

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!busyRef.current) onOpenChange(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          aria-labelledby={titleId}
          className="ui-dialog-surface ui-dialog-surface--centered settings-management-dialog provider-editor-dialog tw:w-[min(720px,calc(100vw_-_32px))] tw:max-h-[min(85vh,780px)] tw:max-[720px]:w-[calc(100vw_-_16px)] tw:max-[720px]:max-h-[calc(100vh_-_16px)]"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          {content}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const ProviderModelCard = memo(function ProviderModelCard({
  providerId,
  baseUrl,
  canRemove,
  dialog = false,
  disabled = false,
  onTest,
  defaultExpanded,
  model,
  onChange,
  onRemove,
}: {
  providerId: string
  baseUrl: string
  canRemove: boolean
  dialog?: boolean
  disabled?: boolean
  onTest?: () => void
  defaultExpanded: boolean
  model: EditableModel
  onChange: (model: EditableModel) => void
  onRemove: () => void
}): React.ReactNode {
  const [expanded, setExpanded] = useState(dialog ? !model.id : defaultExpanded)
  const contentId = useId()

  return (
    <div
      className="provider-editor-model-card tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-panel tw:transition-[border-color] tw:duration-state tw:ease-standard tw:data-[expanded=true]:border-app-accent-border"
      data-expanded={expanded}
    >
      <div className="provider-editor-model-card-header tw:flex tw:items-center tw:justify-between tw:gap-0 tw:bg-app-panel">
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          className="provider-editor-model-card-summary tw:min-w-0 tw:flex tw:flex-auto tw:flex-wrap tw:items-center tw:self-stretch tw:gap-2 tw:rounded-none tw:border-0 tw:bg-transparent tw:px-4 tw:py-3 tw:text-left tw:select-none tw:outline-none tw:hover:bg-app-hover tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)]"
          type="button"
          onClick={() => setExpanded((current) => !current)}
        >
          <span className="provider-editor-model-card-chevron tw:inline-flex tw:items-center tw:justify-center tw:text-app-text-soft tw:transition-transform tw:duration-disclosure tw:ease-disclosure">
            {expanded ? (
              <ChevronDown aria-hidden size={APP_ICON_SIZES.sm} />
            ) : (
              <ChevronRight aria-hidden size={APP_ICON_SIZES.sm} />
            )}
          </span>
          <code className="tw:font-mono tw:text-app-text tw:[font-size:var(--cpx-sys-font-size-sm)] tw:type-weight-label">
            {model.id || '(未命名模型)'}
          </code>
          {model.name && model.name !== model.id ? (
            <span className="provider-editor-model-card-name tw:text-app-text-soft tw:type-caption">
              ({model.name})
            </span>
          ) : null}
          <span className="provider-editor-model-card-badge tw:rounded-full tw:bg-app-editor tw:px-2 tw:py-1 tw:text-app-text-soft tw:font-mono tw:[font-size:var(--cpx-sys-font-size-xs)]">
            {model.api}
          </span>
          {model.reasoning ? (
            <span className="provider-editor-model-card-tag tw:inline-flex tw:items-center tw:gap-1 tw:rounded-full tw:px-2 tw:py-1 tw:[font-size:var(--cpx-sys-font-size-xs)] provider-editor-model-tag--reasoning">
              <Brain aria-hidden size={APP_ICON_SIZE} /> Reasoning
            </span>
          ) : null}
          {model.imageInput ? (
            <span className="provider-editor-model-card-tag tw:inline-flex tw:items-center tw:gap-1 tw:rounded-full tw:px-2 tw:py-1 tw:[font-size:var(--cpx-sys-font-size-xs)] provider-editor-model-tag--vision">
              <Eye aria-hidden size={APP_ICON_SIZE} /> Vision
            </span>
          ) : null}
        </button>
        <div className="provider-editor-model-card-controls tw:flex tw:shrink-0 tw:items-center tw:gap-2 tw:pr-4">
          <ToggleSwitch
            ariaLabel="启用模型"
            checked={model.enabled}
            onChange={(enabled) => onChange({ ...model, enabled })}
          />
          {onTest ? (
            <Button
              isIconOnly
              color="ghostSecondary"
              size="toolbar"
              title="测试已保存模型"
              onClick={onTest}
            >
              <Cable aria-hidden size={APP_ICON_SIZE} />
            </Button>
          ) : null}
          {canRemove ? (
            <Button isIconOnly color="danger" size="toolbar" title="移除模型" onClick={onRemove}>
              <Trash2 aria-hidden size={APP_ICON_SIZE} />
            </Button>
          ) : null}
        </div>
      </div>
      {dialog ? (
        <Dialog.Root open={expanded} onOpenChange={setExpanded}>
          <Dialog.Portal>
            <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
            <Dialog.Content className="ui-dialog-surface ui-dialog-surface--centered settings-management-dialog tw:w-[min(680px,calc(100vw_-_32px))] tw:max-h-[85vh]">
              <header className="settings-management-dialog-header">
                <div className="settings-management-dialog-heading">
                  <Dialog.Title>编辑模型</Dialog.Title>
                  <Dialog.Description>
                    模型修改进入供应商草稿，点击保存供应商后生效。
                  </Dialog.Description>
                </div>
              </header>
              <fieldset
                disabled={disabled}
                className="settings-management-dialog-body tw:m-0 tw:border-0"
              >
                <ModelEditor model={model} onChange={onChange} providerId={providerId} baseUrl={baseUrl} />
              </fieldset>
              <footer className="settings-management-dialog-footer">
                <Dialog.Close asChild>
                  <Button size="md" color="primary">
                    完成
                  </Button>
                </Dialog.Close>
              </footer>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : (
        <DisclosureContent
          contentClassName={PROVIDER_EDITOR_MODEL_CARD_BODY_CLASS}
          expanded={expanded}
          id={contentId}
          mountPolicy="always"
        >
          <ModelEditor model={model} onChange={onChange} providerId={providerId} baseUrl={baseUrl} />
        </DisclosureContent>
      )}
    </div>
  )
})

export function ModelEditor({
  model,
  onChange: rawOnChange,
  providerId = '',
  baseUrl = '',
  nativeApi,
  lockId = false,
}: {
  model: EditableModel
  onChange: (model: EditableModel) => void
  nativeApi?: string
  lockId?: boolean
  providerId?: string
  baseUrl?: string
}): React.ReactNode {
  const smart = useSmartModelConfig(model, rawOnChange, providerId, baseUrl)
  const onChange = smart.change
  const advancedValues = (value: EditableModel) => {
    const { id, name, api, editorKey, original, headers, thinkingLevelMap, compat, ...values } = value
    return { ...values, maxInputTokens: value.maxInputTokens }
  }
  const initialAdvanced = useRef(advancedValues(model)).current
  const [history, setHistory] = useState<Array<typeof initialAdvanced>>([])
  const advancedDirty = JSON.stringify(advancedValues(model)) !== JSON.stringify(initialAdvanced)
  function changeAdvanced(next: EditableModel) {
    if (JSON.stringify(advancedValues(next)) === JSON.stringify(advancedValues(model))) return
    setHistory((current) => [...current, advancedValues(model)])
    onChange(next)
  }
  function undoAdvanced() {
    const previous = history.at(-1)
    if (!previous) return
    setHistory((current) => current.slice(0, -1))
    onChange({ ...model, ...previous })
  }
  const [advanced, setAdvanced] = useState(false)
  const advancedId = useId()
  const parametersId = useId()
  const [parametersOpen, setParametersOpen] = useState(false)
  const number = (key: keyof EditableModel, value: string) =>
    changeAdvanced({ ...model, [key]: Math.max(0, Number(value) || 0) })

  const chip = (label: string, selected: boolean, onClick: () => void, disabled = false) => (
    <button type="button" aria-pressed={selected} disabled={disabled} onClick={onClick}
      className={cx('tw:inline-flex tw:items-center tw:justify-center tw:rounded-full tw:border tw:border-app-border tw:px-3 tw:py-1 tw:type-body-sm tw:focus-visible:outline-app-focus', selected ? 'tw:bg-app-selected tw:text-app-text' : 'tw:bg-transparent tw:text-app-text-soft tw:hover:bg-app-hover')}>
      {label}
    </button>
  )
  const tokenField = (key: 'contextWindow' | 'maxInputTokens' | 'maxTokens', label: string, values: number[]) => (
    <div className={PROVIDER_EDITOR_FIELD_CLASS}>
      <span>{label}</span>
      <div className="tw:flex tw:flex-wrap tw:gap-2">{values.map((value) => <span key={value}>
        {chip(value >= 1000000 ? `${value / 1000000}M` : `${(value === 32768 || value === 8192 ? value / 1024 : value / 1000)}K`, model[key] === value, () => number(key, String(value)))}
      </span>)}</div>
      <Input type="number" min={1} aria-label={label} value={model[key] === undefined || model[key] === 0 ? "" : String(model[key])} onChange={(event) => number(key, event.target.value)} />
    </div>
  )

  return (
    <div className="provider-editor-tab-panel tw:grid tw:gap-4">
      {smart.controls}
      <div className="provider-editor-grid tw:grid tw:grid-cols-1 tw:gap-4">
        <label className={cx(PROVIDER_EDITOR_FIELD_CLASS, PROVIDER_EDITOR_FIELD_MONO_CLASS)}>
          <span>模型 ID</span>
          <Input
            placeholder="如：llama3.2 或 gpt-4o"
            readOnly={lockId}
            value={model.id}
            onChange={(event) => onChange({ ...model, id: event.target.value })}
          />
        </label>
        <label className={PROVIDER_EDITOR_FIELD_CLASS}>
          <span>显示名称</span>
          <Input
            placeholder="默认使用模型 ID"
            value={model.name}
            onChange={(event) => onChange({ ...model, name: event.target.value })}
          />
        </label>
      </div>

      <div
        className="provider-editor-model-advanced-details tw:overflow-hidden tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-panel"
        data-expanded={advanced ? 'true' : 'false'}
      >
        <div className="tw:flex tw:items-center tw:gap-2 tw:pr-3">
        <button
          aria-controls={advancedId}
          aria-expanded={advanced}
          className="provider-editor-model-advanced-summary tw:flex tw:flex-1 tw:cursor-pointer tw:select-none tw:items-center tw:gap-1 tw:rounded-none tw:border-0 tw:bg-transparent tw:px-3 tw:py-2 tw:text-left tw:text-app-text-soft tw:type-caption tw:hover:text-app-text tw:focus-visible:outline-none tw:focus-visible:shadow-[var(--cpx-sys-focus-ring-inset)] tw:[&_svg]:size-icon-sm tw:[&_svg]:transition-transform tw:[&_svg]:duration-disclosure tw:[&_svg]:ease-disclosure"
          onClick={() => setAdvanced((current) => !current)}
          type="button"
        >
          <ChevronRight size={APP_ICON_SIZES.sm} aria-hidden="true" className={advanced ? 'tw:rotate-90' : undefined} />
          高级设置
        </button>
          <div className="tw:flex tw:items-center tw:gap-1">
            <Button variant="ghost" size="xs" shape="default" isIconOnly className="tw:[&&]:rounded-md" aria-label="回退高级配置" title="回退高级配置" disabled={!history.length} onClick={undoAdvanced}>
              <Undo2 size={APP_ICON_SIZES.sm} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="xs" shape="default" isIconOnly className="tw:[&&]:rounded-md" aria-label="重置高级配置" title="重置高级配置" disabled={!advancedDirty} onClick={() => changeAdvanced({ ...model, ...initialAdvanced })}>
              <RefreshCw size={APP_ICON_SIZES.sm} aria-hidden="true" />
            </Button>
          </div>
        </div>
        <DisclosureContent
          contentClassName={PROVIDER_EDITOR_MODEL_ADVANCED_CONTENT_CLASS}
          expanded={advanced}
          id={advancedId}
          mountPolicy="always"
        >
          <div className="tw:grid tw:gap-4">
            <div className="tw:grid tw:gap-2"><h4 className="tw:m-0 tw:type-label">模型类型</h4>
              <div className="tw:flex tw:flex-wrap tw:gap-2">{chip('文本', !model.modelType || model.modelType === 'chat', () => changeAdvanced({ ...model, modelType: 'chat' }))}{chip('嵌入', model.modelType === 'embedding', () => changeAdvanced({ ...model, modelType: 'embedding' }))}{chip('重排', model.modelType === 'rerank', () => changeAdvanced({ ...model, modelType: 'rerank' }))}</div>
            </div>
            {!model.modelType || model.modelType === 'chat' ? <>
            <div className="tw:grid tw:gap-2"><h4 className="tw:m-0 tw:type-label">模型能力</h4>
              <div className="tw:flex tw:flex-wrap tw:gap-2">{chip('推理', model.reasoning, () => changeAdvanced({ ...model, reasoning: !model.reasoning }))}{chip('工具', model.tools !== false, () => changeAdvanced({ ...model, tools: model.tools === false }), model.modelType === 'embedding' || model.modelType === 'rerank')}</div>
            </div>
            <div className="tw:grid tw:gap-2"><h4 className="tw:m-0 tw:type-label">输入模态</h4>
              <div className="tw:flex tw:flex-wrap tw:gap-2">{chip('文本输入', true, () => {}, true)}{chip('视觉', model.imageInput, () => changeAdvanced({ ...model, imageInput: !model.imageInput }))}{['openai-completions', 'google-generative-ai', 'google-vertex'].includes(nativeApi ?? model.api) ? chip('音频', model.audioInput ?? false, () => changeAdvanced({ ...model, audioInput: !model.audioInput })) : null}{['google-generative-ai', 'google-vertex'].includes(nativeApi ?? model.api) ? chip('视频', model.videoInput ?? false, () => changeAdvanced({ ...model, videoInput: !model.videoInput })) : null}</div>
            </div>
            </> : null}
            <div className="tw:grid tw:gap-2"><h4 className="tw:m-0 tw:type-label">模型状态</h4>
              <div className="tw:flex tw:flex-wrap tw:gap-2">{chip('启用模型', model.enabled, () => changeAdvanced({ ...model, enabled: !model.enabled }))}</div>
            </div>
          </div>
          {tokenField('contextWindow', '上下文窗口（Token）', [32768, 128000, 200000, 256000, 400000, 512000, 1000000])}
          {tokenField('maxInputTokens', '最大输入 Token', [128000, 200000, 256000, 512000, 1000000])}
          {!model.modelType || model.modelType === 'chat' ? tokenField('maxTokens', '最大输出（Token）', [8192, 16000, 32000, 64000, 128000, 256000]) : null}
          <h4 className="tw:m-0 tw:type-label">价格（USD／百万 Token）</h4>
          <div className="provider-editor-grid tw:grid tw:grid-cols-2 tw:gap-4">
            <label className={PROVIDER_EDITOR_FIELD_CLASS}>
              <span>输入价格</span>
              <Input
                type="number"
                value={String(model.inputCost)}
                onChange={(event) => number('inputCost', event.target.value)}
              />
            </label>
            <label className={PROVIDER_EDITOR_FIELD_CLASS}>
              <span>输出价格</span>
              <Input
                type="number"
                value={String(model.outputCost)}
                onChange={(event) => number('outputCost', event.target.value)}
              />
            </label>
          </div>
          <div className="provider-editor-grid tw:grid tw:grid-cols-2 tw:gap-4">
            <label className={PROVIDER_EDITOR_FIELD_CLASS}>
              <span>缓存读取价格</span>
              <Input
                type="number"
                value={String(model.cacheReadCost)}
                onChange={(event) => number('cacheReadCost', event.target.value)}
              />
            </label>
            <label className={PROVIDER_EDITOR_FIELD_CLASS}>
              <span>缓存写入价格</span>
              <Input
                type="number"
                value={String(model.cacheWriteCost)}
                onChange={(event) => number('cacheWriteCost', event.target.value)}
              />
            </label>
          </div>
        </DisclosureContent>
      </div>
      <div className="tw:overflow-hidden tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-panel">
          <button type="button" className="tw:flex tw:w-full tw:items-center tw:gap-1 tw:border-0 tw:bg-transparent tw:px-3 tw:py-2 tw:text-left tw:text-app-text-soft tw:type-caption" aria-expanded={parametersOpen} aria-controls={parametersId} onClick={() => setParametersOpen(!parametersOpen)}>
            <ChevronRight aria-hidden size={APP_ICON_SIZES.sm} className={parametersOpen ? 'tw:rotate-90' : ''} />协议参数
          </button>
          <DisclosureContent
            id={parametersId}
            expanded={parametersOpen}
            mountPolicy="always"
            contentClassName="tw:grid tw:gap-3 tw:p-3"
          >
            <label className={PROVIDER_EDITOR_FIELD_CLASS}>
              <span>
                模型专属 Headers
                <small>每行 name: value</small>
              </span>
              <textarea
                className="provider-editor-textarea tw:w-full tw:min-h-20 tw:resize-y tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-3 tw:py-2 tw:text-app-text tw:type-code tw:transition-[border-color] tw:duration-state tw:ease-standard tw:focus:border-app-accent tw:focus:outline-2 tw:focus:outline-solid tw:focus:outline-offset-[-1px] tw:focus:outline-app-focus tw:placeholder:text-app-text-meta"
                placeholder="X-Model-Specific: value"
                rows={3}
                value={model.headers}
                onChange={(event) => onChange({ ...model, headers: event.target.value })}
              />
            </label>

            <label className={cx(PROVIDER_EDITOR_FIELD_CLASS, PROVIDER_EDITOR_FIELD_MONO_CLASS)}>
              <span>Thinking Level Map (JSON)</span>
              <textarea
                className="provider-editor-textarea tw:w-full tw:min-h-20 tw:resize-y tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-3 tw:py-2 tw:text-app-text tw:type-code tw:transition-[border-color] tw:duration-state tw:ease-standard tw:focus:border-app-accent tw:focus:outline-2 tw:focus:outline-solid tw:focus:outline-offset-[-1px] tw:focus:outline-app-focus tw:placeholder:text-app-text-meta"
                placeholder='{"high": "high"}'
                rows={3}
                value={model.thinkingLevelMap}
                onChange={(event) => onChange({ ...model, thinkingLevelMap: event.target.value })}
              />
            </label>

            <label className={cx(PROVIDER_EDITOR_FIELD_CLASS, PROVIDER_EDITOR_FIELD_MONO_CLASS)}>
              <span>API Compat (JSON)</span>
              <textarea
                className="provider-editor-textarea tw:w-full tw:min-h-20 tw:resize-y tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-3 tw:py-2 tw:text-app-text tw:type-code tw:transition-[border-color] tw:duration-state tw:ease-standard tw:focus:border-app-accent tw:focus:outline-2 tw:focus:outline-solid tw:focus:outline-offset-[-1px] tw:focus:outline-app-focus tw:placeholder:text-app-text-meta"
                placeholder="{}"
                rows={3}
                value={model.compat}
                onChange={(event) => onChange({ ...model, compat: event.target.value })}
              />
            </label>
          </DisclosureContent>
      </div>
    </div>
  )
}

function emptyModel(): EditableModel {
  return {
    editorKey: createEditorKey(),
    id: '',
    name: '',
    api: 'openai-completions',
    enabled: true,
    contextWindow: 32_768,
    maxTokens: 8_192,
    reasoning: false,
    imageInput: false,
    audioInput: false,
    videoInput: false,
    tools: true,
    modelType: 'chat',
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    headers: '',
    thinkingLevelMap: '',
    compat: '',
  }
}

export function editableModel(model: DesktopProviderModelDefinition): EditableModel {
  return {
    original: model,
    editorKey: createEditorKey(),
    id: String(model.id),
    name: model.name ?? String(model.id),
    api: model.api,
    enabled: model.enabled ?? true,
    contextWindow: model.contextWindow ?? 32_768,
    maxInputTokens: model.maxInputTokens,
    maxTokens: model.maxTokens ?? 8_192,
    reasoning: model.reasoning ?? false,
    imageInput: model.input?.includes('image') ?? false,
    audioInput: model.input?.includes('audio') ?? false,
    videoInput: model.input?.includes('video') ?? false,
    tools: model.tools ?? true,
    modelType: model.modelType ?? 'chat',
    inputCost: model.cost?.input ?? 0,
    outputCost: model.cost?.output ?? 0,
    cacheReadCost: model.cost?.cacheRead ?? 0,
    cacheWriteCost: model.cost?.cacheWrite ?? 0,
    headers: headersToText(model.headers ?? {}),
    thinkingLevelMap: model.thinkingLevelMap ? JSON.stringify(model.thinkingLevelMap, null, 2) : '',
    compat: model.compat ? JSON.stringify(model.compat, null, 2) : '',
  }
}

let nextEditorKey = 0

function createEditorKey(): string {
  nextEditorKey += 1
  return `provider-model-${nextEditorKey}`
}

export function parseHeaders(value: string): Record<string, string> | Error {
  const result: Record<string, string> = {}
  for (const [index, line] of value.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    const separator = line.indexOf(':')
    if (separator <= 0) return new Error(`Header 第 ${index + 1} 行格式无效。`)
    const name = line.slice(0, separator).trim()
    if (/^(authorization|proxy-authorization|x-api-key|api-key|x-auth-token)$/i.test(name)) {
      return new Error(`Header ${name} 包含敏感凭据，请改用加密凭据仓库。`)
    }
    result[name] = line.slice(separator + 1).trim()
  }
  return result
}

export function headersToText(headers: Readonly<Record<string, string>>): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n')
}

function parseJsonObject(value: string, label: string): Record<string, unknown> | null | Error {
  if (!value.trim()) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      return new Error(`${label} 必须是 JSON 对象。`)
    }
    return parsed as Record<string, unknown>
  } catch {
    return new Error(`${label} 不是合法 JSON。`)
  }
}

function isLoopbackUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    )
  } catch {
    return false
  }
}

function draftSignature(value: {
  id: string
  name: string
  baseUrl: string
  auth: string
  enabled: boolean
  allowInsecureHttp: boolean
  env: string
  headers: string
  models: EditableModel[]
}): string {
  return JSON.stringify({
    ...value,
    models: value.models.map(({ editorKey: _key, ...model }) => model),
  })
}

export function normalizeEditableModel(
  model: EditableModel,
): DesktopProviderModelDefinition | Error {
  const modelHeaders = parseHeaders(model.headers)
  if (modelHeaders instanceof Error) {
    return new Error(`模型 ${model.id || '(未命名)'}：${modelHeaders.message}`)
  }
  const thinkingLevelMap = parseJsonObject(model.thinkingLevelMap, 'thinkingLevelMap')
  if (thinkingLevelMap instanceof Error) return thinkingLevelMap
  const compat = parseJsonObject(model.compat, 'compat')
  if (compat instanceof Error) return compat
  return {
    ...model.original,
    id: model.id.trim(),
    name: model.name.trim() || model.id.trim(),
    api: model.api,
    enabled: model.enabled,
    contextWindow: model.contextWindow || 32_768,
    maxInputTokens: model.maxInputTokens || undefined,
    maxTokens: model.maxTokens || 8_192,
    reasoning: (!model.modelType || model.modelType === 'chat') && model.reasoning,
    modelType: model.modelType ?? 'chat',
    tools: model.modelType === 'embedding' || model.modelType === 'rerank' ? false : model.tools ?? true,
    input: model.modelType === 'embedding' || model.modelType === 'rerank' ? ['text'] : [
      ...(model.original?.input ?? ['text']).filter((value) => !['image', 'audio', 'video'].includes(value)),
      ...(model.imageInput ? ['image' as const] : []),
      ...(model.audioInput ? ['audio' as const] : []),
      ...(model.videoInput ? ['video' as const] : []),
    ],
    cost: {
      input: model.inputCost || 0,
      output: model.outputCost || 0,
      cacheRead: model.cacheReadCost || 0,
      cacheWrite: model.cacheWriteCost || 0,
    },
    headers: modelHeaders,
    thinkingLevelMap: thinkingLevelMap ? (thinkingLevelMap as never) : undefined,
    compat: compat ?? undefined,
  } as unknown as DesktopProviderModelDefinition
}
