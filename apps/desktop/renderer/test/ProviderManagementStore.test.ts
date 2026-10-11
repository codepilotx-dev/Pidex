import { describe, expect, test } from 'bun:test'
import type { EventEnvelope } from '@pidex/agent-protocol'
import type {
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopProviderCredential,
} from '../shared/Types.js'
import {
  createProviderManagementStore,
  selectConfiguredProviderGroups,
  selectProviderConnections,
  type ProviderManagementClient,
} from '../src/features/provider-management/index.js'

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

describe('provider management store', () => {
  test('deduplicates concurrent loads and projects API Key plus OAuth credentials', async () => {
    let listCalls = 0
    const client = createClient({
      listProviderCredentials: async () => {
        listCalls += 1
        return [credential('key-1', 'api-key', true), credential('oauth-1', 'oauth', false)]
      },
    })
    const store = createProviderManagementStore(client)

    const [left, right] = await Promise.all([store.ensureLoaded(), store.ensureLoaded()])
    expect(left).toBe(right)
    expect(listCalls).toBe(1)
    expect(left.apiKeys.map((key) => key.id)).toEqual(['key-1'])
    expect(selectProviderConnections(left).map((connection) => connection.kind)).toEqual([
      'inference-key',
      'oauth',
    ])
    expect(selectConfiguredProviderGroups(left)[0]?.oauthAvailable).toBe(true)
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
    expect(store.getSnapshot().apiKeys.find((key) => key.id === 'key-2')?.active).toBe(true)
    expect(store.getSnapshot().apiKeys.find((key) => key.id === 'key-1')?.active).toBe(false)
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
    const unsubscribe = store.subscribe(() => {})
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
    await waitFor(() => store.getSnapshot().credentials[0]?.id === 'oauth-1')

    expect(store.getSnapshot().apiKeys).toEqual([])
    expect(store.getSnapshot().credentials[0]?.kind).toBe('oauth')
    expect(store.getSnapshot().currentProviderState?.modelConfigured).toBe(false)
    unsubscribe()
  })

  test('manual refresh forces the catalog before reloading page data without querying usage', async () => {
    const calls: string[] = []
    const client = createClient({
      refreshModelProviders: async () => {
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

    await store.refreshAllProviderData()

    expect(calls).toEqual(['refresh-models', 'providers', 'state', 'credentials', 'sources'])
    expect(store.getSnapshot().loading).toBe(false)
  })

  test('failed manual refresh preserves the previous page data and clears loading', async () => {
    let shouldFail = false
    const client = createClient({
      refreshModelProviders: async () => {
        if (shouldFail) throw new Error('catalog offline')
      },
    })
    const store = createProviderManagementStore(client)
    const before = await store.ensureLoaded()
    shouldFail = true

    await expect(store.refreshAllProviderData()).rejects.toThrow('catalog offline')

    const after = store.getSnapshot()
    expect(after.providers).toEqual(before.providers)
    expect(after.currentProviderState).toEqual(before.currentProviderState)
    expect(after.credentials).toEqual(before.credentials)
    expect(after.usageSources).toEqual(before.usageSources)
    expect(after.loading).toBe(false)
  })
})

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
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('timed out waiting for store reconciliation')
}
