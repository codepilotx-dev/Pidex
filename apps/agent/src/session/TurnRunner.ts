import type { AgentDatabase, QueuePauseReason } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import { Effect } from 'effect'
import type { TurnCoordinator, TurnTerminalStatus } from './TurnCoordinator'

type TerminalizeInput = {
  threadID: string
  turnID: string
  agentID: string
  status: TurnTerminalStatus
  message?: string
  pauseReason?: Exclude<QueuePauseReason, null>
}

/**
 * Owns the one-way transition from a running main Turn to its terminal state.
 * Callers coordinate admission first; this class makes persistence, outbox
 * publication, grant cleanup and terminal-promise resolution one operation.
 */
export class TurnRunner {
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly coordinator: TurnCoordinator,
    private readonly clearTurnPermissionGrants: (threadID: string, turnID: string) => void,
  ) {}

  async terminalize(input: TerminalizeInput): Promise<TurnTerminalStatus> {
    const row = this.db.sqlite
      .query('SELECT status FROM turns WHERE id = ? AND thread_id = ?')
      .get(input.turnID, input.threadID) as { status: string } | null
    if (row?.status === 'completed' || row?.status === 'failed' || row?.status === 'interrupted') {
      const status = row.status
      this.clearTurnPermissionGrants(input.threadID, input.turnID)
      this.coordinator.finish(input.threadID, input.turnID, status)
      return status
    }
    const result = this.db.finalizeTurn(input)
    for (const event of result.events) await Effect.runPromise(this.hub.publish(event))
    this.clearTurnPermissionGrants(input.threadID, input.turnID)
    this.coordinator.finish(input.threadID, input.turnID, input.status)
    return input.status
  }
}
