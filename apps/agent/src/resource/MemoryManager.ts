import type {
  MemoryStats,
  SystemShrinkMemoryResult,
  SystemShrinkReason,
} from '@pidex/agent-protocol'
import type { AgentLogger } from '../observability/AgentLogger'

export type MemoryShrinkHook = () => Promise<void> | void

export interface MemoryManagerOptions {
  readonly logger?: Pick<AgentLogger, 'info' | 'warn' | 'debug' | 'error'> | undefined
  readonly debounceMs?: number | undefined
  readonly idleIntervalMs?: number | undefined
  readonly now?: (() => number) | undefined
}

const DEFAULT_DEBOUNCE_MS = 1_500
const DEFAULT_IDLE_INTERVAL_MS = 60_000

export class MemoryManager {
  private readonly logger: Pick<AgentLogger, 'info' | 'warn' | 'debug' | 'error'> | undefined
  private readonly debounceMs: number
  private readonly idleIntervalMs: number
  private readonly now: () => number

  private readonly hooks = new Map<string, MemoryShrinkHook>()
  private activeTurns = 0
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private isShrinking = false
  private disposed = false

  private lastShrinkAt: number | null = null
  private shrinkCount = 0

  constructor(options: MemoryManagerOptions = {}) {
    this.logger = options.logger
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.idleIntervalMs = options.idleIntervalMs ?? DEFAULT_IDLE_INTERVAL_MS
    this.now = options.now ?? Date.now
  }

  /**
   * Register a cleanup or cache reduction hook to be called on shrink.
   * Returns an unregister function.
   */
  registerHook(name: string, hook: MemoryShrinkHook): () => void {
    this.hooks.set(name, hook)
    return () => {
      if (this.hooks.get(name) === hook) {
        this.hooks.delete(name)
      }
    }
  }

  /**
   * Called when an Agent turn starts.
   * Aborts pending shrink debounce timers and resets idle timer.
   */
  notifyTurnStarted(): void {
    if (this.disposed) return
    this.activeTurns++
    this.clearDebounceTimer()
    this.clearIdleTimer()
  }

  /**
   * Called when an Agent turn completes (or fails/cancels).
   * Decrements active count and schedules post-turn debounced shrink.
   */
  notifyTurnCompleted(): void {
    if (this.disposed) return
    this.activeTurns = Math.max(0, this.activeTurns - 1)
    if (this.activeTurns === 0) {
      this.scheduleDebouncedShrink()
      this.armIdleTimer()
    }
  }

  /**
   * Returns current process memory snapshot.
   */
  getStats(): MemoryStats {
    const memory = process.memoryUsage()
    return {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    }
  }

  get diagnostics(): { activeTurns: number; shrinkCount: number; lastShrinkAt: number | null } {
    return {
      activeTurns: this.activeTurns,
      shrinkCount: this.shrinkCount,
      lastShrinkAt: this.lastShrinkAt,
    }
  }

  /**
   * Performs memory shrinkage and garbage collection.
   * Safe: will skip execution if there are active turns running.
   */
  async shrink(reason: SystemShrinkReason = 'manual'): Promise<SystemShrinkMemoryResult> {
    if (this.disposed || this.activeTurns > 0 || this.isShrinking) {
      return {
        success: false,
        stats: this.getStats(),
      }
    }

    this.isShrinking = true
    const startTime = this.now()
    const statsBefore = this.getStats()

    try {
      // 1. Run all registered module hooks (e.g. SQLite shrink, LRU cache purges)
      for (const [name, hook] of this.hooks) {
        try {
          await hook()
        } catch (cause) {
          this.logger?.warn('memory.hook_failed', {
            hook: name,
            message: cause instanceof Error ? cause.message : String(cause),
          })
        }
      }

      // 2. Trigger runtime GC if available (Bun.gc or global.gc)
      this.triggerRuntimeGc()

      const statsAfter = this.getStats()
      const freedRssBytes = statsBefore.rss - statsAfter.rss
      const durationMs = Math.max(0, this.now() - startTime)

      this.shrinkCount++
      this.lastShrinkAt = this.now()

      this.logger?.[reason === 'manual' ? 'info' : 'debug']('memory.shrink', {
        reason,
        durationMs,
        rssBefore: statsBefore.rss,
        rssAfter: statsAfter.rss,
        freedRssBytes,
        heapUsedBefore: statsBefore.heapUsed,
        heapUsedAfter: statsAfter.heapUsed,
        externalBefore: statsBefore.external,
        externalAfter: statsAfter.external,
      })

      return {
        success: true,
        stats: statsAfter,
        freedRssBytes,
      }
    } finally {
      this.isShrinking = false
    }
  }

  private triggerRuntimeGc(): void {
    try {
      if (typeof Bun !== 'undefined' && typeof (Bun as { gc?: unknown }).gc === 'function') {
        ;(Bun as { gc: (sync: boolean) => void }).gc(true)
      } else if (typeof globalThis.gc === 'function') {
        globalThis.gc()
      }
    } catch {}
  }

  private scheduleDebouncedShrink(): void {
    this.clearDebounceTimer()
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.shrink('turn_end')
    }, this.debounceMs)
  }

  private armIdleTimer(): void {
    this.clearIdleTimer()
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      void this.onIdleTimeout()
    }, this.idleIntervalMs)
  }

  private async onIdleTimeout(): Promise<void> {
    if (this.disposed || this.activeTurns > 0) return
    await this.shrink('idle')
    if (!this.disposed && this.activeTurns === 0) {
      this.armIdleTimer()
    }
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  dispose(): void {
    this.disposed = true
    this.clearDebounceTimer()
    this.clearIdleTimer()
    this.hooks.clear()
  }
}
