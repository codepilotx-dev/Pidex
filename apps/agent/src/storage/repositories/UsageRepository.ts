import type { SessionTreeEntry } from '../../orchestration/harness/Types'
import type { LocalUsageResult } from '@pidex/agent-protocol'
import { Model, Provider } from '@pidex/model-schema'
import type { AgentDatabase } from '../database/AgentDatabase'
import { parsePiSessionEntry } from '../pi-session/PiSessionEntry'

export type LocalUsageRange = '7d' | '30d' | 'all'

type UsageRow = {
  id: string
  payload: string
  session_id: string
  thread_id: string
  parent_thread_id: string | null
}

type MutableUsage = {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  totalTokens: number
  requests: number
  modelResponses: number
  costUsd: number
}

const emptyUsage = (): MutableUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
  requests: 0,
  modelResponses: 0,
  costUsd: 0,
})

const finiteNonNegativeInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
const finiteNonNegative = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

const usageFrom = (entry: SessionTreeEntry) => {
  const raw =
    entry.type === 'message' && entry.message.role === 'assistant'
      ? entry.message.usage
      : entry.type === 'compaction' || entry.type === 'branch_summary'
        ? entry.usage
        : undefined
  if (!raw) return null
  const input = finiteNonNegativeInteger(raw.input)
  const output = finiteNonNegativeInteger(raw.output)
  const cacheRead = finiteNonNegativeInteger(raw.cacheRead)
  const cacheWrite = finiteNonNegativeInteger(raw.cacheWrite)
  const cost = finiteNonNegative(raw.cost?.total)
  if (input === null || output === null || cacheRead === null || cacheWrite === null) return null
  const cachedTokens = cacheRead + cacheWrite
  const totalTokens = input + output + cachedTokens
  if (!Number.isSafeInteger(cachedTokens) || !Number.isSafeInteger(totalTokens)) return null
  return {
    inputTokens: input,
    outputTokens: output,
    cachedTokens,
    totalTokens,
    costUsd: cost ?? 0,
  }
}

const canAdd = (
  target: MutableUsage,
  usage: NonNullable<ReturnType<typeof usageFrom>>,
  assistantResponse: boolean,
) =>
  Number.isSafeInteger(target.inputTokens + usage.inputTokens) &&
  Number.isSafeInteger(target.outputTokens + usage.outputTokens) &&
  Number.isSafeInteger(target.cachedTokens + usage.cachedTokens) &&
  Number.isSafeInteger(target.totalTokens + usage.totalTokens) &&
  Number.isSafeInteger(target.requests + 1) &&
  Number.isSafeInteger(target.modelResponses + (assistantResponse ? 1 : 0)) &&
  Number.isFinite(target.costUsd + usage.costUsd)

const add = (
  target: MutableUsage,
  usage: NonNullable<ReturnType<typeof usageFrom>>,
  assistantResponse: boolean,
) => {
  target.inputTokens += usage.inputTokens
  target.outputTokens += usage.outputTokens
  target.cachedTokens += usage.cachedTokens
  target.totalTokens += usage.totalTokens
  target.requests += 1
  if (assistantResponse) target.modelResponses += 1
  target.costUsd += usage.costUsd
}

const decimal = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

const dateFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

