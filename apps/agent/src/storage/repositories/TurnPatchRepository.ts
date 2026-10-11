import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { AgentError } from '../../Domain'
import type {
  StoredTurnPatchBatch,
  StoredTurnPatchSet,
  StoredTurnPatchToolBatch,
  TurnPatchApplyState,
  TurnPatchMutationBatch,
  TurnPatchMutationFile,
} from '../../patch/TurnPatchTypes'
import type { RepositoryDatabase } from './RepositoryDatabase'

const parse = <T>(value: string): T => JSON.parse(value) as T
const stringify = (value: unknown) => JSON.stringify(value)
const requestHash = (value: unknown) =>
  createHash('sha256').update(stringify(value), 'utf8').digest('hex')

type PatchSetRow = {
  thread_id: string
  turn_id: string
  item_id: string
  apply_state: TurnPatchApplyState
  action_version: number
  evidence_complete: number
}

const patchSet = (row: PatchSetRow): StoredTurnPatchSet => ({
  threadID: row.thread_id,
  turnID: row.turn_id,
  itemID: row.item_id,
  applyState: row.apply_state,
  actionVersion: row.action_version,
  evidenceComplete: row.evidence_complete === 1,
})

const pathKey = (path: string) => {
  const normalized = path.replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const isSafeDiffPath = (path: string) => {
  const normalized = path.replaceAll('\\', '/')
  const segments = normalized.split('/')
  return (
    Boolean(normalized) &&
    !isAbsolute(path) &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.startsWith('//') &&
    !segments.includes('') &&
    !segments.includes('.') &&
    !segments.includes('..') &&
    !normalized.includes('\0')
  )
}

const hasCompleteContentEvidence = (value: unknown): value is TurnPatchMutationFile => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const file = value as Partial<TurnPatchMutationFile>
  if (
    typeof file.path !== 'string' ||
    !isSafeDiffPath(file.path) ||
    !['create', 'update', 'delete'].includes(String(file.operation)) ||
    !(
      (typeof file.beforeContent === 'string' && typeof file.beforeSha256 === 'string') ||
      (file.beforeContent === null && file.beforeSha256 === null)
    ) ||
    !(
      (typeof file.afterContent === 'string' && typeof file.afterSha256 === 'string') ||
      (file.afterContent === null && file.afterSha256 === null)
    )
  )
    return false
  return (
    (file.operation === 'create' && file.beforeContent === null && file.afterContent !== null) ||
    (file.operation === 'update' && file.beforeContent !== null && file.afterContent !== null) ||
    (file.operation === 'delete' && file.beforeContent !== null && file.afterContent === null)
  )
}

export class TurnPatchRepository {
  constructor(private readonly db: RepositoryDatabase) {}

