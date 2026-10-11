import * as Dialog from '@radix-ui/react-dialog'
import { ChevronDown, ChevronUp, ExternalLink, Plus, Trash2, X } from 'lucide-react'
import type React from 'react'
import { memo, useEffect, useId, useRef, useState } from 'react'
import type {
  DesktopEditableMcpScope,
  DesktopMcpServerConfig,
  DesktopMcpServerListItem,
  DesktopMcpToolApprovalMode,
  SaveDesktopMcpServerOptions,
} from '../../../../shared/Types.js'
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
import { SettingsDropdown } from '../SettingsDropdown.js'
import { useLastNonNull } from '../../../hooks/UsePresenceRetention.js'
import { errorMessageOf as rawErrorMessage } from '@pidex/shared/errors'

type TransportType = DesktopMcpServerConfig['type']

type EditableValueRow = {
  id: string
  value: string
}

type EditableMapRow = {
  id: string
  key: string
  value: string
}

type FormState = {
  originalName: string
  name: string
  scope: DesktopEditableMcpScope
  enabled: boolean
  diagnosticContext: boolean
  type: TransportType
  command: string
  args: EditableValueRow[]
  cwd: string
  env: EditableMapRow[]
  envFromHost: EditableMapRow[]
  url: string
  httpAuth: 'none' | 'oauth'
  scopes: EditableValueRow[]
  oauthResource: string
  headers: EditableMapRow[]
  headerFromEnv: EditableMapRow[]
  bearerTokenEnvVar: string
  startupTimeoutMs: string
  toolTimeoutMs: string
  required: boolean
  enabledToolsConfigured: boolean
  enabledTools: EditableValueRow[]
  disabledTools: EditableValueRow[]
  defaultToolsApprovalMode: DesktopMcpToolApprovalMode
  toolApprovals: EditableMapRow[]
  configText: string
}

export type ParsedMcpServerJson = {
  name: string
  scope: DesktopEditableMcpScope
  enabled: boolean
  diagnosticContext: boolean
  transport: DesktopMcpServerConfig
  startupTimeoutMs?: number
  toolTimeoutMs?: number
  required?: boolean
  enabledTools?: string[]
  disabledTools?: string[]
  defaultToolsApprovalMode?: DesktopMcpToolApprovalMode
  tools?: Record<string, { approvalMode: DesktopMcpToolApprovalMode }>
}

type Props = {
  open: boolean
  server: DesktopMcpServerListItem | null
  busy: boolean
  workspaceAvailable: boolean
  restoreFocusElement?: HTMLElement | null
  onOpenChange: (open: boolean) => void
  onSave: (options: SaveDesktopMcpServerOptions) => Promise<void>
  onRemove: (server: DesktopMcpServerListItem) => void
  onOpenDocumentation: () => void
  onError: (message: string) => void
}

const SCOPE_OPTIONS: Array<{ value: DesktopEditableMcpScope; label: string }> = [
  { value: 'user', label: '用户' },
  { value: 'local', label: '当前工作区' },
]

const TYPE_OPTIONS: Array<{ value: TransportType; label: string }> = [
  { value: 'stdio', label: 'STDIO' },
  { value: 'http', label: '流式 HTTP' },
]
const APPROVAL_MODE_OPTIONS: Array<{
  value: DesktopMcpToolApprovalMode
  label: string
}> = [
  { value: 'auto', label: '自动判断' },
  { value: 'prompt', label: '始终询问' },
  { value: 'writes', label: '写操作询问' },
  { value: 'approve', label: '始终允许' },
]
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const SENSITIVE_NAME =
  /(?:^|[_-])(authorization|cookie|password|secret|token|api[_-]?key)(?:$|[_-])/i
const STATIC_SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
])

