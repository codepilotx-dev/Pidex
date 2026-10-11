export type StartupRecoveryStages = {
  recoverInterruptedRuns: () => void
  discardRecoveredSideChats: () => void | Promise<void>
  recoverResumeLeases: () => void
  restoreQuestionTimers: () => void
  recoverSubagents: () => void | Promise<void>
  recoverHandoffs: () => void | Promise<void>
  recoverForks: () => void | Promise<void>
  recoverThreadWorktrees: () => void | Promise<void>
  recoverAutomations: () => void | Promise<void>
  startQueues: () => void
}

/**
 * Explicit readiness gate. A rejected stage is fatal and must prevent the
 * HTTP server (and therefore /api/ready) from being created.
 */
export class StartupRecoveryCoordinator {
  constructor(private readonly stages: StartupRecoveryStages) {}

  async run() {
    this.stages.recoverInterruptedRuns()
    await this.stages.discardRecoveredSideChats()
    this.stages.recoverResumeLeases()
    this.stages.restoreQuestionTimers()
    await this.stages.recoverSubagents()
    await this.stages.recoverHandoffs()
    await this.stages.recoverForks()
    await this.stages.recoverThreadWorktrees()
    await this.stages.recoverAutomations()
    this.stages.startQueues()
  }
}
