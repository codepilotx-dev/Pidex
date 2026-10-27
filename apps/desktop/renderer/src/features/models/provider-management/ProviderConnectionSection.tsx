import { createPortal } from 'react-dom'
import {
  ChevronRight,
  Copy,
  ExternalLink,
  KeyRound,
  MoreHorizontal,
  Plus,
  Activity,
} from 'lucide-react'
import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { UsageSourceDescriptor } from '@pidex/agent-protocol'
import type {
  DesktopApiKeyHealthStatus,
  DesktopApiKeySummary,
  DesktopModelProviderSummary,
  DesktopProviderDefinition,
} from '../../../../shared/Types.js'
import { Button } from '../../../components/ui/Button.js'
import { Input } from '../../../components/ui/Input.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import { useDesktopLayoutOutletContext } from '../../layout/shell/DesktopLayoutOutletContext.js'
import { ApiKeyEditorForm, ApiKeyQuickAdd, type ApiKeyEditorValue } from '../ApiKeyEditorDialog.js'
import { ProviderRequestSettingsForm } from './ProviderRequestSettingsForm.js'
import { ProviderWebsiteIconSettings } from './ProviderWebsiteIconSettings.js'
import { ProviderEditorNavigationGuard } from './ProviderEditorNavigationGuard.js'
import { Dropdown } from '../../../components/ui/Dropdown.js'
import { PopoverItem } from '../../../components/ui/PopoverItem.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { fullErrorMessage } from '../../../utils/Errors.js'
import {
  allBalances,
  formatRefreshedAt,
  usageStatusLabel,
  type ProviderUsageSource,
} from '../../../utils/UsageFormatters.js'
import { ProviderBalanceCards } from '../../settings/usage/ProviderBalanceCards.js'
import {
  providerManagementStore,
  providerUsagePartitionKey,
  useProviderManagementStore,
  type ConfiguredProviderGroup,
  type ProviderConnection,
} from '../../provider-management/index.js'
import { BillingCredentialConnection } from './BillingCredentialConnection.js'
import { OAuthConnection } from './OAuthConnection.js'
import { providerDetailStatus } from '../ModelCenterState.js'

export type ProviderConnectionSectionProps = {
  provider: DesktopModelProviderSummary
  group: ConfiguredProviderGroup | undefined
  apiKeys: readonly DesktopApiKeySummary[]
  busy: boolean
  onSubmitKey: (value: ApiKeyEditorValue, key: DesktopApiKeySummary | null) => Promise<boolean>
  onDeleteProvider?: () => Promise<void>
  onTestConnection?: () => Promise<void>
  onDeleteKey: (key: DesktopApiKeySummary) => void
  onCopyKey: (key: DesktopApiKeySummary) => Promise<void>
  onMoveKey: (key: DesktopApiKeySummary, offset: -1 | 1) => Promise<void>
  onTestKey: (key: DesktopApiKeySummary) => Promise<void>
  onSetActiveKey: (key: DesktopApiKeySummary) => Promise<void>
  onToggleKeyEnabled: (key: DesktopApiKeySummary) => Promise<void>
  onRefresh: () => Promise<void>
  onSaveDefinition: (definition: DesktopProviderDefinition) => Promise<void>
  onDraftChange?: (dirty: boolean) => void
  onNotice: (message: string) => void
  onError: (message: string) => void
}

const HEALTH_LABELS: Record<DesktopApiKeyHealthStatus, string> = {
  untested: '未测试',
  healthy: '健康',
  'auth-failed': '鉴权失败',
  'rate-limited': '限流冷却',
  error: '异常',
}

/**
 * 环境变量推理凭据：只取 credential 来源（当前 Provider 的实际推理 Key）。
 * 用量来源派生的环境连接留在用量区，避免同一环境变量在两处重复展示。
 */
export function envInferenceConnections(
  connections: readonly ProviderConnection[],
): ProviderConnection[] {
  return connections.filter(
    (connection) => connection.kind === 'env' && connection.origin === 'credential',
  )
}

function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
}

