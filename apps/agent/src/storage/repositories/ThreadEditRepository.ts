import { SqlitePiSessionRepo, SqlitePiSessionStorage } from '../pi-session/SqlitePiSession'
import type { AgentDatabase } from '../database/AgentDatabase'
import { AgentError } from '../../Domain'
import { parsePiSessionEntry } from '../pi-session/PiSessionEntry'

export const THREAD_EDIT_SCHEMA = [
  'CREATE TABLE thread_edits (operation_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, request_hash TEXT NOT NULL, source_turn_id TEXT NOT NULL, source_input_id TEXT NOT NULL, input_id TEXT NOT NULL, turn_id TEXT, created_at INTEGER NOT NULL)',
  'CREATE TABLE thread_inactive_turns (turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE, operation_id TEXT NOT NULL REFERENCES thread_edits(operation_id) ON DELETE CASCADE)',
  'CREATE TABLE turn_pi_starts (turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE, session_id TEXT NOT NULL, entry_id TEXT)',
]

export const hasThreadEditStorage = (db: Pick<AgentDatabase, 'sqlite'>) =>
  Boolean(
    db.sqlite
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'thread_inactive_turns'")
      .get(),
  )

export const activeTurnSql = (alias: string, db: Pick<AgentDatabase, 'sqlite'>) =>
  hasThreadEditStorage(db)
    ? `NOT EXISTS (SELECT 1 FROM thread_inactive_turns WHERE turn_id = ${alias}.id)`
    : '1 = 1'

export class ThreadEditRepository {
  constructor(private readonly db: AgentDatabase) {}

  revision(threadId: string): number {
    if (!hasThreadEditStorage(this.db)) return 0
    return (
      this.db.sqlite
        .query('SELECT COUNT(*) AS revision FROM thread_edits WHERE thread_id = ?')
        .get(threadId) as { revision: number }
    ).revision
  }

  lookup(operationId: string) {
    return this.db.sqlite
      .query('SELECT * FROM thread_edits WHERE operation_id = ?')
      .get(operationId) as {
      thread_id: string
      request_hash: string
      input_id: string
      turn_id: string
    } | null
  }

  recordStart(threadId: string, turnId: string) {
    if (!hasThreadEditStorage(this.db)) return
    const execution = this.db.sqlite
      .query(
        'SELECT session_id FROM agent_executions JOIN turns ON turns.root_agent_id = agent_executions.id WHERE turns.id = ?',
      )
      .get(turnId) as { session_id: string } | null
    const sessionId = execution?.session_id ?? `${threadId}:main`
    const leaf = this.db.sqlite
      .query('SELECT leaf_id FROM pi_sessions WHERE id = ?')
      .get(sessionId) as { leaf_id: string | null } | null
    this.db.sqlite
      .query(
        'INSERT OR IGNORE INTO turn_pi_starts (turn_id, session_id, entry_id) VALUES (?, ?, ?)',
      )
      .run(turnId, sessionId, leaf?.leaf_id ?? null)
  }

  prepare(threadId: string, turnId: string, inputId: string) {
    const rows = this.db.sqlite
      .query(
        `SELECT turns.id, inputs.id AS input_id, inputs.origin FROM turns JOIN inputs ON inputs.turn_id = turns.id WHERE turns.thread_id = ? AND ${activeTurnSql('turns', this.db)} ORDER BY turns.created_at, turns.id, inputs.created_at, inputs.id`,
      )
      .all(threadId) as { id: string; input_id: string; origin: string | null }[]
    const target = rows.find((row) => row.input_id === inputId && row.id === turnId)
    const realInputs = rows.filter((row) => row.origin === null || row.origin === 'user')
    if (
      !target ||
      realInputs.at(-1)?.input_id !== inputId ||
      rows.filter((row) => row.id === turnId).length !== 1
    )
      throw new AgentError('CONFLICT', '只能修改最后一条未合并的用户消息', 409)
    const start = this.db.sqlite
      .query('SELECT session_id, entry_id FROM turn_pi_starts WHERE turn_id = ?')
      .get(turnId) as { session_id: string; entry_id: string | null } | null
    const execution = this.db.sqlite
      .query(
        'SELECT session_id FROM agent_executions JOIN turns ON turns.root_agent_id = agent_executions.id WHERE turns.id = ?',
      )
      .get(turnId) as { session_id: string } | null
    const sessionId = start?.session_id ?? execution?.session_id ?? `${threadId}:main`
    let entryId = start?.entry_id ?? null
    if (!start) {
      // 旧任务只使用持久化的轮尾映射沿父链定位用户输入，不按显示文本猜测。
      const end = this.db.sqlite
        .query('SELECT entry_id FROM turn_pi_boundaries WHERE turn_id = ? AND session_id = ?')
        .get(turnId, sessionId) as { entry_id: string } | null
      if (!end) throw new AgentError('CHECKPOINT_UNAVAILABLE', '该历史消息缺少安全编辑边界', 409)
      let id: string | null = end.entry_id
      let found = false
      const seen = new Set<string>()
      while (id && !seen.has(id)) {
        seen.add(id)
        const row = this.db.sqlite
          .query('SELECT id, payload FROM pi_session_entries WHERE session_id = ? AND id = ?')
          .get(sessionId, id) as { id: string; payload: string } | null
        if (!row) break
        const entry = parsePiSessionEntry(row)
        if (entry.type === 'message' && entry.message.role === 'user') {
          entryId = entry.parentId
          found = true
          break
        }
        id = entry.parentId
      }
      if (!found) throw new AgentError('CHECKPOINT_UNAVAILABLE', '该历史消息缺少安全编辑边界', 409)
    }
    const first = rows.findIndex((row) => row.id === turnId)
    return {
      sessionId,
      entryId,
      removedTurnIds: [...new Set(rows.slice(first).map((row) => row.id))],
    }
  }

