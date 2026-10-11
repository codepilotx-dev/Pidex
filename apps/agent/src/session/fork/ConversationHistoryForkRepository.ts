import { randomUUID } from 'node:crypto'
import type { SessionTreeEntry } from '../../orchestration/harness/Types'
import { AgentError } from '../../Domain'
import {
  SqlitePiSessionRepo,
  type SqlitePiSessionMetadata,
} from '../../storage/pi-session/SqlitePiSession'
import type { AgentDatabase } from '../../storage/database/AgentDatabase'
import { parsePiSessionEntry } from '../../storage/pi-session/PiSessionEntry'
import { TurnPiBoundaryRepository } from '../../storage/repositories/TurnPiBoundaryRepository'
import type {
  SideChatRepository,
  StoredSideChat,
} from '../../storage/repositories/SideChatRepository'

type Scalar = string | number | bigint | Uint8Array | null
type Row = Record<string, Scalar>

const TERMINAL_TURN_STATES = new Set(['completed', 'failed', 'interrupted', 'stopped'])
const TERMINAL_AGENT_STATES = new Set(['completed', 'failed', 'interrupted', 'stopped'])

export type ThreadForkResult = {
  sourceThreadID: string
  targetThreadID: string
  threadIDs: ReadonlyMap<string, string>
  turnIDs: ReadonlyMap<string, string>
  agentIDs: ReadonlyMap<string, string>
}

export type ForkThroughOptions = {
  operationID: string
  targetThreadID?: string
  throughTurnID: string
  sourceItemID: string
  targetWorkspace: {
    cwd: string
    roots: string
    gitBranch: string
  }
  visible?: boolean
}

export type FullHistoryForkOptions = {
  operationID: string
  targetThreadID?: string
  targetWorkspace: ForkThroughOptions['targetWorkspace']
}

export type SideChatForkOptions = {
  operationID: string
  targetThreadID?: string
  referenceText?: string
  targetWorkspace: ForkThroughOptions['targetWorkspace']
}

type PiFork = {
  source: SqlitePiSessionMetadata
  targetSessionID: string
  targetThreadID: string
  targetAgentID: string
  entryID?: string
}

type ForkMappings = {
  threadIDs: Map<string, string>
  turnIDs: Map<string, string>
  agentIDs: Map<string, string>
  inputIDs: Map<string, string>
  itemIDs: Map<string, string>
  toolCallIDs: Map<string, string>
  taskIDs: Map<string, string>
  runIDs: Map<string, string>
  contextPathIDs: Map<string, string>
  includedTurns: Map<string, Set<string>>
}

const replaceIDs = (value: unknown, ids: ReadonlyMap<string, string>): unknown => {
  if (typeof value === 'string') return ids.get(value) ?? value
  if (Array.isArray(value)) return value.map((entry) => replaceIDs(entry, ids))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, replaceIDs(entry, ids)]),
    )
  }
  return value
}

const replaceJson = (value: Scalar, ids: ReadonlyMap<string, string>) => {
  if (typeof value !== 'string') return value
  try {
    return JSON.stringify(replaceIDs(JSON.parse(value), ids))
  } catch {
    return value
  }
}

const messageText = (entry: SessionTreeEntry) => {
  if (entry.type !== 'message' || entry.message.role !== 'assistant') return null
  const content = entry.message.content
  if (!Array.isArray(content)) return null
  if (
    content.some(
      (part) =>
        part && typeof part === 'object' && (part as { type?: unknown }).type === 'toolCall',
    )
  )
    return null
  const raw = content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return []
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? [text] : []
    })
    .join('\n')
  let inPlan = false
  return raw
    .split(/\r?\n/)
    .flatMap((line) => {
      if (/^\s*<proposed_plan>\s*$/.test(line)) {
        inPlan = true
        return []
      }
      if (/^\s*<\/proposed_plan>\s*$/.test(line) && inPlan) {
        inPlan = false
        return []
      }
      return inPlan ? [] : [line]
    })
    .join('\n')
    .trim()
}

const userMessageText = (entry: SessionTreeEntry) => {
  if (entry.type !== 'message' || entry.message.role !== 'user') return null
  if (typeof entry.message.content === 'string') return entry.message.content.trim()
  if (!Array.isArray(entry.message.content)) return null
  return entry.message.content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return []
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? [text] : []
    })
    .join('\n')
    .trim()
}

const matchesTurnInput = (entryText: string, input: string) => {
  const expected = input.trim()
  return entryText === expected || (expected.length > 0 && entryText.endsWith(`\n\n${expected}`))
}

const forkTitle = (title: string) => (title.endsWith('（分支）') ? title : `${title}（分支）`)

/**
 * Copies a completed prefix of durable conversation history. Runtime state,
 * events/outbox and review ownership intentionally remain with the source.
 */
export class ConversationHistoryForkRepository {
  private readonly sessions: Pick<SqlitePiSessionRepo, 'fork'>
  private readonly boundaries: TurnPiBoundaryRepository
  private readonly inFlight = new Map<
    string,
    { requestKey: string; promise: Promise<ThreadForkResult> }
  >()
  private readonly sideChatInFlight = new Map<
    string,
    { requestKey: string; promise: Promise<StoredSideChat> }
  >()

  constructor(
    private readonly db: AgentDatabase,
    private readonly nextID: () => string = randomUUID,
    sessions?: Pick<SqlitePiSessionRepo, 'fork'>,
  ) {
    this.sessions = sessions ?? new SqlitePiSessionRepo(db)
    this.boundaries = new TurnPiBoundaryRepository(db)
  }

  forkLatestForSideChat(
    sourceThreadID: string,
    options: SideChatForkOptions,
    sideChats: SideChatRepository,
  ): Promise<StoredSideChat> {
    const requestKey = JSON.stringify({
      sourceThreadID,
      targetThreadID: options.targetThreadID ?? null,
      referenceText: options.referenceText ?? null,
      targetWorkspace: options.targetWorkspace,
    })
    const existing = sideChats.findByOperation(options.operationID)
    if (existing) {
      if (
        existing.sourceThreadID !== sourceThreadID ||
        existing.referenceText !== (options.referenceText ?? null) ||
        (options.targetThreadID && existing.threadID !== options.targetThreadID)
      ) {
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他侧边聊天', 409)
      }
      return Promise.resolve(existing)
    }
    const inFlight = this.sideChatInFlight.get(options.operationID)
    if (inFlight) {
      if (inFlight.requestKey !== requestKey)
        throw new AgentError('OPERATION_ID_CONFLICT', 'operationId 已用于其他侧边聊天', 409)
      return inFlight.promise
    }
    const owned = this.forkLatestForSideChatOwned(sourceThreadID, options, sideChats)
    const tracked = owned.finally(() => {
      if (this.sideChatInFlight.get(options.operationID)?.promise === tracked)
        this.sideChatInFlight.delete(options.operationID)
    })
    this.sideChatInFlight.set(options.operationID, { requestKey, promise: tracked })
    return tracked
  }