  recordBatch(input: TurnPatchMutationBatch) {
    if (input.files.length === 0) return
    const timestamp = Date.now()
    const itemID = `patch:${input.turnID}`
    this.db.transaction(() => {
      const execution = this.db.sqlite
        .query('SELECT thread_id, turn_id FROM agent_executions WHERE id = ?')
        .get(input.agentID) as { thread_id: string; turn_id: string } | null
      if (
        !execution ||
        execution.thread_id !== input.threadID ||
        execution.turn_id !== input.turnID
      ) {
        throw new AgentError('CONFLICT', '文件变更证据与当前执行不匹配', 409)
      }
      this.db.sqlite
        .query(
          `
        INSERT INTO turn_patch_sets (
          turn_id, thread_id, item_id, apply_state, action_version, evidence_complete, created_at, updated_at
        ) VALUES (?, ?, ?, 'applied', 0, 1, ?, ?)
        ON CONFLICT(turn_id) DO NOTHING
      `,
        )
        .run(input.turnID, input.threadID, itemID, timestamp, timestamp)

      const existing = this.db.sqlite
        .query('SELECT turn_id, files FROM turn_patch_batches WHERE tool_call_id = ?')
        .get(input.toolCallID) as { turn_id: string; files: string } | null
      const files = stringify(input.files)
      if (existing) {
        if (existing.turn_id !== input.turnID || existing.files !== files) {
          throw new AgentError('CONFLICT', 'toolCallId 已绑定不同的文件变更证据', 409)
        }
        return
      }
      const ordinal = Number(
        (
          this.db.sqlite
            .query(
              'SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal FROM turn_patch_batches WHERE turn_id = ?',
            )
            .get(input.turnID) as { ordinal: number }
        ).ordinal,
      )
      this.db.sqlite
        .query(
          `
        INSERT INTO turn_patch_batches (
          turn_id, ordinal, tool_call_id, files, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(input.turnID, ordinal, input.toolCallID, files, timestamp)
      this.db.sqlite
        .query('UPDATE turn_patch_sets SET updated_at = ? WHERE turn_id = ?')
        .run(timestamp, input.turnID)
    })
  }

  markIncomplete(threadID: string, turnID: string) {
    const timestamp = Date.now()
    return this.db.transaction(() => {
      this.db.sqlite
        .query(
          `
        INSERT INTO turn_patch_sets (
          turn_id, thread_id, item_id, apply_state, action_version,
          evidence_complete, created_at, updated_at
        ) VALUES (?, ?, ?, 'applied', 0, 0, ?, ?)
        ON CONFLICT(turn_id) DO UPDATE SET
          evidence_complete = 0,
          updated_at = excluded.updated_at
      `,
        )
        .run(turnID, threadID, `patch:${turnID}`, timestamp, timestamp)

      const rows = this.db.sqlite
        .query(
          `
        SELECT batches.tool_call_id
        FROM turn_patch_batches AS batches
        INNER JOIN items ON items.id = batches.tool_call_id
        WHERE batches.turn_id = ?
          AND items.thread_id = ?
          AND items.turn_id = ?
          AND items.type = 'tool'
          AND items.status = 'completed'
        ORDER BY batches.ordinal
      `,
        )
        .all(turnID, threadID, turnID) as Array<{ tool_call_id: string }>
      return rows.flatMap(({ tool_call_id }) => {
        const item = this.db.getItem(tool_call_id)
        return item ? [this.db.insertEvent(threadID, turnID, 'tool/callCompleted', { item })] : []
      })
    })
  }

  getByItem(threadID: string, itemID: string): StoredTurnPatchSet | null {
    const row = this.db.sqlite
      .query(
        `
      SELECT thread_id, turn_id, item_id, apply_state, action_version, evidence_complete
      FROM turn_patch_sets
      WHERE thread_id = ? AND item_id = ?
    `,
      )
      .get(threadID, itemID) as PatchSetRow | null
    return row ? patchSet(row) : null
  }

  getByTurn(turnID: string): StoredTurnPatchSet | null {
    const row = this.db.sqlite
      .query(
        `
      SELECT thread_id, turn_id, item_id, apply_state, action_version, evidence_complete
      FROM turn_patch_sets
      WHERE turn_id = ?
    `,
      )
      .get(turnID) as PatchSetRow | null
    return row ? patchSet(row) : null
  }

  batches(turnID: string): StoredTurnPatchBatch[] {
    return (
      this.db.sqlite
        .query(
          `
      SELECT ordinal, tool_call_id, files
      FROM turn_patch_batches
      WHERE turn_id = ?
      ORDER BY ordinal
    `,
        )
        .all(turnID) as Array<{
        ordinal: number
        tool_call_id: string
        files: string
      }>
    ).map((row) => ({
      ordinal: row.ordinal,
      toolCallID: row.tool_call_id,
      files: parse(row.files),
    }))
  }

  batchForToolCall(threadID: string, toolCallID: string): StoredTurnPatchToolBatch | null {
    const row = this.db.sqlite
      .query(
        `
      SELECT sets.thread_id, batches.turn_id, batches.ordinal, batches.tool_call_id, batches.files
      FROM turn_patch_batches AS batches
      INNER JOIN turn_patch_sets AS sets ON sets.turn_id = batches.turn_id
      WHERE sets.thread_id = ?
        AND sets.evidence_complete = 1
        AND batches.tool_call_id = ?
    `,
      )
      .get(threadID, toolCallID) as {
      thread_id: string
      turn_id: string
      ordinal: number
      tool_call_id: string
      files: string
    } | null
    if (!row) return null
    let parsedFiles: unknown
    try {
      parsedFiles = parse(row.files)
    } catch {
      return null
    }
    if (!Array.isArray(parsedFiles) || !parsedFiles.every(hasCompleteContentEvidence)) return null
    const files = parsedFiles
    return {
      threadID: row.thread_id,
      turnID: row.turn_id,
      ordinal: row.ordinal,
      toolCallID: row.tool_call_id,
      files,
    }
  }

  diffPathsForToolCall(threadID: string, toolCallID: string): string[] {
    const batch = this.batchForToolCall(threadID, toolCallID)
    if (!batch) return []
    const paths = new Map<string, string>()
    for (const file of batch.files) paths.set(pathKey(file.path), file.path)
    return [...paths.values()]
  }

  diffFileForToolCall(
    threadID: string,
    toolCallID: string,
    path: string,
  ): StoredTurnPatchBatch['files'][number] | null {
    const batch = this.batchForToolCall(threadID, toolCallID)
    if (!batch) return null
    const key = pathKey(path)
    return batch.files.find((file) => pathKey(file.path) === key) ?? null
  }

  completedOperation(
    operationID: string,
    request: unknown,
  ): { itemID: string; applyState: TurnPatchApplyState; actionVersion: number } | null {
    const row = this.db.sqlite
      .query(
        `
      SELECT request_hash, result
      FROM turn_patch_operations
      WHERE operation_id = ?
    `,
      )
      .get(operationID) as { request_hash: string; result: string } | null
    if (!row) return null
    if (row.request_hash !== requestHash(request)) {
      throw new AgentError('CONFLICT', 'operationId 已用于不同的撤销请求', 409)
    }
    return parse(row.result)
  }

  completeOperation(input: {
    operationID: string
    request: unknown
    turnID: string
    expectedVersion: number
    applyState: TurnPatchApplyState
    itemID: string
  }) {
    const timestamp = Date.now()
    return this.db.transaction(() => {
      const changed = this.db.sqlite
        .query(
          `
        UPDATE turn_patch_sets
        SET apply_state = ?, action_version = action_version + 1, updated_at = ?
        WHERE turn_id = ? AND action_version = ?
      `,
        )
        .run(input.applyState, timestamp, input.turnID, input.expectedVersion)
      if (changed.changes !== 1) {
        throw new AgentError('CONFLICT', '修改文件卡片状态已经变化，请刷新后重试', 409)
      }
      const state = this.getByTurn(input.turnID)!
      const result = {
        itemID: input.itemID,
        applyState: state.applyState,
        actionVersion: state.actionVersion,
      }
      this.db.sqlite
        .query(
          `
        INSERT INTO turn_patch_operations (
          operation_id, turn_id, request_hash, result, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(
          input.operationID,
          input.turnID,
          requestHash(input.request),
          stringify(result),
          timestamp,
        )
      return result
    })
  }
}
