import type { RpcMethod } from '@pidex/agent-protocol'
import type { RpcRouter } from '../RpcRouter'
import { optionalRpcRecord as optionalRecord } from '../Decoders'
import { AgentError } from '../RpcRouter'
import type { RpcHandlerGroup } from './Types'

export const permissionHandlers = {
  name: 'permission',
  methods: ['interaction/respond'],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown): Promise<unknown> {
    const params = optionalRecord(rawParams)
    switch (method) {
      case 'interaction/respond':
        return runtime.respondToInteraction(params)
      default:
        throw new AgentError('METHOD_NOT_FOUND', `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