export function McpEditorDialog({
  open,
  server: currentServer,
  busy,
  workspaceAvailable,
  restoreFocusElement,
  onOpenChange,
  onSave,
  onRemove,
  onOpenDocumentation,
}: Props): React.ReactNode {
  const retainedServer = useLastNonNull(currentServer)
  const server = open ? currentServer : retainedServer
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const visitedTransportTypes = useRef<Set<TransportType>>(new Set())
  const stdioDiagnosticContext = useRef(false)
  const [form, setForm] = useState<FormState>(() => formForServer(null))
  const advancedRef = useRef(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(formForServer(server))
    visitedTransportTypes.current = new Set([server?.transport.type ?? 'stdio'])
    stdioDiagnosticContext.current = server?.diagnosticContext ?? false
    advancedRef.current = false
    setValidationError(null)
  }, [open, server])

  function update(mutator: (current: FormState) => FormState): void {
    setValidationError(null)
    setForm((current) => {
      if (current.type === 'stdio') {
        stdioDiagnosticContext.current = current.diagnosticContext
      }
      const next = mutator(current)
      try {
        return { ...next, configText: formatConfig(editorConfigForForm(next)) }
      } catch {
        return next
      }
    })
  }

  function updateType(type: TransportType): void {
    setValidationError(null)
    setForm((current) => {
      const firstVisit = !visitedTransportTypes.current.has(type)
      visitedTransportTypes.current.add(type)
      const defaults = formFromTransport(templateConfig(type))
      const next: FormState = {
        ...current,
        type,
        ...(firstVisit && type === 'stdio'
          ? {
              command: defaults.command,
              args: defaults.args,
              cwd: defaults.cwd,
              env: defaults.env,
              envFromHost: defaults.envFromHost,
            }
          : {}),
        ...(firstVisit && type === 'http'
          ? {
              url: defaults.url,
              httpAuth: defaults.httpAuth,
              scopes: defaults.scopes,
              oauthResource: defaults.oauthResource,
              headers: defaults.headers,
              headerFromEnv: defaults.headerFromEnv,
              bearerTokenEnvVar: defaults.bearerTokenEnvVar,
            }
          : {}),
        diagnosticContext: type === 'stdio' ? stdioDiagnosticContext.current : false,
        configText: '',
      }
      return {
        ...next,
        configText: formatConfig(editorConfigForForm(next)),
      }
    })
  }

  function applyAdvancedJson(): void {
    try {
      const config = parseMcpServerJson(form.configText)
      if (
        server &&
        (config.scope !== server.scope || config.transport.type !== server.transport.type)
      ) {
        throw new Error('现有 MCP server 的配置范围和 transport 不能修改。')
      }
      setForm((current) => formFromEditorConfig(config, current.originalName))
      setValidationError(null)
    } catch (error) {
      setValidationError(`高级 JSON 无法应用：${errorMessageOf(error)}`)
    }
  }

  async function save(): Promise<void> {
    let candidate = form
    if (advancedRef.current) {
      try {
        candidate = formFromEditorConfig(parseMcpServerJson(form.configText), form.originalName)
      } catch (error) {
        setValidationError(`高级 JSON 无法应用：${errorMessageOf(error)}`)
        return
      }
    }
    const name = candidate.name.trim()
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) {
      setValidationError('名称必须为 1-64 位字母、数字、点、下划线或连字符。')
      return
    }
    if (candidate.scope === 'local' && !workspaceAvailable) {
      setValidationError('工作区 MCP 配置需要先打开一个工作区。')
      return
    }
    if (server && (candidate.scope !== server.scope || candidate.type !== server.transport.type)) {
      setValidationError('现有 MCP server 的配置范围和 transport 不能修改。')
      return
    }
    let transport: DesktopMcpServerConfig
    try {
      transport = validateTransport(transportForForm(candidate))
    } catch (error) {
      setValidationError(errorMessageOf(error))
      return
    }
    if (candidate.diagnosticContext && transport.type !== 'stdio') {
      setValidationError('会话诊断上下文只支持 stdio transport。')
      return
    }
    const startupTimeoutMs = optionalTimeout(candidate.startupTimeoutMs, '启动超时')
    const toolTimeoutMs = optionalTimeout(candidate.toolTimeoutMs, '工具超时')
    if (startupTimeoutMs instanceof Error) {
      setValidationError(startupTimeoutMs.message)
      return
    }
    if (toolTimeoutMs instanceof Error) {
      setValidationError(toolTimeoutMs.message)
      return
    }
    let enabledTools: string[]
    let disabledTools: string[]
    let tools: Record<string, { approvalMode: DesktopMcpToolApprovalMode }>
    try {
      enabledTools = uniqueNamesFromRows(candidate.enabledTools, '仅启用工具')
      disabledTools = uniqueNamesFromRows(candidate.disabledTools, '禁用工具')
      tools = toolPoliciesFromRows(candidate.toolApprovals)
    } catch (error) {
      setValidationError(errorMessageOf(error))
      return
    }
    setValidationError(null)
    await onSave({
      originalName: candidate.originalName || undefined,
      name,
      scope: candidate.scope,
      enabled: candidate.enabled,
      diagnosticContext: candidate.diagnosticContext,
      transport,
      ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
      ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
      ...(candidate.required ? { required: true } : {}),
      ...(candidate.enabledToolsConfigured ? { enabledTools } : {}),
      ...(disabledTools.length ? { disabledTools } : {}),
      ...(candidate.defaultToolsApprovalMode !== 'auto'
        ? { defaultToolsApprovalMode: candidate.defaultToolsApprovalMode }
        : {}),
      ...(Object.keys(tools).length ? { tools } : {}),
    })
  }

  const runtimeError = server?.runtime?.error?.message
  const needsAuth = server?.runtime?.state === 'needs_auth'

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-backdrop permission-modal-backdrop" />
        <Dialog.Content
          className="ui-dialog-surface ui-dialog-surface--centered settings-management-dialog tw:flex tw:max-h-[min(48rem,calc(100vh-3rem))] tw:w-[min(44rem,calc(100vw-3rem))] tw:flex-col tw:overflow-hidden tw:p-0 tw:text-app-text"
          onCloseAutoFocus={(event) => {
            if (!restoreFocusElement?.isConnected) return
            event.preventDefault()
            restoreFocusElement.focus()
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            closeRef.current?.focus()
          }}
        >
          <header className="settings-management-dialog-header tw:flex tw:items-start tw:gap-3">
            <span className="settings-management-dialog-heading tw:min-w-0 tw:flex-1">
              <Dialog.Title className="tw:type-title-sm tw:m-0">
                {server ? `MCP：${server.name}` : '新增 MCP server'}
              </Dialog.Title>
              <Dialog.Description className="tw:type-body-sm tw:mt-1 tw:mb-0 tw:text-app-text-soft">
                使用结构化字段配置 stdio 或 Streamable HTTP；HTTP 会在协议不兼容时自动回退 SSE。
              </Dialog.Description>
              <Button color="secondary" className="tw:mt-1" onClick={onOpenDocumentation}>
                官方 MCP 文档
                <ExternalLink aria-hidden="true" size={APP_ICON_SIZE} />
              </Button>
            </span>
            <Dialog.Close asChild>
              <Button
                isIconOnly
                color="ghostSecondary"
                ref={closeRef}
                size="toolbar"
                title="关闭 MCP 编辑器"
              >
                <X aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              </Button>
            </Dialog.Close>
          </header>

          <div className="settings-management-dialog-body tw:grid tw:min-h-0 tw:flex-1 tw:gap-4 tw:overflow-auto">
            {runtimeError || needsAuth ? (
              <div className="tw:type-body-sm tw:border tw:border-app-border tw:bg-app-canvas tw:px-3 tw:py-2 tw:text-app-text-soft">
                {runtimeError ??
                  '该 server 需要认证。请从 MCP 列表发起 OAuth 登录，或配置宿主环境变量凭据。'}
              </div>
            ) : null}
            {validationError ? (
              <div
                className="tw:type-body-sm tw:border tw:border-app-danger/40 tw:bg-app-danger/10 tw:px-3 tw:py-2 tw:text-app-danger"
                role="alert"
              >
                {validationError}
              </div>
            ) : null}

            <FormCard>
              <FormRow label="名称">
                <Input
                  aria-label="MCP server 名称"
                  value={form.name}
                  placeholder="MCP server name"
                  onChange={(event) =>
                    update((current) => ({ ...current, name: event.target.value }))
                  }
                />
              </FormRow>
              <FormRow label="类型">
                <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
                  {server ? (
                    <span className="tw:type-caption tw:text-app-text-soft">
                      已有配置的 transport 不可修改。
                    </span>
                  ) : (
                    <span />
                  )}
                  <SegmentedControl
                    ariaLabel="MCP transport"
                    value={form.type}
                    options={TYPE_OPTIONS.map((option) => ({
                      ...option,
                      disabled: Boolean(server),
                    }))}
                    onChange={updateType}
                  />
                </div>
              </FormRow>
            </FormCard>

            {form.type === 'stdio' ? (
              <FormCard>
                <FormRow label="启动命令">
                  <Input
                    aria-label="stdio 启动命令"
                    value={form.command}
                    placeholder="bun"
                    onChange={(event) =>
                      update((current) => ({ ...current, command: event.target.value }))
                    }
                  />
                </FormRow>
                <ValueListField
                  addLabel="添加参数"
                  label="参数"
                  placeholder="server.ts"
                  rows={form.args}
                  onChange={(args) => update((current) => ({ ...current, args }))}
                />
                <MapListField
                  addLabel="添加环境变量"
                  keyLabel="环境变量名"
                  label="环境变量"
                  rows={form.env}
                  valueLabel="值"
                  onChange={(env) => update((current) => ({ ...current, env }))}
                />
                <MapListField
                  addLabel="添加变量"
                  keyLabel="MCP 变量名"
                  label="环境变量传递"
                  rows={form.envFromHost}
                  valueLabel="宿主变量名"
                  onChange={(envFromHost) => update((current) => ({ ...current, envFromHost }))}
                />
                <FormRow label="工作目录">
                  <Input
                    aria-label="stdio 工作目录"
                    value={form.cwd}
                    placeholder="C:\workspace"
                    onChange={(event) =>
                      update((current) => ({ ...current, cwd: event.target.value }))
                    }
                  />
                </FormRow>
              </FormCard>
            ) : (
              <FormCard>
                <FormRow label="URL">
                  <Input
                    aria-label="MCP URL"
                    value={form.url}
                    placeholder="https://mcp.example.com/mcp"
                    onChange={(event) =>
                      update((current) => ({ ...current, url: event.target.value }))
                    }
                  />
                </FormRow>
                <FormRow label="Bearer 令牌环境变量">
                  <Input
                    aria-label="Bearer Token 环境变量名"
                    value={form.bearerTokenEnvVar}
                    placeholder="MCP_BEARER_TOKEN"
                    onChange={(event) =>
                      update((current) => ({ ...current, bearerTokenEnvVar: event.target.value }))
                    }
                  />
                </FormRow>
                <MapListField
                  addLabel="添加标头"
                  keyLabel="标头名称"
                  label="标头"
                  rows={form.headers}
                  valueLabel="值"
                  onChange={(headers) => update((current) => ({ ...current, headers }))}
                />
                <MapListField
                  addLabel="添加变量"
                  keyLabel="标头名称"
                  label="来自环境变量的标头"
                  rows={form.headerFromEnv}
                  valueLabel="宿主变量名"
                  onChange={(headerFromEnv) => update((current) => ({ ...current, headerFromEnv }))}
                />
              </FormCard>
            )}

            <FormCard>
              <FormRow label="配置范围">
                <SettingsDropdown
                  value={form.scope}
                  size="md"
                  disabled={Boolean(server)}
                  options={SCOPE_OPTIONS.map((option) => ({
                    ...option,
                    disabled: option.value === 'local' && !workspaceAvailable,
                  }))}
                  onChange={(value) =>
                    update((current) => ({
                      ...current,
                      scope: value as DesktopEditableMcpScope,
                    }))
                  }
                  ariaLabel="MCP scope"
                />
              </FormRow>
              <FormRow label="启用">
                <ToggleSwitch
                  ariaLabel="MCP server"
                  checked={form.enabled}
                  onChange={(enabled) => update((current) => ({ ...current, enabled }))}
                />
              </FormRow>
              <FormRow label="必需 Server">
                <span className="tw:flex tw:items-center tw:gap-2">
                  <ToggleSwitch
                    ariaLabel="必需 Server"
                    checked={form.required}
                    onChange={(required) => update((current) => ({ ...current, required }))}
                  />
                  <span className="tw:type-caption tw:text-app-text-soft">
                    开启后，连接失败会阻止任务开始。
                  </span>
                </span>
              </FormRow>
              {form.type === 'http' ? (
                <>
                  <FormRow label="OAuth">
                    <span className="tw:flex tw:items-center tw:gap-2">
                      <ToggleSwitch
                        ariaLabel="OAuth"
                        checked={form.httpAuth === 'oauth'}
                        onChange={(enabled) =>
                          update((current) => ({
                            ...current,
                            httpAuth: enabled ? 'oauth' : 'none',
                          }))
                        }
                      />
                      <span className="tw:type-body-sm tw:text-app-text-soft">
                        {form.httpAuth === 'oauth' ? '使用 OAuth 登录' : '不使用 OAuth'}
                      </span>
                    </span>
                  </FormRow>
                  {form.httpAuth === 'oauth' ? (
                    <>
                      <ValueListField
                        addLabel="添加 Scope"
                        label="OAuth Scopes"
                        placeholder="scope"
                        rows={form.scopes}
                        onChange={(scopes) => update((current) => ({ ...current, scopes }))}
                      />
                      <FormRow label="OAuth Resource">
                        <Input
                          aria-label="OAuth Resource"
                          value={form.oauthResource}
                          placeholder="https://mcp.example.com"
                          onChange={(event) =>
                            update((current) => ({ ...current, oauthResource: event.target.value }))
                          }
                        />
                      </FormRow>
                    </>
                  ) : null}
                </>
              ) : null}
            </FormCard>

            <McpAdvancedDisclosure
              open={open}
              onExpandedChange={(expanded) => {
                advancedRef.current = expanded
              }}
            >
              <FormCard>
                <ValueListField
                  addLabel="添加启用工具"
                  label="仅启用这些工具"
                  placeholder="tool-name"
                  rows={form.enabledTools}
                  onChange={(enabledTools) =>
                    update((current) => ({
                      ...current,
                      enabledTools,
                      enabledToolsConfigured: true,
                    }))
                  }
                />
                <ValueListField
                  addLabel="添加禁用工具"
                  label="禁用这些工具"
                  placeholder="tool-name"
                  rows={form.disabledTools}
                  onChange={(disabledTools) => update((current) => ({ ...current, disabledTools }))}
                />
                <FormRow label="默认工具审批">
                  <SettingsDropdown
                    ariaLabel="默认 MCP 工具审批模式"
                    value={form.defaultToolsApprovalMode}
                    size="md"
                    options={APPROVAL_MODE_OPTIONS}
                    onChange={(value) =>
                      update((current) => ({
                        ...current,
                        defaultToolsApprovalMode: value as DesktopMcpToolApprovalMode,
                      }))
                    }
                  />
                </FormRow>
                <ToolApprovalListField
                  rows={form.toolApprovals}
                  onChange={(toolApprovals) => update((current) => ({ ...current, toolApprovals }))}
                />
                {form.type === 'stdio' ? (
                  <FormRow label="传递会话诊断上下文">
                    <ToggleSwitch
                      ariaLabel="传递会话诊断上下文"
                      checked={form.diagnosticContext}
                      onChange={(diagnosticContext) =>
                        update((current) => ({
                          ...current,
                          diagnosticContext,
                        }))
                      }
                    />
                    <span className="tw:type-caption tw:text-app-text-soft">
                      仅向本地进程传递最近的可见消息和工具状态摘要，不包含系统提示词、推理内容、路径或工具原始参数。
                    </span>
                  </FormRow>
                ) : null}
                <FormRow label="超时">
                  <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:max-[640px]:grid-cols-1">
                    <Input
                      aria-label="启动超时（ms）"
                      inputMode="numeric"
                      value={form.startupTimeoutMs}
                      placeholder="启动：10000ms"
                      onChange={(event) =>
                        update((current) => ({ ...current, startupTimeoutMs: event.target.value }))
                      }
                    />
                    <Input
                      aria-label="工具超时（ms）"
                      inputMode="numeric"
                      value={form.toolTimeoutMs}
                      placeholder="工具：60000ms"
                      onChange={(event) =>
                        update((current) => ({ ...current, toolTimeoutMs: event.target.value }))
                      }
                    />
                  </div>
                </FormRow>
              </FormCard>
              <Field label="Server JSON">
                <textarea
                  className="settings-textarea settings-code-textarea tw:min-h-52 tw:w-full tw:resize-y"
                  rows={10}
                  spellCheck={false}
                  value={form.configText}
                  onBlur={applyAdvancedJson}
                  onChange={(event) => {
                    setValidationError(null)
                    setForm((current) => ({
                      ...current,
                      configText: event.target.value,
                    }))
                  }}
                />
              </Field>
            </McpAdvancedDisclosure>
          </div>

          <footer className="settings-management-dialog-footer tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2">
            <span>
              {server?.removable ? (
                <Button color="danger" disabled={busy} onClick={() => onRemove(server)}>
                  <Trash2
                    aria-hidden="true"
                    size={APP_ICON_SIZE}
                    strokeWidth={APP_ICON_STROKE_WIDTH}
                  />
                  删除
                </Button>
              ) : null}
            </span>
            <span className="tw:flex tw:items-center tw:gap-2">
              <Dialog.Close asChild>
                <Button color="secondary">关闭</Button>
              </Dialog.Close>
              <Button color="primary" disabled={busy} loading={busy} onClick={() => void save()}>
                保存
              </Button>
            </span>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

