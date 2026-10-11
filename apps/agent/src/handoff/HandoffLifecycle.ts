import { AgentError } from '../Domain'
import type { ThreadService } from '../session/ThreadService'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { HandoffLifecyclePort } from './HandoffService'

export type HandoffLifecycleOptions = {
  terminalCloseTimeoutMs?: number
  terminalClosePollIntervalMs?: number
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
}

/**
 * Agent-side lifecycle checks. PTY ownership remains in Electron: the supplied
 * callback only verifies the typed close-before-start handshake completed.
 */
export class HandoffLifecycle implements HandoffLifecyclePort {
  constructor(
    private readonly db: AgentDatabase,
    private readonly threads: ThreadService,
    private readonly waitForTerminalClosed: (threadID: string) => Promise<boolean>,
    private readonly options: HandoffLifecycleOptions = {},
  ) {}

  async preflight(threadID: string) {
    if (!this.db.sqlite.query('SELECT 1 FROM threads WHERE id = ?').get(threadID))
      throw new AgentError('THREAD_NOT_FOUND', '源任务不存在', 404)
    const queued = this.db.sqlite
      .query("SELECT 1 FROM turns WHERE thread_id = ? AND status = 'queued' LIMIT 1")
      .get(threadID)
    if (queued) throw new AgentError('QUEUE_NOT_EMPTY', '源任务仍有排队消息', 409)
    const interaction = this.db.sqlite
      .query(
        `SELECT 1 FROM approval_requests WHERE thread_id = ? AND status IN ('preparing', 'pending', 'resolved', 'claimed')
      UNION ALL SELECT 1 FROM question_requests WHERE thread_id = ? AND status IN ('pending', 'resolved', 'resuming')
      UNION ALL SELECT 1 FROM agent_checkpoints WHERE thread_id = ? LIMIT 1`,
      )
      .get(threadID, threadID, threadID)
    if (interaction) throw new AgentError('PENDING_INTERACTION', '源任务存在待处理交互', 409)
    const child = this.db.sqlite
      .query(
        `SELECT 1 FROM subagent_tasks AS task
      JOIN subagent_runs AS run ON run.task_id = task.id
      WHERE task.parent_thread_id = ? AND run.status NOT IN ('completed', 'failed', 'stopped', 'interrupted') LIMIT 1`,
      )
      .get(threadID)
    if (child) throw new AgentError('SOURCE_ACTIVE', '源任务仍有运行中的子任务', 409)
  }

  async stopSource(threadID: string) {
    const active = this.db.activeTurn(threadID)
    if (active) await this.threads.stop(threadID, active.id)
    if (this.db.activeTurn(threadID)) throw new AgentError('SOURCE_ACTIVE', '源任务未能停止', 409)
  }

  async closeTerminal(threadID: string) {
    const now = this.options.now ?? Date.now
    const wait =
      this.options.wait ??
      ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)))
    const timeoutMs = Math.max(0, this.options.terminalCloseTimeoutMs ?? 30_000)
    const pollIntervalMs = Math.max(1, this.options.terminalClosePollIntervalMs ?? 50)
    const deadline = now() + timeoutMs
    while (true) {
      if (await this.waitForTerminalClosed(threadID)) return
      const remaining = deadline - now()
      if (remaining <= 0) throw new AgentError('SOURCE_ACTIVE', '源任务终端尚未关闭', 409)
      await wait(Math.min(pollIntervalMs, remaining))
    }
  }
}
