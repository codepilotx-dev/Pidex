import { UsageRequestError } from './SafeFetch'
import {
  emptySource,
  type ProviderUsageAdapter,
  type ProviderUsageSource,
  type ResolvedUsageCredential,
  type UsageGroup,
  type UsageQueryContext,
} from './Types'

type Json = Record<string, unknown>
type MutableUsageGroup = {
  id: string
  label: string
  balances: Array<UsageGroup['balances'][number]>
  quotaWindows: Array<UsageGroup['quotaWindows'][number]>
  totals?: NonNullable<UsageGroup['totals']>
  series?: Array<NonNullable<UsageGroup['series']>[number]>
  breakdown?: Array<NonNullable<UsageGroup['breakdown']>[number]>
}

const record = (value: unknown): Json | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
const requiredRecord = (value: unknown, label: string): Json => {
  const parsed = record(value)
  if (!parsed) throw new UsageRequestError('invalid-response', `${label} 响应结构无效`, false)
  return parsed
}
const requiredList = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value))
    throw new UsageRequestError('invalid-response', `${label} 响应缺少必要列表`, false)
  return value
}
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined
const number = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : NaN
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}
const integer = (value: unknown) => {
  const parsed = number(value)
  return parsed !== undefined && Number.isSafeInteger(parsed) ? parsed : undefined
}
const percentage = (value: unknown) => {
  const parsed = number(value)
  return parsed === undefined ? undefined : Math.min(100, parsed)
}
const timestamp = (value: unknown): number | undefined => {
  const numeric = number(value)
  if (numeric !== undefined) {
    const millis = numeric < 10_000_000_000 ? numeric * 1000 : numeric
    return Number.isFinite(millis) && millis >= 0 ? Math.trunc(millis) : undefined
  }
  if (typeof value !== 'string') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}
const decimalOrUndefined = (value: unknown): string | undefined => {
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim()))
    return value.trim()
  const parsed = number(value)
  if (parsed === undefined || parsed === 0) return parsed === 0 ? '0' : undefined
  const direct = String(parsed)
  if (/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(direct)) return direct
  const fixed = parsed.toFixed(12).replace(/0+$/, '').replace(/\.$/, '')
  return /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(fixed) ? fixed : undefined
}
const decimal = (value: unknown): string => decimalOrUndefined(value) ?? '0'
const requiredDecimal = (value: unknown, label: string): string => {
  const parsed = decimalOrUndefined(value)
  if (parsed === undefined) {
    throw new UsageRequestError('invalid-response', `${label} 响应包含无效金额`, false)
  }
  return parsed
}
const decimalParts = (value: string) => {
  const [whole = '0', fraction = ''] = value.split('.')
  return { digits: BigInt(`${whole}${fraction}` || '0'), scale: fraction.length }
}
const decimalFromParts = (digits: bigint, scale: number) => {
  const raw = digits.toString().padStart(scale + 1, '0')
  const whole = raw.slice(0, raw.length - scale).replace(/^0+(?=\d)/, '') || '0'
  const fraction = scale ? raw.slice(-scale).replace(/0+$/, '') : ''
  return fraction ? `${whole}.${fraction}` : whole
}
const exactDecimalSum = (values: readonly string[]) => {
  const parts = values.map(decimalParts)
  const scale = parts.reduce((maximum, item) => Math.max(maximum, item.scale), 0)
  return decimalFromParts(
    parts.reduce((sum, item) => sum + item.digits * 10n ** BigInt(scale - item.scale), 0n),
    scale,
  )
}
const exactDecimalSubtract = (left: string, right: string) => {
  const [leftPart, rightPart] = [decimalParts(left), decimalParts(right)]
  const scale = Math.max(leftPart!.scale, rightPart!.scale)
  const leftValue = leftPart!.digits * 10n ** BigInt(scale - leftPart!.scale)
  const rightValue = rightPart!.digits * 10n ** BigInt(scale - rightPart!.scale)
  return decimalFromParts(leftValue > rightValue ? leftValue - rightValue : 0n, scale)
}
const safeIntegerSum = <T>(values: readonly T[], select: (value: T) => number) => {
  let total = 0
  for (const value of values) {
    const next = total + select(value)
    if (!Number.isSafeInteger(next) || next < 0) {
      throw new UsageRequestError('invalid-response', '厂商返回的用量数值超出安全范围', false)
    }
    total = next
  }
  return total
}
const finiteNumberSum = <T>(values: readonly T[], select: (value: T) => number) => {
  let total = 0
  for (const value of values) {
    const next = total + select(value)
    if (!Number.isFinite(next) || next < 0) {
      throw new UsageRequestError('invalid-response', '厂商返回的用量数值超出安全范围', false)
    }
    total = next
  }
  return total
}
const aggregateBreakdown = (
  items: readonly NonNullable<UsageGroup['breakdown']>[number][],
): Array<NonNullable<UsageGroup['breakdown']>[number]> => {
  const aggregated = new Map<string, NonNullable<UsageGroup['breakdown']>[number]>()
  for (const item of items) {
    const key = `${item.kind}\u0000${item.id}`
    const current = aggregated.get(key)
    if (!current) {
      aggregated.set(key, item)
      continue
    }
    const costs = aggregateCosts([...(current.costs ?? []), ...(item.costs ?? [])])
    aggregated.set(key, {
      ...current,
      inputTokens: safeIntegerSum(
        [current.inputTokens ?? 0, item.inputTokens ?? 0],
        (value) => value,
      ),
      outputTokens: safeIntegerSum(
        [current.outputTokens ?? 0, item.outputTokens ?? 0],
        (value) => value,
      ),
      cachedTokens: safeIntegerSum(
        [current.cachedTokens ?? 0, item.cachedTokens ?? 0],
        (value) => value,
      ),
      requests: safeIntegerSum([current.requests ?? 0, item.requests ?? 0], (value) => value),
      ...(costs.length > 0 ? { costs } : {}),
    })
  }
  return [...aggregated.values()]
}
const centsToDecimal = (value: unknown): string => {
  const raw =
    typeof value === 'string' ? value : typeof value === 'number' ? String(Math.trunc(value)) : ''
  if (!/^\d+$/.test(raw)) return '0'
  const normalized = raw.replace(/^0+(?=\d)/, '')
  const padded = normalized.padStart(3, '0')
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, '')
  const fraction = padded.slice(-2).replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}
const absoluteCentsToDecimal = (value: unknown): string => {
  const raw =
    typeof value === 'string' ? value : typeof value === 'number' ? String(Math.trunc(value)) : ''
  return centsToDecimal(raw.replace(/^-/, ''))
}
const bearer = (credential: ResolvedUsageCredential) => ({
  Authorization: `Bearer ${credential.value.type === 'key' ? credential.value.key : credential.value.access}`,
  'Content-Type': 'application/json',
})
const apiKey = (credential: ResolvedUsageCredential) =>
  credential.value.type === 'key' ? credential.value.key : credential.value.access
const emptyGroup = (id: string, label: string): MutableUsageGroup => ({
  id,
  label,
  balances: [],
  quotaWindows: [],
})
const calendarDate = (at: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
const shiftCalendarDate = (date: string, days: number) => {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10)
}
const zonedMidnight = (date: string, timeZone: string) => {
  const [year, month, day] = date.split('-').map(Number)
  const desired = Date.UTC(year!, month! - 1, day!)
  let guess = desired
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = formatter.formatToParts(guess)
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((item) => item.type === type)?.value ?? 0)
    const represented = Date.UTC(
      part('year'),
      part('month') - 1,
      part('day'),
      part('hour'),
      part('minute'),
      part('second'),
    )
    guess += desired - represented
  }
  return new Date(guess)
}
const queryDates = (context: UsageQueryContext) => {
  const days = context.range === 'today' ? 1 : context.range === '7d' ? 7 : 30
  const end = new Date(context.now)
  const endDate = calendarDate(context.now, context.timeZone)
  const startDate = shiftCalendarDate(endDate, -(days - 1))
  const start = zonedMidnight(startDate, context.timeZone)
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startMs: start.getTime(),
    endMs: end.getTime(),
    startUnix: Math.floor(start.getTime() / 1000),
    endUnix: Math.floor(end.getTime() / 1000),
    startDate,
    endDate,
  }
}
const nextReset = (period: unknown, now: number) => {
  const date = new Date(now)
  if (period === 'daily')
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
  if (period === 'weekly') {
    const days = (8 - date.getUTCDay()) % 7 || 7
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days)
  }
  if (period === 'monthly') return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
  return timestamp(period)
}