export type ProviderCredentialUsageCardProps = {
  descriptor: UsageSourceDescriptor
  result: ProviderUsageSource | undefined
  loading: boolean
  /** 由调用方按用量连接解析的 API Key 名称，替代原「复用供应商 API Key」文案。 */
  credentialName?: string | undefined
}

/**
 * 用量来源名称：用量连接指向的凭据 ID 优先按已保存的 API Key 名称显示，
 * 拿不到名称时退回脱敏值；未连接时不显示占位文案。
 */
export function usageCredentialName(
  descriptor: UsageSourceDescriptor,
  result: ProviderUsageSource | undefined,
  apiKeys: readonly DesktopApiKeySummary[],
): string | undefined {
  const connection = result?.connection ?? descriptor.connection
  if (connection.kind === 'none') return undefined
  const matched = connection.credentialId
    ? apiKeys.find((key) => key.id === String(connection.credentialId))
    : undefined
  return matched?.label ?? connection.maskedValue ?? undefined
}

/** 余额未知或查询失败时保留状态，不显示为零。 */
export function ProviderCredentialUsageCard({
  descriptor,
  result,
  loading,
  credentialName,
}: ProviderCredentialUsageCardProps): React.ReactNode {
  const status =
    result?.status ??
    (loading ? null : descriptor.connection.kind === 'none' ? 'not-connected' : 'unavailable')
  const balances = allBalances(result)
  return (
    <div
      className="provider-usage-source tw:grid tw:min-w-0 tw:gap-3"
      data-status={status ?? undefined}
    >
      {result?.error ? (
        <div className="usage-source-error" role="status">
          <strong>{result.error.message}</strong>
          <span>{result.error.retryable ? '可以稍后重试。' : '查询暂时失败。'}</span>
        </div>
      ) : null}
      {balances.length > 0 ? (
        <ProviderBalanceCards balances={balances} compact accountName={credentialName} />
      ) : (
        <p className="usage-chart-empty">
          {loading
            ? '正在查询余额。'
            : status === 'not-connected'
              ? '尚未连接可查询的凭据。'
              : '暂无可展示的余额。'}
        </p>
      )}
    </div>
  )
}

