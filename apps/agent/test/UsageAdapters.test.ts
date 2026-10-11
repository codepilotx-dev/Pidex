import { describe, expect, test } from 'bun:test'
import { Credential } from '@pidex/model-schema'
import { providerUsageAdapters } from '../src/usage/Adapters'
import type { UsageQueryContext } from '../src/usage/Types'

const credential = {
  value: Credential.Key.make({ type: 'key', key: 'secret' }),
  connection: { kind: 'provider-key' as const, maskedValue: '••••cret', disconnectible: false },
}

const context = (
  response: unknown,
  onRequest?: (url: string, init?: RequestInit) => void,
): UsageQueryContext => ({
  range: '7d',
  timeZone: 'Asia/Shanghai',
  force: false,
  now: Date.UTC(2026, 2, 9, 0, 30),
  providers: [],
  credential: async () => credential,
  billingCredential: async () => credential,
  connection: async () => credential.connection,
  billingConnection: async () => credential.connection,
  request: async (url, init) => {
    onRequest?.(url, init)
    return response
  },
})

describe('provider usage adapters', () => {
  test('DeepSeek 解析多币种余额且只请求固定官方 origin', async () => {
    const source = providerUsageAdapters.find((item) => item.sourceId === 'deepseek')!
    let requested = ''
    const result = await source.query(
      context(
        {
          is_available: true,
          balance_infos: [
            {
              currency: 'CNY',
              total_balance: '10.5',
              topped_up_balance: '8',
              granted_balance: '2.5',
            },
            { currency: 'USD', total_balance: '1', topped_up_balance: '1', granted_balance: '0' },
          ],
        },
        (url) => {
          requested = url
        },
      ),
    )
    expect(requested).toBe('https://api.deepseek.com/user/balance')
    expect(result.groups[0]?.balances.map((item) => item.currency)).toEqual(['CNY', 'USD'])
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  test('MiniMax 同时解析 normal、exhausted、unlimited 和周加成', async () => {
    const source = providerUsageAdapters.find((item) => item.sourceId === 'minimax-token-plan')!
    let requested = ''
    const result = await source.query(
      context(
        {
          base_resp: { status_code: 0 },
          model_remains: [
            {
              model_name: 'general',
              current_interval_total_count: 0,
              current_interval_usage_count: 0,
              current_interval_remaining_percent: 55,
              current_interval_status: 1,
              end_time: 1_800_000_000,
              current_weekly_total_count: 0,
              current_weekly_usage_count: 0,
              current_weekly_remaining_percent: 79,
              current_weekly_status: 1,
              weekly_end_time: 1_800_100_000,
              weekly_boost_permille: 100,
            },
            {
              model_name: 'video',
              current_interval_total_count: 3,
              current_interval_usage_count: 1,
              current_interval_remaining_percent: 66,
              current_interval_status: 1,
            },
            {
              model_name: 'exhausted',
              current_interval_total_count: 0,
              current_interval_usage_count: 0,
              current_interval_remaining_percent: 0,
              current_interval_status: 1,
            },
            {
              model_name: 'status-2-exhausted',
              current_interval_total_count: 0,
              current_interval_usage_count: 0,
              current_interval_remaining_percent: 0,
              current_interval_status: 2,
              end_time: 1_800_000_000,
            },
            {
              model_name: 'not-in-plan',
              current_interval_total_count: 0,
              current_interval_usage_count: 0,
              current_interval_remaining_percent: 100,
              current_interval_status: 3,
            },
          ],
        },
        (url) => {
          requested = url
        },
      ),
    )
    expect(requested).toBe('https://www.minimax.io/v1/token_plan/remains')
    expect(result.groups[0]?.quotaWindows.map((item) => item.state)).toEqual(['normal', 'normal'])
    expect(result.groups[0]?.quotaWindows[0]?.remainingPercent).toBe(55)
    expect(result.groups[0]?.quotaWindows[0]?.limit).toBeUndefined()
    expect(result.groups[0]?.quotaWindows[1]?.label).toContain('+10%')
    expect(result.groups[0]?.quotaWindows[1]?.remainingPercent).toBe(79)
    expect(result.groups[1]?.quotaWindows[0]?.limit).toBe(3)
    expect(result.groups[1]?.quotaWindows[0]?.used).toBe(1)
    expect(result.groups[1]?.quotaWindows[0]?.remaining).toBe(2)
    expect(result.groups[2]?.quotaWindows[0]?.state).toBe('exhausted')
    expect(result.groups[3]?.quotaWindows[0]?.state).toBe('exhausted')
    expect(result.groups[3]?.quotaWindows[0]?.resetsAt).toBe(1_800_000_000_000)
    expect(result.groups[4]).toBeUndefined() // not-in-plan (status 3) is omitted
  })

  test('Kimi Code 识别官方 TIME_UNIT 窗口', async () => {
    const source = providerUsageAdapters.find((item) => item.sourceId === 'kimi-code')!
    const result = await source.query(
      context({
        usage: { limit: 1000, used: 100, remaining: 900 },
        limits: [
          {
            window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
            detail: { limit: 100, used: 20, remaining: 80 },
          },
          {
            window: { duration: 7, timeUnit: 'TIME_UNIT_DAY' },
            detail: { limit: 700, used: 100, remaining: 600 },
          },
        ],
      }),
    )
    expect(result.groups[0]?.quotaWindows.map((item) => item.label)).toEqual([
      '套餐总览',
      '5 小时',
      '每周',
    ])
    expect(result.groups[0]?.quotaWindows.every((item) => item.unit === 'requests')).toBe(true)
  })

  test('OpenRouter Management 使用精确十进制字符串计算余额', async () => {
    const source = providerUsageAdapters.find((item) => item.sourceId === 'openrouter-management')!
    const result = await source.query(
      context({
        data: {
          total_credits: '999999999999999999999.01',
          total_usage: '0.001',
        },
      }),
    )
    expect(result.groups[0]?.balances[0]?.total).toBe('999999999999999999999.009')
  })

  test('Vercel 仅执行单次官方 Reporting 查询并声明一小时缓存/计费提示', async () => {
    const source = providerUsageAdapters.find((item) => item.sourceId === 'vercel-ai-gateway')!
    let calls = 0
    const result = await source.query(
      context(
        {
          results: [
            {
              model: 'model-a',
              total_cost: '0.0000000000001',
              input_tokens: 1,
              output_tokens: 2,
              cached_input_tokens: 3,
              cache_creation_input_tokens: 4,
              request_count: 1,
            },
          ],
        },
        () => {
          calls += 1
        },
      ),
    )
    expect(source.cacheMs).toBe(60 * 60_000)
    expect(calls).toBe(1)
    expect(result.groups[0]?.label).toContain('查询可能产生费用')
    expect(result.groups[0]?.totals?.costs).toEqual([
      { currency: 'USD', amount: '0.0000000000001' },
    ])
  })

  test('Fireworks 对账户和 quota 完整分页，并正确拼接 account id', async () => {
    const source = providerUsageAdapters.find((item) => item.sourceId === 'fireworks-quotas')!
    const requested: string[] = []
    const ctx = context({})
    ctx.request = async (url) => {
      requested.push(url)
      if (url.includes('/accounts?') && !url.includes('pageToken=')) {
        return {
          accounts: [{ name: 'accounts/a', displayName: 'A' }],
          nextPageToken: 'accounts-next',
        }
      }
      if (url.includes('/accounts?') && url.includes('pageToken=accounts-next')) {
        return { accounts: [{ name: 'accounts/b', displayName: 'B' }] }
      }
      if (url.includes('/accounts/a/quotas') && !url.includes('pageToken=')) {
        return {
          quotas: [{ name: 'requests', maxValue: '100', usage: 10 }],
          nextPageToken: 'quota-next',
        }
      }
      if (url.includes('/accounts/a/quotas') && url.includes('pageToken=quota-next')) {
        return { quotas: [{ name: 'tokens', maxValue: '200', usage: 20 }] }
      }
      if (url.includes('/accounts/b/quotas')) return { quotas: [] }
      throw new Error(`unexpected URL ${url}`)
    }
    const result = await source.query(ctx)
    expect(result.groups.map((group) => group.id)).toEqual(['accounts/a', 'accounts/b'])
    expect(result.groups[0]?.quotaWindows).toHaveLength(2)
    expect(requested.some((url) => url.includes('/v1/accounts/a/quotas'))).toBe(true)
    expect(requested.every((url) => !url.includes('/accounts/accounts/'))).toBe(true)
  })

  test('Cloudflare 读取独立 Account ID 并生成 billing series', async () => {
    const source = providerUsageAdapters.find((item) => item.sourceId === 'cloudflare-ai-gateway')!
    const ctx = context({})
    ctx.billingCredential = async () => ({
      value: Credential.Key.make({
        type: 'key',
        key: 'cf-secret',
        metadata: { accountId: 'account-1' },
      }),
      connection: { kind: 'billing-key', disconnectible: true },
    })
    ctx.request = async (url) => {
      if (url.endsWith('/credit-balance')) return { success: true, result: { balance: 12.5 } }
      if (url.includes('/usage-history?')) {
        const parsed = new URL(url)
        expect(parsed.searchParams.get('value_grouping_window')).toBe('day')
        expect(parsed.searchParams.get('start_time')).toBeTruthy()
        expect(parsed.searchParams.get('end_time')).toBeTruthy()
        return {
          success: true,
          result: {
            history: [
              {
                id: 'one',
                aggregated_value: 2.5,
                start_time: '2026-03-08T00:00:00Z',
                end_time: '2026-03-09T00:00:00Z',
              },
            ],
          },
        }
      }
      if (url.endsWith('/spending-limit'))
        return {
          success: true,
          result: { enabled: true, config: { amount: 10, duration: 'month', strategy: 'block' } },
        }
      throw new Error(`unexpected URL ${url}`)
    }
    const result = await source.query(ctx)
    expect(result.groups[0]?.balances[0]?.total).toBe('12.5')
    expect(result.groups[0]?.series?.[0]).toMatchObject({
      date: '2026-03-08',
      costs: [{ currency: 'USD', amount: '2.5' }],
    })
  })

  test('xAI 按官方 analytics body 查询，cents 余额与十进制 USD 用量均保持精度', async () => {
    const source = providerUsageAdapters.find((item) => item.sourceId === 'xai-management')!
    const ctx = context({})
    ctx.billingCredential = async () => ({
      value: Credential.Key.make({
        type: 'key',
        key: 'xai-secret',
        metadata: { teamId: 'team-1' },
      }),
      connection: { kind: 'billing-key', disconnectible: true },
    })
    let usageBody: Record<string, unknown> | undefined
    ctx.request = async (url, init) => {
      if (url.endsWith('/prepaid/balance')) return { total: { val: '-1000' } }
      if (url.endsWith('/usage')) {
        usageBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return {
          timeSeries: [
            {
              group: {},
              dataPoints: [{ timestamp: '2026-03-08T00:00:00Z', values: [0.75973725] }],
            },
          ],
        }
      }
      if (url.endsWith('/postpaid/spending-limits')) {
        return { spendingLimits: { effectiveSl: { val: '5000' }, softSl: { val: '4000' } } }
      }
      throw new Error(`unexpected URL ${url}`)
    }
    const result = await source.query(ctx)
    expect(result.groups[0]?.balances[0]?.total).toBe('10')
    expect(result.groups[0]?.series?.[0]?.costs).toEqual([
      { currency: 'USD', amount: '0.75973725' },
    ])
    expect(usageBody).toMatchObject({
      analyticsRequest: {
        timeRange: { timezone: 'Asia/Shanghai' },
        timeUnit: 'TIME_UNIT_DAY',
        values: [{ name: 'usd', aggregation: 'AGGREGATION_SUM' }],
        groupBy: ['description'],
        filters: [],
      },
    })
  })

  test('其余余额、Admin 与实验来源可解析官方最小 fixture', async () => {
    const simpleFixtures: Record<string, unknown> = {
      'moonshot-balance': {
        code: 0,
        status: true,
        data: { available_balance: '10', voucher_balance: '2', cash_balance: '8' },
      },
      'siliconflow-balance': {
        data: { currency: 'USD', balance: '3', chargeBalance: '2', status: 'active' },
      },
      'openrouter-key': {
        data: {
          usage: 1,
          usage_daily: 0.1,
          usage_weekly: 0.5,
          usage_monthly: 1,
          limit: 10,
          limit_remaining: 9,
          limit_reset: 'monthly',
        },
      },
      'anthropic-subscription': {
        five_hour: { utilization: 20, resets_at: '2026-03-09T05:00:00Z' },
        seven_day: { utilization: 30, resets_at: '2026-03-10T00:00:00Z' },
      },
    }
    for (const [sourceId, fixture] of Object.entries(simpleFixtures)) {
      const source = providerUsageAdapters.find((item) => item.sourceId === sourceId)!
      expect((await source.query(context(fixture))).status).toBe('available')
    }

    for (const sourceId of ['openai-admin', 'anthropic-admin']) {
      const source = providerUsageAdapters.find((item) => item.sourceId === sourceId)!
      const ctx = context({})
      ctx.request = async (url) =>
        url.includes('cost')
          ? {
              data: [
                {
                  starting_at: '2026-03-08T00:00:00Z',
                  start_time: Date.UTC(2026, 2, 8) / 1000,
                  results:
                    sourceId === 'openai-admin'
                      ? [{ amount: { value: '0.01', currency: 'usd' } }]
                      : [{ amount: '1', currency: 'USD', description: 'messages' }],
                },
              ],
              has_more: false,
            }
          : {
              data: [
                {
                  starting_at: '2026-03-08T00:00:00Z',
                  start_time: Date.UTC(2026, 2, 8) / 1000,
                  results:
                    sourceId === 'openai-admin'
                      ? [
                          {
                            model: 'gpt',
                            input_tokens: 1,
                            output_tokens: 2,
                            input_cached_tokens: 3,
                            num_model_requests: 1,
                          },
                        ]
                      : [
                          {
                            model: 'claude',
                            uncached_input_tokens: 1,
                            output_tokens: 2,
                            cache_read_input_tokens: 3,
                            cache_creation: {},
                            requests: 1,
                          },
                        ],
                },
              ],
              has_more: false,
            }
      const result = await source.query(ctx)
      expect(result.status).toBe('available')
      expect(result.groups[0]?.series).toHaveLength(1)
    }

    const openai = providerUsageAdapters.find((item) => item.sourceId === 'openai-admin')!
    const openaiContext = context({})
    openaiContext.request = async (url) =>
      url.includes('cost')
        ? { data: [], has_more: false }
        : {
            data: [
              {
                start_time: Date.UTC(2026, 2, 7) / 1000,
                results: [
                  { model: 'gpt', input_tokens: 1, output_tokens: 2, num_model_requests: 1 },
                ],
              },
              {
                start_time: Date.UTC(2026, 2, 8) / 1000,
                results: [
                  { model: 'gpt', input_tokens: 3, output_tokens: 4, num_model_requests: 1 },
                ],
              },
            ],
            has_more: false,
          }
    expect((await openai.query(openaiContext)).groups[0]?.breakdown).toEqual([
      expect.objectContaining({
        id: 'gpt',
        inputTokens: 4,
        outputTokens: 6,
        requests: 2,
      }),
    ])

    const zai = providerUsageAdapters.find((item) => item.sourceId === 'zai-coding-plan')!
    const zaiContext = context({})
    zaiContext.request = async (url) =>
      url.includes('model-usage')
        ? { data: { list: [{ model: 'glm', inputTokens: 1, outputTokens: 2, requests: 1 }] } }
        : url.includes('tool-usage')
          ? { data: { list: [{ tool: 'search', count: 1 }] } }
          : {
              data: {
                limits: [
                  {
                    type: 'TOKENS_LIMIT',
                    unit: 3,
                    number: 5,
                    usage: 100,
                    currentValue: 20,
                    remaining: 80,
                    percentage: 20,
                  },
                ],
              },
            }
    expect((await zai.query(zaiContext)).groups[0]?.quotaWindows[0]).toMatchObject({
      label: '5 小时',
      limit: 100,
      used: 20,
      remaining: 80,
      remainingPercent: 80,
    })
  })

  test('Claude 未连接时不伪装成 OAuth connection', async () => {
    const source = providerUsageAdapters.find((item) => item.sourceId === 'anthropic-subscription')!
    const disconnected = context({})
    disconnected.billingCredential = async () => null
    const result = await source.query(disconnected)
    expect(result).toMatchObject({
      status: 'not-connected',
      connection: { kind: 'none', disconnectible: false },
    })
  })

  test('关键 envelope 缺失时标记 invalid-response 而不是伪造 available', async () => {
    for (const sourceId of [
      'deepseek',
      'minimax-token-plan',
      'moonshot-balance',
      'siliconflow-balance',
      'openrouter-key',
      'fireworks-quotas',
      'vercel-ai-gateway',
      'openai-admin',
      'anthropic-admin',
      'openrouter-management',
      'anthropic-subscription',
      'kimi-code',
      'zai-coding-plan',
    ]) {
      const source = providerUsageAdapters.find((item) => item.sourceId === sourceId)!
      await expect(source.query(context({}))).rejects.toMatchObject({
        category: 'invalid-response',
      })
    }
  })
})
