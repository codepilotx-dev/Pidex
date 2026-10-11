import { ThreadGoalRpcMethods, type RpcMethod } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { decodeRpcParams } from '../Decoders'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'

// One concrete decoder per method keeps params bound to the wire schema without
// widening to a union or falling back to an unbounded cast.
const decodeGet = (raw: unknown) =>
  decodeRpcParams(
    Schema.decodeUnknownSync(ThreadGoalRpcMethods['thread/goal/get'].params),
    raw,
    'thread/goal/get',
  )
const decodeSet = (raw: unknown) =>
  decodeRpcParams(
    Schema.decodeUnknownSync(ThreadGoalRpcMethods['thread/goal/set'].params),
    raw,
    'thread/goal/set',
  )
const decodeClear = (raw: unknown) =>
  decodeRpcParams(
    Schema.decodeUnknownSync(ThreadGoalRpcMethods['thread/goal/clear'].params),
    raw,
    'thread/goal/clear',
  )

export const threadGoalHandlers = {
  name: 'thread-goal',
  methods: Object.keys(ThreadGoalRpcMethods) as readonly RpcMethod[],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ) {
    const service = runtime.dependencies.threadGoals
    switch (method) {
      case 'thread/goal/get':
        return service.get(decodeGet(rawParams).threadId)
      case 'thread/goal/set': {
        const params = decodeSet(rawParams)
        const result = await service.set(params)
        if (result.goal.status === 'active')
          await runtime.dependencies.threads.resumeGoalContinuation(params.threadId)
        return result
      }
      case 'thread/goal/clear':
        return service.clear(decodeClear(rawParams))
      default:
        return undefined
    }
  },
}
