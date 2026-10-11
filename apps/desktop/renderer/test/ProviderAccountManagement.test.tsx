import { describe, expect, test } from 'bun:test'
import type { UsageSourceDescriptor } from '@pidex/agent-protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesktopModelProviderSummary } from '../shared/Types.js'
import {
  ProviderCatalog,
  type ProviderCatalogItem,
} from '../src/features/models/ProviderCatalog.js'
import { getProviderConnectionChoices } from '../src/features/models/provider-management/ProviderConnectionDialog.js'
import {
  ProviderCredentialUsageCard,
  envInferenceConnections,
} from '../src/features/models/provider-management/ProviderConnectionSection.js'
import type {
  ProviderConnection,
  ProviderUsageSource,
} from '../src/features/provider-management/index.js'

describe('model center account management', () => {
  test('OpenAI 同时提供 ChatGPT 登录和 API Key，选项 ID 独立', () => {
    const provider: DesktopModelProviderSummary = {
      ...modelProvider('openai', 'OpenAI'),
      authMethods: ['api-key', 'oauth'],
    }
    const choices = getProviderConnectionChoices(provider, [])
    expect(choices.map((choice) => choice.kind)).toEqual(['inference-oauth', 'inference-key'])
    expect(new Set(choices.map((choice) => choice.id)).size).toBe(2)
    expect(
      getProviderConnectionChoices({ ...provider, authMethods: ['api-key'] }, []).map(
        (choice) => choice.kind,
      ),
    ).toEqual(['inference-key'])
    expect(
      getProviderConnectionChoices({ ...provider, authMethods: ['oauth'] }, []).map(
        (choice) => choice.kind,
      ),
    ).toEqual(['inference-oauth'])
  })

  test('offers billing and OAuth choices while configured catalog cards link to accounts', () => {
    const choices = getProviderConnectionChoices(
      { ...modelProvider('anthropic', 'Anthropic'), authMethods: ['oauth'] },
      [billingSource(), subscriptionSource()],
    )
    expect(choices.map((choice) => choice.kind)).toEqual([
      'inference-oauth',
      'billing',
      'usage-oauth',
    ])

    const html = renderToStaticMarkup(
      <ProviderCatalog
        providers={[
          { ...catalogItem('openai', false), logoURL: '/favicon.png' },
          catalogItem('anthropic', true),
        ]}
        query=""
        onAddConnection={() => {}}
        onManageConnection={() => {}}
        onQueryChange={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(html).not.toContain('<h2>供应商</h2>')
    expect(html).not.toContain('浏览完整目录')
    expect(html).not.toContain('model-center-catalog-source')
    expect(html).toContain('2 个')
    expect(html).toContain('>查看<')
    expect(html).toContain('>连接<')
    expect(html).toMatch(
      /<span class="provider-card-logo settings-management-row-icon"><span class="ui-remote-image\b/,
    )
    expect(html).not.toContain('class="ui-remote-image provider-card-logo"')
    expect(html.match(/class="provider-card-logo settings-management-row-icon"/g)).toHaveLength(2)
  })

  test('模型卡标题仅由独立 disclosure button 控制展开', async () => {
    const source = await Bun.file(
      new URL(
        '../src/features/models/provider-management/ProviderEditorDialog.tsx',
        import.meta.url,
      ),
    ).text()

    // 外观已迁到 Tailwind utility，断言只锁定“标题按钮独立于头部”这一结构契约。
    expect(source).toMatch(/<div\s+className="provider-editor-model-card-header[^"]*"\s*>/)
    expect(source).toMatch(
      /<button\s+aria-controls=\{contentId\}\s+aria-expanded=\{expanded\}\s+className=\{?["']?provider-editor-model-card-summary/,
    )
    expect(source).toMatch(
      /<\/button>\s+<div className="provider-editor-model-card-controls[^"]*">/,
    )
    expect(source).not.toContain('onClick={event => event.stopPropagation()}')
    expect(source).toContain('mountPolicy="always"')
    expect(source).toContain('const [expanded, setExpanded] = useState(defaultExpanded)')
  })
})

describe('provider connection environment and balance', () => {
  test('环境变量推理凭据只取 credential 来源，用量来源环境连接留在用量区', () => {
    const connections = [
      connection({
        id: 'env:deepseek:DEEPSEEK_API_KEY',
        kind: 'env',
        origin: 'credential',
        label: 'DEEPSEEK_API_KEY',
      }),
      connection({
        id: 'usage-source:deepseek-balance',
        kind: 'env',
        origin: 'usage-source',
        label: 'DeepSeek 余额',
      }),
      connection({ id: 'credential:oauth', kind: 'oauth', origin: 'credential', label: 'OAuth' }),
    ]

    expect(envInferenceConnections(connections).map((item) => item.id)).toEqual([
      'env:deepseek:DEEPSEEK_API_KEY',
    ])
  })

  test('复用供应商 API Key 的余额来源渲染实际余额而不是 0', () => {
    const html = renderToStaticMarkup(
      <ProviderCredentialUsageCard
        descriptor={providerCredentialSource()}
        loading={false}
        onRefresh={() => {}}
        result={usageResult()}
      />,
    )

    expect(html).toContain('复用供应商 API Key')
    expect(html).toContain('DeepSeek 余额')
    expect(html).toContain('CNY 账户余额')
    expect(html).toContain('123.45')
  })

  test('余额查询中与查询失败分别展示状态，不把未知余额显示为 0', () => {
    const loading = renderToStaticMarkup(
      <ProviderCredentialUsageCard
        descriptor={providerCredentialSource()}
        loading
        onRefresh={() => {}}
        result={undefined}
      />,
    )
    expect(loading).toContain('正在查询余额。')
    expect(loading).not.toContain('CNY 账户余额')

    const failed = renderToStaticMarkup(
      <ProviderCredentialUsageCard
        descriptor={providerCredentialSource()}
        loading={false}
        onRefresh={() => {}}
        result={usageResult({
          status: 'unavailable',
          error: { category: 'network', message: '查询失败', retryable: true },
        })}
      />,
    )
    expect(failed).toContain('查询失败')
  })
})

function connection(input: {
  id: string
  kind: ProviderConnection['kind']
  origin: ProviderConnection['origin']
  label: string
}): ProviderConnection {
  return {
    id: input.id,
    kind: input.kind,
    origin: input.origin,
    providerIds: ['deepseek'],
    label: input.label,
    active: true,
    enabled: true,
  }
}

function providerCredentialSource(): UsageSourceDescriptor {
  return {
    sourceId: 'deepseek-balance',
    canonicalProviderId: 'deepseek',
    providerIds: ['deepseek'],
    displayName: 'DeepSeek 余额',
    scope: 'account',
    stability: 'official',
    availability: 'queryable',
    capabilities: ['balance'],
    queryPolicy: 'cached',
    connection: { kind: 'provider-key', disconnectible: false },
    connectionMethod: { kind: 'provider-credential' },
  } as UsageSourceDescriptor
}

function usageResult(overrides: Partial<ProviderUsageSource> = {}): ProviderUsageSource {
  return {
    sourceId: 'deepseek-balance',
    providerIds: ['deepseek'],
    displayName: 'DeepSeek 余额',
    scope: 'account',
    stability: 'official',
    status: 'available',
    checkedAt: 1_700_000_000_000,
    connection: { kind: 'provider-key', disconnectible: false },
    groups: [
      {
        id: 'balance',
        label: '余额',
        balances: [{ currency: 'CNY', total: '123.45', components: [] }],
        quotaWindows: [],
      },
    ],
    ...overrides,
  } as ProviderUsageSource
}

function billingSource(): UsageSourceDescriptor {
  return source({
    sourceId: 'anthropic-admin',
    displayName: 'Anthropic Admin',
    connectionMethod: {
      kind: 'billing-key',
      sourceId: 'anthropic-admin',
      fields: [
        {
          name: 'key',
          label: 'Admin Key',
          secret: true,
          required: true,
        },
      ],
    },
  })
}

function subscriptionSource(): UsageSourceDescriptor {
  return source({
    sourceId: 'anthropic-subscription',
    displayName: 'Claude 订阅',
    connectionMethod: {
      kind: 'oauth',
      integrationId: 'usage.anthropic.subscription',
      methodId: 'claude-subscription-browser',
    },
  })
}

function source(input: {
  sourceId: string
  displayName: string
  connectionMethod: UsageSourceDescriptor['connectionMethod']
}): UsageSourceDescriptor {
  return {
    sourceId: input.sourceId,
    canonicalProviderId: 'anthropic',
    providerIds: ['anthropic'],
    displayName: input.displayName,
    scope: 'account',
    stability: 'official',
    availability: 'queryable',
    capabilities: ['balance'],
    queryPolicy: 'cached',
    connection: { kind: 'none', disconnectible: false },
    connectionMethod: input.connectionMethod,
  } as UsageSourceDescriptor
}

function catalogItem(id: string, canAddConnection: boolean): ProviderCatalogItem {
  return {
    id,
    name: id,
    source: '内置',
    modelCount: 1,
    current: false,
    canAddConnection,
    status: {
      label: canAddConnection ? '未配置' : '已配置',
      tone: canAddConnection ? 'neutral' : 'positive',
    },
  }
}

function modelProvider(providerID: string, displayName: string): DesktopModelProviderSummary {
  return {
    providerID,
    displayName,
    kind: 'builtin',
    defaultModels: [],
    apiKeyConfigured: true,
  }
}
