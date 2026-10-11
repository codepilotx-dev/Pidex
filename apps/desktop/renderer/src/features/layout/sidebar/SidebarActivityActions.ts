import type { SessionListItem } from '../../../UiTypes.js'

export function sessionNeedsStop(session: SessionListItem): boolean {
  return (
    session.pendingPlanApproval === true ||
    ['running', 'queued', 'waiting-subagents', 'waiting-question', 'waiting-permission'].includes(
      session.latestTurnStatus ?? '',
    )
  )
}

export async function archiveSidebarActivity(
  sessions: readonly SessionListItem[],
  interrupt: (id: string) => Promise<void>,
  archive: (sessions: readonly SessionListItem[]) => Promise<boolean>,
): Promise<number> {
  const results = await Promise.allSettled(
    sessions.map(async (session) => {
      if (sessionNeedsStop(session)) await interrupt(session.id)
      return session
    }),
  )
  const ready = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
  if (ready.length > 0) await archive(ready)
  return sessions.length - ready.length
}
