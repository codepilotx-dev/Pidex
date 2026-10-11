import { createHash } from 'node:crypto'
import type { Database } from 'bun:sqlite'
import type { RepositoryDatabase } from './RepositoryDatabase'

export const THREAD_BOOKMARK_SCHEMA = [
  `CREATE TABLE thread_bookmarks (
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    input_id TEXT NOT NULL REFERENCES inputs(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (thread_id, input_id)
  )`,
  `CREATE TABLE thread_bookmark_state (
    thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE thread_bookmark_operations (
    operation_id TEXT PRIMARY KEY,
    method TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  'CREATE INDEX thread_bookmarks_input ON thread_bookmarks(input_id)',
] as const

/** Columns this build requires on `thread_bookmarks` to treat the store as schema 55. */
const THREAD_BOOKMARKS_REQUIRED_COLUMNS = ['thread_id', 'input_id', 'created_at'] as const

const THREAD_BOOKMARK_STATE_REQUIRED_COLUMNS = ['thread_id', 'version', 'updated_at'] as const

const THREAD_BOOKMARK_OPERATIONS_REQUIRED_COLUMNS = [
  'operation_id',
  'method',
  'request_hash',
  'result',
] as const

const tableColumns = (sqlite: Database, table: string): Set<string> =>
  new Set(
    (sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )

const parse = <T>(value: string): T => JSON.parse(value) as T
const stringify = (value: unknown) => JSON.stringify(value)
const hash = (value: unknown) => createHash('sha256').update(stringify(value), 'utf8').digest('hex')

export type ThreadBookmarkList = { threadId: string; inputIds: string[]; version: number }

/** Only the history connection is touched; narrowing keeps this usable from any repository layer. */
export type ThreadBookmarkDatabase = Pick<RepositoryDatabase, 'sqlite'>

/**
 * Owns the per-thread bookmark set and its optimistic-concurrency version. Rows
 * cascade with `threads` and `inputs`, so removing a thread or one of its inputs
 * removes the corresponding bookmarks without an explicit sweep.
 */
export class ThreadBookmarkRepository {
  constructor(
    private readonly db: ThreadBookmarkDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  private hasTable(name: string): boolean {
    return Boolean(
      this.db.sqlite
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name),
    )
  }

  /**
   * Full read+write support. All three schema 55 objects must exist with the
   * columns this build reads and writes, so a partial or newer unknown shape
   * never advertises `thread.bookmarks.v1` nor accepts mutations it cannot
   * replay idempotently.
   */
  available(): boolean {
    if (
      !this.hasTable('thread_bookmarks') ||
      !this.hasTable('thread_bookmark_state') ||
      !this.hasTable('thread_bookmark_operations')
    )
      return false
    const bookmarks = tableColumns(this.db.sqlite, 'thread_bookmarks')
    const state = tableColumns(this.db.sqlite, 'thread_bookmark_state')
    const operations = tableColumns(this.db.sqlite, 'thread_bookmark_operations')
    return (
      THREAD_BOOKMARKS_REQUIRED_COLUMNS.every((column) => bookmarks.has(column)) &&
      THREAD_BOOKMARK_STATE_REQUIRED_COLUMNS.every((column) => state.has(column)) &&
      THREAD_BOOKMARK_OPERATIONS_REQUIRED_COLUMNS.every((column) => operations.has(column))
    )
  }

  list(threadId: string): ThreadBookmarkList {
    if (!this.hasTable('thread_bookmarks')) {
      return { threadId, inputIds: [], version: 0 }
    }
    const inputIds = (
      this.db.sqlite
        .query(
          'SELECT input_id FROM thread_bookmarks WHERE thread_id = ? ORDER BY created_at, input_id',
        )
        .all(threadId) as Array<{ input_id: string }>
    ).map((row) => row.input_id)
    const state = this.hasTable('thread_bookmark_state')
      ? (this.db.sqlite
          .query('SELECT version FROM thread_bookmark_state WHERE thread_id = ?')
          .get(threadId) as { version: number } | undefined)
      : undefined
    return { threadId, inputIds, version: state?.version ?? 0 }
  }

  version(threadId: string): number {
    if (!this.hasTable('thread_bookmark_state')) return 0
    const row = this.db.sqlite
      .query('SELECT version FROM thread_bookmark_state WHERE thread_id = ?')
      .get(threadId) as { version: number } | undefined
    return row?.version ?? 0
  }

  hasBookmark(threadId: string, inputId: string): boolean {
    if (!this.hasTable('thread_bookmarks')) return false
    return Boolean(
      this.db.sqlite
        .query('SELECT 1 FROM thread_bookmarks WHERE thread_id = ? AND input_id = ?')
        .get(threadId, inputId),
    )
  }

  /**
   * Applies the requested bookmark state inside the caller's transaction.
   * `expectedVersion` must match the stored version (0 asserts no state row yet).
   * Returns the fresh list plus whether anything changed, or null on a version
   * mismatch. An unchanged request neither writes rows nor bumps the version.
   */
  set(input: {
    threadId: string
    inputId: string
    bookmarked: boolean
    expectedVersion: number
  }): { list: ThreadBookmarkList; changed: boolean } | null {
    const currentVersion = this.version(input.threadId)
    if (currentVersion !== input.expectedVersion) return null
    const changed = this.hasBookmark(input.threadId, input.inputId) !== input.bookmarked
    if (changed) {
      const timestamp = this.now()
      if (input.bookmarked) {
        this.db.sqlite
          .query(
            'INSERT OR IGNORE INTO thread_bookmarks (thread_id, input_id, created_at) VALUES (?, ?, ?)',
          )
          .run(input.threadId, input.inputId, timestamp)
      } else {
        this.db.sqlite
          .query('DELETE FROM thread_bookmarks WHERE thread_id = ? AND input_id = ?')
          .run(input.threadId, input.inputId)
      }
      if (currentVersion === 0) {
        this.db.sqlite
          .query(
            'INSERT INTO thread_bookmark_state (thread_id, version, updated_at) VALUES (?, 1, ?)',
          )
          .run(input.threadId, timestamp)
      } else {
        this.db.sqlite
          .query(
            'UPDATE thread_bookmark_state SET version = version + 1, updated_at = ? WHERE thread_id = ?',
          )
          .run(timestamp, input.threadId)
      }
    }
    return { list: this.list(input.threadId), changed }
  }

  completedOperation(operationId: string, method: string, request: unknown) {
    if (!this.hasTable('thread_bookmark_operations')) return null
    const row = this.db.sqlite
      .query(
        'SELECT method, request_hash, result FROM thread_bookmark_operations WHERE operation_id = ?',
      )
      .get(operationId) as { method: string; request_hash: string; result: string | null } | null
    if (!row) return null
    return {
      matches: row.method === method && row.request_hash === hash(request),
      result: row.result ? parse(row.result) : null,
    }
  }

  recordOperation(operationId: string, method: string, request: unknown, result: unknown) {
    const timestamp = this.now()
    this.db.sqlite
      .query(
        `
      INSERT INTO thread_bookmark_operations (operation_id, method, request_hash, result, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(operationId, method, hash(request), stringify(result), timestamp, timestamp)
  }
}
