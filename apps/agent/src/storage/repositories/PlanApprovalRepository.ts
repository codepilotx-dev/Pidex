import { decodeStructuredPlan, type PlanApproval } from '@pidex/shared/thread'
import { AgentError } from '../../Domain'
import type { RepositoryDatabase } from './RepositoryDatabase'

export const PLAN_APPROVAL_SCHEMA = [
  `CREATE TABLE plan_approvals (
    id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    source_turn_id TEXT NOT NULL UNIQUE REFERENCES turns(id) ON DELETE CASCADE,
    plan_item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL,
    operation_id TEXT UNIQUE, operation_fingerprint TEXT,
    next_turn_id TEXT REFERENCES turns(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL, resolved_at INTEGER
  )`,
  "CREATE UNIQUE INDEX plan_approvals_pending_thread ON plan_approvals(thread_id) WHERE status = 'pending'",
] as const

type Database = Pick<RepositoryDatabase, 'sqlite' | 'transaction' | 'getItem'>
type Row = {
  id: string
  thread_id: string
  source_turn_id: string
  plan_item_id: string
  version: number
  status: PlanApproval['status']
  operation_fingerprint: string | null
  next_turn_id: string | null
  created_at: number
  resolved_at: number | null
}

export class PlanApprovalRepository {
  constructor(private readonly db: Database) {}

  available(): boolean {
    return Boolean(
      this.db.sqlite
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plan_approvals'")
        .get(),
    )
  }

  requireThread(threadId: string, mutate = false): void {
    const thread = this.db.sqlite.query('SELECT kind FROM threads WHERE id = ?').get(threadId) as {
      kind: string
    } | null
    if (!thread) throw new AgentError('THREAD_NOT_FOUND', '任务不存在', 404)
    if (mutate && thread.kind === 'subagent')
      throw new AgentError('PERMISSION_DENIED', '子代理计划需要父任务继续，不能直接批准执行', 403)
    if (!this.available()) throw new AgentError('PERMISSION_DENIED', '当前存储不支持计划批准', 403)
  }

  private project(row: Row): PlanApproval {
    const item = this.db.getItem(row.plan_item_id)
    const structured = decodeStructuredPlan(item?.data.structured)
    return {
      id: row.id,
      threadId: row.thread_id,
      turnId: row.source_turn_id,
      planItemId: row.plan_item_id,
      version: row.version,
      status: row.status,
      title: typeof item?.data.title === 'string' ? item.data.title : '实施计划',
      markdown: typeof item?.data.markdown === 'string' ? item.data.markdown : '',
      ...(structured ? { structured } : {}),
      nextTurnId: row.next_turn_id,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    }
  }

  get(id: string): PlanApproval | null {
    if (!this.available()) return null
    const row = this.db.sqlite
      .query('SELECT * FROM plan_approvals WHERE id = ?')
      .get(id) as Row | null
    return row ? this.project(row) : null
  }

  pending(threadId: string): PlanApproval | null {
    if (!this.available()) return null
    const row = this.db.sqlite
      .query("SELECT * FROM plan_approvals WHERE thread_id = ? AND status = 'pending'")
      .get(threadId) as Row | null
    return row ? this.project(row) : null
  }

  /** Only the latest completed Plan turn is eligible; every terminal record is a tombstone. */
  recover(threadId?: string): void {
    if (!this.available()) return
    this.db.transaction(() => {
      this.db.sqlite
        .query(
          `UPDATE plan_approvals SET status = 'superseded', version = version + 1, resolved_at = ?
        WHERE status = 'pending' ${threadId ? 'AND thread_id = ?' : ''}
        AND source_turn_id <> (SELECT id FROM turns WHERE thread_id = plan_approvals.thread_id ORDER BY created_at DESC, rowid DESC LIMIT 1)`,
        )
        .run(Date.now(), ...(threadId ? [threadId] : []))
      const candidates = this.db.sqlite
        .query(
          `SELECT t.id, t.thread_id FROM turns t
        WHERE t.mode = 'plan' AND t.status = 'completed' ${threadId ? 'AND t.thread_id = ?' : ''}
        AND t.id = (SELECT id FROM turns WHERE thread_id = t.thread_id ORDER BY created_at DESC, rowid DESC LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM plan_approvals WHERE source_turn_id = t.id)`,
        )
        .all(...(threadId ? [threadId] : [])) as Array<{ id: string; thread_id: string }>
      for (const turn of candidates) {
        // 同一 turn 里结构化计划优先于仅 Markdown 的标签计划，避免出现两个权威计划。
        const item = this.db.sqlite
          .query(
            `SELECT id FROM items WHERE turn_id = ? AND type = 'plan' AND status = 'completed'
          AND json_type(data, '$.markdown') = 'text' AND length(trim(json_extract(data, '$.markdown'))) > 0
          ORDER BY (json_type(data, '$.structured') IS NOT NULL) DESC, ordinal DESC, rowid DESC LIMIT 1`,
          )
          .get(turn.id) as { id: string } | null
        if (item)
          this.db.sqlite
            .query(
              `INSERT INTO plan_approvals(id, thread_id, source_turn_id, plan_item_id, status, created_at)
          VALUES (?, ?, ?, ?, 'pending', ?)`,
            )
            .run(crypto.randomUUID(), turn.thread_id, turn.id, item.id, Date.now())
      }
    })
  }

