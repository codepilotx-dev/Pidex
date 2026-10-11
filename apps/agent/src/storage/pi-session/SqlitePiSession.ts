import {
  SessionError,
  type SessionEntryCursorOptions,
  type SessionMetadata,
  type SessionRepo,
  type SessionStats,
  type SessionStorage,
  type SessionTreeEntry,
} from '../../orchestration/harness/Types'
import { Session } from './Session'
import { createSessionId, createTimestamp, getEntriesToFork } from './RepoUtils'
import type { AgentDatabase } from '../database/AgentDatabase'
import { parsePiSessionEntry } from './PiSessionEntry'

export interface SqlitePiSessionMetadata extends SessionMetadata {
  threadID: string
  agentID: string
}

export interface SqlitePiSessionCreateOptions {
  id?: string
  threadID: string
  agentID: string
}

export interface SqlitePiSessionListOptions {
  threadID?: string
  agentID?: string
}

type SessionRow = {
  id: string
  thread_id: string
  agent_id: string
  leaf_id: string | null
  created_at: number
}

type EntryRow = {
  id: string
  payload: string
}

const metadataFromRow = (row: SessionRow): SqlitePiSessionMetadata => ({
  id: row.id,
  threadID: row.thread_id,
  agentID: row.agent_id,
  createdAt: new Date(row.created_at).toISOString(),
})

const leafAfterEntry = (entry: SessionTreeEntry) =>
  entry.type === 'leaf' ? entry.targetId : entry.id

const usageFor = (entry: SessionTreeEntry) => {
  if (entry.type === 'message' && entry.message.role === 'assistant') return entry.message.usage
  if (entry.type === 'compaction' || entry.type === 'branch_summary') return entry.usage
  return undefined
}

/**
 * SQLite-backed Pi storage with a turn-local write buffer.
 *
 * Pi sees buffered entries immediately. Call {@link flush} inside the product
 * transaction that also commits items, turn state and durable outbox events.
 */
export class SqlitePiSessionStorage implements SessionStorage<SqlitePiSessionMetadata> {
  private readonly entries: SessionTreeEntry[] = []
  private readonly byID = new Map<string, SessionTreeEntry>()
  private readonly labelsByID = new Map<string, string>()
  private pendingEntries: SessionTreeEntry[] = []
  private stagedEntryCount = 0
  private leafID: string | null

  constructor(
    private readonly db: AgentDatabase,
    private readonly metadata: SqlitePiSessionMetadata,
  ) {
    const row = this.db.sqlite
      .query('SELECT leaf_id FROM pi_sessions WHERE id = ?')
      .get(metadata.id) as { leaf_id: string | null } | null
    if (!row) throw new SessionError('not_found', `Session not found: ${metadata.id}`)
    this.leafID = row.leaf_id
    this.reloadCommittedEntries()
  }

  private reloadCommittedEntries() {
    const rows = this.db.sqlite
      .query('SELECT id, payload FROM pi_session_entries WHERE session_id = ? ORDER BY sequence')
      .all(this.metadata.id) as EntryRow[]
    this.entries.length = 0
    this.byID.clear()
    this.labelsByID.clear()
    for (const row of rows) {
      const entry = parsePiSessionEntry(row)
      this.entries.push(entry)
      this.byID.set(entry.id, entry)
      this.updateLabel(entry)
    }
  }

  private updateLabel(entry: SessionTreeEntry) {
    if (entry.type !== 'label') return
    const label = entry.label?.trim()
    if (label) this.labelsByID.set(entry.targetId, label)
    else this.labelsByID.delete(entry.targetId)
  }

  async getMetadata() {
    return this.metadata
  }

  async getLeafId() {
    if (this.leafID !== null && !this.byID.has(this.leafID)) {
      throw new SessionError('invalid_session', `Entry ${this.leafID} not found`)
    }
    return this.leafID
  }

  async setLeafId(leafID: string | null) {
    if (leafID !== null && !this.byID.has(leafID)) {
      throw new SessionError('not_found', `Entry ${leafID} not found`)
    }
    await this.appendEntry({
      type: 'leaf',
      id: await this.createEntryId(),
      parentId: this.leafID,
      timestamp: createTimestamp(),
      targetId: leafID,
    })
  }

