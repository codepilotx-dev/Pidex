import { createHash } from 'node:crypto'
import type {
  TaskSchedule,
  TaskOccurrence,
  TaskScheduleLink,
  TaskArrangementProposal,
} from '@pidex/shared/task-schedule'
import type { AgentDatabase } from '../database/AgentDatabase'
import { AgentError } from '../../Domain'
import type { EventEnvelope } from '../../Domain'

export const TASK_SCHEDULE_SCHEMA = [
  'CREATE TABLE task_schedule_definitions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data TEXT NOT NULL)',
  'CREATE TABLE task_schedule_occurrences (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES task_schedule_definitions(id), scheduled_for INTEGER NOT NULL, data TEXT NOT NULL, UNIQUE(task_id, scheduled_for, id))',
  'CREATE INDEX task_schedule_occurrences_task ON task_schedule_occurrences(task_id, scheduled_for)',
  "CREATE TABLE task_schedule_links (task_id TEXT NOT NULL REFERENCES task_schedule_definitions(id), thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('planning','execution')), created_at INTEGER NOT NULL, PRIMARY KEY(task_id, thread_id))",
  'CREATE TABLE task_schedule_proposals (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
  'CREATE TABLE task_schedule_operations (operation_id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL)',
] as const

export class TaskScheduleRepository {
  constructor(private readonly db: AgentDatabase) {}
  publish: ((event: EventEnvelope) => void) | undefined
  available() {
    const count = this.db.sqlite
      .query(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('task_schedule_definitions','task_schedule_occurrences','task_schedule_links','task_schedule_proposals','task_schedule_operations')",
      )
      .get() as { count: number }
    return count.count === 5
  }
  list() {
    if (!this.available()) return { tasks: [], occurrences: [], links: [], proposals: [] }
    return {
      tasks: this.tasks(),
      occurrences: this.occurrences(),
      links: this.db.sqlite
        .query(
          'SELECT task_id AS taskId, thread_id AS threadId, role, created_at AS createdAt FROM task_schedule_links',
        )
        .all() as TaskScheduleLink[],
      proposals: this.rows<TaskArrangementProposal>('task_schedule_proposals'),
    }
  }
  private rows<T>(
    table: 'task_schedule_definitions' | 'task_schedule_occurrences' | 'task_schedule_proposals',
  ): T[] {
    return (this.db.sqlite.query(`SELECT data FROM ${table}`).all() as { data: string }[]).map(
      (row) => JSON.parse(row.data) as T,
    )
  }
  tasks() {
    return this.rows<TaskSchedule>('task_schedule_definitions')
  }
  occurrences() {
    return this.rows<TaskOccurrence>('task_schedule_occurrences')
  }
  task(id: string) {
    return this.read<TaskSchedule>('task_schedule_definitions', id)
  }
  occurrence(id: string) {
    return this.read<TaskOccurrence>('task_schedule_occurrences', id)
  }
  proposal(id: string) {
    return this.read<TaskArrangementProposal>('task_schedule_proposals', id)
  }
  planContent(threadId: string, itemId: string): string {
    const row = this.db.sqlite
      .query(
        "SELECT i.data FROM items i JOIN turns t ON t.id = i.turn_id WHERE i.id = ? AND t.thread_id = ? AND i.type = 'plan' AND i.status = 'completed'",
      )
      .get(itemId, threadId) as { data: string } | null
    const data = row ? (JSON.parse(row.data) as { markdown?: string }) : null
    if (!data?.markdown) throw new AgentError('INVALID_REQUEST', '请选择该会话中已完成的方案', 400)
    return data.markdown
  }
  plans(threadId: string) {
    return (
      this.db.sqlite
        .query(
          "SELECT i.id, i.data FROM items i JOIN turns t ON t.id = i.turn_id WHERE t.thread_id = ? AND i.type = 'plan' AND i.status = 'completed' ORDER BY i.created_at DESC",
        )
        .all(threadId) as { id: string; data: string }[]
    ).flatMap((row) => {
      const data = JSON.parse(row.data) as { title?: string; markdown?: string }
      return data.markdown
        ? [{ itemId: row.id, title: data.title || '实施方案', content: data.markdown }]
        : []
    })
  }
  latestTurnId(threadId: string) {
    const row = this.db.sqlite
      .query(
        'SELECT id FROM turns WHERE thread_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
      )
      .get(threadId) as { id: string } | null
    return row?.id ?? null
  }
  private read<T>(
    table: 'task_schedule_definitions' | 'task_schedule_occurrences' | 'task_schedule_proposals',
    id: string,
  ): T {
    const row = this.db.sqlite.query(`SELECT data FROM ${table} WHERE id = ?`).get(id) as {
      data: string
    } | null
    if (!row) throw new AgentError('INVALID_REQUEST', '任务或运行记录不存在', 404)
    return JSON.parse(row.data) as T
  }
  operation<T>(operationId: string, request: unknown, work: () => T): T {
    const hash = createHash('sha256').update(JSON.stringify(request)).digest('hex')
    return this.db.transaction(() => {
      const row = this.db.sqlite
        .query('SELECT request_hash, result FROM task_schedule_operations WHERE operation_id = ?')
        .get(operationId) as { request_hash: string; result: string } | null
      if (row) {
        if (row.request_hash !== hash)
          throw new AgentError('OPERATION_ID_CONFLICT', '操作标识已用于其他请求', 409)
        return JSON.parse(row.result) as T
      }
      const result = work()
      this.db.sqlite
        .query('INSERT INTO task_schedule_operations VALUES (?, ?, ?)')
        .run(operationId, hash, JSON.stringify(result))
      return result
    })
  }
  putTask(task: TaskSchedule) {
    this.db.sqlite
      .query(
        'INSERT INTO task_schedule_definitions VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, data = excluded.data',
      )
      .run(task.id, task.revision, JSON.stringify(task))
    this.changed(task.id)
    return task
  }
  putOccurrence(occurrence: TaskOccurrence) {
    this.db.sqlite
      .query(
        'INSERT INTO task_schedule_occurrences VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
      )
      .run(occurrence.id, occurrence.taskId, occurrence.scheduledFor, JSON.stringify(occurrence))
    this.changed(occurrence.taskId)
    return occurrence
  }
  putProposal(proposal: TaskArrangementProposal) {
    this.db.sqlite
      .query(
        'INSERT INTO task_schedule_proposals VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
      )
      .run(proposal.id, JSON.stringify(proposal))
    for (const item of proposal.items) this.changed('taskId' in item ? item.taskId : proposal.id)
    return proposal
  }
  link(taskId: string, threadId: string, role: TaskScheduleLink['role'], now: number) {
    this.db.sqlite
      .query(
        'INSERT INTO task_schedule_links VALUES (?, ?, ?, ?) ON CONFLICT(task_id, thread_id) DO UPDATE SET role = excluded.role',
      )
      .run(taskId, threadId, role, now)
  }
  checkRevision(current: { revision: number }, expectedRevision: number) {
    if (current.revision !== expectedRevision)
      throw new AgentError('CONFLICT', '任务或结果已变化，请刷新后重试', 409)
  }
  private changed(taskId: string) {
    const event = this.db.insertEvent(null, null, 'task-schedule/changed', {
      taskId,
      changedAt: Date.now(),
    })
    this.db.onTransactionCommit(() => this.publish?.(event))
  }
}
