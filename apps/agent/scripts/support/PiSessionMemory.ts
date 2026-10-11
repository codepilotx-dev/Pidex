import { uuidv7 } from '@earendil-works/pi-ai'
import {
  type Session,
  type LeafEntry,
  type SessionEntryCursorOptions,
  SessionError,
  type SessionMetadata,
  type SessionRepo,
  type SessionStorage,
  type SessionTreeEntry,
} from '../../src/orchestration/harness/Types.ts'
import {
  createSessionId,
  createTimestamp,
  getEntriesToFork,
  toSession,
} from '../../src/storage/pi-session/RepoUtils.ts'

function updateLabelCache(labelsById: Map<string, string>, entry: SessionTreeEntry): void {
  if (entry.type !== 'label') return
  const label = entry.label?.trim()
  if (label) {
    labelsById.set(entry.targetId, label)
  } else {
    labelsById.delete(entry.targetId)
  }
}

function buildLabelsById(entries: SessionTreeEntry[]): Map<string, string> {
  const labelsById = new Map<string, string>()
  for (const entry of entries) {
    updateLabelCache(labelsById, entry)
  }
  return labelsById
}

function generateEntryId(byId: { has(id: string): boolean }): string {
  for (let i = 0; i < 100; i++) {
    // The uuidv7 prefix is timestamp-derived and nearly constant between calls,
    // so short ids must come from the random tail.
    const id = uuidv7().slice(-8)
    if (!byId.has(id)) return id
  }
  return uuidv7()
}

function leafIdAfterEntry(entry: SessionTreeEntry): string | null {
  return entry.type === 'leaf' ? entry.targetId : entry.id
}

export class InMemorySessionStorage<
  TMetadata extends SessionMetadata = SessionMetadata,