  invalidate(threadId: string): void {
    if (this.available())
      this.db.sqlite
        .query(
          "UPDATE plan_approvals SET status = 'superseded', version = version + 1, resolved_at = ? WHERE thread_id = ? AND status = 'pending'",
        )
        .run(Date.now(), threadId)
  }

  duplicate(operationId: string, fingerprint: string): PlanApproval | null {
    const row = this.db.sqlite
      .query('SELECT * FROM plan_approvals WHERE operation_id = ?')
      .get(operationId) as Row | null
    if (!row) return null
    if (row.operation_fingerprint !== fingerprint)
      throw new AgentError('OPERATION_ID_CONFLICT', '操作 ID 已用于不同的计划决策', 409)
    return this.project(row)
  }

  assertCurrent(threadId: string, id: string, version: number): PlanApproval {
    const value = this.get(id)
    const latest = this.db.sqlite
      .query(
        'SELECT id FROM turns WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get(threadId) as { id: string } | null
    const sourceValid =
      value &&
      this.db.sqlite
        .query(
          `SELECT 1 FROM items i JOIN turns t ON t.id = i.turn_id
      WHERE i.id = ? AND i.thread_id = ? AND t.thread_id = ? AND t.id = ?
        AND i.type = 'plan' AND i.status = 'completed' AND t.mode = 'plan' AND t.status = 'completed'`,
        )
        .get(value.planItemId, threadId, threadId, value.turnId)
    if (
      !value ||
      !sourceValid ||
      value.threadId !== threadId ||
      value.status !== 'pending' ||
      value.version !== version ||
      latest?.id !== value.turnId ||
      !value.markdown.trim()
    ) {
      throw new AgentError('CONFLICT', '计划已处理或已过期，请刷新后重试', 409)
    }
    this.assertIdle(threadId)
    return value
  }

  assertIdle(threadId: string): void {
    if (
      this.db.sqlite
        .query(
          "SELECT 1 FROM turns WHERE thread_id = ? AND status IN ('queued','running','waiting_permission','waiting_question','waiting_subagents') LIMIT 1",
        )
        .get(threadId)
    ) {
      throw new AgentError('TURN_ACTIVE', '当前任务仍有运行中或待运行的轮次', 409)
    }
  }

  resolve(
    id: string,
    version: number,
    status: 'implemented' | 'feedback' | 'closed',
    operationId: string,
    fingerprint: string,
  ): void {
    const result = this.db.sqlite
      .query(
        `UPDATE plan_approvals SET status = ?, version = version + 1, operation_id = ?, operation_fingerprint = ?, resolved_at = ?
      WHERE id = ? AND version = ? AND status = 'pending'`,
      )
      .run(status, operationId, fingerprint, Date.now(), id, version)
    if (result.changes !== 1) throw new AgentError('CONFLICT', '计划已处理，请刷新后重试', 409)
  }

  linkTurn(id: string, turnId: string): void {
    this.db.sqlite.query('UPDATE plan_approvals SET next_turn_id = ? WHERE id = ?').run(turnId, id)
  }

  implementationTarget(approval: PlanApproval) {
    const row = approval.nextTurnId
      ? (this.db.sqlite
          .query('SELECT thread_id FROM turns WHERE id = ?')
          .get(approval.nextTurnId) as { thread_id: string } | null)
      : null
    if (!row || !approval.nextTurnId) throw new AgentError('CONFLICT', '计划实施关联不可用', 409)
    return { targetThreadId: row.thread_id, nextTurnId: approval.nextTurnId }
  }
}
