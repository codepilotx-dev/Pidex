import type { RpcMethod } from '@pidex/agent-protocol'
import type { RpcRouter } from '../RpcRouter'
import { optionalRpcRecord as optionalRecord } from '../Decoders'
import {
  AgentError,
  enumValue,
  memoryEntryView,
  resolveMemoryProjectID,
  resolveMemoryProjectKey,
  stringParam,
} from '../RpcRouter'
import type { RpcHandlerGroup } from './Types'

export const memoryHandlers = {
  name: 'memory',
  methods: ['memory/list', 'memory/read', 'memory/save', 'memory/delete', 'memory/reset'],
  async handle(runtime: RpcRouter, method: RpcMethod, rawParams: unknown): Promise<unknown> {
    const { db, memory } = runtime.dependencies
    const params = optionalRecord(rawParams)
    switch (method) {
      case 'memory/list': {
        const scope = enumValue(params.scope, ['user', 'project'] as const, 'scope')
        const projectKey =
          scope === 'project' ? await resolveMemoryProjectKey(db, params) : undefined
        const projectId = scope === 'project' ? resolveMemoryProjectID(db, params) : null
        return {
          entries: memory
            .list({
              scope,
              ...(projectKey ? { projectKey } : {}),
              limit: typeof params.limit === 'number' ? params.limit : 100,
            })
            .map((entry) => memoryEntryView(entry, projectId)),
          nextCursor: null,
        }
      }
      case 'memory/read': {
        const id = stringParam(params, 'id')
        const scope = enumValue(params.scope, ['user', 'project'] as const, 'scope')
        const projectKey =
          scope === 'project' ? await resolveMemoryProjectKey(db, params) : undefined
        const entry = memory.read({ id, scope, ...(projectKey ? { projectKey } : {}) })
        if (!entry) throw new AgentError('MEMORY_NOT_FOUND', '记忆不存在或记忆功能未启用', 404)
        return {
          entry: memoryEntryView(
            entry,
            scope === 'project' ? resolveMemoryProjectID(db, params) : null,
          ),
        }
      }
      case 'memory/save': {
        const scope = enumValue(params.scope, ['user', 'project'] as const, 'scope')
        const projectKey =
          scope === 'project' ? await resolveMemoryProjectKey(db, params) : undefined
        const entry = memory.remember({
          scope,
          content: stringParam(params, 'content'),
          ...(typeof params.id === 'string' && params.id ? { id: params.id } : {}),
          ...(projectKey ? { projectKey } : {}),
        })
        if (!entry)
          throw new AgentError('MEMORY_REJECTED', '记忆功能未启用、内容为空或包含敏感信息', 409)
        return {
          entry: memoryEntryView(
            entry,
            scope === 'project' ? resolveMemoryProjectID(db, params) : null,
          ),
        }
      }
      case 'memory/delete': {
        const id = stringParam(params, 'id')
        const scope = enumValue(params.scope, ['user', 'project'] as const, 'scope')
        const projectKey =
          scope === 'project' ? await resolveMemoryProjectKey(db, params) : undefined
        return { deleted: memory.delete({ id, scope, ...(projectKey ? { projectKey } : {}) }), id }
      }
      case 'memory/reset': {
        const scope = enumValue(params.scope, ['user', 'project'] as const, 'scope')
        const projectKey =
          scope === 'project' ? await resolveMemoryProjectKey(db, params) : undefined
        return {
          deleted: memory.reset({
            scope,
            ...(projectKey ? { projectKey } : {}),
            includeEventLog: params.includeEventLog === true,
          }),
        }
      }
      default:
        throw new AgentError('METHOD_NOT_FOUND', `未知 RPC 方法：${method}`, 404)
    }
  },
} as const satisfies RpcHandlerGroup
