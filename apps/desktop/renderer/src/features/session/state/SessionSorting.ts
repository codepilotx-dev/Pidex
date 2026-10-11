import type { SessionListItem } from '../../../UiTypes.js'
import type { DesktopSidebarSort } from '../../../../shared/Types.js'

export function sortSessionsByRecency<T extends SessionListItem>(sessions: readonly T[]): T[] {
  return [...sessions].sort(compareSessionsByRecency)
}

export type SidebarSessionSortOptions = {
  sort: DesktopSidebarSort
  needsInputSessionIds: ReadonlySet<string>
  unreadSessionIds: ReadonlySet<string>
  scopeKey?: string
  manualOrderByScope: Record<string, readonly string[]>
}

export function sortSessionsForSidebar<T extends SessionListItem>(
  sessions: readonly T[],
  options: SidebarSessionSortOptions,
): T[] {
  if (options.sort === 'manual') {
    return sortSessionsByManualOrder(sessions, options)
  }
  // 普通列表只提供“最近更新 / 手动排序”；历史 priority 值按最近更新呈现。
  return sortSessionsByRecency(sessions)
}

export function compareSessionsByRecency<T extends SessionListItem>(left: T, right: T): number {
  return (
    sessionRecencyMs(right) - sessionRecencyMs(left) ||
    timestampMs(right.createdAt) - timestampMs(left.createdAt) ||
    right.id.localeCompare(left.id)
  )
}

function sortSessionsByManualOrder<T extends SessionListItem>(
  sessions: readonly T[],
  options: Pick<SidebarSessionSortOptions, 'manualOrderByScope' | 'scopeKey'>,
): T[] {
  const recentSessions = sortSessionsByRecency(sessions)
  const order = options.scopeKey ? (options.manualOrderByScope[options.scopeKey] ?? []) : []
  if (order.length === 0) return recentSessions

  const sessionById = new Map(recentSessions.map((session) => [session.id, session]))
  const storedSessions: T[] = []
  const storedIds = new Set<string>()
  for (const sessionId of order) {
    const session = sessionById.get(sessionId)
    if (!session || storedIds.has(sessionId)) continue
    storedIds.add(sessionId)
    storedSessions.push(session)
  }
  let storedIndex = 0
  return recentSessions.map((session) => {
    if (!storedIds.has(session.id)) return session
    const storedSession = storedSessions[storedIndex]
    storedIndex += 1
    return storedSession ?? session
  })
}

function sessionRecencyMs(session: SessionListItem): number {
  return timestampMs(session.lastMessageAt ?? session.createdAt)
}

function timestampMs(value: string | null | undefined): number {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}
