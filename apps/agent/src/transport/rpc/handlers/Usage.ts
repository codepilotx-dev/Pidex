import { RpcMethods, type RpcMethod } from '@pidex/agent-protocol'
import { Schema } from 'effect'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const decodeLocal = Schema.decodeUnknownSync(RpcMethods['usage/local/get'].params)
const decodeSourceList = Schema.decodeUnknownSync(RpcMethods['usage/source/list'].params)
const decodeProvider = Schema.decodeUnknownSync(RpcMethods['usage/provider/query'].params)
const decodeConnect = Schema.decodeUnknownSync(RpcMethods['usage/credential/connect'].params)
const decodeDisconnect = Schema.decodeUnknownSync(RpcMethods['usage/credential/disconnect'].params)

export const usageHandlers = {
  name: 'usage',
  methods: [
    'usage/source/list',
    'usage/local/get',
    'usage/provider/query',
    'usage/credential/connect',
    'usage/credential/disconnect',
  ],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    switch (method) {
      case 'usage/source/list':
        decodeSourceList(rawParams)
        return runtime.dependencies.usage.sourceList()
      case 'usage/local/get': {
        const params = decodeLocal(rawParams)
        return runtime.dependencies.usage.localUsage(params.range, params.timeZone)
      }
      case 'usage/provider/query': {
        const params = decodeProvider(rawParams)
        return runtime.dependencies.usage.providerUsage({
          range: params.range,
          timeZone: params.timeZone,
          ...(params.providerIds === undefined
            ? {}
            : { providerIds: params.providerIds.map(String) }),
          ...(params.sourceIds === undefined ? {} : { sourceIds: params.sourceIds }),
          ...(params.force === undefined ? {} : { force: params.force }),
        })
      }
      case 'usage/credential/connect': {
        const result = await runtime.dependencies.usage.connect(decodeConnect(rawParams))
        await runtime.emit('usage/source/updated', {
          sourceId: result.sourceId,
          changedAt: Date.now(),
        })
        return result
      }
      case 'usage/credential/disconnect': {
        const result = await runtime.dependencies.usage.disconnect(decodeDisconnect(rawParams))
        await runtime.emit('usage/source/updated', {
          sourceId: result.sourceId,
          changedAt: Date.now(),
        })
        return result
      }
      default:
        return undefined
    }
  },
} as const satisfies RpcHandlerGroup
