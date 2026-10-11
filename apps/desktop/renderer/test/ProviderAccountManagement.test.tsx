import { describe, expect, test } from 'bun:test'
import type { UsageSourceDescriptor } from '@pidex/agent-protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DesktopModelProviderSummary } from '../shared/Types.js'
import {
  ProviderCatalog,
  type ProviderCatalogItem,
} from '../src/features/models/ProviderCatalog.js'
import { getProviderConnectionChoices } from '../src/features/models/provider-management/ProviderConnectionDialog.js'

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
