import { describe, expect, test } from 'bun:test'
import type { DesktopApiKeySummary, DesktopModelProviderSummary } from '../shared/Types.js'
import {
  filterApiKeys,
  groupProviderModels,
  getApiKeyDeleteConfirmation,
  parseModelCenterSearchParams,
  providerDetailStatus,
  projectProviderDirectory,
  isConfiguredProviderDirectoryItem,
  providerWorkspaceTarget,
  updateModelCenterSearchParams,
} from '../src/features/models/ModelCenterState.js'

const keys: DesktopApiKeySummary[] = [
  apiKey({
    id: 'primary',
    providerId: 'openai',
    label: '生产 Key',
    maskedValue: '••••a9K2',
    active: true,
    priority: 0,
    health: { status: 'healthy' },
  }),
  apiKey({
    id: 'backup',
    providerId: 'openai',
    label: '备用 Key',
    maskedValue: '••••b123',
    priority: 1,
    health: { status: 'untested' },
  }),
  apiKey({
    id: 'anthropic',
    providerId: 'anthropic',
    label: 'Claude 限流 Key',
    maskedValue: '••••c456',
    health: { status: 'rate-limited' },
  }),
]

describe('model center URL state', () => {
  test('redirects legacy routes to the providers workspace while dropping only the obsolete view', () => {
    expect(
      providerWorkspaceTarget('?view=health&provider=anthropic&section=models&debug=1'),
    ).toEqual({
      pathname: '/providers',
      search: '?provider=anthropic&section=models&debug=1',
    })
    expect(providerWorkspaceTarget('?view=keys')).toEqual({
      pathname: '/providers',
      search: '',
    })
  })

  test('parses valid provider and section', () => {
    const state = parseModelCenterSearchParams(
      new URLSearchParams('view=providers&provider=anthropic&section=models'),
      ['openai', 'anthropic'],
    )

    expect(state).toEqual({ providerId: 'anthropic', section: 'models', editing: false })
  })

  test('ignores legacy view while preserving provider details', () => {
    const state = parseModelCenterSearchParams(
      new URLSearchParams('view=keys&provider=anthropic&section=models'),
      ['openai', 'anthropic'],
    )

    expect(state).toEqual({ providerId: 'anthropic', section: 'models', editing: false })
  })

  test('falls back for invalid parameters and provider', () => {
    const state = parseModelCenterSearchParams(
      new URLSearchParams('view=other&provider=missing&section=usage'),
      ['openai', 'anthropic'],
    )

    expect(state).toEqual({ providerId: null, section: 'connection', editing: false })
  })

  test('keeps the provider catalog open when provider is missing', () => {
    expect(parseModelCenterSearchParams(new URLSearchParams(), ['openai'])).toEqual({
      providerId: null,
      section: 'connection',
      editing: false,
    })
    expect(parseModelCenterSearchParams(new URLSearchParams(), []).providerId).toBeNull()
  })

  test('updates model-center params without mutating unrelated params', () => {
    const current = new URLSearchParams('debug=1&section=connection')
    const next = updateModelCenterSearchParams(current, {
      providerId: 'openai',
      section: null,
    })

    expect(next.toString()).toBe('debug=1&provider=openai')
    expect(current.toString()).toBe('debug=1&section=connection')
  })

  test('opens editing only for a valid custom provider and retains its detail section', () => {
    const params = new URLSearchParams('provider=custom&edit=1&section=models')
    expect(parseModelCenterSearchParams(params, ['custom', 'openai'], ['custom'])).toEqual({
      providerId: 'custom',
      section: 'models',
      editing: true,
    })
    expect(parseModelCenterSearchParams(params, ['openai'], ['custom']).editing).toBe(false)
    params.set('provider', 'openai')
    expect(parseModelCenterSearchParams(params, ['custom', 'openai'], ['custom']).editing).toBe(
      false,
    )
  })

  test('clears editing when switching provider or returning to details and the catalog', () => {
    const params = new URLSearchParams('provider=custom&edit=1&section=models&debug=1')
    expect(updateModelCenterSearchParams(params, { providerId: 'openai' }).toString()).toBe(
      'provider=openai&section=models&debug=1',
    )
    expect(updateModelCenterSearchParams(params, { editing: false }).toString()).toBe(
      'provider=custom&section=models&debug=1',
    )
    expect(
      updateModelCenterSearchParams(params, { providerId: null, section: null }).toString(),
    ).toBe('debug=1')
    expect(
      updateModelCenterSearchParams(new URLSearchParams('newProvider=1'), {
        providerId: 'custom',
        section: 'models',
        editing: true,
      }).toString(),
    ).toBe('edit=1&provider=custom&section=models')
  })
})

