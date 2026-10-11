import { createHash } from 'node:crypto'
import { AgentError } from '../../Domain'
import type { AgentDatabase } from '../../storage/database/AgentDatabase'

export const MESSAGE_FORK_STEPS = [
  'preflight',
  'prepare-worktree',
  'setup',
  'fork-history',
  'bind-target',
  'complete',
] as const

export type MessageForkStep = (typeof MESSAGE_FORK_STEPS)[number]
export type MessageForkStatus =
  'running' | 'awaiting-setup-decision' | 'completed' | 'failed' | 'abandoned'
export type MessageForkSnapshotMode = 'shared' | 'head' | 'working-tree' | null
export type MessageForkErrorCode =
  | 'FORK_OPERATION_NOT_FOUND'
  | 'FORK_OPERATION_CONFLICT'
  | 'FORK_POINT_NOT_FOUND'
  | 'FORK_POINT_IN_PROGRESS'
  | 'FORK_POINT_UNAVAILABLE'
  | 'HISTORY_UNSUPPORTED'
  | 'NOT_GIT'
  | 'WORKTREE_SETUP_REQUIRED'
  | 'WORKTREE_OPERATION_CONFLICT'
  | 'FORK_ABANDON_UNAVAILABLE'
  | 'INTERNAL_ERROR'

