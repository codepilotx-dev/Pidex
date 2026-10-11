import type { RpcMethod } from '@pidex/agent-protocol'
import { Effect } from 'effect'
import { AgentError } from '../../../Domain'
import { enumValue, stringParam, type RpcRouter } from '../RpcRouter'
import { optionalRpcRecord as optionalRecord, rpcRecord as record } from '../Decoders'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const operation = (params: Record<string, unknown>) => ({
  worktreeId: stringParam(params, 'worktreeId'),
  operationId: stringParam(params, 'operationId'),
})

export const worktreeHandlers = {
  name: 'worktree',
  methods: [
    'worktree/eligibility',
    'worktree/settings/list',
    'worktree/settings/delete',
    'worktree/settings/new-chat',
    'worktree/create',
    'worktree/list',
    'worktree/read',
    'worktree/retry-setup',
    'worktree/continue-without-setup',
    'worktree/set-permanent',
    'worktree/delete',
    'worktree/restore',
    'worktree/operation/status',
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ) {
    const service = runtime.dependencies.worktrees
    const params = optionalRecord(rawParams)
    switch (method) {
      case 'worktree/settings/list': {
        const { config, db } = runtime.dependencies
        const desktop = config.snapshot().desktop as Record<string, unknown> | undefined
        const pins = (desktop?.sidebarSessionPins ?? {}) as Record<string, unknown>
        return {
          worktrees: service
            .settingsList(typeof params.projectId === 'string' ? params.projectId : undefined)
            .map((entry) => ({
              ...entry,
              conversations: entry.conversations.map((thread) => ({
                id: thread.id,
                title: thread.title,
                archived: thread.archived_at !== null,
                pinned: Boolean(pins[thread.id]),
                active: db.activeTurn(thread.id) !== null,
              })),
            })),
        }
      }
      case 'worktree/settings/delete': {
        const input = operation(params)
        const { db, history, config, automation, scheduledTasks } = runtime.dependencies
        return service.delete({
          ...input,
          archiveConversations: async () => {
            const entry = service
              .settingsList()
              .find((entry) => entry.worktree.id === input.worktreeId)
            if (!entry) throw new AgentError('WORKTREE_NOT_FOUND', '工作树不存在', 404)
            const desktop = config.snapshot().desktop as Record<string, unknown> | undefined
            const pins = (desktop?.sidebarSessionPins ?? {}) as Record<string, unknown>
            if (
              entry.worktree.pinned ||
              entry.conversations.some((thread) => pins[thread.id] || db.activeTurn(thread.id))
            )
              throw new AgentError('WORKTREE_NOT_READY', '请先停止任务并取消关联聊天的置顶', 409)
            for (const thread of entry.conversations.filter(
              (thread) => thread.archived_at === null,
            )) {
              await automation.removeThreadSchedules(thread.id)
              await scheduledTasks?.removeThreadSchedules(thread.id)
              const paused = db.pauseQueue(thread.id, 'interrupted')
              if (paused) await Effect.runPromise(runtime.dependencies.hub.publish(paused))
              if (db.activeTurn(thread.id))
                throw new AgentError('WORKTREE_NOT_READY', '关联聊天有正在运行的任务', 409)
              await history.patch(thread.id, { archived: true })
            }
          },
        })
      }
      case 'worktree/settings/new-chat': {
        const input = operation(params)
        const worktree = service.read(input.worktreeId)
        const { threads, threadExecutions } = runtime.dependencies
        const prepared = await threadExecutions.prepare(worktree.projectId, {
          kind: 'worktree',
          worktreeId: worktree.id,
        })
        try {
          const created = await threads.create({
            title: '新对话',
            operationID: input.operationId,
            workspace: { kind: 'project', projectID: worktree.projectId },
            bindExecution: prepared.bind,
          })
          await prepared.reconcile(created.id)
          return { threadId: created.id }
        } catch (cause) {
          await prepared.abort()
          throw cause
        }
      }
      case 'worktree/eligibility':
        return service.eligibility(stringParam(params, 'projectId'))
      case 'worktree/create': {
        const starting = record(params.startingState, 'startingState')
        const type = enumValue(
          starting.type,
          ['branch', 'working-tree'] as const,
          'startingState.type',
        )
        const result = await service.create({
          projectId: stringParam(params, 'projectId'),
          operationId: stringParam(params, 'operationId'),
          startingState:
            type === 'branch'
              ? { type, branchName: stringParam(starting, 'branchName') }
              : { type },
        })
        await service.autoCleanup(result.worktree.projectId).catch(() => [])
        return result
      }
      case 'worktree/list':
        return service.list(typeof params.projectId === 'string' ? params.projectId : undefined)
      case 'worktree/read':
        return service.read(stringParam(params, 'worktreeId'))
      case 'worktree/retry-setup':
        return service.retrySetup(operation(params))
      case 'worktree/continue-without-setup':
        return service.continueWithoutSetup(operation(params))
      case 'worktree/set-permanent': {
        if (typeof params.permanent !== 'boolean')
          throw new AgentError('INVALID_REQUEST', 'permanent 参数无效', 400)
        return service.setPermanent({ ...operation(params), permanent: params.permanent })
      }
      case 'worktree/delete':
        return service.delete(operation(params))
      case 'worktree/restore':
        return service.restore(operation(params))
      case 'worktree/operation/status': {
        const cursor = params.afterOutputCursor
        if (
          cursor !== undefined &&
          (typeof cursor !== 'number' || !Number.isSafeInteger(cursor) || cursor < 0)
        ) {
          throw new AgentError('INVALID_REQUEST', 'afterOutputCursor 参数无效', 400)
        }
        return service.operationStatus(
          stringParam(params, 'operationId'),
          cursor as number | undefined,
        )
      }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