  forkThrough(sourceThreadID: string, options: ForkThroughOptions): Promise<ThreadForkResult> {
    const requestKey = JSON.stringify({
      sourceThreadID,
      targetThreadID: options.targetThreadID ?? null,
      throughTurnID: options.throughTurnID,
      sourceItemID: options.sourceItemID,
      targetWorkspace: options.targetWorkspace,
      visible: options.visible === true,
    })
    const existing = this.inFlight.get(options.operationID)
    if (existing) {
      if (existing.requestKey !== requestKey)
        throw new AgentError('FORK_OPERATION_CONFLICT', '分叉 operationId 已绑定其他请求', 409)
      return existing.promise
    }
    const owned = this.forkThroughOwned(sourceThreadID, options)
    const tracked = owned.finally(() => {
      if (this.inFlight.get(options.operationID)?.promise === tracked)
        this.inFlight.delete(options.operationID)
    })
    this.inFlight.set(options.operationID, { requestKey, promise: tracked })
    return tracked
  }

  /** Handoff compatibility entrypoint: copies the complete terminal history and keeps it hidden. */
  async forkAllForHandoff(
    sourceThreadID: string,
    options: FullHistoryForkOptions,
  ): Promise<ThreadForkResult> {
    this.assertFullyForkable(sourceThreadID)
    let targetRootID = options.targetThreadID ?? this.nextID()
    const existing = this.db.sqlite
      .query('SELECT target_thread_id FROM thread_forks WHERE operation_id = ?')
      .get(options.operationID) as { target_thread_id: string } | null
    if (existing) {
      if (options.targetThreadID && existing.target_thread_id !== options.targetThreadID)
        throw new AgentError('CONFLICT', 'Handoff operationId 已绑定其他目标任务', 409)
      const committed = this.db.sqlite
        .query('SELECT target_thread_id FROM thread_handoff_operations WHERE operation_id = ?')
        .get(options.operationID) as { target_thread_id: string | null } | null
      if (committed?.target_thread_id === existing.target_thread_id) {
        return {
          sourceThreadID,
          targetThreadID: existing.target_thread_id,
          threadIDs: new Map([[sourceThreadID, existing.target_thread_id]]),
          turnIDs: new Map(),
          agentIDs: new Map(),
        }
      }
      this.rollbackHandoff(options.operationID)
      targetRootID = existing.target_thread_id
    }

    const maps = this.allocatePrefixMappings(sourceThreadID, targetRootID)
    const piForks = new Map<string, PiFork>()
    const copiedBoundaries: Array<{ turnID: string; sessionID: string; entryID: string }> = []
    try {
      this.db.transaction(() => {
        this.copyThreads(
          sourceThreadID,
          {
            ...options,
            throughTurnID: '',
            sourceItemID: '',
            visible: false,
          },
          maps,
          false,
        )
        this.copyConversationRows(maps, piForks)
        this.collectCopiedBoundaries(maps, piForks, copiedBoundaries)
        this.db.sqlite
          .query(
            'INSERT INTO thread_forks (target_thread_id, source_thread_id, operation_id, created_at) VALUES (?, ?, ?, ?)',
          )
          .run(targetRootID, sourceThreadID, options.operationID, Date.now())
      })
      for (const entry of piForks.values()) {
        await this.sessions.fork(entry.source, {
          id: entry.targetSessionID,
          threadID: entry.targetThreadID,
          agentID: entry.targetAgentID,
        })
      }
      this.db.transaction(() => {
        for (const boundary of copiedBoundaries) this.boundaries.upsert(boundary)
      })
    } catch (cause) {
      this.rollbackHandoff(options.operationID)
      if (cause instanceof AgentError) throw cause
      throw new AgentError('HISTORY_UNSUPPORTED', '任务历史无法完整迁移', 409)
    }
    return { sourceThreadID, targetThreadID: targetRootID, ...maps }
  }

  assertFullyForkable(sourceThreadID: string) {
    const source = this.db.sqlite
      .query('SELECT id, kind FROM threads WHERE id = ?')
      .get(sourceThreadID) as { id: string; kind: string } | null
    if (!source) throw new AgentError('THREAD_NOT_FOUND', '源任务不存在', 404)
    if (source.kind !== 'main' && source.kind !== 'subagent')
      throw new AgentError('HISTORY_UNSUPPORTED', '源任务包含不支持迁移的历史实体', 409)
    const blockingTurn = this.db.sqlite
      .query(
        "SELECT status FROM turns WHERE thread_id = ? AND status NOT IN ('completed', 'failed', 'interrupted', 'stopped') LIMIT 1",
      )
      .get(sourceThreadID) as { status: string } | null
    if (blockingTurn) {
      if (blockingTurn.status === 'queued')
        throw new AgentError('QUEUE_NOT_EMPTY', '源任务仍有排队消息', 409)
      throw new AgentError('SOURCE_ACTIVE', '源任务仍在运行', 409)
    }
    const pendingApproval = this.db.sqlite
      .query(
        "SELECT 1 FROM approval_requests WHERE thread_id = ? AND status IN ('preparing', 'pending', 'resolved', 'claimed') LIMIT 1",
      )
      .get(sourceThreadID)
    const pendingQuestion = this.db.sqlite
      .query(
        "SELECT 1 FROM question_requests WHERE thread_id = ? AND status IN ('pending', 'resolved', 'resuming') LIMIT 1",
      )
      .get(sourceThreadID)
    const checkpoint = this.db.sqlite
      .query('SELECT 1 FROM agent_checkpoints WHERE thread_id = ? LIMIT 1')
      .get(sourceThreadID)
    if (pendingApproval || pendingQuestion || checkpoint)
      throw new AgentError('PENDING_INTERACTION', '源任务存在待处理交互', 409)
    const incompleteChild = this.db.sqlite
      .query(
        "SELECT 1 FROM subagent_tasks WHERE parent_thread_id = ? AND status <> 'completed' LIMIT 1",
      )
      .get(sourceThreadID)
    if (incompleteChild) throw new AgentError('SOURCE_ACTIVE', '源任务仍有未完成的子任务', 409)
    return source
  }