type AdapterOptions = {
  sourceId: string
  providerIds: readonly string[]
  canonicalProviderId?: string
  displayName: string
  scope?: ProviderUsageAdapter['scope']
  stability?: ProviderUsageAdapter['stability']
  availability?: ProviderUsageAdapter['availability']
  capabilities: ProviderUsageAdapter['capabilities']
  queryPolicy?: ProviderUsageAdapter['queryPolicy']
  connectionMethod?: ProviderUsageAdapter['connectionMethod']
  credential?: {
    kind: 'provider' | 'billing' | 'none'
    envNames?: readonly string[]
  }
  cacheMs?: number
  query: (context: UsageQueryContext, adapter: ProviderUsageAdapter) => Promise<ProviderUsageSource>
}

const adapter = (options: AdapterOptions): ProviderUsageAdapter => ({
  sourceId: options.sourceId,
  canonicalProviderId: options.canonicalProviderId ?? options.providerIds[0]!,
  providerIds: options.providerIds,
  displayName: options.displayName,
  scope: options.scope ?? 'api-key',
  stability: options.stability ?? 'official',
  availability: options.availability ?? 'queryable',
  capabilities: options.capabilities,
  queryPolicy: options.queryPolicy ?? 'cached',
  connectionMethod: options.connectionMethod ?? { kind: 'provider-credential' },
  ...(options.cacheMs === undefined ? {} : { cacheMs: options.cacheMs }),
  matches(provider) {
    return this.providerIds.includes(String(provider.id))
  },
  resolveCredential(context) {
    const credential = options.credential ?? { kind: 'provider' as const }
    return credential.kind === 'none'
      ? Promise.resolve(null)
      : credential.kind === 'provider'
        ? context.credential(this.providerIds, credential.envNames)
        : context.billingCredential(this.sourceId, credential.envNames)
  },
  resolveConnection(context) {
    const credential = options.credential ?? { kind: 'provider' as const }
    return credential.kind === 'none'
      ? Promise.resolve({ kind: 'none' as const, disconnectible: false })
      : credential.kind === 'provider'
        ? context.connection(this.providerIds, credential.envNames)
        : context.billingConnection(this.sourceId, credential.envNames)
  },
  query(context) {
    return options.query(context, this)
  },
})

const providerCredential = async (context: UsageQueryContext, source: ProviderUsageAdapter) => {
  const credential = await source.resolveCredential(context)
  return credential ?? null
}

const deepSeek = adapter({
  sourceId: 'deepseek',
  providerIds: ['deepseek'],
  displayName: 'DeepSeek 余额',
  capabilities: ['balance'],
  credential: { kind: 'provider', envNames: ['DEEPSEEK_API_KEY'] },
  query: async (context, source) => {
    const credential = await providerCredential(context, source)
    if (!credential) return emptySource(source, 'not-connected')
    const value = requiredRecord(
      await context.request('https://api.deepseek.com/user/balance', {
        headers: bearer(credential),
      }),
      'DeepSeek',
    )
    const group = emptyGroup('account', '账户余额')
    const available = value.is_available
    if (typeof available !== 'boolean') {
      throw new UsageRequestError('invalid-response', 'DeepSeek 响应缺少账户状态', false)
    }
    for (const item of requiredList(value.balance_infos, 'DeepSeek')) {
      const balance = requiredRecord(item, 'DeepSeek balance')
      const currency = text(balance.currency)
      if (!currency) throw new UsageRequestError('invalid-response', 'DeepSeek 响应缺少币种', false)
      group.balances.push({
        currency,
        total: requiredDecimal(balance.total_balance, 'DeepSeek'),
        components: [
          { label: '充值余额', amount: requiredDecimal(balance.topped_up_balance, 'DeepSeek') },
          { label: '赠送余额', amount: requiredDecimal(balance.granted_balance, 'DeepSeek') },
        ],
      })
    }
    return {
      ...emptySource(
        source,
        available === false ? 'unavailable' : 'available',
        credential.connection,
      ),
      checkedAt: context.now,
      groups: [group],
    }
  },
})

const minimax = (region: 'global' | 'cn') =>
  adapter({
    sourceId: region === 'cn' ? 'minimax-cn-token-plan' : 'minimax-token-plan',
    providerIds:
      region === 'cn'
        ? ['minimax-cn', 'minimax-cn-coding-plan']
        : ['minimax', 'minimax-coding-plan'],
    displayName: region === 'cn' ? 'MiniMax CN Token Plan' : 'MiniMax Token Plan',
    capabilities: ['quota'],
    credential: {
      kind: 'provider',
      envNames: region === 'cn' ? ['MINIMAX_CN_API_KEY', 'MINIMAX_API_KEY'] : ['MINIMAX_API_KEY'],
    },
    query: async (context, source) => {
      const credential = await providerCredential(context, source)
      if (!credential) return emptySource(source, 'not-connected')
      const origin = region === 'cn' ? 'https://www.minimaxi.com' : 'https://www.minimax.io'
      const value = requiredRecord(
        await context.request(`${origin}/v1/token_plan/remains`, { headers: bearer(credential) }),
        'MiniMax',
      )
      const base = requiredRecord(value.base_resp, 'MiniMax')
      const statusCode = integer(base.status_code)
      if (statusCode === undefined) {
        throw new UsageRequestError('invalid-response', 'MiniMax 响应缺少状态码', false)
      }
      if (statusCode !== 0) {
        throw new UsageRequestError('plan', 'MiniMax 套餐额度当前不可用', false)
      }
      const modelItems = requiredList(value.model_remains, 'MiniMax')
      const groups = modelItems.flatMap((item, index): UsageGroup[] => {
        const remain = record(item)
        if (!remain) return []
        const rawModelName = text(remain.model_name)
        const isSpecificModel =
          rawModelName &&
          rawModelName.toLowerCase() !== 'general' &&
          rawModelName.toLowerCase() !== 'normal'
        const modelDisplayName = isSpecificModel
          ? rawModelName === 'video'
            ? '视频'
            : rawModelName
          : undefined
        const label = modelDisplayName ?? rawModelName ?? `Token Plan ${index + 1}`
        const group = emptyGroup(`plan-${index + 1}`, label)
        const window = (
          id: string,
          windowLabel: string,
          totalValue: unknown,
          usageValue: unknown,
          percentValue: unknown,
          resetValue: unknown,
          statusValue: unknown,
        ) => {
          const total = number(totalValue)
          const usage = number(usageValue)
          const remainingPercent = percentage(percentValue)
          const status = number(statusValue)
          const reset = timestamp(resetValue)
          if (
            total === undefined &&
            usage === undefined &&
            remainingPercent === undefined &&
            status === undefined &&
            reset === undefined
          )
            return
          if (status === 3) return
          const hasCount = total !== undefined && total > 0
          const limit = hasCount ? total : undefined
          const used = hasCount && usage !== undefined ? Math.min(total, usage) : undefined
          const remaining = hasCount ? Math.max(0, total - (usage ?? 0)) : undefined
          const exhausted =
            status === 2 ||
            (remainingPercent !== undefined && remainingPercent === 0) ||
            (hasCount && remaining === 0)
          const unlimited = status === 4
          const quotaId = modelItems.length > 1 ? `plan-${index + 1}-${id}` : id
          const finalLabel =
            modelDisplayName && modelItems.length > 1
              ? `${modelDisplayName} ${windowLabel}`
              : windowLabel
          group.quotaWindows.push({
            id: quotaId,
            label: finalLabel,
            unit: 'requests',
            ...(unlimited
              ? {}
              : {
                  ...(limit === undefined ? {} : { limit }),
                  ...(remaining === undefined ? (hasCount ? { remaining: 0 } : {}) : { remaining }),
                  ...(used === undefined ? {} : { used }),
                  remainingPercent: exhausted
                    ? 0
                    : (remainingPercent ??
                      (hasCount && limit ? Math.round(((remaining ?? 0) / limit) * 100) : 100)),
                }),
            ...(reset === undefined ? {} : { resetsAt: reset }),
            state: unlimited ? 'unlimited' : exhausted ? 'exhausted' : 'normal',
          })
        }
        window(
          'five-hour',
          '5 小时',
          remain.current_interval_total_count,
          remain.current_interval_usage_count,
          remain.current_interval_remaining_percent,
          remain.end_time,
          remain.current_interval_status,
        )
        window(
          'weekly',
          number(remain.weekly_boost_permille)
            ? `每周（加成 +${decimal(number(remain.weekly_boost_permille)! / 10)}%）`
            : '每周',
          remain.current_weekly_total_count,
          remain.current_weekly_usage_count,
          remain.current_weekly_remaining_percent,
          remain.weekly_end_time,
          remain.current_weekly_status,
        )
        return group.quotaWindows.length > 0 ? [group] : []
      })
      return {
        ...emptySource(source, 'available', credential.connection),
        checkedAt: context.now,
        groups,
      }
    },
  })

