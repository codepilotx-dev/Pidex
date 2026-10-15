import { ChevronRight } from 'lucide-react'
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
import { headersToText, parseHeaders } from './ProviderEditorForm.js'
import {
  DEEPSEEK_PROTOCOL_OPTIONS,
} from './DeepseekProtocol.js'

const commonProtocols = DEEPSEEK_PROTOCOL_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}))
function providerProtocols(provider: DesktopModelProviderSummary) {
  const apis = provider.config?.kind === 'custom'
    ? [...new Set([...provider.config.models.map((model) => model.api), ...Object.keys(provider.config.endpoints ?? {})])]
    : Object.keys(provider.endpointDefaults ?? {}).length > 0
      ? Object.keys(provider.endpointDefaults!)
      : provider.nativeApis ?? provider.providerApis ?? []
  return apis.map((value) => ({ value, label: commonProtocols.find((option) => option.value === value)?.label ?? ({ 'google-generative-ai': 'Gemini', 'google-vertex': 'Vertex AI', 'bedrock-converse-stream': 'Bedrock Converse', 'azure-openai-responses': 'Azure Responses', 'openai-codex-responses': 'Codex Responses', 'mistral-conversations': 'Mistral Conversations' } as Record<string, string>)[value] ?? value }))
}
function requestDraft(provider: DesktopModelProviderSummary) {
  const config = provider.config
  const apis =
    config?.kind === 'custom'
      ? [...new Set(config.models.map((model) => model.api))]
      : (provider.providerApis ?? [])
  const protocols = providerProtocols(provider)
  const endpoints: Record<string, string> = { ...(provider.endpointDefaults ?? {}), ...(config?.endpoints ?? {}) }
  for (const api of protocols.map((option) => option.value)) {
    endpoints[api] ??= config?.baseUrl ?? provider.baseURL ?? ''
  }
  const protocol = config?.kind === 'builtin'
    ? config.protocol ?? provider.defaultApi ?? provider.nativeApis?.[0] ?? apis[0] ?? 'mixed'
    : apis[0] ?? 'mixed'
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
  }
}

