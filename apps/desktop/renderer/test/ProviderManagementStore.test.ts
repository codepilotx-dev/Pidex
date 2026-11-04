import { describe, expect, test } from 'bun:test'
import type {
  EventEnvelope,
  ProviderUsageSource,
  UsageSourceDescriptor,
} from '@pidex/agent-protocol'
import type {
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopProviderCredential,
} from '../shared/Types.js'
import {
  createProviderManagementStore,
  providerUsagePartitionKey,
  selectConfiguredProviderGroups,
  selectOrphanProviderCredentials,
  selectProviderConnections,
  type ProviderManagementClient,
  type ProviderManagementStore,
} from '../src/features/provider-management/index.js'
import {
  isConfiguredProviderDirectoryItem,
  projectProviderDirectory,
  providerDetailStatus,
} from '../src/features/models/ModelCenterState.js'

const provider = {
  providerID: 'openai',
  displayName: 'OpenAI',
  kind: 'builtin',
  providerKind: 'builtin',
  authMethods: ['api-key', 'oauth'],
  defaultModels: ['gpt-5.6'],
  apiKeyConfigured: true,
  envVars: [],
} as DesktopModelProviderSummary

const providerState = {
  selectedProviderID: 'openai',
  provider,
  model: 'gpt-5.6',
  apiKeyConfigured: true,
  apiKeySource: 'secureStorage',
  modelConfigured: true,
  models: ['gpt-5.6'],
} as DesktopModelProviderState

const connectionInput = (store: ProviderManagementStore) => {
  const state = store.getState()
  return {
    providers: state.configuration.providers,
    currentProviderState: state.configuration.currentProviderState,
    credentials: state.configuration.credentials,
    apiKeys: state.configuration.apiKeys,
    usageSources: state.usageSources.sources,
  }
}

const usageSource = (sourceId: string, connectionKind: 'provider-key' | 'none' = 'provider-key') =>
  ({
    sourceId,
    canonicalProviderId: 'openai',
    providerIds: ['openai'],
    displayName: sourceId,
    scope: 'account',
    stability: 'official',
    availability: 'queryable',
    capabilities: ['usage'],
    queryPolicy: 'cached',
    connection:
      connectionKind === 'none'
        ? { kind: 'none', disconnectible: false }
        : { kind: 'provider-key', disconnectible: false },
    connectionMethod: { kind: 'provider-credential' },
  }) as UsageSourceDescriptor

const usageResult = (sourceId: string, checkedAt = 1): ProviderUsageSource =>
  ({
    sourceId,
    providerIds: ['openai'],
    displayName: sourceId,
    scope: 'account',
    stability: 'official',
    status: 'available',
    checkedAt,
    connection: { kind: 'provider-key', disconnectible: false },
    groups: [],
  }) as ProviderUsageSource