const moonshot = adapter({
  sourceId: 'moonshot-balance',
  providerIds: ['moonshotai', 'moonshotai-cn'],
  displayName: 'Moonshot/Kimi 开放平台余额',
  capabilities: ['balance'],
  credential: { kind: 'provider', envNames: ['MOONSHOT_API_KEY'] },
  query: async (context, source) => {
    const credential = await providerCredential(context, source)
    if (!credential) return emptySource(source, 'not-connected')
    const root = requiredRecord(
      await context.request('https://api.moonshot.cn/v1/users/me/balance', {
        headers: bearer(credential),
      }),
      'Moonshot',
    )
    const data = requiredRecord(root.data, 'Moonshot')
    if (number(data.available_balance) === undefined) {
      throw new UsageRequestError('invalid-response', 'Moonshot 响应缺少可用余额', false)
    }
    const cashBalance = requiredDecimal(data.cash_balance, 'Moonshot')
    const giftBalance = requiredDecimal(data.voucher_balance ?? data.gift_balance, 'Moonshot')
    const group = emptyGroup('account', '账户余额')
    group.balances.push({
      currency: text(data?.currency) ?? 'CNY',
      total: requiredDecimal(data.available_balance, 'Moonshot'),
      components: [
        { label: '现金余额', amount: cashBalance },
        { label: '赠送余额', amount: giftBalance },
      ],
    })
    return {
      ...emptySource(source, 'available', credential.connection),
      checkedAt: context.now,
      groups: [group],
    }
  },
})

const siliconFlow = (region: 'global' | 'cn') =>
  adapter({
    sourceId: region === 'cn' ? 'siliconflow-cn-balance' : 'siliconflow-balance',
    providerIds: [region === 'cn' ? 'siliconflow-cn' : 'siliconflow'],
    displayName: region === 'cn' ? 'SiliconFlow CN 余额' : 'SiliconFlow 余额',
    capabilities: ['balance'],
    credential: { kind: 'provider', envNames: ['SILICONFLOW_API_KEY'] },
    query: async (context, source) => {
      const credential = await providerCredential(context, source)
      if (!credential) return emptySource(source, 'not-connected')
      const root = requiredRecord(
        await context.request(
          `${region === 'cn' ? 'https://api.siliconflow.cn' : 'https://api.siliconflow.com'}/v1/user/info`,
          { headers: bearer(credential) },
        ),
        'SiliconFlow',
      )
      const data = requiredRecord(root.data, 'SiliconFlow')
      if (number(data.balance ?? data.totalBalance) === undefined) {
        throw new UsageRequestError('invalid-response', 'SiliconFlow 响应缺少余额', false)
      }
      const charged = requiredDecimal(data.chargeBalance ?? data.recharge_balance, 'SiliconFlow')
      const group = emptyGroup('account', '账户余额')
      group.balances.push({
        currency: text(data?.currency)?.toUpperCase() ?? (region === 'cn' ? 'CNY' : 'USD'),
        total: requiredDecimal(data.balance ?? data.totalBalance, 'SiliconFlow'),
        components: [{ label: '充值余额', amount: charged }],
      })
      const accountStatus = text(data?.status ?? data?.accountStatus)
      const available =
        accountStatus && /suspend|disabled|blocked/i.test(accountStatus)
          ? 'unavailable'
          : 'available'
      return {
        ...emptySource(source, available, credential.connection),
        checkedAt: context.now,
        groups: [group],
      }
    },
  })

const openRouterKey = adapter({
  sourceId: 'openrouter-key',
  providerIds: ['openrouter'],
  displayName: 'OpenRouter 当前 Key',
  capabilities: ['quota', 'usage'],
  credential: { kind: 'provider', envNames: ['OPENROUTER_API_KEY'] },
  query: async (context, source) => {
    const credential = await providerCredential(context, source)
    if (!credential) return emptySource(source, 'not-connected')
    const root = requiredRecord(
      await context.request('https://openrouter.ai/api/v1/key', { headers: bearer(credential) }),
      'OpenRouter',
    )
    const data = requiredRecord(root.data, 'OpenRouter')
    if (number(data.usage) === undefined)
      throw new UsageRequestError('invalid-response', 'OpenRouter 响应缺少用量', false)
    const group = emptyGroup('key', text(data?.label) ?? '当前 API Key')
    const limit = number(data?.limit)
    const remaining = number(data?.limit_remaining)
    group.quotaWindows.push(
      ...[
        ['daily', '今日', data?.usage_daily],
        ['weekly', '本周', data?.usage_weekly],
        ['monthly', '本月', data?.usage_monthly],
      ].flatMap(([id, label, used]): UsageGroup['quotaWindows'] =>
        number(used) === undefined
          ? []
          : [
              {
                id: String(id),
                label: String(label),
                unit: 'credits',
                used: number(used)!,
                state: 'normal',
              },
            ],
      ),
    )
    if (limit !== undefined || remaining !== undefined)
      group.quotaWindows.unshift({
        id: 'key-limit',
        label: 'Key 限额',
        unit: 'credits',
        ...(limit === undefined ? {} : { limit }),
        ...(remaining === undefined ? {} : { remaining }),
        ...(number(data?.usage) === undefined ? {} : { used: number(data?.usage)! }),
        ...(nextReset(data?.limit_reset, context.now) === undefined
          ? {}
          : { resetsAt: nextReset(data?.limit_reset, context.now)! }),
        state: remaining === 0 ? 'exhausted' : 'normal',
      })
    return {
      ...emptySource(source, 'available', credential.connection),
      checkedAt: context.now,
      groups: [group],
    }
  },
})