describe('provider detail configuration status', () => {
  test('credentials mean configured, not tested; disabled and unavailable states take precedence', () => {
    const p = provider({ providerID: 'custom', apiKeyConfigured: true })
    expect(providerDetailStatus(p, null, undefined).label).toBe('已配置')
    expect(providerDetailStatus({ ...p, enabled: false }, null, undefined).label).toBe('已停用')
    expect(
      providerDetailStatus(
        { ...p, availability: { status: 'unavailable', reason: 'unsupported-protocol' } },
        null,
        undefined,
      ).label,
    ).toBe('暂不可用')
    expect(providerDetailStatus({ ...p, apiKeyConfigured: false }, null, undefined).label).toBe(
      '未配置',
    )
  })
})

describe('model center Provider directory', () => {
  const providers = [
    provider({
      providerID: 'openai',
      displayName: 'OpenAI',
      providerKind: 'custom',
    }),
    provider({
      providerID: 'vercel',
      displayName: 'AI Gateway',
      gatewaySource: true,
    }),
    provider({ providerID: 'local', displayName: '本地模型' }),
  ]

  test('searches name, id and Pi catalog source', () => {
    expect(
      projectProviderDirectory(providers, { query: 'OpenAI' }).map(
        (item) => item.provider.providerID,
      ),
    ).toEqual(['openai'])
    expect(
      projectProviderDirectory(providers, { query: 'gateway' }).map(
        (item) => item.provider.providerID,
      ),
    ).toEqual(['vercel'])
    expect(
      projectProviderDirectory(providers, { query: '自定义' }).map(
        (item) => item.provider.providerID,
      ),
    ).toEqual(['openai'])
    expect(
      projectProviderDirectory(providers, { query: '内置' }).map(
        (item) => item.provider.providerID,
      ),
    ).toEqual(['local'])
  })

  test('supports filtering by configured and unconfigured status', () => {
    const all = projectProviderDirectory(providers, {
      filter: 'all',
      apiKeys: keys,
    })
    expect(all).toHaveLength(3)

    const configured = projectProviderDirectory(providers, {
      filter: 'configured',
      apiKeys: keys,
    })
    expect(configured.map((item) => item.provider.providerID)).toEqual(['openai'])

    const unconfigured = projectProviderDirectory(providers, {
      filter: 'unconfigured',
      apiKeys: keys,
    })
    expect(unconfigured.map((item) => item.provider.providerID)).toEqual(['vercel', 'local'])
  })

  test('projects current and stored Key status', () => {
    const projected = projectProviderDirectory(providers, {
      currentProviderId: 'openai',
      apiKeys: keys,
    })

    expect(projected[0]).toMatchObject({
      current: true,
      connectionStatus: 'stored-key',
      statuses: ['current', 'stored-key'],
    })
    expect(projected[1]).toMatchObject({ current: false, connectionStatus: 'unconfigured' })
  })

  test('keeps a provider configured when its saved Key is disabled', () => {
    const projected = projectProviderDirectory(providers, {
      apiKeys: [
        apiKey({
          id: 'disabled',
          providerId: 'openai',
          enabled: false,
        }),
      ],
    })

    expect(projected[0]?.connectionStatus).toBe('stored-key')
  })

  test('distinguishes OAuth, environment and configured connections', () => {
    const oauthProvider = provider({ providerID: 'oauth', displayName: 'OAuth' })
    const envProvider = provider({ providerID: 'env', displayName: 'Environment' })
    const configuredProvider = provider({
      providerID: 'configured',
      displayName: 'Configured',
      apiKeyConfigured: true,
    })
    const projected = projectProviderDirectory([oauthProvider, envProvider, configuredProvider], {
      credentials: [
        {
          id: 'credential',
          providerId: 'oauth',
          kind: 'oauth',
          label: 'OAuth',
          enabled: true,
          active: true,
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ] as never,
      currentProviderState: {
        selectedProviderID: 'env',
        provider: envProvider,
        model: 'model',
        apiKeyConfigured: true,
        apiKeySource: 'ENV_API_KEY',
        modelConfigured: true,
        models: ['model'],
      },
    })

    expect(projected.map((item) => item.connectionStatus)).toEqual([
      'oauth',
      'environment',
      'configured',
    ])
  })
})

describe('provider sidebar grouping', () => {
  test('groups only configured connections; saved custom configuration alone is insufficient', () => {
    const items = projectProviderDirectory(
      [
        provider({ providerID: 'unconfigured' }),
        provider({ providerID: 'environment', apiKeyConfigured: true }),
        provider({ providerID: 'stored' }),
        provider({
          providerID: 'custom',
          providerKind: 'custom',
          config: { kind: 'custom' } as DesktopModelProviderSummary['config'],
        }),
      ],
      { apiKeys: [apiKey({ providerId: 'stored', enabled: false })] },
    )
    expect(
      items.filter(isConfiguredProviderDirectoryItem).map((item) => item.provider.providerID),
    ).toEqual(['environment', 'stored'])
  })

  test('downloaded directory defaults stay unconfigured until a provider credential is added', () => {
    const directoryProviders = ['models-dev', 'pi-remote'].map((directorySource) => ({
      ...provider({ providerID: directorySource, displayName: directorySource }),
      config: { kind: 'custom', directorySource, auth: 'api-key', baseUrl: 'https://vendor.example/v1' },
    })) as DesktopModelProviderSummary[]
    const before = projectProviderDirectory(directoryProviders)
    expect(before.map(isConfiguredProviderDirectoryItem)).toEqual([false, false])
    expect(projectProviderDirectory(directoryProviders, { filter: 'configured' })).toEqual([])
    const after = projectProviderDirectory(directoryProviders, {
      apiKeys: [apiKey({ id: 'directory-key', providerId: 'models-dev' })],
    })
    expect(after.map(isConfiguredProviderDirectoryItem)).toEqual([true, false])
  })
})

describe('model center API Key helpers', () => {
  test('filters by provider, query and health status', () => {
    expect(filterApiKeys(keys, { providerId: 'openai' }).map((key) => key.id)).toEqual([
      'primary',
      'backup',
    ])
    expect(filterApiKeys(keys, { query: 'a9k2' }).map((key) => key.id)).toEqual(['primary'])
    expect(filterApiKeys(keys, { query: '当前', health: 'healthy' }).map((key) => key.id)).toEqual([
      'primary',
    ])
    expect(filterApiKeys(keys, { health: 'rate-limited' }).map((key) => key.id)).toEqual([
      'anthropic',
    ])
  })

  test('does not auto-select a replacement when deleting the active Key', () => {
    const confirmation = getApiKeyDeleteConfirmation(keys[0]!, keys, 'OpenAI')

    expect(confirmation.description).toContain('不会自动切换其他凭据')
  })

  test('warns that provider becomes unconfigured without a backup', () => {
    const confirmation = getApiKeyDeleteConfirmation(keys[0]!, [keys[0]!], 'OpenAI')

    expect(confirmation.description).toContain('等待你手动选择活动凭据')
  })
})

function apiKey(
  overrides: Partial<DesktopApiKeySummary> & Pick<DesktopApiKeySummary, 'id' | 'providerId'>,
): DesktopApiKeySummary {
  return {
    id: overrides.id,
    providerId: overrides.providerId,
    label: 'API Key',
    maskedValue: '••••0000',
    enabled: true,
    active: false,
    priority: 0,
    health: { status: 'untested' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function provider(overrides: {
  providerID: string
  displayName: string
  providerKind?: 'builtin' | 'custom'
  gatewaySource?: boolean
  catalogOrigin?: 'user' | 'pi-bundled'
  apiKeyConfigured?: boolean
}) {
  return {
    kind: 'builtin',
    defaultModels: [],
    apiKeyConfigured: false,
    ...overrides,
  }
}

test('模型按 ID 前缀分组，不修改模型数据和顺序', () => {
  const models = [{ id: 'chat' }, { id: 'remote/a' }, { id: 'remote/b' }, { id: 'other/c' }]
  expect(groupProviderModels(models, 'magpie')).toEqual([
    { id: 'magpie', models: [models[0]] },
    { id: 'remote', models: [models[1], models[2]] },
    { id: 'other', models: [models[3]] },
  ])
})

test('自定义分组优先，清空后恢复 ID 分组，品牌与 ID 不受影响', () => {
  const models = [{ id: 'remote/deepseek', group: '常用' }, { id: 'remote/claude', group: '常用' }, { id: 'chat', group: ' ' }]
  expect(groupProviderModels(models, 'magpie')).toEqual([
    { id: '常用', models: [models[0], models[1]] },
    { id: 'magpie', models: [models[2]] },
  ])
  expect(groupProviderModels([{ ...models[0], group: '' }], 'magpie')[0]?.id).toBe('remote')
  expect(models[0]?.id).toBe('remote/deepseek')
})