export type MessageForkOperation = {
  operationId: string
  sourceThreadId: string
  sourceTurnId: string
  sourceItemId: string
  targetThreadId: string | null
  targetWorktreeId: string | null
  destinationKind: 'same-worktree' | 'new-worktree'
  snapshotMode: MessageForkSnapshotMode
  status: MessageForkStatus
  step: MessageForkStep
  revision: number
  errorCode: MessageForkErrorCode | null
  warnings: string[]
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

type MessageForkRow = {
  operation_id: string
  source_thread_id: string
  source_turn_id: string
  source_item_id: string
  target_thread_id: string | null
  target_worktree_id: string | null
  worktree_operation_id: string | null
  destination_kind: 'same-worktree' | 'new-worktree'
  snapshot_mode: Exclude<MessageForkSnapshotMode, null> | null
  request_hash: string
  status: MessageForkStatus
  step: MessageForkStep
  revision: number
  error_code: MessageForkErrorCode | null
  warnings: string
  created_at: number
  updated_at: number
  completed_at: number | null
}

const warnings = (value: string) => {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}

const view = (row: MessageForkRow): MessageForkOperation => ({
  operationId: row.operation_id,
  sourceThreadId: row.source_thread_id,
  sourceTurnId: row.source_turn_id,
  sourceItemId: row.source_item_id,
  targetThreadId: row.target_thread_id,
  targetWorktreeId: row.target_worktree_id,
  destinationKind: row.destination_kind,
  snapshotMode: row.snapshot_mode,
  status: row.status,
  step: row.step,
  revision: row.revision,
  errorCode: row.error_code,
  warnings: warnings(row.warnings),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
})

/** Durable, path-free state for an asynchronous message fork operation. */
export class ThreadMessageForkRepository {
  constructor(
    private readonly db: AgentDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  static requestHash(input: {
    sourceThreadID: string
    sourceTurnID: string
    sourceItemID: string
    destinationKind: 'same-worktree' | 'new-worktree'
  }) {
    return createHash('sha256').update(JSON.stringify(input), 'utf8').digest('hex')
  }

  preflight(sourceThreadID: string, sourceTurnID: string, sourceItemID: string) {
    const row = this.db.sqlite
      .query(
        `
      SELECT threads.kind AS thread_kind, threads.git_branch,
        turns.status AS turn_status, items.type AS item_type,
        items.status AS item_status, items.data AS item_data
      FROM threads
      JOIN turns ON turns.thread_id = threads.id AND turns.id = ?
      JOIN items ON items.thread_id = threads.id AND items.turn_id = turns.id AND items.id = ?
      WHERE threads.id = ?
    `,
      )
      .get(sourceTurnID, sourceItemID, sourceThreadID) as {
      thread_kind: string
      git_branch: string | null
      turn_status: string
      item_type: string
      item_status: string
      item_data: string
    } | null
    if (!row) throw new AgentError('FORK_POINT_NOT_FOUND', '分叉消息不存在', 404)
    if (row.thread_kind !== 'main')
      throw new AgentError('HISTORY_UNSUPPORTED', '当前任务类型不支持消息分叉', 409)
    if (row.turn_status !== 'completed') {
      throw new AgentError(
        row.turn_status === 'running' || row.turn_status === 'queued'
          ? 'FORK_POINT_IN_PROGRESS'
          : 'FORK_POINT_UNAVAILABLE',
        '只能从已完成的回复继续',
        409,
      )
    }
    let data: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(row.item_data)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        data = parsed as Record<string, unknown>
    } catch {
      throw new AgentError('FORK_POINT_UNAVAILABLE', '分叉消息历史无效', 409)
    }
    if (
      row.item_type !== 'text' ||
      row.item_status !== 'completed' ||
      data.placement !== 'result'
    ) {
      throw new AgentError('FORK_POINT_UNAVAILABLE', '只能从已完成的最终回复继续', 409)
    }
    const active = Boolean(
      this.db.sqlite
        .query(
          `SELECT 1 FROM turns
      WHERE thread_id = ? AND status NOT IN ('completed','failed','interrupted','stopped') LIMIT 1`,
        )
        .get(sourceThreadID),
    )
    return { active, gitBranch: row.git_branch ?? '' }
  }

  create(input: {
    operationID: string
    sourceThreadID: string
    sourceTurnID: string
    sourceItemID: string
    destinationKind: 'same-worktree' | 'new-worktree'
    requestHash: string
  }) {
    const existing = this.row(input.operationID)
    if (existing) {
      if (existing.request_hash !== input.requestHash) {
        throw new AgentError('FORK_OPERATION_CONFLICT', 'operationId 已用于其他分叉请求', 409)
      }
      return view(existing)
    }
    const timestamp = this.now()
    try {
      this.db.sqlite
        .query(
          `INSERT INTO thread_message_fork_operations (
        operation_id, source_thread_id, source_turn_id, source_item_id,
        target_thread_id, target_worktree_id, worktree_operation_id,
        destination_kind, snapshot_mode, request_hash, status, step, revision,
        error_code, warnings, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, 'running', 'preflight', 1, NULL, '[]', ?, ?, NULL)`,
        )
        .run(
          input.operationID,
          input.sourceThreadID,
          input.sourceTurnID,
          input.sourceItemID,
          input.destinationKind,
          input.requestHash,
          timestamp,
          timestamp,
        )
    } catch (cause) {
      const raced = this.row(input.operationID)
      if (raced?.request_hash === input.requestHash) return view(raced)
      if (raced)
        throw new AgentError('FORK_OPERATION_CONFLICT', 'operationId 已用于其他分叉请求', 409)
      if (this.activeBoundary(input.sourceThreadID, input.sourceTurnID, input.sourceItemID)) {
        throw new AgentError('FORK_OPERATION_CONFLICT', '该回复已有进行中的分叉操作', 409)
      }
      throw cause
    }
    return this.get(input.operationID)
  }

  get(operationID: string) {
    const row = this.row(operationID)
    if (!row) throw new AgentError('FORK_OPERATION_NOT_FOUND', '分叉操作不存在', 404)
    return view(row)
  }

  find(operationID: string) {
    const row = this.row(operationID)
    return row ? view(row) : null
  }

  pending(sourceThreadID: string, sourceTurnID: string, sourceItemID: string) {
    const row = this.db.sqlite
      .query(
        `SELECT * FROM thread_message_fork_operations
      WHERE source_thread_id = ? AND source_turn_id = ? AND source_item_id = ?
      AND (
        status IN ('running', 'awaiting-setup-decision')
        OR (
          status = 'completed'
          AND target_thread_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM threads WHERE threads.id = target_thread_id)
        )
      )
      ORDER BY created_at DESC, operation_id DESC LIMIT 1`,
      )
      .get(sourceThreadID, sourceTurnID, sourceItemID) as MessageForkRow | null
    return row ? view(row) : null
  }

  runningOperationIDs() {
    return (
      this.db.sqlite
        .query(
          `SELECT operation_id FROM thread_message_fork_operations
      WHERE status = 'running' ORDER BY created_at, operation_id`,
        )
        .all() as Array<{ operation_id: string }>
    ).map((row) => row.operation_id)
  }

  worktreeOperationID(operationID: string) {
    const row = this.row(operationID)
    if (!row) throw new AgentError('FORK_OPERATION_NOT_FOUND', '分叉操作不存在', 404)
    return row.worktree_operation_id
  }

  update(
    operationID: string,
    expectedRevision: number,
    patch: {
      step?: MessageForkStep
      status?: MessageForkStatus
      snapshotMode?: Exclude<MessageForkSnapshotMode, null>
      targetThreadID?: string
      targetWorktreeID?: string
      worktreeOperationID?: string
      errorCode?: MessageForkErrorCode | null
      warning?: string
      completed?: boolean
    },
  ) {
    const row = this.row(operationID)
    if (!row) throw new AgentError('FORK_OPERATION_NOT_FOUND', '分叉操作不存在', 404)
    if (row.revision !== expectedRevision)
      throw new AgentError('FORK_OPERATION_CONFLICT', '分叉操作 revision 已变化', 409)
    const nextWarnings = warnings(row.warnings)
    if (patch.warning && !nextWarnings.includes(patch.warning)) nextWarnings.push(patch.warning)
    const timestamp = this.now()
    const changed = this.db.sqlite
      .query(
        `UPDATE thread_message_fork_operations SET
      target_thread_id = COALESCE(?, target_thread_id),
      target_worktree_id = COALESCE(?, target_worktree_id),
      worktree_operation_id = COALESCE(?, worktree_operation_id),
      snapshot_mode = COALESCE(?, snapshot_mode), status = COALESCE(?, status),
      step = COALESCE(?, step), revision = revision + 1, error_code = ?, warnings = ?,
      updated_at = ?, completed_at = ? WHERE operation_id = ? AND revision = ?`,
      )
      .run(
        patch.targetThreadID ?? null,
        patch.targetWorktreeID ?? null,
        patch.worktreeOperationID ?? null,
        patch.snapshotMode ?? null,
        patch.status ?? null,
        patch.step ?? null,
        patch.errorCode === undefined ? row.error_code : patch.errorCode,
        JSON.stringify(nextWarnings),
        timestamp,
        patch.completed ? timestamp : row.completed_at,
        operationID,
        expectedRevision,
      )
    if (changed.changes !== 1)
      throw new AgentError('FORK_OPERATION_CONFLICT', '分叉操作 revision 已变化', 409)
    return this.get(operationID)
  }

  fail(operationID: string, errorCode: MessageForkErrorCode) {
    const current = this.get(operationID)
    if (current.status === 'completed' || current.status === 'abandoned') return current
    return this.update(operationID, current.revision, {
      status: 'failed',
      errorCode,
      completed: true,
    })
  }

  async status(operationID: string, afterRevision?: number, waitMs = 0) {
    const boundedWait = Math.max(0, Math.min(30_000, Math.trunc(waitMs)))
    let operation = this.get(operationID)
    if (afterRevision === undefined || operation.revision > afterRevision || boundedWait === 0) {
      return {
        operation,
        changed: afterRevision === undefined || operation.revision > afterRevision,
      }
    }
    const deadline = this.now() + boundedWait
    while (this.now() < deadline) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(100, Math.max(1, deadline - this.now()))),
      )
      operation = this.get(operationID)
      if (operation.revision > afterRevision) return { operation, changed: true }
    }
    return { operation, changed: false }
  }

  private row(operationID: string) {
    return this.db.sqlite
      .query('SELECT * FROM thread_message_fork_operations WHERE operation_id = ?')
      .get(operationID) as MessageForkRow | null
  }

  private activeBoundary(sourceThreadID: string, sourceTurnID: string, sourceItemID: string) {
    return this.db.sqlite
      .query(
        `SELECT operation_id FROM thread_message_fork_operations
      WHERE source_thread_id = ? AND source_turn_id = ? AND source_item_id = ?
      AND status IN ('running', 'awaiting-setup-decision') LIMIT 1`,
      )
      .get(sourceThreadID, sourceTurnID, sourceItemID) as { operation_id: string } | null
  }
}