const fireworks = adapter({
  sourceId: 'fireworks-quotas',
  providerIds: ['fireworks-ai', 'fireworks'],
  displayName: 'Fireworks AI 账户额度',
  scope: 'account',
  capabilities: ['quota'],
  credential: { kind: 'provider', envNames: ['FIREWORKS_API_KEY'] },
  query: async (context, source) => {
    const credential = await providerCredential(context, source)
    if (!credential) return emptySource(source, 'not-connected')
    const accounts: Json[] = []
    let pageToken: string | undefined
    for (let page = 0; page < 20 && accounts.length < 20; page += 1) {
      const url = new URL('https://api.fireworks.ai/v1/accounts')
      url.searchParams.set('pageSize', '200')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const root = requiredRecord(
        await context.request(url.toString(), { headers: bearer(credential) }),
        'Fireworks accounts',
      )
      accounts.push(
        ...requiredList(root.accounts, 'Fireworks accounts')
          .map(record)
          .filter((item): item is Json => item !== null)
          .slice(0, 20 - accounts.length),
      )
      pageToken = text(root?.nextPageToken)
      if (!pageToken) break
    }
    const groups: UsageGroup[] = []
    let activeAccounts = 0
    let totalQuotaCount = 0
    for (const account of accounts) {
      if (totalQuotaCount >= 10_000) break
      const name = text(account.name)
      if (!name) continue
      const suspended = /suspend|paused|disabled/i.test(
        `${text(account.suspendState) ?? ''} ${text(account.status) ?? ''}`,
      )
      if (!suspended) activeAccounts += 1
      const displayName = text(account.displayName) ?? name
      const group = emptyGroup(name, suspended ? `${displayName}（已暂停）` : displayName)
      const accountId = name.split('/').filter(Boolean).at(-1)!
      let quotaPageToken: string | undefined
      for (let page = 0; page < 20 && totalQuotaCount < 10_000; page += 1) {
        const url = new URL(
          `https://api.fireworks.ai/v1/accounts/${encodeURIComponent(accountId)}/quotas`,
        )
        url.searchParams.set('pageSize', '200')
        if (quotaPageToken) url.searchParams.set('pageToken', quotaPageToken)
        const root = requiredRecord(
          await context.request(url.toString(), { headers: bearer(credential) }),
          'Fireworks quotas',
        )
        for (const item of requiredList(root.quotas, 'Fireworks quotas').slice(
          0,
          10_000 - totalQuotaCount,
        )) {
          const quota = record(item)
          if (!quota) continue
          totalQuotaCount += 1
          const limit = number(quota.maxValue)
          const used = number(quota.usage)
          group.quotaWindows.push({
            id: text(quota.name) ?? `quota-${group.quotaWindows.length + 1}`,
            label: text(quota.name) ?? 'Quota',
            unit: 'requests',
            ...(limit === undefined ? {} : { limit }),
            ...(used === undefined ? {} : { used }),
            ...(limit === undefined || used === undefined
              ? {}
              : { remaining: Math.max(0, limit - used) }),
            state:
              limit !== undefined && used !== undefined && used >= limit ? 'exhausted' : 'normal',
          })
        }
        quotaPageToken = text(root?.nextPageToken)
        if (!quotaPageToken) break
      }
      groups.push(group)
    }
    return {
      ...emptySource(
        source,
        groups.length > 0 && activeAccounts === 0 ? 'unavailable' : 'available',
        credential.connection,
      ),
      checkedAt: context.now,
      groups,
    }
  },
})

const managementCredential = (context: UsageQueryContext, source: ProviderUsageAdapter) =>
  source.resolveCredential(context)

