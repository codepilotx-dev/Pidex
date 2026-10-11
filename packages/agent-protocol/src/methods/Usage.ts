import { Credential, Model, Provider } from '@pidex/model-schema'
import { Schema } from 'effect'
import { defineMethod, type MethodMap } from '../wire/Definition'
import { OperationParamsSchema, TimestampSchema } from '../wire/Primitives'

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const NonBlankCredentialFieldSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isPattern(/\S/),
)
const NonNegativeFiniteSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
)
const NonNegativeFiniteIntSchema = Schema.Int.check(
  Schema.isFinite(),
  Schema.isGreaterThanOrEqualTo(0),
)
const PercentSchema = Schema.Number.check(
  Schema.isFinite(),
  Schema.isBetween({ minimum: 0, maximum: 100 }),
)
const DecimalAmountSchema = Schema.String.check(
  Schema.isPattern(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
  Schema.isMaxLength(128),
)
const CurrencySchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(16))
const HttpsUrlSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(2048),
  Schema.makeFilter(
    (value) => {
      try {
        return new URL(value).protocol === 'https:'
      } catch {
        return false
      }
    },
    { expected: 'an HTTPS URL' },
  ),
)

const isCalendarDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

const CalendarDateSchema = Schema.String.check(
  Schema.makeFilter(isCalendarDate, { expected: 'a calendar date in YYYY-MM-DD format' }),
)

const isIanaTimeZone = (value: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return true
  } catch {
    return false
  }
}

export const UsageTimeZoneSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.makeFilter(isIanaTimeZone, { expected: 'a valid IANA time zone' }),
)

export const UsageDecimalAmountSchema = DecimalAmountSchema
const UsageSourceListParamsSchema = Schema.Struct({}).check(
  Schema.makeFilter((value) => Object.keys(value).length === 0, { expected: 'an empty object' }),
)

const UsageCostSchema = Schema.Struct({
  currency: CurrencySchema,
  amount: DecimalAmountSchema,
})

const LocalTokenTotalsSchema = Schema.Struct({
  inputTokens: NonNegativeFiniteIntSchema,
  outputTokens: NonNegativeFiniteIntSchema,
  cachedTokens: NonNegativeFiniteIntSchema,
  totalTokens: NonNegativeFiniteIntSchema,
  estimatedCostUsd: DecimalAmountSchema,
})

const LocalDailyModelUsageSchema = Schema.Struct({
  providerId: Provider.ID,
  modelId: Model.ID,
  displayName: NonEmptyStringSchema,
  ...LocalTokenTotalsSchema.fields,
  modelResponses: NonNegativeFiniteIntSchema,
})

export const LocalDailyUsageSchema = Schema.Struct({
  date: CalendarDateSchema,
  totals: LocalTokenTotalsSchema,
  models: Schema.Array(LocalDailyModelUsageSchema),
})

export const LocalModelUsageSchema = Schema.Struct({
  providerId: Provider.ID,
  modelId: Model.ID,
  displayName: NonEmptyStringSchema,
  ...LocalTokenTotalsSchema.fields,
  modelResponses: NonNegativeFiniteIntSchema,
  sharePercent: PercentSchema,
})

export const LocalUsageTotalsSchema = Schema.Struct({
  ...LocalTokenTotalsSchema.fields,
  rootTasks: NonNegativeFiniteIntSchema,
  modelResponses: NonNegativeFiniteIntSchema,
  providerCalls: NonNegativeFiniteIntSchema,
  activeDays: NonNegativeFiniteIntSchema,
  currentStreak: NonNegativeFiniteIntSchema,
  longestStreak: NonNegativeFiniteIntSchema,
})

export const LocalUsageResultSchema = Schema.Struct({
  range: Schema.Literals(['7d', '30d', 'all']),
  timeZone: UsageTimeZoneSchema,
  generatedAt: TimestampSchema,
  totals: LocalUsageTotalsSchema,
  daily: Schema.Array(LocalDailyUsageSchema),
  models: Schema.Array(LocalModelUsageSchema),
  heatmap: Schema.Array(
    Schema.Struct({
      date: CalendarDateSchema,
      totalTokens: NonNegativeFiniteIntSchema,
      modelResponses: NonNegativeFiniteIntSchema,
    }),
  ),
})

export const DailyUsagePointSchema = Schema.Struct({
  date: CalendarDateSchema,
  inputTokens: NonNegativeFiniteIntSchema,
  outputTokens: NonNegativeFiniteIntSchema,
  cachedTokens: NonNegativeFiniteIntSchema,
  requests: NonNegativeFiniteIntSchema,
  costs: Schema.Array(UsageCostSchema),
})

