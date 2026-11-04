const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

/**
 * 相对时间文案。独立成模块，避免非侧栏调用方把悬停卡逻辑拉进同一 chunk。
 */
export function formatSidebarSessionRelativeTime(
  timestamp: string | null | undefined,
  now: number,
): string {
  const time = new Date(timestamp ?? '').getTime()
  if (Number.isNaN(time)) return '刚刚'

  const elapsed = Math.max(0, now - time)
  if (elapsed < MINUTE_MS) return '刚刚'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分`
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 小时`
  if (elapsed < MONTH_MS) return `${Math.floor(elapsed / DAY_MS)} 天`
  if (elapsed < YEAR_MS) return `${Math.floor(elapsed / MONTH_MS)} 月`
  return `${Math.floor(elapsed / YEAR_MS)} 年`
}
