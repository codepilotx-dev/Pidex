import type { AutomationRun } from '@pidex/shared/automation'
import type { ScheduledTask } from '@pidex/shared/scheduled-task'
import type { AutomationRepository } from '../storage/repositories/AutomationRepository'
import type { ScheduledTaskRepository } from '../storage/repositories/ScheduledTaskRepository'

const MAX_TIMER_DELAY = 2_147_000_000

export type AutomationSchedulerOptions = {
  now?: () => number
  onClaimed: (runs: AutomationRun[]) => void | Promise<void>
  scheduledTasks?: {
    repository: ScheduledTaskRepository
    onClaimed: (tasks: ScheduledTask[]) => void | Promise<void>
  }
  onError?: (cause: unknown) => void
}

/** Timers are wake-up hints; SQLite claim state remains the durable owner. */
export class AutomationScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false
  private disposed = false
  private draining: Promise<void> | null = null
  private rerun = false
  private readonly now: () => number

  constructor(
    private readonly repository: AutomationRepository,
    private readonly options: AutomationSchedulerOptions,
  ) {
    this.now = options.now ?? Date.now
  }

  start() {
    if (this.started || this.disposed) return
    this.started = true
    void this.wake()
  }

  wake(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.draining) {
      this.rerun = true
      return this.draining
    }
    this.draining = this.drain().finally(() => {
      this.draining = null
      if (this.rerun && !this.disposed) {
        this.rerun = false
        void this.wake()
      }
    })
    return this.draining
  }

  dispose() {
    this.disposed = true
    this.started = false
    this.clearTimer()
  }

  private async drain() {
    this.clearTimer()
    try {
      const runs = this.repository.claimDue(this.now(), 'scheduled')
      if (runs.length) await this.options.onClaimed(runs)
      const tasks = this.options.scheduledTasks?.repository.claimDue(this.now()) ?? []
      if (tasks.length) await this.options.scheduledTasks?.onClaimed(tasks)
    } catch (cause) {
      this.options.onError?.(cause)
    }
    if (!this.disposed) this.arm()
  }

  private arm() {
    const deadlines = [
      this.repository.nextDeadline(),
      this.options.scheduledTasks?.repository.nextDeadline() ?? null,
    ].filter((value): value is number => value !== null)
    const deadline = deadlines.length ? Math.min(...deadlines) : null
    if (deadline === null) return
    const delay = Math.max(0, Math.min(MAX_TIMER_DELAY, deadline - this.now()))
    this.timer = setTimeout(() => {
      this.timer = null
      void this.wake()
    }, delay)
    this.timer.unref?.()
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
