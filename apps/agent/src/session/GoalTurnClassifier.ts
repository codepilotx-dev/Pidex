import { ThreadGoalControlRepository } from '../storage/repositories/ThreadGoalControlRepository'
import type { RepositoryDatabase } from '../storage/repositories/RepositoryDatabase'
import type { GoalTurnClassification } from '../storage/repositories/ThreadGoalControlRepository'

/**
 * Tools whose success never proves that the goal advanced. Discovery and
 * planning only describe work; `update_goal` is the terminal handshake, not a
 * delivery, and a failed call is excluded by the item status.
 */
const NON_PROGRESS_TOOLS = ['ToolSearch', 'update_plan', 'update_goal'] as const

/** Subagent task states that still represent host-verifiable waiting. */
const OPEN_SUBAGENT_STATES = `('queued','preparing','running','steering','waiting_question','waiting_permission')`

export type GoalTurnFacts = {
  /** A successful tool produced evidence not already observed in this goal. */
  hasProgress: boolean
  /** The host holds a resumable wait for this turn. */
  hasWaiting: boolean
}

/**
 * Reads only host state, never model prose. A model saying "I am waiting" or
 * sleeping is not evidence; a registered approval, question, checkpoint lease or
 * live child task is.
 */
export class GoalTurnClassifier {
  constructor(private readonly db: Pick<RepositoryDatabase, 'sqlite'>) {}

  facts(turnId: string): GoalTurnFacts {
    return { hasProgress: this.hasProgress(turnId), hasWaiting: this.hasWaiting(turnId) }
  }

  private hasProgress(turnId: string): boolean {
    const rows = new ThreadGoalControlRepository(this.db).progressEvidence(turnId)
    const fingerprint = (row: (typeof rows)[number]) => {
      const data = JSON.parse(row.data)
      return JSON.stringify([row.type, data.tool, data.input, data.output, data.patch])
    }
    const prior = new Set(
      rows.filter((row) => !row.current && row.status === 'completed').map(fingerprint),
    )
    return rows.some((row) => {
      if (!row.current || row.status !== 'completed') return false
      const data = JSON.parse(row.data)
      if (NON_PROGRESS_TOOLS.includes(data.tool)) return false
      // A new successful observation may advance investigation; the same result cannot do so again.
      return !prior.has(fingerprint(row))
    })
  }

  private hasWaiting(turnId: string): boolean {
    if (
      this.db.sqlite
        .query(
          `SELECT 1 FROM subagent_tasks WHERE parent_turn_id = ? AND status IN ${OPEN_SUBAGENT_STATES} LIMIT 1`,
        )
        .get(turnId)
    )
      return true
    if (
      this.db.sqlite
        .query(
          "SELECT 1 FROM approval_requests WHERE turn_id = ? AND status IN ('preparing','pending') LIMIT 1",
        )
        .get(turnId)
    )
      return true
    if (
      this.db.sqlite
        .query(
          "SELECT 1 FROM question_requests WHERE turn_id = ? AND status IN ('pending','resolved','resuming') LIMIT 1",
        )
        .get(turnId)
    )
      return true
    return Boolean(
      this.db.sqlite
        .query(
          "SELECT 1 FROM resume_checkpoint_leases WHERE turn_id = ? AND status IN ('available','acquired') LIMIT 1",
        )
        .get(turnId),
    )
  }

  /**
   * Host-fact classification for a terminal turn. Precedence is waiting, then
   * progress, then a submitted blocker candidate, then no-progress; the caller
   * supplies the blocker candidate because it is a recorded decision rather than
   * a readable fact.
   */
  classify(input: { turnId: string; hasBlockerCandidate: boolean }): GoalTurnClassification {
    const facts = this.facts(input.turnId)
    if (facts.hasWaiting) return 'waiting'
    if (facts.hasProgress) return 'progress'
    return input.hasBlockerCandidate ? 'blocker-candidate' : 'no-progress'
  }
}