const McpAdvancedDisclosure = memo(function McpAdvancedDisclosure({
  children,
  open,
  onExpandedChange,
}: {
  children: React.ReactNode
  open: boolean
  onExpandedChange: (expanded: boolean) => void
}): React.ReactNode {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()

  useEffect(() => {
    if (open) return
    setExpanded(false)
    onExpandedChange(false)
  }, [onExpandedChange, open])

  const toggle = (): void => {
    setExpanded((current) => {
      const next = !current
      onExpandedChange(next)
      return next
    })
  }

  return (
    <>
      <button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="mcp-editor-advanced-disclosure tw:inline-flex tw:min-h-8 tw:cursor-pointer tw:items-center tw:justify-start tw:gap-2 tw:rounded-compact tw:border-0 tw:bg-transparent tw:px-2 tw:text-app-text-soft tw:hover:bg-app-hover tw:hover:text-app-text tw:aria-expanded:bg-app-hover tw:aria-expanded:text-app-text tw:focus-visible:outline-2 tw:focus-visible:outline-solid tw:focus-visible:outline-offset-1 tw:focus-visible:outline-app-focus"
        type="button"
        onClick={toggle}
      >
        {expanded ? (
          <ChevronUp aria-hidden="true" size={APP_ICON_SIZES.sm} />
        ) : (
          <ChevronDown aria-hidden="true" size={APP_ICON_SIZES.sm} />
        )}
        高级选项
      </button>
      <DisclosureContent
        contentClassName="tw:grid tw:gap-4"
        expanded={expanded}
        id={contentId}
        mountPolicy="always"
      >
        {children}
      </DisclosureContent>
    </>
  )
})

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactNode {
  return (
    <label className="tw:grid tw:gap-1.5">
      <span className="tw:type-control">{label}</span>
      {children}
    </label>
  )
}

