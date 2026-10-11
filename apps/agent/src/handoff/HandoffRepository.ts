import { createHash } from 'node:crypto'
import type { HandoffErrorCode } from '@pidex/agent-protocol'
import { AgentError } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'

export const HANDOFF_STEPS = [
  'preflight',
  'stop-source',
  'prepare-destination',
  'capture-source',
  'release-branch',
  'checkout-destination',
  'apply-source-changes',
  'fork-conversation',
  'transfer-core-state',
  'await-client-transfer',
  'archive-source',
  'complete',
] as const

export type HandoffStep = (typeof HANDOFF_STEPS)[number]
export type HandoffStatus =
  'running' | 'await-client-transfer' | 'completed' | 'failed' | 'rollback-failed'
export type HandoffDirection = 'local-to-worktree' | 'worktree-to-local'

export type HandoffJournal = {
  sourceHead?: string
  sourceBranch?: string
  destinationHead?: string
  destinationBranch?: string
  sourceStashRef?: string
  destinationStashRef?: string
  destinationStashApplied?: boolean
  sourceDetached?: boolean
  destinationCreated?: boolean
  sourceStashMarker?: string
  destinationStashMarker?: string
}

export type HandoffOperation = {
  operationId: string
  sourceThreadId: string
  targetThreadId: string | null
  direction: HandoffDirection
  status: HandoffStatus
  step: HandoffStep
  revision: number
  errorCode: HandoffErrorCode | null
  warnings: string[]
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

type HandoffRow = {
  operation_id: string
  source_thread_id: string
  target_thread_id: string | null
  source_binding_id: string | null
  target_binding_id: string | null
  direction: HandoffDirection
  destination_kind: 'local' | 'worktree' | null
  destination_worktree_id: string | null
  request_hash: string
  status: HandoffStatus
  step: HandoffStep
  revision: number
  error_code: HandoffErrorCode | null
  warnings: string
  rollback_journal: string
  created_at: number
  updated_at: number
  completed_at: number | null
}

const parseArray = (value: string) => {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : []
  } catch {
    return []
  }
}

const parseJournal = (value: string): HandoffJournal => {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as HandoffJournal)
      : {}
  } catch {
    return {}
  }
}

const view = (row: HandoffRow): HandoffOperation => ({
  operationId: row.operation_id,
  sourceThreadId: row.source_thread_id,
  targetThreadId: row.target_thread_id,
  direction: row.direction,
  status: row.status,
  step: row.step,
  revision: row.revision,
  errorCode: row.error_code,
  warnings: parseArray(row.warnings),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  completedAt: row.completed_at,
})

export class HandoffRepository {
  constructor(
    private readonly db: AgentDatabase,
    private readonly now: () => number = Date.now,
  ) {}

  static requestHash(input: {
    sourceThreadID: string
    direction: HandoffDirection
    destinationID?: string
  }) {
    return createHash('sha256').update(JSON.stringify(input), 'utf8').digest('hex')
  }

  create(input: {
    operationID: string
    sourceThreadID: string
    direction: HandoffDirection
    destination: { kind: 'local' } | { kind: 'worktree'; worktreeID: string }
    sourceBindingID?: string
    requestHash: string
  }) {
    const existing = this.row(input.operationID)
    if (existing) {
      if (
        existing.request_hash !== input.requestHash ||
        existing.source_thread_id !== input.sourceThreadID
      ) {
        throw new AgentError('CONFLICT', 'operationId 已用于其他 Handoff 请求', 409)
      }
      return view(existing)
    }
    const source = this.db.sqlite
      .query('SELECT id FROM threads WHERE id = ?')
      .get(input.sourceThreadID)
    if (!source) throw new AgentError('THREAD_NOT_FOUND', '源任务不存在', 404)
    const competing = this.db.sqlite
      .query(
        "SELECT operation_id FROM thread_handoff_operations WHERE source_thread_id = ? AND status IN ('running', 'await-client-transfer') LIMIT 1",
      )
      .get(input.sourceThreadID) as { operation_id: string } | null
    if (competing) throw new AgentError('HANDOFF_IN_PROGRESS', '源任务正在 Handoff', 409)
    const timestamp = this.now()
    this.db.sqlite
      .query(
        `INSERT INTO thread_handoff_operations (
      operation_id, source_thread_id, target_thread_id, source_binding_id, direction,
      destination_kind, destination_worktree_id, request_hash,
      status, step, revision, error_code, warnings, rollback_journal,
      created_at, updated_at, completed_at
    ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'running', 'preflight', 1, NULL, '[]', '{}', ?, ?, NULL)`,
      )
      .run(
        input.operationID,
        input.sourceThreadID,
        input.sourceBindingID ?? null,
        input.direction,
        input.destination.kind,
        input.destination.kind === 'worktree' ? input.destination.worktreeID : null,
        input.requestHash,
        timestamp,
        timestamp,
      )
    return this.get(input.operationID)
  }