  async createEntryId() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = crypto.randomUUID().replaceAll('-', '').slice(-12)
      if (!this.byID.has(id)) return id
    }
    return crypto.randomUUID()
  }

  async appendEntry(entry: SessionTreeEntry) {
    if (!entry.id || this.byID.has(entry.id)) {
      throw new SessionError('invalid_entry', `Duplicate or empty entry id: ${entry.id}`)
    }
    if (!entry.type || !entry.timestamp || Number.isNaN(Date.parse(entry.timestamp))) {
      throw new SessionError('invalid_entry', `Invalid Pi session entry ${entry.id}`)
    }
    this.entries.push(entry)
    this.pendingEntries.push(entry)
    this.byID.set(entry.id, entry)
    this.updateLabel(entry)
    this.leafID = leafAfterEntry(entry)
  }

  async getEntry(id: string) {
    return this.byID.get(id)
  }

  async findEntries<TType extends SessionTreeEntry['type']>(type: TType) {
    return this.entries.filter(
      (entry): entry is Extract<SessionTreeEntry, { type: TType }> => entry.type === type,
    )
  }

  async getLabel(id: string) {
    return this.labelsByID.get(id)
  }

  async getSessionName() {
    const entries = await this.findEntries('session_info')
    return entries.at(-1)?.name?.trim() || undefined
  }

  async getSessionStats(): Promise<SessionStats> {
    let messageCount = 0
    let cachedTokens = 0
    let uncachedTokens = 0
    let totalTokens = 0
    let costTotal = 0
    for (const entry of this.entries) {
      if (entry.type === 'message') messageCount += 1
      const usage = usageFor(entry)
      if (!usage) continue
      cachedTokens += usage.cacheRead
      uncachedTokens += usage.input + usage.cacheWrite
      totalTokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite
      costTotal += usage.cost.total
    }
    return { messageCount, cachedTokens, uncachedTokens, totalTokens, costTotal }
  }

  async getPathToRootOrCompaction(leafID: string | null) {
    if (leafID === null) return []
    const path: SessionTreeEntry[] = []
    let stopAtEntryID: string | null = null
    let current = this.byID.get(leafID)
    if (!current) throw new SessionError('not_found', `Entry ${leafID} not found`)
    while (current) {
      path.unshift(current)
      if (stopAtEntryID !== null && current.id === stopAtEntryID) break
      if (current.type === 'compaction') {
        if (current.retainedTail) break
        stopAtEntryID = current.firstKeptEntryId ?? null
      }
      if (!current.parentId) break
      const parent = this.byID.get(current.parentId)
      if (!parent) throw new SessionError('invalid_session', `Entry ${current.parentId} not found`)
      current = parent
    }
    return path
  }

  async getEntries(options?: SessionEntryCursorOptions) {
    const start = options?.afterEntrySeq ?? 0
    const end = options?.limit === undefined ? undefined : start + options.limit
    return this.entries.slice(start, end)
  }

  get pendingCount() {
    return this.pendingEntries.length
  }

  /** Commit pending entries. This method is safe to call inside AgentDatabase.transaction(). */
  flush() {
    const pending = this.pendingEntries.slice(this.stagedEntryCount)
    if (!pending.length) return
    const stagedBefore = this.stagedEntryCount
    this.stagedEntryCount += pending.length
    const sessionID = this.metadata.id
    this.db.transaction(() => {
      const row = this.db.sqlite
        .query(
          'SELECT COALESCE(MAX(sequence), -1) + 1 AS sequence FROM pi_session_entries WHERE session_id = ?',
        )
        .get(sessionID) as { sequence: number }
      const insert = this.db.sqlite.query(`
        INSERT INTO pi_session_entries (session_id, sequence, id, parent_id, type, payload, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      pending.forEach((entry, offset) => {
        insert.run(
          sessionID,
          row.sequence + offset,
          entry.id,
          entry.parentId,
          entry.type,
          JSON.stringify(entry),
          Date.parse(entry.timestamp),
        )
      })
      const name = [...this.entries].reverse().find((entry) => entry.type === 'session_info')
      this.db.sqlite
        .query('UPDATE pi_sessions SET leaf_id = ?, name = ?, updated_at = ? WHERE id = ?')
        .run(
          this.leafID,
          name?.type === 'session_info' ? name.name?.trim() || null : null,
          Date.now(),
          sessionID,
        )
      if (stagedBefore === 0) {
        this.db.onTransactionCommit(() => {
          this.pendingEntries = this.pendingEntries.slice(this.stagedEntryCount)
          this.stagedEntryCount = 0
        })
        this.db.onTransactionRollback(() => {
          this.stagedEntryCount = 0
        })
      }
    })
  }

  /** Drop only uncommitted turn entries and restore the last durable leaf. */
  discardPending() {
    if (!this.pendingEntries.length) return
    this.pendingEntries = []
    this.stagedEntryCount = 0
    const row = this.db.sqlite
      .query('SELECT leaf_id FROM pi_sessions WHERE id = ?')
      .get(this.metadata.id) as { leaf_id: string | null } | null
    if (!row) throw new SessionError('not_found', `Session not found: ${this.metadata.id}`)
    this.leafID = row.leaf_id
    this.reloadCommittedEntries()
  }
}

export class SqlitePiSessionRepo implements SessionRepo<
  SqlitePiSessionMetadata,
  SqlitePiSessionCreateOptions,
  SqlitePiSessionListOptions
> {
  constructor(private readonly db: AgentDatabase) {}

  async create(options: SqlitePiSessionCreateOptions) {
    const metadata: SqlitePiSessionMetadata = {
      id: options.id ?? createSessionId(),
      threadID: options.threadID,
      agentID: options.agentID,
      createdAt: createTimestamp(),
    }
    const createdAt = Date.parse(metadata.createdAt)
    try {
      this.db.sqlite
        .query(
          `
        INSERT INTO pi_sessions (id, thread_id, agent_id, leaf_id, name, created_at, updated_at)
        VALUES (?, ?, ?, NULL, NULL, ?, ?)
      `,
        )
        .run(metadata.id, metadata.threadID, metadata.agentID, createdAt, createdAt)
    } catch (cause) {
      throw new SessionError(
        'storage',
        `Failed to create session ${metadata.id}`,
        cause instanceof Error ? cause : undefined,
      )
    }
    return new Session(new SqlitePiSessionStorage(this.db, metadata))
  }

  async open(metadata: SqlitePiSessionMetadata) {
    const row = this.db.sqlite
      .query('SELECT id, thread_id, agent_id, leaf_id, created_at FROM pi_sessions WHERE id = ?')
      .get(metadata.id) as SessionRow | null
    if (!row) throw new SessionError('not_found', `Session not found: ${metadata.id}`)
    return new Session(new SqlitePiSessionStorage(this.db, metadataFromRow(row)))
  }

  async openByID(id: string) {
    const row = this.db.sqlite
      .query('SELECT id, thread_id, agent_id, leaf_id, created_at FROM pi_sessions WHERE id = ?')
      .get(id) as SessionRow | null
    if (!row) throw new SessionError('not_found', `Session not found: ${id}`)
    return this.open(metadataFromRow(row))
  }

  async openForThread(id: string, threadID: string) {
    const session = await this.openByID(id)
    const metadata = await session.getMetadata()
    if (metadata.threadID !== threadID) {
      throw new SessionError('invalid_session', `Session ${id} belongs to a different thread`)
    }
    return session
  }

  async list(options?: SqlitePiSessionListOptions) {
    const clauses: string[] = []
    const values: string[] = []
    if (options?.threadID !== undefined) {
      clauses.push('thread_id = ?')
      values.push(options.threadID)
    }
    if (options?.agentID !== undefined) {
      clauses.push('agent_id = ?')
      values.push(options.agentID)
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db.sqlite
      .query(
        `SELECT id, thread_id, agent_id, leaf_id, created_at FROM pi_sessions${where} ORDER BY updated_at DESC, id`,
      )
      .all(...values) as SessionRow[]
    return rows.map(metadataFromRow)
  }

  async delete(metadata: SqlitePiSessionMetadata) {
    this.db.sqlite.query('DELETE FROM pi_sessions WHERE id = ?').run(metadata.id)
  }

  async fork(
    source: SqlitePiSessionMetadata,
    options: SqlitePiSessionCreateOptions & { entryId?: string; position?: 'before' | 'at' },
  ) {
    const sourceSession = await this.open(source)
    const entries = await getEntriesToFork(sourceSession.getStorage(), options)
    const forked = await this.create(options)
    const storage = forked.getStorage() as SqlitePiSessionStorage
    for (const entry of entries) await storage.appendEntry(entry)
    storage.flush()
    return forked
  }
}
