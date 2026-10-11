import type { AgentDatabase } from '../database/AgentDatabase'

export type StoredSideChat = {
  threadID: string
  sourceThreadID: string
  inheritedThroughTurnID: string | null
  referenceText: string | null
  operationID: string
  createdAt: number
}

type SideChatRow = {
  thread_id: string
  source_thread_id: string
  inherited_through_turn_id: string | null
  reference_text: string | null
  operation_id: string
  created_at: number
}

const fromRow = (row: SideChatRow): StoredSideChat => ({
  threadID: row.thread_id,
  sourceThreadID: row.source_thread_id,
  inheritedThroughTurnID: row.inherited_through_turn_id,
  referenceText: row.reference_text,
  operationID: row.operation_id,
  createdAt: row.created_at,
})

/** SQL boundary for temporary side-chat ownership and lifecycle. */
export class SideChatRepository {
  constructor(private readonly db: AgentDatabase) {}

  findByThread(threadID: string): StoredSideChat | null {
    const row = this.db.sqlite
      .query('SELECT * FROM thread_side_chats WHERE thread_id = ?')
      .get(threadID) as SideChatRow | null
    return row ? fromRow(row) : null
  }

  findByOperation(operationID: string): StoredSideChat | null {
    const row = this.db.sqlite
      .query('SELECT * FROM thread_side_chats WHERE operation_id = ?')
      .get(operationID) as SideChatRow | null
    return row ? fromRow(row) : null
  }

  list(): StoredSideChat[] {
    return (
      this.db.sqlite
        .query('SELECT * FROM thread_side_chats ORDER BY created_at, thread_id')
        .all() as SideChatRow[]
    ).map(fromRow)
  }

  threadGitBranch(threadID: string) {
    return (
      (
        this.db.sqlite.query('SELECT git_branch FROM threads WHERE id = ?').get(threadID) as {
          git_branch: string | null
        } | null
      )?.git_branch ?? ''
    )
  }

  bindingIDsForSource(sourceThreadID: string): string[] {
    return (
      this.db.sqlite
        .query(
          `
      SELECT binding.binding_id
      FROM thread_side_chats AS side_chat
      JOIN thread_execution_bindings AS binding
        ON binding.thread_id = side_chat.thread_id
      WHERE side_chat.source_thread_id = ?
      ORDER BY side_chat.created_at, side_chat.thread_id
    `,
        )
        .all(sourceThreadID) as Array<{ binding_id: string }>
    ).map((row) => row.binding_id)
  }

  insert(value: StoredSideChat) {
    this.db.sqlite
      .query(
        `
      INSERT INTO thread_side_chats (
        thread_id, source_thread_id, inherited_through_turn_id,
        reference_text, operation_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        value.threadID,
        value.sourceThreadID,
        value.inheritedThroughTurnID,
        value.referenceText,
        value.operationID,
        value.createdAt,
      )
    return value
  }

  deleteThread(threadID: string) {
    return (
      this.db.sqlite.query('DELETE FROM threads WHERE id = ? AND archived_at = -1').run(threadID)
        .changes > 0
    )
  }
}