function FormCard({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <section className="settings-management-dialog-card tw:grid tw:overflow-hidden">
      {children}
    </section>
  )
}

function FormRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.ReactNode {
  return (
    <div className="settings-management-dialog-row">
      <span className="settings-management-dialog-row-label">{label}</span>
      <div className="settings-management-dialog-row-control">{children}</div>
    </div>
  )
}

function ValueListField({
  label,
  addLabel,
  placeholder,
  rows,
  onChange,
}: {
  label: string
  addLabel: string
  placeholder: string
  rows: EditableValueRow[]
  onChange: (rows: EditableValueRow[]) => void
}): React.ReactNode {
  return (
    <FormRow label={label}>
      <div className="tw:grid tw:gap-2">
        {rows.map((row, index) => (
          <div
            className="tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2"
            key={row.id}
          >
            <Input
              aria-label={`${label} ${index + 1}`}
              value={row.value}
              placeholder={placeholder}
              onChange={(event) =>
                onChange(
                  rows.map((item) =>
                    item.id === row.id ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
            />
            <Button
              isIconOnly
              aria-label={`删除${label} ${index + 1}`}
              disabled={rows.length === 1 && !row.value}
              color="ghostSecondary"
              size="iconMd"
              title={`删除${label}`}
              onClick={() => onChange(removeValueRow(rows, row.id))}
            >
              <Trash2
                aria-hidden="true"
                size={APP_ICON_SIZES.sm}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </Button>
          </div>
        ))}
        <Button
          color="primary"
          className="tw:w-full tw:justify-center"
          onClick={() => onChange([...rows, createValueRow()])}
        >
          <Plus aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          {addLabel}
        </Button>
      </div>
    </FormRow>
  )
}

function MapListField({
  label,
  addLabel,
  keyLabel,
  valueLabel,
  rows,
  onChange,
}: {
  label: string
  addLabel: string
  keyLabel: string
  valueLabel: string
  rows: EditableMapRow[]
  onChange: (rows: EditableMapRow[]) => void
}): React.ReactNode {
  return (
    <FormRow label={label}>
      <div className="tw:grid tw:gap-2">
        {rows.map((row, index) => (
          <div
            className="tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:max-[640px]:grid-cols-[minmax(0,1fr)_auto]"
            key={row.id}
          >
            <Input
              aria-label={`${label}${keyLabel} ${index + 1}`}
              value={row.key}
              placeholder={keyLabel}
              onChange={(event) =>
                onChange(updateMapRow(rows, row.id, { key: event.target.value }))
              }
            />
            <Input
              aria-label={`${label}${valueLabel} ${index + 1}`}
              className="tw:max-[640px]:col-start-1"
              value={row.value}
              placeholder={valueLabel}
              onChange={(event) =>
                onChange(updateMapRow(rows, row.id, { value: event.target.value }))
              }
            />
            <Button
              isIconOnly
              aria-label={`删除${label} ${index + 1}`}
              className="tw:max-[640px]:col-start-2 tw:max-[640px]:row-start-1"
              disabled={rows.length === 1 && !row.key && !row.value}
              color="ghostSecondary"
              size="iconMd"
              title={`删除${label}`}
              onClick={() => onChange(removeMapRow(rows, row.id))}
            >
              <Trash2
                aria-hidden="true"
                size={APP_ICON_SIZES.sm}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </Button>
          </div>
        ))}
        <Button
          color="primary"
          className="tw:w-full tw:justify-center"
          onClick={() => onChange([...rows, createMapRow()])}
        >
          <Plus aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          {addLabel}
        </Button>
      </div>
    </FormRow>
  )
}

function ToolApprovalListField({
  rows,
  onChange,
}: {
  rows: EditableMapRow[]
  onChange: (rows: EditableMapRow[]) => void
}): React.ReactNode {
  return (
    <FormRow label="单个工具审批覆盖">
      <div className="tw:grid tw:gap-2">
        {rows.map((row, index) => (
          <div
            className="tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:max-[640px]:grid-cols-[minmax(0,1fr)_auto]"
            key={row.id}
          >
            <Input
              aria-label={`工具名称 ${index + 1}`}
              value={row.key}
              placeholder="tool-name"
              onChange={(event) =>
                onChange(updateMapRow(rows, row.id, { key: event.target.value }))
              }
            />
            <div className="tw:max-[640px]:col-start-1">
              <SettingsDropdown
                ariaLabel={`工具审批模式 ${index + 1}`}
                value={isApprovalMode(row.value) ? row.value : 'auto'}
                size="md"
                options={APPROVAL_MODE_OPTIONS}
                onChange={(value) => onChange(updateMapRow(rows, row.id, { value }))}
              />
            </div>
            <Button
              isIconOnly
              className="tw:max-[640px]:col-start-2 tw:max-[640px]:row-start-1"
              disabled={rows.length === 1 && !row.key}
              color="ghostSecondary"
              size="iconMd"
              title={`删除工具审批覆盖 ${index + 1}`}
              onClick={() => onChange(removeMapRow(rows, row.id))}
            >
              <Trash2
                aria-hidden="true"
                size={APP_ICON_SIZES.sm}
                strokeWidth={APP_ICON_STROKE_WIDTH}
              />
            </Button>
          </div>
        ))}
        <Button
          color="primary"
          className="tw:w-full tw:justify-center"
          onClick={() => onChange([...rows, createMapRow('', 'auto')])}
        >
          <Plus aria-hidden="true" size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
          添加工具覆盖
        </Button>
      </div>
    </FormRow>
  )
}

function formForServer(server: DesktopMcpServerListItem | null): FormState {
  if (!server) {
    const transport = templateConfig('stdio')
    const form: FormState = {
      ...formFromTransport(transport),
      originalName: '',
      name: '',
      scope: 'user',
      enabled: true,
      diagnosticContext: false,
      startupTimeoutMs: '',
      toolTimeoutMs: '',
      required: false,
      enabledToolsConfigured: false,
      enabledTools: [createValueRow()],
      disabledTools: [createValueRow()],
      defaultToolsApprovalMode: 'auto',
      toolApprovals: [createMapRow()],
      configText: '',
    }
    return {
      ...form,
      configText: formatConfig(editorConfigForForm(form)),
    }
  }
  const form: FormState = {
    ...formFromTransport(server.transport),
    originalName: server.name,
    name: server.name,
    scope: server.scope,
    enabled: server.enabled,
    diagnosticContext: server.diagnosticContext,
    startupTimeoutMs: server.startupTimeoutMs?.toString() ?? '',
    toolTimeoutMs: server.toolTimeoutMs?.toString() ?? '',
    required: server.required ?? false,
    enabledToolsConfigured: server.enabledTools !== undefined,
    enabledTools: valueRows(server.enabledTools),
    disabledTools: valueRows(server.disabledTools),
    defaultToolsApprovalMode: server.defaultToolsApprovalMode ?? 'auto',
    toolApprovals: toolPolicyRows(server.tools),
    configText: '',
  }
  return {
    ...form,
    configText: formatConfig(editorConfigForForm(form)),
  }
}

function formFromTransport(
  transport: DesktopMcpServerConfig,
): Omit<
  FormState,
  | 'originalName'
  | 'name'
  | 'scope'
  | 'enabled'
  | 'diagnosticContext'
  | 'startupTimeoutMs'
  | 'toolTimeoutMs'
  | 'required'
  | 'enabledToolsConfigured'
  | 'enabledTools'
  | 'disabledTools'
  | 'defaultToolsApprovalMode'
  | 'toolApprovals'
> {
  return {
    type: transport.type,
    command: transport.type === 'stdio' ? transport.command : '',
    args: valueRows(transport.type === 'stdio' ? transport.args : undefined),
    cwd: transport.type === 'stdio' ? (transport.cwd ?? '') : '',
    env: mapRows(transport.type === 'stdio' ? transport.env : undefined),
    envFromHost: mapRows(transport.type === 'stdio' ? transport.envFromHost : undefined),
    url: transport.type === 'http' ? transport.url : '',
    httpAuth: transport.type === 'http' ? (transport.auth ?? 'oauth') : 'none',
    scopes: valueRows(transport.type === 'http' ? transport.scopes : undefined),
    oauthResource: transport.type === 'http' ? (transport.oauthResource ?? '') : '',
    headers: mapRows(transport.type === 'http' ? transport.headers : undefined),
    headerFromEnv: mapRows(transport.type === 'http' ? transport.headerFromEnv : undefined),
    bearerTokenEnvVar: transport.type === 'http' ? (transport.bearerTokenEnvVar ?? '') : '',
    configText: formatConfig(transport),
  }
}

function formFromEditorConfig(config: ParsedMcpServerJson, originalName: string): FormState {
  const form: FormState = {
    ...formFromTransport(config.transport),
    originalName,
    name: config.name,
    scope: config.scope,
    enabled: config.enabled,
    diagnosticContext: config.diagnosticContext,
    startupTimeoutMs: config.startupTimeoutMs?.toString() ?? '',
    toolTimeoutMs: config.toolTimeoutMs?.toString() ?? '',
    required: config.required ?? false,
    enabledToolsConfigured: config.enabledTools !== undefined,
    enabledTools: valueRows(config.enabledTools),
    disabledTools: valueRows(config.disabledTools),
    defaultToolsApprovalMode: config.defaultToolsApprovalMode ?? 'auto',
    toolApprovals: toolPolicyRows(config.tools),
    configText: '',
  }
  return {
    ...form,
    configText: formatConfig(editorConfigForForm(form)),
  }
}

function editorConfigForForm(form: FormState): ParsedMcpServerJson {
  const transport = transportForForm(form)
  if (form.diagnosticContext && transport.type !== 'stdio') {
    throw new Error('会话诊断上下文只支持 stdio transport。')
  }
  const startupTimeoutMs = optionalTimeout(form.startupTimeoutMs, '启动超时')
  const toolTimeoutMs = optionalTimeout(form.toolTimeoutMs, '工具超时')
  if (startupTimeoutMs instanceof Error) throw startupTimeoutMs
  if (toolTimeoutMs instanceof Error) throw toolTimeoutMs
  const enabledTools = uniqueNamesFromRows(form.enabledTools, '仅启用工具')
  const disabledTools = uniqueNamesFromRows(form.disabledTools, '禁用工具')
  const tools = toolPoliciesFromRows(form.toolApprovals)
  return {
    name: form.name,
    scope: form.scope,
    enabled: form.enabled,
    diagnosticContext: form.diagnosticContext,
    transport,
    ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
    ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
    ...(form.required ? { required: true } : {}),
    ...(form.enabledToolsConfigured ? { enabledTools } : {}),
    ...(disabledTools.length ? { disabledTools } : {}),
    ...(form.defaultToolsApprovalMode !== 'auto'
      ? { defaultToolsApprovalMode: form.defaultToolsApprovalMode }
      : {}),
    ...(Object.keys(tools).length ? { tools } : {}),
  }
}

function transportForForm(form: FormState): DesktopMcpServerConfig {
  if (form.type === 'stdio') {
    const command = form.command.trim()
    if (!command) throw new Error('请输入 stdio 命令。')
    const args = valuesFromRows(form.args)
    const env = mapFromRows(form.env, '静态环境变量')
    const envFromHost = mapFromRows(form.envFromHost, '宿主环境变量映射')
    return {
      type: 'stdio',
      command,
      ...(args.length ? { args } : {}),
      ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(Object.keys(envFromHost).length ? { envFromHost } : {}),
    }
  }
  const url = form.url.trim()
  if (!url) throw new Error('请输入 MCP URL。')
  validateHttpUrl(url)
  const headers = mapFromRows(form.headers, '静态 Header')
  const headerFromEnv = mapFromRows(form.headerFromEnv, 'Header 环境变量映射')
  const scopes = uniqueNamesFromRows(form.scopes, 'OAuth scopes')
  validateOAuthScopes(scopes)
  if (form.oauthResource.trim()) validateAbsoluteUri(form.oauthResource.trim(), 'OAuth resource')
  return {
    type: 'http',
    url,
    ...(form.httpAuth === 'oauth' ? { auth: 'oauth' as const } : {}),
    ...(form.httpAuth === 'oauth' && scopes.length ? { scopes } : {}),
    ...(form.httpAuth === 'oauth' && form.oauthResource.trim()
      ? { oauthResource: form.oauthResource.trim() }
      : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(Object.keys(headerFromEnv).length ? { headerFromEnv } : {}),
    ...(form.bearerTokenEnvVar.trim() ? { bearerTokenEnvVar: form.bearerTokenEnvVar.trim() } : {}),
  }
}

export function parseMcpTransportJson(text: string): DesktopMcpServerConfig {
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('高级 JSON 必须是 object。')
  }
  return validateTransport(parsed as Record<string, unknown>)
}

export function parseMcpServerJson(text: string): ParsedMcpServerJson {
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('高级 JSON 必须是 object。')
  }
  const value = parsed as Record<string, unknown>
  rejectUnknownFields(value, [
    'name',
    'scope',
    'enabled',
    'diagnosticContext',
    'transport',
    'startupTimeoutMs',
    'toolTimeoutMs',
    'required',
    'enabledTools',
    'disabledTools',
    'defaultToolsApprovalMode',
    'tools',
  ])
  if (
    typeof value.name !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.name.trim())
  ) {
    throw new Error('名称必须为 1-64 位字母、数字、点、下划线或连字符。')
  }
  if (value.scope !== 'user' && value.scope !== 'local') {
    throw new Error('scope 只支持 user 或 local。')
  }
  if (typeof value.enabled !== 'boolean') {
    throw new Error('enabled 必须是 boolean。')
  }
  if (value.diagnosticContext !== undefined && typeof value.diagnosticContext !== 'boolean') {
    throw new Error('diagnosticContext 必须是 boolean。')
  }
  if (!value.transport || typeof value.transport !== 'object' || Array.isArray(value.transport)) {
    throw new Error('transport 必须是 object。')
  }
  const transport = validateTransport(value.transport as Record<string, unknown>)
  const diagnosticContext = value.diagnosticContext === true
  if (diagnosticContext && transport.type !== 'stdio') {
    throw new Error('会话诊断上下文只支持 stdio transport。')
  }
  const startupTimeoutMs = validateJsonTimeout(value.startupTimeoutMs, '启动超时')
  const toolTimeoutMs = validateJsonTimeout(value.toolTimeoutMs, '工具超时')
  if (value.required !== undefined && typeof value.required !== 'boolean') {
    throw new Error('required 必须是 boolean。')
  }
  const enabledTools = validateOptionalStringArray(value.enabledTools, 'enabledTools')
  const disabledTools = validateOptionalStringArray(value.disabledTools, 'disabledTools')
  const defaultToolsApprovalMode = validateApprovalMode(
    value.defaultToolsApprovalMode,
    'defaultToolsApprovalMode',
  )
  const tools = validateToolPolicies(value.tools)
  return {
    name: value.name.trim(),
    scope: value.scope,
    enabled: value.enabled,
    diagnosticContext,
    transport,
    ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
    ...(toolTimeoutMs ? { toolTimeoutMs } : {}),
    ...(value.required === true ? { required: true } : {}),
    ...(enabledTools !== undefined ? { enabledTools } : {}),
    ...(disabledTools?.length ? { disabledTools } : {}),
    ...(defaultToolsApprovalMode ? { defaultToolsApprovalMode } : {}),
    ...(tools && Object.keys(tools).length ? { tools } : {}),
  }
}

function validateTransport(
  value: Record<string, unknown> | DesktopMcpServerConfig,
): DesktopMcpServerConfig {
  if (value.type === 'stdio') {
    rejectUnknownFields(value, ['type', 'command', 'args', 'cwd', 'env', 'envFromHost'])
    if (typeof value.command !== 'string' || !value.command.trim()) {
      throw new Error('stdio command 必须是非空字符串。')
    }
    const args = value.args
    if (
      args !== undefined &&
      (!Array.isArray(args) || args.some((argument) => typeof argument !== 'string'))
    )
      throw new Error('stdio args 必须是字符串数组。')
    const cwd = value.cwd
    if (cwd !== undefined && typeof cwd !== 'string') {
      throw new Error('stdio cwd 必须是字符串。')
    }
    if (typeof cwd === 'string' && cwd && !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(cwd))
      throw new Error('stdio cwd 必须是绝对路径。')
    const env = validateStringMap(value.env, '静态环境变量')
    for (const name of Object.keys(env ?? {})) {
      if (!ENV_NAME.test(name)) throw new Error(`${name} 不是有效的环境变量名。`)
      if (SENSITIVE_NAME.test(name)) {
        throw new Error(`${name} 看起来包含凭据，请改用宿主环境变量映射。`)
      }
    }
    const envFromHost = validateStringMap(value.envFromHost, '宿主环境变量映射')
    for (const source of Object.values(envFromHost ?? {})) {
      if (!ENV_NAME.test(source)) throw new Error(`${source} 不是有效的宿主环境变量名。`)
    }
    return {
      type: 'stdio',
      command: value.command.trim(),
      ...(Array.isArray(args) && args.length ? { args: [...args] as string[] } : {}),
      ...(typeof cwd === 'string' && cwd.trim() ? { cwd: cwd.trim() } : {}),
      ...(env && Object.keys(env).length ? { env } : {}),
      ...(envFromHost && Object.keys(envFromHost).length ? { envFromHost } : {}),
    }
  }
  if (value.type === 'http') {
    rejectUnknownFields(value, [
      'type',
      'url',
      'auth',
      'scopes',
      'oauthResource',
      'headers',
      'headerFromEnv',
      'bearerTokenEnvVar',
    ])
    if (typeof value.url !== 'string' || !value.url.trim()) {
      throw new Error('HTTP url 必须是非空字符串。')
    }
    let parsedUrl: URL
    try {
      parsedUrl = new URL(value.url)
    } catch {
      throw new Error('HTTP url 无效。')
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('HTTP url 只支持 http 或 https。')
    }
    const headers = validateStringMap(value.headers, '静态 Header')
    if (value.auth !== undefined && value.auth !== 'none' && value.auth !== 'oauth') {
      throw new Error('HTTP auth 只支持 none 或 oauth。')
    }
    const auth = value.auth ?? 'oauth'
    validateHttpUrl(value.url.trim())
    const scopes = validateOptionalStringArray(value.scopes, 'HTTP scopes')
    validateOAuthScopes(scopes ?? [])
    if (
      value.oauthResource !== undefined &&
      (typeof value.oauthResource !== 'string' || !value.oauthResource.trim())
    ) {
      throw new Error('HTTP oauthResource 必须是非空字符串。')
    }
    if (auth !== 'oauth' && ((scopes?.length ?? 0) > 0 || value.oauthResource !== undefined)) {
      throw new Error('HTTP scopes 和 oauthResource 仅能用于 OAuth。')
    }
    if (typeof value.oauthResource === 'string') {
      validateAbsoluteUri(value.oauthResource.trim(), 'HTTP oauthResource')
    }
    for (const name of Object.keys(headers ?? {})) {
      if (STATIC_SECRET_HEADERS.has(name.toLowerCase())) {
        throw new Error(`${name} 必须通过环境变量引用。`)
      }
    }
    const headerFromEnv = validateStringMap(value.headerFromEnv, 'Header 环境变量映射')
    for (const source of Object.values(headerFromEnv ?? {})) {
      if (!ENV_NAME.test(source)) throw new Error(`${source} 不是有效的宿主环境变量名。`)
    }
    const bearerTokenEnvVar = value.bearerTokenEnvVar
    if (
      bearerTokenEnvVar !== undefined &&
      (typeof bearerTokenEnvVar !== 'string' || !ENV_NAME.test(bearerTokenEnvVar))
    )
      throw new Error('Bearer token 环境变量名无效。')
    return {
      type: 'http',
      url: value.url.trim(),
      ...(auth === 'oauth' ? { auth: 'oauth' as const } : {}),
      ...(scopes?.length ? { scopes } : {}),
      ...(typeof value.oauthResource === 'string'
        ? { oauthResource: value.oauthResource.trim() }
        : {}),
      ...(headers && Object.keys(headers).length ? { headers } : {}),
      ...(headerFromEnv && Object.keys(headerFromEnv).length ? { headerFromEnv } : {}),
      ...(typeof bearerTokenEnvVar === 'string' && bearerTokenEnvVar ? { bearerTokenEnvVar } : {}),
    }
  }
  throw new Error('高级 JSON 只支持 stdio 或 http transport。')
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key))
  if (unknown) throw new Error(`未知字段：${unknown}`)
}