describe('provider management store', () => {
  test('遗留凭据仅在目录成功加载后显示，按原凭据 ID 删除并刷新', async () => {
    const orphan = {
      ...credential('orphan-key', 'api-key', false),
      providerId: 'removed-provider',
    } as DesktopProviderCredential
    let deleted = false
    const client = createClient({
      listProviderCredentials: async () => [
        credential('existing', 'api-key', true),
        ...(!deleted ? [orphan] : []),
      ],
      deleteProviderCredential: async (id) => {
        expect(id).toBe('orphan-key')
        deleted = true
        return []
      },
    })
    const store = createProviderManagementStore(client)
    const before = store.getState().configuration
    expect(selectOrphanProviderCredentials(before)).toEqual([])
    await store.ensureLoaded()
    expect(selectOrphanProviderCredentials(store.getState().configuration)).toEqual([orphan])
    expect(
      selectOrphanProviderCredentials({
        ...store.getState().configuration,
        configurationError: 'offline',
      }),
    ).toEqual([])
    await store.deleteCredential(orphan.id)
    expect(selectOrphanProviderCredentials(store.getState().configuration)).toEqual([])
    expect(store.getState().configuration.credentials.map((item) => item.id)).toEqual(['existing'])
  })

  for (const remaining of ['none', 'oauth', 'environment'] as const) {
    test(`deleting the final API key reconciles configuration with remaining ${remaining} credentials`, async () => {
      let deleted = false
      const config = {
        kind: 'custom',
        id: 'openai',
        name: 'Saved directory provider',
        directorySource: 'models-dev',
        baseUrl: 'https://saved.example/v1',
        enabled: true,
        auth: 'api-key',
        env: [],
        headers: {},
        models: [],
      } as const
      const credentials = () => [
        ...(!deleted ? [credential('last-key', 'api-key', true)] : []),
        ...(remaining === 'oauth' ? [credential('oauth-key', 'oauth', true)] : []),
      ]
      const summary = () =>
        ({
          ...provider,
          config,
          apiKeyConfigured: !deleted || remaining !== 'none',
        }) as DesktopModelProviderSummary
      const client = createClient({
        listModelProviders: async () => [summary()],
        listProviderCredentials: async () => credentials(),
        getModelProviderState: async () => ({
          ...providerState,
          provider: summary(),
          apiKeyConfigured: !deleted || remaining !== 'none',
          apiKeySource:
            remaining === 'environment'
              ? 'OPENAI_API_KEY'
              : !deleted || remaining === 'oauth'
                ? 'secureStorage'
                : null,
        }),
        deleteProviderCredential: async (id) => {
          expect(id).toBe('last-key')
          deleted = true
          return credentials()
        },
      })
      const store = createProviderManagementStore(client)
      await store.ensureLoaded()
      const before = store.getState().configuration
      expect(
        isConfiguredProviderDirectoryItem(projectProviderDirectory(before.providers, before)[0]!),
      ).toBe(true)
      await store.deleteCredential('last-key')
      const after = store.getState().configuration
      expect(after.apiKeys).toEqual([])
      expect(after.providers[0]?.config).toEqual(config)
      const item = projectProviderDirectory(after.providers, after)[0]!
      expect(isConfiguredProviderDirectoryItem(item)).toBe(remaining !== 'none')
      expect(item.connectionStatus).toBe(
        remaining === 'none' ? 'unconfigured' : remaining === 'oauth' ? 'oauth' : 'environment',
      )
      expect(
        providerDetailStatus(after.providers[0]!, after.currentProviderState, undefined).label,
      ).toBe(remaining === 'none' ? '未配置' : '已配置')
    })
  }

  test('deduplicates concurrent loads and projects API Key plus OAuth credentials', async () => {
    let listCalls = 0
    const client = createClient({
      listProviderCredentials: async () => {
        listCalls += 1
        return [credential('key-1', 'api-key', true), credential('oauth-1', 'oauth', false)]
      },
    })
    const store = createProviderManagementStore(client)

    await Promise.all([store.ensureLoaded(), store.ensureLoaded()])
    expect(listCalls).toBe(1)
    const configuration = store.getState().configuration
    expect(configuration.apiKeys.map((key) => key.id)).toEqual(['key-1'])
    expect(
      selectProviderConnections(connectionInput(store)).map((connection) => connection.kind),
    ).toEqual(['inference-key', 'oauth'])
    expect(selectConfiguredProviderGroups(connectionInput(store))[0]?.oauthAvailable).toBe(true)
  })

  test('manual active selection refreshes credentials and never implies automatic failover', async () => {
    let credentials = [credential('key-1', 'api-key', true), credential('key-2', 'api-key', false)]
    const client = createClient({
      listProviderCredentials: async () => credentials,
      setActiveProviderCredential: async (_providerId, credentialId) => {
        credentials = credentials.map((item) => ({
          ...item,
          active: item.id === credentialId,
        }))
        return credentials.find((item) => item.id === credentialId)!
      },
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()

    await store.setActiveCredential('openai', 'key-2')
    const keys = store.getState().configuration.apiKeys
    expect(keys.find((key) => key.id === 'key-2')?.active).toBe(true)
    expect(keys.find((key) => key.id === 'key-1')?.active).toBe(false)
  })

  test('live credential events reconcile through provider/credential/list', async () => {
    let callback: ((events: readonly EventEnvelope[]) => void | Promise<void>) | undefined
    let subscriptionOptions:
      Parameters<ProviderManagementClient['subscribeAgentEventEnvelopes']>[0] | undefined
    let credentials = [credential('key-1', 'api-key', true)]
    let currentState = providerState
    const client = createClient({
      listProviderCredentials: async () => credentials,
      getModelProviderState: async () => currentState,
      subscribeAgentEventEnvelopes: (options, listener) => {
        subscriptionOptions = options
        callback = listener
        return () => {}
      },
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()
    expect(subscriptionOptions).toEqual({
      liveEventTypes: ['catalog/updated', 'provider/credential/updated', 'usage/source/updated'],
    })
    credentials = [credential('oauth-1', 'oauth', true)]
    currentState = { ...providerState, modelConfigured: false }

    await callback?.([
      {
        eventId: 'credential-event-1',
        streamId: 'global',
        type: 'provider/credential/updated',
        version: 1,
        occurredAt: Date.now(),
        durability: 'live',
        sequence: null,
        afterSequence: 1,
        payload: { providerId: 'openai' },
      },
    ])
    await waitFor(() => store.getState().configuration.credentials[0]?.id === 'oauth-1')

    expect(store.getState().configuration.apiKeys).toEqual([])
    expect(store.getState().configuration.credentials[0]?.kind).toBe('oauth')
    expect(store.getState().configuration.currentProviderState?.modelConfigured).toBe(false)
    expect(store.getDiagnostics().some((entry) => entry.eventId === 'credential-event-1')).toBe(
      true,
    )
    store.dispose()
  })

  test('manual refresh forces the catalog before reloading page data without querying usage', async () => {
    const calls: string[] = []
    const client = createClient({
      refreshModelProviders: async (providerId) => {
        expect(providerId).toBe('google')
        calls.push('refresh-models')
      },
      listModelProviders: async () => {
        calls.push('providers')
        return [provider]
      },
      getModelProviderState: async () => {
        calls.push('state')
        return providerState
      },
      listProviderCredentials: async () => {
        calls.push('credentials')
        return []
      },
      listUsageSources: async () => {
        calls.push('sources')
        return { sources: [] }
      },
      queryProviderUsage: async (input) => {
        calls.push('usage')
        return {
          sources: [],
          generatedAt: Date.now(),
          range: input.range,
          timeZone: input.timeZone,
        }
      },
    })
    const store = createProviderManagementStore(client)

    await store.refreshAllProviderData('google')

    expect(calls).toEqual(['refresh-models', 'providers', 'state', 'credentials', 'sources'])
    expect(store.getState().configuration.loading).toBe(false)
  })

  test('failed manual refresh preserves the previous page data and clears loading', async () => {
    let shouldFail = false
    const client = createClient({
      refreshModelProviders: async () => {
        if (shouldFail) throw new Error('catalog offline')
      },
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()
    const before = store.getState()
    shouldFail = true

    await expect(store.refreshAllProviderData()).rejects.toThrow('catalog offline')

    const after = store.getState()
    expect(after.configuration.providers).toEqual(before.configuration.providers)
    expect(after.configuration.currentProviderState).toEqual(
      before.configuration.currentProviderState,
    )
    expect(after.configuration.credentials).toEqual(before.configuration.credentials)
    expect(after.usageSources.sources).toEqual(before.usageSources.sources)
    expect(after.configuration.loading).toBe(false)
  })

  test('initialization loads configuration and sources once and merges event bursts', async () => {
    let configurationReads = 0
    let sourceReads = 0
    let release: (() => void) | null = null
    let callback: ((events: readonly EventEnvelope[]) => void | Promise<void>) | undefined
    const client = createClient({
      listModelProviders: async () => {
        configurationReads += 1
        if (release) await new Promise<void>((resolve) => (release = resolve))
        return [provider]
      },
      listUsageSources: async () => {
        sourceReads += 1
        return { sources: [usageSource('balance')] }
      },
      subscribeAgentEventEnvelopes: (_options, listener) => {
        callback = listener
        return () => {}
      },
    })
    const store = createProviderManagementStore(client)
    await Promise.all([store.ensureLoaded(), store.ensureLoaded()])
    expect(configurationReads).toBe(1)
    expect(sourceReads).toBe(1)

    // 事件突发合并：三次事件只触发一轮刷新，且每个事件都记入诊断。
    configurationReads = 0
    sourceReads = 0
    await callback?.([
      event('catalog/updated', 'event-1'),
      event('catalog/updated', 'event-2'),
      event('usage/source/updated', 'event-3'),
    ])
    await waitFor(() => configurationReads > 0 && sourceReads > 0)
    expect(configurationReads).toBe(1)
    expect(sourceReads).toBe(1)
    expect(store.getDiagnostics().filter((entry) => entry.trigger === 'event').length).toBe(2)
    release = null
    store.dispose()
  })

  test('a write during an in-flight read discards the stale response and refreshes again', async () => {
    let credentials = [credential('key-1', 'api-key', true)]
    let holdReads = true
    let pendingReads: Array<() => void> = []
    const client = createClient({
      listProviderCredentials: async () => {
        const snapshot = [...credentials]
        if (holdReads) {
          await new Promise<void>((resolve) => pendingReads.push(resolve))
        }
        return snapshot
      },
      createApiKey: async () => {
        credentials = [...credentials, credential('key-2', 'api-key', false)]
        return credential('key-2', 'api-key', false)
      },
    })
    const store = createProviderManagementStore(client)
    const initial = store.refresh()
    await waitFor(() => pendingReads.length === 1)
    const write = store.createApiKey({ providerId: 'openai', label: 'Key 2', key: 'secret' })
    holdReads = false
    pendingReads.forEach((resolve) => resolve())
    pendingReads = []
    await initial
    await write
    // 写入后触发的第二轮读取必须完成，最终状态来自新批次。
    await waitFor(() => pendingReads.length === 0)
    await waitFor(() => store.getState().configuration.apiKeys.length === 2)
    expect(store.getState().configuration.apiKeys.map((key) => key.id)).toEqual(['key-1', 'key-2'])
    expect(store.getDiagnostics().some((entry) => entry.status === 'stale')).toBe(true)
    store.dispose()
  })

  test('partial configuration failure keeps usable data but blocks the gate', async () => {
    const client = createClient({
      getModelProviderState: async () => {
        throw new Error('state offline')
      },
      listProviderCredentials: async () => [credential('key-1', 'api-key', true)],
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()
    const configuration = store.getState().configuration
    expect(configuration.providers).toEqual([provider])
    expect(configuration.credentials.map((item) => item.id)).toEqual(['key-1'])
    expect(configuration.currentProviderState).toBeNull()
    expect(configuration.configurationError).toBeTruthy()
    expect(configuration.lastError?.region).toBe('configuration')
    store.dispose()
  })

  test('a successful write with a failed sync reports a warning instead of a write failure', async () => {
    let failReads = false
    const client = createClient({
      listModelProviders: async () => {
        if (failReads) throw new Error('catalog offline')
        return [provider]
      },
      createApiKey: async () => credential('key-2', 'api-key', true),
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()
    failReads = true

    const outcome = await store.createApiKey({
      providerId: 'openai',
      label: 'Key 2',
      key: 'secret',
    })
    expect(outcome.value.id).toBe('key-2')
    expect(outcome.syncWarning).toBeTruthy()
    expect(store.getState().configuration.configurationError).toBeTruthy()
    const entry = store.getDiagnostics().find((item) => item.operation === 'api-key.create')
    expect(entry?.status).toBe('partial')
    store.dispose()
  })

  test('usage partitions isolate range, time zone and overlapping sources', async () => {
    const calls: Array<{ range: string; timeZone: string; sourceIds: string[] }> = []
    const client = createClient({
      listUsageSources: async () => ({ sources: [usageSource('a'), usageSource('b')] }),
      queryProviderUsage: async (input) => {
        calls.push({
          range: input.range,
          timeZone: input.timeZone,
          sourceIds: [...(input.sourceIds ?? [])],
        })
        return {
          sources: (input.sourceIds ?? []).map((sourceId) => usageResult(sourceId, calls.length)),
          generatedAt: calls.length,
          range: input.range,
          timeZone: input.timeZone,
        }
      },
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()

    await Promise.all([
      store.querySources({ range: 'today', timeZone: 'Asia/Shanghai', sourceIds: ['a'] }),
      store.querySources({ range: '7d', timeZone: 'Asia/Shanghai', sourceIds: ['a', 'b'] }),
      store.querySources({ range: '7d', timeZone: 'America/New_York', sourceIds: ['b'] }),
    ])
    const partitions = store.getState().usageQueries
    expect(Object.keys(partitions).sort()).toEqual(
      [
        providerUsagePartitionKey('today', 'Asia/Shanghai'),
        providerUsagePartitionKey('7d', 'Asia/Shanghai'),
        providerUsagePartitionKey('7d', 'America/New_York'),
      ].sort(),
    )
    expect(
      Object.keys(partitions[providerUsagePartitionKey('today', 'Asia/Shanghai')]!.results),
    ).toEqual(['a'])
    expect(
      Object.keys(partitions[providerUsagePartitionKey('7d', 'Asia/Shanghai')]!.results).sort(),
    ).toEqual(['a', 'b'])
    expect(
      Object.keys(partitions[providerUsagePartitionKey('7d', 'America/New_York')]!.results),
    ).toEqual(['b'])
    // 重叠来源的请求分别只更新自己请求的来源。
    expect(calls).toHaveLength(3)
    store.dispose()
  })

  test('overlapping requests commit only the newest sequence per source', async () => {
    let releaseFirst: (() => void) | null = null
    let first = true
    const client = createClient({
      queryProviderUsage: async (input) => {
        if (first) {
          first = false
          await new Promise<void>((resolve) => (releaseFirst = resolve))
          return {
            sources: [usageResult('a', 1)],
            generatedAt: 1,
            range: input.range,
            timeZone: input.timeZone,
          }
        }
        return {
          sources: [usageResult('a', 2)],
          generatedAt: 2,
          range: input.range,
          timeZone: input.timeZone,
        }
      },
    })
    const store = createProviderManagementStore(client)
    const stale = store.querySources({
      range: 'today',
      timeZone: 'Asia/Shanghai',
      sourceIds: ['a'],
    })
    const fresh = store.querySources({
      range: 'today',
      timeZone: 'Asia/Shanghai',
      sourceIds: ['a'],
      force: true,
    })
    await fresh
    releaseFirst?.()
    await stale
    const partition =
      store.getState().usageQueries[providerUsagePartitionKey('today', 'Asia/Shanghai')]
    expect(partition?.results.a?.checkedAt).toBe(2)
    expect(store.getDiagnostics().some((entry) => entry.status === 'stale')).toBe(true)
    store.dispose()
  })

  test('disconnect invalidates cached and in-flight usage results', async () => {
    let connection: UsageSourceDescriptor['connection'] = {
      kind: 'provider-key',
      disconnectible: false,
    }
    let release: (() => void) | null = null
    const client = createClient({
      listUsageSources: async () => ({
        sources: [{ ...usageSource('a'), connection }],
      }),
      disconnectUsageCredential: async () => {
        connection = { kind: 'none', disconnectible: false }
        return { sourceId: 'a', disconnected: true as const }
      },
      queryProviderUsage: async (input) => {
        await new Promise<void>((resolve) => (release = resolve))
        return {
          sources: [usageResult('a', 9)],
          generatedAt: 9,
          range: input.range,
          timeZone: input.timeZone,
        }
      },
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()
    const pending = store.querySources({
      range: 'today',
      timeZone: 'Asia/Shanghai',
      sourceIds: ['a'],
    })
    await store.disconnectUsageCredential({ sourceId: 'a' })
    release?.()
    await pending
    const partition =
      store.getState().usageQueries[providerUsagePartitionKey('today', 'Asia/Shanghai')]
    expect(partition?.results.a).toBeUndefined()
    expect(store.getState().usageSources.sources[0]?.connection.kind).toBe('none')
    store.dispose()
  })

  test('querying an empty source set sends no RPC', async () => {
    let queries = 0
    const client = createClient({
      queryProviderUsage: async (input) => {
        queries += 1
        return { sources: [], generatedAt: 1, range: input.range, timeZone: input.timeZone }
      },
    })
    const store = createProviderManagementStore(client)
    await store.querySources({ range: 'today', timeZone: 'Asia/Shanghai', sourceIds: [] })
    expect(queries).toBe(0)
    store.dispose()
  })

  test('keeps at most eight idle usage partitions', async () => {
    const client = createClient({
      queryProviderUsage: async (input) => ({
        sources: [usageResult('a', 1)],
        generatedAt: 1,
        range: input.range,
        timeZone: input.timeZone,
      }),
    })
    const store = createProviderManagementStore(client)
    for (const timeZone of ['z1', 'z2', 'z3', 'z4', 'z5', 'z6', 'z7', 'z8', 'z9']) {
      await store.querySources({ range: 'today', timeZone, sourceIds: ['a'] })
    }
    const partitions = Object.keys(store.getState().usageQueries)
    expect(partitions).toHaveLength(8)
    expect(partitions).not.toContain(providerUsagePartitionKey('today', 'z1'))
    store.dispose()
  })

  test('subscribes once, stops committing after dispose, and bounds diagnostics', async () => {
    let subscriptions = 0
    let listener: ((events: readonly EventEnvelope[]) => void | Promise<void>) | undefined
    let unsubscribed = 0
    const client = createClient({
      subscribeAgentEventEnvelopes: (_options, next) => {
        subscriptions += 1
        listener = next
        return () => {
          unsubscribed += 1
        }
      },
    })
    const store = createProviderManagementStore(client)
    await Promise.all([store.ensureLoaded(), store.refresh(), store.refreshSources()])
    expect(subscriptions).toBe(1)

    for (let index = 0; index < 120; index += 1) {
      await store.refresh()
    }
    expect(store.getDiagnostics()).toHaveLength(100)

    store.dispose()
    expect(unsubscribed).toBe(1)
    await listener?.([event('catalog/updated', 'after-dispose')])
    const frozen = store.getState()
    await store.refresh()
    expect(store.getState()).toBe(frozen)
    expect(store.getDiagnostics().some((entry) => entry.eventId === 'after-dispose')).toBe(false)
  })

  test('usage and diagnostics updates keep the configuration slice referentially stable', async () => {
    const client = createClient({
      listUsageSources: async () => ({ sources: [usageSource('a')] }),
      queryProviderUsage: async (input) => ({
        sources: [usageResult('a', 5)],
        generatedAt: 5,
        range: input.range,
        timeZone: input.timeZone,
      }),
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()
    const configuration = store.getState().configuration
    const usageSources = store.getState().usageSources

    await store.querySources({ range: 'today', timeZone: 'Asia/Shanghai', sourceIds: ['a'] })

    // 侧栏与配置门禁只订阅 configuration；用量查询不得替换该切片。
    expect(store.getState().configuration).toBe(configuration)
    expect(store.getState().usageSources).toBe(usageSources)
    store.dispose()
  })

  test('diagnostics never record secrets or payload details', async () => {
    const client = createClient({
      createApiKey: async () => credential('key-2', 'api-key', true),
    })
    const store = createProviderManagementStore(client)
    await store.ensureLoaded()
    await store.createApiKey({ providerId: 'openai', label: 'Key 2', key: 'super-secret-value' })
    const serialized = JSON.stringify(store.getDiagnostics())
    expect(serialized).not.toContain('super-secret-value')
    expect(serialized).not.toContain('Key 2')
    const entry = store.getDiagnostics().at(-1)
    expect(Object.keys(entry ?? {}).sort()).toEqual([
      'durationMs',
      'errorCategory',
      'eventId',
      'operation',
      'operationId',
      'startedAt',
      'status',
      'trigger',
    ])
    store.dispose()
  })
})

function event(type: EventEnvelope['type'], eventId: string): EventEnvelope {
  return {
    eventId,
    streamId: 'global',
    type,
    version: 1,
    occurredAt: Date.now(),
    durability: 'live',
    sequence: null,
    afterSequence: 1,
    payload: type === 'provider/credential/updated' ? { providerId: 'openai' } : {},
  } as EventEnvelope
}

function createClient(overrides: Partial<ProviderManagementClient> = {}): ProviderManagementClient {
  return {
    refreshModelProviders: async () => {},
    listModelProviders: async () => [provider],
    getModelProviderState: async () => providerState,
    listProviderCredentials: async () => [],
    listUsageSources: async () => ({ sources: [] }),
    queryProviderUsage: async (input) => ({
      sources: [],
      generatedAt: Date.now(),
      range: input.range,
      timeZone: input.timeZone,
    }),
    connectUsageCredential: async () => {
      throw new Error('not used')
    },
    disconnectUsageCredential: async () => {
      throw new Error('not used')
    },
    createApiKey: async () => credential('created', 'api-key', true),
    updateApiKey: async () => credential('updated', 'api-key', true),
    testApiKey: async () => ({ ok: true }),
    setActiveProviderCredential: async (_providerId, credentialId) =>
      credential(credentialId, 'api-key', true),
    setProviderCredentialEnabled: async (credentialId, enabled) => ({
      ...credential(credentialId, 'api-key', false),
      enabled,
    }),
    reorderApiKeys: async () => [],
    deleteProviderCredential: async () => [],
    subscribeAgentEventEnvelopes: () => () => {},
    ...overrides,
  } as ProviderManagementClient
}

function credential(
  id: string,
  kind: 'api-key' | 'oauth',
  active: boolean,
): DesktopProviderCredential {
  return {
    id,
    providerId: 'openai',
    kind,
    label: kind === 'oauth' ? 'OpenAI OAuth' : `Key ${id}`,
    ...(kind === 'api-key' ? { maskedValue: '••••test' } : {}),
    enabled: true,
    active,
    order: 0,
    health: { status: 'untested' },
    createdAt: 1,
    updatedAt: 1,
  } as DesktopProviderCredential
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('timed out waiting for store reconciliation')
}