const localDate = (formatter: Intl.DateTimeFormat, at: number) => {
  const parts = formatter.formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

const utcDayOrdinal = (date: string) => {
  const [year, month, day] = date.split('-').map(Number)
  return Math.floor(Date.UTC(year!, month! - 1, day!) / 86_400_000)
}

const streaks = (activeDates: readonly string[], today: string) => {
  const ordinals = [...new Set(activeDates.map(utcDayOrdinal))].sort((a, b) => a - b)
  let longest = 0
  let running = 0
  let previous: number | undefined
  for (const ordinal of ordinals) {
    running = previous !== undefined && ordinal === previous + 1 ? running + 1 : 1
    longest = Math.max(longest, running)
    previous = ordinal
  }
  const todayOrdinal = utcDayOrdinal(today)
  let current = 0
  for (let ordinal = todayOrdinal; ordinals.includes(ordinal); ordinal -= 1) current += 1
  return { current, longest }
}

const rangeStartDate = (range: LocalUsageRange, today: string) => {
  if (range === 'all') return undefined
  const ordinal = utcDayOrdinal(today) - (range === '7d' ? 6 : 29)
  return new Date(ordinal * 86_400_000).toISOString().slice(0, 10)
}

const modelKey = (providerId: string, modelId: string) => `${providerId}\u0000${modelId}`

export class UsageRepository {
  constructor(
    private readonly db: AgentDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  getLocalUsage(range: LocalUsageRange, timeZone: string): LocalUsageResult {
    // Construction validates the IANA identifier and avoids server-locale grouping.
    const formatter = dateFormatter(timeZone)
    formatter.format(this.now())
    const generatedAt = this.now()
    const today = localDate(formatter, generatedAt)
    const startsAtDate = rangeStartDate(range, today)
    const rows = this.db.sqlite
      .query(
        `
      SELECT e.id, e.payload, e.session_id, s.thread_id, t.parent_thread_id
      FROM pi_session_entries AS e
      JOIN pi_sessions AS s ON s.id = e.session_id
      JOIN threads AS t ON t.id = s.thread_id
      WHERE e.type IN ('model_change', 'message', 'compaction', 'branch_summary')
      ORDER BY s.id, e.sequence
    `,
      )
      .all() as UsageRow[]
    const parentByThread = new Map(rows.map((row) => [row.thread_id, row.parent_thread_id]))
    for (const row of this.db.sqlite
      .query('SELECT id, parent_thread_id FROM threads')
      .all() as Array<{ id: string; parent_thread_id: string | null }>) {
      parentByThread.set(row.id, row.parent_thread_id)
    }
    const rootThread = (threadID: string) => {
      const visited = new Set<string>()
      let current = threadID
      while (!visited.has(current)) {
        visited.add(current)
        const parent = parentByThread.get(current)
        if (!parent) return current
        current = parent
      }
      return threadID
    }

    const totals = emptyUsage()
    const rootTasks = new Set<string>()
    const daily = new Map<string, MutableUsage & { models: Map<string, MutableUsage> }>()
    const models = new Map<string, MutableUsage & { providerId: string; modelId: string }>()
    const modelState = new Map<string, { providerId: string; modelId: string }>()

    for (const row of rows) {
      let entry: SessionTreeEntry
      try {
        entry = parsePiSessionEntry(row)
      } catch {
        continue
      }
      if (entry.type === 'model_change') {
        modelState.set(row.session_id, { providerId: entry.provider, modelId: entry.modelId })
        continue
      }
      const at = Date.parse(entry.timestamp)
      if (!Number.isFinite(at) || at > generatedAt) continue
      const date = localDate(formatter, at)
      if (startsAtDate !== undefined && date < startsAtDate) continue
      const usage = usageFrom(entry)
      if (!usage) continue
      const model =
        entry.type === 'message' &&
        entry.message.role === 'assistant' &&
        typeof entry.message.provider === 'string' &&
        entry.message.provider.trim() &&
        typeof entry.message.model === 'string' &&
        entry.message.model.trim()
          ? { providerId: entry.message.provider.trim(), modelId: entry.message.model.trim() }
          : modelState.get(row.session_id)
      if (!model?.providerId || !model.modelId) continue

      const day = daily.get(date) ?? { ...emptyUsage(), models: new Map<string, MutableUsage>() }
      const dayModelKey = modelKey(model.providerId, model.modelId)
      const dayModel = day.models.get(dayModelKey) ?? emptyUsage()
      const key = modelKey(model.providerId, model.modelId)
      const modelUsage = models.get(key) ?? { ...emptyUsage(), ...model }
      const assistantResponse = entry.type === 'message'
      if (
        ![totals, day, dayModel, modelUsage].every((target) =>
          canAdd(target, usage, assistantResponse),
        )
      )
        continue

      rootTasks.add(rootThread(row.thread_id))
      add(totals, usage, assistantResponse)
      add(day, usage, assistantResponse)
      add(dayModel, usage, assistantResponse)
      day.models.set(dayModelKey, dayModel)
      daily.set(date, day)
      add(modelUsage, usage, assistantResponse)
      models.set(key, modelUsage)
    }

    const dailyResult = [...daily.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, usage]) => ({
        date,
        totals: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedTokens: usage.cachedTokens,
          totalTokens: usage.totalTokens,
          estimatedCostUsd: decimal(usage.costUsd),
        },
        models: [...usage.models]
          .map(([key, modelUsage]) => {
            const [providerId, modelId] = key.split('\u0000')
            return {
              providerId: Provider.ID.make(providerId!),
              modelId: Model.ID.make(modelId!),
              displayName: modelId!,
              inputTokens: modelUsage.inputTokens,
              outputTokens: modelUsage.outputTokens,
              cachedTokens: modelUsage.cachedTokens,
              totalTokens: modelUsage.totalTokens,
              estimatedCostUsd: decimal(modelUsage.costUsd),
              modelResponses: modelUsage.modelResponses,
            }
          })
          .sort((left, right) => right.totalTokens - left.totalTokens),
      }))
    const streak = streaks(
      dailyResult.map((point) => point.date),
      today,
    )
    const modelResult = [...models.values()]
      .sort((left, right) => right.totalTokens - left.totalTokens)
      .map((usage) => ({
        providerId: Provider.ID.make(usage.providerId),
        modelId: Model.ID.make(usage.modelId),
        displayName: usage.modelId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens,
        totalTokens: usage.totalTokens,
        estimatedCostUsd: decimal(usage.costUsd),
        modelResponses: usage.modelResponses,
        sharePercent:
          totals.totalTokens > 0
            ? Math.min(100, (usage.totalTokens / totals.totalTokens) * 100)
            : 0,
      }))
    return {
      range,
      timeZone,
      generatedAt,
      totals: {
        inputTokens: totals.inputTokens,
        outputTokens: totals.outputTokens,
        cachedTokens: totals.cachedTokens,
        totalTokens: totals.totalTokens,
        estimatedCostUsd: decimal(totals.costUsd),
        rootTasks: rootTasks.size,
        modelResponses: totals.modelResponses,
        providerCalls: totals.requests,
        activeDays: dailyResult.length,
        currentStreak: streak.current,
        longestStreak: streak.longest,
      },
      daily: dailyResult,
      models: modelResult,
      heatmap: dailyResult.map(({ date, totals }) => ({
        date,
        totalTokens: totals.totalTokens,
        modelResponses: daily.get(date)?.modelResponses ?? 0,
      })),
    }
  }
}
