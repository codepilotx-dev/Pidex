import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesktopModelProviderState, DesktopModelProviderSummary } from '../shared/Types.js'
import {
  createProviderManagementStore,
  providerUsagePartitionKey,
  useProviderManagementStore,
  type ProviderManagementClient,
} from '../src/features/provider-management/index.js'

const provider = {
  providerID: 'openai',
  displayName: 'OpenAI',
  kind: 'builtin',
  providerKind: 'builtin',
  authMethods: ['api-key'],
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
    createApiKey: async () => {
      throw new Error('not used')
    },
    updateApiKey: async () => {
      throw new Error('not used')
    },
    testApiKey: async () => ({ ok: true }),
    setActiveProviderCredential: async () => {
      throw new Error('not used')
    },
    setProviderCredentialEnabled: async () => {
      throw new Error('not used')
    },
    reorderApiKeys: async () => [],
    deleteProviderCredential: async () => [],
    subscribeAgentEventEnvelopes: () => () => {},
    ...overrides,
  } as ProviderManagementClient
}

describe('provider management subscription slices', () => {
  test('mounted connection handles empty partitions and usage does not rerender sidebar or gate', async () => {
    const child = Bun.spawn(
      [process.execPath, `${import.meta.dir}/ProviderManagementSubscription.browser.ts`],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' })
    expect(stdout).toContain('Provider mounted regression passed')
  }, 30_000)

  test('configuration-only consumers do not read usage query results', () => {
    let reads = 0
    const client = createClient({
      listUsageSources: async () => {
        reads += 1
        return { sources: [] }
      },
    })
    const store = createProviderManagementStore(client)
    const seen: unknown[] = []

    // 等价于侧栏/门禁的 selector：只读 configuration，不触碰 usageQueries。
    function ConfigurationConsumer() {
      const configuration = useProviderManagementStore(
        (state) => state.configuration.providers.length,
        store,
      )
      seen.push(configuration)
      return createElement('span', null, String(configuration))
    }

    renderToStaticMarkup(createElement(ConfigurationConsumer))
    expect(seen).toEqual([0])
    expect(store.getState().usageQueries).toEqual({})
    expect(reads).toBeLessThanOrEqual(1)
    store.dispose()
  })

  test('partition selector stays scoped to its own range and time zone', () => {
    const store = createProviderManagementStore(createClient())
    const key = providerUsagePartitionKey('today', 'Asia/Shanghai')
    expect(store.getState().usageQueries[key]).toBeUndefined()
    expect(
      store.getState().usageQueries[providerUsagePartitionKey('7d', 'Asia/Shanghai')],
    ).toBeUndefined()
    store.dispose()
  })
})
