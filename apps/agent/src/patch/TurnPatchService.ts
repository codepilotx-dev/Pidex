import { createHash } from 'node:crypto'
import type { RpcResult } from '@pidex/agent-protocol'
import { createTwoFilesPatch } from 'diff'
import { Effect } from 'effect'
import { AgentError, type Item } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import type { EventHub } from '../storage/events/EventHub'
import type {
  WorkspaceService,
  WorkspaceEditorFile,
  EditorMutation,
} from '../workspace/WorkspaceService'
import type {
  StoredTurnPatchBatch,
  TurnPatchApplyState,
  TurnPatchMutationFile,
} from './TurnPatchTypes'
import { parseHunks } from '../review/diff/Parsers'
import {
  UNRENDERABLE_CHANGED_BYTES,
  UNRENDERABLE_CHANGED_LINES,
  UNRENDERABLE_LINE_BYTES,
} from '../review/diff/Limits'

type ApplyAction = 'undo' | 'reapply'

type ApplyInput = {
  threadID: string
  itemID: string
  action: ApplyAction
  expectedVersion: number
  operationID: string
}

type ReadDiffInput = {
  threadID: string
  toolCallID: string
  path: string
}

type Endpoint = {
  path: string
  beforeContent: string | null
  beforeSha256: string | null
  afterContent: string | null
  afterSha256: string | null
}

const sha256 = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex')

