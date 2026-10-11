import { describe, expect, it } from 'bun:test'
import type { RpcResult, UsageSourceDescriptor } from '@pidex/agent-protocol'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { UsageBillingSettings } from '../src/features/settings/UsageBillingSettings.js'
import { ApplicationUsagePanel } from '../src/features/settings/usage/ApplicationUsagePanel.js'
import { ProviderUsagePanel } from '../src/features/settings/usage/ProviderUsagePanel.js'
import {
  protocolModelId,
  protocolProviderId,
  sumDecimalAmounts,
  type ProviderUsageSource,
} from '../src/utils/UsageFormatters.js'

function descriptor({
  sourceId,
  displayName,
  providerId,
  capabilities = ['usage', 'cost'],
  availability = 'queryable',
  queryPolicy = 'cached',
}: {
  sourceId: string
  displayName: string
  providerId: string
  capabilities?: UsageSourceDescriptor['capabilities']
  availability?: UsageSourceDescriptor['availability']
  queryPolicy?: UsageSourceDescriptor['queryPolicy']
}): UsageSourceDescriptor {
  return {
    sourceId,
    canonicalProviderId: protocolProviderId(providerId),
    providerIds: [protocolProviderId(providerId)],
    displayName,
    scope: 'organization',
    stability: 'official',
    availability,
    capabilities,
    queryPolicy,
    connection: {
      kind: 'provider-key',
      disconnectible: false,
    },
    connectionMethod: { kind: 'provider-credential' },
  }
}

function source({
  sourceId,
  displayName,
  providerId,
  costs = [],
  error,
}: {
  sourceId: string
  displayName: string
  providerId: string
  costs?: Array<{ currency: string; amount: string }>
  error?: ProviderUsageSource['error']
}): ProviderUsageSource {
  return {
    sourceId,
    providerIds: [protocolProviderId(providerId)],
    displayName,
    scope: 'organization',
    stability: 'official',
    status: error ? 'unavailable' : 'available',
    checkedAt: 1_722_000_000_000,
    connection: {
      kind: 'provider-key',
      disconnectible: false,
    },
    groups: [
      {
        id: `${sourceId}-usage`,
        label: '组织用量',
        balances: [
          {
            currency: 'USD',
            total: '999',
            components: [],
          },
        ],
        quotaWindows: [
          {
            id: 'monthly-quota',
            label: '月度额度',
            unit: 'tokens',
            remainingPercent: 75,
            resetsAt: Date.now() + 3600_000 * 5,
            state: 'normal',
          },
        ],
        totals: {
          inputTokens: 800,
          outputTokens: 200,
          cachedTokens: 100,
          requests: 4,
          costs,
        },
        series: [
          {
            date: '2026-07-26',
            inputTokens: 800,
            outputTokens: 200,
            cachedTokens: 100,
            requests: 4,
            costs,
          },
        ],
        breakdown: [
          {
            id: 'model-a',
            label: 'Model A',
            kind: 'model',
            inputTokens: 800,
            outputTokens: 200,
            cachedTokens: 100,
            requests: 4,
          },
        ],
      },
    ],
    ...(error ? { error } : {}),
  }
}