function validateStringMap(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是字符串 map。`)
  }
  if (Object.entries(value).some(([key, item]) => !key.trim() || typeof item !== 'string'))
    throw new Error(`${label} 的键和值都必须是字符串。`)
  return { ...value } as Record<string, string>
}

function validateOptionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${label} 必须是非空字符串数组。`)
  }
  const normalized = value.map((item) => String(item).trim())
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} 不能包含重复项。`)
  }
  return normalized
}

function validateApprovalMode(
  value: unknown,
  label: string,
): DesktopMcpToolApprovalMode | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !isApprovalMode(value)) {
    throw new Error(`${label} 不是有效的工具审批模式。`)
  }
  return value
}

function validateToolPolicies(
  value: unknown,
): Record<string, { approvalMode: DesktopMcpToolApprovalMode }> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('tools 必须是 object。')
  }
  const result: Record<string, { approvalMode: DesktopMcpToolApprovalMode }> = {}
  for (const [name, policy] of Object.entries(value)) {
    if (!name.trim() || !policy || typeof policy !== 'object' || Array.isArray(policy)) {
      throw new Error('tools 的名称和策略必须有效。')
    }
    const record = policy as Record<string, unknown>
    rejectUnknownFields(record, ['approvalMode'])
    const approvalMode = validateApprovalMode(record.approvalMode, `${name}.approvalMode`)
    if (!approvalMode) throw new Error(`${name}.approvalMode 为必填项。`)
    result[name] = { approvalMode }
  }
  return result
}

function templateConfig(type: TransportType): DesktopMcpServerConfig {
  return type === 'http'
    ? { type: 'http', url: 'https://example.com/mcp' }
    : { type: 'stdio', command: 'bun', args: ['server.ts'] }
}

function createValueRow(value = ''): EditableValueRow {
  return { id: crypto.randomUUID(), value }
}

function valueRows(values?: readonly string[]): EditableValueRow[] {
  return values?.length ? values.map(createValueRow) : [createValueRow()]
}

function valuesFromRows(rows: EditableValueRow[]): string[] {
  return rows.map((row) => row.value).filter((value) => value.length > 0)
}

function uniqueNamesFromRows(rows: EditableValueRow[], label: string): string[] {
  const values = rows.map((row) => row.value.trim()).filter(Boolean)
  if (new Set(values).size !== values.length) {
    throw new Error(`${label}不能包含重复项。`)
  }
  return values
}

function validateHttpUrl(value: string): void {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('MCP URL 必须是有效绝对 URL。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('MCP URL 只支持 http 或 https。')
  }
}

function validateAbsoluteUri(value: string, label: string): void {
  try {
    const url = new URL(value)
    if (!url.protocol) throw new Error('missing protocol')
  } catch {
    throw new Error(`${label} 必须是有效绝对 URI。`)
  }
}

function validateOAuthScopes(scopes: readonly string[]): void {
  if (scopes.length > 32 || scopes.some((scope) => scope.length > 256)) {
    throw new Error('OAuth scopes 最多 32 项且每项不能超过 256 字符。')
  }
}

function removeValueRow(rows: EditableValueRow[], id: string): EditableValueRow[] {
  const next = rows.filter((row) => row.id !== id)
  return next.length ? next : [createValueRow()]
}

function createMapRow(key = '', value = ''): EditableMapRow {
  return { id: crypto.randomUUID(), key, value }
}

function mapRows(value?: Record<string, string>): EditableMapRow[] {
  const rows = Object.entries(value ?? {}).map(([key, item]) => createMapRow(key, item))
  return rows.length ? rows : [createMapRow()]
}

function toolPolicyRows(
  value?: Record<string, { approvalMode: DesktopMcpToolApprovalMode }>,
): EditableMapRow[] {
  const rows = Object.entries(value ?? {}).map(([key, policy]) =>
    createMapRow(key, policy.approvalMode),
  )
  return rows.length ? rows : [createMapRow('', 'auto')]
}

function updateMapRow(
  rows: EditableMapRow[],
  id: string,
  patch: Partial<Pick<EditableMapRow, 'key' | 'value'>>,
): EditableMapRow[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row))
}

function removeMapRow(rows: EditableMapRow[], id: string): EditableMapRow[] {
  const next = rows.filter((row) => row.id !== id)
  return next.length ? next : [createMapRow()]
}

function mapFromRows(rows: EditableMapRow[], label: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key && !row.value) continue
    if (!key || !row.value) {
      throw new Error(`${label} 的键和值必须同时填写。`)
    }
    if (Object.hasOwn(result, key)) {
      throw new Error(`${label} 包含重复键：${key}`)
    }
    result[key] = row.value
  }
  return result
}

function isApprovalMode(value: string): value is DesktopMcpToolApprovalMode {
  return APPROVAL_MODE_OPTIONS.some((option) => option.value === value)
}

function toolPoliciesFromRows(
  rows: EditableMapRow[],
): Record<string, { approvalMode: DesktopMcpToolApprovalMode }> {
  const result: Record<string, { approvalMode: DesktopMcpToolApprovalMode }> = {}
  for (const row of rows) {
    const name = row.key.trim()
    if (!name) continue
    if (Object.hasOwn(result, name)) {
      throw new Error(`单个工具审批覆盖包含重复工具：${name}`)
    }
    const approvalMode = row.value || 'auto'
    if (!isApprovalMode(approvalMode)) {
      throw new Error(`${name} 的工具审批模式无效。`)
    }
    result[name] = { approvalMode }
  }
  return result
}

function optionalTimeout(value: string, label: string): number | undefined | Error {
  if (!value.trim()) return undefined
  const number = Number(value)
  if (!Number.isInteger(number) || number < 100 || number > 600_000) {
    return new Error(`${label}必须是 100-600000ms 之间的整数。`)
  }
  return number
}

function validateJsonTimeout(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 100 || Number(value) > 600_000) {
    throw new Error(`${label}必须是 100-600000ms 之间的整数。`)
  }
  return Number(value)
}

function formatConfig(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

const errorMessageOf = (error: unknown): string => rawErrorMessage(error) || String(error)
