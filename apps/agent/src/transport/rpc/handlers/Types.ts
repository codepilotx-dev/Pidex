import type { RpcMethod } from '@pidex/agent-protocol'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'

export type RpcHandlerGroup = {
  readonly name: string
  readonly methods: readonly RpcMethod[]
  readonly handle: (
    runtime: RpcRouter,
    method: RpcMethod,
    params: unknown,
    context: RpcRouterContext,
  ) => Promise<unknown>
}
