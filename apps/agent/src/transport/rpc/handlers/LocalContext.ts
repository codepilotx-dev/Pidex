import {
  LocalContextPathImportParamsSchema,
  LocalContextPathListParamsSchema,
  LocalContextPathReadParamsSchema,
  type RpcMethod,
} from '@pidex/agent-protocol'
import { Schema } from 'effect'
import { AgentError } from '../../../Domain'
import type { RpcRouter } from '../RpcRouter'
import type { RpcRouterContext } from '../RequestContext'
import type { RpcHandlerGroup } from './Types'

const decodeImport = Schema.decodeUnknownSync(LocalContextPathImportParamsSchema)
const decodeRead = Schema.decodeUnknownSync(LocalContextPathReadParamsSchema)
const decodeList = Schema.decodeUnknownSync(LocalContextPathListParamsSchema)

export const localContextHandlers = {
  name: 'local-context',
  methods: ['context/path/import', 'context/path/read', 'context/path/list'],
  async handle(
    runtime: RpcRouter,
    method: RpcMethod,
    rawParams: unknown,
    _context: RpcRouterContext,
  ): Promise<unknown> {
    const service = runtime.dependencies.localContextPaths
    switch (method) {
      case 'context/path/import': {
        const params = decodeImport(rawParams)
        return {
          references: await service.import(params.threadId, params.paths, params.operationId),
        }
      }
      case 'context/path/read': {
        const params = decodeRead(rawParams)
        return service.read({
          threadID: params.threadId,
          referenceID: params.referenceId,
          ...(params.relativePath === undefined ? {} : { relativePath: params.relativePath }),
          ...(params.range === undefined ? {} : { range: params.range }),
        })
      }
      case 'context/path/list': {
        const params = decodeList(rawParams)
        return service.list({
          threadID: params.threadId,
          referenceID: params.referenceId,
          ...(params.relativePath === undefined ? {} : { relativePath: params.relativePath }),
          ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
          ...(params.limit === undefined ? {} : { limit: params.limit }),
        })
      }
      default:
        throw new AgentError('METHOD_NOT_FOUND', `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
