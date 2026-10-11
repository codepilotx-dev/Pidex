import {
  ArrowDown,
  ArrowUp,
  Cable,
  CheckCircle2,
  Copy,
  Globe,
  KeyRound,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Server,
} from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import type {
  DesktopApiKeyHealthStatus,
  DesktopApiKeySummary,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
} from '../../../../shared/Types.js'
import { Button } from '../../../components/ui/Button.js'
import { Dropdown } from '../../../components/ui/Dropdown.js'

import { Input } from '../../../components/ui/Input.js'
import { PopoverItem } from '../../../components/ui/PopoverItem.js'
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZES,
} from '../../../components/ui/IconTokens.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { isExecutableDesktopProvider } from '../../../services/desktop-client/ProviderAdapters.js'
import { fullErrorMessage } from '../../../utils/Errors.js'
import {
  providerManagementStore,
  type ConfiguredProviderGroup,
} from '../../provider-management/index.js'
import { BillingCredentialConnection } from './BillingCredentialConnection.js'
import { OAuthConnection } from './OAuthConnection.js'

export type ProviderConnectionSectionProps = {
  provider: DesktopModelProviderSummary
  providerState: DesktopModelProviderState | null
  group: ConfiguredProviderGroup | undefined
  apiKeys: readonly DesktopApiKeySummary[]
  busy: boolean
  onTestConnection?: () => Promise<void>
  onOpenNewKey: () => void
  onEditKey: (key: DesktopApiKeySummary) => void
  onDeleteKey: (key: DesktopApiKeySummary) => void
  onCopyKey: (key: DesktopApiKeySummary) => Promise<void>
  onMoveKey: (key: DesktopApiKeySummary, offset: -1 | 1) => Promise<void>
  onTestKey: (key: DesktopApiKeySummary) => Promise<void>
  onSetActiveKey: (key: DesktopApiKeySummary) => Promise<void>
  onToggleKeyEnabled: (key: DesktopApiKeySummary) => Promise<void>
  onRefresh: () => Promise<void>
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

export function ProviderConnectionSection({
  provider,
  providerState,
  group,
  apiKeys,
  busy,
  onTestConnection,
  onOpenNewKey,
  onEditKey,
  onDeleteKey,
  onCopyKey,
  onMoveKey,
  onTestKey,
  onSetActiveKey,
  onToggleKeyEnabled,
  onRefresh,
  onNotice,
  onError,
}: ProviderConnectionSectionProps): React.ReactNode {
  const supportsInferenceKeys =
    provider.authMethods?.includes('api-key') ?? provider.kind !== 'github-copilot'

  const isCustom = provider.providerKind === 'custom'
  const customConfig = isCustom && provider.config?.kind === 'custom' ? provider.config : null
  const [customBaseUrl, setCustomBaseUrl] = useState(customConfig?.baseUrl ?? '')
  const [savingBaseUrl, setSavingBaseUrl] = useState(false)

  if (provider.availability?.status === 'unavailable') {
    return (
      <div className="model-center-connection-section tw:grid tw:gap-4">
        <section className="model-center-detail-card tw:grid tw:gap-3 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-4">
          <header className="model-center-detail-card-header tw:flex tw:items-center tw:justify-between tw:gap-3">
            <div>
              <h3 className="tw:m-0 tw:text-app-text tw:type-title-sm">此 Provider 暂不可用</h3>
              <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:type-body-sm">
                当前协议或 Endpoint 尚未适配，不能新增凭据或测试连接。
              </p>
            </div>
          </header>
        </section>
      </div>
    )
  }

  const oauthCredentials = (group?.connections ?? []).filter(
    (connection) => connection.kind === 'oauth' && connection.origin === 'credential',
  )
  const envConnections = (group?.connections ?? []).filter(
    (connection) => connection.kind === 'env',
  )

  async function handleSaveCustomBaseUrl(): Promise<void> {
    if (!customConfig) return
    setSavingBaseUrl(true)
    try {
      await desktopClient.updateProvider(provider.providerID, {
        ...customConfig,
        baseUrl: customBaseUrl.trim(),
      })
      onNotice('Endpoint Base URL 已更新。')
      await onRefresh()
    } catch (error) {
      onError(fullErrorMessage(error))
    } finally {
      setSavingBaseUrl(false)
    }
  }

  return (
    <div className="model-center-connection-section tw:grid tw:gap-4">
      {/* 1. Base URL / Custom Endpoint (if custom) */}
      {isCustom && customConfig ? (
        <section className="model-center-detail-card tw:grid tw:gap-3 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-4">
          <header className="model-center-detail-card-header tw:flex tw:items-center tw:justify-between tw:gap-3">
            <div>
              <h3 className="tw:m-0 tw:text-app-text tw:type-title-sm">Endpoint 连接配置</h3>
              <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:type-body-sm">
                自定义或本地服务的 API 地址。
              </p>
            </div>
          </header>
          <div className="model-center-detail-card-body tw:min-w-0">
            <div className="model-center-detail-field-row tw:flex tw:flex-wrap tw:items-end tw:gap-3">
              <label
                className="model-center-detail-field tw:grid tw:min-w-0 tw:gap-2 tw:text-app-text tw:type-body"
                style={{ flex: 1 }}
              >
                <span>Base URL</span>
                <Input
                  className="tw:w-full tw:min-w-0"
                  placeholder="https://api.example.com/v1"
                  value={customBaseUrl}
                  onChange={(e) => setCustomBaseUrl(e.target.value)}
                />
              </label>
              <Button
                color="secondary"
                disabled={savingBaseUrl || customBaseUrl === customConfig.baseUrl}
                onClick={() => void handleSaveCustomBaseUrl()}
              >
                保存地址
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      {/* 2. API Keys Management */}
      {supportsInferenceKeys ? (
        <section className="model-center-detail-card tw:grid tw:gap-3 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-4">
          <header className="model-center-detail-card-header tw:flex tw:items-center tw:justify-between tw:gap-3">
            <div>
              <h3 className="tw:m-0 tw:text-app-text tw:type-title-sm">API 密钥凭据</h3>
              <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:type-body-sm">
                每个供应商支持保存多个 API Key；按优先级优先使用排在首位的活动凭据。
              </p>
            </div>
            <Button color="primary" onClick={onOpenNewKey}>
              <Plus aria-hidden size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
              新增 API Key
            </Button>
          </header>

          <div className="model-center-detail-card-body tw:min-w-0">
            {apiKeys.length > 0 ? (
              <div className="model-center-key-list tw:grid">
                {apiKeys.map((key, index) => (
                  <ApiKeyRowItem
                    busy={busy}
                    index={index}
                    key={key.id}
                    keyItem={key}
                    last={index === apiKeys.length - 1}
                    onCopy={() => void onCopyKey(key)}
                    onDelete={() => onDeleteKey(key)}
                    onEdit={() => onEditKey(key)}
                    onMove={(offset) => void onMoveKey(key, offset)}
                    onSetActive={() => void onSetActiveKey(key)}
                    onTest={() => void onTestKey(key)}
                    onToggleEnabled={() => void onToggleKeyEnabled(key)}
                  />
                ))}
              </div>
            ) : (
              <div className="model-center-section-empty-hint tw:flex tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-dashed tw:border-app-border tw:bg-app-panel tw:p-4 tw:text-app-text-soft tw:type-body-sm tw:[&_svg]:shrink-0 tw:[&_svg]:text-app-text-meta">
                <KeyRound aria-hidden size={APP_ICON_SIZE} />
                <span>尚未保存此供应商的 API Key，点击右上角「新增 API Key」进行配置。</span>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* 3. OAuth Connections */}
      {group?.oauthAvailable ? (
        <section className="model-center-detail-card tw:grid tw:gap-3 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-4">
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
                className="model-center-key-list tw:grid"
                style={{ marginTop: 'var(--cpx-sys-space-3)' }}
              >
                {oauthCredentials.map((connection) => (
                  <div
                    className="model-center-key-row tw:grid tw:min-w-0 tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:px-4 tw:py-3 tw:transition-[background-color,opacity] tw:duration-state tw:ease-standard tw:hover:bg-app-hover tw:data-[disabled=true]:opacity-62 tw:[&+&]:border-t tw:[&+&]:border-t-app-border-subtle tw:@max-[900px]:grid-cols-[auto_minmax(0,1fr)] tw:@max-[720px]:grid-cols-1 tw:@max-[720px]:items-stretch tw:@max-[720px]:p-4"
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
                              .setActiveCredential(provider.providerID, connection.credentialId!)
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

      {/* 4. Billing / Usage Sources */}
      {(group?.usageSources ?? []).length > 0 ? (
        <section className="model-center-detail-card tw:grid tw:gap-3 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-4">
          <header className="model-center-detail-card-header tw:flex tw:items-center tw:justify-between tw:gap-3">
            <div>
              <h3 className="tw:m-0 tw:text-app-text tw:type-title-sm">用量与账单凭据</h3>
              <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:type-body-sm">
                绑定独立用量凭据以查看实时额度与消耗。
              </p>
            </div>
          </header>
          <div className="model-center-detail-card-body tw:min-w-0">
            {group!.usageSources.map((source) => {
              if (source.connectionMethod.kind === 'billing-key') {
                return (
                  <BillingCredentialConnection
                    key={source.sourceId}
                    source={{
                      ...source,
                      connectionMethod: source.connectionMethod,
                    }}
                    onChanged={onRefresh}
                    onConnect={(input) => providerManagementStore.connectUsageCredential(input)}
                    onDisconnect={(sourceId) =>
                      providerManagementStore.disconnectUsageCredential({ sourceId })
                    }
                  />
                )
              }
              if (source.connectionMethod.kind === 'oauth') {
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
              return null
            })}
          </div>
        </section>
      ) : null}

      {/* 5. Environment Connections */}
      {envConnections.length > 0 ? (
        <section className="model-center-detail-card tw:grid tw:gap-3 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-4">
          <header className="model-center-detail-card-header tw:flex tw:items-center tw:justify-between tw:gap-3">
            <div>
              <h3 className="tw:m-0 tw:text-app-text tw:type-title-sm">环境变量</h3>
              <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:type-body-sm">
                系统在运行环境中检测到以下可用凭据：
              </p>
            </div>
          </header>
          <div className="model-center-detail-card-body tw:min-w-0">
            <div className="model-center-account-readonly-list tw:grid tw:gap-2">
              {envConnections.map((connection) => (
                <div
                  className="tw:grid tw:min-h-10 tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-3 tw:py-2"
                  key={connection.id}
                >
                  <Cable
                    className="tw:size-icon tw:text-app-text-soft"
                    size={APP_ICON_SIZE}
                    aria-hidden
                  />
                  <span className="tw:text-app-text tw:[font-size:var(--cpx-sys-font-size-sm)]">
                    {connection.label}
                  </span>
                  <strong className="tw:text-app-success tw:[font-size:var(--cpx-sys-font-size-xs)] tw:type-weight-label">
                    已生效
                  </strong>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
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
      className="model-center-key-row tw:grid tw:min-w-0 tw:grid-cols-[auto_minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:px-4 tw:py-3 tw:transition-[background-color,opacity] tw:duration-state tw:ease-standard tw:hover:bg-app-hover tw:data-[disabled=true]:opacity-62 tw:[&+&]:border-t tw:[&+&]:border-t-app-border-subtle tw:@max-[900px]:grid-cols-[auto_minmax(0,1fr)] tw:@max-[720px]:grid-cols-1 tw:@max-[720px]:items-stretch tw:@max-[720px]:p-4"
      data-disabled={!keyItem.enabled || undefined}
    >
      <div className="model-center-key-order tw:grid tw:gap-1 tw:[&_button]:h-[30px] tw:[&_button]:min-h-[30px] tw:[&_button]:w-[30px] tw:[&_button]:min-w-[30px] tw:[&_svg]:size-icon-sm tw:@max-[720px]:flex">
        <Button
          isIconOnly
          color="ghostSecondary"
          disabled={busy || index <= 0}
          onClick={() => onMove(-1)}
          size="iconMd"
          title={`上移 ${keyItem.label}`}
        >
          <ArrowUp size={APP_ICON_SIZES.sm} aria-hidden />
        </Button>
        <Button
          isIconOnly
          color="ghostSecondary"
          disabled={busy || last}
          onClick={() => onMove(1)}
          size="iconMd"
          title={`下移 ${keyItem.label}`}
        >
          <ArrowDown size={APP_ICON_SIZES.sm} aria-hidden />
        </Button>
      </div>

      <div className="model-center-key-main tw:grid tw:min-w-0 tw:gap-2">
        <div className="model-center-key-title tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2">
          <strong className="tw:min-w-0 tw:overflow-hidden tw:text-app-text tw:text-ellipsis tw:whitespace-nowrap tw:[font-size:var(--cpx-sys-font-size-md)] tw:type-weight-label">
            {keyItem.label}
          </strong>
          <code className="tw:font-mono tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-xs)]">
            {keyItem.maskedValue}
          </code>
          <span
            className="model-center-key-badge tw:inline-flex tw:min-h-[22px] tw:items-center tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-2 tw:py-1 tw:whitespace-nowrap tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-xs)] tw:type-weight-label tw:data-[tone=active]:border-app-accent-border tw:data-[tone=active]:bg-app-accent-subtle tw:data-[tone=active]:text-app-accent-fg tw:data-[tone=healthy]:border-app-success-border tw:data-[tone=healthy]:bg-app-success-subtle tw:data-[tone=healthy]:text-app-success tw:data-[tone=warning]:border-app-danger-border tw:data-[tone=warning]:bg-app-danger-subtle tw:data-[tone=warning]:text-app-danger"
            data-tone={keyItem.active ? 'active' : 'neutral'}
          >
            {keyItem.active ? '当前活动' : `优先级 #${index + 1}`}
          </span>
          {!keyItem.enabled ? (
            <span
              className="model-center-key-badge tw:inline-flex tw:min-h-[22px] tw:items-center tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-2 tw:py-1 tw:whitespace-nowrap tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-xs)] tw:type-weight-label tw:data-[tone=active]:border-app-accent-border tw:data-[tone=active]:bg-app-accent-subtle tw:data-[tone=active]:text-app-accent-fg tw:data-[tone=healthy]:border-app-success-border tw:data-[tone=healthy]:bg-app-success-subtle tw:data-[tone=healthy]:text-app-success tw:data-[tone=warning]:border-app-danger-border tw:data-[tone=warning]:bg-app-danger-subtle tw:data-[tone=warning]:text-app-danger"
              data-tone="warning"
            >
              已停用
            </span>
          ) : null}
          <span
            className="model-center-key-badge tw:inline-flex tw:min-h-[22px] tw:items-center tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-raised tw:px-2 tw:py-1 tw:whitespace-nowrap tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-xs)] tw:type-weight-label tw:data-[tone=active]:border-app-accent-border tw:data-[tone=active]:bg-app-accent-subtle tw:data-[tone=active]:text-app-accent-fg tw:data-[tone=healthy]:border-app-success-border tw:data-[tone=healthy]:bg-app-success-subtle tw:data-[tone=healthy]:text-app-success tw:data-[tone=warning]:border-app-danger-border tw:data-[tone=warning]:bg-app-danger-subtle tw:data-[tone=warning]:text-app-danger"
            data-tone={healthTone(keyItem.health.status)}
          >
            {HEALTH_LABELS[keyItem.health.status]}
          </span>
        </div>
        <div className="model-center-key-meta tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2 tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-xs)] tw:@max-[720px]:grid tw:@max-[720px]:gap-1">
          <span>最近测试：{formatTime(keyItem.health.lastTestedAt)}</span>
        </div>
      </div>

      <div className="model-center-key-actions tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:[&_button>svg]:size-icon-sm tw:@max-[900px]:col-start-2 tw:@max-[900px]:justify-start tw:@max-[720px]:col-auto tw:@max-[720px]:justify-start">
        <Button color="secondary" disabled={busy} onClick={onCopy}>
          <Copy size={APP_ICON_SIZE} aria-hidden />
          复制
        </Button>
        <Button color="secondary" disabled={busy} onClick={onTest} title="测试当前 Key 有效性">
          测试
        </Button>
        <Dropdown
          align="end"
          className="popover-menu--flex"
          trigger={
            <Button
              isIconOnly
              color="ghostSecondary"
              disabled={busy}
              size="iconMd"
              title={`操作 ${keyItem.label}`}
            >
              <MoreHorizontal size={APP_ICON_SIZES.sm} aria-hidden />
            </Button>
          }
          size="sm"
        >
          <PopoverItem disabled={keyItem.active || !keyItem.enabled} onClick={onSetActive}>
            设为当前活动
          </PopoverItem>
          <PopoverItem onClick={onToggleEnabled}>
            {keyItem.enabled ? '停用 Key' : '启用 Key'}
          </PopoverItem>
          <PopoverItem onClick={onEdit}>编辑 / 更换 Key</PopoverItem>
          <PopoverItem onClick={onDelete}>删除 Key</PopoverItem>
        </Dropdown>
      </div>
    </article>
  )
}

function healthTone(status: DesktopApiKeyHealthStatus): 'healthy' | 'neutral' | 'warning' {
  if (status === 'healthy') return 'healthy'
  if (status === 'untested') return 'neutral'
  return 'warning'
}

function formatTime(value: number | undefined): string {
  if (!value) return '暂无'
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value)
}