  rollbackHandoff(operationID: string) {
    const marker = this.db.sqlite
      .query('SELECT target_thread_id FROM thread_forks WHERE operation_id = ?')
      .get(operationID) as { target_thread_id: string } | null
    const legacyTarget = marker
      ? null
      : (this.db.sqlite
          .query('SELECT id FROM threads WHERE create_operation_id = ?')
          .get(operationID) as { id: string } | null)
    const targetThreadID = marker?.target_thread_id ?? legacyTarget?.id
    if (targetThreadID)
      this.db.transaction(() =>
        this.db.sqlite.query('DELETE FROM threads WHERE id = ?').run(targetThreadID),
      )
  }

  private async forkThroughOwned(
    sourceThreadID: string,
    options: ForkThroughOptions,
  ): Promise<ThreadForkResult> {
    const selected = this.requireForkPoint(
      sourceThreadID,
      options.throughTurnID,
      options.sourceItemID,
    )
    const piBoundary = this.resolvePiBoundary(
      options.throughTurnID,
      selected.sessionID,
      selected.text,
    )
    let targetRootID = options.targetThreadID ?? this.nextID()
    const existing = this.db.sqlite
      .query(
        `
      SELECT target_thread_id
      FROM thread_message_forks
      WHERE operation_id = ?
    `,
      )
      .get(options.operationID) as { target_thread_id: string } | null
    if (existing) {
      if (options.targetThreadID && options.targetThreadID !== existing.target_thread_id) {
        throw new AgentError('FORK_OPERATION_CONFLICT', '分叉 operationId 已绑定其他目标任务', 409)
      }
      const committed = this.db.sqlite
        .query(
          `
        SELECT target_thread_id FROM thread_message_fork_operations WHERE operation_id = ?
      `,
        )
        .get(options.operationID) as { target_thread_id: string | null } | null
      if (committed?.target_thread_id === existing.target_thread_id) {
        if (options.visible) this.publishTarget(options.operationID, existing.target_thread_id)
        return {
          sourceThreadID,
          targetThreadID: existing.target_thread_id,
          threadIDs: new Map([[sourceThreadID, existing.target_thread_id]]),
          turnIDs: new Map(),
          agentIDs: new Map(),
        }
      }
      this.rollback(options.operationID)
      targetRootID = existing.target_thread_id
    }

    const maps = this.allocatePrefixMappings(sourceThreadID, targetRootID, options.throughTurnID)
    const piForks = new Map<string, PiFork>()
    const copiedBoundaries: Array<{ turnID: string; sessionID: string; entryID: string }> = []
    try {
      this.db.transaction(() => {
        this.copyThreads(sourceThreadID, options, maps)
        this.copyConversationRows(maps, piForks)
        this.collectCopiedBoundaries(maps, piForks, copiedBoundaries)
        const targetSelectedTurn = maps.turnIDs.get(options.throughTurnID)
        const targetSelectedSession = piForks.get(selected.sessionID)?.targetSessionID
        if (!targetSelectedTurn || !targetSelectedSession)
          throw new AgentError('FORK_POINT_UNAVAILABLE', '无法建立分叉会话边界', 409)
        const selectedFork = piForks.get(selected.sessionID)!
        selectedFork.entryID = piBoundary
        copiedBoundaries.splice(
          0,
          copiedBoundaries.length,
          ...copiedBoundaries.filter((entry) => entry.turnID !== targetSelectedTurn),
        )
        copiedBoundaries.push({
          turnID: targetSelectedTurn,
          sessionID: targetSelectedSession,
          entryID: piBoundary,
        })
        this.db.sqlite
          .query(
            `
          INSERT INTO thread_message_forks (
            target_thread_id, source_thread_id, source_turn_id,
            source_item_id, operation_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            targetRootID,
            sourceThreadID,
            options.throughTurnID,
            options.sourceItemID,
            options.operationID,
            Date.now(),
          )
      })

      for (const entry of piForks.values()) {
        await this.sessions.fork(entry.source, {
          id: entry.targetSessionID,
          threadID: entry.targetThreadID,
          agentID: entry.targetAgentID,
          ...(entry.entryID ? { entryId: entry.entryID, position: 'at' as const } : {}),
        })
      }
      this.db.transaction(() => {
        for (const boundary of copiedBoundaries) this.boundaries.upsert(boundary)
      })
      if (options.visible) this.publishTarget(options.operationID, targetRootID)
    } catch (cause) {
      this.rollbackHiddenTarget(targetRootID)
      if (cause instanceof AgentError) throw cause
      throw new AgentError('HISTORY_UNSUPPORTED', '任务历史无法完整分叉', 409)
    }
    return { sourceThreadID, targetThreadID: targetRootID, ...maps }
  }

  private async forkLatestForSideChatOwned(
    sourceThreadID: string,
    options: SideChatForkOptions,
    sideChats: SideChatRepository,
  ): Promise<StoredSideChat> {
    const source = this.db.sqlite
      .query(
        `
      SELECT threads.id, threads.kind
      FROM threads
      LEFT JOIN thread_side_chats ON thread_side_chats.thread_id = threads.id
      WHERE threads.id = ?
        AND thread_side_chats.thread_id IS NULL
        AND (threads.archived_at IS NULL OR threads.archived_at <> -1)
    `,
      )
      .get(sourceThreadID) as { id: string; kind: string } | null
    if (!source) throw new AgentError('THREAD_NOT_FOUND', '源任务不存在', 404)
    if (source.kind !== 'main')
      throw new AgentError('HISTORY_UNSUPPORTED', '只能从主任务创建侧边聊天', 409)

    const latestCompleted = this.db.sqlite
      .query(
        `
      SELECT id
      FROM turns
      WHERE thread_id = ? AND status = 'completed'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
      )
      .get(sourceThreadID) as { id: string } | null
    let sourceItemID: string | null = null
    let selected: ReturnType<ConversationHistoryForkRepository['requireForkPoint']> | null = null
    let piBoundary: string | null = null
    if (latestCompleted) {
      const candidates = this.db.sqlite
        .query(
          `
        SELECT items.id, items.data
        FROM items
        JOIN turns ON turns.id = items.turn_id
        WHERE items.thread_id = ? AND items.turn_id = ?
          AND items.agent_id = turns.root_agent_id
          AND items.type = 'text' AND items.status = 'completed'
        ORDER BY items.ordinal DESC, items.created_at DESC, items.id DESC
      `,
        )
        .all(sourceThreadID, latestCompleted.id) as Array<{ id: string; data: string }>
      sourceItemID =
        candidates.find((candidate) => {
          try {
            return (JSON.parse(candidate.data) as Record<string, unknown>).placement === 'result'
          } catch {
            return false
          }
        })?.id ?? null
      if (!sourceItemID)
        throw new AgentError('FORK_POINT_UNAVAILABLE', '最新完成回复缺少可安全分叉的结果', 409)
      selected = this.requireForkPoint(sourceThreadID, latestCompleted.id, sourceItemID)
      piBoundary = this.resolvePiBoundary(latestCompleted.id, selected.sessionID, selected.text)
    }

    const targetRootID = options.targetThreadID ?? this.nextID()
    const maps = latestCompleted
      ? this.allocatePrefixMappings(sourceThreadID, targetRootID, latestCompleted.id)
      : this.allocateEmptyMappings(sourceThreadID, targetRootID)
    const piForks = new Map<string, PiFork>()
    const copiedBoundaries: Array<{ turnID: string; sessionID: string; entryID: string }> = []
    const inheritedThroughTurnID = latestCompleted
      ? (maps.turnIDs.get(latestCompleted.id) ?? null)
      : null
    const createdAt = Date.now()
    try {
      this.db.transaction(() => {
        this.copyThreads(
          sourceThreadID,
          {
            ...options,
            throughTurnID: latestCompleted?.id ?? '',
            sourceItemID: sourceItemID ?? '',
            visible: false,
          },
          maps,
          false,
        )
        this.copyConversationRows(maps, piForks)
        this.collectCopiedBoundaries(maps, piForks, copiedBoundaries)
        if (latestCompleted && selected && piBoundary) {
          const targetSessionID = piForks.get(selected.sessionID)?.targetSessionID
          if (!inheritedThroughTurnID || !targetSessionID)
            throw new AgentError('FORK_POINT_UNAVAILABLE', '无法建立侧边聊天会话边界', 409)
          piForks.get(selected.sessionID)!.entryID = piBoundary
          copiedBoundaries.splice(
            0,
            copiedBoundaries.length,
            ...copiedBoundaries.filter((entry) => entry.turnID !== inheritedThroughTurnID),
          )
          copiedBoundaries.push({
            turnID: inheritedThroughTurnID,
            sessionID: targetSessionID,
            entryID: piBoundary,
          })
        }
        sideChats.insert({
          threadID: targetRootID,
          sourceThreadID,
          inheritedThroughTurnID,
          referenceText: options.referenceText ?? null,
          operationID: options.operationID,
          createdAt,
        })
      })
      for (const entry of piForks.values()) {
        await this.sessions.fork(entry.source, {
          id: entry.targetSessionID,
          threadID: entry.targetThreadID,
          agentID: entry.targetAgentID,
          ...(entry.entryID ? { entryId: entry.entryID, position: 'at' as const } : {}),
        })
      }
      this.db.transaction(() => {
        for (const boundary of copiedBoundaries) this.boundaries.upsert(boundary)
      })
    } catch (cause) {
      this.rollbackHiddenTarget(targetRootID)
      if (cause instanceof AgentError) throw cause
      throw new AgentError('HISTORY_UNSUPPORTED', '无法启动新的侧边聊天', 409)
    }
    return sideChats.findByThread(targetRootID)!
  }

  publishTarget(operationID: string, targetThreadID: string) {
    return this.db.transaction(() => {
      const lineage = this.db.sqlite
        .query(
          `
        SELECT source_thread_id, source_turn_id, source_item_id
        FROM thread_message_forks
        WHERE operation_id = ? AND target_thread_id = ?
      `,
        )
        .get(operationID, targetThreadID) as {
        source_thread_id: string
        source_turn_id: string
        source_item_id: string
      } | null
      if (!lineage) throw new AgentError('FORK_OPERATION_NOT_FOUND', '分叉操作不存在', 404)
      const target = this.db.sqlite
        .query('SELECT archived_at FROM threads WHERE id = ?')
        .get(targetThreadID) as { archived_at: number | null } | null
      if (!target) throw new AgentError('FORK_OPERATION_NOT_FOUND', '分叉目标不存在', 404)
      if (target.archived_at !== -1) return false
      this.db.sqlite
        .query(
          `
        WITH RECURSIVE forked_threads(id) AS (
          SELECT ?
          UNION ALL
          SELECT threads.id FROM threads JOIN forked_threads ON threads.parent_thread_id = forked_threads.id
        )
        UPDATE threads SET archived_at = NULL WHERE id IN (SELECT id FROM forked_threads)
      `,
        )
        .run(targetThreadID)
      this.db.insertEvent(targetThreadID, null, 'thread/forked', {
        threadId: targetThreadID,
        sourceThreadId: lineage.source_thread_id,
        lastTurnId: lineage.source_turn_id,
        sourceItemId: lineage.source_item_id,
      })
      return true
    })
  }

  rollback(operationID: string) {
    const marker = this.db.sqlite
      .query(
        `
      SELECT target_thread_id FROM thread_message_forks WHERE operation_id = ?
    `,
      )
      .get(operationID) as { target_thread_id: string } | null
    if (!marker) return false
    const target = this.db.sqlite
      .query('SELECT archived_at FROM threads WHERE id = ?')
      .get(marker.target_thread_id) as { archived_at: number | null } | null
    if (!target) return false
    if (target.archived_at !== -1) return false
    this.rollbackHiddenTarget(marker.target_thread_id)
    return true
  }

  private rollbackHiddenTarget(targetThreadID: string) {
    this.db.transaction(() => {
      const target = this.db.sqlite
        .query('SELECT archived_at FROM threads WHERE id = ?')
        .get(targetThreadID) as { archived_at: number | null } | null
      if (target?.archived_at === -1)
        this.db.sqlite.query('DELETE FROM threads WHERE id = ?').run(targetThreadID)
    })
  }

  private requireForkPoint(sourceThreadID: string, throughTurnID: string, sourceItemID: string) {
    const source = this.db.sqlite
      .query('SELECT kind FROM threads WHERE id = ?')
      .get(sourceThreadID) as { kind: string } | null
    if (!source) throw new AgentError('THREAD_NOT_FOUND', '源任务不存在', 404)
    if (source.kind !== 'main' && source.kind !== 'subagent')
      throw new AgentError('HISTORY_UNSUPPORTED', '源任务包含不支持分叉的历史实体', 409)
    const turn = this.db.sqlite
      .query(
        `
      SELECT turns.status, turns.root_agent_id, agent_executions.session_id
      FROM turns
      JOIN agent_executions ON agent_executions.id = turns.root_agent_id
      WHERE turns.id = ? AND turns.thread_id = ?
    `,
      )
      .get(throughTurnID, sourceThreadID) as {
      status: string
      root_agent_id: string
      session_id: string
    } | null
    if (!turn) throw new AgentError('FORK_POINT_NOT_FOUND', '分叉 Turn 不存在', 404)
    if (turn.status !== 'completed')
      throw new AgentError('FORK_POINT_IN_PROGRESS', '只能从已完成回复分叉', 409)
    const item = this.db.sqlite
      .query(
        `
      SELECT type, status, data, agent_id
      FROM items
      WHERE id = ? AND thread_id = ? AND turn_id = ?
    `,
      )
      .get(sourceItemID, sourceThreadID, throughTurnID) as {
      type: string
      status: string
      data: string
      agent_id: string
    } | null
    if (
      !item ||
      item.type !== 'text' ||
      item.status !== 'completed' ||
      item.agent_id !== turn.root_agent_id
    )
      throw new AgentError('FORK_POINT_NOT_FOUND', '分叉回复不存在', 404)
    let data: Record<string, unknown>
    try {
      data = JSON.parse(item.data) as Record<string, unknown>
    } catch {
      throw new AgentError('FORK_POINT_UNAVAILABLE', '分叉回复无法解析', 409)
    }
    if (data.placement !== 'result' || typeof data.text !== 'string')
      throw new AgentError('FORK_POINT_UNAVAILABLE', '所选内容不是最终回复', 409)
    const resultItems = this.db.sqlite
      .query(
        `
      SELECT id, data FROM items
      WHERE thread_id = ? AND turn_id = ? AND agent_id = ? AND type = 'text' AND status = 'completed'
      ORDER BY ordinal DESC, created_at DESC, id DESC
    `,
      )
      .all(sourceThreadID, throughTurnID, turn.root_agent_id) as Array<{ id: string; data: string }>
    const finalResultID = resultItems.find((candidate) => {
      try {
        return (JSON.parse(candidate.data) as Record<string, unknown>).placement === 'result'
      } catch {
        return false
      }
    })?.id
    if (finalResultID !== sourceItemID)
      throw new AgentError('FORK_POINT_UNAVAILABLE', '只能从该 Turn 的最终回复分叉', 409)
    return { sessionID: turn.session_id, text: data.text.trim() }
  }

  private resolvePiBoundary(turnID: string, sessionID: string, selectedText: string) {
    const exact = this.boundaries.get(turnID)
    if (exact) {
      if (exact.sessionID !== sessionID || !this.validAssistantEntry(sessionID, exact.entryID)) {
        throw new AgentError('FORK_POINT_UNAVAILABLE', '分叉会话边界无效', 409)
      }
      return exact.entryID
    }
    const turns = this.db.sqlite
      .query(
        `
      SELECT turns.id, inputs.content
      FROM turns
      JOIN agent_executions ON agent_executions.id = turns.root_agent_id
      JOIN inputs ON inputs.id = (
        SELECT candidate.id FROM inputs AS candidate
        WHERE candidate.turn_id = turns.id
        ORDER BY candidate.created_at, candidate.id LIMIT 1
      )
      WHERE turns.thread_id = (SELECT thread_id FROM turns WHERE id = ?)
        AND agent_executions.session_id = ?
      ORDER BY turns.created_at, turns.id
    `,
      )
      .all(turnID, sessionID) as Array<{ id: string; content: string }>
    const selectedTurnIndex = turns.findIndex((turn) => turn.id === turnID)
    if (selectedTurnIndex < 0)
      throw new AgentError('FORK_POINT_UNAVAILABLE', '旧任务缺少可安全确定的 Pi 分叉边界', 409)

    const branch = this.currentSessionBranch(sessionID)
    const userPositions: number[] = []
    let cursor = 0
    for (const turn of turns) {
      let position = -1
      for (let index = cursor; index < branch.length; index += 1) {
        const text = userMessageText(branch[index]!)
        if (text !== null && matchesTurnInput(text, turn.content)) {
          position = index
          break
        }
      }
      if (position < 0)
        throw new AgentError('FORK_POINT_UNAVAILABLE', '旧任务缺少可安全确定的 Pi 分叉边界', 409)
      userPositions.push(position)
      cursor = position + 1
    }

    const start = userPositions[selectedTurnIndex]!
    const end = userPositions[selectedTurnIndex + 1] ?? branch.length
    const candidates = branch.slice(start + 1, end).flatMap((entry) => {
      const text = messageText(entry)
      return text === null ? [] : [{ id: entry.id, text }]
    })
    const candidate = candidates.at(-1)
    if (!candidate || candidate.text !== selectedText) {
      throw new AgentError('FORK_POINT_UNAVAILABLE', '旧任务缺少可安全确定的 Pi 分叉边界', 409)
    }
    return candidate.id
  }

  private currentSessionBranch(sessionID: string) {
    const session = this.db.sqlite
      .query('SELECT leaf_id FROM pi_sessions WHERE id = ?')
      .get(sessionID) as { leaf_id: string | null } | null
    if (!session?.leaf_id)
      throw new AgentError('FORK_POINT_UNAVAILABLE', '旧任务缺少可安全确定的 Pi 分叉边界', 409)
    const rows = this.db.sqlite
      .query(
        `
      SELECT id, payload FROM pi_session_entries WHERE session_id = ? ORDER BY sequence
    `,
      )
      .all(sessionID) as Array<{ id: string; payload: string }>
    const byID = new Map(rows.map((row) => [row.id, parsePiSessionEntry(row)]))
    const reversed: SessionTreeEntry[] = []
    const visited = new Set<string>()
    let currentID: string | null = session.leaf_id
    while (currentID) {
      if (visited.has(currentID))
        throw new AgentError('FORK_POINT_UNAVAILABLE', '旧任务 Pi 分支包含循环', 409)
      visited.add(currentID)
      const entry = byID.get(currentID)
      if (!entry) throw new AgentError('FORK_POINT_UNAVAILABLE', '旧任务 Pi 分支不完整', 409)
      reversed.push(entry)
      currentID = entry.parentId
    }
    return reversed.reverse()
  }

  private validAssistantEntry(sessionID: string, entryID: string) {
    const row = this.db.sqlite
      .query(
        `
      SELECT id, payload FROM pi_session_entries WHERE session_id = ? AND id = ?
    `,
      )
      .get(sessionID, entryID) as { id: string; payload: string } | null
    return row ? messageText(parsePiSessionEntry(row)) !== null : false
  }

  private allocatePrefixMappings(
    sourceRootID: string,
    targetRootID: string,
    throughTurnID?: string,
  ): ForkMappings {
    const threadIDs = new Map<string, string>([[sourceRootID, targetRootID]])
    const includedTurns = new Map<string, Set<string>>()
    const rootTurns = this.db.sqlite
      .query(
        `
      SELECT id, status, created_at FROM turns WHERE thread_id = ? ORDER BY created_at, id
    `,
      )
      .all(sourceRootID) as Array<{ id: string; status: string; created_at: number }>
    const selectedIndex =
      throughTurnID === undefined
        ? rootTurns.length - 1
        : rootTurns.findIndex((turn) => turn.id === throughTurnID)
    if (throughTurnID !== undefined && selectedIndex < 0)
      throw new AgentError('FORK_POINT_NOT_FOUND', '分叉 Turn 不存在', 404)
    const prefix = selectedIndex < 0 ? [] : rootTurns.slice(0, selectedIndex + 1)
    if (prefix.some((turn) => !TERMINAL_TURN_STATES.has(turn.status)))
      throw new AgentError('HISTORY_UNSUPPORTED', '分叉点之前存在未终结 Turn', 409)
    includedTurns.set(sourceRootID, new Set(prefix.map((turn) => turn.id)))

    const visit = (sourceThreadID: string) => {
      const turns = includedTurns.get(sourceThreadID)!
      const placeholders = [...turns].map(() => '?').join(',')
      if (!placeholders) return
      const children = this.db.sqlite
        .query(
          `
        SELECT child_thread_id
        FROM subagent_tasks
        WHERE parent_thread_id = ? AND parent_turn_id IN (${placeholders}) AND status = 'completed'
        ORDER BY created_at, id
      `,
        )
        .all(sourceThreadID, ...turns) as Array<{ child_thread_id: string }>
      for (const child of children) {
        if (throughTurnID === undefined) this.assertFullyForkable(child.child_thread_id)
        const childTurns = this.db.sqlite
          .query('SELECT id, status FROM turns WHERE thread_id = ? ORDER BY created_at, id')
          .all(child.child_thread_id) as Array<{ id: string; status: string }>
        if (childTurns.some((turn) => !TERMINAL_TURN_STATES.has(turn.status)))
          throw new AgentError('HISTORY_UNSUPPORTED', '已完成子任务包含未终结 Turn', 409)
        threadIDs.set(child.child_thread_id, this.nextID())
        includedTurns.set(child.child_thread_id, new Set(childTurns.map((turn) => turn.id)))
        visit(child.child_thread_id)
      }
    }
    visit(sourceRootID)

    const turnIDs = new Map<string, string>()
    const agentIDs = new Map<string, string>()
    const inputIDs = new Map<string, string>()
    const itemIDs = new Map<string, string>()
    const toolCallIDs = new Map<string, string>()
    const taskIDs = new Map<string, string>()
    const runIDs = new Map<string, string>()
    const contextPathIDs = new Map<string, string>()
    for (const [sourceThreadID, turns] of includedTurns) {
      for (const turnID of turns) turnIDs.set(turnID, this.nextID())
      for (const row of this.rowsForTurns('agent_executions', sourceThreadID, turns))
        agentIDs.set(String(row.id), this.nextID())
      for (const row of this.rowsForTurns('inputs', sourceThreadID, turns))
        inputIDs.set(String(row.id), this.nextID())
      const linkedContextPaths =
        turns.size === 0
          ? []
          : (this.db.sqlite
              .query(
                `
        SELECT DISTINCT context.*
        FROM thread_context_paths AS context
        JOIN input_context_paths AS binding ON binding.context_path_id = context.id
        JOIN inputs ON inputs.id = binding.input_id
        WHERE inputs.thread_id = ? AND inputs.turn_id IN (${[...turns].map(() => '?').join(',')})
        ORDER BY context.created_at, context.id
      `,
              )
              .all(sourceThreadID, ...turns) as Row[])
      for (const row of linkedContextPaths) contextPathIDs.set(String(row.id), this.nextID())
      for (const row of this.completedTasks(sourceThreadID, turns))
        taskIDs.set(String(row.id), this.nextID())
      for (const row of this.rowsForTurns('items', sourceThreadID, turns)) {
        if (row.type !== 'subagent' || this.completedSubagentItem(row, taskIDs))
          itemIDs.set(String(row.id), this.nextID())
      }
      for (const row of this.rowsForTurns('tool_calls', sourceThreadID, turns))
        toolCallIDs.set(String(row.id), this.nextID())
    }
    for (const taskID of taskIDs.keys())
      for (const row of this.rows('subagent_runs', 'task_id', taskID))
        runIDs.set(String(row.id), this.nextID())
    return {
      threadIDs,
      turnIDs,
      agentIDs,
      inputIDs,
      itemIDs,
      toolCallIDs,
      taskIDs,
      runIDs,
      contextPathIDs,
      includedTurns,
    }
  }

  private allocateEmptyMappings(sourceRootID: string, targetRootID: string): ForkMappings {
    return {
      threadIDs: new Map([[sourceRootID, targetRootID]]),
      turnIDs: new Map(),
      agentIDs: new Map(),
      inputIDs: new Map(),
      itemIDs: new Map(),
      toolCallIDs: new Map(),
      taskIDs: new Map(),
      runIDs: new Map(),
      contextPathIDs: new Map(),
      includedTurns: new Map([[sourceRootID, new Set()]]),
    }
  }

  private copyThreads(
    sourceRootID: string,
    options: ForkThroughOptions,
    maps: ForkMappings,
    appendForkSuffix = true,
  ) {
    for (const [sourceID, targetID] of maps.threadIDs) {
      const row = this.row('threads', 'id', sourceID)
      if (!row) throw new AgentError('THREAD_NOT_FOUND', '源任务不存在', 404)
      row.id = targetID
      if (appendForkSuffix && sourceID === sourceRootID) row.title = forkTitle(String(row.title))
      row.parent_thread_id = row.parent_thread_id
        ? (maps.threadIDs.get(String(row.parent_thread_id)) ?? null)
        : null
      row.archived_at = -1
      row.create_operation_id = sourceID === sourceRootID ? options.operationID : null
      row.create_request_hash = null
      if (row.workspace_kind === 'project') {
        row.workspace_cwd = options.targetWorkspace.cwd
        row.workspace_roots = options.targetWorkspace.roots
      }
      row.git_branch = options.targetWorkspace.gitBranch
      row.queue_version = 0
      row.queue_pause_reason = null
      row.updated_at = Date.now()
      this.insert('threads', row)
    }
  }

  private copyConversationRows(maps: ForkMappings, piForks: Map<string, PiFork>) {
    const allIDs = new Map<string, string>([
      ...maps.threadIDs,
      ...maps.turnIDs,
      ...maps.agentIDs,
      ...maps.inputIDs,
      ...maps.itemIDs,
      ...maps.toolCallIDs,
      ...maps.taskIDs,
      ...maps.runIDs,
      ...maps.contextPathIDs,
    ])
    const sessionIDs = new Map<string, string>()
    for (const [sourceThreadID, targetThreadID] of maps.threadIDs) {
      const turns = maps.includedTurns.get(sourceThreadID)!
      for (const source of this.turnRows(sourceThreadID, turns))
        this.insert(
          'turns',
          this.remapRow(source, allIDs, {
            id: maps.turnIDs,
            thread_id: maps.threadIDs,
            root_agent_id: maps.agentIDs,
          }),
        )
      for (const source of this.rowsForTurns('inputs', sourceThreadID, turns))
        this.insert(
          'inputs',
          this.remapRow(source, allIDs, {
            id: maps.inputIDs,
            thread_id: maps.threadIDs,
            turn_id: maps.turnIDs,
          }),
        )
      for (const source of this.rowsForTurns('messages', sourceThreadID, turns))
        this.insert(
          'messages',
          this.remapRow({ ...source, id: this.nextID() }, allIDs, {
            thread_id: maps.threadIDs,
            turn_id: maps.turnIDs,
          }),
        )
      for (const source of this.rowsForTurns('agent_executions', sourceThreadID, turns)) {
        if (!TERMINAL_AGENT_STATES.has(String(source.status)))
          throw new AgentError('HISTORY_UNSUPPORTED', '分叉历史包含未终结 Agent execution', 409)
        const sourceSessionID = String(source.session_id)
        const targetSessionID = sessionIDs.get(sourceSessionID) ?? this.nextID()
        sessionIDs.set(sourceSessionID, targetSessionID)
        const targetAgentID = maps.agentIDs.get(String(source.id))!
        const row = this.remapRow(source, allIDs, {
          id: maps.agentIDs,
          thread_id: maps.threadIDs,
          turn_id: maps.turnIDs,
          parent_agent_id: maps.agentIDs,
          subagent_run_id: maps.runIDs,
        })
        row.session_id = targetSessionID
        this.insert('agent_executions', row)
        if (!piForks.has(sourceSessionID)) {
          const session = this.db.sqlite
            .query('SELECT id, thread_id, agent_id, created_at FROM pi_sessions WHERE id = ?')
            .get(sourceSessionID) as {
            id: string
            thread_id: string
            agent_id: string
            created_at: number
          } | null
          if (session)
            piForks.set(sourceSessionID, {
              source: {
                id: session.id,
                threadID: session.thread_id,
                agentID: session.agent_id,
                createdAt: new Date(session.created_at).toISOString(),
              },
              targetSessionID,
              targetThreadID,
              targetAgentID,
            })
        }
      }
      for (const source of this.rowsForTurns('items', sourceThreadID, turns)) {
        if (source.type === 'subagent' && !this.completedSubagentItem(source, maps.taskIDs))
          continue
        this.insert(
          'items',
          this.remapRow(source, allIDs, {
            id: maps.itemIDs,
            thread_id: maps.threadIDs,
            turn_id: maps.turnIDs,
            agent_id: maps.agentIDs,
          }),
        )
      }
      for (const source of this.rowsForTurns('tool_calls', sourceThreadID, turns))
        this.insert(
          'tool_calls',
          this.remapRow(source, allIDs, {
            id: maps.toolCallIDs,
            thread_id: maps.threadIDs,
            turn_id: maps.turnIDs,
            agent_id: maps.agentIDs,
          }),
        )
      for (const source of this.rowsForTurns('patches', sourceThreadID, turns))
        this.insert(
          'patches',
          this.remapRow({ ...source, id: this.nextID() }, allIDs, {
            thread_id: maps.threadIDs,
            turn_id: maps.turnIDs,
            agent_id: maps.agentIDs,
          }),
        )
      for (const source of this.rowsForTurns('agent_compactions', sourceThreadID, turns))
        this.insert(
          'agent_compactions',
          this.remapRow({ ...source, id: this.nextID() }, allIDs, {
            thread_id: maps.threadIDs,
            turn_id: maps.turnIDs,
          }),
        )
      for (const source of this.rowsByMappedIDs('input_attachments', 'input_id', maps.inputIDs))
        this.insert(
          'input_attachments',
          this.remapRow({ ...source, id: this.nextID() }, allIDs, {
            thread_id: maps.threadIDs,
            input_id: maps.inputIDs,
          }),
        )
      for (const source of this.rows('thread_context_paths', 'thread_id', sourceThreadID)) {
        if (!maps.contextPathIDs.has(String(source.id))) continue
        this.insert(
          'thread_context_paths',
          this.remapRow(source, allIDs, { id: maps.contextPathIDs, thread_id: maps.threadIDs }),
        )
      }
      const sourceInputIDs = this.rowsForTurns('inputs', sourceThreadID, turns).map(({ id }) =>
        String(id),
      )
      const contextBindings =
        sourceInputIDs.length === 0
          ? []
          : (this.db.sqlite
              .query(
                `
        SELECT binding.*
        FROM input_context_paths AS binding
        JOIN thread_context_paths AS context ON context.id = binding.context_path_id
        WHERE context.thread_id = ? AND binding.input_id IN (${sourceInputIDs.map(() => '?').join(',')})
        ORDER BY binding.sort_order, binding.created_at, binding.context_path_id
      `,
              )
              .all(sourceThreadID, ...sourceInputIDs) as Row[])
      for (const source of contextBindings) {
        if (!maps.contextPathIDs.has(String(source.context_path_id))) continue
        this.insert(
          'input_context_paths',
          this.remapRow(source, allIDs, {
            input_id: maps.inputIDs,
            context_path_id: maps.contextPathIDs,
          }),
        )
      }
      for (const source of this.rowsForTurns('turn_patch_sets', sourceThreadID, turns))
        this.insert(
          'turn_patch_sets',
          this.remapRow(source, allIDs, {
            turn_id: maps.turnIDs,
            thread_id: maps.threadIDs,
            item_id: maps.itemIDs,
          }),
        )
      for (const [sourceTaskID] of maps.taskIDs) {
        const task = this.row('subagent_tasks', 'id', sourceTaskID)
        if (!task || task.parent_thread_id !== sourceThreadID) continue
        this.insert(
          'subagent_tasks',
          this.remapRow(task, allIDs, {
            id: maps.taskIDs,
            parent_thread_id: maps.threadIDs,
            parent_turn_id: maps.turnIDs,
            parent_agent_id: maps.agentIDs,
            child_thread_id: maps.threadIDs,
            current_run_id: maps.runIDs,
          }),
        )
        for (const run of this.rows('subagent_runs', 'task_id', sourceTaskID))
          this.insert(
            'subagent_runs',
            this.remapRow(run, allIDs, { id: maps.runIDs, task_id: maps.taskIDs }),
          )
      }
      this.recomputeThreadSummary(targetThreadID)
    }
    for (const sourceTurnID of maps.turnIDs.keys()) {
      for (const source of this.rows('turn_patch_batches', 'turn_id', sourceTurnID))
        this.insert(
          'turn_patch_batches',
          this.remapRow(source, allIDs, { turn_id: maps.turnIDs, tool_call_id: maps.toolCallIDs }),
        )
      for (const source of this.rows('turn_patch_operations', 'turn_id', sourceTurnID))
        this.insert(
          'turn_patch_operations',
          this.remapRow({ ...source, operation_id: this.nextID() }, allIDs, {
            turn_id: maps.turnIDs,
          }),
        )
    }
  }

  private collectCopiedBoundaries(
    maps: ForkMappings,
    piForks: ReadonlyMap<string, PiFork>,
    output: Array<{ turnID: string; sessionID: string; entryID: string }>,
  ) {
    for (const [sourceTurnID, targetTurnID] of maps.turnIDs) {
      const boundary = this.boundaries.get(sourceTurnID)
      if (!boundary) continue
      const targetSessionID = piForks.get(boundary.sessionID)?.targetSessionID
      if (targetSessionID)
        output.push({ turnID: targetTurnID, sessionID: targetSessionID, entryID: boundary.entryID })
    }
  }

  private recomputeThreadSummary(threadID: string) {
    this.db.sqlite
      .query(
        `
      UPDATE threads SET
        message_count = (SELECT COUNT(*) FROM messages WHERE thread_id = ?),
        first_user_message = (SELECT content FROM messages WHERE thread_id = ? AND role = 'user' ORDER BY ordinal, created_at, id LIMIT 1),
        preview = (SELECT substr(content, 1, 180) FROM messages WHERE thread_id = ? ORDER BY ordinal DESC, created_at DESC, id DESC LIMIT 1)
      WHERE id = ?
    `,
      )
      .run(threadID, threadID, threadID, threadID)
  }

  private completedTasks(threadID: string, turns: ReadonlySet<string>): Row[] {
    if (!turns.size) return []
    const placeholders = [...turns].map(() => '?').join(',')
    return this.db.sqlite
      .query(
        `SELECT * FROM subagent_tasks WHERE parent_thread_id = ? AND parent_turn_id IN (${placeholders}) AND status = 'completed' ORDER BY rowid`,
      )
      .all(threadID, ...turns) as Row[]
  }

  private completedSubagentItem(item: Row, taskIDs: ReadonlyMap<string, string>) {
    if (typeof item.data !== 'string') return false
    try {
      const data = JSON.parse(item.data) as { subagentTaskId?: unknown }
      return typeof data.subagentTaskId === 'string' && taskIDs.has(data.subagentTaskId)
    } catch {
      return false
    }
  }

  private rowsForTurns(table: string, threadID: string, turns: ReadonlySet<string>): Row[] {
    if (!turns.size) return []
    const placeholders = [...turns].map(() => '?').join(',')
    return this.db.sqlite
      .query(
        `SELECT * FROM ${table} WHERE thread_id = ? AND turn_id IN (${placeholders}) ORDER BY rowid`,
      )
      .all(threadID, ...turns) as Row[]
  }

  private turnRows(threadID: string, turns: ReadonlySet<string>): Row[] {
    if (!turns.size) return []
    const values = [...turns]
    return this.db.sqlite
      .query(
        `SELECT * FROM turns WHERE thread_id = ? AND id IN (${values.map(() => '?').join(',')}) ORDER BY rowid`,
      )
      .all(threadID, ...values) as Row[]
  }

  private rowsByMappedIDs(table: string, field: string, ids: ReadonlyMap<string, string>): Row[] {
    if (!ids.size) return []
    const values = [...ids.keys()]
    return this.db.sqlite
      .query(
        `SELECT * FROM ${table} WHERE ${field} IN (${values.map(() => '?').join(',')}) ORDER BY rowid`,
      )
      .all(...values) as Row[]
  }

  private remapRow(
    source: Row,
    allIDs: ReadonlyMap<string, string>,
    fields: Record<string, ReadonlyMap<string, string>>,
  ) {
    const result = { ...source }
    for (const [field, mapping] of Object.entries(fields))
      if (result[field] != null) result[field] = mapping.get(String(result[field])) ?? result[field]
    for (const field of [
      'data',
      'input',
      'output',
      'files',
      'result',
      'replacement_history',
      'workspace_state',
    ])
      if (field in result) result[field] = replaceJson(result[field]!, allIDs)
    return result
  }

  private rows(table: string, field: string, value: string): Row[] {
    return this.db.sqlite
      .query(`SELECT * FROM ${table} WHERE ${field} = ? ORDER BY rowid`)
      .all(value) as Row[]
  }

  private row(table: string, field: string, value: string): Row | null {
    return this.db.sqlite
      .query(`SELECT * FROM ${table} WHERE ${field} = ?`)
      .get(value) as Row | null
  }

  private insert(table: string, row: Row) {
    const columns = Object.keys(row)
    this.db.sqlite
      .query(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      )
      .run(...columns.map((column) => row[column]!))
  }
}
