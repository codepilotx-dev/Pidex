import type { AgentDatabase } from '../storage/database/AgentDatabase'

export type MemoryScope = 'user' | 'project'
export type MemoryEntry = {
  id: string
  scope: MemoryScope
  projectKey: string | null
  content: string
  sourceThreadID: string | null
  createdAt: number
  updatedAt: number
}

export interface MemoryExtractor {
  extract(input: {
    transcript: string
    projectKey: string | null
    signal?: AbortSignal
  }): Promise<Array<{ scope: MemoryScope; content: string }>>
}

export type MemoryServiceOptions = {
  enabled: boolean | (() => boolean)
  extractor?: MemoryExtractor
  scrub?: (value: string) => string
}

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|rk|pk)-[a-z0-9_-]{16,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*\S+/i,
  /\bAKIA[0-9A-Z]{16}\b/,
]
const MAX_ENTRY_CHARS = 2_000
const MAX_RECALL_CHARS = 16_000

const hash = (value: string) => new Bun.CryptoHasher('sha256').update(value).digest('hex')
export const projectMemoryKey = (projectID: string) => `project:${projectID}`

const words = (value: string) =>
  new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])
const parseEntry = (row: Record<string, string | number | null>): MemoryEntry => ({
  id: String(row.id),
  scope: String(row.scope) as MemoryScope,
  projectKey: row.project_key == null || row.project_key === '' ? null : String(row.project_key),
  content: String(row.content),
  sourceThreadID: row.source_thread_id == null ? null : String(row.source_thread_id),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
})

export class MemoryService {
  private readonly scrub: (value: string) => string
  private draining: Promise<void> | null = null
  constructor(
    private readonly db: AgentDatabase,
    private readonly options: MemoryServiceOptions,
  ) {
    this.scrub = options.scrub ?? ((value) => value)
    queueMicrotask(() => {
      void this.drain()
    })
  }

  private enabled() {
    return typeof this.options.enabled === 'function'
      ? this.options.enabled()
      : this.options.enabled
  }

