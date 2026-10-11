import type { AutomationSchedule, AutomationWeekday } from '@pidex/shared/automation'
import { RRule, rrulestr } from 'rrule'
import { AgentError } from '../Domain'

const WEEKDAYS: readonly AutomationWeekday[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
const WEEKDAY_INDEX = new Map(WEEKDAYS.map((day, index) => [day, index] as const))
const RRULE_WEEKDAYS = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
} as const

export type AutomationSchedulePreview = {
  canonicalRrule: string
  summary: string
  nextRunAt: number[]
}

const fail = (message: string, cause?: unknown): never => {
  throw new AgentError(
    'INVALID_REQUEST',
    message,
    400,
    cause instanceof Error ? cause.name : undefined,
  )
}

const assertTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
  } catch {
    fail('自动化时区无效')
  }
}

const parseTime = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim())
  if (!match) return fail('排期时间必须使用 HH:mm 格式')
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return fail('排期时间超出有效范围')
  return { hour, minute }
}

const canonicalPreset = (schedule: Exclude<AutomationSchedule, { mode: 'custom' }>) => {
  if (schedule.mode === 'hourly') {
    if (
      !Number.isInteger(schedule.intervalMinutes) ||
      schedule.intervalMinutes < 1 ||
      schedule.intervalMinutes > 43_200
    )
      return fail('小时排期的分钟间隔必须在 1 到 43200 之间')
    return `FREQ=MINUTELY;INTERVAL=${schedule.intervalMinutes};BYSECOND=0`
  }
  const { hour, minute } = parseTime(schedule.time)
  const time = `BYHOUR=${hour};BYMINUTE=${minute};BYSECOND=0`
  if (schedule.mode === 'daily') return `FREQ=DAILY;${time}`
  if (schedule.mode === 'weekdays') return `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;${time}`
  const days = [...new Set(schedule.weekdays)].sort(
    (left, right) => (WEEKDAY_INDEX.get(left) ?? 7) - (WEEKDAY_INDEX.get(right) ?? 7),
  )
  if (!days.length || days.some((day) => !WEEKDAY_INDEX.has(day)))
    return fail('每周排期必须包含有效星期')
  return `FREQ=WEEKLY;BYDAY=${days.join(',')};${time}`
}

const parseRrule = (value: string) => {
  const source = value.trim().replace(/^RRULE:/i, '')
  if (!source || /(?:^|\r?\n)DTSTART[:;]/i.test(value))
    return fail('只接受不含 DTSTART 的 RRULE；时区由自动化设置统一提供')
  if (/(?:^|;)(?:COUNT|UNTIL)=/i.test(source))
    return fail('自动化 RRULE 必须持续重复，暂不支持 COUNT 或 UNTIL')
  try {
    const parsed = rrulestr(`RRULE:${source}`, { forceset: false })
    if (!(parsed instanceof RRule)) return fail('RRULE 必须描述单一重复规则')
    return parsed
  } catch (cause) {
    return fail('RRULE 格式无效', cause)
  }
}

const rruleLine = (rule: RRule) => {
  const line = rule
    .toString()
    .split(/\r?\n/)
    .find((value) => value.startsWith('RRULE:'))
  return line?.slice('RRULE:'.length) ?? fail('RRULE 无法规范化')
}

export const canonicalizeAutomationSchedule = (schedule: AutomationSchedule) =>
  schedule.mode === 'custom' ? rruleLine(parseRrule(schedule.rrule)) : canonicalPreset(schedule)

const localScalarNear = (timestamp: number, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts = Object.fromEntries(
    formatter.formatToParts(timestamp).map((part) => [part.type, part.value]),
  )
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
}

/** Fast-forwards the stable epoch phase near the query; `rrule` still owns recurrence and DST semantics. */
const stableDtstartNear = (
  frequency: number | undefined,
  interval: number | undefined,
  timeZone: string,
  after: number,
) => {
  const epoch = Date.UTC(1970, 0, 5)
  const local = localScalarNear(after, timeZone)
  const unit =
    frequency === RRule.MINUTELY
      ? 60_000
      : frequency === RRule.HOURLY
        ? 3_600_000
        : frequency === RRule.DAILY
          ? 86_400_000
          : frequency === RRule.WEEKLY
            ? 7 * 86_400_000
            : null
  if (!unit) return new Date(Date.UTC(Math.max(1970, new Date(local).getUTCFullYear() - 1), 0, 1))
  const span = unit * Math.max(1, interval ?? 1)
  return new Date(epoch + Math.max(0, Math.floor((local - epoch) / span) - 1) * span)
}

const ruleFor = (schedule: AutomationSchedule, timeZone: string, after: number) => {
  assertTimeZone(timeZone)
  const parsed = parseRrule(canonicalizeAutomationSchedule(schedule))
  const byweekday =
    schedule.mode === 'weekly'
      ? [...new Set(schedule.weekdays)].map((day) => RRULE_WEEKDAYS[day])
      : schedule.mode === 'weekdays'
        ? [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR]
        : parsed.origOptions.byweekday
  return new RRule({
    ...parsed.origOptions,
    dtstart: stableDtstartNear(
      parsed.origOptions.freq,
      parsed.origOptions.interval,
      timeZone,
      after,
    ),
    tzid: timeZone,
    ...(byweekday === undefined ? {} : { byweekday }),
  })
}

export const nextAutomationOccurrence = (
  schedule: AutomationSchedule,
  timeZone: string,
  after: number,
): number | null => {
  if (!Number.isFinite(after)) return fail('排期基准时间无效')
  return ruleFor(schedule, timeZone, after).after(new Date(after), false)?.getTime() ?? null
}

export const automationOccurrencesBetween = (
  schedule: AutomationSchedule,
  timeZone: string,
  from: number,
  to: number,
  max = 2_000,
): number[] => {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) return fail('日历时间范围无效')
  const limit = Math.max(1, Math.min(2_000, Math.trunc(max)))
  const rule = ruleFor(schedule, timeZone, from)
  const occurrences: number[] = []
  let next = rule.after(new Date(from), true)
  while (next && next.getTime() <= to && occurrences.length < limit) {
    occurrences.push(next.getTime())
    next = rule.after(next, false)
  }
  return occurrences
}

export const previewAutomationSchedule = (
  schedule: AutomationSchedule,
  timeZone: string,
  after = Date.now(),
  count = 5,
): AutomationSchedulePreview => {
  const rule = ruleFor(schedule, timeZone, after)
  const occurrences: number[] = []
  let cursor = new Date(after)
  for (let index = 0; index < Math.max(1, Math.min(20, count)); index += 1) {
    const next = rule.after(cursor, false)
    if (!next) break
    occurrences.push(next.getTime())
    cursor = next
  }
  const summary =
    schedule.mode === 'hourly'
      ? `每 ${schedule.intervalMinutes} 分钟`
      : schedule.mode === 'daily'
        ? `每天 ${schedule.time}`
        : schedule.mode === 'weekdays'
          ? `工作日 ${schedule.time}`
          : schedule.mode === 'weekly'
            ? `每周 ${schedule.weekdays.join('、')} ${schedule.time}`
            : `自定义 ${canonicalizeAutomationSchedule(schedule)}`
  return {
    canonicalRrule: canonicalizeAutomationSchedule(schedule),
    summary: `${summary}（${timeZone}）`,
    nextRunAt: occurrences,
  }
}
