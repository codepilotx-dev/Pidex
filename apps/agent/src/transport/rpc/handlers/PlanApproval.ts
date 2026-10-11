import { PlanApprovalRpcMethods, type RpcMethod } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import type { RpcRouter } from '../RpcRouter'
import type { RpcHandlerGroup } from './Types'

export const planApprovalHandlers = {
  name: 'plan-approval',
  methods: ['planApproval/read', 'planApproval/respond', 'planApproval/implementFresh'],
  async handle(runtime: RpcRouter, method: RpcMethod, raw: unknown) {
    switch (method) {
      case 'planApproval/implementFresh':
        return runtime.planApprovals.implementFresh(
          Schema.decodeUnknownSync(PlanApprovalRpcMethods[method].params)(raw),
        )
      case 'planApproval/read': {
        const params = Schema.decodeUnknownSync(PlanApprovalRpcMethods[method].params)(raw)
        return { approval: runtime.planApprovals.read(params.threadId) }
      }
      case 'planApproval/respond':
        return runtime.planApprovals.respond(
          Schema.decodeUnknownSync(PlanApprovalRpcMethods[method].params)(raw),
        )
    }
  },
} as const satisfies RpcHandlerGroup