  list(input: { scope?: MemoryScope; projectKey?: string; limit?: number } = {}) {
    if (!this.enabled()) return []
    const clauses: string[] = []
    const params: Array<string | number> = []
    if (input.scope) {
      clauses.push('scope = ?')
      params.push(input.scope)
    }
    if (input.projectKey) {
      clauses.push('project_key = ?')
      params.push(input.projectKey)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const limit = Math.max(1, Math.min(500, input.limit ?? 100))
    return (
      this.db.profileSqlite
        .query(
          `SELECT id, scope, project_key, content, source_thread_id, created_at, updated_at FROM memory_entries ${where} ORDER BY updated_at DESC LIMIT ?`,
        )
        .all(...params, limit) as Array<Record<string, string | number | null>>
    ).map(parseEntry)
  }

  read(input: { id: string; scope: MemoryScope; projectKey?: string }) {
    if (!this.enabled()) return null
    if (input.scope === 'project' && !input.projectKey)
      throw new Error('project memory 缺少 projectKey')
    const projectKey = input.scope === 'project' ? input.projectKey! : ''
    const row = this.db.profileSqlite
      .query(
        'SELECT id, scope, project_key, content, source_thread_id, created_at, updated_at FROM memory_entries WHERE id = ? AND scope = ? AND project_key = ?',
      )
      .get(input.id, input.scope, projectKey) as Record<string, string | number | null> | null
    return row ? parseEntry(row) : null
  }

  delete(input: { id: string; scope: MemoryScope; projectKey?: string }) {
    if (!this.enabled()) return false
    if (input.scope === 'project' && !input.projectKey)
      throw new Error('project memory 缺少 projectKey')
    const projectKey = input.scope === 'project' ? input.projectKey! : ''
    return (
      this.db.profileSqlite
        .query('DELETE FROM memory_entries WHERE id = ? AND scope = ? AND project_key = ?')
        .run(input.id, input.scope, projectKey).changes > 0
    )
  }

  recall(input: { query: string; projectKey?: string; subagent?: boolean; limit?: number }) {
    if (!this.enabled()) return []
    const max = Math.max(1, Math.min(5, input.limit ?? 5))
    const rows = this.list({ limit: 500 }).filter((entry) =>
      entry.scope === 'user' ? !input.subagent : entry.projectKey === (input.projectKey ?? null),
    )
    const queryWords = words(input.query)
    let used = 0
    return rows
      .map((entry) => {
        const overlap = [...words(entry.content)].reduce(
          (score, word) => score + (queryWords.has(word) ? 1 : 0),
          0,
        )
        return { entry, score: overlap * 1_000 + entry.updatedAt / 1e12 }
      })
      .sort((a, b) => b.score - a.score)
      .flatMap(({ entry }) => {
        if (used + entry.content.length > MAX_RECALL_CHARS) return []
        used += entry.content.length
        return [entry]
      })
      .slice(0, max)
  }

  remember(input: {
    id?: string
    scope: MemoryScope
    projectKey?: string
    content: string
    sourceThreadID?: string
  }) {
    if (!this.enabled()) return null
    const content = this.scrub(input.content).trim().slice(0, MAX_ENTRY_CHARS)
    if (
      !content ||
      SECRET_PATTERNS.some((pattern) => pattern.test(input.content)) ||
      content.includes('[REDACTED')
    )
      return null
    if (input.scope === 'project' && !input.projectKey)
      throw new Error('project memory 缺少 projectKey')
    const timestamp = Date.now()
    const projectKey = input.scope === 'project' ? input.projectKey! : ''
    if (input.id)
      return this.db.profileSqlite.transaction(() => {
        const existing = this.read({
          id: input.id!,
          scope: input.scope,
          ...(input.projectKey ? { projectKey: input.projectKey } : {}),
        })
        if (!existing) return null
        this.db.profileSqlite
          .query(
            'UPDATE memory_entries SET content = ?, source_thread_id = ?, content_hash = ?, updated_at = ? WHERE id = ? AND scope = ? AND project_key = ?',
          )
          .run(
            content,
            input.sourceThreadID ?? existing.sourceThreadID,
            hash(content),
            timestamp,
            input.id!,
            input.scope,
            projectKey,
          )
        return this.read({
          id: input.id!,
          scope: input.scope,
          ...(input.projectKey ? { projectKey: input.projectKey } : {}),
        })
      })()
    const id = crypto.randomUUID()
    this.db.profileSqlite
      .query(
        `INSERT INTO memory_entries (id, scope, project_key, content, source_thread_id, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, project_key, content_hash) DO UPDATE SET content = excluded.content, source_thread_id = excluded.source_thread_id, updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.scope,
        projectKey,
        content,
        input.sourceThreadID ?? null,
        hash(content),
        timestamp,
        timestamp,
      )
    const row = this.db.profileSqlite
      .query(
        'SELECT id, scope, project_key, content, source_thread_id, created_at, updated_at FROM memory_entries WHERE scope = ? AND project_key = ? AND content_hash = ?',
      )
      .get(input.scope, projectKey, hash(content)) as Record<string, string | number | null>
    return parseEntry(row)
  }

  reset(input: { scope?: MemoryScope; projectKey?: string; includeEventLog?: boolean } = {}) {
    if (!this.enabled()) return 0
    const deleted = this.db.profileSqlite.transaction(() =>
      input.projectKey
        ? this.db.profileSqlite
            .query("DELETE FROM memory_entries WHERE scope = 'project' AND project_key = ?")
            .run(input.projectKey).changes
        : input.scope
          ? this.db.profileSqlite
              .query('DELETE FROM memory_entries WHERE scope = ?')
              .run(input.scope).changes
          : this.db.profileSqlite.query('DELETE FROM memory_entries').run().changes,
    )()
    if (input.includeEventLog) {
      if (input.projectKey)
        this.db.sqlite.query('DELETE FROM memory_jobs WHERE project_key = ?').run(input.projectKey)
      else if (input.scope === 'user')
        this.db.sqlite
          .query("DELETE FROM memory_jobs WHERE project_key IS NULL OR project_key = ''")
          .run()
      else this.db.sqlite.query('DELETE FROM memory_jobs').run()
    }
    return deleted
  }

  enqueue(input: { threadID?: string; projectKey?: string; transcript: string }) {
    if (!this.enabled() || !this.options.extractor) return null
    const safeTranscript = this.scrub(input.transcript).slice(-40_000)
    if (!safeTranscript || SECRET_PATTERNS.some((pattern) => pattern.test(input.transcript)))
      return null
    const id = crypto.randomUUID()
    const timestamp = Date.now()
    this.db.sqlite
      .query(
        "INSERT INTO memory_jobs (id, thread_id, project_key, status, payload, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)",
      )
      .run(
        id,
        input.threadID ?? null,
        input.projectKey ?? null,
        JSON.stringify({ transcript: safeTranscript }),
        timestamp,
        timestamp,
      )
    queueMicrotask(() => {
      void this.drain()
    })
    return id
  }

  drain(signal?: AbortSignal) {
    if (this.draining) return this.draining
    this.draining = (async () => {
      while (!signal?.aborted) {
        try {
          const result = await this.processNext(signal)
          if (!result) break
        } catch {
          // processNext durably marks business failures as failed. Continue to
          // later jobs without re-queuing the failed item.
        }
      }
    })().finally(() => {
      this.draining = null
      try {
        const queued = this.db.sqlite
          .query("SELECT 1 AS present FROM memory_jobs WHERE status = 'queued' LIMIT 1")
          .get()
        if (queued)
          queueMicrotask(() => {
            void this.drain(signal)
          })
      } catch {
        // The owning service may have closed SQLite while a startup drain was
        // finishing. There is no process-local work left to schedule.
      }
    })
    return this.draining
  }

  async processNext(signal?: AbortSignal) {
    if (!this.enabled() || !this.options.extractor) return null
    const job = this.db.transaction(() => {
      const row = this.db.sqlite
        .query(
          "SELECT id, thread_id, project_key, payload FROM memory_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1",
        )
        .get() as Record<string, string | null> | null
      if (!row) return null
      const claimed = this.db.sqlite
        .query(
          "UPDATE memory_jobs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'",
        )
        .run(Date.now(), Date.now(), row.id!)
      return claimed.changes ? row : null
    })
    if (!job) return null
    try {
      const payload = JSON.parse(job.payload!) as { transcript: string }
      const extracted = await this.options.extractor.extract({
        transcript: payload.transcript,
        projectKey: job.project_key ?? null,
        ...(signal ? { signal } : {}),
      })
      const saved = extracted.slice(0, 10).flatMap((entry) => {
        if (entry.scope === 'project' && !job.project_key) return []
        const memory = this.remember({
          scope: entry.scope,
          content: entry.content,
          ...(job.project_key ? { projectKey: job.project_key } : {}),
          ...(job.thread_id ? { sourceThreadID: job.thread_id } : {}),
        })
        return memory ? [memory] : []
      })
      this.db.sqlite
        .query(
          "UPDATE memory_jobs SET status = 'completed', result = ?, finished_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(JSON.stringify({ saved: saved.map(({ id }) => id) }), Date.now(), Date.now(), job.id!)
      return { id: job.id!, saved }
    } catch (cause) {
      const error = this.scrub(cause instanceof Error ? cause.message : String(cause)).slice(
        0,
        4_000,
      )
      this.db.sqlite
        .query(
          "UPDATE memory_jobs SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?",
        )
        .run(error, Date.now(), Date.now(), job.id!)
      throw cause
    }
  }
}