const cloudflare = adapter({
  sourceId: 'cloudflare-ai-gateway',
  providerIds: ['cloudflare-ai-gateway'],
  displayName: 'Cloudflare AI Gateway Billing',
  scope: 'account',
  capabilities: ['balance', 'quota', 'cost'],
  connectionMethod: {
    kind: 'billing-key',
    sourceId: 'cloudflare-ai-gateway',
    fields: [
      { name: 'key', label: 'API Token', secret: true, required: true },
      { name: 'accountId', label: 'Account ID', secret: false, required: true },
    ],
  },
  credential: { kind: 'billing', envNames: ['CLOUDFLARE_AI_GATEWAY_TOKEN'] },
  query: async (context, source) => {
    const credential = await managementCredential(context, source)
    if (!credential) return emptySource(source, 'not-connected')
    const metadata = credential.value.metadata
    const accountId = typeof metadata?.accountId === 'string' ? metadata.accountId : undefined
    if (!accountId) return emptySource(source, 'not-connected', credential.connection)
    const base = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai-gateway/billing`
    const headers = bearer(credential)
    const dates = queryDates(context)
    const historyUrl = new URL(`${base}/usage-history`)
    historyUrl.search = new URLSearchParams({
      value_grouping_window: 'day',
      start_time: String(dates.startMs),
      end_time: String(dates.endMs),
    }).toString()
    const [creditRoot, historyRoot, limitRoot] = await Promise.all([
      context.request(`${base}/credit-balance`, { headers }),
      context.request(historyUrl.toString(), { headers }),
      context.request(`${base}/spending-limit`, { headers }),
    ])
    const credit = requiredRecord(
      requiredRecord(creditRoot, 'Cloudflare credit').result,
      'Cloudflare credit',
    )
    const history = requiredRecord(
      requiredRecord(historyRoot, 'Cloudflare history').result,
      'Cloudflare history',
    )
    const limit = requiredRecord(
      requiredRecord(limitRoot, 'Cloudflare spending limit').result,
      'Cloudflare spending limit',
    )
    if (number(credit.balance) === undefined)
      throw new UsageRequestError('invalid-response', 'Cloudflare 响应缺少余额', false)
    const historyItems = requiredList(history.history, 'Cloudflare history')
    const config = record(limit?.config)
    const group = emptyGroup('gateway', 'AI Gateway')
    group.balances.push({ currency: 'USD', total: decimal(credit?.balance), components: [] })
    if (limit?.enabled === true) {
      const maximum = number(config?.amount)
      const used = finiteNumberSum(
        historyItems,
        (item) => number(record(item)?.aggregated_value) ?? 0,
      )
      group.quotaWindows.push({
        id: 'spending-limit',
        label: `支出上限${text(config?.duration) ? `（${text(config?.duration)}）` : ''}`,
        unit: 'currency',
        ...(maximum === undefined
          ? {}
          : { limit: maximum, used, remaining: Math.max(0, maximum - used) }),
        state: maximum !== undefined && used >= maximum ? 'exhausted' : 'normal',
      })
    }
    const costsByDate = new Map<string, string[]>()
    for (const item of historyItems) {
      const point = requiredRecord(item, 'Cloudflare history')
      const at = timestamp(point.start_time)
      const amount = decimalOrUndefined(point.aggregated_value)
      if (at === undefined || amount === undefined) {
        throw new UsageRequestError(
          'invalid-response',
          'Cloudflare history 响应包含无效用量',
          false,
        )
      }
      const date = calendarDate(at, context.timeZone)
      costsByDate.set(date, [...(costsByDate.get(date) ?? []), amount])
    }
    group.series = [...costsByDate]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, amounts]) => ({
        date,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        requests: 0,
        costs: [{ currency: 'USD', amount: exactDecimalSum(amounts) }],
      }))
    return {
      ...emptySource(source, 'available', credential.connection),
      checkedAt: context.now,
      groups: [group],
    }
  },
})

const vercel = adapter({
  sourceId: 'vercel-ai-gateway',
  providerIds: ['vercel', 'vercel-ai-gateway', 'ai-gateway'],
  displayName: 'Vercel AI Gateway Reporting',
  scope: 'account',
  canonicalProviderId: 'vercel-ai-gateway',
  capabilities: ['usage', 'cost'],
  queryPolicy: 'metered',
  credential: { kind: 'provider', envNames: ['AI_GATEWAY_API_KEY'] },
  cacheMs: 60 * 60_000,
  query: async (context, source) => {
    const credential = await providerCredential(context, source)
    if (!credential) return emptySource(source, 'not-connected')
    const dates = queryDates(context)
    const url = new URL('https://ai-gateway.vercel.sh/v1/report')
    url.search = new URLSearchParams({
      start_date: dates.startDate,
      end_date: dates.endDate,
      group_by: 'model',
    }).toString()
    let root: Json | null
    try {
      root = requiredRecord(
        await context.request(url.toString(), { headers: bearer(credential) }),
        'Vercel',
      )
    } catch (cause) {
      if (cause instanceof UsageRequestError && (cause.status === 402 || cause.status === 403)) {
        throw new UsageRequestError(
          'plan',
          'Vercel Reporting API 需要 Pro 或 Enterprise 套餐',
          false,
          cause.status,
        )
      }
      throw cause
    }
    const breakdown = requiredList(root.results, 'Vercel').flatMap((item, index) => {
      const result = record(item)
      if (!result) return []
      return [
        {
          id: text(result.model) ?? `model-${index + 1}`,
          label: text(result.model) ?? '未知模型',
          kind: 'model' as const,
          inputTokens: integer(result.input_tokens) ?? 0,
          outputTokens: integer(result.output_tokens) ?? 0,
          cachedTokens:
            (integer(result.cached_input_tokens) ?? 0) +
            (integer(result.cache_creation_input_tokens) ?? 0),
          requests: integer(result.request_count) ?? 0,
          costs: [{ currency: 'USD', amount: decimal(result.total_cost) }],
        },
      ]
    })
    const group = emptyGroup('report', 'Reporting API（查询可能产生费用）')
    group.breakdown = aggregateBreakdown(breakdown)
    group.totals = {
      inputTokens: safeIntegerSum(breakdown, (item) => item.inputTokens ?? 0),
      outputTokens: safeIntegerSum(breakdown, (item) => item.outputTokens ?? 0),
      cachedTokens: safeIntegerSum(breakdown, (item) => item.cachedTokens ?? 0),
      requests: safeIntegerSum(breakdown, (item) => item.requests ?? 0),
      costs: [
        {
          currency: 'USD',
          amount: exactDecimalSum(breakdown.map((item) => item.costs?.[0]?.amount ?? '0')),
        },
      ],
    }
    return {
      ...emptySource(source, 'available', credential.connection),
      checkedAt: context.now,
      groups: [group],
    }
  },
})

const pagedResults = async (context: UsageQueryContext, initialUrl: URL, headers: HeadersInit) => {
  const output: Json[] = []
  let page: string | undefined
  for (let index = 0; index < 20 && output.length < 10_000; index += 1) {
    const url = new URL(initialUrl)
    if (page) url.searchParams.set('page', page)
    const root = requiredRecord(await context.request(url.toString(), { headers }), 'Admin usage')
    const pageItems = root.data ?? root.results
    output.push(
      ...requiredList(pageItems, 'Admin usage')
        .map(record)
        .filter((item): item is Json => item !== null)
        .slice(0, 10_000 - output.length),
    )
    page = text(root?.next_page)
    if (root.has_more === true && !page) {
      throw new UsageRequestError('invalid-response', 'Admin usage 响应缺少下一页游标', false)
    }
    if (!page && root?.has_more !== true) break
  }
  return output
}
const aggregateCosts = (costs: ReadonlyArray<{ currency: string; amount: string }>) => {
  const byCurrency = new Map<string, string[]>()
  for (const cost of costs)
    byCurrency.set(cost.currency, [...(byCurrency.get(cost.currency) ?? []), cost.amount])
  return [...byCurrency].map(([currency, amounts]) => ({
    currency,
    amount: exactDecimalSum(amounts),
  }))
}

const openAIAdmin = adapter({
  sourceId: 'openai-admin',
  providerIds: ['openai'],
  displayName: 'OpenAI 组织用量与成本',
  scope: 'organization',
  capabilities: ['usage', 'cost'],
  connectionMethod: {
    kind: 'billing-key',
    sourceId: 'openai-admin',
    fields: [{ name: 'key', label: 'Admin Key', secret: true, required: true }],
  },
  credential: { kind: 'billing', envNames: ['OPENAI_ADMIN_KEY'] },
  query: async (context, source) => {
    const credential = await managementCredential(context, source)
    if (!credential) return emptySource(source, 'not-connected')
    const dates = queryDates(context)
    const headers = bearer(credential)
    const usageUrl = new URL('https://api.openai.com/v1/organization/usage/completions')
    usageUrl.searchParams.set('start_time', String(dates.startUnix))
    usageUrl.searchParams.set('end_time', String(dates.endUnix))
    usageUrl.searchParams.set('bucket_width', '1d')
    usageUrl.searchParams.set('limit', '31')
    usageUrl.searchParams.append('group_by[]', 'model')
    const costsUrl = new URL('https://api.openai.com/v1/organization/costs')
    costsUrl.searchParams.set('start_time', String(dates.startUnix))
    costsUrl.searchParams.set('end_time', String(dates.endUnix))
    costsUrl.searchParams.set('bucket_width', '1d')
    costsUrl.searchParams.set('limit', '31')
    const [usageBuckets, costBuckets] = await Promise.all([
      pagedResults(context, usageUrl, headers),
      pagedResults(context, costsUrl, headers),
    ])
    const usages = usageBuckets.flatMap((bucket) =>
      requiredList(bucket.results, 'OpenAI usage bucket')
        .map(record)
        .filter((item): item is Json => item !== null),
    )
    const costs = costBuckets.flatMap((bucket) =>
      requiredList(bucket.results, 'OpenAI cost bucket')
        .map(record)
        .filter((item): item is Json => item !== null),
    )
    const normalizedCosts = costs
      .map((item) => record(item.amount))
      .filter((item): item is Json => item !== null)
      .map((amount) => ({
        currency: text(amount.currency)?.toUpperCase() ?? 'USD',
        amount: decimal(amount.value),
      }))
    const group = emptyGroup('organization', '组织')
    group.totals = {
      inputTokens: safeIntegerSum(usages, (item) => integer(item.input_tokens) ?? 0),
      outputTokens: safeIntegerSum(usages, (item) => integer(item.output_tokens) ?? 0),
      cachedTokens: safeIntegerSum(usages, (item) => integer(item.input_cached_tokens) ?? 0),
      requests: safeIntegerSum(usages, (item) => integer(item.num_model_requests) ?? 0),
      costs: aggregateCosts(normalizedCosts),
    }
    group.breakdown = aggregateBreakdown(
      usages.map((item, index) => ({
        id: text(item.model) ?? `model-${index + 1}`,
        label: text(item.model) ?? '未知模型',
        kind: 'model' as const,
        inputTokens: integer(item.input_tokens) ?? 0,
        outputTokens: integer(item.output_tokens) ?? 0,
        cachedTokens: integer(item.input_cached_tokens) ?? 0,
        requests: integer(item.num_model_requests) ?? 0,
      })),
    )
    const dailyCosts = new Map<string, Array<{ currency: string; amount: string }>>()
    for (const bucket of costBuckets) {
      const date = calendarDate(
        (number(bucket.start_time) ?? dates.startUnix) * 1000,
        context.timeZone,
      )
      const bucketCosts = requiredList(bucket.results, 'OpenAI cost bucket')
        .map(record)
        .filter((item): item is Json => item !== null)
        .map((item) => record(item.amount))
        .filter((item): item is Json => item !== null)
        .map((amount) => ({
          currency: text(amount.currency)?.toUpperCase() ?? 'USD',
          amount: decimal(amount.value),
        }))
      dailyCosts.set(date, aggregateCosts(bucketCosts))
    }
    group.series = usageBuckets.map((bucket) => {
      const results = requiredList(bucket.results, 'OpenAI usage bucket')
        .map(record)
        .filter((item): item is Json => item !== null)
      const date = calendarDate(
        (number(bucket.start_time) ?? dates.startUnix) * 1000,
        context.timeZone,
      )
      return {
        date,
        inputTokens: safeIntegerSum(results, (item) => integer(item.input_tokens) ?? 0),
        outputTokens: safeIntegerSum(results, (item) => integer(item.output_tokens) ?? 0),
        cachedTokens: safeIntegerSum(results, (item) => integer(item.input_cached_tokens) ?? 0),
        requests: safeIntegerSum(results, (item) => integer(item.num_model_requests) ?? 0),
        costs: dailyCosts.get(date) ?? [],
      }
    })
    return {
      ...emptySource(source, 'available', credential.connection),
      checkedAt: context.now,
      groups: [group],
    }
  },
})

const anthropicAdmin = adapter({
  sourceId: 'anthropic-admin',
  providerIds: ['anthropic'],
  displayName: 'Anthropic Admin Usage/Cost',
  scope: 'organization',
  capabilities: ['usage', 'cost'],
  connectionMethod: {
    kind: 'billing-key',
    sourceId: 'anthropic-admin',
    fields: [{ name: 'key', label: 'Admin Key', secret: true, required: true }],
  },
  credential: { kind: 'billing', envNames: ['ANTHROPIC_ADMIN_KEY'] },
  query: async (context, source) => {
    const credential = await managementCredential(context, source)
    if (!credential) return emptySource(source, 'not-connected')
    const dates = queryDates(context)
    const headers = { 'x-api-key': apiKey(credential), 'anthropic-version': '2023-06-01' }
    const build = (path: string) => {
      const url = new URL(`https://api.anthropic.com${path}`)
      url.searchParams.set('starting_at', dates.startIso)
      url.searchParams.set('ending_at', dates.endIso)
      url.searchParams.set('bucket_width', '1d')
      url.searchParams.append('group_by[]', path.includes('cost_report') ? 'description' : 'model')
      return url
    }
    const [usageBuckets, costBuckets] = await Promise.all([
      pagedResults(context, build('/v1/organizations/usage_report/messages'), headers),
      pagedResults(context, build('/v1/organizations/cost_report'), headers),
    ])
    const usages = usageBuckets.flatMap((bucket) =>
      requiredList(bucket.results, 'Anthropic usage bucket')
        .map(record)
        .filter((item): item is Json => item !== null),
    )
    const costs = costBuckets.flatMap((bucket) =>
      requiredList(bucket.results, 'Anthropic cost bucket')
        .map(record)
        .filter((item): item is Json => item !== null),
    )
    const cached = (item: Json) =>
      (integer(item.cache_read_input_tokens) ?? 0) +
      Object.values(record(item.cache_creation) ?? {}).reduce<number>(
        (sum, value) => sum + (integer(value) ?? 0),
        0,
      )
    const normalizedCosts = costs.map((item) => ({
      currency: text(item.currency)?.toUpperCase() ?? 'USD',
      amount: centsToDecimal(item.amount),
    }))
    const group = emptyGroup('organization', '组织')
    group.totals = {
      inputTokens: safeIntegerSum(usages, (item) => integer(item.uncached_input_tokens) ?? 0),
      outputTokens: safeIntegerSum(usages, (item) => integer(item.output_tokens) ?? 0),
      cachedTokens: safeIntegerSum(usages, cached),
      requests: safeIntegerSum(usages, (item) => integer(item.requests) ?? 0),
      costs: aggregateCosts(normalizedCosts),
    }
    group.breakdown = aggregateBreakdown(
      usages.map((item, index) => ({
        id: text(item.model) ?? `model-${index + 1}`,
        label: text(item.model) ?? '未知模型',
        kind: 'model' as const,
        inputTokens: integer(item.uncached_input_tokens) ?? 0,
        outputTokens: integer(item.output_tokens) ?? 0,
        cachedTokens: cached(item),
        requests: integer(item.requests) ?? 0,
      })),
    )
    const dailyCosts = new Map<string, Array<{ currency: string; amount: string }>>()
    for (const bucket of costBuckets) {
      const date = calendarDate(timestamp(bucket.starting_at) ?? context.now, context.timeZone)
      const bucketCosts = requiredList(bucket.results, 'Anthropic cost bucket')
        .map(record)
        .filter((item): item is Json => item !== null)
        .map((item) => ({
          currency: text(item.currency)?.toUpperCase() ?? 'USD',
          amount: centsToDecimal(item.amount),
        }))
      dailyCosts.set(date, aggregateCosts(bucketCosts))
    }
    group.series = usageBuckets.map((bucket) => {
      const results = requiredList(bucket.results, 'Anthropic usage bucket')
        .map(record)
        .filter((item): item is Json => item !== null)
      const date = calendarDate(timestamp(bucket.starting_at) ?? context.now, context.timeZone)
      return {
        date,
        inputTokens: safeIntegerSum(results, (item) => integer(item.uncached_input_tokens) ?? 0),
        outputTokens: safeIntegerSum(results, (item) => integer(item.output_tokens) ?? 0),
        cachedTokens: safeIntegerSum(results, cached),
        requests: safeIntegerSum(results, (item) => integer(item.requests) ?? 0),
        costs: dailyCosts.get(date) ?? [],
      }
    })
    return {
      ...emptySource(source, 'available', credential.connection),
      checkedAt: context.now,
      groups: [group],
    }
  },
})

