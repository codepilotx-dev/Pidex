import type { AgentDatabase } from '../database/AgentDatabase'
export const recoverInterruptedRuns = (database: AgentDatabase) => {
  const timestamp = Date.now()
  database.repositories.interactions.convergeHookTrustDecisions()
  database.transaction(() => {
    // Offline time must not be billed as goal run time.
    database.repositories.threadGoalLedger.closeOpenIntervals(timestamp)
    database.repositories.interactions.recoverInterruptedInteractions(timestamp)
    database.repositories.executions.recoverInterruptedExecutions(timestamp)
    database.repositories.interactions.finalizeInterruptedQuestions(timestamp)
    database.repositories.subagents.recoverInterruptedSubagents(timestamp)
    // A verification whose result never arrived is audited as interrupted, never
    // re-sent: replaying it would charge the goal twice for one decision.
    database.repositories.threadGoalControls.interruptRunning()
    database.repositories.threadGoalControls.recoverObservations()
  })
}

export class InterruptedRunRecoveryCoordinator {
  constructor(private readonly database: AgentDatabase) {}

  run() {
    recoverInterruptedRuns(this.database)
  }
}
