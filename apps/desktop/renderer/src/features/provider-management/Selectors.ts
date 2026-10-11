import type { UsageSourceDescriptor } from '@pidex/agent-protocol'
import type { ModelProviderID } from '../../../shared/Types.js'
import type {
  AnalyticsSource,
  ConfiguredProviderGroup,
  ProviderConnection,
  ProviderConnectionKind,
  ProviderManagementSnapshot,
} from './Types.js'

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
  snapshot: ProviderManagementSnapshot,
): readonly ProviderConnection[] {
  const connections: ProviderConnection[] = snapshot.credentials.map((credential) => ({
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

  for (const provider of snapshot.providers) {
    const current = snapshot.currentProviderState?.selectedProviderID === provider.providerID
    const source = current ? snapshot.currentProviderState?.apiKeySource : null
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

  for (const source of snapshot.usageSources) {
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
  snapshot: ProviderManagementSnapshot,
): readonly ConfiguredProviderGroup[] {
  const connections = selectProviderConnections(snapshot)
  const currentProviderId = snapshot.currentProviderState?.selectedProviderID
  return snapshot.providers
    .flatMap((provider) => {
      const providerConnections = connections
        .filter((connection) => connection.providerIds.includes(provider.providerID))
        .sort((left, right) => connectionPriority(left) - connectionPriority(right))
      if (providerConnections.length === 0) return []
      const usageSources = snapshot.usageSources.filter((source) =>
        source.providerIds.some((providerId) => String(providerId) === String(provider.providerID)),
      )
      return [
        {
          provider,
          current: provider.providerID === currentProviderId,
          configured: true as const,
          apiKeys: snapshot.apiKeys.filter((key) => key.providerId === provider.providerID),
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

export function selectAnalyticsSources(
  snapshot: ProviderManagementSnapshot,
): readonly AnalyticsSource[] {
  const configuredProviderIds = new Set(
    selectProviderConnections(snapshot)
      .flatMap((connection) => connection.providerIds)
      .map(String),
  )
  const resultById = new Map(snapshot.usageResults.map((result) => [result.sourceId, result]))
  return snapshot.usageSources
    .filter((descriptor) =>
      descriptor.providerIds.some((providerId) => configuredProviderIds.has(String(providerId))),
    )
    .map((descriptor) => ({
      descriptor,
      result: resultById.get(descriptor.sourceId) ?? null,
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
  snapshot: ProviderManagementSnapshot,
  providerId: ModelProviderID,
) {
  return snapshot.credentials.filter((credential) => credential.providerId === providerId)
}