const xaiManagement = adapter({
  sourceId: 'xai-management',
  providerIds: ['xai'],
  displayName: 'xAI Team Billing',
  scope: 'organization',
  capabilities: ['balance', 'quota', 'cost'],
  connectionMethod: {
    kind: 'billing-key',
    sourceId: 'xai-management',
    fields: [
      { name: 'key', label: 'Management Key', secret: true, required: true },
      { name: 'teamId', label: 'Team ID', secret: false, required: true },
    ],
  },
  credential: { kind: 'billing', envNames: ['XAI_MANAGEMENT_KEY'] },
  query: async (context, source) => {
    const credential = await managementCredential(context, source)
    if (!credential) return emptySource(source, 'not-connected')
    const teamId =
      typeof credential.value.metadata?.teamId === 'string'
        ? credential.value.metadata.teamId
        : undefined
    if (!teamId) return emptySource(source, 'not-connected', credential.connection)
    const base = `https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(teamId)}`
    const dates = queryDates(context)
    const headers = bearer(credential)
    const [balanceRoot, usageRoot, limitsRoot] = await Promise.all([
      context.request(`${base}/prepaid/balance`, { headers }),
      context.request(`${base}/usage`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          analyticsRequest: {
            timeRange: {
              startTime: dates.startIso.replace('T', ' ').slice(0, 19),
              endTime: dates.endIso.replace('T', ' ').slice(0, 19),
              timezone: context.timeZone,
            },
            timeUnit: 'TIME_UNIT_DAY',
            values: [{ name: 'usd', aggregation: 'AGGREGATION_SUM' }],
            groupBy: ['description'],
            filters: [],
          },
        }),
      }),
      context.request(`${base}/postpaid/spending-limits`, { headers }),
    ])
    const balance = requiredRecord(balanceRoot, 'xAI prepaid balance')
    const usage = requiredRecord(usageRoot, 'xAI usage')
    const limits = requiredRecord(limitsRoot, 'xAI spending limits')
    const group = emptyGroup('team', 'Team')
    const balanceTotal = record(balance.total)?.val ?? balance.balance
    if (typeof balanceTotal !== 'string' && typeof balanceTotal !== 'number') {
      throw new UsageRequestError('invalid-response', 'xAI 响应缺少预付余额', false)
    }
    group.balances.push({
      currency: 'USD',
      total: absoluteCentsToDecimal(balanceTotal),
      components: [],
    })
    const spendingLimits = record(limits.spendingLimits) ?? limits
    const max = number(
      absoluteCentsToDecimal(
        record(spendingLimits?.effectiveSl)?.val ??
          record(spendingLimits?.softSl)?.val ??
          spendingLimits?.monthly_limit ??
          spendingLimits?.limit,
      ),
    )
    const timeSeries = requiredList(usage.timeSeries, 'xAI usage')
    const points = timeSeries.flatMap((series) =>
      requiredList(requiredRecord(series, 'xAI usage series').dataPoints, 'xAI usage series').map(
        (point) => requiredRecord(point, 'xAI usage point'),
      ),
    )
    const usageAmounts = points.map((point) => {
      const value = decimalOrUndefined(requiredList(point.values, 'xAI usage point')[0])
      if (value === undefined)
        throw new UsageRequestError('invalid-response', 'xAI 响应包含无效金额', false)
      return value
    })
    const used = number(exactDecimalSum(usageAmounts))
    if (max !== undefined || used !== undefined)
      group.quotaWindows.push({
        id: 'monthly-spending',
        label: '月度支出上限',
        unit: 'currency',
        ...(max === undefined ? {} : { limit: max }),
        ...(used === undefined ? {} : { used }),
        ...(max === undefined || used === undefined ? {} : { remaining: Math.max(0, max - used) }),
        state: max !== undefined && used !== undefined && used >= max ? 'exhausted' : 'normal',
      })
    const costsByDate = new Map<string, string[]>()
    for (const point of points) {
      const at = timestamp(point.timestamp)
      const amount = decimalOrUndefined(requiredList(point.values, 'xAI usage point')[0])
      if (at === undefined || amount === undefined) continue
      const date = calendarDate(at, context.timeZone)
      costsByDate.set(date, [...(costsByDate.get(date) ?? []), amount])
    }
    group.series = [...costsByDate]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, amounts]) => ({
        date,
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        requests: 0,
        costs: [{ currency: 'USD', amount: exactDecimalSum(amounts) }],
      }))
    group.totals = {
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      requests: 0,
      costs: [{ currency: 'USD', amount: exactDecimalSum([...costsByDate.values()].flat()) }],
    }
    return {
      ...emptySource(source, 'available', credential.connection),
      checkedAt: context.now,
      groups: [group],
    }
  },
})

