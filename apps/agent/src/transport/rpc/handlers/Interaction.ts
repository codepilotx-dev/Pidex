import type { RpcMethod } from '@pidex/agent-protocol'
import type { RpcRouter } from '../RpcRouter'
import { optionalRpcRecord as optionalRecord } from '../Decoders'
import { AgentError } from '../RpcRouter'
import type { RpcHandlerGroup } from './Types'

export const interactionHandlers = {
  name: 'interaction',
  methods: [
    'interaction/listPending',
    'interaction/questionPause',
    'approval/rules/list',
    'approval/rules/revoke',
    'approval/reviewState',
    'approval/retry',
  ],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown): Promise<unknown> {
    const params = optionalRecord(rawParams)
    switch (method) {
      case 'interaction/listPending':
        return runtime.listPendingInteractions(params)
      case 'interaction/questionPause':
        return runtime.dependencies.questions.pause(
          String(params.interactionId),
          Number(params.expectedVersion),
        )
      case 'approval/rules/list':
        return runtime.dependencies.approvals.rules.list(String(params.threadId))
      case 'approval/rules/revoke':
        return runtime.dependencies.approvals.rules.revoke(
          String(params.threadId),
          String(params.ruleId),
        )
      case 'approval/reviewState':
        return runtime.dependencies.db.repositories.interactions.approvalReviewState(
          String(params.threadId),
        )
      case 'approval/retry':
        return runtime.dependencies.approvals.requestRetry(
          String(params.threadId),
          String(params.reviewId),
          String(params.operationId),
        )
      default:
        throw new AgentError('METHOD_NOT_FOUND', `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