  recordTargetBinding(operationID: string, bindingID: string) {
    const result = this.db.sqlite
      .query(
        `
      UPDATE thread_handoff_operations
      SET target_binding_id = ?, updated_at = ?
      WHERE operation_id = ? AND target_binding_id IS NULL
    `,
      )
      .run(bindingID, this.now(), operationID)
    if (result.changes === 1) return
    const row = this.row(operationID)
    if (row?.target_binding_id === bindingID) return
    if (!row) throw new AgentError('CONFLICT', 'Handoff operation 不存在', 404)
    throw new AgentError('CONFLICT', 'Handoff 目标 binding 已确定', 409)
  }

  targetBindingID(operationID: string) {
    const row = this.row(operationID)
    if (!row) throw new AgentError('CONFLICT', 'Handoff operation 不存在', 404)
    return row.target_binding_id
  }

  destination(operationID: string): { kind: 'local' } | { kind: 'worktree'; worktreeID: string } {
    const row = this.row(operationID)
    if (!row) throw new AgentError('CONFLICT', 'Handoff operation 不存在', 404)
    if (row.destination_kind === 'worktree' && row.destination_worktree_id) {
      return { kind: 'worktree', worktreeID: row.destination_worktree_id }
    }
    if (row.destination_kind === 'local') return { kind: 'local' }
    throw new AgentError('ROLLBACK_FAILED', 'Handoff 目标上下文缺失', 500)
  }

  get(operationID: string) {
    const row = this.row(operationID)
    if (!row) throw new AgentError('CONFLICT', 'Handoff operation 不存在', 404)
    return view(row)
  }

  find(operationID: string) {
    const row = this.row(operationID)
    return row ? view(row) : null
  }

  pending(sourceThreadID: string) {
    const row = this.db.sqlite
      .query(
        `
      SELECT * FROM thread_handoff_operations
      WHERE source_thread_id = ? AND status IN ('running', 'await-client-transfer')
      ORDER BY created_at, operation_id
      LIMIT 1
    `,
      )
      .get(sourceThreadID) as HandoffRow | null
    return row ? view(row) : null
  }

  runningOperationIDs(): string[] {
    return (
      this.db.sqlite
        .query(
          "SELECT operation_id FROM thread_handoff_operations WHERE status = 'running' ORDER BY created_at, operation_id",
        )
        .all() as Array<{ operation_id: string }>
    ).map((row) => row.operation_id)
  }

  pendingFinalizationIDs(): string[] {
    return (
      this.db.sqlite
        .query(
          `
      SELECT operation_id FROM thread_handoff_operations
      WHERE status = 'completed' AND rollback_journal <> '{}'
      ORDER BY completed_at, operation_id
    `,
        )
        .all() as Array<{ operation_id: string }>
    ).map((row) => row.operation_id)
  }

  journal(operationID: string) {
    const row = this.row(operationID)
    if (!row) throw new AgentError('CONFLICT', 'Handoff operation 不存在', 404)
    return parseJournal(row.rollback_journal)
  }

  isAdmissionLocked(threadID: string) {
    return Boolean(
      this.db.sqlite
        .query(
          "SELECT 1 FROM thread_handoff_operations WHERE source_thread_id = ? AND status IN ('running', 'await-client-transfer') LIMIT 1",
        )
        .get(threadID),
    )
  }

  assertAdmissionOpen(threadID: string) {
    if (this.isAdmissionLocked(threadID))
      throw new AgentError('HANDOFF_IN_PROGRESS', '任务正在 Handoff，暂不接受新运行或排队消息', 409)
  }

  advance(
    operationID: string,
    step: HandoffStep,
    patch: { targetThreadID?: string; warning?: string; journal?: Partial<HandoffJournal> } = {},
  ) {
    const current = this.row(operationID)
    if (!current) throw new AgentError('CONFLICT', 'Handoff operation 不存在', 404)
    if (current.status !== 'running') return view(current)
    const currentIndex = HANDOFF_STEPS.indexOf(current.step)
    const nextIndex = HANDOFF_STEPS.indexOf(step)
    if (nextIndex < currentIndex || nextIndex > currentIndex + 1)
      throw new AgentError('CONFLICT', 'Handoff step 顺序无效', 409)
    const warnings = parseArray(current.warnings)
    if (patch.warning && !warnings.includes(patch.warning)) warnings.push(patch.warning)
    const journal = { ...parseJournal(current.rollback_journal), ...patch.journal }
    const status: HandoffStatus =
      step === 'await-client-transfer' ? 'await-client-transfer' : 'running'
    const updated = this.db.sqlite
      .query(
        `UPDATE thread_handoff_operations SET
      target_thread_id = COALESCE(?, target_thread_id), status = ?, step = ?, revision = revision + 1,
      warnings = ?, rollback_journal = ?, updated_at = ? WHERE operation_id = ? AND revision = ?`,
      )
      .run(
        patch.targetThreadID ?? null,
        status,
        step,
        JSON.stringify(warnings),
        JSON.stringify(journal),
        this.now(),
        operationID,
        current.revision,
      )
    if (updated.changes !== 1) throw new AgentError('CONFLICT', 'Handoff revision 已变化', 409)
    return this.get(operationID)
  }