const pathKey = (path: string) => {
  const normalized = path.replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const conflict = (
  paths: readonly string[],
  message = '文件已被后续修改，无法撤销或重新应用',
): never => {
  throw new AgentError('CONFLICT', message, 409, {
    reason: 'patch-state-changed',
    paths: [...new Set(paths)].slice(0, 100),
  })
}

const verifyEvidenceFile = (file: TurnPatchMutationFile) => {
  if (
    !file.path ||
    (file.beforeContent === null) !== (file.beforeSha256 === null) ||
    (file.afterContent === null) !== (file.afterSha256 === null) ||
    (file.beforeContent !== null && sha256(file.beforeContent) !== file.beforeSha256) ||
    (file.afterContent !== null && sha256(file.afterContent) !== file.afterSha256)
  ) {
    conflict([file.path || '<workspace-file>'], '修改文件卡片缺少可靠的可逆证据')
  }
  if (
    (file.operation === 'create' && (file.beforeContent !== null || file.afterContent === null)) ||
    (file.operation === 'update' && (file.beforeContent === null || file.afterContent === null)) ||
    (file.operation === 'delete' && (file.beforeContent === null || file.afterContent !== null))
  ) {
    conflict([file.path], '修改文件卡片的可逆证据无效')
  }
}

const collapseBatches = (batches: readonly StoredTurnPatchBatch[]): Endpoint[] => {
  const byPath = new Map<string, Endpoint>()
  for (const batch of batches) {
    const seen = new Set<string>()
    for (const file of batch.files) {
      verifyEvidenceFile(file)
      const key = pathKey(file.path)
      if (seen.has(key)) conflict([file.path], '单个工具批次重复修改了同一文件')
      seen.add(key)
      const current = byPath.get(key)
      if (!current) {
        byPath.set(key, {
          path: file.path,
          beforeContent: file.beforeContent,
          beforeSha256: file.beforeSha256,
          afterContent: file.afterContent,
          afterSha256: file.afterSha256,
        })
        continue
      }
      if (
        current.afterSha256 !== file.beforeSha256 ||
        current.afterContent !== file.beforeContent
      ) {
        conflict([file.path], '并行修改打断了该卡片的可逆文件链')
      }
      current.afterContent = file.afterContent
      current.afterSha256 = file.afterSha256
    }
  }
  return [...byPath.values()]
}

/** Shared by committed changes and host-inspected approval previews. */
export function buildFileDiff(
  file: Pick<TurnPatchMutationFile, 'path' | 'operation' | 'beforeContent' | 'afterContent'>,
): RpcResult<'thread/patch/diff'> {
  const patch = createTwoFilesPatch(
    file.operation === 'create' ? '/dev/null' : `a/${file.path}`,
    file.operation === 'delete' ? '/dev/null' : `b/${file.path}`,
    file.beforeContent ?? '',
    file.afterContent ?? '',
    undefined,
    undefined,
    { context: 3 },
  )
  const lines = patch.split('\n')
  const changedLines = lines.filter(
    (line) =>
      (line.startsWith('+') && !line.startsWith('+++')) ||
      (line.startsWith('-') && !line.startsWith('---')),
  ).length
  const changedBytes = Buffer.byteLength(patch, 'utf8')
  const maximumLineBytes = lines.reduce(
    (maximum, line) => Math.max(maximum, Buffer.byteLength(line, 'utf8')),
    0,
  )
  const tooLargeReason =
    changedLines > UNRENDERABLE_CHANGED_LINES
      ? 'changed-lines'
      : changedBytes > UNRENDERABLE_CHANGED_BYTES
        ? 'changed-bytes'
        : maximumLineBytes > UNRENDERABLE_LINE_BYTES
          ? 'line-bytes'
          : null
  return {
    path: file.path,
    operation: file.operation,
    patch: tooLargeReason ? '' : patch,
    hunks: tooLargeReason ? [] : parseHunks(patch),
    renderable: tooLargeReason === null,
    tooLargeReason,
  }
}

export class TurnPatchService {
  private readonly locks = new Map<string, Promise<void>>()

  constructor(
    private readonly db: AgentDatabase,
    private readonly hub: EventHub,
    private readonly resolveWorkspace: (threadID: string) => Promise<WorkspaceService>,
  ) {}

  private async withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = prior.then(() => current)
    this.locks.set(key, queued)
    await prior
    try {
      return await action()
    } finally {
      release()
      if (this.locks.get(key) === queued) this.locks.delete(key)
    }
  }

  readDiff(input: ReadDiffInput): RpcResult<'thread/patch/diff'> {
    const file = this.db.repositories.turnPatches.diffFileForToolCall(
      input.threadID,
      input.toolCallID,
      input.path,
    )
    if (!file) {
      throw new AgentError('CHECKPOINT_UNAVAILABLE', '该文件缺少可显示的编辑证据', 409)
    }
    try {
      verifyEvidenceFile(file)
    } catch {
      throw new AgentError('CHECKPOINT_UNAVAILABLE', '该文件缺少可显示的编辑证据', 409)
    }

    return buildFileDiff(file)
  }

  async apply(input: ApplyInput): Promise<Item> {
    return this.withLock(input.itemID, async () => {
      const request = {
        threadID: input.threadID,
        itemID: input.itemID,
        action: input.action,
        expectedVersion: input.expectedVersion,
      }
      const repeated = this.db.repositories.turnPatches.completedOperation(
        input.operationID,
        request,
      )
      if (repeated) {
        const item = this.db.getItem(repeated.itemID)
        if (!item || item.type !== 'patch') {
          throw new AgentError('THREAD_NOT_FOUND', '修改文件卡片不存在', 404)
        }
        return {
          ...item,
          data: {
            ...item.data,
            reversible: true,
            applyState: repeated.applyState,
            actionVersion: repeated.actionVersion,
          },
        }
      }

      const patchSet = this.db.repositories.turnPatches.getByItem(input.threadID, input.itemID)
      const item = this.db.getItem(input.itemID)
      if (
        !patchSet ||
        !patchSet.evidenceComplete ||
        !item ||
        item.type !== 'patch' ||
        item.turnID !== patchSet.turnID
      ) {
        throw new AgentError('CONFLICT', '该修改文件卡片不支持撤销', 409)
      }
      if (patchSet.actionVersion !== input.expectedVersion) {
        throw new AgentError('CONFLICT', '修改文件卡片状态已经变化，请刷新后重试', 409)
      }
      const expectedState: TurnPatchApplyState = input.action === 'undo' ? 'applied' : 'undone'
      if (patchSet.applyState !== expectedState) {
        throw new AgentError('CONFLICT', '修改文件卡片动作与当前状态不匹配', 409)
      }

      const endpoints = collapseBatches(this.db.repositories.turnPatches.batches(patchSet.turnID))
      if (endpoints.length === 0) {
        throw new AgentError('CONFLICT', '该修改文件卡片缺少可逆证据', 409)
      }
      const workspace = await this.resolveWorkspace(input.threadID)
      const mutations: EditorMutation[] = []
      const conflicts: string[] = []
      for (const endpoint of endpoints) {
        const expectedContent =
          input.action === 'undo' ? endpoint.afterContent : endpoint.beforeContent
        const expectedSha256 =
          input.action === 'undo' ? endpoint.afterSha256 : endpoint.beforeSha256
        const targetContent =
          input.action === 'undo' ? endpoint.beforeContent : endpoint.afterContent
        let current: WorkspaceEditorFile | null = null
        try {
          current = await workspace.readEditorFile(endpoint.path)
        } catch (cause) {
          if (!(cause instanceof AgentError) || cause.code !== 'WORKSPACE_PATH_NOT_FOUND') {
            throw cause
          }
        }
        if (
          (expectedContent === null && current !== null) ||
          (expectedContent !== null && current === null) ||
          (expectedSha256 !== null &&
            current !== null &&
            current.revision.sha256 !== expectedSha256)
        ) {
          conflicts.push(endpoint.path)
          continue
        }
        if (targetContent === null) {
          mutations.push({
            operation: 'delete',
            path: endpoint.path,
            expectedRevision: current!.revision,
          })
        } else if (current === null) {
          mutations.push({
            operation: 'create',
            path: endpoint.path,
            content: targetContent,
          })
        } else {
          mutations.push({
            operation: 'update',
            path: endpoint.path,
            content: targetContent,
            expectedRevision: current.revision,
          })
        }
      }
      if (conflicts.length > 0) conflict(conflicts)

      try {
        await workspace.commitEditorMutations(mutations)
      } catch (cause) {
        if (
          cause instanceof AgentError &&
          (cause.status === 409 ||
            cause.code === 'WORKSPACE_PATH_NOT_FOUND' ||
            cause.code === 'WORKSPACE_PATH_EXISTS')
        ) {
          conflict(endpoints.map(({ path }) => path))
        }
        throw cause
      }

      const nextState: TurnPatchApplyState = input.action === 'undo' ? 'undone' : 'applied'
      const { event, stored } = this.db.transaction(() => {
        const completed = this.db.repositories.turnPatches.completeOperation({
          operationID: input.operationID,
          request,
          turnID: patchSet.turnID,
          expectedVersion: input.expectedVersion,
          applyState: nextState,
          itemID: input.itemID,
        })
        const updated: Item = {
          ...item,
          data: {
            ...item.data,
            reversible: true,
            applyState: completed.applyState,
            actionVersion: completed.actionVersion,
          },
          updatedAt: Date.now(),
        }
        this.db.upsertItem(input.threadID, updated)
        const stored = this.db.getItem(updated.id) ?? updated
        const event = this.db.insertEvent(input.threadID, item.turnID, 'item/completed', {
          item: stored,
        })
        return { event, stored }
      })
      await Effect.runPromise(this.hub.publish(event))
      return stored
    })
  }
}
