export type AutoResolutionRegistration = {
  id: string
  deadline: number
  resolve: () => Promise<void>
}

export type QuestionAutoResolutionSchedulerOptions = {
  isPending: (id: string) => boolean
  now?: () => number
  retryDelaysMs?: readonly number[]
}

/** Timers are wake-up hints; the question row CAS remains the durable owner. */
export class QuestionAutoResolutionScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly attempts = new Map<string, number>()
  private readonly now: () => number
  private readonly retryDelaysMs: readonly number[]

  constructor(private readonly options: QuestionAutoResolutionSchedulerOptions) {
    this.now = options.now ?? Date.now
    this.retryDelaysMs = options.retryDelaysMs ?? [1_000, 2_000, 5_000, 10_000, 30_000]
  }

  track(registration: AutoResolutionRegistration) {
    this.forget(registration.id)
    this.schedule(registration, Math.max(0, registration.deadline - this.now()))
  }

  forget(id: string) {
    const timer = this.timers.get(id)
    if (timer) clearTimeout(timer)
    this.timers.delete(id)
    this.attempts.delete(id)
  }

  dispose() {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.attempts.clear()
  }

  private schedule(registration: AutoResolutionRegistration, delay: number) {
    const timer = setTimeout(() => {
      this.timers.delete(registration.id)
      void registration.resolve().then(
        () => this.forget(registration.id),
        () => {
          let pending = true
          try {
            pending = this.options.isPending(registration.id)
          } catch {
            pending = true
          }
          if (!pending) {
            this.forget(registration.id)
            return
          }
          const attempt = this.attempts.get(registration.id) ?? 0
          this.attempts.set(registration.id, attempt + 1)
          const retryDelay =
            this.retryDelaysMs[Math.min(attempt, this.retryDelaysMs.length - 1)] ?? 30_000
          this.schedule(registration, retryDelay)
        },
      )
    }, delay)
    timer.unref?.()
    this.timers.set(registration.id, timer)
  }
}