describe('usage billing renderer', () => {
  it('exposes application and account analytics tabs', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <UsageBillingSettings />
      </MemoryRouter>,
    )
    expect(html).toContain('role="tablist"')
    expect(html).toContain('应用用量')
    expect(html).toContain('账户用量与成本')
    expect(html).toContain('用量与成本')
  })

  it('renders the application metrics with provider model links', () => {
    const data: RpcResult<'usage/local/get'> = {
      range: '30d',
      timeZone: 'Asia/Shanghai',
      generatedAt: 1_722_000_000_000,
      totals: {
        inputTokens: 800,
        outputTokens: 200,
        cachedTokens: 100,
        totalTokens: 1_100,
        estimatedCostUsd: '0.25',
        rootTasks: 2,
        modelResponses: 4,
        providerCalls: 5,
        activeDays: 1,
        currentStreak: 1,
        longestStreak: 1,
      },
      daily: [
        {
          date: '2026-07-26',
          totals: {
            inputTokens: 800,
            outputTokens: 200,
            cachedTokens: 100,
            totalTokens: 1_100,
            estimatedCostUsd: '0.25',
          },
          models: [
            {
              providerId: protocolProviderId('deepseek'),
              modelId: protocolModelId('deepseek-chat'),
              displayName: 'DeepSeek Chat',
              inputTokens: 800,
              outputTokens: 200,
              cachedTokens: 100,
              totalTokens: 1_100,
              estimatedCostUsd: '0.25',
              modelResponses: 4,
            },
          ],
        },
      ],
      models: [
        {
          providerId: protocolProviderId('deepseek'),
          modelId: protocolModelId('deepseek-chat'),
          displayName: 'DeepSeek Chat',
          inputTokens: 800,
          outputTokens: 200,
          cachedTokens: 100,
          totalTokens: 1_100,
          estimatedCostUsd: '0.25',
          modelResponses: 4,
          sharePercent: 100,
        },
      ],
      heatmap: [
        {
          date: '2026-07-26',
          totalTokens: 1_100,
          modelResponses: 4,
        },
      ],
    }
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ApplicationUsagePanel
          data={data}
          error={null}
          loading={false}
          onRangeChange={() => undefined}
          onRefresh={() => undefined}
          range="30d"
        />
      </MemoryRouter>,
    )
    expect(html).toContain('最近 30 天')
    expect(html).toContain('总 Token')
    expect(html).toContain('根任务数')
    expect(html).toContain('Provider 调用')
    expect(html).toContain('/settings/providers?provider=deepseek')
  })

  it('renders usage, cost, balance, and quota data with metered warning and repair links', () => {
    const vercelDescriptor = descriptor({
      sourceId: 'vercel-ai-gateway',
      displayName: 'Vercel AI Gateway',
      providerId: 'vercel',
      queryPolicy: 'metered',
    })
    const failedDescriptor = descriptor({
      sourceId: 'openai-admin',
      displayName: 'OpenAI Admin',
      providerId: 'openai',
    })
    const sources = [
      source({
        sourceId: 'vercel-ai-gateway',
        displayName: 'Vercel AI Gateway',
        providerId: 'vercel',
        costs: [{ currency: 'USD', amount: '1.25' }],
      }),
      source({
        sourceId: 'openai-admin',
        displayName: 'OpenAI Admin',
        providerId: 'openai',
        error: {
          category: 'permission',
          message: '当前管理凭据缺少读取权限。',
          retryable: false,
        },
      }),
    ]
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProviderUsagePanel
          data={{
            range: '7d',
            timeZone: 'Asia/Shanghai',
            generatedAt: 1_722_000_000_000,
            sources,
          }}
          descriptors={[vercelDescriptor, failedDescriptor]}
          error={null}
          loading={false}
          onClearFilter={() => undefined}
          onRefresh={() => undefined}
        />
      </MemoryRouter>,
    )
    expect(html).toContain('Reporting API 为计费查询')
    expect(html).toContain('一小时缓存')
    expect(html).toContain('总 Token')
    expect(html).toContain('USD 成本')
    expect(html).toContain('修复账户连接')
    expect(html).toContain('USD 账户余额')
    expect(html).toContain('$999.00')
    expect(html).toContain('月度额度')
    expect(html).toContain('剩余 75%')
    expect(html).toContain('后重置')
    expect(html).toContain('Vercel AI Gateway 时间范围')
    expect(html).toContain('刷新全部')
    expect(html).not.toContain('账户用量时间范围')
    expect(html).not.toContain('连接管理凭据')
  })

  it('keeps currencies separate, renders balance-only sources, and omits unsupported providers', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ProviderUsagePanel
          data={{
            range: '7d',
            timeZone: 'Asia/Shanghai',
            generatedAt: 1_722_000_000_000,
            sources: [
              source({
                sourceId: 'source-a',
                displayName: 'Source A',
                providerId: 'openai',
                costs: [{ currency: 'USD', amount: '0.1' }],
              }),
              source({
                sourceId: 'source-b',
                displayName: 'Source B',
                providerId: 'anthropic',
                costs: [
                  { currency: 'USD', amount: '0.2' },
                  { currency: 'CNY', amount: '1.5' },
                ],
              }),
              {
                sourceId: 'deepseek',
                providerIds: [protocolProviderId('deepseek')],
                displayName: 'DeepSeek 余额',
                scope: 'api-key',
                stability: 'official',
                status: 'available',
                checkedAt: 1_722_000_000_000,
                connection: { kind: 'provider-key', disconnectible: false },
                groups: [
                  {
                    id: 'account',
                    label: '账户余额',
                    balances: [
                      {
                        currency: 'CNY',
                        total: '88.5',
                        components: [
                          { label: '充值余额', amount: '60' },
                          { label: '赠送余额', amount: '28.5' },
                        ],
                      },
                    ],
                    quotaWindows: [],
                  },
                ],
              },
            ],
          }}
          descriptors={[
            descriptor({
              sourceId: 'source-a',
              displayName: 'Source A',
              providerId: 'openai',
            }),
            descriptor({
              sourceId: 'source-b',
              displayName: 'Source B',
              providerId: 'anthropic',
            }),
            descriptor({
              sourceId: 'deepseek',
              displayName: 'DeepSeek 余额',
              providerId: 'deepseek',
              capabilities: ['balance'],
            }),
            descriptor({
              sourceId: 'groq-console',
              displayName: 'Groq',
              providerId: 'groq',
              capabilities: [],
              availability: 'unsupported',
            }),
          ]}
          error={null}
          loading={false}
          onClearFilter={() => undefined}
          onRefresh={() => undefined}
        />
      </MemoryRouter>,
    )
    expect(html).toContain('$0.30')
    expect(html).toContain('¥1.50')
    expect(html).toContain('Source A 时间范围')
    expect(html).toContain('Source B 时间范围')
    expect(html).not.toContain('DeepSeek 余额 时间范围')
    expect(html).toContain('DeepSeek 余额')
    expect(html).toContain('CNY 账户余额')
    expect(html).toContain('¥88.50')
    expect(html).toContain('充值余额')
    expect(html).toContain('¥60.00')
    expect(html).toContain('赠送余额')
    expect(html).toContain('¥28.50')
    expect(html).not.toContain('Groq')
    expect(html).not.toContain('暂不可查询历史用量')
    expect(html).not.toContain('其他可连接厂商')
  })

  it('sums decimal amounts without floating-point drift', () => {
    expect(sumDecimalAmounts(['0.1', '0.2', '10.000'])).toBe('10.3')
    expect(sumDecimalAmounts([])).toBe('0')
  })
})
