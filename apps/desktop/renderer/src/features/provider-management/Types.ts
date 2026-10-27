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

export type ProviderUsageRange = RpcParams<'usage/provider/query'>['range']

export type ProviderOperationRegion = 'configuration' | 'usage-sources' | 'usage-query'

/** 操作触发来源固定为五类，用于开发期诊断串联事件与后续刷新。 */
export type ProviderOperationTrigger =
  'initialization' | 'user' | 'polling' | 'event' | 'post-write'

export type ProviderOperationStatus = 'success' | 'partial' | 'failure' | 'stale'

export type ProviderOperationError = {
  operationId: string
  operation: string
  region: ProviderOperationRegion
  /** 已安全转换的展示文案，不含原始异常或凭据。 */
  message: string
}

export type ProviderDiagnosticEntry = {
  operationId: string
  operation: string
  trigger: ProviderOperationTrigger
  eventId: string | null
  startedAt: number
  durationMs: number
  status: ProviderOperationStatus
  errorCategory: string | null
}

export type ProviderOperationOutcome<T> = {
  value: T
  /** 写入成功但随后刷新失败时的安全提示；调用方应提示成功并附带警告。 */
  syncWarning: string | null
  operationId: string
}

export type ProviderConfigurationState = {
  loaded: boolean
  loading: boolean
  /** 配置区域最近一次读取的失败文案；成功后清空。 */
  error: string | null
  /** 影响门禁可信度的配置读取错误；设置后工作台必须进入恢复态，不能凭 stale 状态放行。 */
  configurationError: string | null
  providers: readonly DesktopModelProviderSummary[]
  currentProviderState: DesktopModelProviderState | null
  credentials: readonly DesktopProviderCredential[]
  apiKeys: readonly DesktopApiKeySummary[]
  lastError: ProviderOperationError | null
}

export type ProviderUsageSourcesState = {
  loaded: boolean
  loading: boolean
  error: string | null
  sources: readonly UsageSourceDescriptor[]
  lastError: ProviderOperationError | null
}

export type ProviderUsageQueryPartition = {
  range: ProviderUsageRange
  timeZone: string
  generatedAt: number | null
  results: Readonly<Record<string, ProviderUsageSource>>
  refreshingSourceIds: readonly string[]
  error: string | null
}

export type ProviderManagementState = {
  configuration: ProviderConfigurationState
  usageSources: ProviderUsageSourcesState
  /** 按 `range + timeZone` 分区的用量查询缓存；不同范围与时区互不覆盖。 */
  usageQueries: Readonly<Record<string, ProviderUsageQueryPartition>>
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