const openRouterManagement = adapter({
  sourceId: 'openrouter-management',
  providerIds: ['openrouter'],
  displayName: 'OpenRouter Management Credits',
  scope: 'organization',
  capabilities: ['balance', 'cost'],
  connectionMethod: {
    kind: 'billing-key',
    sourceId: 'openrouter-management',
    fields: [{ name: 'key', label: 'Management Key', secret: true, required: true }],
  },
  credential: { kind: 'billing', envNames: ['OPENROUTER_MANAGEMENT_KEY'] },
  query: async (context, source) => {
    const credential = await managementCredential(context, source)
    if (!credential) return emptySource(source, 'not-connected')
    const root = requiredRecord(
      await context.request('https://openrouter.ai/api/v1/credits', {
        headers: bearer(credential),
      }),
      'OpenRouter credits',
    )
    const data = requiredRecord(root.data, 'OpenRouter credits')
    if (
      decimalOrUndefined(data.total_credits) === undefined ||
      decimalOrUndefined(data.total_usage) === undefined
    ) {
      throw new UsageRequestError('invalid-response', 'OpenRouter credits 响应缺少金额', false)
    }
    const purchased = decimal(data?.total_credits)
    const used = decimal(data?.total_usage)
    const group = emptyGroup('organization', '组织 Credits')
    group.balances.push({
      currency: 'USD',
      total: exactDecimalSubtract(purchased, used),
      components: [
        { label: '累计购买', amount: purchased },
        { label: '累计使用', amount: used },
      ],
    })
    return {
      ...emptySource(source, 'available', credential.connection),
      checkedAt: context.now,
      groups: [group],
    }
  },
})

const claudeSubscription = adapter({
  sourceId: 'anthropic-subscription',
  providerIds: ['anthropic'],
  displayName: 'Claude 订阅额度',
  scope: 'subscription',
  stability: 'experimental',
  capabilities: ['quota'],
  connectionMethod: {
    kind: 'oauth',
    sourceId: 'anthropic-subscription',
  },
  credential: { kind: 'billing' },
  query: async (context, source) => {
    const credential = await source.resolveCredential(context)
    if (!credential) return emptySource(source, 'not-connected')
    const root = requiredRecord(
      await context.request('https://api.anthropic.com/api/oauth/usage', {
        headers: { ...bearer(credential), 'anthropic-beta': 'oauth-2025-04-20' },
      }),
      'Claude subscription',
    )
    if (!['five_hour', 'seven_day', 'extra_usage'].some((key) => key in root)) {
      throw new UsageRequestError('invalid-response', 'Claude 订阅响应缺少额度字段', false)
    }
    const group = emptyGroup('subscription', 'Claude 订阅')
    for (const [id, label] of [
      ['five_hour', '5 小时'],
      ['seven_day', '7 天'],
      ['seven_day_oauth_apps', 'OAuth Apps 7 天'],
      ['seven_day_opus', 'Opus 7 天'],
      ['seven_day_sonnet', 'Sonnet 7 天'],
    ] as const) {
      const window = record(root?.[id])
      if (!window) continue
      const usedPercent = percentage(window.utilization)
      group.quotaWindows.push({
        id: id.replaceAll('_', '-'),
        label,
        unit: 'credits',
        ...(usedPercent === undefined
          ? {}
          : {
              used: usedPercent,
              limit: 100,
              remaining: 100 - usedPercent,
              remainingPercent: 100 - usedPercent,
            }),
        ...(timestamp(window.resets_at) === undefined
          ? {}
          : { resetsAt: timestamp(window.resets_at)! }),
        state: usedPercent !== undefined && usedPercent >= 100 ? 'exhausted' : 'normal',
      })
    }
    const extra = record(root?.extra_usage)
    if (extra?.is_enabled === true) {
      const limit = number(extra.monthly_limit)
      const used = number(extra.used_credits)
      group.quotaWindows.push({
        id: 'extra-usage',
        label: 'Extra Usage',
        unit: 'credits',
        ...(limit === undefined ? {} : { limit }),
        ...(used === undefined ? {} : { used }),
        ...(limit === undefined || used === undefined
          ? {}
          : { remaining: Math.max(0, limit - used) }),
        state: limit !== undefined && used !== undefined && used >= limit ? 'exhausted' : 'normal',
      })
    }
    return {
      ...emptySource(source, 'available', credential.connection),
      checkedAt: context.now,
      groups: [group],
    }
  },
})

const kimiCode = adapter({
  sourceId: 'kimi-code',
  providerIds: ['kimi-for-coding', 'kimi-coding'],
  displayName: 'Kimi Code 用量',
  scope: 'subscription',
  stability: 'experimental',
  capabilities: ['quota'],
  credential: { kind: 'provider', envNames: ['KIMI_API_KEY'] },
  query: async (context, source) => {
    const credential = await providerCredential(context, source)
    if (!credential) return emptySource(source, 'not-connected')
    const root = requiredRecord(
      await context.request('https://api.kimi.com/coding/v1/usages', {
        headers: bearer(credential),
      }),
      'Kimi Code',
    )
    const limitItems = requiredList(root.limits, 'Kimi Code')
    const group = emptyGroup('coding', 'Coding Plan')
    const overview = record(root?.usage)
    if (overview) {
      const maximum = number(overview.limit ?? overview.total)
      const used = number(overview.used ?? overview.usage)
      const remaining =
        number(overview.remaining) ??
        (maximum !== undefined && used !== undefined ? Math.max(0, maximum - used) : undefined)
      group.quotaWindows.push({
        id: 'overview',
        label: '套餐总览',
        unit: 'requests',
        ...(maximum === undefined ? {} : { limit: maximum }),
        ...(used === undefined ? {} : { used }),
        ...(remaining === undefined ? {} : { remaining }),
        ...(timestamp(
          overview.reset_at ?? overview.resetAt ?? overview.reset_time ?? overview.resetTime,
        ) === undefined
          ? {}
          : {
              resetsAt: timestamp(
                overview.reset_at ?? overview.resetAt ?? overview.reset_time ?? overview.resetTime,
              )!,
            }),
        state:
          remaining === 0
            ? 'exhausted'
            : maximum === undefined && remaining === undefined
              ? 'unlimited'
              : 'normal',
      })
    }
    for (const [index, item] of limitItems.entries()) {
      const envelope = record(item)
      const limit = record(envelope?.detail) ?? envelope
      if (!limit) continue
      const maximum = number(limit.limit)
      const used = number(limit.used)
      const remaining =
        number(limit.remaining) ??
        (maximum !== undefined && used !== undefined ? Math.max(0, maximum - used) : undefined)
      const window = record(envelope?.window) ?? record(limit.window)
      const duration = number(window?.duration)
      const unit = text(window?.timeUnit)
        ?.toUpperCase()
        .replace(/^TIME_UNIT_/, '')
      const label =
        (duration === 5 && unit === 'HOUR') || (duration === 300 && unit === 'MINUTE')
          ? '5 小时'
          : duration === 7 && unit === 'DAY'
            ? '每周'
            : (text(limit.label) ?? `额度 ${index + 1}`)
      group.quotaWindows.push({
        id: `limit-${index + 1}`,
        label,
        unit: 'requests',
        ...(maximum === undefined ? {} : { limit: maximum }),
        ...(used === undefined ? {} : { used }),
        ...(remaining === undefined ? {} : { remaining }),
        ...(timestamp(
          envelope?.reset_at ??
            envelope?.resetAt ??
            envelope?.reset_time ??
            envelope?.resetTime ??
            limit.reset_at ??
            limit.resetAt ??
            limit.reset_time ??
            limit.resetTime,
        ) === undefined
          ? {}
          : {
              resetsAt: timestamp(
                envelope?.reset_at ??
                  envelope?.resetAt ??
                  envelope?.reset_time ??
                  envelope?.resetTime ??
                  limit.reset_at ??
                  limit.resetAt ??
                  limit.reset_time ??
                  limit.resetTime,
              )!,
            }),
        state:
          remaining === 0
            ? 'exhausted'
            : maximum === undefined && remaining === undefined
              ? 'unlimited'
              : 'normal',
      })
    }
    return {
      ...emptySource(source, 'available', credential.connection),
      checkedAt: context.now,
      groups: [group],
    }
  },
})