export const ModelOrToolUsageSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  kind: Schema.Literals(['model', 'tool']),
  inputTokens: Schema.optional(NonNegativeFiniteIntSchema),
  outputTokens: Schema.optional(NonNegativeFiniteIntSchema),
  cachedTokens: Schema.optional(NonNegativeFiniteIntSchema),
  requests: Schema.optional(NonNegativeFiniteIntSchema),
  costs: Schema.optional(Schema.Array(UsageCostSchema)),
})

export const ProviderUsageConnectionSchema = Schema.Struct({
  kind: Schema.Literals(['provider-key', 'billing-key', 'oauth', 'env', 'none']),
  credentialId: Schema.optional(Credential.ID),
  maskedValue: Schema.optional(NonEmptyStringSchema),
  disconnectible: Schema.Boolean,
})

const ProviderUsageBalanceSchema = Schema.Struct({
  currency: CurrencySchema,
  total: DecimalAmountSchema,
  components: Schema.Array(
    Schema.Struct({
      label: NonEmptyStringSchema,
      amount: DecimalAmountSchema,
    }),
  ),
})

const ProviderUsageQuotaWindowSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  unit: Schema.Literals(['tokens', 'requests', 'credits', 'currency']),
  limit: Schema.optional(NonNegativeFiniteSchema),
  used: Schema.optional(NonNegativeFiniteSchema),
  remaining: Schema.optional(NonNegativeFiniteSchema),
  remainingPercent: Schema.optional(PercentSchema),
  resetsAt: Schema.optional(TimestampSchema),
  state: Schema.Literals(['normal', 'exhausted', 'unlimited']),
})

const ProviderUsageTotalsSchema = Schema.Struct({
  inputTokens: NonNegativeFiniteIntSchema,
  outputTokens: NonNegativeFiniteIntSchema,
  cachedTokens: NonNegativeFiniteIntSchema,
  requests: NonNegativeFiniteIntSchema,
  costs: Schema.Array(UsageCostSchema),
})

const ProviderUsageGroupSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  balances: Schema.Array(ProviderUsageBalanceSchema),
  quotaWindows: Schema.Array(ProviderUsageQuotaWindowSchema),
  totals: Schema.optional(ProviderUsageTotalsSchema),
  series: Schema.optional(Schema.Array(DailyUsagePointSchema)),
  breakdown: Schema.optional(Schema.Array(ModelOrToolUsageSchema)),
})

export const ProviderUsageSourceSchema = Schema.Struct({
  sourceId: NonEmptyStringSchema,
  providerIds: Schema.Array(Provider.ID),
  displayName: NonEmptyStringSchema,
  scope: Schema.Literals(['api-key', 'account', 'organization', 'subscription']),
  stability: Schema.Literals(['official', 'experimental']),
  status: Schema.Literals([
    'available',
    'not-connected',
    'permission-required',
    'plan-required',
    'unsupported',
    'unavailable',
  ]),
  checkedAt: Schema.optional(TimestampSchema),
  connection: ProviderUsageConnectionSchema,
  groups: Schema.Array(ProviderUsageGroupSchema),
  error: Schema.optional(
    Schema.Struct({
      category: Schema.Literals([
        'authentication',
        'permission',
        'plan',
        'rate-limit',
        'network',
        'invalid-response',
        'unknown',
      ]),
      message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
      retryable: Schema.Boolean,
    }),
  ),
})

export const BillingCredentialSourceIdSchema = Schema.Literals([
  'openai-admin',
  'anthropic-admin',
  'openrouter-management',
  'xai-management',
  'cloudflare-ai-gateway',
])

export const UsageSourceIdSchema = NonEmptyStringSchema

export const UsageSourceCapabilitySchema = Schema.Literals(['balance', 'quota', 'usage', 'cost'])

export const UsageCredentialFieldSchema = Schema.Struct({
  name: Schema.Literals(['key', 'teamId', 'accountId']),
  label: NonEmptyStringSchema,
  secret: Schema.Boolean,
  required: Schema.Boolean,
})

export const UsageConnectionMethodSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('provider-credential'),
  }),
  Schema.Struct({
    kind: Schema.Literal('billing-key'),
    sourceId: BillingCredentialSourceIdSchema,
    fields: Schema.Array(UsageCredentialFieldSchema).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(3),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal('oauth'),
    sourceId: UsageSourceIdSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('external'),
    consoleUrl: HttpsUrlSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal('none'),
  }),
])

export const UsageSourceDescriptorSchema = Schema.Struct({
  sourceId: UsageSourceIdSchema,
  canonicalProviderId: Provider.ID,
  providerIds: Schema.Array(Provider.ID).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  displayName: NonEmptyStringSchema,
  scope: Schema.Literals(['api-key', 'account', 'organization', 'subscription']),
  stability: Schema.Literals(['official', 'experimental']),
  availability: Schema.Literals(['queryable', 'unsupported']),
  capabilities: Schema.Array(UsageSourceCapabilitySchema).check(Schema.isMaxLength(4)),
  queryPolicy: Schema.Literals(['cached', 'metered']),
  connection: ProviderUsageConnectionSchema,
  connectionMethod: UsageConnectionMethodSchema,
})

