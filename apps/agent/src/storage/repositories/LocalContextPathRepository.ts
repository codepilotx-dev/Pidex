import type { LocalContextReference } from '@pidex/shared/thread'
import { AgentError } from '../../Domain'
import type { AgentDatabase } from '../database/AgentDatabase'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

type Row = {
  id: string
  thread_id: string
  name: string
  path: string
  path_key: string
  kind: 'file' | 'directory'
  created_at: number
}

export type ImportedLocalContextPath = {
  name: string
  path: string
  pathKey: string
  kind: 'file' | 'directory'
}

const reference = (
  row: Row,
  status: LocalContextReference['status'] = 'available',
): LocalContextReference => ({
  id: row.id,
  name: row.name,
  path: row.path,
  kind: row.kind,
  status,
  createdAt: row.created_at,
})

const availability = (row: Row): LocalContextReference['status'] => {
  try {
    const canonical = realpathSync(resolve(row.path))
    const normalized = process.platform === 'win32' ? canonical.toLowerCase() : canonical
    return normalized === row.path_key ? 'available' : 'missing'
  } catch {
    return 'missing'
  }
}

export class LocalContextPathRepository {
  constructor(private readonly db: AgentDatabase) {}

  import(
    threadID: string,
    paths: readonly ImportedLocalContextPath[],
    operationID: string,
    requestHash: string,
  ) {
    if (!this.db.sqlite.query('SELECT 1 FROM threads WHERE id = ?').get(threadID)) {
      throw new AgentError('THREAD_NOT_FOUND', '任务不存在', 404)
    }
    return this.db.transaction(() => {
      const operation = this.db.sqlite
        .query(
          'SELECT thread_id, request_hash, reference_ids FROM context_path_operations WHERE operation_id = ?',
        )
        .get(operationID) as {
        thread_id: string
        request_hash: string
        reference_ids: string
      } | null
      if (operation) {
        if (operation.thread_id !== threadID || operation.request_hash !== requestHash) {
          throw new AgentError('CONFLICT', 'operationId 已用于其他本地上下文导入', 409)
        }
        const ids = JSON.parse(operation.reference_ids) as string[]
        return ids.flatMap((id) => {
          const value = this.get(threadID, id)
          return value ? [value] : []
        })
      }
      const imported = paths.map((entry) => {
        const existing = this.db.sqlite
          .query(
            'SELECT id, thread_id, name, path, path_key, kind, created_at FROM thread_context_paths WHERE thread_id = ? AND path_key = ?',
          )
          .get(threadID, entry.pathKey) as Row | null
        if (existing) return reference(existing)
        const id = crypto.randomUUID()
        const createdAt = Date.now()
        this.db.sqlite
          .query(
            `
        INSERT INTO thread_context_paths (id, thread_id, name, path, path_key, kind, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
          )
          .run(id, threadID, entry.name, entry.path, entry.pathKey, entry.kind, createdAt)
        return {
          id,
          name: entry.name,
          path: entry.path,
          kind: entry.kind,
          status: 'available' as const,
          createdAt,
        }
      })
      this.db.sqlite
        .query(
          `
        INSERT INTO context_path_operations (operation_id, thread_id, request_hash, reference_ids, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(
          operationID,
          threadID,
          requestHash,
          JSON.stringify(imported.map(({ id }) => id)),
          Date.now(),
        )
      return imported
    })
  }

  get(threadID: string, referenceID: string): LocalContextReference | null {
    const row = this.db.sqlite
      .query(
        'SELECT id, thread_id, name, path, path_key, kind, created_at FROM thread_context_paths WHERE id = ? AND thread_id = ?',
      )
      .get(referenceID, threadID) as Row | null
    return row ? reference(row, availability(row)) : null
  }

  getAuthorized(threadID: string, referenceID: string): LocalContextReference | null {
    const row = this.db.sqlite
      .query(
        `
      SELECT context.id, context.thread_id, context.name, context.path, context.path_key, context.kind, context.created_at
      FROM thread_context_paths AS context
      WHERE context.id = ? AND context.thread_id = ? AND EXISTS (
        SELECT 1
        FROM input_context_paths AS binding
        JOIN inputs ON inputs.id = binding.input_id
        WHERE binding.context_path_id = context.id AND inputs.thread_id = context.thread_id
      )
    `,
      )
      .get(referenceID, threadID) as Row | null
    return row ? reference(row, availability(row)) : null
  }

  validateForThread(threadID: string, referenceIDs: readonly string[]) {
    if (referenceIDs.length > 8 || new Set(referenceIDs).size !== referenceIDs.length) {
      throw new AgentError('INVALID_REQUEST', '每条消息最多包含 8 个不重复附件项', 413)
    }
    const rows = referenceIDs.map((id) => {
      const row = this.db.sqlite
        .query(
          'SELECT id, thread_id, name, path, path_key, kind, created_at FROM thread_context_paths WHERE id = ? AND thread_id = ?',
        )
        .get(id, threadID) as Row | null
      if (!row)
        throw new AgentError('LOCAL_CONTEXT_NOT_FOUND', '一个或多个本地上下文引用不存在', 404)
      return reference(row, availability(row))
    })
    return rows
  }

  bindInput(threadID: string, inputID: string, referenceIDs: readonly string[]) {
    const input = this.db.sqlite
      .query('SELECT thread_id FROM inputs WHERE id = ?')
      .get(inputID) as { thread_id: string } | null
    if (!input || input.thread_id !== threadID)
      throw new AgentError('CONFLICT', '本地上下文目标 input 不存在', 409)
    this.db.sqlite.query('DELETE FROM input_context_paths WHERE input_id = ?').run(inputID)
    const timestamp = Date.now()
    referenceIDs.forEach((referenceID, sortOrder) => {
      const changed = this.db.sqlite
        .query(
          `
        INSERT INTO input_context_paths (input_id, context_path_id, sort_order, created_at)
        SELECT ?, id, ?, ? FROM thread_context_paths WHERE id = ? AND thread_id = ?
      `,
        )
        .run(inputID, sortOrder, timestamp, referenceID, threadID)
      if (changed.changes !== 1)
        throw new AgentError('LOCAL_CONTEXT_NOT_FOUND', '一个或多个本地上下文引用不存在', 404)
    })
  }

  listByInput(inputID: string) {
    const rows = this.db.sqlite
      .query(
        `
      SELECT context.id, context.thread_id, context.name, context.path, context.path_key, context.kind, context.created_at
      FROM input_context_paths AS binding
      JOIN thread_context_paths AS context ON context.id = binding.context_path_id
      WHERE binding.input_id = ?
      ORDER BY binding.sort_order, binding.created_at, context.id
    `,
      )
      .all(inputID) as Row[]
    return rows.map((row) => reference(row, availability(row)))
  }

  listAuthorized(threadID: string) {
    const rows = this.db.sqlite
      .query(
        `
      SELECT DISTINCT context.id, context.thread_id, context.name, context.path, context.path_key, context.kind, context.created_at
      FROM thread_context_paths AS context
      JOIN input_context_paths AS binding ON binding.context_path_id = context.id
      JOIN inputs ON inputs.id = binding.input_id AND inputs.thread_id = context.thread_id
      WHERE context.thread_id = ?
      ORDER BY context.created_at, context.id
    `,
      )
      .all(threadID) as Row[]
    return rows.map((row) => reference(row, availability(row)))
  }
}
