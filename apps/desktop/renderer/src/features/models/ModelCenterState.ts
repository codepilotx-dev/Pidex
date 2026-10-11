import type {
  DesktopApiKeyHealthStatus,
  DesktopApiKeySummary,
  DesktopProviderCredential,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
} from '../../../shared/Types.js'

export const MODEL_CENTER_PROVIDER_SECTIONS = ['connection', 'models'] as const
export type ModelCenterProviderSection = (typeof MODEL_CENTER_PROVIDER_SECTIONS)[number]

export type ModelCenterRouteState = {
  providerId: string | null
  section: ModelCenterProviderSection
}

export type ModelCenterRoutePatch = {
  providerId?: string | null
  section?: ModelCenterProviderSection | 'router' | null
}

export function legacyModelCenterSettingsTarget(search: string): {
  pathname: '/settings/providers'
  search: string
} {
  const params = new URLSearchParams(search)
  params.delete('view')
  const nextSearch = params.toString()
  return {
    pathname: '/settings/providers',
    search: nextSearch ? `?${nextSearch}` : '',
  }
}

export type ApiKeyFilters = {
  providerId?: string | null
  query?: string
  health?: DesktopApiKeyHealthStatus | null
}

export type ApiKeyDeleteConfirmation = {
  title: string
  description: string
}

export type ProviderCatalogSource = 'gateway' | 'custom' | 'builtin'
export type ProviderConnectionStatus =
  'stored-key' | 'oauth' | 'environment' | 'configured' | 'unconfigured'
export type ProviderDirectoryStatus = 'current' | ProviderConnectionStatus
export type ProviderCatalogFilter = 'all' | 'configured' | 'unconfigured'

export type ProviderDirectoryItem = {
  provider: DesktopModelProviderSummary
  current: boolean
  connectionStatus: ProviderConnectionStatus
  statuses: ProviderDirectoryStatus[]
  sources: ProviderCatalogSource[]
  keyCount: number
  hasOAuth: boolean
  healthTone: 'healthy' | 'warning' | 'neutral'
}

export type ProviderDirectoryOptions = {
  query?: string
  filter?: ProviderCatalogFilter
  currentProviderId?: string | null
  currentProviderState?: DesktopModelProviderState | null
  apiKeys?: readonly DesktopApiKeySummary[]
  credentials?: readonly DesktopProviderCredential[]
}

const isProviderSection = (value: string | null): value is ModelCenterProviderSection =>
  MODEL_CENTER_PROVIDER_SECTIONS.some((candidate) => candidate === value)

export function parseModelCenterSearchParams(
  params: URLSearchParams,
  allowedProviderIds: readonly string[],
): ModelCenterRouteState {
  const allowed = new Set(allowedProviderIds)
  const requestedProvider = params.get('provider')

  const requestedSection = params.get('section')
  const resolvedSection: ModelCenterProviderSection =
    requestedSection === 'models' ? 'models' : 'connection'

  return {
    providerId: requestedProvider && allowed.has(requestedProvider) ? requestedProvider : null,
    section: resolvedSection,
  }
}

export function projectProviderDirectory(
  providers: readonly DesktopModelProviderSummary[],
  options: ProviderDirectoryOptions = {},
): ProviderDirectoryItem[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? ''
  const filter = options.filter ?? 'all'

  return providers.flatMap((provider) => {
    const sources = providerSources(provider)
    const current = provider.providerID === options.currentProviderId
    const connectionStatus = providerConnectionStatus(provider, options)
    const providerKeys = options.apiKeys?.filter((k) => k.providerId === provider.providerID) ?? []
    const keyCount = providerKeys.length
    const hasOAuth = Boolean(
      options.credentials?.some((c) => c.providerId === provider.providerID && c.kind === 'oauth'),
    )

    let healthTone: 'healthy' | 'warning' | 'neutral' = 'neutral'
    if (providerKeys.some((k) => k.health.status === 'healthy')) {
      healthTone = 'healthy'
    } else if (
      providerKeys.some((k) => k.health.status === 'auth-failed' || k.health.status === 'error')
    ) {
      healthTone = 'warning'
    }

    const isConfigured = connectionStatus !== 'unconfigured'

    if (filter === 'configured' && !isConfigured) return []
    if (filter === 'unconfigured' && isConfigured) return []

    const item: ProviderDirectoryItem = {
      provider,
      current,
      connectionStatus,
      statuses: current ? ['current', connectionStatus] : [connectionStatus],
      sources,
      keyCount,
      hasOAuth,
      healthTone,
    }
    if (!query || providerSearchText(provider, sources).includes(query)) return [item]
    return []
  })
}