const SimpleBillingCredentialInputSchema = Schema.Struct({
  sourceId: Schema.Literals(['openai-admin', 'anthropic-admin', 'openrouter-management']),
  key: NonBlankCredentialFieldSchema,
  ...OperationParamsSchema.fields,
})

const XaiBillingCredentialInputSchema = Schema.Struct({
  sourceId: Schema.Literal('xai-management'),
  key: NonBlankCredentialFieldSchema,
  teamId: NonBlankCredentialFieldSchema,
  ...OperationParamsSchema.fields,
})

const CloudflareBillingCredentialInputSchema = Schema.Struct({
  sourceId: Schema.Literal('cloudflare-ai-gateway'),
  key: NonBlankCredentialFieldSchema,
  accountId: NonBlankCredentialFieldSchema,
  ...OperationParamsSchema.fields,
})

export const BillingCredentialInputSchema = Schema.Union([
  SimpleBillingCredentialInputSchema,
  XaiBillingCredentialInputSchema,
  CloudflareBillingCredentialInputSchema,
])

const BillingCredentialConnectionResultSchema = Schema.Struct({
  sourceId: BillingCredentialSourceIdSchema,
  connection: ProviderUsageConnectionSchema,
})

export const UsageRpcMethods = {
  'usage/source/list': defineMethod({
    params: UsageSourceListParamsSchema,
    result: Schema.Struct({
      sources: Schema.Array(UsageSourceDescriptorSchema),
    }),
    errors: ['RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: null,
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),

  'usage/local/get': defineMethod({
    params: Schema.Struct({
      range: Schema.Literals(['7d', '30d', 'all']),
      timeZone: UsageTimeZoneSchema,
    }),
    result: LocalUsageResultSchema,
    errors: ['RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: null,
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),

  'usage/provider/query': defineMethod({
    params: Schema.Struct({
      range: Schema.Literals(['today', '7d', '30d']),
      timeZone: UsageTimeZoneSchema,
      providerIds: Schema.optional(
        Schema.Array(Provider.ID).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
      ),
      sourceIds: Schema.optional(
        Schema.Array(UsageSourceIdSchema).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
      ),
      force: Schema.optional(Schema.Boolean),
    }),
    result: Schema.Struct({
      range: Schema.Literals(['today', '7d', '30d']),
      timeZone: UsageTimeZoneSchema,
      generatedAt: TimestampSchema,
      sources: Schema.Array(ProviderUsageSourceSchema),
    }),
    errors: ['RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: null,
    mutation: false,
    exactParams: true,
    exactResult: true,
  }),

  'usage/credential/connect': defineMethod({
    params: BillingCredentialInputSchema,
    result: BillingCredentialConnectionResultSchema,
    errors: ['AUTHORIZATION_FAILED', 'CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: null,
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),

  'usage/credential/disconnect': defineMethod({
    params: Schema.Struct({
      sourceId: BillingCredentialSourceIdSchema,
      ...OperationParamsSchema.fields,
    }),
    result: Schema.Struct({
      sourceId: BillingCredentialSourceIdSchema,
      disconnected: Schema.Literal(true),
    }),
    errors: ['CONFLICT', 'RATE_LIMITED', 'INTERNAL_ERROR'] as const,
    capability: null,
    mutation: true,
    exactParams: true,
    exactResult: true,
  }),
} as const satisfies MethodMap

export type LocalUsageResult = Schema.Schema.Type<typeof LocalUsageResultSchema>
export type DailyUsagePoint = Schema.Schema.Type<typeof DailyUsagePointSchema>
export type ModelOrToolUsage = Schema.Schema.Type<typeof ModelOrToolUsageSchema>
export type ProviderUsageSource = Schema.Schema.Type<typeof ProviderUsageSourceSchema>
export type ProviderUsageConnection = Schema.Schema.Type<typeof ProviderUsageConnectionSchema>
export type BillingCredentialSourceId = Schema.Schema.Type<typeof BillingCredentialSourceIdSchema>
export type BillingCredentialInput = Schema.Schema.Type<typeof BillingCredentialInputSchema>
export type UsageSourceCapability = Schema.Schema.Type<typeof UsageSourceCapabilitySchema>
export type UsageCredentialField = Schema.Schema.Type<typeof UsageCredentialFieldSchema>
export type UsageConnectionMethod = Schema.Schema.Type<typeof UsageConnectionMethodSchema>
export type UsageSourceDescriptor = Schema.Schema.Type<typeof UsageSourceDescriptorSchema>