> implements SessionStorage<TMetadata> {
  private readonly metadata: TMetadata
  private entries: SessionTreeEntry[]
  private byId: Map<string, SessionTreeEntry>
  private labelsById: Map<string, string>
  private leafId: string | null

  constructor(options?: { entries?: SessionTreeEntry[]; metadata?: TMetadata }) {
    this.entries = options?.entries ? [...options.entries] : []
    this.byId = new Map(this.entries.map((entry) => [entry.id, entry]))
    this.labelsById = buildLabelsById(this.entries)
    this.leafId = null
    for (const entry of this.entries) this.leafId = leafIdAfterEntry(entry)
    if (this.leafId !== null && !this.byId.has(this.leafId)) {
      throw new SessionError('invalid_session', `Entry ${this.leafId} not found`)
    }
    this.metadata =
      options?.metadata ?? ({ id: uuidv7(), createdAt: new Date().toISOString() } as TMetadata)
  }

  async getMetadata(): Promise<TMetadata> {
    return this.metadata
  }

  async getLeafId(): Promise<string | null> {
    if (this.leafId !== null && !this.byId.has(this.leafId)) {
      throw new SessionError('invalid_session', `Entry ${this.leafId} not found`)
    }
    return this.leafId
  }

  async setLeafId(leafId: string | null): Promise<void> {
    if (leafId !== null && !this.byId.has(leafId)) {
      throw new SessionError('not_found', `Entry ${leafId} not found`)
    }
    const entry: LeafEntry = {
      type: 'leaf',
      id: generateEntryId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      targetId: leafId,
    }
    this.entries.push(entry)
    this.byId.set(entry.id, entry)
    this.leafId = leafId
  }

  async createEntryId(): Promise<string> {
    return generateEntryId(this.byId)
  }

  async appendEntry(entry: SessionTreeEntry): Promise<void> {
    this.entries.push(entry)
    this.byId.set(entry.id, entry)
    updateLabelCache(this.labelsById, entry)
    this.leafId = leafIdAfterEntry(entry)
  }

  async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
    return this.byId.get(id)
  }

  async findEntries<TType extends SessionTreeEntry['type']>(
    type: TType,
  ): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
    return this.entries.filter(
      (entry): entry is Extract<SessionTreeEntry, { type: TType }> => entry.type === type,
    )
  }

  async getLabel(id: string): Promise<string | undefined> {
    return this.labelsById.get(id)
  }

  async getSessionName(): Promise<string | undefined> {
    const entries = await this.findEntries('session_info')
    return entries[entries.length - 1]?.name?.trim() || undefined
  }

  async getSessionStats() {
    let messageCount = 0
    let cachedTokens = 0
    let uncachedTokens = 0
    let totalTokens = 0
    let costTotal = 0
    for (const entry of this.entries) {
      if (entry.type === 'message') {
        messageCount += 1
      }
      const usage =
        entry.type === 'message'
          ? entry.message.role === 'assistant'
            ? entry.message.usage
            : undefined
          : entry.type === 'compaction' || entry.type === 'branch_summary'
            ? entry.usage
            : undefined
      if (
        !usage ||
        typeof usage.input !== 'number' ||
        typeof usage.output !== 'number' ||
        typeof usage.cacheRead !== 'number' ||
        typeof usage.cacheWrite !== 'number' ||
        typeof usage.cost?.total !== 'number'
      ) {
        continue
      }
      cachedTokens += usage.cacheRead
      uncachedTokens += usage.input + usage.cacheWrite
      totalTokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite
      costTotal += usage.cost.total
    }
    return {
      messageCount,
      cachedTokens,
      uncachedTokens,
      totalTokens,
      costTotal,
    }
  }

  async getPathToRootOrCompaction(leafId: string | null): Promise<SessionTreeEntry[]> {
    if (leafId === null) return []
    const path: SessionTreeEntry[] = []
    let stopAtEntryId: string | null = null
    let current = this.byId.get(leafId)
    if (!current) throw new SessionError('not_found', `Entry ${leafId} not found`)
    while (current) {
      path.unshift(current)
      if (stopAtEntryId !== null && current.id === stopAtEntryId) break
      if (current.type === 'compaction') {
        if (current.retainedTail) break
        stopAtEntryId = current.firstKeptEntryId ?? null
      }
      if (!current.parentId) break
      const parent = this.byId.get(current.parentId)
      if (!parent) throw new SessionError('invalid_session', `Entry ${current.parentId} not found`)
      current = parent
    }
    return path
  }

  async getEntries(options?: SessionEntryCursorOptions): Promise<SessionTreeEntry[]> {
    const start = options?.afterEntrySeq ?? 0
    const end = options?.limit === undefined ? undefined : start + options.limit
    return this.entries.slice(start, end)
  }
}

export class InMemorySessionRepo implements SessionRepo<SessionMetadata, { id?: string }, void> {
  private sessions = new Map<string, Session<SessionMetadata>>()

  async create(options: { id?: string } = {}): Promise<Session<SessionMetadata>> {
    const metadata: SessionMetadata = {
      id: options.id ?? createSessionId(),
      createdAt: createTimestamp(),
    }
    const storage = new InMemorySessionStorage({ metadata })
    const session = toSession(storage)
    this.sessions.set(metadata.id, session)
    return session
  }

  async open(metadata: SessionMetadata): Promise<Session<SessionMetadata>> {
    const session = this.sessions.get(metadata.id)
    if (!session) throw new SessionError('not_found', `Session not found: ${metadata.id}`)
    return session
  }

  async list(): Promise<SessionMetadata[]> {
    return Promise.all([...this.sessions.values()].map((session) => session.getMetadata()))
  }

  async delete(metadata: SessionMetadata): Promise<void> {
    this.sessions.delete(metadata.id)
  }

  async fork(
    sourceMetadata: SessionMetadata,
    options: { entryId?: string; position?: 'before' | 'at'; id?: string },
  ): Promise<Session<SessionMetadata>> {
    const source = await this.open(sourceMetadata)
    const forkedEntries = await getEntriesToFork(source.getStorage(), options)
    const metadata: SessionMetadata = {
      id: options.id ?? createSessionId(),
      createdAt: createTimestamp(),
    }
    const storage = new InMemorySessionStorage({ metadata, entries: forkedEntries })
    const session = toSession(storage)
    this.sessions.set(metadata.id, session)
    return session
  }
}
