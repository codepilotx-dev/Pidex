import { Activity, ChevronRight, Plus } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { RpcParams } from '@pidex/agent-protocol'
import { APP_ICON_SIZES, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import { useEffect, useRef, useState, useId, type RefObject, type ReactNode } from 'react'
import type {
  DesktopModelProviderSummary,
  DesktopProviderDefinition,
} from '../../../../shared/Types.js'
import { Button } from '../../../components/ui/Button.js'
import { Input } from '../../../components/ui/Input.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import { DisclosureContent } from '../../../components/ui/DisclosureContent.js'
import { SettingsDropdown } from '../../settings/SettingsDropdown.js'
import { fullErrorMessage } from '../../../utils/Errors.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { headersToText, parseHeaders } from './ProviderEditorForm.js'
import {
  applyProtocolDetection,
  DETECTION_PROTOCOL_ORDER,
  type DetectionResultLike,
} from './ProtocolDetectionApply.js'
import { DEEPSEEK_PROTOCOL_OPTIONS } from './DeepseekProtocol.js'

type RequestDraftModel = {
  id: string
  api: string
}

const commonProtocols = DEEPSEEK_PROTOCOL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))
function providerProtocols(provider: DesktopModelProviderSummary) {
  const apis =
    provider.config?.kind === 'custom'
      ? [
          ...new Set([
            ...provider.config.models
              .filter((model) => !model.modelType || model.modelType === 'chat')
              .map((model) => model.api),
            ...Object.keys(provider.config.endpoints ?? {}),
          ]),
        ]
      : Object.keys(provider.endpointDefaults ?? {}).length > 0
        ? Object.keys(provider.endpointDefaults!)
        : (provider.nativeApis ?? provider.providerApis ?? [])
  const directoryProtocols = provider.catalogOrigin === 'models-dev' || provider.catalogOrigin === 'pi-remote' ? DETECTION_PROTOCOL_ORDER : []
  return [...new Set([...apis, ...Object.keys(provider.config?.endpoints ?? {}), ...directoryProtocols])].map((value) => ({
    value,
    label:
      commonProtocols.find((option) => option.value === value)?.label ??
      (
        {
          'openai-embeddings': 'Embeddings',
          'jina-rerank': 'Rerank',
          'google-generative-ai': 'Gemini',
          'google-vertex': 'Vertex AI',
          'bedrock-converse-stream': 'Bedrock Converse',
          'azure-openai-responses': 'Azure Responses',
          'openai-codex-responses': 'Codex Responses',
          'mistral-conversations': 'Mistral Conversations',
        } as Record<string, string>
      )[value] ??
      value,
  }))
}
function requestDraft(provider: DesktopModelProviderSummary) {
  const config = provider.config
  const apis =
    config?.kind === 'custom'
      ? [
          ...new Set(
            config.models
              .filter((model) => !model.modelType || model.modelType === 'chat')
              .map((model) => model.api),
          ),
        ]
      : (provider.providerApis ?? [])
  const protocols = providerProtocols(provider)
  const endpoints: Record<string, string> = {
    ...(provider.endpointDefaults ?? {}),
    ...(config?.endpoints ?? {}),
  }
  for (const api of protocols.map((option) => option.value)) {
    endpoints[api] ??= config?.baseUrl ?? provider.baseURL ?? ''
  }
  const protocol =
    config?.kind === 'builtin'
      ? (config.protocol ?? provider.defaultApi ?? provider.nativeApis?.[0] ?? apis[0] ?? 'mixed')
      : (apis[0] ?? Object.keys(config?.endpoints ?? {})[0] ?? provider.defaultApi ?? 'mixed')
  if (config?.baseUrl && protocol !== 'mixed') endpoints[protocol] = config.baseUrl
  return {
    endpoints,
    allowModels: config?.kind === 'builtin' ? config.allowModels.join(', ') : '',
    denyModels: config?.kind === 'builtin' ? config.denyModels.join(', ') : '',
    name: config?.kind === 'custom' ? config.name : provider.displayName,
    address: config?.baseUrl ?? provider.baseURL ?? '',
    protocol,
    allowHttp: config?.allowInsecureHttp ?? false,
    auth: config?.kind === 'custom' ? config.auth : 'api-key',
    env: config?.kind === 'custom' ? config.env.join(', ') : '',
    headers: config?.kind === 'custom' ? headersToText(config.headers) : '',
    // 仅自定义供应商写回模型协议；builtin 的模型协议由模型列表单独管理。
    models: (config?.kind === 'custom'
      ? config.models
          .filter((model) => !model.modelType || model.modelType === 'chat')
          .map((model) => ({ id: String(model.id), api: model.api }))
      : []) as RequestDraftModel[],
  }
}

