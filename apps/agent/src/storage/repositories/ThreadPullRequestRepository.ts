import type { ThreadPullRequestOrigin } from '@pidex/shared/thread'
import type { RepositoryDatabase } from './RepositoryDatabase'

/**
 * Persisted thread↔pull-request association. Independent from the thread core
 * tables so PR links survive PR close/merge and never widen the thread schema.
 */
export const THREAD_PULL_REQUEST_SCHEMA = [
  `CREATE TABLE thread_pull_requests (
    thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    repository TEXT NOT NULL,
    number INTEGER NOT NULL,
    url TEXT NOT NULL,
    title TEXT,
    head_ref TEXT,
    origin TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (thread_id, owner, repository, number)
  )`,
  'CREATE INDEX thread_pull_requests_pr ON thread_pull_requests(owner, repository, number)',
] as const

const REQUIRED_COLUMNS = [
  'thread_id',
  'owner',
  'repository',
  'number',
  'url',
  'title',
  'head_ref',
  'origin',
  'created_at',
  'updated_at',
] as const

export type ThreadPullRequestRecord = {
  threadId: string
  owner: string
  repository: string
  number: number
  url: string
  title: string | null
  headRef: string | null
  origin: ThreadPullRequestOrigin
  createdAt: number
  updatedAt: number
}

type Row = {
  thread_id: string
  owner: string
  repository: string
  number: number
  url: string
  title: string | null
  head_ref: string | null
  origin: string
  created_at: number
  updated_at: number
}

const toRecord = (row: Row): ThreadPullRequestRecord => ({
  threadId: row.thread_id,
  owner: row.owner,
  repository: row.repository,
  number: row.number,
  url: row.url,
  title: row.title,
  headRef: row.head_ref,
  origin: row.origin as ThreadPullRequestOrigin,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

/** Only the history connection is touched; narrowing keeps this repository-agnostic. */
export type ThreadPullRequestDatabase = Pick<RepositoryDatabase, 'sqlite'>

/** Owns the per-thread pull request associations; rows cascade with `threads`. */
export class ThreadPullRequestRepository {
  constructor(
    private readonly db: ThreadPullRequestDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  private hasTable(name: string): boolean {
    return Boolean(
      this.db.sqlite
        .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name),
    )
  }

  /** Full read+write support for the schema 59 association table. */
  available(): boolean {
    if (!this.hasTable('thread_pull_requests')) return false
    const columns = new Set(
      (
        this.db.sqlite.query('PRAGMA table_info(thread_pull_requests)').all() as Array<{
          name: string
        }>
      ).map((column) => column.name),
    )
    return REQUIRED_COLUMNS.every((column) => columns.has(column))
  }

  list(threadId: string): ThreadPullRequestRecord[] {
    if (!this.hasTable('thread_pull_requests')) return []
    const rows = this.db.sqlite
      .query('SELECT * FROM thread_pull_requests WHERE thread_id = ? ORDER BY updated_at DESC')
      .all(threadId) as Row[]
    return rows.map(toRecord)
  }

  /**
   * Records an association. The canonical URL, branch and title are refreshed on
   * conflict, but a user-made origin is never downgraded back to `discovered`.
   */
  upsert(input: {
    threadId: string
    owner: string
    repository: string
    number: number
    url: string
    title: string | null
    headRef: string | null
    origin: ThreadPullRequestOrigin
  }): void {
    const timestamp = this.now()
    this.db.sqlite
      .query(
        `INSERT INTO thread_pull_requests
           (thread_id, owner, repository, number, url, title, head_ref, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, owner, repository, number) DO UPDATE SET
           url = excluded.url,
           title = COALESCE(excluded.title, thread_pull_requests.title),
           head_ref = COALESCE(excluded.head_ref, thread_pull_requests.head_ref),
           origin = CASE
             WHEN thread_pull_requests.origin = 'discovered' THEN excluded.origin
             ELSE thread_pull_requests.origin
           END,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.threadId,
        input.owner.toLowerCase(),
        input.repository.toLowerCase(),
        input.number,
        input.url,
        input.title,
        input.headRef,
        input.origin,
        timestamp,
        timestamp,
      )
  }

  remove(
    threadId: string,
    identity: { owner: string; repository: string; number: number },
  ): boolean {
    const result = this.db.sqlite
      .query(
        'DELETE FROM thread_pull_requests WHERE thread_id = ? AND owner = ? AND repository = ? AND number = ?',
      )
      .run(
        threadId,
        identity.owner.toLowerCase(),
        identity.repository.toLowerCase(),
        identity.number,
      )
    return result.changes > 0
  }
}