export function ProviderConnectionSection({
  provider,
  group,
  apiKeys,
  busy,
  onSubmitKey,
  onDeleteProvider,
  onDeleteKey,
  onCopyKey,
  onMoveKey,
  onTestKey,
  onSetActiveKey,
  onToggleKeyEnabled,
  onRefresh,
  onSaveDefinition,
  onDraftChange,
  onNotice,
  onError,
}: ProviderConnectionSectionProps): React.ReactNode {
  const supportsInferenceKeys =
    provider.authMethods?.includes('api-key') ?? provider.kind !== 'github-copilot'

  const isCustom = provider.providerKind === 'custom'
  const customConfig = isCustom && provider.config?.kind === 'custom' ? provider.config : null

  const oauthAvailable = provider.authMethods?.includes('oauth') ?? group?.oauthAvailable ?? false
  const timeZone = useMemo(localTimeZone, [])
  const currentProviderState = useProviderManagementStore(
    (state) => state.configuration.currentProviderState,
  )
  const usagePartition = useProviderManagementStore(
    (state) => state.usageQueries[providerUsagePartitionKey('today', timeZone)],
  )
  const usageResults = usagePartition?.results
  const refreshingSourceIds = usagePartition?.refreshingSourceIds ?? []
  const activeConnection = group?.connections.find(
    (connection) =>
      connection.origin === 'credential' &&
      connection.active &&
      connection.enabled !== false &&
      ['inference-key', 'oauth', 'env'].includes(connection.kind),
  )
  const activeKey = apiKeys.find((key) => key.id === activeConnection?.credentialId)
  const configured =
    providerDetailStatus(
      provider,
      currentProviderState?.selectedProviderID === provider.providerID
        ? currentProviderState
        : null,
      group,
    ).label === '已配置'
  const panel = useDesktopLayoutOutletContext()?.providerManagement
  const section = panel?.tab?.providerId === provider.providerID ? panel.tab.section : null
  const scrollRef = useRef<HTMLDivElement>(null)
  const credentialsRef = useRef<HTMLElement>(null)
  const requestRef = useRef<HTMLElement>(null)
  const [requestFooterHost, setRequestFooterHost] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!section || !panel?.host) return
    const frame = requestAnimationFrame(() => {
      const viewport = scrollRef.current
      const target = (section === 'request' ? requestRef : credentialsRef).current
      if (!viewport || !target) return
      viewport.scrollTo({
        top: viewport.scrollTop + target.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [section, panel?.host])
  const [keyEditor, setKeyEditor] = useState<DesktopApiKeySummary | 'new' | null>(null)
  const [keyDirty, setKeyDirty] = useState(false)
  const [requestDirty, setRequestDirty] = useState(false)
  const [requestBusy, setRequestBusy] = useState(false)
  const [guardRequested, setGuardRequested] = useState(false)
  const keySave = useRef<(() => Promise<boolean>) | null>(null)
  const requestSave = useRef<(() => Promise<boolean>) | null>(null)
  const requestReset = useRef<(() => void) | null>(null)
  const requestLeave = useRef<(() => Promise<boolean>) | null>(null)
  const allowNavigation = useRef(false)
  const dirty = keyDirty || requestDirty
  useEffect(() => {
    onDraftChange?.(dirty)
    return () => onDraftChange?.(false)
  }, [dirty, onDraftChange])
  useEffect(() => {
    if (!panel) return
    const beforeChange = async () => {
      setGuardRequested(true)
      try {
        return await (requestLeave.current?.() ?? Promise.resolve(true))
      } finally {
        setGuardRequested(false)
      }
    }
    panel.beforeChange.current = beforeChange
    return () => {
      if (panel.beforeChange.current === beforeChange) panel.beforeChange.current = null
    }
  }, [panel?.beforeChange])
  async function changeKeyEditor(next: DesktopApiKeySummary | 'new' | null) {
    if (await (panel?.beforeChange.current?.() ?? Promise.resolve(true))) setKeyEditor(next)
  }


  const usageResultById = useMemo(
    () => new Map(Object.entries(usageResults ?? {})),
    [usageResults],
  )
  // 只查询当前供应商已连接且可查询的来源；不带 force 走共享缓存。
  const connectedQueryableSourceIds = useMemo(
    () =>
      (group?.usageSources ?? [])
        .filter(
          (source) => source.connection.kind !== 'none' && source.availability === 'queryable',
        )
        .map((source) => source.sourceId),
    [group],
  )
  const usageCheckedAt = Math.max(
    0,
    ...(group?.usageSources ?? []).map(
      (source) => usageResultById.get(source.sourceId)?.checkedAt ?? 0,
    ),
  )
  const connectedQueryableSourceIdsRef = useRef<string[]>([])
  connectedQueryableSourceIdsRef.current = connectedQueryableSourceIds
  const connectedQueryableSourceIdsKey = JSON.stringify(connectedQueryableSourceIds)
  useEffect(() => {
    const sourceIds = connectedQueryableSourceIdsRef.current
    if (!section || sourceIds.length === 0) return
    const refresh = (poll = false) => {
      if (document.visibilityState === 'hidden') return
      const selected = poll ? sourceIds.filter((id) =>
        group?.usageSources.some((source) => source.sourceId === id && source.queryPolicy === 'cached'),
      ) : sourceIds
      if (selected.length === 0) return
      void providerManagementStore
        .querySources({ range: 'today', timeZone, sourceIds: selected })
        .catch(() => undefined)
    }
    refresh()
    const timer = window.setInterval(() => refresh(true), 60_000)
    return () => window.clearInterval(timer)
  }, [connectedQueryableSourceIdsKey, timeZone, section])

  if (provider.availability?.status === 'unavailable') {
    return (
      <div className="model-center-connection-section tw:grid tw:gap-4">
        <section className="tw:grid tw:gap-3">
          <header className="model-center-detail-card-header tw:flex tw:items-center tw:justify-between tw:gap-3">
            <div>
              <h3 className="tw:m-0 tw:text-app-text tw:type-title-sm">此 Provider 暂不可用</h3>
              <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:type-body-sm">
                当前协议或 Endpoint 尚未适配，不能新增凭据或测试连接。
              </p>
            </div>
          </header>
        </section>
        {panel?.host && section
          ? createPortal(
              <p className="tw:p-4 tw:text-app-text-soft tw:type-body-sm">
                当前提供商暂不可用，无法管理连接或请求配置。
              </p>,
              panel.host,
            )
          : null}
      </div>
    )
  }

  const oauthCredentials = (group?.connections ?? []).filter(
    (connection) => connection.kind === 'oauth' && connection.origin === 'credential',
  )
  const envInference = envInferenceConnections(group?.connections ?? [])

  /** 刷新当前供应商已连接且可查询的全部来源；不带 sourceIds 时无操作。 */
  function refreshUsageSources(): void {
    if (connectedQueryableSourceIds.length === 0) return
    void providerManagementStore
      .querySources({
        range: 'today',
        timeZone,
        sourceIds: connectedQueryableSourceIds,
        force: true,
      })
      .catch((error) => onError(fullErrorMessage(error)))
  }

  const refreshingUsage = connectedQueryableSourceIds.some((sourceId) =>
    refreshingSourceIds.includes(sourceId),
  )

  const oauthActive = activeConnection?.kind === 'oauth'
  const envActive = activeConnection?.kind === 'env'
  return (
    <div className="model-center-connection-section tw:grid tw:gap-6">
      <div className="tw:grid tw:min-w-0 tw:grid-cols-1 tw:gap-6 tw:@min-[640px]:grid-cols-2">
      <section aria-label="连接摘要" className="tw:grid tw:min-w-0 tw:gap-3">
        <h3 className="tw:m-0 tw:text-app-text tw:type-title-sm">
          {oauthActive
            ? '账号授权'
            : envActive
              ? '环境凭据'
              : supportsInferenceKeys
                ? 'API 密钥'
                : '认证'}
        </h3>
        <div className="tw:flex tw:items-center tw:gap-2">
          {oauthActive || envActive || !supportsInferenceKeys ? (
            <span className="tw:flex tw:min-h-9 tw:flex-1 tw:items-center tw:gap-2 tw:type-body-sm">
              {activeConnection?.label ??
                (configured ? '已配置' : oauthAvailable ? '请登录账号' : '无需认证')}
              <span className="tw:text-app-text-meta tw:type-caption">
                {oauthActive ? '已授权' : envActive ? '只读来源' : ''}
              </span>
            </span>
          ) : (
            <ApiKeyQuickAdd
              maskedValue={activeKey?.maskedValue}
              busy={busy}
              onAdd={(key) => onSubmitKey({
                providerId: provider.providerID,
                label: `API Key ${apiKeys.length + 1}`,
                key,
              }, null)}
            />
          )}

        </div>
      </section>
      <section className="tw:grid tw:min-w-0 tw:gap-3">
        <h3 className="tw:m-0 tw:text-app-text tw:type-title-sm">API 地址</h3>
        <div className="tw:flex tw:items-center tw:gap-2">
          <Input
            aria-label="API 地址"
            readOnly
            value={provider.config?.baseUrl ?? provider.baseURL ?? ''}
            placeholder="供应商默认地址"
            className="tw:min-w-0 tw:flex-1 tw:type-code"
          />

        </div>
      </section>
      </div>
      {(dirty || busy || requestBusy || guardRequested) && section ? (
        <ProviderEditorNavigationGuard
          dirty={dirty}
          busy={busy || requestBusy}
          allowNavigation={allowNavigation}
          requestLeaveRef={requestLeave}
          onSave={async () => {
            if (keyDirty && !(await keySave.current?.())) return false
            if (requestDirty && !(await requestSave.current?.())) return false
            return true
          }}
          onDiscard={() => {
            setKeyEditor(null)
            requestReset.current?.()
            setKeyDirty(false)
            setRequestDirty(false)
          }}
        />
      ) : null}
      {panel?.host && section
        ? createPortal(
            <div className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col">
            <div ref={scrollRef} className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:gap-6 tw:overflow-y-auto tw:p-4 tw:[&_.model-center-oauth-flow]:p-0">
              <section className="tw:grid tw:gap-4" aria-label="供应商图标">
                <h3 className="tw:m-0 tw:type-title-sm">供应商图标</h3>
                <ProviderWebsiteIconSettings key={provider.providerID} providerID={provider.providerID} logoURL={provider.logoURL} address={provider.config?.baseUrl ?? provider.baseURL ?? ''} onNotice={onNotice} onError={onError} />
              </section>
              <section ref={credentialsRef} className="tw:grid tw:gap-4 tw:border-t tw:border-app-border-subtle tw:pt-6" aria-label="认证与密钥">
                <h3 className="tw:m-0 tw:type-title-sm">认证与密钥</h3>
                {keyEditor ? (
                  <section className="tw:grid tw:gap-3">
                    <h4 className="tw:m-0 tw:type-title-sm">
                      {keyEditor === 'new' ? '新增 API Key' : '编辑 API Key'}
                    </h4>
                    <ApiKeyEditorForm
                      embedded
                      hideProvider
                      apiKey={keyEditor === 'new' ? null : keyEditor}
                      initialProviderId={provider.providerID}
                      providers={[provider]}
                      busy={busy}
                      onDraftChange={setKeyDirty}
                      saveRef={keySave}
                      onCancel={() => void changeKeyEditor(null)}
                      onSubmit={async (value) => {
                        const saved = await onSubmitKey(
                          value,
                          keyEditor === 'new' ? null : keyEditor,
                        )
                        if (saved) setKeyEditor(null)
                        return saved
                      }}
                    />
                  </section>
                ) : null}
                {/* 2. API Keys Management */}
                {supportsInferenceKeys ? (
                  <section className="tw:grid tw:gap-3">
                    <header className="model-center-detail-card-header tw:flex tw:items-center tw:justify-between tw:gap-3">
                      <div>
                        <h4 className="tw:m-0 tw:type-row-title">API Key</h4>
                        <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:type-body-sm">
                          优先使用排在首位的活动密钥。
                        </p>
                      </div>
                      <Button
                        color="secondary"
                        size="sm"
                        shape="default"
                        disabled={busy || keyEditor !== null}
                        onClick={() => setKeyEditor('new')}
                      >
                        <Plus aria-hidden size={APP_ICON_SIZES.sm} />
                        新增 API Key
                      </Button>{' '}
                    </header>

                    <div className="model-center-detail-card-body tw:min-w-0">
                      {apiKeys.length > 0 || envInference.length > 0 ? (
                        <div className="model-center-key-list tw:grid tw:gap-2">
                          {apiKeys.map((key, index) => (
                            <ApiKeyRowItem
                              busy={busy}
                              index={index}
                              key={key.id}
                              keyItem={key}
                              last={index === apiKeys.length - 1}
                              onCopy={() => void onCopyKey(key)}
                              onDelete={() => onDeleteKey(key)}
                              onEdit={() => void changeKeyEditor(key)}
                              onMove={(offset) => void onMoveKey(key, offset)}
                              onSetActive={() => void onSetActiveKey(key)}
                              onTest={() => void onTestKey(key)}
                              onToggleEnabled={() => void onToggleKeyEnabled(key)}
                            />
                          ))}
                          {envInference.map((connection) => (
                            <article
                              key={connection.id}
                              className="model-center-key-row tw:flex tw:min-w-0 tw:items-center tw:gap-2 tw:py-2 tw:[&+&]:border-t tw:[&+&]:border-app-border-subtle"
                            >
                              <KeyRound aria-hidden size="var(--inline-icon-size, 1em)" />
                              <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:type-body-sm">
                                {connection.label}
                              </span>
                              <span
                                className="tw:text-app-text-meta tw:type-caption"
                                title="由运行环境提供，不支持编辑、删除或复制。"
                              >
                                环境变量 · 只读
                              </span>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <div className="model-center-section-empty-hint tw:flex tw:items-center tw:gap-2 tw:py-2 tw:text-app-text-soft tw:type-body-sm tw:[&_svg]:shrink-0 tw:[&_svg]:text-app-text-meta">
                          <KeyRound aria-hidden size="var(--inline-icon-size, 1em)" />
                          <span>尚未保存此供应商的 API Key，点击「新增 API Key」进行配置。</span>
                        </div>
                      )}
                    </div>
                  </section>
                ) : null}

                {/* 3. OAuth Connections */}
                {oauthAvailable ? (
                  <section className="tw:grid tw:gap-3">
                    <header className="model-center-detail-card-header tw:flex tw:items-center tw:justify-between tw:gap-3">
                      <div>
                        <h3 className="tw:m-0 tw:text-app-text tw:type-title-sm">OAuth 授权连接</h3>
                        <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:type-body-sm">
                          通过官方账号登录，连接此供应商。
                        </p>
                      </div>
                    </header>
                    <div className="model-center-detail-card-body tw:min-w-0">
                      <OAuthConnection
                        hideHeader
                        connected={oauthCredentials.length > 0}
                        description="在浏览器完成授权，连接此供应商。"
                        target={
                          {
                            kind: 'provider',
                            providerId: provider.providerID,
                          } as never
                        }
                        title={
                          provider.providerID === 'openai'
                            ? '使用 ChatGPT 登录'
                            : `${provider.displayName} OAuth`
                        }
                        onChanged={onRefresh}
                      />

                      {oauthCredentials.length > 0 ? (
                        <div
                          className="model-center-key-list tw:grid tw:gap-2"
                          style={{ marginTop: 'var(--cpx-sys-space-3)' }}
                        >
                          {oauthCredentials.map((connection) => (
                            <div
                              className="model-center-key-row tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:py-2 tw:transition-[background-color,opacity] tw:duration-state tw:ease-standard tw:hover:bg-app-hover tw:data-[disabled=true]:opacity-62 tw:[&+&]:border-t tw:[&+&]:border-t-app-border-subtle"
                              key={connection.id}
                            >
                              <div className="tw:grid tw:min-w-0 tw:gap-1">
                                <strong className="tw:overflow-hidden tw:text-app-text tw:type-row-title tw:text-ellipsis tw:whitespace-nowrap">
                                  {connection.label}
                                </strong>
                                <span className="tw:overflow-hidden tw:text-app-text-meta tw:type-caption tw:text-ellipsis tw:whitespace-nowrap">
                                  {connection.active ? '当前活动' : '未选择'}
                                </span>
                              </div>
                              <div className="model-center-account-actions tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:min-h-9 tw:self-end tw:[&_svg]:size-icon tw:@max-[720px]:justify-start">
                                {!connection.active && connection.credentialId ? (
                                  <Button
                                    color="primary"
                                    onClick={() => {
                                      void providerManagementStore
                                        .setActiveCredential(
                                          provider.providerID,
                                          connection.credentialId!,
                                        )
                                        .then(() => onNotice('活动凭据已切换为 OAuth。'))
                                        .catch((err) => onError(fullErrorMessage(err)))
                                    }}
                                  >
                                    设为当前活动
                                  </Button>
                                ) : null}
                                {connection.credentialId ? (
                                  <Button
                                    color="danger"
                                    onClick={() => {
                                      void providerManagementStore
                                        .deleteCredential(connection.credentialId!)
                                        .then(() => onNotice('OAuth 凭据已删除。'))
                                        .catch((err) => onError(fullErrorMessage(err)))
                                    }}
                                  >
                                    断开并删除
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : null}
              </section>
              {/* 4. Usage / balance sources */}
              {(group?.usageSources.length ?? 0) > 0 ? (
                <section
                  aria-label="用量与余额"
                  className="tw:grid tw:gap-4 tw:border-t tw:border-app-border-subtle tw:pt-6"
                >
                  <header className="tw:flex tw:items-center tw:justify-between tw:gap-3">
                    <div className="tw:grid tw:min-w-0 tw:gap-1">
                      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
                        <h3 className="tw:m-0 tw:text-app-text tw:type-title-sm">用量与余额</h3>
                        {usageCheckedAt ? (
                          <span className="tw:text-app-text-meta tw:type-caption tw:tabular-nums">
                            {formatRefreshedAt(usageCheckedAt)}
                          </span>
                        ) : null}
                      </div>
                      <p className="tw:m-0 tw:text-app-text-soft tw:type-body-sm">
                        按来源查看账户余额、额度与消耗；不同来源的连接方式不同。
                      </p>
                    </div>
                    {connectedQueryableSourceIds.length > 0 ? (
                      <Button
                        color="secondary"
                        size="sm"
                        loading={refreshingUsage}
                        onClick={refreshUsageSources}
                      >
                        刷新余额
                      </Button>
                    ) : null}
                  </header>
                  <div className="model-center-detail-card-body tw:grid tw:min-w-0 tw:gap-3">
                    {group!.usageSources.map((source) => {
                      const method = source.connectionMethod
                      if (method.kind === 'provider-credential') {
                        const sourceResult = usageResultById.get(source.sourceId)
                        return (
                          <ProviderCredentialUsageCard
                            credentialName={usageCredentialName(source, sourceResult, apiKeys)}
                            descriptor={source}
                            key={source.sourceId}
                            loading={refreshingSourceIds.includes(source.sourceId)}
                            result={sourceResult}
                          />
                        )
                      }
                      if (method.kind === 'billing-key') {
                        return (
                          <BillingCredentialConnection
                            key={source.sourceId}
                            source={{
                              ...source,
                              connectionMethod: method,
                            }}
                            onChanged={onRefresh}
                            onConnect={(input) =>
                              providerManagementStore
                                .connectUsageCredential(input)
                                .then(() => undefined)
                            }
                            onDisconnect={(sourceId) =>
                              providerManagementStore
                                .disconnectUsageCredential({ sourceId })
                                .then(() => undefined)
                            }
                          />
                        )
                      }
                      if (method.kind === 'oauth') {
                        return (
                          <OAuthConnection
                            connected={source.connection.kind !== 'none'}
                            description={
                              source.scope === 'subscription'
                                ? '独立订阅授权仅用于读取套餐额度，不会成为推理凭据。'
                                : '此授权仅用于读取账户用量。'
                            }
                            target={{ kind: 'usage', sourceId: source.sourceId }}
                            key={source.sourceId}
                            title={source.displayName}
                            onChanged={onRefresh}
                          />
                        )
                      }
                      if (method.kind === 'external') {
                        return (
                          <div
                            className="tw:grid tw:min-w-0 tw:gap-3 tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:p-4"
                            key={source.sourceId}
                          >
                            <div className="tw:flex tw:min-w-0 tw:items-start tw:justify-between tw:gap-3">
                              <div>
                                <h4 className="tw:m-0 tw:text-app-text tw:type-row-title">
                                  {source.displayName}
                                </h4>
                                <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:type-body-sm">
                                  在供应商控制台查看用量与余额。
                                </p>
                              </div>
                              <span className="usage-badge">{usageStatusLabel('unsupported')}</span>
                            </div>
                            <div>
                              <Button
                                color="secondary"
                                onClick={() =>
                                  void desktopClient.openExternalURL(method.consoleUrl)
                                }
                              >
                                <ExternalLink aria-hidden size={APP_ICON_SIZE} />
                                打开控制台
                              </Button>
                            </div>
                          </div>
                        )
                      }
                      if (source.availability !== 'queryable') {
                        return (
                          <div
                            className="tw:flex tw:min-w-0 tw:items-start tw:justify-between tw:gap-3 tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:p-4"
                            key={source.sourceId}
                          >
                            <div>
                              <h4 className="tw:m-0 tw:text-app-text tw:type-row-title">
                                {source.displayName}
                              </h4>
                              <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:type-body-sm">
                                当前接入方式不支持查询余额或用量，请到供应商控制台查看。
                              </p>
                            </div>
                            <span className="usage-badge">{usageStatusLabel('unsupported')}</span>
                          </div>
                        )
                      }
                      return null
                    })}
                  </div>
                </section>
              ) : null}
              <section
                ref={requestRef}
                className="tw:grid tw:gap-4 tw:border-t tw:border-app-border-subtle tw:pt-6"
                aria-label="请求配置"
              >
                <ProviderRequestSettingsForm
                    footerHost={requestFooterHost}
                    key={provider.providerID}
                    provider={provider}
                    saveRef={requestSave}
                    resetRef={requestReset}
                    onDraftChange={setRequestDirty}
                    onBusyChange={setRequestBusy}
                    onSaveDefinition={onSaveDefinition}
                    onSaved={onRefresh}
                    onCancel={() => panel.close()}
                    {...(onDeleteProvider ? { onDelete: onDeleteProvider } : {})}
                />
              </section>
            </div>
            <div ref={setRequestFooterHost} className="tw:relative tw:z-10 tw:shrink-0 tw:bg-app-panel" />
            </div>,
            panel.host,
          )
        : null}
    </div>
  )
}
type ApiKeyRowItemProps = {
  busy: boolean
  index: number
  keyItem: DesktopApiKeySummary
  last: boolean
  onCopy: () => void
  onDelete: () => void
  onEdit: () => void
  onMove: (offset: -1 | 1) => void
  onSetActive: () => void
  onTest: () => void
  onToggleEnabled: () => void
}

function ApiKeyRowItem({
  busy,
  index,
  keyItem,
  last,
  onCopy,
  onDelete,
  onEdit,
  onMove,
  onSetActive,
  onTest,
  onToggleEnabled,
}: ApiKeyRowItemProps): React.ReactNode {
  return (
    <article
      className="model-center-key-row tw:grid tw:min-w-0 tw:grid-cols-[minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:rounded-md tw:px-3 tw:py-2 tw:hover:bg-app-hover"
      data-disabled={!keyItem.enabled || undefined}
    >
      <div
        className="tw:grid tw:min-w-0 tw:gap-1"
        title={`${HEALTH_LABELS[keyItem.health.status]} · 最近测试 ${formatTime(keyItem.health.lastTestedAt)}`}
      >
        <div className="tw:flex tw:items-center tw:gap-2">
          <strong className="tw:truncate tw:type-row-title">{keyItem.label}</strong>
          {keyItem.active ? (
            <span className="tw:text-app-accent-fg tw:type-caption">活动</span>
          ) : null}
        </div>
        <code className="tw:truncate tw:text-app-text-soft tw:type-code">
          {keyItem.maskedValue}
        </code>
      </div>
      <div className="tw:flex tw:items-center tw:gap-1">
        <Button
          color="ghostSecondary"
          isIconOnly
          size="toolbar"
          aria-label={`复制 ${keyItem.label}`}
          disabled={busy}
          onClick={onCopy}
        >
          <Copy aria-hidden size={APP_ICON_SIZE} />
        </Button>
        <Button
          color="ghostSecondary"
          isIconOnly
          size="toolbar"
          aria-label={`测试 ${keyItem.label}`}
          disabled={busy}
          onClick={onTest}
        >
          <Activity aria-hidden size={APP_ICON_SIZE} />
        </Button>
        <Dropdown
          size="sm"
          trigger={
            <Button
              color="ghostSecondary"
              isIconOnly
              size="toolbar"
              aria-label={`操作 ${keyItem.label}`}
              disabled={busy}
            >
              <MoreHorizontal aria-hidden size={APP_ICON_SIZE} />
            </Button>
          }
        >
          <PopoverItem onClick={onEdit}>编辑 Key</PopoverItem>
          <PopoverItem disabled={keyItem.active || !keyItem.enabled} onClick={onSetActive}>
            设为当前活动
          </PopoverItem>
          <PopoverItem disabled={index === 0} onClick={() => onMove(-1)}>
            上移
          </PopoverItem>
          <PopoverItem disabled={last} onClick={() => onMove(1)}>
            下移
          </PopoverItem>
          <PopoverItem onClick={onDelete}>删除 Key</PopoverItem>
        </Dropdown>
        <ToggleSwitch
          ariaLabel={`启用 ${keyItem.label}`}
          checked={keyItem.enabled}
          disabled={busy}
          onChange={onToggleEnabled}
        />
      </div>
    </article>
  )
}

function formatTime(value: number | undefined): string {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(value)
}
