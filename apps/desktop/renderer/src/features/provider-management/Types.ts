import type {
  ProviderUsageSource,
  RpcParams,
  RpcResult,
  UsageSourceDescriptor,
} from '@pidex/agent-protocol'
import type {
  DesktopApiKeySummary,
  DesktopProviderCredential,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../../shared/Types.js'

export type ProviderManagementSnapshot = {
  loaded: boolean
  loading: boolean
  refreshingSources: boolean
  refreshingSourceIds: readonly string[]
  error: string | null
  /** 影响门禁可信度的配置读取错误；设置后工作台必须进入恢复态，不能凭 stale 状态放行。 */
  configurationError: string | null
  providers: readonly DesktopModelProviderSummary[]
  currentProviderState: DesktopModelProviderState | null
  credentials: readonly DesktopProviderCredential[]
  apiKeys: readonly DesktopApiKeySummary[]
  usageSources: readonly UsageSourceDescriptor[]
  usageResults: readonly ProviderUsageSource[]
  usageGeneratedAt: number | null
  usageRange: RpcParams<'usage/provider/query'>['range'] | null
  usageTimeZone: string | null
}

export type ProviderConnectionKind =
  'inference-key' | 'oauth' | 'env' | 'billing-key' | 'subscription'

export type ProviderConnection = {
  id: string
  kind: ProviderConnectionKind
  origin: 'credential' | 'usage-source'
  providerIds: readonly ModelProviderID[]
  label: string
  active: boolean
  enabled?: boolean
  credentialId?: string
  sourceId?: string
}

export type ConfiguredProviderGroup = {
  provider: DesktopModelProviderSummary
  current: boolean
  configured: true
  apiKeys: readonly DesktopApiKeySummary[]
  oauthAvailable: boolean
  usageSources: readonly UsageSourceDescriptor[]
  connections: readonly ProviderConnection[]
  activeConnection: ProviderConnection | null
}

export type AnalyticsSource = {
  descriptor: UsageSourceDescriptor
  result: ProviderUsageSource | null
  connected: boolean
  metered: boolean
}

export type ProviderUsageQueryParams = RpcParams<'usage/provider/query'>
export type ProviderUsageQueryResult = RpcResult<'usage/provider/query'>
