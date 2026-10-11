import type { TurnStatus } from '@pidex/shared/thread'

import type { DesktopSessionStatus } from '../../../shared/Types.js'

/**
 * Status a session row must show when the canonical thread projection has a
 * fresher answer than the catalog snapshot.
 */
export type SessionStatusOverride = {
  status: DesktopSessionStatus
  latestTurnStatus: TurnStatus | null
}

/** Shape shared by session list items and session store snapshots' items. */
export type SessionStatusCarrier = {
  id: string
  status: DesktopSessionStatus
  latestTurnStatus?: TurnStatus | null
}

const ACTIVE_SESSION_STATUSES: ReadonlySet<DesktopSessionStatus> = new Set([
  'queued',
  'waiting',
  'running',
])

/** Whether any row still claims work is in flight, i.e. worth reconciling. */
export function hasNonTerminalSessionStatus(sessions: readonly SessionStatusCarrier[]): boolean {
  return sessions.some((session) => ACTIVE_SESSION_STATUSES.has(session.status))
}

/**
 * Applies an override to one session row. Rows without an override, and rows
 * whose value already matches, keep their identity so an unchanged emit neither
 * rerenders subscribers nor fabricates status transitions for the notification
 * and pet projections.
 */
export function withSessionStatusOverride<T extends SessionStatusCarrier>(
  session: T,
  override: SessionStatusOverride | undefined,
): T {
  if (!override) return session
  if (
    session.status === override.status &&
    (session.latestTurnStatus ?? null) === override.latestTurnStatus
  ) {
    return session
  }
  return {
    ...session,
    status: override.status,
    latestTurnStatus: override.latestTurnStatus,
  }
}
