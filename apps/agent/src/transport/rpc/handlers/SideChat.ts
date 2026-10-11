import type { RpcMethod } from '@pidex/agent-protocol'
import { stringParam, type RpcRouter } from '../RpcRouter'
import { optionalRpcRecord as optionalRecord } from '../Decoders'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

export const sideChatHandlers = {
  name: 'side-chat',
  methods: ['thread/side-chat/create', 'thread/side-chat/discard'],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ) {
    const params = optionalRecord(rawParams)
    switch (method) {
      case 'thread/side-chat/create':
        return {
          sideChat: await runtime.dependencies.sideChats.create({
            sourceThreadID: stringParam(params, 'sourceThreadId'),
            ...(params.referenceText === undefined
              ? {}
              : { referenceText: stringParam(params, 'referenceText') }),
            operationID: stringParam(params, 'operationId'),
          }),
        }
      case 'thread/side-chat/discard':
        await runtime.dependencies.sideChats.discard(stringParam(params, 'threadId'))
        return { ok: true }
      default:
        throw new Error(`Unsupported side chat method: ${method}`)
    }
  },
} as const satisfies RpcHandlerGroup