export function ProviderRequestSettingsForm({
  footerHost,
  provider,
  saveRef,
  resetRef,
  onDraftChange,
  onBusyChange,
  onSaveDefinition,
  onSaved,
  onCancel,
  onDelete,
}: {
  footerHost?: HTMLElement | null
  provider: DesktopModelProviderSummary
  saveRef: RefObject<(() => Promise<boolean>) | null>
  resetRef: RefObject<(() => void) | null>
  onDraftChange: (dirty: boolean) => void
  onBusyChange: (busy: boolean) => void
  onSaveDefinition: (definition: DesktopProviderDefinition) => Promise<void>
  onSaved: () => Promise<void>
  onCancel: () => void
  onDelete?: () => Promise<void>
}): ReactNode {
  const formId = useId()
  const protocols = providerProtocols(provider)
  const endpointOptions = [
    ...new Map(
      [
        ...protocols,
        ...commonProtocols,
        ...(provider.config?.kind === 'custom'
          ? [{ value: 'google-generative-ai', label: 'Gemini' }]
          : []),
        { value: 'openai-embeddings', label: 'Embeddings' },
        { value: 'jina-rerank', label: 'Rerank' },
      ].map((option) => [option.value, option]),
    ).values(),
  ]
  const [addingEndpoint, setAddingEndpoint] = useState(false)
  const [endpointProtocol, setEndpointProtocol] = useState('')
  const [endpointAddress, setEndpointAddress] = useState('')
  const source = requestDraft(provider)
  const signature = JSON.stringify(source)
  const initial = useRef(source)
  const [draft, setDraft] = useState(source)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const advancedId = useId()
  // OAuth 专用供应商继续使用原有测试能力，不提供基于 API Key/请求草稿的协议检测。
  const oauthOnly =
    (provider.authMethods?.includes('oauth') ?? false) &&
    !(provider.authMethods?.includes('api-key') ?? false)
  const availableEndpoints = endpointOptions.filter((option) => !(option.value in draft.endpoints))
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initial.current) ||
    (addingEndpoint && endpointAddress.trim().length > 0)
  useEffect(() => {
    if (!dirty && !saving) {
      initial.current = source
      setDraft(source)
    }
    // Saved provider refreshes must not replace a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.providerID, signature])
  useEffect(() => {
    onDraftChange(dirty || saving)
    return () => onDraftChange(false)
  }, [dirty, saving, onDraftChange])
  useEffect(() => {
    onBusyChange(saving || detecting)
    return () => onBusyChange(false)
  }, [saving, detecting, onBusyChange])
  function reset() {
    initial.current = source
    setDraft(source)
    setError(null)
    setAddingEndpoint(false)
    setEndpointAddress('')
  }
  async function save(nextDraft = draft): Promise<boolean> {
    if (saving) return false
    if (JSON.stringify(nextDraft) === JSON.stringify(initial.current) && !(addingEndpoint && endpointAddress.trim())) return true
    const config = provider.config
    if (!config) return false
    setSaving(true)
    setError(null)
    try {
      const endpoints = {
        ...nextDraft.endpoints,
        ...(addingEndpoint && endpointAddress.trim()
          ? { [endpointProtocol]: endpointAddress.trim() }
          : {}),
      }
      let next: DesktopProviderDefinition = {
        ...config,
        allowInsecureHttp: nextDraft.allowHttp,
        endpoints,
      }
      if (nextDraft.address !== initial.current.address || config.baseUrl)
        next = { ...next, baseUrl: nextDraft.address.trim() }
      if (config.kind === 'builtin' && (provider.catalogOrigin === 'models-dev' || provider.catalogOrigin === 'pi-remote') &&
        provider.availability?.status === 'unavailable' &&
        ['missing-api', 'unresolved-endpoint'].includes(provider.availability.reason)) {
        if (!DETECTION_PROTOCOL_ORDER.includes(nextDraft.protocol as typeof DETECTION_PROTOCOL_ORDER[number])) throw new Error('请选择已支持的协议')
        next = {
          kind: 'custom', id: config.id, name: nextDraft.name.trim(), enabled: config.enabled,
          directorySource: provider.catalogOrigin as 'pi-remote' | 'models-dev',
          baseUrl: nextDraft.address.trim(), auth: nextDraft.auth as 'api-key' | 'none',
          env: nextDraft.env.split(',').map((value) => value.trim()).filter(Boolean),
          allowInsecureHttp: nextDraft.allowHttp, headers: {}, models: [], endpoints,
        }
      }
      if (config.kind === 'custom') {
        const headers = parseHeaders(nextDraft.headers)
        if (headers instanceof Error) throw headers
        next = {
          ...config,
          endpoints,
          name: nextDraft.name.trim(),
          baseUrl: nextDraft.address.trim(),
          allowInsecureHttp: nextDraft.allowHttp,
          auth: nextDraft.auth as 'api-key' | 'none',
          env: nextDraft.env
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          headers,
          models: config.models.map((model) => {
            const detected = nextDraft.models.find((candidate) => candidate.id === String(model.id))
            if (detected && detected.api !== model.api) {
              const { compat: _, ...rest } = model
              return { ...rest, api: detected.api as typeof model.api }
            }
            if (
              (model.modelType && model.modelType !== 'chat') ||
              nextDraft.protocol === 'mixed' ||
              nextDraft.protocol === initial.current.protocol
            )
              return model
            const { compat: _, ...rest } = model
            return { ...rest, api: nextDraft.protocol as typeof model.api }
          }),
        }
      } else if (next.kind === 'builtin') {
        next = {
          ...next,
          ...(nextDraft.protocol !== 'mixed' &&
          ((config.kind === 'builtin' && config.protocol) ||
            nextDraft.protocol !== initial.current.protocol)
            ? { protocol: nextDraft.protocol }
            : {}),
          allowModels: nextDraft.allowModels
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean) as never,
          denyModels: nextDraft.denyModels
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean) as never,
        }
      }
      next = {
        ...next,
        endpoints: Object.fromEntries(
          Object.entries({
            ...(nextDraft.protocol !== 'mixed' ? { [nextDraft.protocol]: nextDraft.address.trim() } : {}),
            ...Object.fromEntries(Object.entries(endpoints).filter(([api]) => api !== nextDraft.protocol)),
          }).filter(([, address]) => address.trim()),
        ),
      }
      await onSaveDefinition(next)
      await onSaved()
      initial.current = {
        ...nextDraft,
        endpoints,
        address: nextDraft.address.trim(),
        name: nextDraft.name.trim(),
      }
      setDraft(initial.current)
      setAddingEndpoint(false)
      setEndpointAddress('')
      onDraftChange(false)
      return true
    } catch (error) {
      setError(fullErrorMessage(error))
      return false
    } finally {
      setSaving(false)
    }
  }
  useEffect(() => {
    saveRef.current = save
    resetRef.current = reset
    return () => {
      saveRef.current = null
      resetRef.current = null
    }
  })
  function changeProtocol(value: string) {
    const protocol = value
    setDraft({
      ...draft,
      endpoints:
        draft.protocol !== 'mixed'
          ? { ...draft.endpoints, [draft.protocol]: draft.address }
          : draft.endpoints,
      protocol: value,
      address: draft.endpoints[protocol] ?? draft.address,
    })
  }

  /** 用当前请求配置草稿和已保存凭据生成协议检测输入。 */
  function detectionRequestDraft():
    | {
        baseUrl: string
        endpoints?: Record<string, string>
        auth: 'api-key' | 'none'
        headers: Record<string, string>
        allowInsecureHttp: boolean
      }
    | Error {
    const headers = parseHeaders(draft.headers)
    if (headers instanceof Error) return headers
    if (!draft.address.trim()) return new Error('请先填写 API 地址。')
    const endpoints = Object.fromEntries(
      Object.entries(draft.endpoints)
        .map(([protocol, address]) => [protocol, address.trim()] as const)
        .filter(([, address]) => address.length > 0),
    )
    return {
      baseUrl: draft.address.trim(),
      ...(Object.keys(endpoints).length > 0 ? { endpoints } : {}),
      auth: draft.auth === 'none' ? 'none' : 'api-key',
      headers,
      allowInsecureHttp: draft.allowHttp,
    }
  }

  async function detectProtocols(): Promise<void> {
    if (detecting || saving) return
    const requestDraftValue = detectionRequestDraft()
    if (requestDraftValue instanceof Error) {
      setError(requestDraftValue.message)
      return
    }
    setDetecting(true)
    setError(null)
    try {
      const result = await desktopClient.detectProviderProtocols({
        draft: requestDraftValue,
        providerId: provider.providerID as RpcParams<'provider/protocol/detect'>['providerId'],
      })
      if (result.models.some((row) => row.cells.some((cell) => cell.status === 'success'))) {
        await applyDetection(result as DetectionResultLike)
      } else {
        setError('未检测到可用端点，请检查地址、凭据或稍后重试。')
      }
    } catch (detectError) {
      setError(fullErrorMessage(detectError))
    } finally {
      setDetecting(false)
    }
  }

  /** 检测结果先写回草稿，再复用配置保存流程。 */
  async function applyDetection(result: DetectionResultLike): Promise<void> {
    const current = draft
    const currentModels = provider.config?.kind === 'custom' ? current.models : []
    const applied = applyProtocolDetection(
      {
        address: current.address,
        endpoints: current.endpoints,
        protocol: current.protocol,
        models: currentModels,
      },
      result,
      currentModels,
    )
    const nextDraft = {
      ...current,
      endpoints: applied.endpoints,
      ...(applied.models ? { models: applied.models } : {}),
      ...(applied.protocol
        ? {
            protocol: applied.protocol,
            address: applied.endpoints[applied.protocol] ?? current.address,
          }
        : {}),
    }
    setDraft(nextDraft)
    await save(nextDraft)
  }

  const footer = (
    <footer className="tw:flex tw:shrink-0 tw:justify-end tw:gap-2 tw:border-t tw:border-app-border-subtle tw:px-4 tw:py-4">
      <Button color="secondary" size="sm" shape="default" disabled={saving} onClick={onCancel}>
        取消
      </Button>
      <Button
        color="primary"
        size="sm"
        shape="default"
        disabled={saving || !dirty}
        loading={saving}
        type="submit"
        form={formId}
      >
        保存配置
      </Button>
      {onDelete ? (
        <Button
          variant="danger"
          size="sm"
          shape="default"
          disabled={saving || dirty}
          onClick={() => void onDelete()}
        >
          删除供应商
        </Button>
      ) : null}
    </footer>
  )
  return (
    <form
      id={formId}
      className="tw:grid tw:min-w-0 tw:gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <fieldset
        disabled={saving || detecting}
        className="tw:m-0 tw:grid tw:min-h-0 tw:min-w-0 tw:content-start tw:gap-4 tw:border-0 tw:p-0"
      >
        <header className="tw:flex tw:items-center tw:justify-between tw:gap-3">
          <h3 className="tw:m-0 tw:type-title-sm">请求配置</h3>
          <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
            {!oauthOnly ? (
              <Button
                size="sm"
                shape="default"
                color="secondary"
                disabled={saving || detecting}
                loading={detecting}
                onClick={() => void detectProtocols()}
              >
                <Activity aria-hidden="true" size={APP_ICON_SIZES.sm} />
                检测协议
              </Button>
            ) : null}
            {!addingEndpoint ? (
              <Button
                size="sm"
                shape="default"
                variant="outline"
                disabled={!availableEndpoints.length}
                onClick={() => {
                  setEndpointProtocol(availableEndpoints[0]!.value)
                  setAddingEndpoint(true)
                }}
              >
                <Plus aria-hidden="true" size={APP_ICON_SIZES.sm} />
                添加端点
              </Button>
            ) : null}
          </div>
        </header>
        {provider.config?.kind === 'custom' ? (
          <label className="tw:grid tw:gap-2 tw:type-label">
            供应商名称
            <Input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
        ) : null}
        {Object.keys(draft.endpoints).length > 0 ? (
          endpointOptions
            .filter((option) => option.value in draft.endpoints)
            .map((option) => (
              <div key={option.value} className="tw:grid tw:gap-2 tw:type-label">
                <span className="tw:flex tw:items-center tw:gap-2">
                  {option.label}
                  {!['openai-embeddings', 'jina-rerank'].includes(option.value) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      shape="default"
                      disabled={draft.protocol === option.value}
                      onClick={() => changeProtocol(option.value)}
                    >
                      {draft.protocol === option.value ? '默认' : '设为默认'}
                    </Button>
                  ) : null}
                </span>
                <Input
                  aria-label={
                    draft.protocol === option.value ? 'API 地址' : `${option.label} API 地址`
                  }
                  value={
                    draft.protocol === option.value
                      ? draft.address
                      : (draft.endpoints[option.value] ?? '')
                  }
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      ...(draft.protocol === option.value ? { address: event.target.value } : {}),
                      endpoints: { ...draft.endpoints, [option.value]: event.target.value },
                    })
                  }
                />
              </div>
            ))
        ) : (
          <label className="tw:grid tw:gap-2 tw:type-label">
            API 地址
            <Input
              aria-label="API 地址"
              value={draft.address}
              onChange={(event) => setDraft({ ...draft, address: event.target.value })}
            />
          </label>
        )}
        {addingEndpoint ? (
          <div className="tw:grid tw:gap-3">
            <SettingsDropdown
              ariaLabel="新端点协议"
              value={endpointProtocol}
              options={availableEndpoints}
              onChange={setEndpointProtocol}
            />
            <Input
              aria-label="新端点 API 地址"
              placeholder="https://example.com/v1"
              value={endpointAddress}
              onChange={(event) => setEndpointAddress(event.target.value)}
            />
            <div className="tw:flex tw:justify-end tw:gap-2">
              <Button
                size="sm"
                shape="default"
                color="secondary"
                onClick={() => {
                  setAddingEndpoint(false)
                  setEndpointAddress('')
                }}
              >
                取消添加端点
              </Button>
              <Button
                size="sm"
                shape="default"
                color="primary"
                disabled={!endpointProtocol || !endpointAddress.trim()}
                onClick={() => {
                  setDraft({
                    ...draft,
                    endpoints: { ...draft.endpoints, [endpointProtocol]: endpointAddress.trim() },
                  })
                  setAddingEndpoint(false)
                  setEndpointAddress('')
                }}
              >
                添加
              </Button>
            </div>
          </div>
        ) : null}
        <div className="tw:grid tw:gap-3">
          <button
            type="button"
            className="tw:flex tw:items-center tw:justify-start tw:gap-2 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-app-text-soft tw:type-body-sm tw:hover:text-app-text tw:focus-visible:outline-app-focus"
            aria-expanded={advanced}
            aria-controls={advancedId}
            onClick={() => setAdvanced(!advanced)}
          >
            <ChevronRight
              aria-hidden="true"
              size="var(--inline-icon-size, 1em)"
              strokeWidth={APP_ICON_STROKE_WIDTH}
              className={advanced ? 'tw:rotate-90' : ''}
            />
            高级与网络设置
          </button>
          <DisclosureContent
            id={advancedId}
            expanded={advanced}
            contentClassName="tw:grid tw:gap-4"
          >
            <div className="tw:flex tw:items-center tw:justify-between tw:type-body-sm">
              <span>允许非本地明文 HTTP</span>
              <ToggleSwitch
                ariaLabel="允许远程 HTTP"
                checked={draft.allowHttp}
                onChange={(allowHttp) => setDraft({ ...draft, allowHttp })}
              />
            </div>
            {provider.config?.kind === 'builtin' ? (
              <>
                <label className="tw:grid tw:gap-2 tw:type-body-sm">
                  允许模型（逗号分隔，留空表示全部）
                  <Input
                    value={draft.allowModels}
                    onChange={(event) => setDraft({ ...draft, allowModels: event.target.value })}
                  />
                </label>
                <label className="tw:grid tw:gap-2 tw:type-body-sm">
                  排除模型（逗号分隔）
                  <Input
                    value={draft.denyModels}
                    onChange={(event) => setDraft({ ...draft, denyModels: event.target.value })}
                  />
                </label>
              </>
            ) : null}
            {provider.config?.kind === 'custom' ? (
              <>
                <label className="tw:grid tw:gap-2 tw:type-label">
                  认证方式
                  <SettingsDropdown
                    ariaLabel="认证方式"
                    value={draft.auth}
                    options={[
                      { value: 'api-key', label: 'API Key' },
                      { value: 'none', label: '无需认证' },
                    ]}
                    onChange={(auth) => setDraft({ ...draft, auth: auth as 'api-key' | 'none' })}
                  />
                </label>
                <label className="tw:grid tw:gap-2 tw:type-label">
                  环境变量（逗号分隔）
                  <Input
                    value={draft.env}
                    onChange={(event) => setDraft({ ...draft, env: event.target.value })}
                  />
                </label>
              </>
            ) : null}
            {provider.config?.kind === 'custom' ? (
              <label className="tw:grid tw:gap-2 tw:type-label">
                自定义请求头
                <textarea
                  className="tw:min-h-24 tw:rounded-md tw:border tw:border-app-border tw:bg-app-control tw:p-3 tw:type-code"
                  aria-label="自定义请求头"
                  placeholder="每行 name: value"
                  value={draft.headers}
                  onChange={(event) => setDraft({ ...draft, headers: event.target.value })}
                />
              </label>
            ) : null}
          </DisclosureContent>
        </div>
        {error ? (
          <p role="alert" className="tw:m-0 tw:text-app-danger tw:type-body-sm">
            {error}
          </p>
        ) : null}
      </fieldset>
      {footerHost ? createPortal(footer, footerHost) : footer}
    </form>
  )
}