  checkpointJournal(operationID: string, patch: Partial<HandoffJournal>) {
    const current = this.row(operationID)
    if (!current) throw new AgentError('CONFLICT', 'Handoff operation 不存在', 404)
    if (current.status !== 'running') return view(current)
    const journal = { ...parseJournal(current.rollback_journal), ...patch }
    const updated = this.db.sqlite
      .query(
        `
      UPDATE thread_handoff_operations
      SET rollback_journal = ?, revision = revision + 1, updated_at = ?
      WHERE operation_id = ? AND revision = ? AND status = 'running'
    `,
      )
      .run(JSON.stringify(journal), this.now(), operationID, current.revision)
    if (updated.changes !== 1) throw new AgentError('CONFLICT', 'Handoff revision 已变化', 409)
    return this.get(operationID)
  }

  completeAfterClientTransfer(operationID: string, expectedRevision: number) {
    return this.db.transaction(() => {
      const current = this.row(operationID)
      if (!current) throw new AgentError('CONFLICT', 'Handoff operation 不存在', 404)
      if (current.status === 'completed') return view(current)
      if (current.status !== 'await-client-transfer' || !current.target_thread_id) {
        throw new AgentError('CLIENT_TRANSFER_REQUIRED', '必须先完成客户端状态迁移', 409)
      }
      if (current.revision !== expectedRevision)
        throw new AgentError('CONFLICT', 'Handoff revision 已变化', 409)
      const timestamp = this.now()
      const archived = this.db.sqlite
        .query(
          "UPDATE thread_handoff_operations SET step = 'archive-source', revision = revision + 1, updated_at = ? WHERE operation_id = ? AND revision = ?",
        )
        .run(timestamp, operationID, current.revision)
      if (archived.changes !== 1) throw new AgentError('CONFLICT', 'Handoff revision 已变化', 409)
      this.db.sqlite
        .query(
          'UPDATE threads SET archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ?',
        )
        .run(timestamp, timestamp, current.source_thread_id)
      const target = this.db.sqlite
        .query(
          'UPDATE threads SET archived_at = NULL, updated_at = ? WHERE id = ? AND archived_at = -1',
        )
        .run(timestamp, current.target_thread_id)
      if (target.changes !== 1)
        throw new AgentError('CONFLICT', 'Handoff 目标任务可见性状态无效', 409)
      const completed = this.db.sqlite
        .query(
          `UPDATE thread_handoff_operations SET status = 'completed', step = 'complete', revision = revision + 1,
        updated_at = ?, completed_at = ? WHERE operation_id = ? AND revision = ?`,
        )
        .run(timestamp, timestamp, operationID, current.revision + 1)
      if (completed.changes !== 1) throw new AgentError('CONFLICT', 'Handoff revision 已变化', 409)
      this.db.insertEvent(current.target_thread_id, null, 'thread/forked', {
        sourceThreadId: current.source_thread_id,
        targetThreadId: current.target_thread_id,
        operationId: operationID,
      })
      this.db.insertEvent(current.target_thread_id, null, 'thread/handoff/completed', {
        operationId: operationID,
        sourceThreadId: current.source_thread_id,
        targetThreadId: current.target_thread_id,
      })
      return this.get(operationID)
    })
  }

  fail(operationID: string, errorCode: HandoffErrorCode, rollbackFailed = false) {
    const current = this.row(operationID)
    if (!current || current.status === 'completed') return current ? view(current) : null
    this.db.sqlite
      .query(
        `UPDATE thread_handoff_operations SET status = ?, error_code = ?, revision = revision + 1,
      updated_at = ?, completed_at = ? WHERE operation_id = ?`,
      )
      .run(
        rollbackFailed ? 'rollback-failed' : 'failed',
        rollbackFailed ? 'ROLLBACK_FAILED' : errorCode,
        this.now(),
        this.now(),
        operationID,
      )
    return this.get(operationID)
  }

  appendWarning(operationID: string, warning: string) {
    const current = this.row(operationID)
    if (!current) throw new AgentError('CONFLICT', 'Handoff operation 不存在', 404)
    const warnings = parseArray(current.warnings)
    if (warnings.includes(warning)) return view(current)
    warnings.push(warning)
    this.db.sqlite
      .query(
        'UPDATE thread_handoff_operations SET warnings = ?, revision = revision + 1, updated_at = ? WHERE operation_id = ?',
      )
      .run(JSON.stringify(warnings), this.now(), operationID)
    return this.get(operationID)
  }

  clearJournal(operationID: string) {
    this.db.sqlite
      .query("UPDATE thread_handoff_operations SET rollback_journal = '{}' WHERE operation_id = ?")
      .run(operationID)
  }

  async status(operationID: string, afterRevision?: number, waitMs = 0) {
    const boundedWait = Math.max(0, Math.min(30_000, Math.trunc(waitMs)))
    let operation = this.get(operationID)
    if (afterRevision === undefined || operation.revision > afterRevision || boundedWait === 0)
      return {
        operation,
        changed: afterRevision === undefined || operation.revision > afterRevision,
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
      .query('SELECT * FROM thread_handoff_operations WHERE operation_id = ?')
      .get(operationID) as HandoffRow | null
  }
}