  validateReferences(
    threadId: string,
    inputId: string,
    attachments: readonly string[],
    references: readonly string[],
  ) {
    const owned = this.db.sqlite
      .query('SELECT id FROM input_attachments WHERE input_id = ? AND thread_id = ?')
      .all(inputId, threadId) as { id: string }[]
    const contexts = this.db.sqlite
      .query('SELECT context_path_id AS id FROM input_context_paths WHERE input_id = ?')
      .all(inputId) as { id: string }[]
    if (
      attachments.some((id) => !owned.some((row) => row.id === id)) ||
      references.some((id) => !contexts.some((row) => row.id === id))
    )
      throw new AgentError('PERMISSION_DENIED', '编辑引用不属于原消息', 403)
  }

  assertIdle(threadId: string) {
    const runningChild = this.db.sqlite
      .query(
        `WITH RECURSIVE tree(thread_id) AS (SELECT ? UNION SELECT child_thread_id FROM subagent_tasks JOIN tree ON parent_thread_id = tree.thread_id) SELECT 1 FROM subagent_tasks JOIN tree ON parent_thread_id = tree.thread_id WHERE status IN ('queued', 'preparing', 'running', 'steering', 'waiting-question', 'waiting-permission') LIMIT 1`,
      )
      .get(threadId)
    if (
      runningChild ||
      this.db.activeTurn(threadId) ||
      this.db.sqlite
        .query("SELECT 1 FROM turns WHERE thread_id = ? AND status = 'queued' LIMIT 1")
        .get(threadId)
    )
      throw new AgentError('TURN_ACTIVE', '当前任务仍有运行中或待运行的轮次', 409)
  }

  async stageHistorySwitch(
    threadId: string,
    boundary: ReturnType<ThreadEditRepository['prepare']>,
  ) {
    const exists = this.db.sqlite
      .query('SELECT 1 FROM pi_sessions WHERE id = ?')
      .get(boundary.sessionId)
    if (!exists) {
      if (boundary.entryId !== null)
        throw new AgentError('CHECKPOINT_UNAVAILABLE', '会话编辑边界不可用', 409)
      return () => undefined
    }
    const session = await new SqlitePiSessionRepo(this.db).openForThread(
      boundary.sessionId,
      threadId,
    )
    const storage = session.getStorage() as SqlitePiSessionStorage
    await storage.setLeafId(boundary.entryId)
    return () => storage.flush()
  }

  commit(
    request: { operationId: string; threadId: string; turnId: string; inputId: string },
    hash: string,
    nextInputId: string,
    boundary: ReturnType<ThreadEditRepository['prepare']>,
  ) {
    const now = Date.now()
    this.db.sqlite
      .query(
        'INSERT INTO thread_edits (operation_id, thread_id, request_hash, source_turn_id, source_input_id, input_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        request.operationId,
        request.threadId,
        hash,
        request.turnId,
        request.inputId,
        nextInputId,
        now,
      )
    for (const id of boundary.removedTurnIds)
      this.db.sqlite
        .query('INSERT INTO thread_inactive_turns (turn_id, operation_id) VALUES (?, ?)')
        .run(id, request.operationId)
    this.db.sqlite
      .query(
        'UPDATE threads SET first_user_message = (SELECT content FROM inputs JOIN turns ON turns.id = inputs.turn_id WHERE inputs.thread_id = ? AND ' +
          activeTurnSql('turns', this.db) +
          ' ORDER BY inputs.created_at, inputs.id LIMIT 1) WHERE id = ?',
      )
      .run(request.threadId, request.threadId)
  }

  cloneAttachments(ids: readonly string[]) {
    return ids.map((source) => {
      const id = crypto.randomUUID()
      this.db.sqlite
        .query(
          `INSERT INTO input_attachments (id, kind, name, media_type, size_bytes, sha256, storage_path, created_at) SELECT ?, kind, name, media_type, size_bytes, sha256, storage_path, created_at FROM input_attachments WHERE id = ?`,
        )
        .run(id, source)
      return id
    })
  }

  finish(operationId: string, turnId: string) {
    this.db.sqlite
      .query('UPDATE thread_edits SET turn_id = ? WHERE operation_id = ?')
      .run(turnId, operationId)
  }
}
