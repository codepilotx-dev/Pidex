import { ThreadBookmarkRpcMethods, type RpcMethod } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { decodeRpcParams } from '../Decoders'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'

const decodeList = (raw: unknown) =>
  decodeRpcParams(
    Schema.decodeUnknownSync(ThreadBookmarkRpcMethods['thread/bookmarks/list'].params),
    raw,
    'thread/bookmarks/list',
  )
const decodeSet = (raw: unknown) =>
  decodeRpcParams(
    Schema.decodeUnknownSync(ThreadBookmarkRpcMethods['thread/bookmarks/set'].params),
    raw,
    'thread/bookmarks/set',
  )

export const threadBookmarkHandlers = {
  name: 'thread-bookmark',
  methods: Object.keys(ThreadBookmarkRpcMethods) as readonly RpcMethod[],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ) {
    const service = runtime.dependencies.threadBookmarks
    switch (method) {
      case 'thread/bookmarks/list':
        return service.list(decodeList(rawParams))
      case 'thread/bookmarks/set':
        return service.set(decodeSet(rawParams))
      default:
        return undefined
    }
  },
}
