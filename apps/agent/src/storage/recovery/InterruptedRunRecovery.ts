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
  })
}

export class InterruptedRunRecoveryCoordinator {
  constructor(private readonly database: AgentDatabase) {}

  run() {
    recoverInterruptedRuns(this.database)
  }
}
