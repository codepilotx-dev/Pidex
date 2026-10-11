import { describe, expect, test } from 'bun:test'
import { Provider } from '@pidex/model-schema'
import { Schema } from 'effect'
import {
  BillingCredentialInputSchema,
  LocalUsageResultSchema,
  ProviderUsageSourceSchema,
  RpcMethods,
  UsageSourceDescriptorSchema,
} from '../src/methods/index'

const decodeExactParams = <M extends keyof typeof RpcMethods>(method: M, value: unknown) =>
  Schema.decodeUnknownSync(RpcMethods[method].params, { onExcessProperty: 'error' })(value)

const emptyLocalResult = {
  range: '30d',
  timeZone: 'UTC',
  generatedAt: 1,
  totals: {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: '0',
    rootTasks: 0,
    modelResponses: 0,
    providerCalls: 0,
    activeDays: 0,
    currentStreak: 0,
    longestStreak: 0,
  },
  daily: [],
  models: [],
  heatmap: [],
} as const

describe('usage RPC method contracts', () => {
  test('keeps source catalog params and result exact', () => {
    expect(decodeExactParams('usage/source/list', {})).toEqual({})
    expect(() => decodeExactParams('usage/source/list', { force: true })).toThrow()

    const providerId = Provider.ID.make('provider:fixture')
    const descriptor = {
      sourceId: 'openai-admin',
      canonicalProviderId: providerId,
      providerIds: [providerId],
      displayName: 'OpenAI Admin',
      scope: 'organization',
      stability: 'official',
      availability: 'queryable',
      capabilities: ['usage', 'cost'],
      queryPolicy: 'cached',
      connection: { kind: 'none', disconnectible: false },
      connectionMethod: {
        kind: 'billing-key',
        sourceId: 'openai-admin',
        fields: [{ name: 'key', label: 'Admin Key', secret: true, required: true }],
      },
    } as const
    expect(
      Schema.decodeUnknownSync(UsageSourceDescriptorSchema, {
        onExcessProperty: 'error',
      })(descriptor),
    ).toEqual(descriptor)
    expect(() =>
      Schema.decodeUnknownSync(UsageSourceDescriptorSchema, {
        onExcessProperty: 'error',
      })({ ...descriptor, envNames: ['OPENAI_ADMIN_KEY'] }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(UsageSourceDescriptorSchema)({
        ...descriptor,
        connectionMethod: { kind: 'external', consoleUrl: 'http://unsafe.example' },
      }),
    ).toThrow()
    expect(
      Schema.decodeUnknownSync(UsageSourceDescriptorSchema)({
        ...descriptor,
        sourceId: 'anthropic-subscription',
        connectionMethod: {
          kind: 'oauth',
          sourceId: 'anthropic-subscription',
        },
      }).connectionMethod.kind,
    ).toBe('oauth')
  })

  test('accepts valid ranges and IANA time zones', () => {
    expect(
      decodeExactParams('usage/local/get', {
        range: 'all',
        timeZone: 'America/Los_Angeles',
      }),
    ).toEqual({
      range: 'all',
      timeZone: 'America/Los_Angeles',
    })
    expect(
      decodeExactParams('usage/provider/query', {
        range: 'today',
        timeZone: 'Asia/Shanghai',
        sourceIds: ['deepseek'],
        force: true,
      }),
    ).toEqual({
      range: 'today',
      timeZone: 'Asia/Shanghai',
      sourceIds: ['deepseek'],
      force: true,
    })
    expect(() =>
      decodeExactParams('usage/provider/query', {
        range: '7d',
        timeZone: 'UTC',
        sourceIds: [],
      }),
    ).toThrow()
  })

  test('rejects unknown or sensitive query params', () => {
    for (const extra of [
      { apiKey: 'must-not-cross-rpc' },
      { baseURL: 'https://attacker.example' },
      { unknown: true },
    ]) {
      expect(() =>
        decodeExactParams('usage/provider/query', {
          range: '7d',
          timeZone: 'UTC',
          ...extra,
        }),
      ).toThrow()
    }
    expect(() =>
      decodeExactParams('usage/local/get', {
        range: '30d',
        timeZone: 'Mars/Olympus_Mons',
      }),
    ).toThrow()
    expect(() =>
      decodeExactParams('usage/local/get', {
        range: '90d',
        timeZone: 'UTC',
      }),
    ).toThrow()
  })

  test('keeps billing credential inputs discriminated and exact', () => {
    expect(
      Schema.decodeUnknownSync(BillingCredentialInputSchema, {
        onExcessProperty: 'error',
      })({
        sourceId: 'openai-admin',
        key: 'admin-key',
        operationId: 'operation:openai-admin',
      }),
    ).toMatchObject({ sourceId: 'openai-admin' })

    expect(() =>
      Schema.decodeUnknownSync(BillingCredentialInputSchema, {
        onExcessProperty: 'error',
      })({
        sourceId: 'xai-management',
        key: 'management-key',
        operationId: 'operation:xai',
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(BillingCredentialInputSchema, {
        onExcessProperty: 'error',
      })({
        sourceId: 'cloudflare-ai-gateway',
        key: 'gateway-key',
        accountId: 'account:fixture',
        teamId: 'must-not-pass',
        operationId: 'operation:cloudflare',
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(BillingCredentialInputSchema)({
        sourceId: 'deepseek',
        key: 'provider-key',
        operationId: 'operation:provider-key',
      }),
    ).toThrow()

    for (const input of [
      {
        sourceId: 'openai-admin',
        key: ' \t ',
        operationId: 'operation:blank-key',
      },
      {
        sourceId: 'xai-management',
        key: 'management-key',
        teamId: '\r\n',
        operationId: 'operation:blank-team',
      },
      {
        sourceId: 'cloudflare-ai-gateway',
        key: 'gateway-key',
        accountId: '   ',
        operationId: 'operation:blank-account',
      },
    ]) {
      expect(() =>
        Schema.decodeUnknownSync(BillingCredentialInputSchema, {
          onExcessProperty: 'error',
        })(input),
      ).toThrow()
    }
  })

  test('rejects negative and non-finite local usage results', () => {
    expect(Schema.decodeUnknownSync(LocalUsageResultSchema)(emptyLocalResult)).toEqual(
      emptyLocalResult,
    )
    for (const totalTokens of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        Schema.decodeUnknownSync(LocalUsageResultSchema)({
          ...emptyLocalResult,
          totals: { ...emptyLocalResult.totals, totalTokens },
        }),
      ).toThrow()
    }
    expect(() =>
      Schema.decodeUnknownSync(LocalUsageResultSchema)({
        ...emptyLocalResult,
        totals: { ...emptyLocalResult.totals, estimatedCostUsd: '1e-4' },
      }),
    ).toThrow()
  })

  test('rejects invalid provider percentages, timestamps, and excess result fields', () => {
    const providerId = Schema.decodeUnknownSync(Provider.ID)('provider:fixture')
    const source = {
      sourceId: 'fixture',
      providerIds: [providerId],
      displayName: 'Fixture',
      scope: 'account',
      stability: 'official',
      status: 'available',
      checkedAt: 1,
      connection: { kind: 'none', disconnectible: false },
      groups: [
        {
          id: 'default',
          label: 'Default',
          balances: [],
          quotaWindows: [
            {
              id: 'weekly',
              label: '周额度',
              unit: 'requests',
              remainingPercent: 50,
              resetsAt: 2,
              state: 'normal',
            },
          ],
        },
      ],
    } as const
    expect(Schema.decodeUnknownSync(ProviderUsageSourceSchema)(source)).toEqual(source)
    expect(() =>
      Schema.decodeUnknownSync(ProviderUsageSourceSchema)({
        ...source,
        groups: [
          {
            ...source.groups[0],
            quotaWindows: [
              {
                ...source.groups[0].quotaWindows[0],
                remainingPercent: 101,
              },
            ],
          },
        ],
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(ProviderUsageSourceSchema)({
        ...source,
        checkedAt: Number.NaN,
      }),
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(RpcMethods['usage/provider/query'].result, {
        onExcessProperty: 'error',
      })({
        range: '7d',
        timeZone: 'UTC',
        generatedAt: 1,
        sources: [],
        rawResponse: 'must-not-pass',
      }),
    ).toThrow()
  })
})