/**
 * Returns a new URLSearchParams instance and leaves unrelated query parameters intact.
 * A null patch value removes the corresponding model-center parameter.
 */
export function updateModelCenterSearchParams(
  current: URLSearchParams,
  patch: ModelCenterRoutePatch,
): URLSearchParams {
  const next = new URLSearchParams(current)
  updateParam(next, 'provider', patch.providerId)
  if (patch.section === 'router') {
    updateParam(next, 'section', 'connection')
  } else {
    updateParam(next, 'section', patch.section)
  }
  return next
}

export function filterApiKeys(
  apiKeys: readonly DesktopApiKeySummary[],
  filters: ApiKeyFilters,
): DesktopApiKeySummary[] {
  const providerId = filters.providerId?.trim()
  const health = filters.health
  const query = filters.query?.trim().toLocaleLowerCase() ?? ''

  return apiKeys.filter((apiKey) => {
    if (providerId && apiKey.providerId !== providerId) return false
    if (health && apiKey.health.status !== health) return false
    if (!query) return true

    const searchable = [
      apiKey.label,
      apiKey.maskedValue,
      apiKey.health.status,
      apiKey.providerId,
      apiKey.active ? 'active current 当前' : 'backup 备用',
      apiKey.enabled ? 'enabled 启用' : 'disabled 停用',
    ]
      .join(' ')
      .toLocaleLowerCase()
    return searchable.includes(query)
  })
}

export function getApiKeyDeleteConfirmation(
  apiKey: DesktopApiKeySummary,
  apiKeys: readonly DesktopApiKeySummary[],
  providerName = apiKey.providerId,
): ApiKeyDeleteConfirmation {
  const title = `删除“${apiKey.label}”？`
  if (!apiKey.active) {
    return {
      title,
      description: '删除后无法恢复，但不会影响当前正在使用的 API Key。',
    }
  }

  return {
    title,
    description: `删除当前 API Key 后不会自动切换其他凭据，Provider“${providerName}”将等待你手动选择活动凭据。此操作无法撤销。`,
  }
}

function updateParam(params: URLSearchParams, key: string, value: string | null | undefined): void {
  if (value === undefined) return
  if (value === null) {
    params.delete(key)
    return
  }
  params.set(key, value)
}

function providerSources(provider: DesktopModelProviderSummary): ProviderCatalogSource[] {
  const sources: ProviderCatalogSource[] = []
  if (provider.gatewaySource) sources.push('gateway')
  if (provider.providerKind === 'custom') sources.push('custom')
  if (sources.length === 0) sources.push('builtin')
  return sources
}

function providerSearchText(
  provider: DesktopModelProviderSummary,
  sources: readonly ProviderCatalogSource[],
): string {
  const sourceTerms = sources.flatMap((source) => {
    if (source === 'gateway') return ['gateway', '网关']
    if (source === 'custom') return ['custom', '自定义']
    return ['builtin', 'built-in', '内置']
  })
  return [provider.displayName, provider.providerID, ...sourceTerms]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
}

function providerConnectionStatus(
  provider: DesktopModelProviderSummary,
  options: ProviderDirectoryOptions,
): ProviderConnectionStatus {
  if (options.apiKeys?.some((key) => key.providerId === provider.providerID)) return 'stored-key'

  if (
    options.credentials?.some(
      (credential) => credential.providerId === provider.providerID && credential.kind === 'oauth',
    )
  )
    return 'oauth'

  const isCurrentState = options.currentProviderState?.selectedProviderID === provider.providerID
  const currentSource = isCurrentState ? options.currentProviderState?.apiKeySource : null
  if (isCurrentState && currentSource && currentSource !== 'secureStorage') return 'environment'

  if (
    provider.apiKeyConfigured ||
    (isCurrentState && options.currentProviderState?.apiKeyConfigured)
  )
    return 'configured'

  return 'unconfigured'
}
