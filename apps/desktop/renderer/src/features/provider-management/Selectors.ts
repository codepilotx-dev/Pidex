import type { UsageSourceDescriptor } from '@pidex/agent-protocol'
import type { ModelProviderID } from '../../../shared/Types.js'
import type {
  AnalyticsSource,
  ConfiguredProviderGroup,
  ProviderConnection,
  ProviderConnectionKind,
  ProviderConfigurationState,
  ProviderUsageQueryPartition,
} from './Types.js'

/** 目录与凭据投影的输入；不依赖用量查询状态。 */
export type ProviderConfigurationInput = Pick<
  ProviderConfigurationState,
  | 'loaded'
  | 'error'
  | 'configurationError'
  | 'providers'
  | 'currentProviderState'
  | 'credentials'
  | 'apiKeys'
>

export type ProviderConnectionsInput = Pick<
  ProviderConfigurationState,
  'providers' | 'currentProviderState' | 'credentials' | 'apiKeys'
> & { usageSources: readonly UsageSourceDescriptor[] }

export type ProviderAnalyticsInput = ProviderConnectionsInput & {
  usageResults: ProviderUsageQueryPartition['results']
}

export function selectOrphanProviderCredentials(configuration: ProviderConfigurationInput) {
  if (!configuration.loaded || configuration.configurationError || configuration.error) return []
  const known = new Set(configuration.providers.map((provider) => String(provider.providerID)))
  return configuration.credentials.filter((credential) => !known.has(String(credential.providerId)))
}

const usageConnectionKind = (source: UsageSourceDescriptor): ProviderConnectionKind | null => {
  switch (source.connection.kind) {
    case 'provider-key':
      return 'inference-key'
    case 'billing-key':
      return 'billing-key'
    case 'oauth':
      return source.scope === 'subscription' ? 'subscription' : 'oauth'
    case 'env':
      return 'env'
    case 'none':
      return null
  }
}

const connectionIdentity = (connection: ProviderConnection): string =>
  connection.credentialId
    ? `credential:${connection.credentialId}`
    : `${connection.origin}:${connection.kind}:${connection.id}`

export function selectProviderConnections(
  input: ProviderConnectionsInput,
): readonly ProviderConnection[] {
  const connections: ProviderConnection[] = input.credentials.map((credential) => ({
    id: `credential:${credential.id}`,
    kind: credential.kind === 'oauth' ? 'oauth' : 'inference-key',
    origin: 'credential',
    providerIds: [credential.providerId],
    label: credential.label,
    active: credential.active,
    enabled: credential.enabled,
    credentialId: credential.id,
  }))
  const identities = new Set(connections.map(connectionIdentity))

  for (const provider of input.providers) {
    const current = input.currentProviderState?.selectedProviderID === provider.providerID
    const source = current ? input.currentProviderState?.apiKeySource : null
    if (!source || source === 'secureStorage') continue
    const projected: ProviderConnection = {
      id: `env:${provider.providerID}:${source}`,
      kind: 'env',
      origin: 'credential',
      providerIds: [provider.providerID],
      label: source,
      active: true,
      enabled: true,
    }
    connections.push(projected)
  }

  for (const source of input.usageSources) {
    const kind = usageConnectionKind(source)
    if (kind === null) continue
    const projected: ProviderConnection = {
      id: `usage-source:${source.sourceId}`,
      kind,
      origin: 'usage-source',
      providerIds: source.providerIds,
      label: source.displayName,
      active: true,
      enabled: true,
      sourceId: source.sourceId,
      ...(source.connection.credentialId ? { credentialId: source.connection.credentialId } : {}),
    }
    const identity = connectionIdentity(projected)
    if (identities.has(identity)) continue
    identities.add(identity)
    connections.push(projected)
  }

  return connections
}

const connectionPriority = (connection: ProviderConnection): number => {
  if (connection.kind === 'inference-key' && connection.active) return 0
  if (connection.kind === 'oauth' && connection.active) return 1
  if (connection.kind === 'env') return 2
  if (connection.kind === 'inference-key') return 3
  return 4
}

export function selectConfiguredProviderGroups(
  input: ProviderConnectionsInput,
): readonly ConfiguredProviderGroup[] {
  const connections = selectProviderConnections(input)
  const currentProviderId = input.currentProviderState?.selectedProviderID
  return input.providers
    .flatMap((provider) => {
      const providerConnections = connections
        .filter((connection) => connection.providerIds.includes(provider.providerID))
        .sort((left, right) => connectionPriority(left) - connectionPriority(right))
      if (providerConnections.length === 0) return []
      const usageSources = input.usageSources.filter((source) =>
        source.providerIds.some((providerId) => String(providerId) === String(provider.providerID)),
      )
      return [
        {
          provider,
          current: provider.providerID === currentProviderId,
          configured: true as const,
          apiKeys: input.apiKeys.filter((key) => key.providerId === provider.providerID),
          oauthAvailable: provider.authMethods?.includes('oauth') ?? false,
          usageSources,
          connections: providerConnections,
          activeConnection:
            providerConnections.find((connection) => connection.active) ??
            providerConnections[0] ??
            null,
        },
      ]
    })
    .sort(
      (left, right) =>
        Number(right.current) - Number(left.current) ||
        left.provider.displayName.localeCompare(right.provider.displayName, 'zh-CN'),
    )
}

const analyticsPriority = (source: AnalyticsSource): number => {
  if (source.result?.status === 'available') return 0
  if (source.connected) return 1
  if (source.descriptor.availability === 'queryable') return 2
  return 3
}

export function selectAnalyticsSources(input: ProviderAnalyticsInput): readonly AnalyticsSource[] {
  const configuredProviderIds = new Set(
    selectProviderConnections(input)
      .flatMap((connection) => connection.providerIds)
      .map(String),
  )
  return input.usageSources
    .filter((descriptor) =>
      descriptor.providerIds.some((providerId) => configuredProviderIds.has(String(providerId))),
    )
    .map((descriptor) => ({
      descriptor,
      result: input.usageResults[descriptor.sourceId] ?? null,
      connected: descriptor.connection.kind !== 'none',
      metered: descriptor.queryPolicy === 'metered',
    }))
    .sort(
      (left, right) =>
        analyticsPriority(left) - analyticsPriority(right) ||
        left.descriptor.displayName.localeCompare(right.descriptor.displayName, 'zh-CN'),
    )
}

export function providerCredentialsFor(
  configuration: ProviderConfigurationInput,
  providerId: ModelProviderID,
) {
  return configuration.credentials.filter((credential) => credential.providerId === providerId)
}