const zhipuCoding = (region: 'global' | 'cn') =>
  adapter({
    sourceId: region === 'cn' ? 'zhipu-coding-plan' : 'zai-coding-plan',
    providerIds:
      region === 'cn'
        ? ['zhipuai-coding-plan', 'zhipuai', 'zai-coding-cn']
        : ['zai-coding-plan', 'zai'],
    displayName: region === 'cn' ? '智谱 Coding Plan' : 'Z.ai Coding Plan',
    scope: 'subscription',
    stability: 'experimental',
    capabilities: ['quota', 'usage'],
    credential: {
      kind: 'provider',
      envNames: region === 'cn' ? ['ZHIPU_API_KEY'] : ['ZAI_API_KEY'],
    },
    query: async (context, source) => {
      const credential = await providerCredential(context, source)
      if (!credential) return emptySource(source, 'not-connected')
      const host = region === 'cn' ? 'https://open.bigmodel.cn' : 'https://api.z.ai'
      const dates = queryDates(context)
      const params = new URLSearchParams({
        startTime: dates.startIso.replace('T', ' ').slice(0, 19),
        endTime: dates.endIso.replace('T', ' ').slice(0, 19),
      })
      const headers = { Authorization: apiKey(credential) }
      const [modelRoot, toolRoot, quotaRoot] = await Promise.all([
        context.request(`${host}/api/monitor/usage/model-usage?${params}`, { headers }),
        context.request(`${host}/api/monitor/usage/tool-usage?${params}`, { headers }),
        context.request(`${host}/api/monitor/usage/quota/limit`, { headers }),
      ])
      const modelData = requiredRecord(
        requiredRecord(modelRoot, 'Coding Plan model usage').data,
        'Coding Plan model usage',
      )
      const toolData = requiredRecord(
        requiredRecord(toolRoot, 'Coding Plan tool usage').data,
        'Coding Plan tool usage',
      )
      const quotaData = requiredRecord(
        requiredRecord(quotaRoot, 'Coding Plan quota').data,
        'Coding Plan quota',
      )
      const group = emptyGroup('coding', 'Coding Plan')
      const quotaItems = Array.isArray(quotaData.limits)
        ? quotaData.limits
        : Array.isArray(quotaData.list)
          ? quotaData.list
          : (() => {
              throw new UsageRequestError('invalid-response', 'Coding Plan 响应缺少额度列表', false)
            })()
      for (const [index, item] of quotaItems.entries()) {
        const limit = record(item)
        if (!limit) continue
        const usedPercent = percentage(limit.percentage)
        const type = text(limit.type)?.toUpperCase()
        const planUnit = number(limit.unit)
        const planNumber = number(limit.number)
        const label =
          type === 'TOKENS_LIMIT' && planUnit === 3 && planNumber === 5
            ? '5 小时'
            : type === 'TOKENS_LIMIT' && planUnit === 6
              ? '每周'
              : type === 'TIME_LIMIT'
                ? '月度工具额度'
                : (text(limit.name) ?? `额度 ${index + 1}`)
        group.quotaWindows.push({
          id: `quota-${index + 1}`,
          label,
          unit: type === 'TIME_LIMIT' ? 'requests' : 'tokens',
          ...(number(limit.usage) === undefined ? {} : { limit: number(limit.usage)! }),
          ...(number(limit.currentValue) === undefined
            ? {}
            : { used: number(limit.currentValue)! }),
          ...(number(limit.remaining) === undefined ? {} : { remaining: number(limit.remaining)! }),
          ...(usedPercent === undefined ? {} : { remainingPercent: 100 - usedPercent }),
          ...(timestamp(limit.nextResetTime) === undefined
            ? {}
            : { resetsAt: timestamp(limit.nextResetTime)! }),
          state: usedPercent !== undefined && usedPercent >= 100 ? 'exhausted' : 'normal',
        })
      }
      group.breakdown = [
        ...requiredList(modelData.list, 'Coding Plan model usage').flatMap((item, index) => {
          const value = record(item)
          if (!value) return []
          return [
            {
              id: text(value.model) ?? `model-${index + 1}`,
              label: text(value.model) ?? '模型',
              kind: 'model' as const,
              inputTokens: integer(value.inputTokens ?? value.input_tokens) ?? 0,
              outputTokens: integer(value.outputTokens ?? value.output_tokens) ?? 0,
              requests: integer(value.requests ?? value.count) ?? 0,
            },
          ]
        }),
        ...requiredList(toolData.list, 'Coding Plan tool usage').flatMap((item, index) => {
          const value = record(item)
          if (!value) return []
          return [
            {
              id: text(value.tool) ?? `tool-${index + 1}`,
              label: text(value.tool) ?? '工具',
              kind: 'tool' as const,
              requests: integer(value.requests ?? value.count ?? value.usage) ?? 0,
            },
          ]
        }),
      ]
      return {
        ...emptySource(source, 'available', credential.connection),
        checkedAt: context.now,
        groups: [group],
      }
    },
  })

const unsupported = (
  sourceId: string,
  displayName: string,
  providerIds: readonly string[],
  consoleUrl: string,
) =>
  adapter({
    sourceId,
    providerIds,
    displayName,
    availability: 'unsupported',
    capabilities: [],
    connectionMethod: { kind: 'external', consoleUrl },
    credential: { kind: 'none' },
    query: async (_context, source) => emptySource(source, 'unsupported'),
  })

export const providerUsageAdapters: readonly ProviderUsageAdapter[] = [
  deepSeek,
  minimax('global'),
  minimax('cn'),
  moonshot,
  siliconFlow('global'),
  siliconFlow('cn'),
  openRouterKey,
  fireworks,
  cloudflare,
  vercel,
  openAIAdmin,
  anthropicAdmin,
  xaiManagement,
  openRouterManagement,
  claudeSubscription,
  kimiCode,
  zhipuCoding('global'),
  zhipuCoding('cn'),
  unsupported(
    'google-console',
    'Google Gemini',
    ['google', 'google-vertex'],
    'https://aistudio.google.com/usage',
  ),
  unsupported('groq-console', 'Groq', ['groq'], 'https://console.groq.com/settings/billing'),
  unsupported(
    'together-console',
    'Together AI',
    ['togetherai', 'together'],
    'https://api.together.ai/settings/billing',
  ),
  unsupported('cerebras-console', 'Cerebras', ['cerebras'], 'https://cloud.cerebras.ai/'),
  unsupported(
    'huggingface-console',
    'Hugging Face',
    ['huggingface'],
    'https://huggingface.co/settings/billing',
  ),
  unsupported('nvidia-console', 'NVIDIA', ['nvidia'], 'https://build.nvidia.com/'),
  unsupported(
    'bedrock-console',
    'AWS Bedrock',
    ['amazon-bedrock'],
    'https://console.aws.amazon.com/costmanagement/',
  ),
  unsupported('azure-openai-console', 'Azure OpenAI', ['azure'], 'https://portal.azure.com/'),
  unsupported(
    'alibaba-console',
    '阿里百炼',
    ['alibaba', 'alibaba-cn'],
    'https://bailian.console.aliyun.com/',
  ),
  unsupported(
    'volcengine-console',
    '火山方舟',
    ['volcengine'],
    'https://console.volcengine.com/ark/',
  ),
  unsupported('mistral-console', 'Mistral', ['mistral'], 'https://console.mistral.ai/usage/'),
]
