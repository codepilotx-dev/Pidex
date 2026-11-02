import type { AgentDatabase, QueuePauseReason } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import { Effect } from 'effect'
import type { TurnCoordinator, TurnTerminalStatus } from './TurnCoordinator'
import type { GoalContinuationCoordinator } from '../orchestration/GoalContinuationCoordinator'

type TerminalizeInput = {
  threadID: string
  turnID: string
  agentID: string
  status: TurnTerminalStatus
  message?: string
  goalBudget?: { goalId: string; revision: number }
  pauseReason?: Exclude<QueuePauseReason, null>
}

/**
 * Owns the one-way transition from a running main Turn to its terminal state.
 * Callers coordinate admission first; this class makes persistence, outbox
 * publication, grant cleanup and terminal-promise resolution one operation, and
 * then hands the settled turn to the goal coordinator.
 */
export class TurnRunner {
  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly coordinator: TurnCoordinator,
    private readonly clearTurnPermissionGrants: (threadID: string, turnID: string) => void,
    private readonly goals?: GoalContinuationCoordinator,
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
    // Only now, after the turn and its metering are visible to every reader, does
    // the goal decide whether to verify, continue or pause. A verification is a
    // network call, so the user's reply is never held behind it.
    if (result.settleGoal && this.goals) {
      void this.goals.settle(result.settleGoal).catch(() => undefined)
    }
    return input.status
  }
}
