import { Effect } from 'effect'
import type { RpcMethod } from '@pidex/agent-protocol'
import type { RpcRouter } from '../RpcRouter'
import {
  decodeRpcParams as decodeParams,
  optionalRpcRecord as optionalRecord,
  rpcRecord as record,
} from '../Decoders'
import {
  AgentError,
  InvalidThreadHistoryCursorError,
  globalEventSequence,
  artifactMetadataView,
  attachmentView,
  decodeQueueAdd,
  decodeQueueInput,
  decodeQueueResume,
  decodeQueueUpdate,
  decodeThreadSettings,
  decodeThreadSettingsPatch,
  decodeTurnInterrupt,
  decodeTurnStart,
  decodeTurnSteer,
  enumValue,
  stringParam,
  submitMessage,
  supportedPermissionConfig,
} from '../RpcRouter'
import type { RpcHandlerGroup } from './Types'

export const threadHandlers = {
  name: 'thread',
  methods: [
    'thread/list',
    'thread/create',
    'thread/read',
    'thread/history/read',
    'prompt/preview',
    'prompt/refresh',
    'thread/compact',
    'thread/update',
    'thread/mark-read',
    'thread/mark-unread',
    'thread/title/regenerate',
    'thread/settings/update',
    'thread/delete',
    'thread/patch/diff',
    'thread/patch/apply',
    'turn/start',
    'turn/steer',
    'turn/interrupt',
    'turn/resume',
    'queue/add',
    'queue/update',
    'queue/remove',
    'queue/resume',
    'attachment/import',
    'attachment/read',
    'artifact/read',
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown): Promise<unknown> {
    const { db, threads, history, attachments, turnPatches } = runtime.dependencies
    const params = optionalRecord(rawParams)
    if (
      (
        [
          'turn/start',
          'turn/steer',
          'turn/resume',
          'queue/add',
          'queue/update',
          'queue/remove',
          'queue/resume',
        ] as readonly RpcMethod[]
      ).includes(method)
    ) {
      runtime.dependencies.handoff.assertAdmissionOpen(stringParam(params, 'threadId'))
    }
    switch (method) {
      case 'thread/list': {
        const projectID =
          typeof params.projectID === 'string'
            ? params.projectID
            : typeof params.projectId === 'string'
              ? params.projectId
              : undefined
        const archived = typeof params.archived === 'boolean' ? params.archived : undefined
        return runtime.projection.listPage({
          ...(projectID !== undefined ? { projectID } : {}),
          ...(archived !== undefined ? { archived } : {}),
          limit: typeof params.limit === 'number' ? params.limit : 100,
          ...(typeof params.cursor === 'string' ? { cursor: params.cursor } : {}),
        })
      }
      case 'thread/create': {
        const workspaceValue = record(params.workspace, 'workspace')
        const executionValue =
          workspaceValue.kind === 'project' && workspaceValue.execution !== undefined
            ? record(workspaceValue.execution, 'workspace.execution')
            : undefined
        let createdWorktree:
          Awaited<ReturnType<typeof runtime.dependencies.worktrees.create>> | undefined
        const execution = executionValue
          ? executionValue.kind === 'local'
            ? { kind: 'local' as const }
            : executionValue.kind === 'worktree'
              ? typeof executionValue.worktreeId === 'string'
                ? { kind: 'worktree' as const, worktreeId: executionValue.worktreeId }
                : executionValue.startingState && typeof executionValue.startingState === 'object'
                  ? await (async () => {
                      const starting = record(
                        executionValue.startingState,
                        'workspace.execution.startingState',
                      )
                      const type = enumValue(
                        starting.type,
                        ['branch', 'working-tree'] as const,
                        'startingState.type',
                      )
                      createdWorktree = await runtime.dependencies.worktrees.create({
                        projectId: stringParam(workspaceValue, 'projectId'),
                        operationId: `${stringParam(params, 'operationId')}:worktree`,
                        startingState:
                          type === 'branch'
                            ? { type, branchName: stringParam(starting, 'branchName') }
                            : { type },
                      })
                      runtime.dependencies.db.repositories.threadWorktreeOperations.recordCreated({
                        threadOperationId: stringParam(params, 'operationId'),
                        worktreeOperationId: `${stringParam(params, 'operationId')}:worktree`,
                        worktreeId: createdWorktree.worktree.id,
                        timestamp: Date.now(),
                      })
                      return { kind: 'worktree' as const, worktreeId: createdWorktree.worktree.id }
                    })()
                  : (() => {
                      throw new AgentError(
                        'INVALID_REQUEST',
                        'worktree execution 缺少 worktreeId 或 startingState',
                        400,
                      )
                    })()
              : (() => {
                  throw new AgentError('INVALID_REQUEST', 'workspace.execution.kind 参数无效', 400)
                })()
          : undefined
        const workspace =
          workspaceValue.kind === 'project'
            ? {
                kind: 'project' as const,
                projectID: stringParam(workspaceValue, 'projectId'),
                ...(execution ? { execution } : {}),
              }
            : workspaceValue.kind === 'projectless'
              ? {
                  kind: 'projectless' as const,
                  ...(typeof workspaceValue.prompt === 'string'
                    ? { prompt: workspaceValue.prompt }
                    : {}),
                }
              : (() => {
                  throw new AgentError('INVALID_REQUEST', 'workspace.kind 参数无效', 400)
                })()
        const settings =
          params.settings === undefined
            ? undefined
            : decodeParams(decodeThreadSettings, params.settings, 'thread/create.settings')
        if (settings) supportedPermissionConfig(settings.permissionConfig)
        const prepared =
          workspace.kind === 'project' && execution
            ? await runtime.dependencies.threadExecutions.prepare(workspace.projectID, execution)
            : undefined
        let created: Awaited<ReturnType<typeof threads.create>>
        try {
          created = await threads.create({
            ...(params.creationSurface === 'coding' ||
            params.creationSurface === 'working' ||
            params.creationSurface === 'chat'
              ? { creationSurface: params.creationSurface }
              : {}),
            ...(typeof params.title === 'string' ? { title: params.title } : {}),
            ...(settings ? { settings } : {}),
            workspace,
            operationID: stringParam(params, 'operationId'),
            ...(typeof params.workflowId === 'string'
              ? { sessionGroupID: params.workflowId }
              : typeof params.sessionGroupId === 'string'
                ? { sessionGroupID: params.sessionGroupId }
                : {}),
            ...(prepared ? { bindExecution: prepared.bind } : {}),
          })
        } catch (cause) {
          if (createdWorktree)
            runtime.dependencies.db.repositories.threadWorktreeOperations.markFailed(
              stringParam(params, 'operationId'),
              Date.now(),
            )
          await prepared?.abort()
          throw cause
        }
        await prepared?.reconcile(created.id)
        if (createdWorktree)
          runtime.dependencies.db.repositories.threadWorktreeOperations.markPublished(
            stringParam(params, 'operationId'),
            created.id,
            Date.now(),
          )
        return runtime.threadSnapshotResult(created.id)
      }
      case 'thread/read':
        return runtime.threadSnapshotResult(stringParam(params, 'threadId'))
      case 'thread/patch/diff':
        return turnPatches.readDiff({
          threadID: stringParam(params, 'threadId'),
          toolCallID: stringParam(params, 'toolCallId'),
          path: stringParam(params, 'path'),
        })
      case 'thread/patch/apply': {
        if (
          typeof params.expectedVersion !== 'number' ||
          !Number.isSafeInteger(params.expectedVersion) ||
          params.expectedVersion < 0
        ) {
          throw new AgentError('INVALID_REQUEST', 'expectedVersion 参数无效', 400)
        }
        const stored = await turnPatches.apply({
          threadID: stringParam(params, 'threadId'),
          itemID: stringParam(params, 'itemId'),
          action: enumValue(params.action, ['undo', 'reapply'] as const, 'action'),
          expectedVersion: params.expectedVersion,
          operationID: stringParam(params, 'operationId'),
        })
        const item = runtime.projection.item(stored)
        if (!item || item.type !== 'patch') {
          throw new AgentError('CONFLICT', '修改文件卡片不存在', 409)
        }
        return { item }
      }
      case 'thread/history/read': {
        const threadId = stringParam(params, 'threadId')
        try {
          return runtime.threadHistoryPageResult(threadId, {
            ...(typeof params.before === 'string' ? { before: params.before } : {}),
            ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
          })
        } catch (cause) {
          if (cause instanceof InvalidThreadHistoryCursorError)
            throw new AgentError('CONFLICT', cause.message, 409)
          throw cause
        }
      }
      case 'prompt/preview': {
        const threadId = stringParam(params, 'threadId')
        const preview = await threads.promptPreview(threadId)
        if (!preview)
          throw new AgentError('PROMPT_PREVIEW_UNAVAILABLE', '该任务尚未建立新提示词 baseline', 409)
        return { threadId, preview, cacheKey: preview.cacheKey }
      }
      case 'prompt/refresh': {
        const threadId = stringParam(params, 'threadId')
        const settings = threads.refreshPromptSettings(threadId)
        const preview = await threads.promptPreview(threadId)
        if (!preview)
          throw new AgentError('CHECKPOINT_UNAVAILABLE', '无法刷新提示词 cache key', 409)
        return { threadId, settings, cacheKey: preview.cacheKey }
      }
      case 'thread/compact':
        return { compaction: await threads.compact(stringParam(params, 'threadId')) }
      case 'thread/update': {
        const threadId = stringParam(params, 'threadId')
        const patch = record(params.patch, 'patch')
        const title = patch.title
        const archived = patch.archived
        if (title !== undefined && title !== null && typeof title !== 'string')
          throw new AgentError('INVALID_REQUEST', 'title 参数无效', 400)
        if (archived !== undefined && typeof archived !== 'boolean')
          throw new AgentError('INVALID_REQUEST', 'archived 参数无效', 400)
        if (archived === true) {
          await runtime.dependencies.automation.removeThreadSchedules(threadId)
          await runtime.dependencies.scheduledTasks?.removeThreadSchedules(threadId)
          const paused = db.pauseQueue(threadId, 'interrupted')
          if (paused) await Effect.runPromise(runtime.dependencies.hub.publish(paused))
          const active = db.activeTurn(threadId)
          if (active) await threads.stop(threadId, active.id)
        }
        const thread = await history.patch(threadId, {
          ...(title !== undefined ? { title } : {}),
          ...(archived !== undefined ? { archived } : {}),
        })
        return { thread }
      }
      case 'thread/mark-read': {
        const threadId = stringParam(params, 'threadId')
        const readThroughAt = params.readThroughAt
        if (
          typeof readThroughAt !== 'number' ||
          !Number.isFinite(readThroughAt) ||
          readThroughAt < 0
        ) {
          throw new AgentError('INVALID_REQUEST', 'readThroughAt 参数无效', 400)
        }
        return { thread: history.markRead(threadId, readThroughAt) }
      }
      case 'thread/mark-unread': {
        const threadId = stringParam(params, 'threadId')
        const unreadAt = params.unreadAt
        if (typeof unreadAt !== 'number' || !Number.isFinite(unreadAt) || unreadAt < 0) {
          throw new AgentError('INVALID_REQUEST', 'unreadAt 参数无效', 400)
        }
        return { thread: history.markUnread(threadId, unreadAt) }
      }
      case 'thread/title/regenerate':
        return { thread: await threads.regenerateTitle(stringParam(params, 'threadId')) }
      case 'thread/settings/update': {
        const threadId = stringParam(params, 'threadId')
        const settings = decodeParams(
          decodeThreadSettingsPatch,
          params.settings,
          'thread/settings/update.settings',
        )
        if (settings.permissionConfig) supportedPermissionConfig(settings.permissionConfig)
        return history.patchSettings(threadId, settings)
      }
      case 'thread/delete': {
        const threadId = stringParam(params, 'threadId')
        await history.remove(threadId)
        return { threadId, deletedAt: Date.now() }
      }
      case 'turn/start': {
        const start = decodeParams(decodeTurnStart, rawParams, 'turn/start')
        const threadId = start.threadId
        const submitted = await threads.startTurn(
          threadId,
          submitMessage(start),
          start.inputId,
          start.attachmentIds ?? [],
          start.contextReferenceIds ?? [],
          start.goal
            ? {
                objective: start.goal.objective,
                expectedVersion: start.goal.expectedVersion,
                ...(start.goal.tokenBudget === undefined
                  ? {}
                  : { tokenBudget: start.goal.tokenBudget }),
              }
            : undefined,
        )
        const sequence = globalEventSequence(db)
        return {
          inputId: submitted.inputID,
          turnId: submitted.turnID,
          disposition: submitted.disposition === 'duplicate' ? 'duplicate' : 'accepted',
          streamPosition: { streamId: threadId, sequence },
        }
      }
      case 'turn/steer': {
        const request = decodeParams(decodeTurnSteer, rawParams, 'turn/steer')
        const activeInput = db.getTurnInput(request.turnId)
        if (!activeInput)
          throw new AgentError('TURN_ID_MISMATCH', '活动 Turn 已变化，请刷新后重试', 409)
        const submitted = await threads.steerTurn(
          request.threadId,
          request.turnId,
          {
            content: request.content,
            ...(request.skills ? { skills: request.skills } : {}),
            model: activeInput.model,
            permissionConfig: activeInput.permissionConfig,
            strategy: 'guide',
            taskMode: activeInput.taskMode,
          },
          request.inputId,
          request.attachmentIds ?? [],
          request.contextReferenceIds ?? [],
        )
        const sequence = globalEventSequence(db)
        return {
          inputId: request.inputId,
          turnId: submitted.turnID,
          disposition: submitted.disposition === 'duplicate' ? 'duplicate' : 'accepted',
          streamPosition: { streamId: request.threadId, sequence },
        }
      }
      case 'turn/interrupt': {
        const request = decodeParams(decodeTurnInterrupt, rawParams, 'turn/interrupt')
        const status = await threads.stop(request.threadId, request.turnId)
        return { threadId: request.threadId, turnId: request.turnId, status }
      }
      case 'turn/resume': {
        const threadId = stringParam(params, 'threadId')
        const turnId = stringParam(params, 'turnId')
        threads.resumeTurn(threadId, turnId)
        return { threadId, turnId, status: 'running' }
      }
      case 'queue/update': {
        const request = decodeParams(decodeQueueUpdate, rawParams, 'queue/update')
        const mutation = await threads.updateQueue(
          request.threadId,
          request.inputId,
          request.content,
          request.attachmentIds,
          request.contextReferenceIds,
          {
            operationID: request.operationId,
            ...(request.expectedVersion === undefined
              ? {}
              : { expectedVersion: request.expectedVersion }),
          },
          request.skills,
        )
        return runtime.queueStateResult(request.threadId, mutation.event?.id)
      }
      case 'queue/add': {
        const request = decodeParams(decodeQueueAdd, rawParams, 'queue/add')
        const submitted = await threads.enqueueFollowUp(
          request.threadId,
          {
            content: request.content,
            model: request.model,
            permissionConfig: request.permissionConfig,
            strategy: 'queue',
            ...(request.skills ? { skills: request.skills } : {}),
            taskMode: request.taskMode,
          },
          request.inputId,
          request.attachmentIds ?? [],
          request.contextReferenceIds ?? [],
          {
            operationID: request.operationId,
            ...(request.expectedVersion === undefined
              ? {}
              : { expectedVersion: request.expectedVersion }),
          },
        )
        const sequence = globalEventSequence(db)
        const turnStatus = db.getTurnStatus(submitted.turnID)
        return {
          inputId: submitted.inputID,
          turnId: submitted.turnID,
          disposition: submitted.disposition === 'duplicate' ? 'duplicate' : 'accepted',
          admission:
            submitted.disposition === 'started'
              ? 'started'
              : submitted.disposition === 'queued'
                ? 'queued'
                : turnStatus === 'queued'
                  ? 'queued'
                  : 'started',
          streamPosition: { streamId: request.threadId, sequence },
        }
      }
      case 'queue/remove': {
        const request = decodeParams(decodeQueueInput, rawParams, 'queue/remove')
        const mutation = await threads.removeQueue(request.threadId, request.inputId, {
          operationID: request.operationId,
          ...(request.expectedVersion === undefined
            ? {}
            : { expectedVersion: request.expectedVersion }),
        })
        return runtime.queueStateResult(request.threadId, mutation.event?.id)
      }
      case 'queue/resume': {
        const request = decodeParams(decodeQueueResume, rawParams, 'queue/resume')
        const mutation = await threads.resumeQueue(request.threadId, {
          operationID: request.operationId,
          ...(request.expectedVersion === undefined
            ? {}
            : { expectedVersion: request.expectedVersion }),
        })
        return runtime.queueStateResult(request.threadId, mutation.event?.id)
      }
      case 'attachment/import': {
        if (!Array.isArray(params.uploads))
          throw new AgentError('INVALID_REQUEST', 'uploads 参数无效', 400)
        const uploads = params.uploads.map((entry) => {
          const value = record(entry, 'attachment')
          const kind = enumValue(value.kind, ['text', 'image'] as const, 'kind')
          const data = stringParam(value, 'data')
          return {
            kind,
            name: stringParam(value, 'name'),
            mimeType: stringParam(value, 'mediaType', 'mimeType'),
            data:
              kind === 'image' || value.encoding === 'base64'
                ? new Uint8Array(Buffer.from(data, 'base64'))
                : data,
          }
        })
        return { attachments: (await attachments.store(uploads)).map(attachmentView) }
      }
      case 'attachment/read': {
        const value = await attachments.read(stringParam(params, 'attachmentId', 'id'))
        const all = value.data
        const range =
          params.range && typeof params.range === 'object' && !Array.isArray(params.range)
            ? (params.range as Record<string, unknown>)
            : null
        const offset = range && typeof range.offset === 'number' ? range.offset : 0
        const length =
          range && typeof range.length === 'number'
            ? Math.min(range.length, Math.max(0, all.byteLength - offset))
            : Math.max(0, all.byteLength - offset)
        const data = all.slice(offset, offset + length)
        return {
          attachment: attachmentView(value.record),
          data:
            value.record.kind === 'text'
              ? new TextDecoder().decode(data)
              : Buffer.from(data).toString('base64'),
          encoding: value.record.kind === 'text' ? 'utf8' : 'base64',
          range: { offset, length: data.byteLength, total: all.byteLength },
        }
      }
      case 'artifact/read': {
        const threadId = stringParam(params, 'threadId')
        const artifactId = stringParam(params, 'artifactId')
        if (!db.getThread(threadId)) throw new AgentError('THREAD_NOT_FOUND', 'Thread 不存在', 404)
        const value = await runtime.dependencies.artifacts.read(artifactId, threadId)
        return {
          artifact: artifactMetadataView(value.artifact),
          data: Buffer.from(value.data).toString('base64'),
          encoding: 'base64',
          sizeBytes: value.data.byteLength,
        }
      }
      default:
        throw new AgentError('METHOD_NOT_FOUND', `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
