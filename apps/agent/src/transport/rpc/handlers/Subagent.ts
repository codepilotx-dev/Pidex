import type { RpcMethod } from '@pidex/agent-protocol'
import type { RpcRouter } from '../RpcRouter'
import { optionalRpcRecord as optionalRecord, rpcRecord as record } from '../Decoders'
import { AgentError, stringParam } from '../RpcRouter'
import type { RpcHandlerGroup } from './Types'

export const subagentHandlers = {
  name: 'subagent',
  methods: [
    'subagent/list',
    'subagent/read',
    'subagent/stop',
    'subagent/retry',
    'subagent/followup',
    'subagent/send',
    'subagent/worktree/diff',
    'subagent/worktree/apply',
    'subagent/worktree/discard',
    'subagent/workspace/restore',
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown): Promise<unknown> {
    const { db, subagents } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case 'subagent/list':
        return {
          subagents: subagents.list(stringParam(params, 'threadId', 'parentThreadId')),
          nextCursor: null,
        }
      case 'subagent/read': {
        const value = subagents.read(stringParam(params, 'taskId', 'subagentTaskId'))
        const { approvals, questions } = db.getPendingInteractionCounts(value.task.childThreadId)
        return {
          ...value,
          snapshot: runtime.requiredSnapshot(value.task.childThreadId),
          capabilities: {
            canFollowup: subagents.canFollowup(value.task.id),
            canStop: Boolean(
              value.currentRun &&
              !['completed', 'failed', 'stopped', 'interrupted'].includes(value.currentRun.status),
            ),
            canRetry: Boolean(
              value.currentRun &&
              ['failed', 'stopped', 'interrupted'].includes(value.currentRun.status),
            ),
            canRespondToApprovals: approvals > 0,
            canRespondToQuestions: questions > 0,
            canRespondToPlan: false,
            canApplyWorktree:
              value.task.workspace.mode === 'worktree' &&
              value.task.workspace.state !== 'applied' &&
              value.task.workspace.state !== 'discarded' &&
              Boolean(
                value.currentRun &&
                ['completed', 'failed', 'stopped', 'interrupted'].includes(value.currentRun.status),
              ),
            canDiscardWorktree:
              value.task.workspace.mode === 'worktree' &&
              value.task.workspace.state !== 'applied' &&
              value.task.workspace.state !== 'discarded',
            canRestoreWorkspace:
              value.task.workspace.mode === 'shared' &&
              value.task.workspace.baselineRef !== null &&
              Boolean(
                value.currentRun &&
                ['completed', 'failed', 'stopped', 'interrupted'].includes(value.currentRun.status),
              ),
          },
        }
      }
      case 'subagent/stop':
        return subagents.stop(
          stringParam(params, 'taskId', 'subagentTaskId'),
          stringParam(params, 'operationId'),
        )
      case 'subagent/send':
        return subagents.send(
          stringParam(params, 'taskId'),
          stringParam(params, 'message'),
          stringParam(params, 'operationId'),
        )
      case 'subagent/followup':
        return subagents.followup(
          stringParam(params, 'taskId'),
          stringParam(params, 'message'),
          stringParam(params, 'operationId'),
        )
      case 'subagent/retry':
        return subagents.retry(
          stringParam(params, 'taskId', 'subagentTaskId'),
          stringParam(params, 'operationId'),
        )
      case 'subagent/worktree/diff': {
        const result = record(
          await subagents.worktreeDiff(stringParam(params, 'taskId', 'subagentTaskId')),
          'diff',
        )
        const diff =
          typeof result.patch === 'string'
            ? result.patch
            : typeof result.diff === 'string'
              ? result.diff
              : ''
        const maxBytes = typeof params.maxBytes === 'number' ? params.maxBytes : 1_000_000
        const encoded = new TextEncoder().encode(diff)
        return {
          diff:
            encoded.byteLength <= maxBytes
              ? diff
              : new TextDecoder().decode(encoded.slice(0, maxBytes)),
          truncated: encoded.byteLength > maxBytes || result.truncated === true,
        }
      }
      case 'subagent/worktree/apply': {
        const taskId = stringParam(params, 'taskId', 'subagentTaskId')
        await subagents.worktreeApply(taskId, stringParam(params, 'operationId'))
        return {
          result: {
            taskId,
            action: 'apply',
            outcome: 'changed',
            workspace: subagents.read(taskId).task.workspace,
          },
        }
      }
      case 'subagent/worktree/discard': {
        const taskId = stringParam(params, 'taskId', 'subagentTaskId')
        await subagents.worktreeDiscard(taskId, stringParam(params, 'operationId'))
        return {
          result: {
            taskId,
            action: 'discard',
            outcome: 'changed',
            workspace: subagents.read(taskId).task.workspace,
          },
        }
      }
      case 'subagent/workspace/restore': {
        const taskId = stringParam(params, 'taskId', 'subagentTaskId')
        await subagents.workspaceRestore(taskId, stringParam(params, 'operationId'))
        return {
          result: {
            taskId,
            action: 'restore',
            outcome: 'changed',
            workspace: subagents.read(taskId).task.workspace,
          },
        }
      }
      default:
        throw new AgentError('METHOD_NOT_FOUND', `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