export function ProviderRequestSettingsForm({
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
  const protocols = providerProtocols(provider)
  const source = requestDraft(provider)
  const signature = JSON.stringify(source)
  const initial = useRef(source)
  const [draft, setDraft] = useState(source)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const advancedId = useId()
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current)
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
    onBusyChange(saving)
    return () => onBusyChange(false)
  }, [saving, onBusyChange])
  function reset() {
    initial.current = source
    setDraft(source)
    setError(null)
  }
  async function save(): Promise<boolean> {
    if (saving) return false
    if (!dirty) return true
    const config = provider.config
    if (!config) return false
    setSaving(true)
    setError(null)
    try {
      let next: DesktopProviderDefinition = { ...config, allowInsecureHttp: draft.allowHttp, endpoints: draft.endpoints }
      if (draft.address !== initial.current.address || config.baseUrl)
        next = { ...next, baseUrl: draft.address.trim() }
      if (config.kind === 'custom') {
        const headers = parseHeaders(draft.headers)
        if (headers instanceof Error) throw headers
        next = {
          ...config,
          endpoints: draft.endpoints,
          name: draft.name.trim(),
          baseUrl: draft.address.trim(),
          allowInsecureHttp: draft.allowHttp,
          auth: draft.auth as 'api-key' | 'none',
          env: draft.env
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean),
          headers,
          models: config.models.map((model) => {
            if (draft.protocol === 'mixed' || draft.protocol === initial.current.protocol) return model
            const { compat: _, ...rest } = model
            return { ...rest, api: draft.protocol as typeof model.api }
          }),
        }
      } else if (next.kind === 'builtin') {
        next = { ...next,
          ...(draft.protocol !== 'mixed' && (config.kind === 'builtin' && config.protocol || draft.protocol !== initial.current.protocol) ? { protocol: draft.protocol } : {}),
          allowModels: draft.allowModels.split(',').map((id) => id.trim()).filter(Boolean) as never,
          denyModels: draft.denyModels.split(',').map((id) => id.trim()).filter(Boolean) as never,
        }
      }
      next = { ...next, endpoints: Object.fromEntries(Object.entries({
        ...draft.endpoints,
        ...(draft.protocol !== 'mixed' ? { [draft.protocol]: draft.address.trim() } : {}),
      }).filter(([, address]) => address.trim())) }
      await onSaveDefinition(next)
      await onSaved()
      initial.current = { ...draft, address: draft.address.trim(), name: draft.name.trim() }
      setDraft(initial.current)
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
      endpoints: draft.protocol !== 'mixed' ? { ...draft.endpoints, [draft.protocol]: draft.address } : draft.endpoints,
      protocol: value,
      address: draft.endpoints[protocol] ?? draft.address,
    })
  }

  return (
    <form
      className="tw:grid tw:min-w-0 tw:gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <fieldset
        disabled={saving}
        className="tw:m-0 tw:grid tw:min-h-0 tw:min-w-0 tw:content-start tw:gap-4 tw:border-0 tw:p-0"
      >
        {provider.config?.kind === 'custom' ? (
          <label className="tw:grid tw:gap-2 tw:type-label">
            供应商名称
            <Input
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
        ) : null}
        {Object.keys(draft.endpoints).length > 0 ? protocols.filter((option) => option.value in draft.endpoints).map((option) => (
          <div key={option.value} className="tw:grid tw:gap-2 tw:type-label">
            <span className="tw:flex tw:items-center tw:gap-2">
              {option.label}
              <Button
                variant="outline"
                size="md" shape="default"
                disabled={draft.protocol === option.value}
                onClick={() => changeProtocol(option.value)}
              >
                {draft.protocol === option.value ? '默认' : '设为默认'}
              </Button>
            </span>
            <Input
              aria-label={draft.protocol === option.value ? 'API 地址' : `${option.label} API 地址`}
              value={draft.protocol === option.value ? draft.address : draft.endpoints[option.value] ?? ''}
              onChange={(event) => setDraft({ ...draft,
                ...(draft.protocol === option.value ? { address: event.target.value } : {}),
                endpoints: { ...draft.endpoints, [option.value]: event.target.value },
              })}
            />
          </div>
        )) : <label className="tw:grid tw:gap-2 tw:type-label">
          API 地址
          <Input aria-label="API 地址" value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} />
        </label>}
        <div className="tw:grid tw:gap-3 tw:border-t tw:border-app-border-subtle tw:pt-4">
          <button
            type="button"
            className="tw:flex tw:items-center tw:justify-start tw:gap-2 tw:border-0 tw:bg-transparent tw:p-0 tw:text-left tw:text-app-text-soft tw:type-body-sm tw:hover:text-app-text tw:focus-visible:outline-app-focus"
            aria-expanded={advanced}
            aria-controls={advancedId}
            onClick={() => setAdvanced(!advanced)}
          >
            <ChevronRight aria-hidden="true" size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} className={advanced ? 'tw:rotate-90' : ''} />
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
            {provider.config?.kind === 'builtin' ? <>
              <label className="tw:grid tw:gap-2 tw:type-body-sm">允许模型（逗号分隔，留空表示全部）
                <Input value={draft.allowModels} onChange={(event) => setDraft({ ...draft, allowModels: event.target.value })} />
              </label>
              <label className="tw:grid tw:gap-2 tw:type-body-sm">排除模型（逗号分隔）
                <Input value={draft.denyModels} onChange={(event) => setDraft({ ...draft, denyModels: event.target.value })} />
              </label>
            </> : null}
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
          </DisclosureContent>
        </div>
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
        {error ? (
          <p role="alert" className="tw:m-0 tw:text-app-danger tw:type-body-sm">
            {error}
          </p>
        ) : null}
      </fieldset>
      <footer className="tw:flex tw:shrink-0 tw:justify-end tw:gap-2 tw:border-t tw:border-app-border-subtle tw:pt-4">
        <Button color="secondary" size="md" shape="default" disabled={saving} onClick={onCancel}>
          取消
        </Button>
        <Button color="primary" size="md" shape="default" disabled={saving || !dirty} loading={saving} type="submit">
          保存配置
        </Button>
        {onDelete ? (
          <Button variant="danger" size="md" shape="default" disabled={saving || dirty} onClick={() => void onDelete()}>
            删除供应商
          </Button>
        ) : null}
      </footer>
    </form>
  )
}
